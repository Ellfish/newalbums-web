import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse, isSameOrigin } from '../../../lib/api';
import { normaliseEmailAddress, getOrCreateSubscriber } from '../../../lib/repo/subscribers';
import { createAccessToken, ACCESS_TOKEN_TTL_HOURS } from '../../../lib/repo/access-tokens';
import { sendMagicLinkEmail, sendNewSubscriberNotification } from '../../../lib/emails/notifications';
import { TtlCache } from '../../../lib/cache';

export const prerender = false;

interface Body {
	emailAddress?: string;
}

/**
 * Step 1 of the flow: get-or-create the subscriber, then email them a magic
 * link carrying a 24h access token. The response is identical whether the
 * address is new or existing (no account enumeration).
 */
const sendCooldown = new TtlCache<true>(60 * 1000);

export const POST: APIRoute = async ({ request }) => {
	if (!isSameOrigin(request)) {
		return errorResponse('This endpoint only accepts same-origin requests.', 403);
	}

	const body = await readJsonBody<Body>(request);

	//Normalise before validating, so trailing whitespace/case never rejects a valid address
	const emailAddress = normaliseEmailAddress(body?.emailAddress ?? '');
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress)) {
		return errorResponse('Please provide a valid email address.', 400);
	}

	//Best-effort per-isolate cooldown so one address can't be spammed with links
	if (sendCooldown.get(emailAddress)) {
		return errorResponse(
			'A sign-in link was just sent to this address. Please wait a minute before requesting another.',
			429,
		);
	}

	try {
		const { subscriber, createdNewSubscriber } = await getOrCreateSubscriber(env.DB, emailAddress, false);
		const accessToken = await createAccessToken(env.DB, subscriber.Id);

		//The link returns to the host the visitor actually used: in local dev
		//that's http://localhost:4321 (FRONTEND_ROOT_URL would point the link
		//at production, where this token doesn't exist), and in production
		//it's the site itself
		const magicLinkUrl = `${new URL(request.url).origin}/subscribe-to-artists?token=${accessToken.Token}`;

		const error = await sendMagicLinkEmail({
			emailAddress: subscriber.EmailAddress,
			magicLinkUrl,
		});
		if (error) {
			console.error('Error sending magic link email:', error);
			return errorResponse('We could not send your sign-in link right now. Please try again shortly.');
		}
		sendCooldown.set(emailAddress, true);

		if (createdNewSubscriber) {
			const notificationError = await sendNewSubscriberNotification(subscriber.EmailAddress);
			if (notificationError) {
				console.error('Error sending new subscriber notification email:', notificationError);
			}
		}

		return jsonResponse({
			statusMessage: `Check your inbox – we've sent a sign-in link to ${subscriber.EmailAddress}. It's valid for ${ACCESS_TOKEN_TTL_HOURS} hours.`,
		});
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};

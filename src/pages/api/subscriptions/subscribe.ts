import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse } from '../../../lib/api';
import { normaliseEmailAddress, getOrCreateSubscriber } from '../../../lib/repo/subscribers';
import { getOrCreateArtists } from '../../../lib/repo/artists';
import { subscribeToArtists, MAX_PER_SUBSCRIBER } from '../../../lib/repo/subscriptions';
import { getUserEmail } from '../../../lib/spotify';
import { sendVerificationEmail, sendNewSubscriberNotification } from '../../../lib/emails/notifications';

export const prerender = false;

interface Body {
	emailAddress?: string;
	spotifyAccessToken?: string;
	artists?: { spotifyId?: string; name?: string }[];
}

/**
 * Port of SubscriptionController.SubscribeToArtists: get-or-create the
 * subscriber (auto-verifying their email if it matches their Spotify account
 * email, which is more secure than trusting a client flag), get-or-create the
 * artists, subscribe with the per-subscriber cap, then send any emails.
 */
export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody<Body>(request);

	//Normalise before validating, so trailing whitespace/case never rejects a valid address
	const emailAddress = normaliseEmailAddress(body?.emailAddress ?? '');
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress)) {
		return errorResponse('Please provide a valid email address.', 400);
	}

	const artists = (body?.artists ?? []).filter(
		(artist): artist is { spotifyId: string; name: string } =>
			typeof artist.spotifyId === 'string' && artist.spotifyId.length > 0 && typeof artist.name === 'string',
	);

	if (artists.length === 0) {
		return errorResponse('Please select at least one artist to subscribe to.', 400);
	}

	try {
		//Get the email address from their Spotify account again to see if we can auto-verify
		//their Subscriber email. If there are any errors, fall back to assuming we need to verify.
		let emailVerified = false;
		if (body?.spotifyAccessToken) {
			try {
				const spotifyEmail = await getUserEmail(body.spotifyAccessToken);
				if (spotifyEmail && normaliseEmailAddress(spotifyEmail) === normaliseEmailAddress(emailAddress)) {
					emailVerified = true;
				}
			} catch {
				//Fall back to requiring email verification
			}
		}

		const { subscriber, createdNewSubscriber } = await getOrCreateSubscriber(env.DB, emailAddress, emailVerified);

		const artistRows = await getOrCreateArtists(
			env.DB,
			artists.map((artist) => ({ spotifyId: artist.spotifyId, name: artist.name })),
		);

		const { existingSubscriptionsCount, newSubscriptionsCount, limitReached } = await subscribeToArtists(
			env.DB,
			subscriber.Id,
			artistRows.map((artist) => artist.Id),
		);

		if (createdNewSubscriber) {
			const error = await sendNewSubscriberNotification(subscriber.EmailAddress, artistRows.length);
			if (error) console.error('Error sending new subscriber notification email:', error);
		}

		if (subscriber.EmailAddressVerified !== 1) {
			const error = await sendVerificationEmail({
				emailAddress: subscriber.EmailAddress,
				emailVerifyCode: subscriber.EmailVerifyCode,
			});
			if (error) console.error('Error sending verification email:', error);
		}

		//Ported from SubscribeToArtistsOutput.SetStatusMessage
		let statusMessage = `Subscribed to ${newSubscriptionsCount} new artist${newSubscriptionsCount === 1 ? '' : 's'}. `;
		if (existingSubscriptionsCount > 0) {
			statusMessage += `You have existing subscriptions to ${existingSubscriptionsCount} artist${existingSubscriptionsCount === 1 ? '' : 's'}. `;
		}
		if (limitReached) {
			statusMessage += `You've now reached the limit of ${MAX_PER_SUBSCRIBER} artist subscriptions, and can't subscribe to any more (sorry).`;
		}

		return jsonResponse({
			statusMessage,
			requiresEmailVerification: subscriber.EmailAddressVerified !== 1,
		});
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};

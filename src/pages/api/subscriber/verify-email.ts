import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readJsonBody, jsonResponse, errorResponse } from '../../../lib/api';
import { checkEmailVerification, setEmailVerified } from '../../../lib/repo/subscribers';

export const prerender = false;

interface Body {
	emailAddress?: string;
	verifyCode?: string;
}

/** Port of SubscriberController.VerifyEmail, including the error message wording */
export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody<Body>(request);

	if (!body?.emailAddress || !body?.verifyCode) {
		return errorResponse('Please ensure you click the verify link or button in the email.', 400);
	}

	try {
		const result = await checkEmailVerification(env.DB, body.emailAddress, body.verifyCode);

		if ('errorMessage' in result) {
			// "Invalid email verification code." / "You've already verified your email address."
			return errorResponse(result.errorMessage, 400);
		}

		await setEmailVerified(env.DB, result.subscriber.Id);

		return jsonResponse({ verified: true });
	} catch (e) {
		return errorResponse(e instanceof Error ? e.message : String(e));
	}
};

import { sendEmail, type EmailMessage } from '../mailgun';
import { getAppConfig } from '../config';
import { renderAlertEmail } from './template';

/**
 * The two emails the front-end sends, ported from SubscriptionController.
 * (The daily new-album notification emails stay on the NAS.)
 */

/** Port of SubscriptionController.SendVerificationEmail */
export async function sendVerificationEmail(subscriber: {
	emailAddress: string;
	emailVerifyCode: string | null;
}): Promise<string | null> {
	const { frontendRootUrl } = getAppConfig();
	const verifyUrl = `${frontendRootUrl}/verify-email?emailAddress=${encodeURIComponent(
		subscriber.emailAddress,
	)}&verifyCode=${subscriber.emailVerifyCode}`;

	const message: EmailMessage = {
		subject: 'Please verify your email address',
		text:
			'Hello, please click the link below to verify your email address. This is required before you can receive new album emails:' +
			`\r\n\r\n${verifyUrl}\r\n\r\nThanks for using New Albums via Email.`,
		html: renderAlertEmail({
			heading: 'Verify your email',
			bodyParagraphs: [
				{
					htmlText:
						'Hello, please click the button below to verify your email address. This is required before you can receive new album emails:',
				},
				{ htmlText: 'Verify', buttonUrl: verifyUrl },
				{ htmlText: 'Thanks for using New Albums via Email.' },
			],
		}),
		to: [{ address: subscriber.emailAddress }],
	};

	return sendEmail(message);
}

/** Port of SubscriptionController.SendNotificationEmail (new subscriber -> site admin) */
export async function sendNewSubscriberNotification(
	subscriberEmailAddress: string,
	artistsCount: number,
): Promise<string | null> {
	const { adminEmailAddress } = getAppConfig();
	if (!adminEmailAddress) {
		//Not sending new subscriber notification email, no AdminEmailAddress configured
		return null;
	}

	const { adminFullName } = getAppConfig();

	const message: EmailMessage = {
		subject: 'New subscriber to New Albums via Email',
		text: `New subscriber: ${subscriberEmailAddress}, subscribed to: ${artistsCount} artists`,
		to: [{ address: adminEmailAddress, displayName: adminFullName }],
	};

	return sendEmail(message);
}

import { sendEmail, type EmailMessage } from '../mailgun';
import { getAppConfig } from '../config';
import { renderAlertEmail } from './template';

/**
 * The emails the front-end sends. (The daily new-album notification emails
 * stay on the NAS.)
 */

/**
 * The magic-link sign-in email (replaces the old verify-email email): the
 * emailed link is both the email verification and the 24h sign-in for the
 * artist picker.
 */
export async function sendMagicLinkEmail(subscriber: {
	emailAddress: string;
	magicLinkUrl: string;
}): Promise<string | null> {
	const message: EmailMessage = {
		subject: 'Your sign-in link',
		text:
			'Hello, please click the link below to continue choosing your artists. The link verifies your email address and keeps you signed in for 24 hours:' +
			`\r\n\r\n${subscriber.magicLinkUrl}\r\n\r\nThanks for using New Albums via Email.`,
		html: renderAlertEmail({
			heading: 'Your sign-in link',
			bodyParagraphs: [
				{
					htmlText:
						'Hello, please click the button below to continue choosing your artists. The link verifies your email address and keeps you signed in for 24 hours:',
				},
				{ htmlText: 'Continue', buttonUrl: subscriber.magicLinkUrl },
				{ htmlText: 'Thanks for using New Albums via Email.' },
			],
		}),
		to: [{ address: subscriber.emailAddress }],
	};

	return sendEmail(message);
}

/** Port of SubscriptionController.SendNotificationEmail (new subscriber -> site admin).
 * Sent when a brand-new subscriber requests their first magic link. */
export async function sendNewSubscriberNotification(
	subscriberEmailAddress: string,
): Promise<string | null> {
	const { adminEmailAddress } = getAppConfig();
	if (!adminEmailAddress) {
		//Not sending new subscriber notification email, no AdminEmailAddress configured
		return null;
	}

	const { adminFullName } = getAppConfig();

	const message: EmailMessage = {
		subject: 'New subscriber to New Albums via Email',
		text: `New subscriber: ${subscriberEmailAddress}`,
		to: [{ address: adminEmailAddress, displayName: adminFullName }],
	};

	return sendEmail(message);
}

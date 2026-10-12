import { env } from 'cloudflare:workers';

/** Mirrors the .NET EmailMessage/EmailAddress DTOs */
export interface EmailAddress {
	address: string;
	displayName?: string;
}

export interface EmailMessage {
	subject: string;
	text?: string;
	html?: string;
	to: EmailAddress[];
	from?: EmailAddress;
	replyTo?: EmailAddress;
}

function formatAddress(a: EmailAddress): string {
	return a.displayName ? `${a.displayName} <${a.address}>` : a.address;
}

/**
 * Local-dev safety net, enforced at the very bottom of the email call
 * hierarchy (inside sendEmail, so no caller can bypass it): when
 * LOCAL_DEV_EMAIL_ADDRESS is set (.dev.vars only - it is never set on a
 * deployed Worker), every email is redirected to that address instead of its
 * real recipients, with the original recipients recorded in the subject so
 * the intended destination is still visible while testing.
 */
export function redirectForLocalDev(
	email: EmailMessage,
	localDevAddress: string | null | undefined,
): EmailMessage {
	if (!localDevAddress) return email;

	const originalRecipients = email.to.map((to) => to.address).join(', ');
	return {
		...email,
		to: [{ address: localDevAddress }],
		subject: `${email.subject} [local dev - originally for: ${originalRecipients}]`,
	};
}

/**
 * Port of EmailManager.SendMailgunEmail: retries sending up to 3 times if an
 * error is encountered. Returns null if successful, otherwise the error text.
 * All sends pass through redirectForLocalDev first (see above).
 */
export async function sendEmail(email: EmailMessage): Promise<string | null> {
	//Enforced here so no caller can email a real recipient from local dev
	email = redirectForLocalDev(email, env.LOCAL_DEV_EMAIL_ADDRESS);

	const apiKey = env.MAILGUN_API_KEY;
	const apiUrl = env.MAILGUN_API_URL;
	const domain = env.MAILGUN_DOMAIN;

	if (!apiKey || !apiUrl || !domain) {
		return 'Mailgun not configured, cannot send email.';
	}

	const from = email.from ?? {
		address: env.SYSTEM_EMAIL_ADDRESS,
		displayName: env.APP_NAME,
	};

	const body = new URLSearchParams();
	body.set('from', formatAddress(from));
	for (const to of email.to) {
		body.append('to', formatAddress(to));
	}
	body.set('subject', email.subject);
	if (email.text) body.set('text', email.text);
	if (email.html) body.set('html', email.html);
	if (email.replyTo) body.set('h:Reply-To', email.replyTo.address);

	let error: string | null = 'Mailgun not configured, cannot send email.';

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const response = await fetch(`${apiUrl}${domain}/messages`, {
				method: 'POST',
				headers: {
					Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: body.toString(),
			});

			if (response.ok) {
				return null;
			}

			error = `Mailgun returned error status code: ${response.status}`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	return error;
}

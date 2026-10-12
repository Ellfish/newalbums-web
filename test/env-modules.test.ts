import { describe, expect, it } from 'vitest';
import { isAdminAuthorized } from '../src/lib/admin-auth';
import { getAppConfig } from '../src/lib/config';
import { sendEmail, redirectForLocalDev } from '../src/lib/mailgun';
import type { EmailMessage } from '../src/lib/mailgun';
import { renderAlertEmail } from '../src/lib/emails/template';

describe('admin auth', () => {
	it('authorises the correct token only', async () => {
		const authorized = new Request('https://example.com/api/admin/ping', {
			headers: { 'x-admin-token': 'test-admin-token' },
		});
		const wrongToken = new Request('https://example.com/api/admin/ping', {
			headers: { 'x-admin-token': 'wrong-token' },
		});
		const noToken = new Request('https://example.com/api/admin/ping');

		expect(await isAdminAuthorized(authorized)).toBe(true);
		expect(await isAdminAuthorized(wrongToken)).toBe(false);
		expect(await isAdminAuthorized(noToken)).toBe(false);
	});
});

describe('mailgun', () => {
	it('returns the not-configured error without a MAILGUN_API_KEY (and never sends)', async () => {
		const error = await sendEmail({
			subject: 'Test',
			text: 'body',
			to: [{ address: 'to@example.com' }],
		});

		expect(error).toBe('Mailgun not configured, cannot send email.');
	});
});

describe('mailgun local-dev redirect (the sendEmail safety net)', () => {
	it('returns the message unchanged when no LOCAL_DEV_EMAIL_ADDRESS is set', () => {
		const email: EmailMessage = { subject: 'Hello', to: [{ address: 'fan@example.com' }] };

		expect(redirectForLocalDev(email, undefined)).toBe(email);
		expect(redirectForLocalDev(email, null)).toBe(email);
		expect(redirectForLocalDev(email, '')).toBe(email);
	});

	it('redirects to the local address and records the original recipients in the subject', () => {
		const email: EmailMessage = {
			subject: 'Your sign-in link',
			text: 'body',
			to: [
				{ address: 'fan@example.com', displayName: 'Fan' },
				{ address: 'other@example.com' },
			],
		};

		const redirected = redirectForLocalDev(email, 'dev@example.com');

		//The single redirect target replaces every recipient
		expect(redirected.to).toEqual([{ address: 'dev@example.com' }]);
		expect(redirected.subject).toBe(
			'Your sign-in link [local dev - originally for: fan@example.com, other@example.com]',
		);
		//Body content is untouched
		expect(redirected.text).toBe('body');
	});
});

describe('config + email template', () => {
	it('trims the trailing slash from FRONTEND_ROOT_URL, like the .NET TrimEnd', () => {
		// The test bindings set FRONTEND_ROOT_URL with a trailing slash
		expect(getAppConfig().frontendRootUrl).toBe('https://newalbums-web-staging.ellfish.workers.dev');
	});

	it('renders the Alert email with heading, button, footer and branding', () => {
		const html = renderAlertEmail({
			heading: 'Verify your email',
			bodyParagraphs: [
				{ htmlText: 'Hello, please click the button below:' },
				{ htmlText: 'Verify', buttonUrl: 'https://example.com/verify-email?verifyCode=abc' },
			],
		});

		expect(html).toContain('<title>Verify your email</title>');
		expect(html).toContain('Verify your email');
		expect(html).toContain('href="https://example.com/verify-email?verifyCode=abc"');
		//Primary colour (ported from the old appsettings Style section)
		expect(html).toContain('#6247aa');
		//Branding uses the trimmed root URL
		expect(html).toContain('https://newalbums-web-staging.ellfish.workers.dev/images/icon.png');
		expect(html).toContain('https://newalbums-web-staging.ellfish.workers.dev/images/spotify-logo-white.png');
		expect(html).toContain('Artist and album content including cover art supplied by:');
	});
});

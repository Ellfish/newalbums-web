import { describe, expect, it } from 'vitest';
import { isAdminAuthorized } from '../src/lib/admin-auth';
import { getAppConfig } from '../src/lib/config';
import { sendEmail } from '../src/lib/mailgun';
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

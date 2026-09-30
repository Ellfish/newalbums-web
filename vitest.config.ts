import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			// Reuses the DB binding (as a local miniflare D1) and the vars from
			// wrangler.jsonc
			wrangler: { configPath: './wrangler.jsonc' },
			// Test overrides, which take precedence over the Wrangler config
			miniflare: {
				bindings: {
					ADMIN_TOKEN: 'test-admin-token',
					// Trailing slash on purpose: exercises the TrimEnd('/')
					// behaviour ported from the .NET config
					FRONTEND_ROOT_URL: 'https://newalbums-web-staging.ellfish.workers.dev/',
					// Deliberately NO MAILGUN_API_KEY: sendEmail() must return its
					// not-configured error in tests, and never send anything
				},
			},
		}),
	],
	test: {
		include: ['test/**/*.test.ts'],
	},
});

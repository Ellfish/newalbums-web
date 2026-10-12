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
					// Fake Spotify credentials (the real ones only ever live in
					// .dev.vars / wrangler secrets): every fetch in the tests
					// is mocked anyway
					SPOTIFY_CLIENT_ID: 'test-client-id',
					SPOTIFY_CLIENT_SECRET: 'test-client-secret',
					// Deliberately empty: tests must NEVER send real email or
					// redirect, no matter what the developer's .dev.vars
					// contains (these overrides take precedence over it, like
					// the Spotify ones above). The local-dev redirect logic
					// itself is tested purely via redirectForLocalDev.
					MAILGUN_API_KEY: '',
					LOCAL_DEV_EMAIL_ADDRESS: '',
				},
			},
		}),
	],
	test: {
		include: ['test/**/*.test.ts'],
	},
});

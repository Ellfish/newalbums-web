/**
 * Secrets set via `wrangler secret put` aren't in wrangler.jsonc (or .dev.vars,
 * for local dev) when types are generated, so declare them here. The generated
 * worker-configuration.d.ts types env from both the global `Env` interface and
 * the namespaced `Cloudflare.Env`, so augment both.
 */
declare global {
	interface Env {
		/** Set via `wrangler secret put MAILGUN_API_KEY` */
		MAILGUN_API_KEY?: string;
	}

	namespace Cloudflare {
		interface Env {
			/** Set via `wrangler secret put MAILGUN_API_KEY` */
			MAILGUN_API_KEY?: string;
		}
	}
}

export {};

import { env } from 'cloudflare:workers';

/**
 * Non-secret app configuration, from wrangler.jsonc vars.
 * Read lazily (not at module scope) because module-level env access isn't guaranteed.
 */
export function getAppConfig() {
	return {
		appName: env.APP_NAME,
		/** FrontEndRootUrl with any trailing slash removed, like the .NET code's TrimEnd('/') */
		frontendRootUrl: (env.FRONTEND_ROOT_URL ?? '').replace(/\/+$/, ''),
		systemEmailAddress: env.SYSTEM_EMAIL_ADDRESS,
		adminEmailAddress: env.ADMIN_EMAIL_ADDRESS,
		adminFullName: env.ADMIN_FULL_NAME,
	};
}

/** Style constants, ported from the old appsettings "Style" section */
export const styleConfig = {
	primaryColour: '#6247aa',
	textColourOnPrimary: '#ffffff',
	backgroundColour: '#232323',
};

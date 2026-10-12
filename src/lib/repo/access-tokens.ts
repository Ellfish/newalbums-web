import { first, run } from '../db';
import type { SubscriberRow } from './subscribers';

/**
 * The 24h access tokens carried by the magic-link sign-in emails. Requesting
 * a link creates (rotates to) a single live token per subscriber; clicking the
 * link validates the token AND marks the email verified - the link IS the
 * verification. Lives in NaAccessTokens, which is web-app-only (not part of
 * the NAS-mirrored schema).
 */

/** How long a magic link keeps working after it's sent */
export const ACCESS_TOKEN_TTL_HOURS = 24;

export const ACCESS_TOKEN_INVALID_MESSAGE =
	'Your sign-in link has expired or is invalid. Please enter your email address to get a new one.';

export interface AccessTokenRow {
	Id: number;
	CreatedDate: string;
	SubscriberId: number;
	Token: string;
	ExpiresDate: string;
}

/** 32 random bytes -> 64 hex chars: the token is a credential in a URL, so keep the entropy high */
function generateToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Creates a fresh access token for a subscriber (24h). Requesting a new link
 * rotates the token, so at most one live link exists per subscriber (old
 * links stop working). Expired tokens for everyone are purged opportunistically
 * while we're already writing.
 */
export async function createAccessToken(db: D1Database, subscriberId: number): Promise<AccessTokenRow> {
	const nowIso = new Date().toISOString();

	await run(db, 'DELETE FROM NaAccessTokens WHERE ExpiresDate <= ?', nowIso);
	await run(db, 'DELETE FROM NaAccessTokens WHERE SubscriberId = ?', subscriberId);

	const createdDate = nowIso;
	const expiresDate = new Date(
		Date.now() + ACCESS_TOKEN_TTL_HOURS * 60 * 60 * 1000,
	).toISOString();
	const token = generateToken();

	const result = await run(
		db,
		'INSERT INTO NaAccessTokens (CreatedDate, SubscriberId, Token, ExpiresDate) VALUES (?, ?, ?, ?)',
		createdDate,
		subscriberId,
		token,
		expiresDate,
	);

	return {
		Id: result.meta.last_row_id,
		CreatedDate: createdDate,
		SubscriberId: subscriberId,
		Token: token,
		ExpiresDate: expiresDate,
	};
}

/** The subscriber owning a still-valid token, or null (unknown, expired or rotated away) */
export async function getSubscriberByAccessToken(
	db: D1Database,
	token: string,
): Promise<SubscriberRow | null> {
	//ISO 8601 strings compare chronologically as strings (all values are JS toISOString())
	return first<SubscriberRow>(
		db,
		`SELECT s.*
		FROM NaSubscribers s
		JOIN NaAccessTokens t ON t.SubscriberId = s.Id
		WHERE t.Token = ? AND t.ExpiresDate > ?`,
		token,
		new Date().toISOString(),
	);
}

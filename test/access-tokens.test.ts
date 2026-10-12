import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchema, getDb, resetDb } from './db';
import { getOrCreateSubscriber, getSubscriberByEmail, setEmailVerified } from '../src/lib/repo/subscribers';
import {
	ACCESS_TOKEN_TTL_HOURS,
	createAccessToken,
	getSubscriberByAccessToken,
} from '../src/lib/repo/access-tokens';

beforeAll(async () => {
	await applySchema();
});

beforeEach(async () => {
	await resetDb();
});

async function seedSubscriber(email = 'someone@example.com') {
	const { subscriber } = await getOrCreateSubscriber(getDb(), email, false);
	return subscriber;
}

async function countTokenRows(subscriberId?: number): Promise<number> {
	const db = getDb();
	const row = subscriberId
		? await db
				.prepare('SELECT COUNT(*) AS Count FROM NaAccessTokens WHERE SubscriberId = ?')
				.bind(subscriberId)
				.first<{ Count: number }>()
		: await db.prepare('SELECT COUNT(*) AS Count FROM NaAccessTokens').first<{ Count: number }>();
	return row?.Count ?? 0;
}

describe('createAccessToken', () => {
	it('creates a 64-hex-char token valid for 24 hours, owned by the subscriber', async () => {
		const subscriber = await seedSubscriber();
		const token = await createAccessToken(getDb(), subscriber.Id);

		expect(token.Token).toMatch(/^[0-9a-f]{64}$/);
		expect(token.SubscriberId).toBe(subscriber.Id);

		const now = Date.now();
		const expiresAt = new Date(token.ExpiresDate).getTime();
		expect(expiresAt).toBeGreaterThan(now + (ACCESS_TOKEN_TTL_HOURS - 1) * 60 * 60 * 1000);
		expect(expiresAt).toBeLessThan(now + (ACCESS_TOKEN_TTL_HOURS + 1) * 60 * 60 * 1000);

		const found = await getSubscriberByAccessToken(getDb(), token.Token);
		expect(found?.Id).toBe(subscriber.Id);
	});

	it('rotates: requesting a new link invalidates the previous one (one live link per subscriber)', async () => {
		const subscriber = await seedSubscriber();
		const first = await createAccessToken(getDb(), subscriber.Id);
		const second = await createAccessToken(getDb(), subscriber.Id);

		expect(await getSubscriberByAccessToken(getDb(), first.Token)).toBeNull();
		expect((await getSubscriberByAccessToken(getDb(), second.Token))?.Id).toBe(subscriber.Id);
		expect(await countTokenRows(subscriber.Id)).toBe(1);
	});

	it('purges expired tokens (any subscriber) while writing', async () => {
		const subscriber = await seedSubscriber();
		const other = await seedSubscriber('other@example.com');

		//An already-expired token row for another subscriber
		await getDb()
			.prepare('INSERT INTO NaAccessTokens (CreatedDate, SubscriberId, Token, ExpiresDate) VALUES (?, ?, ?, ?)')
			.bind(
				new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
				other.Id,
				'0'.repeat(64),
				new Date(Date.now() - 60 * 1000).toISOString(),
			)
			.run();

		await createAccessToken(getDb(), subscriber.Id);

		//Only the fresh token row remains
		expect(await countTokenRows()).toBe(1);
	});
});

describe('getSubscriberByAccessToken', () => {
	it('returns null for an unknown token', async () => {
		await seedSubscriber();
		expect(await getSubscriberByAccessToken(getDb(), 'x'.repeat(64))).toBeNull();
	});

	it('returns null once the token has expired', async () => {
		const subscriber = await seedSubscriber();
		await getDb()
			.prepare('INSERT INTO NaAccessTokens (CreatedDate, SubscriberId, Token, ExpiresDate) VALUES (?, ?, ?, ?)')
			.bind(new Date().toISOString(), subscriber.Id, 'a'.repeat(64), new Date(Date.now() - 1000).toISOString())
			.run();

		expect(await getSubscriberByAccessToken(getDb(), 'a'.repeat(64))).toBeNull();
	});
});

describe('the magic-link flow (the repo steps /api/auth/validate performs)', () => {
	it('a valid token resolves its subscriber, and the link click marks them verified', async () => {
		const subscriber = await seedSubscriber();
		const token = await createAccessToken(getDb(), subscriber.Id);

		const found = await getSubscriberByAccessToken(getDb(), token.Token);
		expect(found?.Id).toBe(subscriber.Id);

		//Clicking the link IS the verification (idempotent)
		await setEmailVerified(getDb(), found!.Id);

		const refreshed = await getSubscriberByEmail(getDb(), subscriber.EmailAddress);
		expect(refreshed?.EmailAddressVerified).toBe(1);
	});
});

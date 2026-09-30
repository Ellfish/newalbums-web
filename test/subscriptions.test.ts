import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchema, getDb, resetDb } from './db';
import { getOrCreateSubscriber, getSubscriberByEmail } from '../src/lib/repo/subscribers';
import { getOrCreateArtists } from '../src/lib/repo/artists';
import {
	countSubscriptions,
	getSubscriptionsForArtist,
	getSubscribeStatusMessage,
	MAX_PER_SUBSCRIBER,
	subscribeToArtists,
	unsubscribeFromAll,
	unsubscribeFromArtist,
} from '../src/lib/repo/subscriptions';

beforeAll(async () => {
	await applySchema();
});

beforeEach(async () => {
	await resetDb();
});

async function seedSubscriberAndArtists() {
	const { subscriber } = await getOrCreateSubscriber(getDb(), 'someone@example.com', true);
	const artists = await getOrCreateArtists(getDb(), [
		{ spotifyId: 'a1', name: 'One' },
		{ spotifyId: 'a2', name: 'Two' },
		{ spotifyId: 'a3', name: 'Three' },
	]);
	return { subscriber, artists };
}

describe('subscribeToArtists', () => {
	it('counts new and existing subscriptions on re-subscribe (the status message inputs)', async () => {
		const { subscriber, artists } = await seedSubscriberAndArtists();
		const ids = artists.map((artist) => artist.Id);

		const first = await subscribeToArtists(getDb(), subscriber.Id, [ids[0]!, ids[1]!]);
		expect(first).toEqual({ existingSubscriptionsCount: 0, newSubscriptionsCount: 2, limitReached: false });

		//Re-subscribe with one existing and one new artist
		const second = await subscribeToArtists(getDb(), subscriber.Id, [ids[0]!, ids[2]!]);
		expect(second).toEqual({ existingSubscriptionsCount: 2, newSubscriptionsCount: 1, limitReached: false });

		expect(await countSubscriptions(getDb())).toBe(3);
	});

	it(`stops at the MaxPerSubscriber cap of ${MAX_PER_SUBSCRIBER}`, async () => {
		const db = getDb();
		const { subscriber } = await getOrCreateSubscriber(db, 'capped@example.com', true);

		//Seed 1999 existing subscriptions (artist rows are not required at the repo level)
		await db.batch(
			Array.from({ length: 1999 }, (_, i) =>
				db
					.prepare('INSERT INTO NaSubscriptions (CreatedDate, SubscriberId, ArtistId) VALUES (?, ?, ?)')
					.bind(new Date().toISOString(), subscriber.Id, i + 1),
			),
		);

		//Try to subscribe to 5 more: only one more fits
		const result = await subscribeToArtists(db, subscriber.Id, [2000, 2001, 2002, 2003, 2004]);

		expect(result.existingSubscriptionsCount).toBe(1999);
		expect(result.newSubscriptionsCount).toBe(1);
		expect(result.limitReached).toBe(true);
		expect(await countSubscriptions(db)).toBe(MAX_PER_SUBSCRIBER);
	});
});

describe('getSubscribeStatusMessage', () => {
	it('reproduces the .NET wording exactly', () => {
		expect(getSubscribeStatusMessage(0, 1, false)).toBe('Subscribed to 1 new artist. ');
		expect(getSubscribeStatusMessage(0, 2, false)).toBe('Subscribed to 2 new artists. ');
		expect(getSubscribeStatusMessage(1, 1, false)).toBe(
			'Subscribed to 1 new artist. You have existing subscriptions to 1 artist. ',
		);
		expect(getSubscribeStatusMessage(3, 0, true)).toBe(
			'Subscribed to 0 new artists. You have existing subscriptions to 3 artists. ' +
				`You've now reached the limit of ${MAX_PER_SUBSCRIBER} artist subscriptions, and can't subscribe to any more (sorry).`,
		);
	});
});

describe('getSubscriptionsForArtist (enriched)', () => {
	it('returns subscriber email, verified flag and unsubscribe token inline', async () => {
		const db = getDb();
		const unverified = await getOrCreateSubscriber(db, 'unverified@example.com', false);
		const verified = await getOrCreateSubscriber(db, 'verified@example.com', true);
		const [artist] = await getOrCreateArtists(db, [{ spotifyId: 'a1', name: 'One' }]);

		await subscribeToArtists(db, unverified.subscriber.Id, [artist!.Id]);
		await subscribeToArtists(db, verified.subscriber.Id, [artist!.Id]);

		const subscriptions = await getSubscriptionsForArtist(db, artist!.Id);
		expect(subscriptions).toHaveLength(2);

		const byEmail = Object.fromEntries(
			subscriptions.map((subscription) => [subscription.subscriber.emailAddress, subscription.subscriber]),
		);

		expect(byEmail['unverified@example.com']!.emailAddressVerified).toBe(false);
		expect(byEmail['verified@example.com']!.emailAddressVerified).toBe(true);
		expect(byEmail['verified@example.com']!.unsubscribeToken).toBe(verified.subscriber.UnsubscribeToken);
		expect(subscriptions.every((subscription) => subscription.artistId === artist!.Id)).toBe(true);
	});
});

describe('unsubscribe', () => {
	it('unsubscribes from one artist only, and reports not-found on repeat', async () => {
		const { subscriber, artists } = await seedSubscriberAndArtists();
		const ids = artists.map((artist) => artist.Id);

		await subscribeToArtists(getDb(), subscriber.Id, ids);

		expect(await unsubscribeFromArtist(getDb(), subscriber.UnsubscribeToken, ids[0]!)).toBe(true);
		expect(await countSubscriptions(getDb())).toBe(2);

		//Already unsubscribed from that artist
		expect(await unsubscribeFromArtist(getDb(), subscriber.UnsubscribeToken, ids[0]!)).toBe(false);

		//A different subscriber's token must not affect this subscriber
		const other = await getOrCreateSubscriber(getDb(), 'other@example.com', true);
		expect(await unsubscribeFromArtist(getDb(), other.subscriber.UnsubscribeToken, ids[1]!)).toBe(false);
		expect(await countSubscriptions(getDb())).toBe(2);
	});

	it('unsubscribes from all artists and deletes the subscriber', async () => {
		const { subscriber, artists } = await seedSubscriberAndArtists();
		await subscribeToArtists(getDb(), subscriber.Id, artists.map((artist) => artist.Id));

		expect(await unsubscribeFromAll(getDb(), subscriber.UnsubscribeToken)).toBe(true);

		expect(await getSubscriberByEmail(getDb(), subscriber.EmailAddress)).toBeNull();
		expect(await countSubscriptions(getDb())).toBe(0);

		//Unknown token
		expect(await unsubscribeFromAll(getDb(), 'not-a-real-token')).toBe(false);
	});
});

import { all, first, run } from '../db';
import { getSubscriberByToken } from './subscribers';

/** Ported from Subscription.MaxPerSubscriber */
export const MAX_PER_SUBSCRIBER = 2000;

export async function countSubscriptions(db: D1Database): Promise<number> {
	const row = await first<{ Count: number }>(db, 'SELECT COUNT(*) AS Count FROM NaSubscriptions');
	return row?.Count ?? 0;
}

/** Ported from SubscriptionAppService.SubscribeToArtists, including the MaxPerSubscriber cap */
export async function subscribeToArtists(
	db: D1Database,
	subscriberId: number,
	artistIds: number[],
): Promise<{ existingSubscriptionsCount: number; newSubscriptionsCount: number; limitReached: boolean }> {
	const existing = await all<{ ArtistId: number }>(
		db,
		'SELECT ArtistId FROM NaSubscriptions WHERE SubscriberId = ?',
		subscriberId,
	);
	const existingIds = new Set(existing.map((row) => row.ArtistId));
	const existingSubscriptionsCount = existingIds.size;

	let count = existingSubscriptionsCount;
	let limitReached = count >= MAX_PER_SUBSCRIBER;

	if (!limitReached) {
		const toInsert: D1PreparedStatement[] = [];
		for (const artistId of artistIds) {
			if (!existingIds.has(artistId)) {
				toInsert.push(
					db
						.prepare('INSERT INTO NaSubscriptions (CreatedDate, SubscriberId, ArtistId) VALUES (?, ?, ?)')
						.bind(new Date().toISOString(), subscriberId, artistId),
				);
				count++;
				if (count >= MAX_PER_SUBSCRIBER) {
					//Reached the maximum limit, don't create any more subscriptions for this Subscriber
					limitReached = true;
					break;
				}
			}
		}
		if (toInsert.length > 0) {
			await db.batch(toInsert);
		}
	}

	return {
		existingSubscriptionsCount,
		newSubscriptionsCount: count - existingSubscriptionsCount,
		limitReached,
	};
}

export interface ArtistSubscription {
	artistId: number;
	subscriber: {
		emailAddress: string;
		emailAddressVerified: boolean;
		unsubscribeToken: string;
	};
}

/**
 * Enriched port of SubscriptionAppService.GetSubscriptionsForArtist: the .NET
 * version returned bare subscriptions and NotifySubscribers re-queried each
 * subscriber by Id (N+1). This flattened version returns everything the NAS
 * job needs to notify in one response.
 */
export async function getSubscriptionsForArtist(db: D1Database, artistId: number): Promise<ArtistSubscription[]> {
	const rows = await all<{
		ArtistId: number;
		EmailAddress: string;
		EmailAddressVerified: number;
		UnsubscribeToken: string;
	}>(
		db,
		`SELECT s.ArtistId, sub.EmailAddress, sub.EmailAddressVerified, sub.UnsubscribeToken
		FROM NaSubscriptions s
		JOIN NaSubscribers sub ON sub.Id = s.SubscriberId
		WHERE s.ArtistId = ?`,
		artistId,
	);

	return rows.map((row) => ({
		artistId: row.ArtistId,
		subscriber: {
			emailAddress: row.EmailAddress,
			emailAddressVerified: row.EmailAddressVerified === 1,
			unsubscribeToken: row.UnsubscribeToken,
		},
	}));
}

export const SUBSCRIPTION_NOT_FOUND_ERROR =
	"Subscription not found. Either you've already unsubscribed, or the URL that got you here wasn't quite right.";

/** Ported from SubscriptionAppService.UnsubscribeFromArtist */
export async function unsubscribeFromArtist(
	db: D1Database,
	unsubscribeToken: string,
	artistId: number,
): Promise<boolean> {
	const result = await run(
		db,
		`DELETE FROM NaSubscriptions
		WHERE ArtistId = ?
		AND SubscriberId = (SELECT Id FROM NaSubscribers WHERE UnsubscribeToken = ?)`,
		artistId,
		unsubscribeToken,
	);

	return (result.meta.changes ?? 0) > 0;
}

/** Ported from SubscriptionAppService.UnsubscribeFromAll (batched: don't rely on FK cascade) */
export async function unsubscribeFromAll(db: D1Database, unsubscribeToken: string): Promise<boolean> {
	const subscriber = await getSubscriberByToken(db, unsubscribeToken);
	if (!subscriber) return false;

	await db.batch([
		db.prepare('DELETE FROM NaSubscriptions WHERE SubscriberId = ?').bind(subscriber.Id),
		db.prepare('DELETE FROM NaSubscribers WHERE Id = ?').bind(subscriber.Id),
	]);

	return true;
}

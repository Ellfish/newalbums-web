import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchema, getDb, resetDb } from './db';
import {
	checkEmailVerification,
	getOrCreateSubscriber,
	getSubscriberByEmail,
	setEmailVerified,
} from '../src/lib/repo/subscribers';
import { getAllArtistsWithAlbums, getOrCreateArtists } from '../src/lib/repo/artists';
import { countAlbums, createAlbums } from '../src/lib/repo/albums';

beforeAll(async () => {
	await applySchema();
});

beforeEach(async () => {
	await resetDb();
});

describe('subscribers', () => {
	it('creates a subscriber with a normalised email, verify code and unsubscribe token', async () => {
		const { subscriber, createdNewSubscriber } = await getOrCreateSubscriber(
			getDb(),
			'  MixedCase@Example.COM ',
			false,
		);

		expect(createdNewSubscriber).toBe(true);
		expect(subscriber.EmailAddress).toBe('mixedcase@example.com');
		expect(subscriber.EmailAddressVerified).toBe(0);
		// Same format as the .NET code: GUID "N" truncated to 16 lowercase hex chars
		expect(subscriber.EmailVerifyCode).toMatch(/^[0-9a-f]{16}$/);
		expect(subscriber.UnsubscribeToken).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it('returns the existing subscriber without creating a duplicate', async () => {
		const first = await getOrCreateSubscriber(getDb(), 'someone@example.com', false);
		const second = await getOrCreateSubscriber(getDb(), 'SOMEONE@example.com', true);

		expect(second.createdNewSubscriber).toBe(false);
		expect(second.subscriber.Id).toBe(first.subscriber.Id);

		const byEmail = await getSubscriberByEmail(getDb(), 'someone@example.com');
		expect(byEmail?.Id).toBe(first.subscriber.Id);
	});

	it('creates verified subscribers without a verify code', async () => {
		const { subscriber } = await getOrCreateSubscriber(getDb(), 'verified@example.com', true);

		expect(subscriber.EmailAddressVerified).toBe(1);
		expect(subscriber.EmailVerifyCode).toBeNull();
	});

	it('checks email verification with the exact .NET messages', async () => {
		const { subscriber } = await getOrCreateSubscriber(getDb(), 'someone@example.com', false);

		const wrong = await checkEmailVerification(getDb(), 'someone@example.com', 'wrongcode1234567');
		expect('errorMessage' in wrong && wrong.errorMessage).toBe('Invalid email verification code.');

		const right = await checkEmailVerification(getDb(), 'someone@example.com', subscriber.EmailVerifyCode!);
		expect('subscriber' in right && right.subscriber.Id).toBe(subscriber.Id);

		await setEmailVerified(getDb(), subscriber.Id);

		const again = await checkEmailVerification(getDb(), 'someone@example.com', subscriber.EmailVerifyCode!);
		expect('errorMessage' in again && again.errorMessage).toBe(
			"You've already verified your email address.",
		);
	});
});

describe('artists', () => {
	it('get-or-creates artists by SpotifyId', async () => {
		const first = await getOrCreateArtists(getDb(), [{ spotifyId: 'artist1', name: 'Artist One' }]);
		const second = await getOrCreateArtists(getDb(), [
			{ spotifyId: 'artist1', name: 'Artist One' },
			{ spotifyId: 'artist2', name: 'Artist Two' },
		]);

		expect(second.map((artist) => artist.Id)).toContain(first[0]!.Id);
		expect(second.map((artist) => artist.SpotifyId).sort()).toEqual(['artist1', 'artist2']);
	});

	it('returns all artists grouped with their albums', async () => {
		const artists = await getOrCreateArtists(getDb(), [
			{ spotifyId: 'a1', name: 'Has Albums' },
			{ spotifyId: 'a2', name: 'No Albums' },
		]);

		await createAlbums(getDb(), artists[0]!.Id, [
			{ spotifyId: 'al1', name: 'Album One', releaseDate: '2026-09-01' },
			{ spotifyId: 'al2', name: 'Album Two', releaseDate: '2026-09-10' },
		]);

		const all = await getAllArtistsWithAlbums(getDb());
		expect(all).toHaveLength(2);

		const has = all.find((artist) => artist.spotifyId === 'a1')!;
		expect(has.albums.map((album) => album.spotifyId).sort()).toEqual(['al1', 'al2']);
		expect(has.albums[0]).toEqual({ spotifyId: 'al1', name: 'Album One', releaseDate: '2026-09-01' });

		expect(all.find((artist) => artist.spotifyId === 'a2')!.albums).toEqual([]);
	});
});

describe('albums', () => {
	it('is idempotent: re-running the daily job does not duplicate albums or links', async () => {
		const [artist] = await getOrCreateArtists(getDb(), [{ spotifyId: 'a1', name: 'Artist' }]);
		const albums = [{ spotifyId: 'al1', name: 'Album', releaseDate: '2026-09-01' }];

		await createAlbums(getDb(), artist!.Id, albums);
		await createAlbums(getDb(), artist!.Id, albums);

		expect(await countAlbums(getDb())).toBe(1);
		const all = await getAllArtistsWithAlbums(getDb());
		expect(all[0]!.albums).toHaveLength(1);
	});

	it('links an existing album to another artist without duplicating the album row', async () => {
		const [a1, a2] = await getOrCreateArtists(getDb(), [
			{ spotifyId: 'a1', name: 'One' },
			{ spotifyId: 'a2', name: 'Two' },
		]);
		const album = [{ spotifyId: 'shared1', name: 'Shared Album', releaseDate: '2026-09-01' }];

		await createAlbums(getDb(), a1!.Id, album);
		await createAlbums(getDb(), a2!.Id, album);

		//One album row, listed for both artists
		expect(await countAlbums(getDb())).toBe(1);
		const all = await getAllArtistsWithAlbums(getDb());
		expect(all[0]!.albums).toHaveLength(1);
		expect(all[1]!.albums).toHaveLength(1);
		expect(all[0]!.albums[0]!.spotifyId).toBe('shared1');
	});
});

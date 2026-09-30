import { first, run } from '../db';

/** Mirrors the Subscriber entity / NaSubscribers table (EF Core column names) */
export interface SubscriberRow {
	Id: number;
	CreatedDate: string;
	EmailAddress: string;
	EmailAddressVerified: number;
	EmailVerifyCode: string | null;
	UnsubscribeToken: string;
}

/** Ported from StringUtils.NormaliseEmailAddress */
export function normaliseEmailAddress(emailAddress: string): string {
	return emailAddress.trim().toLowerCase();
}

/** New verify codes match the .NET format: GUID "N" (32 lowercase hex chars) truncated to 16 */
function generateEmailVerifyCode(): string {
	return crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

export async function getSubscriberByEmail(db: D1Database, emailAddress: string): Promise<SubscriberRow | null> {
	return first<SubscriberRow>(
		db,
		'SELECT * FROM NaSubscribers WHERE EmailAddress = ?',
		normaliseEmailAddress(emailAddress),
	);
}

export async function getSubscriberByToken(db: D1Database, unsubscribeToken: string): Promise<SubscriberRow | null> {
	return first<SubscriberRow>(db, 'SELECT * FROM NaSubscribers WHERE UnsubscribeToken = ?', unsubscribeToken);
}

export interface GetOrCreateSubscriberResult {
	subscriber: SubscriberRow;
	createdNewSubscriber: boolean;
}

/** Ported from SubscriberAppService.GetOrCreate */
export async function getOrCreateSubscriber(
	db: D1Database,
	emailAddress: string,
	emailAddressVerified: boolean,
): Promise<GetOrCreateSubscriberResult> {
	const subscriber = await getSubscriberByEmail(db, emailAddress);
	if (subscriber) {
		return { subscriber, createdNewSubscriber: false };
	}

	const createdDate = new Date().toISOString();
	const emailVerifyCode = emailAddressVerified ? null : generateEmailVerifyCode();
	// The UnsubscribeToken is a GUID string, generated in the Subscriber constructor in .NET
	const unsubscribeToken = crypto.randomUUID();
	const verified = emailAddressVerified ? 1 : 0;

	const result = await run(
		db,
		'INSERT INTO NaSubscribers (CreatedDate, EmailAddress, EmailAddressVerified, EmailVerifyCode, UnsubscribeToken) VALUES (?, ?, ?, ?, ?)',
		createdDate,
		normaliseEmailAddress(emailAddress),
		verified,
		emailVerifyCode,
		unsubscribeToken,
	);

	return {
		subscriber: {
			Id: result.meta.last_row_id,
			CreatedDate: createdDate,
			EmailAddress: normaliseEmailAddress(emailAddress),
			EmailAddressVerified: verified,
			EmailVerifyCode: emailVerifyCode,
			UnsubscribeToken: unsubscribeToken,
		},
		createdNewSubscriber: true,
	};
}

/** Ported from SubscriberAppService.CheckEmailVerification. Returns a SubscriberRow, or an error message. */
export async function checkEmailVerification(
	db: D1Database,
	emailAddress: string,
	verifyCode: string,
): Promise<{ subscriber: SubscriberRow } | { errorMessage: string }> {
	const subscriber = await first<SubscriberRow>(
		db,
		'SELECT * FROM NaSubscribers WHERE EmailAddress = ? AND EmailVerifyCode = ?',
		normaliseEmailAddress(emailAddress),
		verifyCode,
	);

	if (!subscriber) {
		return { errorMessage: 'Invalid email verification code.' };
	}

	if (subscriber.EmailAddressVerified === 1) {
		return { errorMessage: "You've already verified your email address." };
	}

	return { subscriber };
}

/** Ported from SubscriberAppService.Update (EmailAddressVerified only) */
export async function setEmailVerified(db: D1Database, subscriberId: number): Promise<void> {
	await run(db, 'UPDATE NaSubscribers SET EmailAddressVerified = 1 WHERE Id = ?', subscriberId);
}

export async function countSubscribers(db: D1Database): Promise<number> {
	const row = await first<{ Count: number }>(db, 'SELECT COUNT(*) AS Count FROM NaSubscribers');
	return row?.Count ?? 0;
}

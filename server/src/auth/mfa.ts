/**
 * Authenticator (TOTP) MFA with recovery codes (plan: Security design → MFA).
 *
 * - TOTP per RFC 6238: 30 s steps, ±1 step tolerance. The secret is AES-GCM
 *   encrypted at rest; `lastUsedStep` refuses a code once it has been accepted,
 *   so a shoulder-surfed code cannot be replayed inside its window.
 * - Enrollment is forced: an account without `enrolledAt` lands in the
 *   `mfa_enroll` stage at login and can only reach the enrollment endpoints.
 * - Recovery codes: 10 per enrollment, 10 characters from an unambiguous
 *   alphabet (50 bits), bcrypt-hashed, single use, regenerable with a fresh code.
 */
import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { MfaTotp } from '../db/schema.js';
import { decryptSecret, encryptSecret } from './crypto.js';

export const TOTP_STEP_SECONDS = 30;
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 10;
/** Recovery codes are random and long, so a lower bcrypt cost than passwords keeps a 10-code scan under a second. */
const RECOVERY_CODE_BCRYPT_COST = 10;
/** No 0/O/1/I so the codes survive handwriting. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

authenticator.options = { step: TOTP_STEP_SECONDS, window: 1 };

export type UserKind = 'provider' | 'client';

export function issuer(): string {
  return process.env.MFA_ISSUER || 'DocFlow';
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

export async function getMfa(userKind: UserKind, userId: string): Promise<MfaTotp | null> {
  const [row] = await db
    .select()
    .from(schema.mfaTotp)
    .where(and(eq(schema.mfaTotp.userKind, userKind), eq(schema.mfaTotp.userId, userId)));
  return row ?? null;
}

export function isEnrolled(row: MfaTotp | null): row is MfaTotp & { enrolledAt: Date } {
  return !!row?.enrolledAt;
}

export interface EnrollmentStart {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

/**
 * Creates (or replaces an unconfirmed) pending secret. Returns null when the
 * account is already enrolled — re-enrollment goes through the admin reset (C1.3).
 */
export async function beginEnrollment(userKind: UserKind, userId: string, accountLabel: string): Promise<EnrollmentStart | null> {
  const existing = await getMfa(userKind, userId);
  if (isEnrolled(existing)) return null;

  const secret = authenticator.generateSecret();
  const secretEnc = encryptSecret(secret);
  const now = new Date();
  if (existing) {
    await db
      .update(schema.mfaTotp)
      .set({ secretEnc, lastUsedStep: null, updatedAt: now })
      .where(eq(schema.mfaTotp.id, existing.id));
  } else {
    await db.insert(schema.mfaTotp).values({ userKind, userId, secretEnc, createdAt: now, updatedAt: now });
  }

  const otpauthUrl = authenticator.keyuri(accountLabel, issuer(), secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 192 });
  return { secret, otpauthUrl, qrDataUrl };
}

export type TotpResult = 'ok' | 'invalid' | 'reused';

/**
 * Checks a code against the stored secret and records the accepted step so
 * the same code cannot be used again. `'reused'` is reported as invalid to the
 * caller but kept distinct for tests and logs.
 *
 * **The database decides, not the row** (F2). This used to compare against the
 * `row` the caller had already read and then update by id, which is a
 * check-then-act across two statements: two sign-ins racing on one shoulder-
 * surfed code both read `lastUsedStep = null`, both passed the check, and both
 * got a session. The replay guard held only because nothing ever tried twice at
 * once — `mfa.test.ts` verifies it sequentially, which is why it passed.
 *
 * Now the guard is the WHERE clause of a single conditional UPDATE. Postgres
 * takes a row lock, so the second statement sees the first one's write and
 * matches nothing; `RETURNING` says which caller won. The in-memory pre-check
 * stays as a fast path for the obvious replay, but it decides nothing.
 */
export async function consumeTotp(row: MfaTotp, code: string, now = Date.now()): Promise<TotpResult> {
  const digits = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(digits)) return 'invalid';
  let delta: number | null;
  try {
    delta = authenticator.checkDelta(digits, decryptSecret(row.secretEnc));
  } catch {
    return 'invalid';
  }
  if (delta === null) return 'invalid';
  const step = currentStep(now) + delta;
  if (row.lastUsedStep !== null && step <= row.lastUsedStep) return 'reused';
  const [claimed] = await db
    .update(schema.mfaTotp)
    .set({ lastUsedStep: step, updatedAt: new Date(now) })
    .where(
      and(
        eq(schema.mfaTotp.id, row.id),
        or(isNull(schema.mfaTotp.lastUsedStep), lt(schema.mfaTotp.lastUsedStep, step))
      )
    )
    .returning({ id: schema.mfaTotp.id });
  return claimed ? 'ok' : 'reused';
}

/** Marks the pending secret as enrolled and issues the first recovery codes. */
export async function completeEnrollment(row: MfaTotp, now = new Date()): Promise<string[]> {
  await db.update(schema.mfaTotp).set({ enrolledAt: now, updatedAt: now }).where(eq(schema.mfaTotp.id, row.id));
  return regenerateRecoveryCodes(row.userKind, row.userId, now);
}

function randomRecoveryCode(): string {
  let out = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return out;
}

/** `ABCDE-FGH23` for humans; stored and compared in the normalized form. */
export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, '');
}

/** Replaces every recovery code of the user with a fresh set; returns them once, formatted. */
export async function regenerateRecoveryCodes(userKind: UserKind, userId: string, now = new Date()): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, RECOVERY_CODE_BCRYPT_COST)));
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.recoveryCodes)
      .where(and(eq(schema.recoveryCodes.userKind, userKind), eq(schema.recoveryCodes.userId, userId)));
    await tx.insert(schema.recoveryCodes).values(hashes.map((codeHash) => ({ userKind, userId, codeHash, createdAt: now })));
  });
  return codes.map(formatRecoveryCode);
}

/** Burns a recovery code. False when it matches no unused code. */
export async function consumeRecoveryCode(userKind: UserKind, userId: string, input: string, now = new Date()): Promise<boolean> {
  const code = normalizeRecoveryCode(input);
  if (code.length !== RECOVERY_CODE_LENGTH) return false;
  const unused = await db
    .select()
    .from(schema.recoveryCodes)
    .where(and(eq(schema.recoveryCodes.userKind, userKind), eq(schema.recoveryCodes.userId, userId), isNull(schema.recoveryCodes.usedAt)));
  for (const row of unused) {
    if (await bcrypt.compare(code, row.codeHash)) {
      const burned = await db
        .update(schema.recoveryCodes)
        .set({ usedAt: now })
        .where(and(eq(schema.recoveryCodes.id, row.id), isNull(schema.recoveryCodes.usedAt)))
        .returning({ id: schema.recoveryCodes.id });
      return burned.length === 1;
    }
  }
  return false;
}

export async function countUnusedRecoveryCodes(userKind: UserKind, userId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.recoveryCodes.id })
    .from(schema.recoveryCodes)
    .where(and(eq(schema.recoveryCodes.userKind, userKind), eq(schema.recoveryCodes.userId, userId), isNull(schema.recoveryCodes.usedAt)));
  return rows.length;
}

/** Test and seed helper: the code an authenticator would show right now. */
export function generateCode(secret: string, now = Date.now()): string {
  return authenticator.clone({ epoch: now }).generate(secret);
}

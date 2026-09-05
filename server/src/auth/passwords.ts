/**
 * Password policy (plan: Security design → Passwords, R12).
 *
 * bcryptjs at cost 12 (pure JS — no native build on the firm PC), minimum 12
 * characters, and older cost-10 hashes are re-hashed on the next successful
 * sign-in. The published demo passwords are refused in production.
 */
import bcrypt from 'bcryptjs';
import { z } from 'zod';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 1024;
export const PASSWORD_BCRYPT_COST = 12;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`);

/** The seed's demo passwords; fine on a laptop, never on the firm PC. */
export const DEMO_PASSWORDS = ['password123', 'client123'];

/** Test suites lower the cost (fixtures are rebuilt before every test); production always gets 12. */
export function bcryptCost(): number {
  if (process.env.NODE_ENV === 'production') return PASSWORD_BCRYPT_COST;
  const raw = process.env.PASSWORD_BCRYPT_COST;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 4 && n <= 15 ? n : PASSWORD_BCRYPT_COST;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, bcryptCost());
}

export interface PasswordCheck {
  ok: boolean;
  /** True when the stored hash is weaker than the current cost; callers re-hash on success. */
  needsRehash: boolean;
}

export async function verifyPassword(plain: string, hash: string | null): Promise<PasswordCheck> {
  if (!hash) return { ok: false, needsRehash: false };
  const ok = await bcrypt.compare(plain, hash);
  let needsRehash = false;
  if (ok) {
    try {
      needsRehash = bcrypt.getRounds(hash) < bcryptCost();
    } catch {
      needsRehash = true;
    }
  }
  return { ok, needsRehash };
}

export function isRefusedDemoPassword(plain: string): boolean {
  return process.env.NODE_ENV === 'production' && DEMO_PASSWORDS.includes(plain);
}

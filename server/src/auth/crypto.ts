/**
 * Secrets at rest (plan: Data model → mfa_totp.secretEnc).
 *
 * AES-256-GCM under APP_ENCRYPTION_KEY (32 bytes, hex or base64). Wire format
 * `v1:<iv>:<tag>:<ciphertext>` in base64url so a future key or algorithm change
 * can coexist with old rows. Without a key the server refuses to start in
 * production; elsewhere it derives a fixed development key and says so once.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const DEV_KEY_SEED = 'docflow-dev-encryption-key-not-for-production';
let warnedDevKey = false;

function parseKey(raw: string): Buffer | null {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const b = Buffer.from(raw, 'base64');
  return b.length === 32 ? b : null;
}

export function encryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'APP_ENCRYPTION_KEY must be set in production (32 random bytes as 64 hex chars: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))").'
      );
    }
    if (!warnedDevKey && process.env.NODE_ENV !== 'test') {
      warnedDevKey = true;
      console.warn('APP_ENCRYPTION_KEY is not set; using the fixed development key. Never run production like this.');
    }
    return createHash('sha256').update(DEV_KEY_SEED).digest();
  }
  const key = parseKey(raw);
  if (!key) throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or base64).');
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

/** Throws on a wrong key, a tampered payload or an unknown format. */
export function decryptSecret(encoded: string): string {
  const [version, ivB64, tagB64, ctB64] = encoded.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('Unrecognized encrypted secret format');
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

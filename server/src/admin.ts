/**
 * Administrator CLI (plan: Security design → Provisioning). Runs on the server
 * console only — there is no admin role in the app.
 *
 *   npm run admin -- create-advisor --email a@firm.com --name "Ann Advisor" [--firm "Firm CPA"]
 *   npm run admin -- reset-mfa      --kind provider|client --email …
 *   npm run admin -- reset-link     --kind provider|client --email …
 *   npm run admin -- deactivate     --kind provider|client --email …
 *   npm run admin -- reactivate     --kind provider|client --email …
 *   npm run admin -- list-sessions  --kind provider|client --email …
 *   npm run admin -- list-users
 *   npm run admin -- unlock
 *
 * Every change is recorded as an activity row ("Administrator (CLI) …") so the
 * advisor sees it in the feed; C2.1's audit_log takes over from there.
 */
import 'dotenv/config';
import readline from 'node:readline';
import { and, eq } from 'drizzle-orm';
import { db, pool, schema } from './db/client.js';
import { hashPassword, isRefusedDemoPassword, passwordSchema } from './auth/passwords.js';
import { createPasswordReset, resetLink } from './auth/resets.js';
import { listLiveSessions, revokeAllSessions } from './auth/sessions.js';

type Kind = 'provider' | 'client';
type Flags = Record<string, string | true>;

function parseArgs(argv: string[]): { command: string; flags: Flags } {
  const [command = '', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function need(flags: Flags, name: string): string {
  const v = flags[name];
  if (typeof v !== 'string' || !v.trim()) throw new UsageError(`--${name} is required`);
  return v.trim();
}

function needKind(flags: Flags): Kind {
  const k = need(flags, 'kind');
  if (k !== 'provider' && k !== 'client') throw new UsageError('--kind must be provider or client');
  return k;
}

class UsageError extends Error {}

/** Reads a line with echo off (passwords). Falls back to plain input when there is no TTY. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = process.stdout as NodeJS.WriteStream & { muted?: boolean };
    const write = out.write.bind(out);
    let muted = false;
    (out as unknown as { write: typeof write }).write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      if (muted && typeof chunk === 'string' && chunk !== '\n' && chunk !== '\r\n') return true;
      return (write as (c: string | Uint8Array, ...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof out.write;
    rl.question(question, (answer) => {
      muted = false;
      (out as unknown as { write: typeof write }).write = write;
      write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function passwordFromEnvOrPrompt(): Promise<string> {
  const fromEnv = process.env.DOCFLOW_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) throw new UsageError('No TTY: set DOCFLOW_ADMIN_PASSWORD to pass the password non-interactively');
  const first = await promptHidden('Password (min 12 characters): ');
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new UsageError('Passwords do not match');
  return first;
}

function checkPassword(password: string) {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new UsageError(parsed.error.issues[0]?.message ?? 'Invalid password');
  if (isRefusedDemoPassword(password)) throw new UsageError('That demo password is refused in production');
}

interface Account {
  kind: Kind;
  id: string;
  name: string;
  email: string;
  providerId: string;
  deactivatedAt: Date | null;
}

async function findAccount(kind: Kind, email: string): Promise<Account> {
  if (kind === 'provider') {
    const [p] = await db.select().from(schema.providers).where(eq(schema.providers.email, email));
    if (!p) throw new UsageError(`No advisor with email ${email}`);
    return { kind, id: p.id, name: p.name, email: p.email, providerId: p.id, deactivatedAt: p.deactivatedAt };
  }
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.email, email));
  if (!c) throw new UsageError(`No client with email ${email}`);
  return { kind, id: c.id, name: c.name, email: c.email, providerId: c.providerId, deactivatedAt: c.deactivatedAt };
}

/** The audit bridge until C2.1: an activity row the advisor can see. */
async function record(account: Pick<Account, 'kind' | 'id' | 'providerId'>, description: string) {
  await db.insert(schema.activities).values({
    providerId: account.providerId,
    clientId: account.kind === 'client' ? account.id : null,
    type: 'update',
    description,
    actorKind: null,
    actorId: null,
    actorName: 'Administrator (CLI)',
    targetId: account.id,
  });
}

const commands: Record<string, (flags: Flags) => Promise<void>> = {
  async 'create-advisor'(flags) {
    const email = need(flags, 'email');
    const name = need(flags, 'name');
    const firm = typeof flags.firm === 'string' ? flags.firm.trim() : null;
    const [existing] = await db.select({ id: schema.providers.id }).from(schema.providers).where(eq(schema.providers.email, email));
    if (existing) throw new UsageError(`An advisor with email ${email} already exists`);

    const password = await passwordFromEnvOrPrompt();
    checkPassword(password);
    const passwordHash = await hashPassword(password);
    const [created] = await db
      .insert(schema.providers)
      .values({ name, email, passwordHash, firmName: firm, role: 'advisor', passwordChangedAt: new Date() })
      .returning({ id: schema.providers.id });
    await record({ kind: 'provider', id: created.id, providerId: created.id }, `Administrator (CLI) created advisor account ${email}`);
    console.log(`Created advisor ${name} <${email}>${firm ? ` at ${firm}` : ''}. The first sign-in sets up two-step verification.`);
  },

  async 'reset-mfa'(flags) {
    const account = await findAccount(needKind(flags), need(flags, 'email'));
    await db.delete(schema.mfaTotp).where(and(eq(schema.mfaTotp.userKind, account.kind), eq(schema.mfaTotp.userId, account.id)));
    await db.delete(schema.recoveryCodes).where(and(eq(schema.recoveryCodes.userKind, account.kind), eq(schema.recoveryCodes.userId, account.id)));
    const revoked = await revokeAllSessions(account.kind, account.id);
    await record(account, `Administrator (CLI) reset two-step verification for ${account.email}`);
    console.log(`Two-step verification reset for ${account.email}; ${revoked} session(s) ended. The next sign-in enrolls a new authenticator.`);
  },

  async 'reset-link'(flags) {
    const account = await findAccount(needKind(flags), need(flags, 'email'));
    if (account.deactivatedAt) throw new UsageError(`${account.email} is deactivated; reactivate first`);
    const { token, expiresAt } = await createPasswordReset(account.kind, account.id);
    await record(account, `Administrator (CLI) issued a password reset link for ${account.email}`);
    console.log(`Password reset link for ${account.email} (valid until ${expiresAt.toISOString()}, single use):`);
    console.log(resetLink(token));
  },

  async deactivate(flags) {
    const account = await findAccount(needKind(flags), need(flags, 'email'));
    const now = new Date();
    if (account.kind === 'provider') {
      await db.update(schema.providers).set({ deactivatedAt: now, updatedAt: now }).where(eq(schema.providers.id, account.id));
    } else {
      await db.update(schema.clients).set({ deactivatedAt: now, updatedAt: now }).where(eq(schema.clients.id, account.id));
    }
    const revoked = await revokeAllSessions(account.kind, account.id);
    await record(account, `Administrator (CLI) deactivated ${account.email}`);
    console.log(`Deactivated ${account.email}; ${revoked} session(s) ended.`);
  },

  async reactivate(flags) {
    const account = await findAccount(needKind(flags), need(flags, 'email'));
    const now = new Date();
    if (account.kind === 'provider') {
      await db.update(schema.providers).set({ deactivatedAt: null, updatedAt: now }).where(eq(schema.providers.id, account.id));
    } else {
      await db.update(schema.clients).set({ deactivatedAt: null, updatedAt: now }).where(eq(schema.clients.id, account.id));
    }
    await record(account, `Administrator (CLI) reactivated ${account.email}`);
    console.log(`Reactivated ${account.email}.`);
  },

  async 'list-sessions'(flags) {
    const account = await findAccount(needKind(flags), need(flags, 'email'));
    const rows = await listLiveSessions(account.kind, account.id);
    if (rows.length === 0) {
      console.log(`No live sessions for ${account.email}.`);
      return;
    }
    console.log(`${rows.length} live session(s) for ${account.email}:`);
    for (const s of rows) {
      console.log(`  ${s.id}  stage=${s.stage}  since=${s.createdAt.toISOString()}  last=${s.lastSeenAt.toISOString()}  ip=${s.ip ?? '-'}  ua=${s.userAgent ?? '-'}`);
    }
  },

  async 'list-users'() {
    const providers = await db.select().from(schema.providers);
    const clients = await db.select().from(schema.clients);
    console.log(`${providers.length} advisor(s):`);
    for (const p of providers) {
      console.log(`  ${p.email}  ${p.name}${p.firmName ? ` (${p.firmName})` : ''}  ${p.deactivatedAt ? 'DEACTIVATED' : 'active'}`);
    }
    console.log(`${clients.length} client(s):`);
    for (const c of clients) {
      const state = c.deactivatedAt ? 'DEACTIVATED' : c.passwordHash ? 'can sign in' : 'not invited / no password';
      console.log(`  ${c.email}  ${c.name}  ${state}`);
    }
  },

  async unlock() {
    console.log(
      'Login throttles live in the API process (20 attempts / 15 min per IP, 10 per email) and clear 15 minutes after the last failed attempt.\n' +
        'To clear them now, restart the docflow-api service. Nothing is stored in the database for this.'
    );
  },
};

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const run = commands[command];
  if (!run) {
    console.error(`Unknown command "${command}". Commands: ${Object.keys(commands).join(', ')}`);
    process.exitCode = 2;
    return;
  }
  try {
    await run(flags);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      process.exitCode = 2;
    } else {
      throw err;
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

/**
 * The administrator CLI (plan: Security design → Provisioning), spawned the
 * way the firm PC runs it: a separate process with the database URL in its
 * environment and the password passed non-interactively.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { PASSWORD, app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..');
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `npm run admin -- …` without npm: node + tsx + src/admin.ts, against the test database. */
async function admin(args: string[], env: Record<string, string> = {}): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [tsxCli, 'src/admin.ts', ...args], {
      cwd: serverDir,
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const me = (cookie: string) => request(app).get('/api/auth/me').set('Cookie', cookie);
const login = (email: string, password: string, kind: 'provider' | 'client') =>
  request(app).post('/api/auth/login').send({ email, password, kind });

const adminActivities = () => db.select().from(schema.activities).where(eq(schema.activities.actorName, 'Administrator (CLI)'));

describe('admin CLI', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('create-advisor makes an account that must enroll MFA at first sign-in, and records the action', async () => {
    const run = await admin(['create-advisor', '--email', 'new@firm.test', '--name', 'New Advisor', '--firm', 'New Firm CPA'], {
      DOCFLOW_ADMIN_PASSWORD: 'an-admin-chosen-pass',
    });
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain('Created advisor New Advisor <new@firm.test> at New Firm CPA');

    const [p] = await db.select().from(schema.providers).where(eq(schema.providers.email, 'new@firm.test'));
    expect(p).toBeDefined();
    expect(p.firmName).toBe('New Firm CPA');
    expect(p.passwordChangedAt).not.toBeNull();
    // Cost comes from the environment the CLI ran in (4 in tests, 12 on the firm PC).
    expect(bcrypt.getRounds(p.passwordHash)).toBe(4);

    const signin = await login('new@firm.test', 'an-admin-chosen-pass', 'provider');
    expect(signin.status).toBe(200);
    expect(signin.body.stage).toBe('mfa_enroll');

    const log = await adminActivities();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ providerId: p.id, type: 'update', actorKind: null, actorId: null });
    expect(log[0].description).toContain('created advisor account new@firm.test');
  });

  it('create-advisor refuses a duplicate, a weak password, and a missing password without a TTY', async () => {
    const dup = await admin(['create-advisor', '--email', fx.provider1.email, '--name', 'Dup'], { DOCFLOW_ADMIN_PASSWORD: 'an-admin-chosen-pass' });
    expect(dup.code).toBe(2);
    expect(dup.stderr).toContain('already exists');

    const weak = await admin(['create-advisor', '--email', 'weak@firm.test', '--name', 'Weak'], { DOCFLOW_ADMIN_PASSWORD: 'short' });
    expect(weak.code).toBe(2);
    expect(weak.stderr).toContain('at least 12');
    expect(await db.select().from(schema.providers).where(eq(schema.providers.email, 'weak@firm.test'))).toHaveLength(0);

    const noPassword = await admin(['create-advisor', '--email', 'tty@firm.test', '--name', 'No TTY'], { DOCFLOW_ADMIN_PASSWORD: '' });
    expect(noPassword.code).toBe(2);
    expect(noPassword.stderr).toContain('DOCFLOW_ADMIN_PASSWORD');
  });

  it('reset-mfa drops the authenticator and recovery codes, ends sessions, and forces re-enrollment', async () => {
    const cookie = await loginAs(fx, 'client1a');
    const run = await admin(['reset-mfa', '--kind', 'client', '--email', fx.client1a.email]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain('Two-step verification reset');

    const mfa = await db.select().from(schema.mfaTotp).where(and(eq(schema.mfaTotp.userKind, 'client'), eq(schema.mfaTotp.userId, fx.client1a.id)));
    expect(mfa).toHaveLength(0);
    expect((await me(cookie)).body.reason).toBe('revoked');
    const signin = await login(fx.client1a.email, PASSWORD, 'client');
    expect(signin.status).toBe(200);
    expect(signin.body.stage).toBe('mfa_enroll');

    const [entry] = await adminActivities();
    expect(entry.clientId).toBe(fx.client1a.id);
    expect(entry.providerId).toBe(fx.provider1.id);
  });

  it('deactivate and reactivate an advisor', async () => {
    const cookie = await loginAs(fx, 'provider2');
    const off = await admin(['deactivate', '--kind', 'provider', '--email', fx.provider2.email]);
    expect(off.code, off.stderr).toBe(0);
    expect((await me(cookie)).body.reason).toBe('revoked');
    const refused = await login(fx.provider2.email, PASSWORD, 'provider');
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('deactivated');

    const on = await admin(['reactivate', '--kind', 'provider', '--email', fx.provider2.email]);
    expect(on.code, on.stderr).toBe(0);
    expect((await login(fx.provider2.email, PASSWORD, 'provider')).status).toBe(200);
    expect(await adminActivities()).toHaveLength(2);
  });

  it('reset-link prints a single-use link that the reset endpoint accepts', async () => {
    const run = await admin(['reset-link', '--kind', 'provider', '--email', fx.provider1.email]);
    expect(run.code, run.stderr).toBe(0);
    const link = run.stdout.match(/http:\/\/localhost:8080\/reset\/[A-Za-z0-9_-]{43}/)?.[0];
    expect(link).toBeDefined();
    const token = link!.split('/').pop()!;

    const done = await request(app).post('/api/auth/password-reset/confirm').send({ token, password: 'a-fresh-password-2026' });
    expect(done.status).toBe(200);
    expect((await login(fx.provider1.email, 'a-fresh-password-2026', 'provider')).status).toBe(200);
    expect((await login(fx.provider1.email, PASSWORD, 'provider')).status).toBe(401);
  });

  it('list-sessions and list-users report; unknown commands and bad flags exit 2', async () => {
    await loginAs(fx, 'provider1');
    const sessions = await admin(['list-sessions', '--kind', 'provider', '--email', fx.provider1.email]);
    expect(sessions.code, sessions.stderr).toBe(0);
    expect(sessions.stdout).toContain('1 live session(s)');
    expect(sessions.stdout).toContain('stage=active');

    const users = await admin(['list-users']);
    expect(users.code, users.stderr).toBe(0);
    expect(users.stdout).toContain('2 advisor(s)');
    expect(users.stdout).toContain('3 client(s)');
    expect(users.stdout).toContain(`${fx.client1a.email}  Client 1A  can sign in`);

    expect((await admin(['nope'])).code).toBe(2);
    const badKind = await admin(['reset-mfa', '--kind', 'wizard', '--email', fx.provider1.email]);
    expect(badKind.code).toBe(2);
    expect(badKind.stderr).toContain('--kind');
    const unknownUser = await admin(['deactivate', '--kind', 'client', '--email', 'nobody@example.test']);
    expect(unknownUser.code).toBe(2);
    expect(unknownUser.stderr).toContain('No client');
  });
});

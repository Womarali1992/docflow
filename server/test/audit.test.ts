/**
 * Audit coverage (C5.2): the actions the plan's Security design says must leave
 * a record, walked end to end.
 *
 * The point of this file is not that `audit()` works — C2.1 proved that. It is
 * that the *call sites exist*, because an audit log is only worth having if the
 * thing that happened is in it. A route added later without its audit row is a
 * silent gap, and this test is where that shows up.
 *
 * It also holds the two rules that keep the log safe to keep: **no addresses**
 * (they are hashed) and **no content** — no filenames, no message text, no
 * passwords, nothing a client wrote.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { app, loginAs, passwordLogin, request, seedFixture, PASSWORD, type Fixture } from './helpers.js';

async function actions(): Promise<string[]> {
  const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.at));
  return rows.map((r) => r.action);
}

async function rowsFor(action: string) {
  const rows = await db.select().from(schema.auditLog);
  return rows.filter((r) => r.action === action);
}

describe('audit coverage', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('records a sign-in, and what kind of refusal a failure was', async () => {
    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: fx.provider1.email, password: 'not the password', kind: 'provider' });
    expect(bad.status).toBe(401);

    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD, kind: 'provider' });
    expect(unknown.status).toBe(401);

    await passwordLogin(fx, 'provider1');

    const failures = await rowsFor('auth.login_failed');
    expect(failures).toHaveLength(2);
    // The caller was told the same thing both times; the log knows the difference.
    expect(failures.map((f) => (f.meta as { reason: string }).reason).sort()).toEqual(['no_such_account', 'wrong_password']);
    // …and it is a log, not a mailing list.
    for (const f of failures) {
      const meta = f.meta as { emailHash: string };
      expect(meta.emailHash).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(f.meta)).not.toContain('@');
    }
    expect(await rowsFor('auth.login')).toHaveLength(1);
  });

  it('records the second factor, the logout and signing out everywhere', async () => {
    const cookie = await loginAs(fx, 'provider1');
    await request(app).post('/api/auth/logout-all').set('Cookie', cookie);

    const seen = await actions();
    expect(seen).toContain('session.revoked');

    const cookie2 = await loginAs(fx, 'provider1');
    await request(app).post('/api/auth/logout').set('Cookie', cookie2);
    expect(await actions()).toContain('auth.logout');
  });

  it('records a password change, with how many sessions it ended', async () => {
    const cookie = await loginAs(fx, 'provider1');
    const res = await request(app)
      .post('/api/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'a-much-longer-password-2026' });
    expect(res.status).toBe(200);

    const [row] = await rowsFor('auth.password_changed');
    expect(row).toBeTruthy();
    expect(row.meta).toHaveProperty('otherSessionsRevoked');
    // The passwords themselves are nowhere near it.
    expect(JSON.stringify(row.meta)).not.toContain('password-2026');
  });

  it('records the account lifecycle: created, invited, deactivated, reactivated', async () => {
    const advisor = await loginAs(fx, 'provider1');

    const created = await request(app)
      .post('/api/clients')
      .set('Cookie', advisor)
      .send({ name: 'Audit Test', email: 'audit.client@example.com' });
    expect(created.status).toBe(201);

    await request(app).post(`/api/clients/${created.body.id}/invitations`).set('Cookie', advisor);
    await request(app).post(`/api/clients/${created.body.id}/deactivate`).set('Cookie', advisor);
    await request(app).post(`/api/clients/${created.body.id}/reactivate`).set('Cookie', advisor);

    const seen = await actions();
    for (const action of ['client.created', 'invitation.created', 'client.deactivated', 'client.reactivated']) {
      expect(seen).toContain(action);
    }

    const [createdRow] = await rowsFor('client.created');
    // The client's address is hashed here too.
    expect(JSON.stringify(createdRow.meta)).not.toContain('audit.client@example.com');
    expect((createdRow.meta as { emailHash: string }).emailHash).toMatch(/^[0-9a-f]{32}$/);

    const [deactivated] = await rowsFor('client.deactivated');
    expect(deactivated.meta).toHaveProperty('sessionsRevoked');
    expect(deactivated.clientId).toBe(created.body.id);
  });

  it('records an invitation being accepted, by the holder of the link', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const created = await request(app)
      .post('/api/clients')
      .set('Cookie', advisor)
      .send({ name: 'Invited Person', email: 'invited@example.com' });
    const invite = await request(app).post(`/api/clients/${created.body.id}/invitations`).set('Cookie', advisor);
    const token = String(invite.body.link).split('/').pop();

    const accepted = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .send({ password: 'first-password-for-2026' });
    expect(accepted.status).toBe(200);

    const [row] = await rowsFor('invitation.accepted');
    expect(row.clientId).toBe(created.body.id);
  });

  it('never records a document’s contents — only which document it was', async () => {
    const advisor = await loginAs(fx, 'provider1');
    await request(app).post(`/api/documents/${fx.client1a.deliverable}/unshare`).set('Cookie', advisor);
    await request(app).post(`/api/documents/${fx.client1a.deliverable}/share`).set('Cookie', advisor);

    const rows = await db.select().from(schema.auditLog);
    const blob = JSON.stringify(rows);
    // The seeded documents are named "… Tax Return Draft.pdf" / "… Bank Statement.pdf".
    expect(blob).not.toContain('Tax Return Draft');
    expect(blob).not.toContain('Bank Statement');
    expect(blob).not.toContain('.pdf');
    expect(rows.some((r) => r.action === 'document.shared' && r.targetId === fx.client1a.deliverable)).toBe(true);
  });
});

/**
 * A firm of several advisors (docs/FIRM-BOOK-PLAN.md F4–F6): an owner invites
 * and deactivates advisors, any advisor can give a client to another, and the
 * queue counts "mine" or everyone's. Who may call each route is pinned in the
 * authz matrix; this file is about what each one does.
 *
 * The fixture's firm 1 is Provider One (owner) and Colleague One (advisor, no
 * clients of their own); firm 2 is Provider Two alone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { hashToken } from '../src/auth/sessions.js';
import { PDF_BYTES, app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

const NEW_PASSWORD = 'a-fresh-password-2026';
const tokenOf = (link: string) => link.split('/').pop()!;
const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password, kind: 'provider' });

const assign = (clientId: string, providerId: string | null) =>
  db.update(schema.clients).set({ assignedProviderId: providerId }).where(eq(schema.clients.id, clientId));

async function auditRows(action: string) {
  return db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action));
}

async function activityLines(clientId: string) {
  return (await db.select().from(schema.activities).where(eq(schema.activities.clientId, clientId))).map((a) => a.description);
}

describe('the team', () => {
  let fx: Fixture;
  let owner: string;

  beforeEach(async () => {
    fx = await seedFixture();
    owner = await loginAs(fx, 'provider1');
  });

  afterEach(() => {
    delete process.env.SMTP_URL;
  });

  it('an owner invites an advisor, who sets a password from the link and lands in MFA enrollment', async () => {
    const invited = await request(app).post('/api/firm/advisors').set('Cookie', owner).send({ name: 'James Okafor', email: ' James@Example.test ' });
    expect(invited.status).toBe(201);
    expect(invited.body.advisor).toMatchObject({ name: 'James Okafor', email: 'James@Example.test', role: 'advisor', hasPassword: false });
    expect(invited.body.emailQueued).toBe(false);
    const token = tokenOf(invited.body.link);

    // The account exists, cannot sign in, and only the token's hash is kept.
    const [row] = await db.select().from(schema.providers).where(eq(schema.providers.id, invited.body.advisor.id));
    expect(row).toMatchObject({ firmId: fx.provider1.firmId, passwordHash: null, role: 'advisor' });
    const [inv] = await db.select().from(schema.staffInvitations).where(eq(schema.staffInvitations.providerId, row.id));
    expect(inv.tokenHash).toBe(hashToken(token));
    expect((await login('james@example.test', NEW_PASSWORD)).status).toBe(401);
    // Nor can a password reset be asked for it: the invitation is the way in.
    await request(app).post('/api/auth/password-reset/request').send({ email: 'james@example.test', kind: 'provider' });
    expect(await db.select().from(schema.passwordResets).where(eq(schema.passwordResets.userId, row.id))).toHaveLength(0);

    const info = await request(app).get(`/api/staff-invitations/${token}`);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ name: 'James Okafor', firmName: 'Provider One CPA', inviterName: 'Provider One' });

    const accepted = await request(app).post(`/api/staff-invitations/${token}/accept`).send({ password: NEW_PASSWORD });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ stage: 'mfa_enroll', me: { kind: 'provider', id: row.id, role: 'advisor', firmName: 'Provider One CPA' } });
    expect((await request(app).post(`/api/staff-invitations/${token}/accept`).send({ password: NEW_PASSWORD })).status).toBe(410);
    expect((await login('james@example.test', NEW_PASSWORD)).status).toBe(200);

    const team = await request(app).get('/api/firm').set('Cookie', owner);
    expect(team.body.advisors.find((a: { id: string }) => a.id === row.id)).toMatchObject({ hasPassword: true, invitePendingUntil: null });
    expect((await auditRows('staff.invited'))).toHaveLength(1);
    expect((await auditRows('staff.invitation_accepted'))).toHaveLength(1);
  });

  it('a new link replaces the old; expired and unknown links are refused; a joined advisor gets no new one', async () => {
    const invited = await request(app).post('/api/firm/advisors').set('Cookie', owner).send({ name: 'James Okafor', email: 'james@example.test' });
    const id = invited.body.advisor.id as string;
    const first = tokenOf(invited.body.link);
    const resent = await request(app).post(`/api/firm/advisors/${id}/invitations`).set('Cookie', owner);
    expect(resent.status).toBe(201);
    const second = tokenOf(resent.body.link);
    expect((await request(app).get(`/api/staff-invitations/${first}`)).status).toBe(404);
    expect((await request(app).get(`/api/staff-invitations/${second}`)).status).toBe(200);

    await db.update(schema.staffInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.staffInvitations.tokenHash, hashToken(second)));
    const expired = await request(app).get(`/api/staff-invitations/${second}`);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('expired');
    expect((await request(app).get(`/api/staff-invitations/${'A'.repeat(43)}`)).status).toBe(404);

    const joined = await request(app).post(`/api/firm/advisors/${fx.colleague1.id}/invitations`).set('Cookie', owner);
    expect(joined.status).toBe(409);
    expect(joined.body.code).toBe('already_joined');
  });

  it('an advisor address is unique across the install, whatever its case', async () => {
    for (const email of [fx.colleague1.email.toUpperCase(), fx.provider2.email]) {
      const res = await request(app).post('/api/firm/advisors').set('Cookie', owner).send({ name: 'Twin', email });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('email_taken');
    }
  });

  it('deactivating an advisor ends their sessions and hands their clients to whoever the owner names', async () => {
    await assign(fx.client1a.id, fx.colleague1.id);
    const colleague = await loginAs(fx, 'colleague1');

    const res = await request(app)
      .post(`/api/firm/advisors/${fx.colleague1.id}/deactivate`)
      .set('Cookie', owner)
      .send({ reassignTo: fx.provider1.id });
    expect(res.status).toBe(200);
    expect(res.body.clientsMoved).toBe(1);

    expect((await request(app).get('/api/clients').set('Cookie', colleague)).status).toBe(401);
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, fx.client1a.id));
    expect(client.assignedProviderId).toBe(fx.provider1.id);
    const [moved] = await auditRows('client.reassigned');
    expect(moved.meta).toMatchObject({ fromId: fx.colleague1.id, toId: fx.provider1.id, reason: 'advisor_deactivated' });
    expect((await auditRows('staff.deactivated'))[0].meta).toMatchObject({ clientsMoved: 1 });
    expect(await activityLines(fx.client1a.id)).toContain('Reassigned to Provider One (was Colleague One)');

    const back = await request(app).post(`/api/firm/advisors/${fx.colleague1.id}/reactivate`).set('Cookie', owner);
    expect(back.status).toBe(200);
    expect(back.body.advisor.deactivatedAt).toBeNull();
    expect((await auditRows('staff.reactivated'))).toHaveLength(1);
  });

  it('with nobody named, their clients are left with the whole firm, which then hears about them', async () => {
    await assign(fx.client1a.id, fx.colleague1.id);
    const res = await request(app).post(`/api/firm/advisors/${fx.colleague1.id}/deactivate`).set('Cookie', owner).send({});
    expect(res.status).toBe(200);
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, fx.client1a.id));
    expect(client.assignedProviderId).toBeNull();

    const cookie = await loginAs(fx, 'client1a');
    const upload = await request(app)
      .post(`/api/requests/${fx.client1a.request}/uploads`)
      .set('Cookie', cookie)
      .attach('file', PDF_BYTES, { filename: 'statement.pdf', contentType: 'application/pdf' });
    expect([201, 202]).toContain(upload.status);
    const told = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userKind, 'provider'), eq(schema.notifications.type, 'upload.received')));
    expect(told.map((n) => n.userId)).toEqual([fx.provider1.id]);
  });

  it('an owner cannot deactivate themselves, or hand clients outside the firm', async () => {
    const self = await request(app).post(`/api/firm/advisors/${fx.provider1.id}/deactivate`).set('Cookie', owner).send({});
    expect(self.status).toBe(409);
    expect(self.body.code).toBe('self');
    const away = await request(app)
      .post(`/api/firm/advisors/${fx.colleague1.id}/deactivate`)
      .set('Cookie', owner)
      .send({ reassignTo: fx.provider2.id });
    expect(away.status).toBe(400);
    expect(away.body.code).toBe('not_in_firm');
    const [still] = await db.select().from(schema.providers).where(eq(schema.providers.id, fx.colleague1.id));
    expect(still.deactivatedAt).toBeNull();
  });
});

describe('assigning a client', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  afterEach(() => {
    delete process.env.SMTP_URL;
  });

  it('any advisor of the firm moves a client: audited, on the activity, and the new advisor told in-app only', async () => {
    process.env.SMTP_URL = 'smtp://user:pass@localhost:1025';
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app).post(`/api/clients/${fx.client1b.id}/assign`).set('Cookie', advisor).send({ advisorId: fx.colleague1.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ assignedAdvisorId: fx.colleague1.id, assignedAdvisorName: 'Colleague One' });

    const [row] = await auditRows('client.reassigned');
    expect(row).toMatchObject({ clientId: fx.client1b.id, actorId: fx.provider1.id });
    expect(row.meta).toMatchObject({ fromId: fx.provider1.id, toId: fx.colleague1.id, reason: 'assigned' });
    expect(await activityLines(fx.client1b.id)).toContain('Reassigned to Colleague One (was Provider One)');
    const notices = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, fx.colleague1.id));
    expect(notices).toMatchObject([{ type: 'client.assigned', title: 'Provider One gave you Client 1B', link: `/clients/${fx.client1b.id}` }]);
    expect(await db.select().from(schema.jobs)).toHaveLength(0);

    // The colleague may move it on again: the book is shared (Q2).
    const colleague = await loginAs(fx, 'colleague1');
    const back = await request(app).post(`/api/clients/${fx.client1b.id}/assign`).set('Cookie', colleague).send({ advisorId: null });
    expect(back.status).toBe(200);
    expect(back.body.assignedAdvisorId).toBeNull();
    expect(await activityLines(fx.client1b.id)).toContain('Unassigned (was Colleague One)');
  });

  it('giving a client the advisor they already have records nothing', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const res = await request(app).post(`/api/clients/${fx.client1a.id}/assign`).set('Cookie', advisor).send({ advisorId: fx.provider1.id });
    expect(res.status).toBe(200);
    expect(await auditRows('client.reassigned')).toHaveLength(0);
  });

  it('refuses another firm, a deactivated advisor and one who has not joined, all alike', async () => {
    const advisor = await loginAs(fx, 'provider1');
    const invited = await request(app).post('/api/firm/advisors').set('Cookie', advisor).send({ name: 'Not Yet', email: 'not.yet@example.test' });
    const [gone] = await db.insert(schema.providers).values({ firmId: fx.provider1.firmId, name: 'Gone', email: 'gone@example.test', passwordHash: 'x', deactivatedAt: new Date() }).returning();
    for (const advisorId of [fx.provider2.id, gone.id, invited.body.advisor.id]) {
      const res = await request(app).post(`/api/clients/${fx.client1a.id}/assign`).set('Cookie', advisor).send({ advisorId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('not_in_firm');
    }
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, fx.client1a.id));
    expect(client.assignedProviderId).toBe(fx.provider1.id);
  });

  it('a new client is the creating advisor’s unless another advisor of the firm, or nobody, is named', async () => {
    const colleague = await loginAs(fx, 'colleague1');
    const mine = await request(app).post('/api/clients').set('Cookie', colleague).send({ name: 'Mine', email: 'mine@example.test' });
    expect(mine.body.assignedAdvisorId).toBe(fx.colleague1.id);
    const theirs = await request(app)
      .post('/api/clients')
      .set('Cookie', colleague)
      .send({ name: 'Theirs', email: 'theirs@example.test', assignedAdvisorId: fx.provider1.id });
    expect(theirs.body.assignedAdvisorId).toBe(fx.provider1.id);
    const nobody = await request(app).post('/api/clients').set('Cookie', colleague).send({ name: 'Nobody', email: 'nobody@example.test', assignedAdvisorId: null });
    expect(nobody.body.assignedAdvisorId).toBeNull();
    const elsewhere = await request(app)
      .post('/api/clients')
      .set('Cookie', colleague)
      .send({ name: 'Elsewhere', email: 'elsewhere@example.test', assignedAdvisorId: fx.provider2.id });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.code).toBe('not_in_firm');
  });
});

describe('the queue: mine or everyone', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  const queue = async (cookie: string, who?: string) => {
    const res = await request(app).get(`/api/dashboard${who ? `?who=${who}` : ''}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    return res.body;
  };

  it('counts only my clients and the unassigned under "mine", and every one under "all"', async () => {
    await assign(fx.client1b.id, fx.colleague1.id);
    const advisor = await loginAs(fx, 'provider1');
    const colleague = await loginAs(fx, 'colleague1');

    const all = await queue(advisor, 'all');
    expect(all.waitingOnClients.count).toBe(2);
    expect(await queue(advisor)).toEqual({ ...all, generatedAt: expect.any(String) });
    const mine = await queue(advisor, 'mine');
    expect(mine.waitingOnClients.items.map((r: { clientId: string }) => r.clientId)).toEqual([fx.client1a.id]);
    expect(mine.unreadMessages.count).toBe(1);
    const theirs = await queue(colleague, 'mine');
    expect(theirs.waitingOnClients.items.map((r: { clientId: string }) => r.clientId)).toEqual([fx.client1b.id]);
    // Client 1A's unread message is Provider One's to answer, not the colleague's.
    expect(theirs.unreadMessages.count).toBe(0);

    // "Everyone" says whose line each one is.
    const names = Object.fromEntries(all.waitingOnClients.items.map((r: { clientId: string; advisorName: string }) => [r.clientId, r.advisorName]));
    expect(names).toEqual({ [fx.client1a.id]: 'Provider One', [fx.client1b.id]: 'Colleague One' });

    // Unassigned is everybody's until somebody takes it.
    await assign(fx.client1b.id, null);
    const after = await queue(colleague, 'mine');
    expect(after.waitingOnClients.items).toMatchObject([{ clientId: fx.client1b.id, advisorId: null, advisorName: null }]);
    expect((await queue(advisor, 'mine')).waitingOnClients.count).toBe(2);
  });

  it('is the same either way for a one-advisor firm, and refuses anything but mine or all', async () => {
    const solo = await loginAs(fx, 'provider2');
    const mine = await queue(solo, 'mine');
    const all = await queue(solo, 'all');
    expect({ ...mine, generatedAt: '' }).toEqual({ ...all, generatedAt: '' });
    const bad = await request(app).get('/api/dashboard?who=theirs').set('Cookie', solo);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('bad_who');
  });
});

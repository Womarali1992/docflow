/**
 * F7 of the firm book (docs/FIRM-BOOK-PLAN.md): a client's address is unique
 * within a firm, not across the install. The same person can be a client of
 * two firms. The password decides which account a sign-in opens; only when it
 * opens more than one is the person asked which firm, and then only the firms
 * it opened are named.
 */
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { createFirmWithOwner } from '../src/db/firms.js';
import { render } from '../src/jobs/handlers/email.js';
import type { MailJobPayload } from '../src/jobs/mail.js';
import { PASSWORD, app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

const OTHER_PASSWORD = 'other-password-456';

/** Client 1A's address as a client of another firm too, written in a case of its own. */
async function sameAddressAt(firmId: string, password: string, tag: string) {
  const [c] = await db
    .insert(schema.clients)
    .values({
      firmId,
      name: `Client 1A at ${tag}`,
      email: 'C1A@Example.Test',
      emailNormalized: 'c1a@example.test',
      passwordHash: bcrypt.hashSync(password, 4),
      accountId: `CL-${tag}`,
    })
    .returning();
  return c;
}

/** A firm with nobody else in it: its owner is never used. */
async function thirdFirm(): Promise<string> {
  const owner = await createFirmWithOwner({ name: 'Owner Three', email: 'p3@example.test', passwordHash: null, firmName: 'Firm Three' });
  return owner.firmId;
}

const login = (body: { email: string; password: string; firmId?: string }) =>
  request(app).post('/api/auth/login').send({ kind: 'client', ...body });

describe('a client address per firm', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('the same address can be a client of two firms, and only once of each', async () => {
    const one = await loginAs(fx, 'provider1');
    const two = await loginAs(fx, 'provider2');

    const elsewhere = await request(app).post('/api/clients').set('Cookie', two).send({ name: 'Also 1A', email: 'C1A@Example.test' });
    expect(elsewhere.status, JSON.stringify(elsewhere.body)).toBe(201);

    const again = await request(app).post('/api/clients').set('Cookie', one).send({ name: 'Twice 1A', email: 'c1a@EXAMPLE.test' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('email_taken');

    // Moving an address onto another of the firm's clients is refused; onto another firm's is not.
    const onto = await request(app).patch(`/api/clients/${fx.client1b.id}`).set('Cookie', one).send({ email: 'C1A@example.test' });
    expect(onto.status).toBe(409);
    const across = await request(app).patch(`/api/clients/${fx.client2a.id}`).set('Cookie', two).send({ email: fx.client1b.email });
    expect(across.status).toBe(200);

    // The database holds the same line when two requests race past the check.
    await expect(sameAddressAt(fx.provider1.firmId, PASSWORD, 'Race')).rejects.toMatchObject({ code: '23505' });
  });

  it('a password that opens one account signs straight in to that one', async () => {
    const twin = await sameAddressAt(fx.provider2.firmId, OTHER_PASSWORD, 'Two');

    const mine = await login({ email: 'c1a@example.test', password: PASSWORD });
    expect(mine.status).toBe(200);
    expect(mine.body.me.id).toBe(fx.client1a.id);

    const theirs = await login({ email: 'C1A@EXAMPLE.TEST', password: OTHER_PASSWORD });
    expect(theirs.status).toBe(200);
    expect(theirs.body.me.id).toBe(twin.id);

    const neither = await login({ email: 'c1a@example.test', password: 'not-either-one' });
    expect(neither.status).toBe(401);
    expect(neither.body).toEqual({ error: 'Invalid credentials' });
  });

  it('a password that opens two accounts asks which firm, and names only those', async () => {
    const twin = await sameAddressAt(fx.provider2.firmId, PASSWORD, 'Two');
    const three = await thirdFirm();
    await sameAddressAt(three, OTHER_PASSWORD, 'Three');

    const asked = await login({ email: 'c1a@example.test', password: PASSWORD });
    expect(asked.status).toBe(409);
    expect(asked.body.code).toBe('choose_firm');
    expect(asked.body.firms).toEqual([
      { id: fx.provider1.firmId, name: 'Provider One CPA' },
      { id: fx.provider2.firmId, name: 'Provider Two CPA' },
    ]);
    expect(asked.headers['set-cookie']).toBeUndefined();

    const chosen = await login({ email: 'c1a@example.test', password: PASSWORD, firmId: fx.provider2.firmId });
    expect(chosen.status).toBe(200);
    expect(chosen.body.me.id).toBe(twin.id);
    expect(chosen.headers['set-cookie']).toBeDefined();

    // Naming a firm does not get round its password, and a firm without the address opens nothing.
    expect((await login({ email: 'c1a@example.test', password: PASSWORD, firmId: three })).status).toBe(401);
    await db.delete(schema.clients).where(eq(schema.clients.id, twin.id));
    const gone = await login({ email: 'c1a@example.test', password: PASSWORD, firmId: fx.provider2.firmId });
    expect(gone.status).toBe(401);
    expect(gone.body).toEqual({ error: 'Invalid credentials' });
  });

  it('a reset request sends a link for each firm, signed by that firm', async () => {
    const twin = await sameAddressAt(fx.provider2.firmId, OTHER_PASSWORD, 'Two');
    // A deactivated account at a third firm gets nothing, as before.
    const gone = await sameAddressAt(await thirdFirm(), OTHER_PASSWORD, 'Three');
    await db.update(schema.clients).set({ deactivatedAt: new Date() }).where(eq(schema.clients.id, gone.id));

    process.env.SMTP_URL = 'smtp://user:pass@localhost:1025';
    try {
      const res = await request(app).post('/api/auth/password-reset/request').send({ email: 'c1a@example.test', kind: 'client' });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ ok: true });
    } finally {
      delete process.env.SMTP_URL;
    }

    const resets = await db.select().from(schema.passwordResets);
    expect(resets.map((r) => r.userId).sort()).toEqual([fx.client1a.id, twin.id].sort());
    const sent = (await db.select().from(schema.jobs)).map((j) => j.payload as MailJobPayload);
    expect(sent.map((p) => [p.to, p.firmName]).sort()).toEqual([
      ['C1A@Example.Test', 'Provider Two CPA'],
      [fx.client1a.email, 'Provider One CPA'],
    ].sort());
    for (const p of sent) expect(render(p).text).toContain(`your DocFlow account with ${p.firmName}.`);
  });
});

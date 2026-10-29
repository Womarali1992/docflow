/**
 * The firm is the tenant (docs/FIRM-BOOK-PLAN.md). Every row the app writes
 * carries its firm, and no table names an advisor as its tenant any more (F9
 * dropped `provider_id`), and a client is assigned to the advisor who added
 * them. Who may *see* a row is pinned in the authz matrix,
 * where `colleague1` is answered exactly as the advisor whose client it is.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, pool, schema } from '../src/db/client.js';
import { app, loginAs, request, seedFixture, type Fixture } from './helpers.js';

const TENANT_TABLES = ['clients', 'engagements', 'requests', 'documents', 'messages', 'activities', 'request_templates'];

/** Rows that sit in a firm other than `firmId`. */
async function strays(table: string, firmId: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "${table}" WHERE firm_id <> $1`, [firmId]);
  return rows[0].n;
}

describe('firm', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await seedFixture();
  });

  it('no table keeps an advisor as its tenant, and providers no longer hold the firm name (F9)', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND (column_name = 'provider_id' OR (table_name = 'providers' AND column_name = 'firm_name'))
        ORDER BY table_name`
    );
    // The invitee of a staff invitation is a person, not a tenant: that `provider_id` stays.
    expect(rows).toEqual([{ table_name: 'staff_invitations', column_name: 'provider_id' }]);
  });

  it('every row the app writes carries the firm', async () => {
    // Firm 2 is not in this story; without it every row left is the app's or firm 1's fixture.
    await pool.query('DELETE FROM clients WHERE firm_id = $1', [fx.provider2.firmId]);
    await pool.query('DELETE FROM activities WHERE firm_id = $1', [fx.provider2.firmId]);
    const advisor = await loginAs(fx, 'provider1');
    const client = await loginAs(fx, 'client1a');

    const created = await request(app)
      .post('/api/clients')
      .set('Cookie', advisor)
      .send({ name: 'New Client', email: 'new.client@example.test' });
    expect(created.status).toBe(201);
    const engagement = await request(app)
      .post('/api/engagements')
      .set('Cookie', advisor)
      .send({ clientId: created.body.id, title: '2026 Individual Tax Return', kind: 'individual_tax' });
    expect(engagement.status).toBe(201);
    const lines = await request(app)
      .post(`/api/engagements/${engagement.body.id}/requests`)
      .set('Cookie', advisor)
      .send({ items: [{ title: 'W-2' }, { title: '1099-INT' }] });
    expect(lines.status).toBe(201);
    expect((await request(app).get('/api/templates').set('Cookie', advisor)).status).toBe(200);
    expect(
      (await request(app).post('/api/documents').set('Cookie', advisor).send({ clientId: created.body.id, name: 'Engagement letter' })).status
    ).toBe(201);
    expect(
      (await request(app).post('/api/messages').set('Cookie', advisor).send({ clientId: created.body.id, content: 'Welcome aboard' })).status
    ).toBe(201);
    expect((await request(app).post('/api/messages').set('Cookie', client).send({ content: 'A question' })).status).toBe(201);

    const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, created.body.id));
    expect(row.firmId).toBe(fx.provider1.firmId);
    expect(row.assignedProviderId).toBe(fx.provider1.id);
    expect((await db.select().from(schema.requestTemplates)).length).toBeGreaterThan(0);
    for (const table of TENANT_TABLES) expect(await strays(table, fx.provider1.firmId), table).toBe(0);
  });

  it('the portal names the assigned advisor, or the firm while there is nobody to name', async () => {
    const colleague = fx.colleague1;
    const cookie = await loginAs(fx, 'client1a');
    const named = async () => (await request(app).get('/api/auth/me').set('Cookie', cookie)).body.me.providerName;
    const assign = (id: string | null) =>
      db.update(schema.clients).set({ assignedProviderId: id }).where(eq(schema.clients.id, fx.client1a.id));

    expect(await named()).toBe('Provider One');
    await assign(colleague.id);
    expect(await named()).toBe('Colleague One');
    // Their advisor has left: the firm, not a name nobody will answer to.
    await db.update(schema.providers).set({ deactivatedAt: new Date() }).where(eq(schema.providers.id, colleague.id));
    expect(await named()).toBe('Provider One CPA');
    await assign(null);
    expect(await named()).toBe('Provider One CPA');
  });

  it('an advisor sees the name of the firm', async () => {
    await db.update(schema.firms).set({ name: 'Renamed & Co' }).where(eq(schema.firms.id, fx.provider1.firmId));
    const cookie = await loginAs(fx, 'provider1');
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.me.firmName).toBe('Renamed & Co');
  });

  it('two advisors are two firms, and no firm shares an id with an advisor', async () => {
    expect(fx.provider1.firmId).not.toBe(fx.provider2.firmId);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM firms f JOIN providers p ON p.id = f.id');
    expect(rows[0].n).toBe(0);
  });
});

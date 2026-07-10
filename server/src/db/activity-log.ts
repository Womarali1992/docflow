import { eq } from 'drizzle-orm';
import { db, schema } from './client.js';

export type ActivityType = 'document' | 'message' | 'update';

export async function recordActivity(input: {
  providerId: string;
  clientId?: string | null;
  type: ActivityType;
  description: string;
  actorKind?: 'provider' | 'client';
  actorId?: string;
  actorName?: string;
  targetId?: string;
}) {
  try {
    await db.insert(schema.activities).values({
      providerId: input.providerId,
      clientId: input.clientId ?? null,
      type: input.type,
      description: input.description,
      actorKind: input.actorKind,
      actorId: input.actorId,
      actorName: input.actorName,
      targetId: input.targetId,
    });
    if (input.clientId) {
      await db
        .update(schema.clients)
        .set({ lastActivity: new Date() })
        .where(eq(schema.clients.id, input.clientId));
    }
  } catch (err) {
    // Activity logging is best-effort; never fail the original request because of it.
    console.error('recordActivity failed:', err);
  }
}

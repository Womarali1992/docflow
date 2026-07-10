import { pgTable, uuid, text, timestamp, boolean, jsonb, pgEnum, integer, numeric, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const requestFrequencyEnum = pgEnum('request_frequency', [
  'daily',
  'monthly',
  'quarterly',
  'yearly',
  'one-time',
]);

export const actorKindEnum = pgEnum('actor_kind', ['provider', 'client']);

export const documentStatusEnum = pgEnum('document_status', [
  'pending',
  'reviewed',
  'needs_update',
  'in_review',
]);

export const activityTypeEnum = pgEnum('activity_type', ['document', 'message', 'update']);

/* =========================================================
   Providers (CPA firms / advisors)
   ========================================================= */
export const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firmName: text('firm_name'),
  role: text('role').notNull().default('advisor'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/* =========================================================
   Clients (belong to a provider; can optionally log in)
   ========================================================= */
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    accountId: text('account_id').notNull(),
    plan: text('plan').default('Core'),
    clientSince: text('client_since'),
    aum: numeric('aum', { precision: 14, scale: 2 }),
    lastActivity: timestamp('last_activity', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerIdx: index('clients_provider_idx').on(t.providerId),
    emailIdx: index('clients_email_idx').on(t.email),
  })
);

/* =========================================================
   Documents
   ========================================================= */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    type: text('type'),
    size: text('size'),
    folder: text('folder').default('Documents'),
    url: text('url'),

    storagePath: text('storage_path'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),

    uploadedByKind: actorKindEnum('uploaded_by_kind'),
    uploadedById: uuid('uploaded_by_id'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),

    isRequested: boolean('is_requested').default(false),
    requestedById: uuid('requested_by_id'),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    description: text('description'),
    requestFrequency: requestFrequencyEnum('request_frequency'),
    dueDate: timestamp('due_date', { withTimezone: true }),

    hasUpdateRequest: boolean('has_update_request').default(false),
    updateRequestedById: uuid('update_requested_by_id'),
    updateRequestedAt: timestamp('update_requested_at', { withTimezone: true }),
    updateRequestDescription: text('update_request_description'),
    requestedVersion: text('requested_version'),

    status: documentStatusEnum('status').default('pending'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clientIdx: index('documents_client_idx').on(t.clientId),
    providerIdx: index('documents_provider_idx').on(t.providerId),
  })
);

/* =========================================================
   Messages (threaded against a client; optionally bound to a doc)
   ========================================================= */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    senderKind: actorKindEnum('sender_kind').notNull(),
    senderId: uuid('sender_id').notNull(),
    senderName: text('sender_name').notNull(),
    content: text('content').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clientIdx: index('messages_client_idx').on(t.clientId),
    docIdx: index('messages_doc_idx').on(t.documentId),
  })
);

/* =========================================================
   Activity log
   ========================================================= */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    type: activityTypeEnum('type').notNull(),
    description: text('description').notNull(),
    actorKind: actorKindEnum('actor_kind'),
    actorId: uuid('actor_id'),
    actorName: text('actor_name'),
    targetId: uuid('target_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerIdx: index('activities_provider_idx').on(t.providerId),
  })
);

/* =========================================================
   Document presets
   ========================================================= */
export const presets = pgTable(
  'presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    bins: jsonb('bins').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerIdx: index('presets_provider_idx').on(t.providerId),
  })
);

/* =========================================================
   Relations
   ========================================================= */
export const providersRelations = relations(providers, ({ many }) => ({
  clients: many(clients),
  documents: many(documents),
  presets: many(presets),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  provider: one(providers, { fields: [clients.providerId], references: [providers.id] }),
  documents: many(documents),
  messages: many(messages),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  client: one(clients, { fields: [documents.clientId], references: [clients.id] }),
  provider: one(providers, { fields: [documents.providerId], references: [providers.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  client: one(clients, { fields: [messages.clientId], references: [clients.id] }),
  provider: one(providers, { fields: [messages.providerId], references: [providers.id] }),
  document: one(documents, { fields: [messages.documentId], references: [documents.id] }),
}));

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type Preset = typeof presets.$inferSelect;
export type NewPreset = typeof presets.$inferInsert;

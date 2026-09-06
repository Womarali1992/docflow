import { pgTable, uuid, text, timestamp, boolean, jsonb, pgEnum, integer, numeric, index, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

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

/* preauth = password accepted, second factor pending · mfa_enroll = no authenticator yet · active = fully signed in */
export const sessionStageEnum = pgEnum('session_stage', ['preauth', 'mfa_enroll', 'active']);

/* ---- Workflow model (C2.1). `imported` marks everything the legacy import created. ---- */
export const engagementKindEnum = pgEnum('engagement_kind', ['individual_tax', 'business_tax', 'other', 'imported']);
export const engagementStatusEnum = pgEnum('engagement_status', ['open', 'closed']);
export const requestStatusEnum = pgEnum('request_status', [
  'requested',
  'submitted',
  'in_review',
  'needs_correction',
  'accepted',
  'waived',
]);
export const documentKindEnum = pgEnum('document_kind', ['client_upload', 'deliverable', 'imported']);
/* Only `clean` versions are ever served (invariant 3); `error` means the scanner failed, not the file. */
export const scanStatusEnum = pgEnum('scan_status', ['pending', 'clean', 'infected', 'encrypted', 'error']);
export const reviewDecisionEnum = pgEnum('review_decision', ['accepted', 'needs_correction']);
export const templateKindEnum = pgEnum('template_kind', ['individual_tax', 'business_tax', 'custom']);

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
  /* Set by the admin CLI; a deactivated account cannot sign in and its sessions are revoked. */
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
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
    /* lower(trim(email)), filled by the C2.1 import. The unique index is a separate
       C5.4 migration that fails loudly if duplicates are still present. */
    emailNormalized: text('email_normalized'),
    /* Set by the advisor (or the admin CLI); reversible. Sessions are revoked, sign-in refused. */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
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

    /* ---- Workflow model (C2.1). Every column here is nullable on purpose: a row
       with `kind` still null has not been through the legacy import yet, which is
       what makes the import idempotent and gives its report something to count.
       C5.4 tightens these and drops the legacy columns above. ---- */
    engagementId: uuid('engagement_id').references(() => engagements.id, { onDelete: 'set null' }),
    requestId: uuid('request_id').references(() => requests.id, { onDelete: 'set null' }),
    kind: documentKindEnum('kind'),
    displayName: text('display_name'),
    category: text('category'),
    /* The version served today. Circular with document_versions.documentId, hence the annotation. */
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => documentVersions.id, {
      onDelete: 'set null',
    }),
    /* A deliverable with sharedAt null is private: the client gets a 404, not a 403. */
    sharedAt: timestamp('shared_at', { withTimezone: true }),
    sharedById: uuid('shared_by_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clientIdx: index('documents_client_idx').on(t.clientId),
    providerIdx: index('documents_provider_idx').on(t.providerId),
    engagementIdx: index('documents_client_engagement_idx').on(t.clientId, t.engagementId),
    requestIdx: index('documents_request_idx').on(t.requestId),
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
   Sessions (opaque server-side sessions; the cookie carries a random token,
   the row stores its sha256). userId is polymorphic over providers/clients.
   ========================================================= */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    userKind: actorKindEnum('user_kind').notNull(),
    userId: uuid('user_id').notNull(),
    stage: sessionStageEnum('stage').notNull().default('preauth'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userKind, t.userId),
  })
);

/* =========================================================
   MFA: one TOTP secret per user (AES-256-GCM at rest), enrolled once
   enrolledAt is set; lastUsedStep blocks replay of an accepted code.
   ========================================================= */
export const mfaTotp = pgTable(
  'mfa_totp',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userKind: actorKindEnum('user_kind').notNull(),
    userId: uuid('user_id').notNull(),
    secretEnc: text('secret_enc').notNull(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }),
    lastUsedStep: integer('last_used_step'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userUnique: uniqueIndex('mfa_totp_user_unique').on(t.userKind, t.userId),
  })
);

/* Recovery codes: 10 per enrollment, bcrypt-hashed, single use. */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userKind: actorKindEnum('user_kind').notNull(),
    userId: uuid('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('recovery_codes_user_idx').on(t.userKind, t.userId),
  })
);

/* =========================================================
   Invitations: a client's first (or replacement) sign-in link. The raw token
   travels in the link only; the row keeps its sha256. Single use, 7 days.
   ========================================================= */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdById: uuid('created_by_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clientIdx: index('invitations_client_idx').on(t.clientId),
  })
);

/* Password resets: single use, 1 hour; completing one revokes every session. */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userKind: actorKindEnum('user_kind').notNull(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('password_resets_user_idx').on(t.userKind, t.userId),
  })
);

/* =========================================================
   Jobs: the background queue (email, scan retries, sweeping). Claimed with
   FOR UPDATE SKIP LOCKED so several workers can share the table. A job is
   pending while doneAt is null and attempts < maxAttempts; past that it is
   failed and stays for the ops panel to show. dedupeKey collapses duplicates
   (one reminder per client per day, C4.3).
   ========================================================= */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    runAt: timestamp('run_at', { withTimezone: true }).defaultNow().notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    dedupeKey: text('dedupe_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Partial: the worker only ever looks at unfinished rows.
    pendingIdx: index('jobs_run_at_idx').on(t.runAt).where(sql`${t.doneAt} is null`),
  })
);

/* =========================================================
   Engagements: the unit of work a request checklist hangs off, e.g. "2026
   Individual Tax Return". The legacy import gives every client exactly one
   `imported` engagement so nothing is orphaned.
   ========================================================= */
export const engagements = pgTable(
  'engagements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: engagementKindEnum('kind').notNull().default('other'),
    taxYear: integer('tax_year'),
    status: engagementStatusEnum('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clientIdx: index('engagements_client_idx').on(t.clientId),
    providerIdx: index('engagements_provider_idx').on(t.providerId),
  })
);

/* =========================================================
   Requests: one line of a checklist. "Overdue" is never stored — it is derived
   from status ∈ {requested, needs_correction} and a dueDate in the past, so it
   can never drift. A client's "I don't have this" answer is recorded in the
   clientResponse* columns and leaves the status alone: only the advisor decides.
   ========================================================= */
export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    instructions: text('instructions'),
    category: text('category'),
    required: boolean('required').notNull().default(true),
    dueDate: timestamp('due_date', { withTimezone: true }),
    status: requestStatusEnum('status').notNull().default('requested'),
    sortOrder: integer('sort_order').notNull().default(0),
    templateItemKey: text('template_item_key'),
    waivedReason: text('waived_reason'),
    waivedAt: timestamp('waived_at', { withTimezone: true }),
    waivedById: uuid('waived_by_id'),
    /* The only value today is 'not_applicable'; kept as text so C4.1 can add more without a migration. */
    clientResponseKind: text('client_response_kind'),
    clientResponseNote: text('client_response_note'),
    clientResponseAt: timestamp('client_response_at', { withTimezone: true }),
    /* Set by the legacy import so a second run recognises what it already converted. */
    importedFromDocumentId: uuid('imported_from_document_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    queueIdx: index('requests_provider_status_due_idx').on(t.providerId, t.status, t.dueDate),
    engagementIdx: index('requests_engagement_idx').on(t.engagementId),
    clientIdx: index('requests_client_idx').on(t.clientId),
    importedIdx: index('requests_imported_from_idx').on(t.importedFromDocumentId),
  })
);

/* =========================================================
   Document versions: the immutable heart of the model. Bytes are never
   overwritten (invariant 2) — a replacement is a new row with the next
   versionNo, and only a `clean` version is ever served (invariant 3).
   ========================================================= */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    /* `files/yyyy/mm/<uuid>.<ext>`, relative to DATA_ROOT. Never serialized (invariant 6). */
    storageKey: text('storage_key').notNull().unique(),
    scanStatus: scanStatusEnum('scan_status').notNull().default('pending'),
    scanDetail: text('scan_detail'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    uploadedByKind: actorKindEnum('uploaded_by_kind').notNull(),
    uploadedById: uuid('uploaded_by_id').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    documentIdx: index('document_versions_document_idx').on(t.documentId, t.versionNo),
    versionUnique: uniqueIndex('document_versions_document_version_unique').on(t.documentId, t.versionNo),
  })
);

/* =========================================================
   Reviews: an advisor's decision on one version. Rows are never edited — a
   newer version sends the request back to `submitted` and earns its own review,
   so the history of what was accepted, and when, stays readable.
   ========================================================= */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').references(() => documentVersions.id, { onDelete: 'set null' }),
    requestId: uuid('request_id').references(() => requests.id, { onDelete: 'set null' }),
    reviewerId: uuid('reviewer_id').notNull(),
    decision: reviewDecisionEnum('decision').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    documentIdx: index('reviews_document_idx').on(t.documentId),
    requestIdx: index('reviews_request_idx').on(t.requestId),
  })
);

/* =========================================================
   Request templates: the checklist starting points ("Individual tax return").
   Replaces `presets`; the import converts each preset bin into items.
   ========================================================= */
export const requestTemplates = pgTable(
  'request_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: templateKindEnum('kind').notNull().default('custom'),
    /* [{key, title, category, instructions, required, dueOffsetDays?}] */
    items: jsonb('items').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerIdx: index('request_templates_provider_idx').on(t.providerId),
  })
);

/* =========================================================
   Notifications: server-side unread state for everything that is not a message
   (invariant 15 — the client never computes its own badge). Filled in C4.3.
   ========================================================= */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userKind: actorKindEnum('user_kind').notNull(),
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('notifications_user_idx').on(t.userKind, t.userId),
  })
);

/* =========================================================
   Audit log: APPEND-ONLY (invariant 11 — a trigger raises on UPDATE and DELETE;
   see migration 0007). Never holds passwords, tokens, document bytes or message
   text: it records that something happened, not what was in it.
   ========================================================= */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
    actorKind: text('actor_kind'),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    clientId: uuid('client_id'),
    ip: text('ip'),
    meta: jsonb('meta').notNull().default({}),
  },
  (t) => ({
    atIdx: index('audit_log_at_idx').on(t.at),
    clientIdx: index('audit_log_client_at_idx').on(t.clientId, t.at),
  })
);

/* =========================================================
   Backup runs: written by backup.ps1 through `npm run backup:record` (C5.2), so
   the ops panel can say when the last good backup actually finished.
   ========================================================= */
export const backupRuns = pgTable('backup_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  ok: boolean('ok').notNull().default(false),
  dumpBytes: integer('dump_bytes'),
  fileCount: integer('file_count'),
  manifestPath: text('manifest_path'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

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
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type MfaTotp = typeof mfaTotp.$inferSelect;
export type RecoveryCode = typeof recoveryCodes.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type PasswordReset = typeof passwordResets.$inferSelect;
export type Engagement = typeof engagements.$inferSelect;
export type NewEngagement = typeof engagements.$inferInsert;
export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type RequestTemplate = typeof requestTemplates.$inferSelect;
export type NewRequestTemplate = typeof requestTemplates.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type BackupRun = typeof backupRuns.$inferSelect;
export type EngagementStatus = (typeof engagementStatusEnum.enumValues)[number];
export type RequestStatus = (typeof requestStatusEnum.enumValues)[number];
export type DocumentKind = (typeof documentKindEnum.enumValues)[number];
export type ScanStatus = (typeof scanStatusEnum.enumValues)[number];
export type ReviewDecision = (typeof reviewDecisionEnum.enumValues)[number];
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type SessionStage = (typeof sessionStageEnum.enumValues)[number];
export type NewPreset = typeof presets.$inferInsert;

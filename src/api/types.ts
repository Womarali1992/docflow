// Types mirroring the server schema (see server/src/db/schema.ts).
// Dates are deserialized from ISO strings into Date objects by the API client.

export type ActorKind = 'provider' | 'client';

export interface Provider {
  id: string;
  name: string;
  email: string;
  firmName?: string | null;
}

export interface Client {
  id: string;
  providerId: string;
  name: string;
  email: string;
  accountId: string;
  plan?: string | null;
  clientSince?: string | null;
  aum?: number | null;
  pendingUpdates: number;
  unreadMessages: number;
  documentsCount: number;
  lastActivity: Date | null;
  /** True once the client accepted an invitation (or was given a password): they can sign in. */
  hasPassword: boolean;
  /** Expiry of the newest unused invitation, or null when none is pending. */
  invitePendingUntil: Date | null;
  /** Set while the client is deactivated: sign-in refused, sessions ended; reversible. */
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A one-time link handed to the advisor (email delivery arrives with C1.4). */
export interface OneTimeLink {
  link: string;
  expiresAt: Date;
  emailQueued: boolean;
}

/** GET /invitations/:token — who invited whom, shown before the password is set. */
export interface InvitationInfo {
  clientName: string;
  email: string;
  providerName: string;
  firmName: string | null;
  expiresAt: Date;
}

export interface Document {
  id: string;
  clientId: string;
  providerId: string;
  name: string;
  /** True when bytes are stored for this document; the storage path itself never leaves the server. */
  hasFile: boolean;
  mimeType?: string | null;
  sizeBytes?: number | null;
  uploadedByKind?: ActorKind | null;
  uploadedById?: string | null;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;

  /* ---- Workflow model (C2.1); the only model there is, since C5.4 dropped the
     legacy columns this shape used to mirror. ---- */
  engagementId?: string | null;
  requestId?: string | null;
  /* NOT NULL since 0008_contract; serializeDocument() always sends it. */
  kind: DocumentKind;
  displayName?: string | null;
  category?: string | null;
  currentVersionId?: string | null;
  /** When the advisor shared a deliverable; null means private (the client 404s on it). */
  sharedAt?: Date | null;
  sharedById?: string | null;
  archivedAt?: Date | null;
  /** Server-computed convenience: `sharedAt !== null`. */
  shared?: boolean;
}

export interface Message {
  id: string;
  clientId: string;
  providerId: string;
  documentId?: string | null;
  senderKind: ActorKind;
  senderId: string;
  senderName: string;
  content: string;
  readAt?: Date | null;
  createdAt: Date;
}

export type ActivityType = 'document' | 'message' | 'update';

export interface Activity {
  id: string;
  providerId: string;
  clientId?: string | null;
  type: ActivityType;
  description: string;
  actorKind?: ActorKind | null;
  actorId?: string | null;
  actorName?: string | null;
  targetId?: string | null;
  createdAt: Date;
}

/** A live server session of the current user (GET /auth/sessions). */
export interface SessionSummary {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export type Me =
  | { kind: 'provider'; id: string; name: string; email: string; firmName?: string | null }
  | { kind: 'client';   id: string; name: string; email: string; providerId: string; providerName?: string | null };

/**
 * Where a session stands. `preauth`: password accepted, authenticator code owed.
 * `mfa_enroll`: no authenticator yet, enrollment owed. `active`: fully signed in.
 */
export type SessionStage = 'preauth' | 'mfa_enroll' | 'active';

/** Answer of login and GET /auth/me: identity plus the stage the UI must route on. */
export interface AuthState {
  stage: SessionStage;
  me: Me;
}

/** GET /auth/mfa/status */
export interface MfaStatus {
  stage: SessionStage;
  enrolled: boolean;
  enrolledAt: Date | null;
  recoveryCodesLeft: number;
}

/** POST /auth/mfa/enroll: what the authenticator app needs (QR or the key typed by hand). */
export interface MfaEnrollment {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
  issuer: string;
  account: string;
}

/* ==========================================================================
   Workflow model (C2.1 schema, C2.2 API). Every shape here mirrors a
   serializer in server/src/routes/serialize.ts — where the bytes live
   (`storageKey`) and what they hash to (`sha256`) never reach the browser.
   ========================================================================== */

export type EngagementKind = 'individual_tax' | 'business_tax' | 'other' | 'imported';
export type EngagementStatus = 'open' | 'closed';
export type RequestStatus = 'requested' | 'submitted' | 'in_review' | 'needs_correction' | 'accepted' | 'waived';
export type DocumentKind = 'client_upload' | 'deliverable' | 'imported';
/** Only `clean` is ever served; `error` means the scanner failed, not the file. */
export type ScanStatus = 'pending' | 'clean' | 'infected' | 'encrypted' | 'error';
export type ReviewDecision = 'accepted' | 'needs_correction';
export type TemplateKind = 'individual_tax' | 'business_tax' | 'custom';

/**
 * Where an engagement's checklist stands, counted on the server.
 *
 * `outstanding` is with the client, `submitted` is with the advisor, and
 * `overdue` is a slice of `outstanding` — deliberately overlapping, because
 * "late" and "waiting" are two different questions about the same line.
 */
export interface EngagementCounts {
  total: number;
  outstanding: number;
  submitted: number;
  accepted: number;
  waived: number;
  overdue: number;
}

/** The unit of work a checklist hangs off ("2026 Individual Tax Return"). */
export interface Engagement {
  id: string;
  clientId: string;
  providerId: string;
  title: string;
  kind: EngagementKind;
  taxYear: number | null;
  status: EngagementStatus;
  closedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Only on the list route: a single engagement is read with its requests anyway. */
  requestCounts?: EngagementCounts;
}

/**
 * One line of a checklist. `overdue` is computed by the server on every read
 * (invariant 15) — never derive it in the browser, the two clocks disagree.
 */
export interface RequestItem {
  id: string;
  engagementId: string;
  clientId: string;
  providerId: string;
  title: string;
  instructions: string | null;
  category: string | null;
  required: boolean;
  dueDate: Date | null;
  status: RequestStatus;
  sortOrder: number;
  overdue: boolean;
  waivedReason: string | null;
  waivedAt: Date | null;
  /** The only value today is 'not_applicable' — "I don't have this". */
  clientResponseKind: string | null;
  clientResponseNote: string | null;
  clientResponseAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNo: number;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number;
  scanStatus: ScanStatus;
  scannedAt: Date | null;
  uploadedByKind: ActorKind;
  uploadedById: string;
  publishedAt: Date | null;
  supersededAt: Date | null;
  createdAt: Date;
  /** Scanned clean *and* published: the only state that can actually be fetched. */
  available: boolean;
}

export interface Review {
  id: string;
  documentId: string;
  versionId: string | null;
  requestId: string | null;
  reviewerId: string;
  decision: ReviewDecision;
  note: string | null;
  createdAt: Date;
}

/** GET /documents/:id/versions — a version with the decision made about it. */
export interface VersionWithReviews extends DocumentVersion {
  reviews: Review[];
  isCurrent: boolean;
}

/** The slice of a version an engagement list row needs. */
export interface VersionSummary {
  id: string;
  versionNo: number;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number;
  scanStatus: ScanStatus;
  available: boolean;
  createdAt: Date;
}

export interface EngagementDocument extends Document {
  currentVersion: VersionSummary | null;
}

/** GET /engagements/:id — the whole screen in one round trip. */
export interface EngagementTree {
  engagement: Engagement;
  requests: RequestItem[];
  documents: EngagementDocument[];
}

export interface TemplateItem {
  key: string;
  title: string;
  category?: string | null;
  instructions?: string | null;
  required?: boolean;
  dueOffsetDays?: number;
}

export interface RequestTemplate {
  id: string;
  providerId: string;
  name: string;
  kind: TemplateKind;
  items: TemplateItem[];
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One home-queue tile: the number, and the ids behind it so a list can open. */
export interface DashboardBucket<T> {
  count: number;
  ids: string[];
  items: T[];
}

export interface DashboardRequestRef {
  id: string;
  clientId: string;
  /** Where the line lives, so a queue row can open the checklist it came from. */
  engagementId: string;
  title: string;
  dueDate?: Date | null;
  note?: string | null;
}

export interface DashboardSummary {
  generatedAt: string;
  readyToReview: DashboardBucket<DashboardRequestRef>;
  waitingOnClients: DashboardBucket<DashboardRequestRef>;
  overdue: DashboardBucket<DashboardRequestRef>;
  needsDecision: DashboardBucket<DashboardRequestRef>;
  unreadMessages: DashboardBucket<{ id: string; clientId: string }>;
}

export interface SearchParams {
  q?: string;
  clientId?: string;
  category?: string;
  status?: RequestStatus;
  year?: number;
}

export interface SearchResults {
  query: string;
  truncated: boolean;
  documents: Document[];
  requests: RequestItem[];
}

export interface Notification {
  id: string;
  userKind: ActorKind;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationList {
  unread: number;
  notifications: Notification[];
}

/**
 * GET /ops/status (v2, C5.2) — advisor only.
 *
 * Counts and timestamps, never a document or a client name: the system panel
 * can be left open on a screen in a shared office.
 */
export interface OpsStatus {
  time: string;
  firmTimezone: string;
  jobs: {
    pending: number;
    running: number;
    failed: number;
    done: number;
    oldestPendingAt: string | null;
  };
  scanner: {
    required: boolean;
    reachable: boolean;
    endpoint: string;
    /** When the scanner's signature database was built, if it says. */
    signaturesAt: string | null;
    note: string | null;
  };
  storage: {
    path: string;
    freeBytes: number | null;
    totalBytes: number | null;
    note: string | null;
  };
  backups: {
    lastRunAt: string | null;
    lastRunOk: boolean | null;
    lastGoodAt: string | null;
    lastGoodFiles: number | null;
    lastGoodDumpBytes: number | null;
    lastError: string | null;
    note: string | null;
  };
  health: {
    /** Uploads that stored bytes but never published — the pipeline stalled. */
    unpublishedVersions: number;
    quarantinedVersions: number;
    activeSessions: number;
  };
  mail: {
    configured: boolean;
    note: string | null;
  };
}

/**
 * The answer every upload route gives. 201 = published and readable;
 * 202 = stored, still being checked (`code` says why, `version.available` is false).
 */
export interface UploadResult {
  document: Document;
  version: DocumentVersion;
  scanStatus: ScanStatus;
  code?: string;
  message?: string;
  /** 201 or 202 — the caller needs to tell "ready" from "still checking". */
  status: number;
}

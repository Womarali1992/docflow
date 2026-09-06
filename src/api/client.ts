import type {
  Activity,
  AuthState,
  Client,
  DashboardSummary,
  Document,
  Engagement,
  EngagementKind,
  EngagementTree,
  InvitationInfo,
  Message,
  MfaEnrollment,
  MfaStatus,
  NotificationList,
  OneTimeLink,
  OpsStatus,
  RequestFrequency,
  RequestItem,
  RequestTemplate,
  Review,
  SearchParams,
  SearchResults,
  SessionStage,
  SessionSummary,
  TemplateItem,
  TemplateKind,
  UploadResult,
  VersionWithReviews,
} from './types';

const BASE = '/api';

const DATE_FIELDS = new Set([
  'createdAt', 'updatedAt', 'uploadedAt', 'requestedAt', 'dueDate',
  'updateRequestedAt', 'lastActivity', 'readAt', 'lastSeenAt', 'expiresAt', 'enrolledAt',
  'deactivatedAt', 'invitePendingUntil', 'passwordChangedAt',
  /* Workflow model (C2.1/C2.2). `generatedAt`, `time` and `oldestPendingAt` are
     deliberately absent: those are timestamps *about* a response, not fields of a
     row, and they stay ISO strings so nothing formats them as local wall time. */
  'closedAt', 'archivedAt', 'waivedAt', 'clientResponseAt', 'sharedAt',
  'scannedAt', 'publishedAt', 'supersededAt',
]);

function reviveDates<T>(obj: unknown): T {
  if (obj === null || obj === undefined) return obj as T;
  if (Array.isArray(obj)) return obj.map((v) => reviveDates(v)) as T;
  if (typeof obj !== 'object') return obj as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === null || v === undefined) {
      out[k] = v;
    } else if (DATE_FIELDS.has(k) && typeof v === 'string') {
      out[k] = new Date(v);
    } else if (typeof v === 'object') {
      out[k] = reviveDates(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/** Error thrown for any non-2xx API response. Carries the HTTP status + parsed body. */
export class ApiError extends Error {
  status: number;
  body: { error?: string; [k: string]: unknown };
  constructor(status: number, body: { error?: string; [k: string]: unknown }) {
    super(body?.error || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Why the server ended the session;  just means there was none. */
export type UnauthorizedReason = 'missing' | 'invalid' | 'revoked' | 'expired' | 'idle';

/** Fired on a 401 (except the login call) so the auth layer can drop the session; detail.reason says why. */
export const UNAUTHORIZED_EVENT = 'docflow:unauthorized';

/** Fired on a 403 `mfa_required` so the auth layer can send the user back to the second step; detail.stage says which. */
export const MFA_REQUIRED_EVENT = 'docflow:mfa-required';

interface ApiInit extends RequestInit {
  /** Background refresh: sends X-DocFlow-Poll so the request keeps the session alive without extending it. */
  poll?: boolean;
}

/** Read options every GET accepts; `poll` marks a background refresh (see `send`). */
export interface ReadOpts {
  poll?: boolean;
}

/**
 * The one place a response is turned into data. Returns the HTTP status beside
 * it because the upload routes answer 201 (published) and 202 (still being
 * checked) with the same body shape, and the difference is what the user is told.
 */
async function send<T>(path: string, init: ApiInit = {}): Promise<{ status: number; data: T }> {
  const { poll, ...rest } = init;
  const isForm = rest.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      // Let the browser set the multipart boundary for FormData bodies.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(poll ? { 'X-DocFlow-Poll': '1' } : {}),
      ...(rest.headers || {}),
    },
  });
  if (!res.ok) {
    let body: { error?: string; code?: string; reason?: UnauthorizedReason; stage?: SessionStage; [k: string]: unknown };
    try { body = await res.json(); } catch { body = { error: res.statusText }; }
    // `/auth/me` is excluded because asking "is there a session?" and being told
    // "no" is that call's ordinary answer — the query maps it to null. Announcing
    // it as a lost session would have the listener clear the cache underneath the
    // very fetch that is establishing it.
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me' && !path.startsWith('/auth/mfa/') && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { reason: body.reason ?? 'missing' } }));
    }
    if (res.status === 403 && body.code === 'mfa_required' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(MFA_REQUIRED_EVENT, { detail: { stage: body.stage ?? 'preauth' } }));
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return { status: res.status, data: undefined as T };
  const data = await res.json();
  return { status: res.status, data: reviveDates<T>(data) };
}

async function request<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { data } = await send<T>(path, init);
  return data;
}

/**
 * One file to an upload endpoint. Progress and cancellation need XMLHttpRequest
 * and arrive with the C4.2 upload queue; this is the plain form the advisor
 * screens use, and it keeps the 201/202 distinction the pipeline answers with.
 */
async function upload(path: string, file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('file', file);
  const { status, data } = await send<Omit<UploadResult, 'status'>>(path, { method: 'POST', body: fd });
  return { ...data, status };
}

export const api = {
  auth: {
    /** Identity plus session stage; works in every stage so a reload lands on the right screen. */
    me: () => request<AuthState>('/auth/me'),
    /** Password step. The answer's `stage` is never `active`: a code or an enrollment follows. */
    login: (email: string, password: string, kind: 'provider' | 'client') =>
      request<AuthState>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, kind }),
      }),
    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
    /** Sign out everywhere: every session of the current user, including this one. */
    logoutAll: () => request<{ ok: true; revoked: number }>('/auth/logout-all', { method: 'POST' }),
    sessions: () => request<SessionSummary[]>('/auth/sessions'),
    signupProvider: (input: { name: string; email: string; password: string; firmName?: string }) =>
      request<AuthState>('/auth/signup-provider', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    /** Change the password while signed in; every other session ends. */
    changePassword: (input: { currentPassword: string; newPassword: string }) =>
      request<{ ok: true; revoked: number }>('/auth/password', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    /** Always accepted: the answer never says whether the account exists. */
    requestPasswordReset: (email: string, kind: 'provider' | 'client') =>
      request<{ ok: true }>('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email, kind }),
      }),
    /** Sets the password from a reset link; every session of the account ends. */
    confirmPasswordReset: (token: string, password: string) =>
      request<{ ok: true }>('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),

    mfa: {
      status: () => request<MfaStatus>('/auth/mfa/status'),
      /** Second step of sign-in: an authenticator code, or one recovery code. */
      verify: (input: { code: string } | { recoveryCode: string }) =>
        request<{ stage: 'active'; recoveryCodesLeft: number }>('/auth/mfa/verify', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      /** Starts (or restarts) enrollment: a fresh secret, QR code and manual key. */
      enroll: () => request<MfaEnrollment>('/auth/mfa/enroll', { method: 'POST' }),
      /** Proves the authenticator works; activates the session; the recovery codes are shown once. */
      confirmEnrollment: (code: string) =>
        request<{ stage: 'active'; recoveryCodes: string[] }>('/auth/mfa/enroll/confirm', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
      /** Replaces every recovery code; needs a fresh authenticator code. */
      regenerateRecoveryCodes: (code: string) =>
        request<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
    },
  },

  clients: {
    list: () => request<Client[]>('/clients'),
    get: (id: string) => request<Client>(`/clients/${id}`),
    create: (input: { name: string; email: string; accountId?: string; plan?: string; aum?: number | null; password?: string }) =>
      request<Client>('/clients', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, patch: Partial<{ name: string; email: string; plan: string; aum: number | null; password: string }>) =>
      request<Client>(`/clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    /** A fresh invitation link (replaces any unused one). */
    invite: (id: string) => request<OneTimeLink>(`/clients/${id}/invitations`, { method: 'POST' }),
    /** A copy-link password reset for a client who already has a password. */
    resetLink: (id: string) => request<OneTimeLink>(`/clients/${id}/password-reset`, { method: 'POST' }),
    deactivate: (id: string) => request<Client>(`/clients/${id}/deactivate`, { method: 'POST' }),
    reactivate: (id: string) => request<Client>(`/clients/${id}/reactivate`, { method: 'POST' }),
  },

  invitations: {
    get: (token: string) => request<InvitationInfo>(`/invitations/${encodeURIComponent(token)}`),
    /** Sets the first password; the answer is a session that still owes its MFA step. */
    accept: (token: string, password: string) =>
      request<AuthState>(`/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
  },

  documents: {
    list: (params?: { clientId?: string; engagementId?: string; kind?: 'client_upload' | 'deliverable' | 'imported'; includeArchived?: boolean }, opts?: ReadOpts) => {
      const sp = new URLSearchParams();
      if (params?.clientId) sp.set('clientId', params.clientId);
      if (params?.engagementId) sp.set('engagementId', params.engagementId);
      if (params?.kind) sp.set('kind', params.kind);
      if (params?.includeArchived) sp.set('includeArchived', 'true');
      const q = sp.toString();
      return request<Document[]>(`/documents${q ? `?${q}` : ''}`, { poll: opts?.poll });
    },
    get: (id: string) => request<Document>(`/documents/${id}`),
    /** Who decided what, about which version — newest first. */
    reviews: (id: string) => request<Review[]>(`/documents/${id}/reviews`),
    /** Ad-hoc uploads only: a document answering a request is decided on the request. */
    accept: (id: string, input?: { versionId?: string; note?: string }) =>
      request<Document>(`/documents/${id}/accept`, { method: 'POST', body: JSON.stringify(input ?? {}) }),
    requestCorrection: (id: string, input: { note: string; versionId?: string }) =>
      request<Document>(`/documents/${id}/request-correction`, { method: 'POST', body: JSON.stringify(input) }),
    /** The moment a deliverable becomes visible to the client. Deliberate, and audited. */
    share: (id: string) => request<Document>(`/documents/${id}/share`, { method: 'POST' }),
    unshare: (id: string) => request<Document>(`/documents/${id}/unshare`, { method: 'POST' }),
    archive: (id: string) => request<Document>(`/documents/${id}/archive`, { method: 'POST' }),
    unarchive: (id: string) => request<Document>(`/documents/${id}/unarchive`, { method: 'POST' }),
    create: (input: {
      clientId: string;
      name: string;
      type?: string;
      folder?: string;
      isRequested?: boolean;
      description?: string;
      requestFrequency?: RequestFrequency;
      dueDate?: string;
    }) =>
      request<Document>('/documents', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, patch: Partial<{
      name: string;
      folder: string;
      isRequested: boolean;
      status: 'pending' | 'reviewed' | 'needs_update' | 'in_review';
      hasUpdateRequest: boolean;
      updateRequestDescription: string;
      requestedVersion: string;
      requestFrequency: RequestFrequency;
      dueDate: string | null;
    }>) =>
      request<Document>(`/documents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    /** Upload (or replace) the stored file for a document. */
    uploadFile: (id: string, file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return request<Document>(`/documents/${id}/file`, { method: 'POST', body: fd });
    },
    /** Same-origin URL for the authenticated download endpoint (usable in <a href>). */
    downloadUrl: (id: string, opts?: { attachment?: boolean }) =>
      `${BASE}/documents/${id}/download${opts?.attachment ? '?disposition=attachment' : ''}`,
    /** Named DELETE, but the server archives: bytes are never removed (invariant 2). */
    remove: (id: string) =>
      request<{ ok: true; archived: true }>(`/documents/${id}`, { method: 'DELETE' }),
  },

  /* ------------------------------------------------------------- workflow */

  engagements: {
    list: (params?: { clientId?: string }, opts?: ReadOpts) => {
      const q = params?.clientId ? `?clientId=${encodeURIComponent(params.clientId)}` : '';
      return request<Engagement[]>(`/engagements${q}`, { poll: opts?.poll });
    },
    /** The whole screen in one call: engagement + checklist + documents. */
    get: (id: string, opts?: ReadOpts) => request<EngagementTree>(`/engagements/${id}`, { poll: opts?.poll }),
    create: (input: { clientId: string; title: string; kind?: EngagementKind; taxYear?: number | null }) =>
      request<Engagement>('/engagements', { method: 'POST', body: JSON.stringify(input) }),
    /** Wording and dates only — the status moves through close/reopen. */
    update: (id: string, patch: Partial<{ title: string; kind: EngagementKind; taxYear: number | null }>) =>
      request<Engagement>(`/engagements/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    close: (id: string) => request<Engagement>(`/engagements/${id}/close`, { method: 'POST' }),
    reopen: (id: string) => request<Engagement>(`/engagements/${id}/reopen`, { method: 'POST' }),
    /** Appends checklist lines — from a template or explicit items, never both. */
    addRequests: (id: string, input: { templateId: string; dueDate?: string | null } | { items: TemplateItem[]; dueDate?: string | null }) =>
      request<RequestItem[]>(`/engagements/${id}/requests`, { method: 'POST', body: JSON.stringify(input) }),
  },

  requests: {
    get: (id: string) => request<RequestItem>(`/requests/${id}`),
    update: (id: string, patch: Partial<{ title: string; instructions: string | null; category: string | null; required: boolean; dueDate: string | null; sortOrder: number }>) =>
      request<RequestItem>(`/requests/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    accept: (id: string, input?: { versionId?: string; note?: string }) =>
      request<RequestItem>(`/requests/${id}/accept`, { method: 'POST', body: JSON.stringify(input ?? {}) }),
    /** The note is required: the client reads it as the instruction to fix. */
    requestCorrection: (id: string, input: { note: string; versionId?: string }) =>
      request<RequestItem>(`/requests/${id}/request-correction`, { method: 'POST', body: JSON.stringify(input) }),
    /** A reason is required — the file has to answer "why is this not on the list?". */
    waive: (id: string, reason: string) =>
      request<RequestItem>(`/requests/${id}/waive`, { method: 'POST', body: JSON.stringify({ reason }) }),
    reopen: (id: string) => request<RequestItem>(`/requests/${id}/reopen`, { method: 'POST' }),
    /** "I don't have this" — recorded, and deliberately does not move the status. */
    respond: (id: string, input: { kind: 'not_applicable'; note?: string }) =>
      request<RequestItem>(`/requests/${id}/respond`, { method: 'POST', body: JSON.stringify(input) }),
  },

  versions: {
    /** Newest first, each with the decision made about that version. */
    list: (documentId: string) => request<VersionWithReviews[]>(`/documents/${documentId}/versions`),
    downloadUrl: (documentId: string, versionId: string) => `${BASE}/documents/${documentId}/versions/${versionId}/download`,
    /** PDF and images only; anything else answers 415 `not_previewable`. */
    previewUrl: (documentId: string, versionId: string) => `${BASE}/documents/${documentId}/versions/${versionId}/preview`,
  },

  /**
   * The three ways bytes enter DocFlow. All three answer 201 (published) or 202
   * (stored, still being checked) with the same shape — `status` carries which.
   */
  uploads: {
    toRequest: (requestId: string, file: File) => upload(`/requests/${requestId}/uploads`, file),
    toEngagement: (engagementId: string, file: File) => upload(`/engagements/${engagementId}/uploads`, file),
    newVersion: (documentId: string, file: File) => upload(`/documents/${documentId}/versions`, file),
  },

  templates: {
    list: () => request<RequestTemplate[]>('/templates'),
    get: (id: string) => request<RequestTemplate>(`/templates/${id}`),
    create: (input: { name: string; kind?: TemplateKind; items: TemplateItem[] }) =>
      request<RequestTemplate>('/templates', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, patch: Partial<{ name: string; kind: TemplateKind; items: TemplateItem[] }>) =>
      request<RequestTemplate>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    /** Archives rather than deletes: last year's engagements keep their references. */
    remove: (id: string) => request<{ ok: true; archived: true }>(`/templates/${id}`, { method: 'DELETE' }),
  },

  dashboard: {
    get: (opts?: ReadOpts) => request<DashboardSummary>('/dashboard', { poll: opts?.poll }),
  },

  search: {
    run: (params: SearchParams, opts?: ReadOpts) => {
      const sp = new URLSearchParams();
      if (params.q) sp.set('q', params.q);
      if (params.clientId) sp.set('clientId', params.clientId);
      if (params.category) sp.set('category', params.category);
      if (params.status) sp.set('status', params.status);
      if (params.year !== undefined) sp.set('year', String(params.year));
      const q = sp.toString();
      return request<SearchResults>(`/search${q ? `?${q}` : ''}`, { poll: opts?.poll });
    },
  },

  notifications: {
    list: (params?: { unread?: boolean }, opts?: ReadOpts) =>
      request<NotificationList>(`/notifications${params?.unread ? '?unread=true' : ''}`, { poll: opts?.poll }),
    /** No ids marks everything of the caller's read. */
    markRead: (ids?: string[]) =>
      request<{ ok: true; marked: number }>('/notifications/read', {
        method: 'POST',
        body: JSON.stringify(ids?.length ? { ids } : {}),
      }),
  },

  ops: {
    /** Advisor only — queue depth, scanner and mail. Grows into the C5.2 panel. */
    status: (opts?: ReadOpts) => request<OpsStatus>('/ops/status', { poll: opts?.poll }),
  },

  messages: {
    list: (params: { clientId?: string; documentId?: string }, opts?: ReadOpts) => {
      const sp = new URLSearchParams();
      if (params.clientId) sp.set('clientId', params.clientId);
      if (params.documentId) sp.set('documentId', params.documentId);
      const q = sp.toString();
      return request<Message[]>(`/messages${q ? `?${q}` : ''}`, { poll: opts?.poll });
    },
    send: (input: { clientId?: string; documentId?: string; content: string }) =>
      request<Message>('/messages', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    markRead: (params: { clientId?: string; documentId?: string }) =>
      request<{ updated: number }>('/messages/read', {
        method: 'PATCH',
        body: JSON.stringify(params),
      }),
  },

  activities: {
    list: (params?: { clientId?: string; limit?: number }) => {
      const sp = new URLSearchParams();
      if (params?.clientId) sp.set('clientId', params.clientId);
      if (params?.limit) sp.set('limit', String(params.limit));
      const q = sp.toString();
      return request<Activity[]>(`/activities${q ? `?${q}` : ''}`);
    },
  },

};

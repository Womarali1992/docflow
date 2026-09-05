import type {
  Activity,
  AuthState,
  Client,
  Document,
  InvitationInfo,
  Message,
  MfaEnrollment,
  MfaStatus,
  OneTimeLink,
  Preset,
  RequestFrequency,
  SessionStage,
  SessionSummary,
} from './types';

const BASE = '/api';

const DATE_FIELDS = new Set([
  'createdAt', 'updatedAt', 'uploadedAt', 'requestedAt', 'dueDate',
  'updateRequestedAt', 'lastActivity', 'readAt', 'lastSeenAt', 'expiresAt', 'enrolledAt',
  'deactivatedAt', 'invitePendingUntil', 'passwordChangedAt',
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

async function request<T>(path: string, init: ApiInit = {}): Promise<T> {
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
    if (res.status === 401 && path !== '/auth/login' && !path.startsWith('/auth/mfa/') && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { reason: body.reason ?? 'missing' } }));
    }
    if (res.status === 403 && body.code === 'mfa_required' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(MFA_REQUIRED_EVENT, { detail: { stage: body.stage ?? 'preauth' } }));
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  return reviveDates<T>(data);
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
    list: (params?: { clientId?: string }) => {
      const q = params?.clientId ? `?clientId=${encodeURIComponent(params.clientId)}` : '';
      return request<Document[]>(`/documents${q}`);
    },
    get: (id: string) => request<Document>(`/documents/${id}`),
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
    remove: (id: string) =>
      request<{ ok: true }>(`/documents/${id}`, { method: 'DELETE' }),
  },

  messages: {
    list: (params: { clientId?: string; documentId?: string }) => {
      const sp = new URLSearchParams();
      if (params.clientId) sp.set('clientId', params.clientId);
      if (params.documentId) sp.set('documentId', params.documentId);
      const q = sp.toString();
      return request<Message[]>(`/messages${q ? `?${q}` : ''}`);
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

  presets: {
    list: () => request<Preset[]>('/presets'),
    create: (input: { name: string; bins: Preset['bins'] }) =>
      request<Preset>('/presets', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    remove: (id: string) =>
      request<{ ok: true }>(`/presets/${id}`, { method: 'DELETE' }),
  },
};

import type { Activity, Client, Document, Me, Message, Preset, RequestFrequency } from './types';

const BASE = '/api';

const DATE_FIELDS = new Set([
  'createdAt', 'updatedAt', 'uploadedAt', 'requestedAt', 'dueDate',
  'updateRequestedAt', 'lastActivity', 'readAt',
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

/** Fired on a 401 (except the login call) so the auth layer can drop the session. */
export const UNAUTHORIZED_EVENT = 'docflow:unauthorized';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      // Let the browser set the multipart boundary for FormData bodies.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let body: { error?: string; [k: string]: unknown };
    try { body = await res.json(); } catch { body = { error: res.statusText }; }
    if (res.status === 401 && path !== '/auth/login' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  return reviveDates<T>(data);
}

export const api = {
  auth: {
    me: () => request<Me>('/auth/me'),
    login: (email: string, password: string, kind: 'provider' | 'client') =>
      request<Me>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, kind }),
      }),
    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
    signupProvider: (input: { name: string; email: string; password: string; firmName?: string }) =>
      request<Me>('/auth/signup-provider', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
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

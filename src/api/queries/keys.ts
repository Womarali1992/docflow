/**
 * Query keys.
 *
 * Every key that reads firm or client data starts with the signed-in identity
 * (`[kind, id, …]`). Two reasons, and the first one is the important one:
 *
 *  1. **Nothing survives a change of user.** Sign out of one account and into
 *     another in the same tab and the second account cannot be served a cached
 *     answer belonging to the first — the keys simply do not match. (`logout`
 *     also clears the cache; this is the belt to that pair of braces.)
 *  2. Invalidation is by prefix: `keys.documents(scope)` covers the list, every
 *     single document, and each document's versions and reviews.
 *
 * These are pure functions with no React in them, so they can be asserted
 * directly in a test.
 */
import type { Me, SearchParams } from '../types';

export type Scope = readonly [kind: string, id: string];

/** The key prefix used before anyone is signed in — those queries stay disabled. */
export const ANON: Scope = ['anon', 'none'] as const;

export function scopeOf(me: Me | null | undefined): Scope {
  return me ? ([me.kind, me.id] as const) : ANON;
}

/** A message thread is addressed by exactly one of these. */
export interface ThreadRef {
  clientId?: string;
  documentId?: string;
}

function threadId(thread: ThreadRef): string {
  if (thread.documentId) return `document:${thread.documentId}`;
  if (thread.clientId) return `client:${thread.clientId}`;
  return 'none';
}

export const keys = {
  /** Identity is not scoped by identity — it is what establishes the scope. */
  me: () => ['auth', 'me'] as const,
  sessions: (s: Scope) => [...s, 'auth', 'sessions'] as const,
  mfaStatus: (s: Scope) => [...s, 'auth', 'mfa-status'] as const,

  clients: (s: Scope) => [...s, 'clients'] as const,
  client: (s: Scope, id: string) => [...s, 'clients', id] as const,

  engagements: (s: Scope) => [...s, 'engagements'] as const,
  engagementList: (s: Scope, clientId?: string) => [...s, 'engagements', 'list', clientId ?? 'all'] as const,
  engagement: (s: Scope, id: string) => [...s, 'engagements', id] as const,

  requests: (s: Scope) => [...s, 'requests'] as const,
  request: (s: Scope, id: string) => [...s, 'requests', id] as const,

  documents: (s: Scope) => [...s, 'documents'] as const,
  documentList: (s: Scope, params: Record<string, unknown> = {}) => [...s, 'documents', 'list', params] as const,
  document: (s: Scope, id: string) => [...s, 'documents', id] as const,
  documentVersions: (s: Scope, id: string) => [...s, 'documents', id, 'versions'] as const,
  documentReviews: (s: Scope, id: string) => [...s, 'documents', id, 'reviews'] as const,

  messages: (s: Scope) => [...s, 'messages'] as const,
  thread: (s: Scope, thread: ThreadRef) => [...s, 'messages', threadId(thread)] as const,

  activities: (s: Scope, params: Record<string, unknown> = {}) => [...s, 'activities', params] as const,

  notifications: (s: Scope) => [...s, 'notifications'] as const,
  dashboard: (s: Scope) => [...s, 'dashboard'] as const,
  search: (s: Scope, params: SearchParams) => [...s, 'search', params] as const,

  templates: (s: Scope) => [...s, 'templates'] as const,
  template: (s: Scope, id: string) => [...s, 'templates', id] as const,

  ops: (s: Scope) => [...s, 'ops'] as const,
};

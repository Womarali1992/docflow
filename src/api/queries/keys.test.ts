import { describe, expect, it } from 'vitest';
import { ANON, keys, scopeOf } from './keys';
import type { Me } from '../types';

const advisor: Me = { kind: 'provider', id: 'p1', name: 'A', email: 'a@example.com' };
const otherAdvisor: Me = { kind: 'provider', id: 'p2', name: 'B', email: 'b@example.com' };
const client: Me = { kind: 'client', id: 'c1', name: 'C', email: 'c@example.com', providerId: 'p1' };

describe('scopeOf', () => {
  it('is the signed-in identity', () => {
    expect(scopeOf(advisor)).toEqual(['provider', 'p1']);
    expect(scopeOf(client)).toEqual(['client', 'c1']);
  });

  it('falls back to ANON with no session, so scoped queries stay switched off', () => {
    expect(scopeOf(null)).toEqual(ANON);
    expect(scopeOf(undefined)).toEqual(ANON);
  });
});

describe('keys', () => {
  it('never lets two identities share a cache entry', () => {
    // The whole point of the scope prefix: same request, different signed-in
    // user, different key — so a cached answer cannot cross accounts.
    expect(keys.documentList(scopeOf(advisor))).not.toEqual(keys.documentList(scopeOf(otherAdvisor)));
    expect(keys.clients(scopeOf(advisor))).not.toEqual(keys.clients(scopeOf(client)));
    expect(keys.dashboard(scopeOf(advisor))).not.toEqual(keys.dashboard(ANON));
  });

  it('keeps identity out of the me key — it is what establishes the scope', () => {
    expect(keys.me()).toEqual(['auth', 'me']);
  });

  it('nests so that invalidating a prefix covers everything under it', () => {
    const s = scopeOf(advisor);
    const isPrefixOf = (prefix: readonly unknown[], key: readonly unknown[]) =>
      prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]));

    // One document invalidation must take its versions and reviews with it.
    expect(isPrefixOf(keys.document(s, 'd1'), keys.documentVersions(s, 'd1'))).toBe(true);
    expect(isPrefixOf(keys.document(s, 'd1'), keys.documentReviews(s, 'd1'))).toBe(true);
    // …and the documents prefix must cover the lists and every single document.
    expect(isPrefixOf(keys.documents(s), keys.document(s, 'd1'))).toBe(true);
    expect(isPrefixOf(keys.documents(s), keys.documentList(s, { clientId: 'c1' }))).toBe(true);
    expect(isPrefixOf(keys.engagements(s), keys.engagement(s, 'e1'))).toBe(true);
    expect(isPrefixOf(keys.engagements(s), keys.engagementList(s, 'c1'))).toBe(true);

    // A document's key is not a prefix of an unrelated document's.
    expect(isPrefixOf(keys.document(s, 'd1'), keys.document(s, 'd2'))).toBe(false);
  });

  it('separates a client thread from a document thread', () => {
    const s = scopeOf(advisor);
    expect(keys.thread(s, { clientId: 'c1' })).not.toEqual(keys.thread(s, { documentId: 'c1' }));
  });

  it('distinguishes list queries by their filters', () => {
    const s = scopeOf(advisor);
    expect(keys.documentList(s, { kind: 'deliverable' })).not.toEqual(keys.documentList(s, { kind: 'client_upload' }));
    expect(keys.activities(s, { limit: 10 })).not.toEqual(keys.activities(s, { limit: 50 }));
  });
});

import { describe, expect, it } from 'vitest';
import type { RequestStatus } from '@/api/types';
import { lookOf, moveOf, tally } from './whoseMove';

const line = (status: RequestStatus, clientResponseKind: string | null = null) => ({ status, clientResponseKind });

describe('whose move a checklist line is', () => {
  it('puts each status with exactly one party', () => {
    expect(moveOf(line('requested'))).toBe('client');
    expect(moveOf(line('needs_correction'))).toBe('client');
    expect(moveOf(line('submitted'))).toBe('firm');
    expect(moveOf(line('in_review'))).toBe('firm');
    expect(moveOf(line('accepted'))).toBe('done');
    expect(moveOf(line('waived'))).toBe('done');
  });

  it('hands "I don’t have this" to the advisor, who alone can take it off the list', () => {
    expect(moveOf(line('requested', 'not_applicable'))).toBe('firm');
    expect(lookOf(line('requested', 'not_applicable'))).toBe('decision');
    // Once decided, the answer no longer matters.
    expect(moveOf(line('waived', 'not_applicable'))).toBe('done');
    expect(lookOf(line('accepted', 'not_applicable'))).toBe('accepted');
  });

  it('draws a sent-back line differently from one never answered', () => {
    expect(lookOf(line('requested'))).toBe('needed');
    expect(lookOf(line('needs_correction'))).toBe('sent_back');
    expect(lookOf(line('in_review'))).toBe('with_firm');
  });

  it('counts every line once', () => {
    const lines = [line('requested'), line('submitted'), line('requested', 'not_applicable'), line('accepted'), line('waived')];
    expect(tally(lines)).toEqual({ client: 1, firm: 2, done: 2, total: 5 });
    expect(tally([])).toEqual({ client: 0, firm: 0, done: 0, total: 0 });
  });
});

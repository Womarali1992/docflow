import { describe, expect, it } from 'vitest';
import { STATUS_PILL, TONE_PILL, isPastDue, toneOf } from './tone';

describe('the colour of a checklist line', () => {
  it('gives each state one colour', () => {
    expect(toneOf({ status: 'requested' })).toBe('needed');
    expect(toneOf({ status: 'needs_correction' })).toBe('sent_back');
    expect(toneOf({ status: 'submitted' })).toBe('with_firm');
    expect(toneOf({ status: 'in_review' })).toBe('with_firm');
    expect(toneOf({ status: 'accepted' })).toBe('accepted');
    expect(toneOf({ status: 'waived' })).toBe('waived');
    expect(toneOf({ status: 'requested', clientResponseKind: 'not_applicable' })).toBe('decision');
  });

  it('turns a line red when it is past due, but only while it is with the client', () => {
    expect(toneOf({ status: 'requested', overdue: true })).toBe('overdue');
    // Already red for another reason, and it says why.
    expect(toneOf({ status: 'needs_correction', overdue: true })).toBe('sent_back');
    // The client has done their part; a date that passed since is not on them.
    expect(toneOf({ status: 'submitted', overdue: true })).toBe('with_firm');
    expect(toneOf({ status: 'requested', clientResponseKind: 'not_applicable', overdue: true })).toBe('decision');
  });

  it('keeps the status pills on the same colours as the rows', () => {
    expect(STATUS_PILL.requested.cls).toBe(TONE_PILL.needed);
    expect(STATUS_PILL.needs_correction.cls).toBe(TONE_PILL.sent_back);
    expect(STATUS_PILL.submitted.cls).toBe(TONE_PILL.with_firm);
    expect(STATUS_PILL.accepted.cls).toBe(TONE_PILL.accepted);
    expect(TONE_PILL.overdue).toBe(TONE_PILL.sent_back);
  });

  it('calls a line past due by the server’s rule', () => {
    const now = new Date('2026-10-29T12:00:00Z').getTime();
    const yesterday = new Date('2026-10-28T12:00:00Z');
    expect(isPastDue({ status: 'requested', dueDate: yesterday }, now)).toBe(true);
    expect(isPastDue({ status: 'needs_correction', dueDate: yesterday }, now)).toBe(true);
    expect(isPastDue({ status: 'submitted', dueDate: yesterday }, now)).toBe(false);
    expect(isPastDue({ status: 'requested', dueDate: null }, now)).toBe(false);
    expect(isPastDue({ status: 'requested', dueDate: new Date('2026-10-30T12:00:00Z') }, now)).toBe(false);
  });
});

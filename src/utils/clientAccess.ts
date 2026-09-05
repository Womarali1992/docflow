import type { Client } from '@/api/types';

export type AccessState = 'deactivated' | 'active' | 'invited' | 'not_invited';

/** Derived from server fields only: hasPassword, invitePendingUntil, deactivatedAt. */
export function accessState(c: Pick<Client, 'hasPassword' | 'invitePendingUntil' | 'deactivatedAt'>): AccessState {
  if (c.deactivatedAt) return 'deactivated';
  if (c.hasPassword) return 'active';
  if (c.invitePendingUntil && c.invitePendingUntil.getTime() > Date.now()) return 'invited';
  return 'not_invited';
}

export const ACCESS_LABEL: Record<AccessState, { label: string; cls: string }> = {
  deactivated: { label: 'Deactivated', cls: 'df-plain' },
  active: { label: 'Portal access', cls: 'df-ok' },
  invited: { label: 'Invited', cls: 'df-info' },
  not_invited: { label: 'Not invited', cls: 'df-warn' },
};

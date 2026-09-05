import type { SessionStage } from '@/api/types';

/** The screen a session in a given stage belongs on (null when it may go anywhere). */
export function stagePath(stage: SessionStage | null): string | null {
  if (stage === 'preauth') return '/mfa';
  if (stage === 'mfa_enroll') return '/mfa/enroll';
  return null;
}

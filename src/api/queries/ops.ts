/**
 * Operational status — queue depth, virus scanner, mail. Advisor only.
 *
 * Refreshed once a minute: none of it changes faster than that, and the panel
 * showing it is not a screen anyone watches.
 */
import { api } from '../client';
import type { OpsStatus } from '../types';
import { keys } from './keys';
import { useScope, useSignedIn } from './auth';
import { POLL, useLiveQuery } from './live';

export function useOpsStatus(options?: { enabled?: boolean; live?: boolean }) {
  const scope = useScope();
  const signedIn = useSignedIn();
  return useLiveQuery<OpsStatus>({
    key: keys.ops(scope),
    fetch: ({ poll }) => api.ops.status({ poll }),
    intervalMs: options?.live === false ? undefined : POLL.status,
    enabled: signedIn && (options?.enabled ?? true),
  });
}

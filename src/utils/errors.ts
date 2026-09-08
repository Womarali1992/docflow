import { ApiError } from '@/api/client';

/** Extract a human-readable message from any thrown value. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.body?.error || err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong';
}

/** What the server says is on screen instead of the version the decision named. */
export interface StaleVersion {
  /** The version to read before deciding, or null when nothing is readable yet. */
  currentVersionId: string | null;
  scanStatus: string | null;
}

/**
 * A decision refused because the file moved underneath it (409 `stale_version`,
 * H2). The advisor was reading v1 when v2 landed; the server will not record a
 * decision about something they have not seen, and the workspace offers to go
 * and get the new one.
 */
export function staleVersion(err: unknown): StaleVersion | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (err.body?.code !== 'stale_version') return null;
  return {
    currentVersionId: (err.body.currentVersionId as string | null) ?? null,
    scanStatus: (err.body.scanStatus as string | null) ?? null,
  };
}

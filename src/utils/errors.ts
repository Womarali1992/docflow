import { ApiError } from '@/api/client';

/** Extract a human-readable message from any thrown value. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.body?.error || err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong';
}

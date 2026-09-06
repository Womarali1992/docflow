import { describe, expect, it } from 'vitest';
import { createQueryClient } from '../queryClient';
import { ApiError } from '../client';
import { isRefresh, POLL } from './live';

describe('isRefresh — which requests carry X-DocFlow-Poll', () => {
  it('is false before a key has ever been fetched', () => {
    const client = createQueryClient();
    // The first load happens because a person opened a screen: real activity,
    // and it must be allowed to extend the session.
    expect(isRefresh(client, ['provider', 'p1', 'dashboard'])).toBe(false);
  });

  it('is true once the key holds data', async () => {
    const client = createQueryClient();
    const key = ['provider', 'p1', 'dashboard'];
    client.setQueryData(key, { count: 1 });
    // Every later fetch is a background refresh — served, but the 30-minute
    // idle clock keeps running.
    expect(isRefresh(client, key)).toBe(true);
  });

  it('stays false for a key whose fetch only ever failed', async () => {
    const client = createQueryClient();
    const key = ['provider', 'p1', 'dashboard'];
    await client
      .fetchQuery({
        queryKey: key,
        queryFn: async () => {
          throw new ApiError(500, { error: 'boom' });
        },
        retry: false,
      })
      .catch(() => undefined);
    // No data was ever stored, so the next attempt is still a first load.
    expect(isRefresh(client, key)).toBe(false);
  });

  it('keeps one key from speaking for another', () => {
    const client = createQueryClient();
    client.setQueryData(['provider', 'p1', 'dashboard'], { count: 1 });
    expect(isRefresh(client, ['provider', 'p1', 'notifications'])).toBe(false);
    expect(isRefresh(client, ['client', 'c1', 'dashboard'])).toBe(false);
  });
});

describe('POLL cadences', () => {
  it('refreshes an open thread faster than a queue, and a queue faster than ops', () => {
    expect(POLL.thread).toBeLessThan(POLL.queue);
    expect(POLL.queue).toBeLessThan(POLL.status);
  });
});

describe('query client defaults', () => {
  const retryOf = (client: ReturnType<typeof createQueryClient>) =>
    client.getDefaultOptions().queries?.retry as (count: number, error: Error) => boolean;

  it('does not retry a refusal — the server meant it', () => {
    const retry = retryOf(createQueryClient());
    expect(retry(0, new ApiError(401, { error: 'no' }))).toBe(false);
    expect(retry(0, new ApiError(403, { error: 'no' }))).toBe(false);
    expect(retry(0, new ApiError(404, { error: 'no' }))).toBe(false);
    expect(retry(0, new ApiError(409, { code: 'not_available_yet' }))).toBe(false);
  });

  it('retries a server error, but not forever', () => {
    const retry = retryOf(createQueryClient());
    expect(retry(0, new ApiError(500, { error: 'boom' }))).toBe(true);
    expect(retry(2, new ApiError(500, { error: 'boom' }))).toBe(false);
  });
});

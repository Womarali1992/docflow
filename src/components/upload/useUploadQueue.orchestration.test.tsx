import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, UNAUTHORIZED_EVENT } from '@/api/client';
import { UPLOAD_MESSAGE, useUploadQueue } from './useUploadQueue';

/**
 * The upload queue's *orchestration* (H0, fixed in H4).
 *
 * `useUploadQueue.test.ts` tests the reducer, which is pure and was always
 * correct. The defect the 2026-09-07 audit found was one level up: `pump()`
 * walked a snapshot of the queue taken when it started, and `enqueue()` built
 * that snapshot from the render-time `state` closure. So a file added while
 * another was uploading was invisible to the running pump, and a file
 * cancelled while another was uploading was still `queued` in the snapshot and
 * got sent anyway.
 *
 * H4 made the pump read a ref that every dispatch updates and re-decide before
 * every send (invariant 22, "the queue reads the present"). The first two rows
 * here were `it.fails` until that landed; `docs/audit/` holds the original
 * probes, which assert the defects instead.
 *
 * The scaffold — `renderHook` inside a QueryClientProvider, `api` and
 * `useScope` mocked, `cleanup()` in `afterEach` because there are no vitest
 * globals here — is the one the audit proved works for this hook. `ApiError`
 * is the real one: the pump distinguishes a 401 from every other refusal, and
 * a stand-in class cannot carry that.
 */

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: { ...actual.api, uploads: { ...actual.api.uploads, toRequest: send } } };
});
vi.mock('@/api/queries/auth', () => ({ useScope: () => ['client', 'hardening'] }));

afterEach(() => {
  cleanup();
  send.mockReset();
});

const file = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });
const target = { kind: 'request' as const, id: 'req-1' };

/** The file names that actually left the browser, in the order they left. */
const sent = () => send.mock.calls.map((call) => (call[1] as File).name);

/** The options the nth send was given — its signal, its progress callback. */
const optsOf = (n: number) =>
  send.mock.calls[n][2] as { onProgress: (f: number) => void; signal: AbortSignal; uploadId: string };

/** A send that stays in flight until the returned `finish` is called. */
function heldSend() {
  let release!: (value: { status: number }) => void;
  send.mockImplementationOnce(() => new Promise((resolve) => (release = resolve))).mockResolvedValue({ status: 201 });
  return () => release({ status: 201 });
}

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useUploadQueue(), { wrapper });
}

describe('upload queue orchestration', () => {
  /**
   * A client on a phone adds a second photograph while the first is still
   * going up. Before H4 the pump had already finished walking its snapshot by
   * the time the first settled, so the second sat at `queued` forever: no
   * progress, no error, nothing to retry, and the checklist item never got its
   * file.
   */
  it('F6: a file added while another is uploading is still sent', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf')], target));
    act(() => result.current.enqueue([file('second.pdf')], target));
    await act(async () => finish());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.items[1].state).toBe('done'));
    expect(sent()).toEqual(['first.pdf', 'second.pdf']);
  });

  /**
   * The other direction, and the worse one: Cancel is pressed on a queued file
   * while the one before it uploads. The reducer marks it cancelled — but the
   * running pump was reading its own snapshot, where it was still `queued`, so
   * the file the client had just said no to was uploaded anyway.
   */
  it('F6: a queued file cancelled during another upload is never sent', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf'), file('cancelled.pdf')], target));
    act(() => result.current.cancel(result.current.items[1].id));
    await act(async () => finish());

    await waitFor(() => expect(result.current.items[0].state).toBe('done'));
    expect(result.current.items[1].state).toBe('cancelled');
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(['first.pdf']);
  });

  /** Removing is cancelling plus forgetting; the bytes must not leave either. */
  it('a queued file removed during another upload is never sent', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf'), file('removed.pdf')], target));
    act(() => result.current.remove(result.current.items[1].id));
    await act(async () => finish());

    await waitFor(() => expect(result.current.items[0].state).toBe('done'));
    expect(result.current.items).toHaveLength(1);
    expect(sent()).toEqual(['first.pdf']);
  });

  /**
   * Two files chosen in one gesture. `enqueue` used to build its snapshot from
   * the render-time `state`, so the second call's snapshot did not contain the
   * first call's item — the classic stale-closure shape.
   */
  it('two enqueues in the same tick both send, in order', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => {
      result.current.enqueue([file('a.pdf')], target);
      result.current.enqueue([file('b.pdf')], target);
    });
    await act(async () => finish());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(sent()).toEqual(['a.pdf', 'b.pdf']);
  });

  /** Retry is an enqueue with history: it joins the back of the running queue. */
  it('a retry pressed during another upload is sent after it', async () => {
    send.mockRejectedValueOnce(new ApiError(413, { error: 'Too large', code: 'too_large' }));
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf')], target));
    await waitFor(() => expect(result.current.items[0].state).toBe('failed'));

    const finish = heldSend();
    act(() => result.current.enqueue([file('second.pdf')], target));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));

    act(() => result.current.retry(result.current.items[0].id));
    await act(async () => finish());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(sent()).toEqual(['first.pdf', 'second.pdf', 'first.pdf']);
    await waitFor(() => expect(result.current.items[0].state).toBe('done'));
  });

  /**
   * Cancel arriving after the server already has the bytes is too late to mean
   * anything. Saying "Cancelled" there would be a lie — the file is stored,
   * and the advisor can see it.
   */
  it('cancelling after the server has the file leaves it done', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf')], target));
    await act(async () => finish());
    await waitFor(() => expect(result.current.items[0].state).toBe('done'));

    act(() => result.current.cancel(result.current.items[0].id));
    expect(result.current.items[0].state).toBe('done');
  });

  /** A progress event from an aborted request must not resurrect the item. */
  it('progress reported after a cancel is ignored', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf')], target));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const { onProgress } = optsOf(0);

    act(() => result.current.cancel(result.current.items[0].id));
    act(() => onProgress(0.5));

    expect(result.current.items[0].state).toBe('cancelled');
    expect(result.current.items[0].progress).toBe(0);
    finish();
  });

  it('unmounting aborts the upload in flight', async () => {
    const finish = heldSend();
    const { result, unmount } = mount();

    act(() => result.current.enqueue([file('first.pdf')], target));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const { signal } = optsOf(0);
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
    finish();
  });

  /**
   * The session ends mid-queue. Every refusal after that would be another 401,
   * so the pump stops rather than marching the rest of the files through a
   * door that is shut — and the message says what to do about it.
   */
  it('a 401 fails everything waiting with the session message and stops the pump', async () => {
    send.mockRejectedValueOnce(new ApiError(401, { error: 'Not signed in', reason: 'expired' }));
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf'), file('second.pdf')], target));

    await waitFor(() => expect(result.current.items[0].state).toBe('failed'));
    expect(result.current.items[1].state).toBe('failed');
    expect(result.current.items.map((it) => it.message)).toEqual([
      UPLOAD_MESSAGE.session_expired,
      UPLOAD_MESSAGE.session_expired,
    ]);
    expect(sent()).toEqual(['first.pdf']);
  });

  /** Signing out in another tab reaches the queue through the same event the auth layer listens to. */
  it('a sign-out elsewhere aborts the upload and fails what is waiting', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf'), file('second.pdf')], target));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const { signal } = optsOf(0);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { reason: 'revoked' } }));
    });

    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.items[1].state).toBe('failed'));
    expect(result.current.items[0].state).toBe('failed');
    expect(result.current.items[0].message).toBe(UPLOAD_MESSAGE.session_expired);
    expect(sent()).toEqual(['first.pdf']);
    finish();
  });
});

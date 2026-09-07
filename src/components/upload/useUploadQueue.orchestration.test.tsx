import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUploadQueue } from './useUploadQueue';

/**
 * The upload queue's *orchestration* (H0).
 *
 * `useUploadQueue.test.ts` tests the reducer, which is pure and correct. The
 * defect the 2026-09-07 audit found is one level up: `pump()` walks a snapshot
 * of the queue taken when it started, and `enqueue()` builds that snapshot from
 * the render-time `state` closure. So a file added while another is uploading is
 * invisible to the running pump, and a file cancelled while another is uploading
 * is still `queued` in the snapshot and gets sent anyway.
 *
 * Both rows are `it.fails` until H4 rewrites the pump to read a ref that every
 * dispatch updates and to re-check the current state before each send
 * (invariant 22, "the queue reads the present"). `docs/audit/` holds the
 * original probes, which assert the defects instead.
 *
 * The scaffold — `renderHook` inside a QueryClientProvider, `api` and `useScope`
 * mocked, `cleanup()` in `afterEach` because there are no vitest globals here —
 * is the one the audit proved works for this hook.
 */

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/api/client', () => ({ api: { uploads: { toRequest: send } }, ApiError: class extends Error {} }));
vi.mock('@/api/queries/auth', () => ({ useScope: () => ['client', 'hardening'] }));

afterEach(() => {
  cleanup();
  send.mockReset();
});

const file = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });
const target = { kind: 'request' as const, id: 'req-1' };

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
   * going up. Today the pump has already finished walking its snapshot by the
   * time the first settles, so the second sits at `queued` forever: no progress,
   * no error, nothing to retry, and the checklist item never gets its file.
   */
  it.fails('F6: a file added while another is uploading is still sent', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf')], target));
    act(() => result.current.enqueue([file('second.pdf')], target));
    await act(async () => finish());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.items[1].state).toBe('done'));
    expect(send.mock.calls[1][1].name).toBe('second.pdf');
  });

  /**
   * The other direction, and the worse one: Cancel is pressed on a queued file
   * while the one before it uploads. The reducer marks it cancelled — but the
   * running pump is reading its own snapshot, where it is still `queued`, so the
   * file the client just said no to is uploaded anyway.
   */
  it.fails('F6: a queued file cancelled during another upload is never sent', async () => {
    const finish = heldSend();
    const { result } = mount();

    act(() => result.current.enqueue([file('first.pdf'), file('cancelled.pdf')], target));
    act(() => result.current.cancel(result.current.items[1].id));
    await act(async () => finish());

    await waitFor(() => expect(result.current.items[0].state).toBe('done'));
    expect(result.current.items[1].state).toBe('cancelled');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.map((call) => call[1].name)).toEqual(['first.pdf']);
  });
});

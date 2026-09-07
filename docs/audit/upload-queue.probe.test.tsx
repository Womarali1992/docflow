/* Audit reproductions: assertions describe defects observed at 705cdbd, not desired behavior. */
import React from 'react';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { useUploadQueue } from '@/components/upload/useUploadQueue';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/api/client', () => ({ api: { uploads: { toRequest: send } }, ApiError: class extends Error {} }));
vi.mock('@/api/queries/auth', () => ({ useScope: () => ['client', 'audit'] }));
afterEach(() => { cleanup(); send.mockReset(); });
const file = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });
const target = { kind: 'request' as const, id: 'audit' };
function mount() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(() => useUploadQueue(), { wrapper });
}
it('reproduces a file added during an upload remaining queued after the pump stops', async () => {
  let finish!: (v: { status: number }) => void;
  send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ status: 201 });
  const { result } = mount();
  act(() => result.current.enqueue([file('first.pdf')], target));
  act(() => result.current.enqueue([file('second.pdf')], target));
  await act(async () => { finish({ status: 201 }); });
  await waitFor(() => expect(result.current.items[0].state).toBe('done'));
  expect(send).toHaveBeenCalledTimes(1);
  expect(result.current.items[1].state).toBe('queued');
});
it('reproduces a cancelled queued file still being uploaded by the stale pump snapshot', async () => {
  let finish!: (v: { status: number }) => void;
  send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ status: 201 });
  const { result } = mount();
  act(() => result.current.enqueue([file('first.pdf'), file('cancelled.pdf')], target));
  act(() => result.current.cancel(result.current.items[1].id));
  await act(async () => { finish({ status: 201 }); });
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1][1].name).toBe('cancelled.pdf');
});

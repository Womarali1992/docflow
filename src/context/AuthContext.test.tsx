import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/api/queryClient';
import { keys } from '@/api/queries/keys';
import { UNAUTHORIZED_EVENT } from '@/api/client';
import { AuthProvider, useAuth } from './AuthContext';

/**
 * Session lifecycle. The rule being protected here is the one that matters for
 * a portal several clients share a machine with: **nothing fetched for one
 * account may survive into the next one**. Signing out, being signed out, and
 * signing in all clear the cache.
 */

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

const ADVISOR = { kind: 'provider' as const, id: 'p1', name: 'Ada', email: 'ada@example.com' };

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, statusText: 'x' } as Response;
}

/** Reads the context out into the DOM so assertions can be made on it. */
const Probe: React.FC = () => {
  const { me, stage, loading, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="who">{loading ? 'loading' : (me?.email ?? 'nobody')}</span>
      <span data-testid="stage">{stage ?? 'none'}</span>
      <button onClick={() => void login('ada@example.com', 'pw', 'provider')}>sign in</button>
      <button onClick={() => void logout()}>sign out</button>
    </div>
  );
};

let queryClient: ReturnType<typeof createQueryClient>;
let fetchMock: ReturnType<typeof vi.fn>;

function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = createQueryClient();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  // Vitest runs without globals, so testing-library's automatic cleanup does not
  // register itself — without this every test after the first sees two apps.
  cleanup();
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe('AuthProvider', () => {
  it('settles on "no session" when the server has none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized', reason: 'missing' }));
    renderApp();

    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('nobody'));
    expect(screen.getByTestId('stage').textContent).toBe('none');
    // A 401 on /auth/me is that call's ordinary answer, not a lost session:
    // it must not restart the request that just answered it.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))).toHaveLength(1);
  });

  it('carries the stage through sign-in, and clears what the last account left behind', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/auth/me')) return jsonResponse(401, { error: 'Unauthorized', reason: 'missing' });
      if (String(url).endsWith('/auth/login')) return jsonResponse(200, { stage: 'preauth', me: ADVISOR });
      throw new Error(`unexpected ${url}`);
    });
    renderApp();
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('nobody'));

    // Something another account had fetched into this tab.
    queryClient.setQueryData(['provider', 'p9', 'clients'], [{ id: 'leak' }]);

    await act(async () => {
      screen.getByText('sign in').click();
    });

    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('ada@example.com'));
    // Password accepted is not signed in: the second factor is still owed.
    expect(screen.getByTestId('stage').textContent).toBe('preauth');
    expect(queryClient.getQueryData(['provider', 'p9', 'clients'])).toBeUndefined();
  });

  it('drops the session and the cache when any call reports a 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stage: 'active', me: ADVISOR }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('ada@example.com'));

    queryClient.setQueryData(keys.me(), { stage: 'active', me: ADVISOR });
    queryClient.setQueryData(['provider', 'p1', 'documents', 'list', {}], [{ id: 'd1' }]);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { reason: 'idle' } }));
    });

    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('nobody'));
    expect(queryClient.getQueryData(['provider', 'p1', 'documents', 'list', {}])).toBeUndefined();
  });

  it('signing out ends the session and empties the cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { stage: 'active', me: ADVISOR }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('ada@example.com'));

    queryClient.setQueryData(['provider', 'p1', 'clients'], [{ id: 'c1' }]);
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await act(async () => {
      screen.getByText('sign out').click();
    });

    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('nobody'));
    expect(queryClient.getQueryData(['provider', 'p1', 'clients'])).toBeUndefined();
    expect(queryClient.getQueryData(keys.me())).toBeNull();
  });
});

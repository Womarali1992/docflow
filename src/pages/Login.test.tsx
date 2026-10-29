import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/api/queryClient';
import { AuthProvider } from '@/context/AuthContext';
import Login from './Login';

/**
 * "Which firm?" (F7 of the firm book). One address can be a client of two
 * firms; when the password opens both, the server answers 409 `choose_firm`
 * with the firms it opened, and the page asks the person to pick one before
 * signing in again with that firm's id.
 */

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

const CLIENT = { kind: 'client' as const, id: 'c2', name: 'Ada', email: 'ada@example.com' };
const FIRMS = [
  { id: 'f1', name: 'Firm One' },
  { id: 'f2', name: 'Firm Two' },
];

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body, statusText: 'x' } as Response;
}

let queryClient: ReturnType<typeof createQueryClient>;
let fetchMock: ReturnType<typeof vi.fn>;

/** The login bodies the page posted, in order. */
const loginBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/auth/login'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

beforeEach(() => {
  queryClient = createQueryClient();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/auth/me')) return jsonResponse(401, { error: 'Unauthorized', reason: 'missing' });
    if (String(url).endsWith('/auth/login')) {
      const body = JSON.parse(String(init?.body)) as { firmId?: string };
      if (!body.firmId) {
        return jsonResponse(409, { error: 'You have an account with more than one firm.', code: 'choose_firm', firms: FIRMS });
      }
      return jsonResponse(200, { stage: 'preauth', me: CLIENT });
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/mfa" element={<div>code screen</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  queryClient.clear();
});

describe('Login', () => {
  it('asks which firm when the password opens two, then signs in to the one picked', async () => {
    await act(async () => {
      screen.getByRole('button', { name: /sign in as client/i }).click();
    });

    await waitFor(() => expect(screen.getByText('Which firm?')).toBeTruthy());
    // A choice, not a refusal: no error, and no hint about the other toggle.
    expect(screen.queryByText(/work at the firm\?/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Firm One' })).toBeTruthy();

    await act(async () => {
      screen.getByRole('button', { name: 'Firm Two' }).click();
    });

    await waitFor(() => expect(screen.getByText('code screen')).toBeTruthy());
    const [first, second] = loginBodies();
    expect(first).not.toHaveProperty('firmId');
    expect(second).toMatchObject({ kind: 'client', email: first.email, password: first.password, firmId: 'f2' });
  });

  it('goes back to the form without signing in', async () => {
    await act(async () => {
      screen.getByRole('button', { name: /sign in as client/i }).click();
    });
    await waitFor(() => expect(screen.getByText('Which firm?')).toBeTruthy());

    await act(async () => {
      screen.getByRole('button', { name: 'Back' }).click();
    });

    expect(screen.queryByText('Which firm?')).toBeNull();
    expect(screen.getByRole('button', { name: /sign in as client/i })).toBeTruthy();
    expect(loginBodies()).toHaveLength(1);
  });
});

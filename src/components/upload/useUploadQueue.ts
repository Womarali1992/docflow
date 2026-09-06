import { useCallback, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { keys } from '@/api/queries/keys';
import { useScope } from '@/api/queries/auth';

/**
 * The upload queue (C4.2).
 *
 * A client sending six photographs of a stack of statements from a phone needs
 * three things the old one-file-at-a-time upload could not give them: to see
 * that something is happening, to stop it, and to be told in words what went
 * wrong with the one file that failed — without losing the other five.
 *
 * The reducer holds the whole of that and nothing else: no network, no React
 * Query, no DOM. It is the piece worth testing, and `useUploadQueue.test.ts`
 * tests it directly.
 *
 * Files upload **one at a time**, on purpose. Six parallel uploads on a phone
 * connection make all six slow and the progress bars meaningless, and the
 * server's per-session upload limiter is happier with a queue than a burst.
 */

export type UploadState = 'queued' | 'uploading' | 'scanning' | 'done' | 'failed' | 'cancelled';

export type UploadTarget =
  | { kind: 'request'; id: string }
  | { kind: 'engagement'; id: string }
  | { kind: 'document'; id: string };

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  file: File;
  target: UploadTarget;
  /** 0…1 while uploading; 1 once the bytes are with the server. */
  progress: number;
  state: UploadState;
  /** The server's refusal code, kept so the copy can be looked up (and tested). */
  code?: string;
  /** What to show the person. Always a sentence, never a code. */
  message?: string;
}

export interface QueueState {
  items: UploadItem[];
}

export type QueueAction =
  | { type: 'enqueue'; items: { id: string; file: File; target: UploadTarget }[] }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; fraction: number }
  /** Bytes are with the server: 201 = published, 202 = still being checked. */
  | { type: 'settled'; id: string; status: number; code?: string }
  | { type: 'failed'; id: string; code?: string; message: string }
  | { type: 'cancel'; id: string }
  | { type: 'retry'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'clearFinished' };

/**
 * What the server's refusal actually means to the person holding the file.
 *
 * Every code here is one the upload pipeline can answer with (validate.ts,
 * scan.ts, uploads.ts). Anything unrecognised falls back to the server's own
 * sentence rather than a code, because a code on screen helps nobody.
 */
export const UPLOAD_MESSAGE: Record<string, string> = {
  encrypted: 'This file is password-protected, so it cannot be checked. Save a copy without the password and send that.',
  too_large: 'That file is larger than 25 MB. Send a smaller copy, or split it into parts.',
  empty_file: 'That file is empty — nothing was in it.',
  unsupported_type: 'That kind of file is not accepted. Send a PDF, a Word or Excel file, a CSV, or a photo.',
  type_mismatch: 'The file’s contents do not match its name. Re-save it and try again.',
  infected: 'The security check found something in that file, so it was not sent. Check the device it came from.',
  no_file: 'No file was attached.',
  client_only: 'Only you can answer this item — ask your accountant if this looks wrong.',
  request_closed: 'Your accountant has marked this item as not needed.',
  engagement_closed: 'That work has been closed. Ask your accountant to reopen it.',
  archived: 'That document has been archived.',
  cancelled: 'Cancelled.',
};

/** The 202 case: stored, readable once the scan finishes. Not a failure. */
export const CHECKING_MESSAGE = 'Received. It appears once the security check finishes — nothing more to do.';

export function messageForCode(code: string | undefined, fallback: string): string {
  return (code && UPLOAD_MESSAGE[code]) || fallback;
}

export const initialQueue: QueueState = { items: [] };

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  const patch = (id: string, changes: Partial<UploadItem>): QueueState => ({
    items: state.items.map((it) => (it.id === id ? { ...it, ...changes } : it)),
  });

  switch (action.type) {
    case 'enqueue':
      return {
        items: [
          ...state.items,
          ...action.items.map(({ id, file, target }) => ({
            id,
            name: file.name,
            size: file.size,
            file,
            target,
            progress: 0,
            state: 'queued' as const,
          })),
        ],
      };

    case 'start':
      return patch(action.id, { state: 'uploading', progress: 0, code: undefined, message: undefined });

    case 'progress': {
      const item = state.items.find((it) => it.id === action.id);
      // A late progress event must not resurrect a cancelled item.
      if (!item || item.state !== 'uploading') return state;
      return patch(action.id, { progress: Math.max(0, Math.min(1, action.fraction)) });
    }

    case 'settled': {
      const item = state.items.find((it) => it.id === action.id);
      if (!item || item.state === 'cancelled') return state;
      const checking = action.status === 202;
      return patch(action.id, {
        state: checking ? 'scanning' : 'done',
        progress: 1,
        code: action.code,
        message: checking ? CHECKING_MESSAGE : undefined,
      });
    }

    case 'failed': {
      const item = state.items.find((it) => it.id === action.id);
      if (!item || item.state === 'cancelled') return state;
      return patch(action.id, { state: 'failed', code: action.code, message: action.message });
    }

    case 'cancel': {
      const item = state.items.find((it) => it.id === action.id);
      // Only something still in flight can be cancelled; a finished upload stays finished.
      if (!item || (item.state !== 'queued' && item.state !== 'uploading')) return state;
      return patch(action.id, { state: 'cancelled', message: UPLOAD_MESSAGE.cancelled });
    }

    case 'retry': {
      const item = state.items.find((it) => it.id === action.id);
      if (!item || (item.state !== 'failed' && item.state !== 'cancelled')) return state;
      // Retry keeps the item — the file is still in hand, only the attempt failed.
      return patch(action.id, { state: 'queued', progress: 0, code: undefined, message: undefined });
    }

    case 'remove':
      return { items: state.items.filter((it) => it.id !== action.id) };

    case 'clearFinished':
      return { items: state.items.filter((it) => it.state !== 'done' && it.state !== 'scanning' && it.state !== 'cancelled') };

    default:
      return state;
  }
}

/** The next thing to send, or nothing while one is already in flight. */
export function nextQueued(state: QueueState): UploadItem | undefined {
  if (state.items.some((it) => it.state === 'uploading')) return undefined;
  return state.items.find((it) => it.state === 'queued');
}

let counter = 0;
const nextId = () => `upl-${Date.now().toString(36)}-${(counter += 1)}`;

function post(target: UploadTarget, file: File, opts: { onProgress: (f: number) => void; signal: AbortSignal }) {
  if (target.kind === 'request') return api.uploads.toRequest(target.id, file, opts);
  if (target.kind === 'engagement') return api.uploads.toEngagement(target.id, file, opts);
  return api.uploads.newVersion(target.id, file, opts);
}

export function useUploadQueue() {
  const [state, dispatch] = useReducer(queueReducer, initialQueue);
  const queryClient = useQueryClient();
  const scope = useScope();
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(false);

  /** Drains the queue one file at a time until nothing is left to send. */
  const pump = useCallback(
    async (queue: QueueState) => {
      if (running.current) return;
      running.current = true;
      let current = queue;

      try {
        for (;;) {
          const item = nextQueued(current);
          if (!item) break;

          current = queueReducer(current, { type: 'start', id: item.id });
          dispatch({ type: 'start', id: item.id });

          const controller = new AbortController();
          controllers.current.set(item.id, controller);

          try {
            const result = await post(item.target, item.file, {
              onProgress: (fraction) => dispatch({ type: 'progress', id: item.id, fraction }),
              signal: controller.signal,
            });
            current = queueReducer(current, { type: 'settled', id: item.id, status: result.status, code: result.code });
            dispatch({ type: 'settled', id: item.id, status: result.status, code: result.code });
          } catch (err) {
            const code = err instanceof ApiError ? (err.body.code as string | undefined) : undefined;
            if (code === 'cancelled') {
              current = queueReducer(current, { type: 'cancel', id: item.id });
              dispatch({ type: 'cancel', id: item.id });
            } else {
              const fallback = err instanceof Error ? err.message : 'That did not send. Try again.';
              const message = messageForCode(code, fallback);
              current = queueReducer(current, { type: 'failed', id: item.id, code, message });
              dispatch({ type: 'failed', id: item.id, code, message });
            }
          } finally {
            controllers.current.delete(item.id);
          }
        }
      } finally {
        running.current = false;
        // One invalidation for the whole run: the checklist, the documents and
        // the counts all move together when files land.
        await queryClient.invalidateQueries({ queryKey: keys.engagements(scope) });
        await queryClient.invalidateQueries({ queryKey: keys.documents(scope) });
        await queryClient.invalidateQueries({ queryKey: keys.requests(scope) });
        await queryClient.invalidateQueries({ queryKey: keys.dashboard(scope) });
      }
    },
    [queryClient, scope]
  );

  const enqueue = useCallback(
    (files: File[] | FileList, target: UploadTarget) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const items = list.map((file) => ({ id: nextId(), file, target }));
      dispatch({ type: 'enqueue', items });
      // Pump from a state that already includes them: dispatch has not landed yet.
      void pump(queueReducer(state, { type: 'enqueue', items }));
    },
    [pump, state]
  );

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    dispatch({ type: 'cancel', id });
  }, []);

  const retry = useCallback(
    (id: string) => {
      dispatch({ type: 'retry', id });
      void pump(queueReducer(state, { type: 'retry', id }));
    },
    [pump, state]
  );

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    dispatch({ type: 'remove', id });
  }, []);

  const clearFinished = useCallback(() => dispatch({ type: 'clearFinished' }), []);

  const active = state.items.filter((it) => it.state === 'queued' || it.state === 'uploading');

  return {
    items: state.items,
    busy: active.length > 0,
    activeCount: active.length,
    enqueue,
    cancel,
    retry,
    remove,
    clearFinished,
  };
}

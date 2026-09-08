import { describe, expect, it } from 'vitest';
import {
  CHECKING_MESSAGE,
  UPLOAD_MESSAGE,
  initialQueue,
  messageForCode,
  nextQueued,
  queueReducer,
  type QueueState,
  type UploadTarget,
} from './useUploadQueue';

/**
 * The upload queue's rules, tested where they live.
 *
 * These are the cases a client on a phone actually hits: two files where the
 * second fails, a cancel while the bytes are moving, a retry after a refusal,
 * and the 202 that means "stored, still being checked" rather than "broken".
 */

const target: UploadTarget = { kind: 'request', id: 'req-1' };
const file = (name: string, size = 1024) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

const enqueue = (state: QueueState, ...names: string[]): QueueState =>
  queueReducer(state, {
    type: 'enqueue',
    items: names.map((name, i) => ({ id: `i${i}-${name}`, uploadId: `upload-${i}`, file: file(name), target })),
  });

describe('queueReducer', () => {
  it('treats "nothing new happened" as done, with its own sentence', () => {
    let state = enqueue(initialQueue, 'a.pdf', 'b.pdf');
    const [same, retried] = state.items;

    // 200 + unchanged: the client sent the file they had already sent.
    state = queueReducer(state, { type: 'settled', id: same.id, status: 200, code: 'unchanged' });
    // 200 + duplicate_upload: the same send, retried after a lost response.
    state = queueReducer(state, { type: 'settled', id: retried.id, status: 200, code: 'duplicate_upload' });

    expect(state.items.map((i) => i.state)).toEqual(['done', 'done']);
    expect(state.items[0].message).toBe(UPLOAD_MESSAGE.unchanged);
    expect(state.items[1].message).toBe(UPLOAD_MESSAGE.duplicate_upload);
  });

  it('keeps the whole batch, in order, and starts nothing on its own', () => {
    const state = enqueue(initialQueue, 'a.pdf', 'b.pdf', 'c.pdf');
    expect(state.items.map((i) => i.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(state.items.every((i) => i.state === 'queued' && i.progress === 0)).toBe(true);
  });

  it('sends one file at a time', () => {
    let state = enqueue(initialQueue, 'a.pdf', 'b.pdf');
    const first = nextQueued(state)!;
    expect(first.name).toBe('a.pdf');

    state = queueReducer(state, { type: 'start', id: first.id });
    // While one is in flight, nothing else is offered.
    expect(nextQueued(state)).toBeUndefined();

    state = queueReducer(state, { type: 'settled', id: first.id, status: 201 });
    expect(nextQueued(state)?.name).toBe('b.pdf');
  });

  it('treats 202 as "being checked", not as a failure', () => {
    let state = enqueue(initialQueue, 'a.pdf');
    const id = state.items[0].id;
    state = queueReducer(state, { type: 'start', id });
    state = queueReducer(state, { type: 'settled', id, status: 202, code: 'scanner_unavailable' });

    const item = state.items[0];
    expect(item.state).toBe('scanning');
    expect(item.progress).toBe(1);
    expect(item.message).toBe(CHECKING_MESSAGE);
  });

  it('fails one file without touching the others', () => {
    let state = enqueue(initialQueue, 'good.pdf', 'locked.pdf');
    const [good, locked] = state.items;

    state = queueReducer(state, { type: 'start', id: good.id });
    state = queueReducer(state, { type: 'settled', id: good.id, status: 201 });
    state = queueReducer(state, { type: 'start', id: locked.id });
    state = queueReducer(state, {
      type: 'failed',
      id: locked.id,
      code: 'encrypted',
      message: UPLOAD_MESSAGE.encrypted,
    });

    expect(state.items[0].state).toBe('done');
    expect(state.items[1].state).toBe('failed');
    expect(state.items[1].message).toContain('password-protected');
  });

  it('cancels only what is still in flight, and a late progress event cannot undo it', () => {
    let state = enqueue(initialQueue, 'a.pdf');
    const id = state.items[0].id;
    state = queueReducer(state, { type: 'start', id });
    state = queueReducer(state, { type: 'progress', id, fraction: 0.4 });
    expect(state.items[0].progress).toBeCloseTo(0.4);

    state = queueReducer(state, { type: 'cancel', id });
    expect(state.items[0].state).toBe('cancelled');

    // The XHR's last progress event can arrive after abort.
    state = queueReducer(state, { type: 'progress', id, fraction: 0.9 });
    expect(state.items[0].state).toBe('cancelled');
    expect(state.items[0].progress).toBeCloseTo(0.4);

    // …and a response that was already on the wire must not mark it sent.
    state = queueReducer(state, { type: 'settled', id, status: 201 });
    expect(state.items[0].state).toBe('cancelled');
  });

  it('will not cancel something already sent', () => {
    let state = enqueue(initialQueue, 'a.pdf');
    const id = state.items[0].id;
    state = queueReducer(state, { type: 'start', id });
    state = queueReducer(state, { type: 'settled', id, status: 201 });
    state = queueReducer(state, { type: 'cancel', id });
    expect(state.items[0].state).toBe('done');
  });

  it('retry keeps the file and clears the last refusal', () => {
    let state = enqueue(initialQueue, 'a.pdf');
    const id = state.items[0].id;
    state = queueReducer(state, { type: 'start', id });
    state = queueReducer(state, { type: 'failed', id, code: 'too_large', message: UPLOAD_MESSAGE.too_large });

    state = queueReducer(state, { type: 'retry', id });
    const item = state.items[0];
    expect(item.state).toBe('queued');
    expect(item.code).toBeUndefined();
    expect(item.message).toBeUndefined();
    // The point of retry: no second trip through the file picker.
    expect(item.file.name).toBe('a.pdf');
    expect(nextQueued(state)?.id).toBe(id);
  });

  it('does not retry something that succeeded', () => {
    let state = enqueue(initialQueue, 'a.pdf');
    const id = state.items[0].id;
    state = queueReducer(state, { type: 'start', id });
    state = queueReducer(state, { type: 'settled', id, status: 201 });
    state = queueReducer(state, { type: 'retry', id });
    expect(state.items[0].state).toBe('done');
  });

  it('clears what is finished and keeps what still needs a person', () => {
    let state = enqueue(initialQueue, 'sent.pdf', 'checking.pdf', 'broken.pdf', 'waiting.pdf');
    const [sent, checking, broken] = state.items;
    state = queueReducer(state, { type: 'start', id: sent.id });
    state = queueReducer(state, { type: 'settled', id: sent.id, status: 201 });
    state = queueReducer(state, { type: 'start', id: checking.id });
    state = queueReducer(state, { type: 'settled', id: checking.id, status: 202 });
    state = queueReducer(state, { type: 'start', id: broken.id });
    state = queueReducer(state, { type: 'failed', id: broken.id, code: 'infected', message: UPLOAD_MESSAGE.infected });

    state = queueReducer(state, { type: 'clearFinished' });
    expect(state.items.map((i) => i.name)).toEqual(['broken.pdf', 'waiting.pdf']);
  });

  it('clamps progress to the 0…1 a progress bar can show', () => {
    let state = enqueue(initialQueue, 'a.pdf');
    const id = state.items[0].id;
    state = queueReducer(state, { type: 'start', id });
    state = queueReducer(state, { type: 'progress', id, fraction: 1.7 });
    expect(state.items[0].progress).toBe(1);
    state = queueReducer(state, { type: 'progress', id, fraction: -3 });
    expect(state.items[0].progress).toBe(0);
  });
});

describe('messageForCode', () => {
  it('turns the server codes a person can act on into sentences', () => {
    expect(messageForCode('encrypted', 'x')).toContain('password-protected');
    expect(messageForCode('too_large', 'x')).toContain('25 MB');
    expect(messageForCode('request_closed', 'x')).toContain('not needed');
    expect(messageForCode('infected', 'x')).toContain('security check');
  });

  it('never shows a bare code — an unknown one falls back to the server sentence', () => {
    expect(messageForCode('something_new', 'The server said no.')).toBe('The server said no.');
    expect(messageForCode(undefined, 'The server said no.')).toBe('The server said no.');
  });
});

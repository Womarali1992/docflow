/**
 * Terminable file-type detection (F1, hardening plan 2.1).
 *
 * The audit found `fileTypeFromBuffer` being run over a whole untrusted upload
 * on a version inside the ASF infinite-loop advisory. Two things had to become
 * true, and both are asserted here rather than described:
 *
 *   - the installed `file-type` is past the advisory, and stays past it (a
 *     lockfile that slid backwards should fail loudly, not silently);
 *   - a parse that never returns costs one worker thread and a timeout, not the
 *     process — including through `validateStagedFile`, which is what an upload
 *     actually calls.
 *
 * The hang is produced by a stub worker rather than a malformed ASF file: the
 * point is the *shape* (a synchronous loop that never yields), and a fixture
 * that depended on a specific parser bug would stop testing anything the day
 * that bug was fixed upstream.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SNIFF_MAX_BYTES, SniffTimeout, readHead, sniffHead } from '../src/files/sniff.js';
import { validateStagedFile } from '../src/files/validate.js';
import { PDF_BYTES } from './helpers.js';

/** A worker that never answers, used to prove the timeout can end one. */
const HANG_WORKER = new URL('./hang.worker.mjs', import.meta.url);

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docflow-sniff-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name: string, bytes: Buffer): string {
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, bytes);
  return abs;
}

describe('file-type', () => {
  /**
   * GHSA (ASF parser infinite loop) covers 13.0.0 – 21.3.0. 19.6.0 was
   * installed when the audit ran. Read from the installed package rather than
   * from package.json, so this fails on what is actually resolved.
   */
  it('is installed past the ASF infinite-loop advisory, and a lockfile cannot slide back', () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../node_modules/file-type/package.json', import.meta.url), 'utf8')
    ) as { version: string };
    const [major, minor, patch] = pkg.version.split('.').map(Number);
    const atLeast = major > 21 || (major === 21 && (minor > 3 || (minor === 3 && patch >= 1)));
    expect(atLeast, `file-type ${pkg.version} is inside the advisory range (13.0.0 – 21.3.0)`).toBe(true);
  });
});

describe('sniffHead', () => {
  it('reads the type from the head of a buffer and of a file, and agrees with itself', async () => {
    const fromBuffer = await sniffHead(PDF_BYTES);
    expect(fromBuffer?.mime).toBe('application/pdf');
    expect(await sniffHead(write('a.pdf', PDF_BYTES))).toEqual(fromBuffer);

    expect((await sniffHead(PNG_BYTES))?.mime).toBe('image/png');
  });

  it('answers null for bytes with no signature, and for nothing at all', async () => {
    expect(await sniffHead(Buffer.from('just some words, no magic\n'))).toBeNull();
    expect(await sniffHead(Buffer.alloc(0))).toBeNull();
    expect(await sniffHead(write('empty.txt', Buffer.alloc(0)))).toBeNull();
  });

  it('never parses more than the detection window, however large the file', async () => {
    // A PDF header followed by 8 MB of noise: the answer must come from the head.
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(8 * 1024 * 1024, 0x41)]);
    const abs = write('big.pdf', big);
    expect(await readHead(abs)).toHaveLength(SNIFF_MAX_BYTES);
    expect((await sniffHead(abs))?.mime).toBe('application/pdf');
  });

  it('kills a parse that never returns, and the event loop keeps its turn', async () => {
    // Something that must keep ticking while the worker spins. If the parse ran
    // on the event loop (the F1 shape), this would not advance.
    let ticks = 0;
    const ticking = setInterval(() => ticks++, 10);

    const started = Date.now();
    await expect(sniffHead(PDF_BYTES, { workerPath: HANG_WORKER, timeoutMs: 300 })).rejects.toBeInstanceOf(SniffTimeout);
    const elapsed = Date.now() - started;
    clearInterval(ticking);

    expect(elapsed).toBeGreaterThanOrEqual(250);
    // Generous: a cold worker start on a loaded laptop is not instant. The
    // assertion that matters is that it ended at all.
    expect(elapsed).toBeLessThan(10_000);
    expect(ticks, 'the event loop was blocked while the worker spun').toBeGreaterThan(0);
  });
});

describe('validateStagedFile', () => {
  it('refuses a file whose type could not be read, with something the client can act on', async () => {
    const abs = write('slow.pdf', PDF_BYTES);
    const result = await validateStagedFile(abs, 'slow.pdf', { workerPath: HANG_WORKER, timeoutMs: 300 });
    expect(result).toEqual({
      ok: false,
      code: 'type_mismatch',
      message: 'That file could not be read. Re-save it and try again.',
    });
  });

  it('still accepts and still refuses the ordinary cases through the worker', async () => {
    expect(await validateStagedFile(write('real.pdf', PDF_BYTES), 'real.pdf')).toEqual({
      ok: true,
      mimeType: 'application/pdf',
      ext: 'pdf',
    });

    // A PNG wearing a .pdf name is still caught — the sniff moved, not the rule.
    const mismatch = await validateStagedFile(write('liar.pdf', PNG_BYTES), 'liar.pdf');
    expect(mismatch).toMatchObject({ ok: false, code: 'type_mismatch' });

    // Signature-less text is still accepted for the text extensions.
    expect(await validateStagedFile(write('notes.txt', Buffer.from('a,b,c\n1,2,3\n')), 'notes.txt')).toMatchObject({
      ok: true,
      mimeType: 'text/plain',
    });

    expect(await validateStagedFile(write('empty.pdf', Buffer.alloc(0)), 'empty.pdf')).toMatchObject({
      ok: false,
      code: 'empty_file',
    });
  });
});

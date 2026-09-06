/**
 * Virus scanning through clamd's INSTREAM command.
 *
 * DEVIATION from the plan, which named the `clamscan` package: this is a direct
 * socket client instead. INSTREAM is a small, stable protocol, and writing it
 * here buys two things that matter more than the dependency — exact control of
 * the timeout, and the ability to test the infected / unreachable / timeout
 * paths against a fake clamd on a real socket, on a machine with no ClamAV
 * installed. The one test that needs a genuine clamd is tagged and skips.
 *
 * The invariant this file exists to protect (invariant 3): **a file is never
 * reported clean unless a scanner actually said so.** Every failure mode —
 * unreachable, timeout, garbled reply — returns `error`, never `clean`.
 *
 * Protocol: send `zINSTREAM\0`, then chunks as [uint32 big-endian length][bytes],
 * then a zero-length chunk to finish. clamd replies `stream: OK`,
 * `stream: <signature> FOUND`, or an error string.
 */
import fs from 'node:fs';
import net from 'node:net';

export type ScanVerdict = 'clean' | 'infected' | 'error';

export interface ScanResult {
  verdict: ScanVerdict;
  /** The signature name for `infected`, or why the scan could not be completed. */
  detail: string | null;
}

const CHUNK_SIZE = 64 * 1024;

export function clamdHost(): string {
  return process.env.CLAMD_HOST || '127.0.0.1';
}

export function clamdPort(): number {
  const parsed = Number.parseInt(process.env.CLAMD_PORT || '3310', 10);
  return Number.isFinite(parsed) ? parsed : 3310;
}

export function scanTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.CLAMD_TIMEOUT_MS || '60000', 10);
  return Number.isFinite(parsed) ? parsed : 60_000;
}

/**
 * Whether a clean scan is required before anything is published.
 *
 * Production is always true. Setting `SCAN_REQUIRED=false` (dev and test, where
 * there is no clamd) does NOT mean "publish anyway" — it means uploads are
 * accepted and left `pending`, which is the honest state for a file nothing has
 * looked at. Nothing marks them clean.
 */
export function scanRequired(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return process.env.SCAN_REQUIRED !== 'false';
}

/** Asks clamd whether it is alive. Used by the ops status and the tagged test. */
export async function ping(timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: clamdHost(), port: clamdPort() });
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (d) => finish(d.toString('utf8').includes('PONG')));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

/**
 * Streams a file to clamd and waits for its verdict.
 *
 * Never throws: a caller deciding what to do with a client's document should not
 * also have to handle a socket exception, and an exception that escaped here
 * could be mistaken for a clean result somewhere up the stack.
 */
export async function scanFile(absPath: string): Promise<ScanResult> {
  return new Promise((resolve) => {
    let settled = false;
    // Held so that every exit closes it. A timed-out or errored scan that left
    // the read stream open would leak a descriptor and keep the file locked —
    // which on Windows also blocks anything trying to delete it afterwards.
    let reading: fs.ReadStream | null = null;

    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reading?.destroy();
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ verdict: 'error', detail: `clamd did not answer within ${scanTimeoutMs()} ms` }),
      scanTimeoutMs()
    );

    const socket = net.createConnection({ host: clamdHost(), port: clamdPort() });
    let reply = '';

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const stream = fs.createReadStream(absPath, { highWaterMark: CHUNK_SIZE });
      reading = stream;

      stream.on('data', (chunk: string | Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(buf.length, 0);
        socket.write(header);
        socket.write(buf);
      });
      stream.on('end', () => {
        // Zero-length chunk: "that is the whole file".
        socket.write(Buffer.from([0, 0, 0, 0]));
      });
      stream.on('error', (err) => finish({ verdict: 'error', detail: `could not read the staged file: ${err.message}` }));
    });

    socket.on('data', (d) => {
      reply += d.toString('utf8');
      if (reply.includes('\0') || reply.includes('\n')) finish(interpret(reply));
    });
    socket.on('error', (err) => finish({ verdict: 'error', detail: `clamd unreachable: ${err.message}` }));
    socket.on('close', () => finish(interpret(reply)));
  });
}

/** clamd's one-line answer → a verdict. Anything unrecognised is an error, never clean. */
export function interpret(reply: string): ScanResult {
  const text = reply.replace(/\0/g, '').trim();
  if (!text) return { verdict: 'error', detail: 'clamd closed the connection without answering' };
  if (/\bOK$/.test(text)) return { verdict: 'clean', detail: null };

  const found = /^stream:\s*(.+?)\s+FOUND$/i.exec(text);
  if (found) return { verdict: 'infected', detail: found[1] };

  if (/size limit exceeded/i.test(text)) return { verdict: 'error', detail: 'clamd refused the file: stream size limit exceeded' };
  return { verdict: 'error', detail: `clamd said: ${text.slice(0, 200)}` };
}

/**
 * The scan step of the pipeline. With scanning switched off (dev/test, no clamd)
 * it returns `pending` rather than pretending: the upload is accepted, the file
 * is stored, and nothing claims it is clean.
 */
export async function scanForPipeline(absPath: string): Promise<{ status: 'clean' | 'infected' | 'error' | 'pending'; detail: string | null }> {
  if (!scanRequired()) {
    return { status: 'pending', detail: 'SCAN_REQUIRED=false: stored without scanning, not published' };
  }
  const result = await scanFile(absPath);
  return { status: result.verdict, detail: result.detail };
}

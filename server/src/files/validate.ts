/**
 * What a staged file is actually allowed to be.
 *
 * The rule that matters: **the extension is a claim, the bytes are the truth.**
 * A `.pdf` whose first bytes are a PNG is refused, because a file that lies
 * about what it is will lie to whatever opens it next. The allowlist is closed —
 * an unknown type is rejected rather than passed through.
 *
 * Encrypted files are refused too. Not because they are dangerous, but because
 * a scanner cannot see inside them: publishing one would mean serving bytes
 * nothing has ever checked.
 */
import fs from 'node:fs';
import { SniffTimeout, sniffHead, type SniffOptions } from './sniff.js';

/** Accepted types → the canonical extension the version is stored under. */
export const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** Extensions a client may send, mapped to the canonical MIME we file them as. */
const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  csv: 'text/csv',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * Office files are ZIPs and old Office files are OLE containers, so `file-type`
 * reports the container. Both are accepted for the matching extension — the
 * point of the sniff is to catch a PNG wearing a .pdf name, not to re-implement
 * OOXML parsing.
 */
const CONTAINER_EQUIVALENTS: Record<string, string[]> = {
  'application/zip': ['xlsx', 'docx', 'pptx'],
  'application/x-cfb': ['xls', 'doc', 'ppt'],
};

export type ValidationCode = 'unsupported_type' | 'type_mismatch' | 'encrypted' | 'empty_file';

export interface ValidationFailure {
  ok: false;
  code: ValidationCode;
  message: string;
}

export interface ValidationSuccess {
  ok: true;
  /** The canonical MIME the version is recorded as. */
  mimeType: string;
  /** The canonical extension the storage key ends in. */
  ext: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const fail = (code: ValidationCode, message: string): ValidationFailure => ({ ok: false, code, message });

/** The extension a filename claims, lowercased and without the dot. */
export function claimedExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : '';
}

/** Text files have no magic bytes, so they are checked for being plausibly text. */
function looksLikeText(buf: Buffer): boolean {
  // A NUL byte in the first block is the clearest sign this is not text.
  if (buf.includes(0)) return false;
  const sample = buf.subarray(0, 4096);
  let suspicious = 0;
  for (const byte of sample) {
    const printable = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126);
    if (!printable && byte < 128) suspicious++;
  }
  return suspicious / Math.max(sample.length, 1) < 0.05;
}

/** An encrypted PDF declares /Encrypt in its trailer; we refuse what a scanner cannot read. */
function pdfIsEncrypted(buf: Buffer): boolean {
  return buf.includes(Buffer.from('/Encrypt'));
}

/** An OOXML file whose ZIP is encrypted shows up as an OLE container with this marker. */
function ooxmlIsEncrypted(buf: Buffer): boolean {
  return buf.includes(Buffer.from('EncryptedPackage', 'utf16le')) || buf.includes(Buffer.from('EncryptedPackage'));
}

/**
 * Validates a staged file.
 *
 * The type comes from the first few KB through `sniffHead`, which parses them in
 * a worker it can kill (F1 — see `sniff.ts`). The whole file is still read, but
 * only for the text and encryption checks, which are `Buffer.includes` scans:
 * linear, no parser, and bounded by the 25 MB upload limit.
 *
 * `sniffOptions` exists so a test can point the sniff at a worker that hangs;
 * production passes nothing.
 */
export async function validateStagedFile(
  absPath: string,
  originalFilename: string,
  sniffOptions?: SniffOptions
): Promise<ValidationResult> {
  const stat = fs.statSync(absPath);
  if (stat.size === 0) return fail('empty_file', 'That file is empty.');

  const ext = claimedExtension(originalFilename);
  const claimedMime = EXTENSION_TO_MIME[ext];
  if (!claimedMime) {
    return fail('unsupported_type', `DocFlow does not accept .${ext || 'unknown'} files. Try PDF, an image, or an Office document.`);
  }

  const buf = fs.readFileSync(absPath);
  let sniffed: { mime: string; ext: string } | null;
  try {
    sniffed = await sniffHead(buf, sniffOptions);
  } catch (err) {
    // A parse that had to be killed tells us nothing about the bytes, so the
    // file is refused rather than guessed at. The client gets something they
    // can act on instead of the reason, which is ours to fix, not theirs.
    if (err instanceof SniffTimeout) {
      return fail('type_mismatch', 'That file could not be read. Re-save it and try again.');
    }
    throw err;
  }

  if (!sniffed) {
    // No signature at all: only the text formats are legitimately signature-less.
    if (claimedMime === 'text/csv' || claimedMime === 'text/plain') {
      if (!looksLikeText(buf)) return fail('type_mismatch', 'That file is named as text but does not contain text.');
      return { ok: true, mimeType: claimedMime, ext: ALLOWED_TYPES[claimedMime] };
    }
    return fail('type_mismatch', `That file does not look like a ${ext.toUpperCase()} inside.`);
  }

  const equivalents = CONTAINER_EQUIVALENTS[sniffed.mime];
  const matches = sniffed.mime === claimedMime || (equivalents ? equivalents.includes(ext) : false);
  if (!matches) {
    return fail(
      'type_mismatch',
      `That file is named .${ext} but its contents are ${sniffed.ext.toUpperCase()}. Rename it or send the original.`
    );
  }

  if (claimedMime === 'application/pdf' && pdfIsEncrypted(buf)) {
    return fail('encrypted', 'That PDF is password-protected, so it cannot be checked for viruses. Send an unprotected copy.');
  }
  if (sniffed.mime === 'application/x-cfb' && ooxmlIsEncrypted(buf)) {
    return fail('encrypted', 'That file is password-protected, so it cannot be checked for viruses. Send an unprotected copy.');
  }

  return { ok: true, mimeType: claimedMime, ext: ALLOWED_TYPES[claimedMime] };
}

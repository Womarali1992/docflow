/**
 * Turning a client's filename into a `Content-Disposition` header, safely.
 *
 * The bug this exists to prevent, found the moment real filenames were used:
 * a document called `2026 Form 1040 — draft.pdf` contains an em dash, and Node
 * **throws** on a header value with any character outside Latin-1. Thrown from
 * inside an async route handler, that became an unhandled rejection and **took
 * the whole API process down** — one client uploading `Résumé.pdf` or a file
 * named with a curly quote could stop the server for everybody.
 *
 * So the quoted `filename=` is reduced to plain ASCII, and the real name — em
 * dashes, accents, Cyrillic, anything — travels in `filename*=UTF-8''…`, which
 * every browser released this decade prefers (RFC 6266 §4.3). Old clients get a
 * readable approximation; new ones get the exact name.
 */

/**
 * ASCII-only, quote-free, control-character-free. Never empty.
 *
 * Non-ASCII becomes `_` rather than being dropped, so `Bilanç.pdf` and
 * `Bilanc.pdf` cannot collapse into the same fallback and confuse someone
 * looking at two downloads.
 */
export function asciiFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\r\n"\\]/g, '_')
    // Anything Latin-1 and above: Node would refuse the header outright.
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/_{2,}/g, '_')
    .trim();
  return cleaned || 'download';
}

/**
 * The whole header value. `inline` for a preview, `attachment` for a download.
 *
 * Both parameters are always sent: `filename=` for anything that cannot read
 * the encoded form, `filename*=` for everything that can.
 */
export function contentDisposition(disposition: 'inline' | 'attachment', name: string): string {
  return `${disposition}; filename="${asciiFilename(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

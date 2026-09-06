import React from 'react';
import { api } from '@/api/client';
import type { VersionWithReviews } from '@/api/types';
import { I } from '../icons';

/**
 * The document itself.
 *
 * What can be shown inline is decided by the server (PDF and the four web image
 * types; everything else is 415 `not_previewable`), and the bytes come back
 * under `Content-Security-Policy: sandbox` with `X-Content-Type-Options:
 * nosniff`. The iframe carries its own empty `sandbox` on top of that: a
 * client's PDF is untrusted input that arrives from outside the firm, and it
 * renders inside the advisor's live session.
 *
 * A file still being checked is not shown at all — the notice says which case
 * it is, because "we are still looking at it" and "we found something in it"
 * call for very different things from the person reading them.
 */

/** Mirrors PREVIEWABLE in server/src/routes/versions.ts. */
const PREVIEWABLE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const isPdf = (mime?: string | null) => mime === 'application/pdf';
const isImage = (mime?: string | null) => Boolean(mime && PREVIEWABLE_IMAGE.has(mime));

const SCAN_NOTICE: Record<string, { title: string; body: string }> = {
  pending: {
    title: 'Still being checked',
    body: 'The virus scanner has this file. It opens as soon as the check finishes — no action needed.',
  },
  error: {
    title: 'The check has not finished',
    body: 'The scanner did not answer. It retries on its own; the file stays closed until it passes.',
  },
  encrypted: {
    title: 'Password-protected',
    body: 'This file is encrypted, so it could not be checked. Ask for a copy without a password.',
  },
  infected: {
    title: 'This file did not pass the virus check',
    body: 'It will never be served. Ask the client to send a clean copy.',
  },
};

interface Props {
  documentId: string;
  version: VersionWithReviews | null;
}

const DocumentPreview: React.FC<Props> = ({ documentId, version }) => {
  if (!version) {
    return (
      <div className="df-preview df-preview-empty">
        <div className="df-preview-msg">
          <strong>Nothing uploaded yet</strong>
          <div className="df-small df-muted">This document has no file on it.</div>
        </div>
      </div>
    );
  }

  if (!version.available) {
    const notice = SCAN_NOTICE[version.scanStatus] ?? SCAN_NOTICE.pending;
    return (
      <div className="df-preview df-preview-empty">
        <div className="df-preview-msg">
          <strong>{notice.title}</strong>
          <div className="df-small df-muted">{notice.body}</div>
          <div className="df-small df-muted" style={{ marginTop: 6 }}>
            {version.originalFilename} · v{version.versionNo}
          </div>
        </div>
      </div>
    );
  }

  const previewUrl = api.versions.previewUrl(documentId, version.id);
  const downloadUrl = api.versions.downloadUrl(documentId, version.id);

  if (isPdf(version.mimeType)) {
    return (
      <div className="df-preview">
        {/* Untrusted input rendered inside a live session: no scripts, no forms,
            no navigation. The server sends the same restriction as a header. */}
        <iframe className="df-preview-frame" src={previewUrl} sandbox="" title={version.originalFilename} />
        <div className="df-preview-foot">
          <span className="df-small df-muted">{version.originalFilename} · v{version.versionNo}</span>
          <a className="df-btn df-sm df-ghost" href={downloadUrl}>
            <I.Download size={12} /> Download
          </a>
        </div>
      </div>
    );
  }

  if (isImage(version.mimeType)) {
    return (
      <div className="df-preview">
        <div className="df-preview-frame df-preview-image">
          <img src={previewUrl} alt={version.originalFilename} />
        </div>
        <div className="df-preview-foot">
          <span className="df-small df-muted">{version.originalFilename} · v{version.versionNo}</span>
          <a className="df-btn df-sm df-ghost" href={downloadUrl}>
            <I.Download size={12} /> Download
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="df-preview df-preview-empty">
      <div className="df-preview-msg">
        <strong>Download to view</strong>
        <div className="df-small df-muted">
          Spreadsheets and Office files are not rendered in the browser — they open in the program that owns them.
        </div>
        <div className="df-small df-muted" style={{ marginTop: 6 }}>
          {version.originalFilename} · v{version.versionNo}
        </div>
        <a className="df-btn df-sm df-primary" style={{ marginTop: 10 }} href={downloadUrl}>
          <I.Download size={12} /> Download {version.originalFilename}
        </a>
      </div>
    </div>
  );
};

export default DocumentPreview;

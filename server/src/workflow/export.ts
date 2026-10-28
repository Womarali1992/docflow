/**
 * The season-end export (H8).
 *
 * When a return is filed, the firm wants the engagement as a folder: everything
 * the client sent that was accepted, everything the firm sent back, and a sheet
 * saying what each file is and that it is what it was. Until now the only way
 * to get that was to click Download thirty times and hope the filenames meant
 * something.
 *
 * Three rules this obeys, none of them new:
 *
 *  - **Only what was actually accepted.** A request that is still submitted,
 *    outstanding or waived is not part of the record; putting a file the advisor
 *    never accepted into the archive would make the archive a different claim
 *    from the one the workspace makes.
 *  - **Bytes come through the delivery guard, not around it.** Clean and
 *    published, exactly as `/download` requires (invariant 3). A quarantined or
 *    still-scanning version is listed in the manifest as omitted and its bytes
 *    are not in the zip — silence there would be the archive lying by absence.
 *  - **The manifest is the checkable part.** Title, filename, version, sha256,
 *    when it was accepted and by whom. A zip whose contents cannot be tied back
 *    to a decision is a folder of files, not a record.
 */
import fs from 'node:fs';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { Engagement } from '../db/schema.js';
import { absPathForKey, extOf } from '../files/store.js';

export interface ExportEntry {
  /** Path inside the zip, or null when the bytes are not includable. */
  path: string | null;
  /** Absolute path on disk; null when omitted. */
  absPath: string | null;
  requestTitle: string;
  category: string;
  originalFilename: string;
  versionNo: number;
  sizeBytes: number;
  sha256: string;
  acceptedAt: string | null;
  reviewer: string | null;
  kind: 'client_upload' | 'deliverable';
  /** Why it is not in the archive, when it is not. */
  omitted: string | null;
}

export interface ExportPlan {
  engagement: Engagement;
  entries: ExportEntry[];
  included: number;
  omitted: number;
  totalBytes: number;
}

/** Windows, zip readers and humans all dislike a different subset; refuse all of them. */
export function safeName(value: string): string {
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .trim();
  return cleaned.length ? cleaned.slice(0, 80) : 'untitled';
}

/** One CSV field, quoted the way every spreadsheet agrees on. */
function csvField(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function manifestCsv(entries: ExportEntry[]): string {
  const header = ['Request', 'Category', 'File', 'Version', 'Bytes', 'SHA-256', 'Accepted at', 'Reviewer', 'In archive', 'Note'];
  const rows = entries.map((e) =>
    [
      e.requestTitle,
      e.category,
      e.originalFilename,
      e.versionNo,
      e.sizeBytes,
      e.sha256,
      e.acceptedAt,
      e.reviewer,
      e.omitted ? 'no' : 'yes',
      e.omitted,
    ]
      .map(csvField)
      .join(',')
  );
  /* CRLF and a BOM: this is opened in Excel on a Windows box, and without them
     it opens as one column with mangled accents. */
  return '﻿' + [header.map(csvField).join(','), ...rows].join('\r\n') + '\r\n';
}

/** A name that will not collide inside the zip when two files share one. */
function unique(taken: Set<string>, candidate: string): string {
  if (!taken.has(candidate)) {
    taken.add(candidate);
    return candidate;
  }
  const dot = candidate.lastIndexOf('.');
  const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
  const ext = dot > 0 ? candidate.slice(dot) : '';
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
}

/**
 * What the archive would contain. Separated from the writing of it so the shape
 * can be asserted without unzipping anything, and so the route can answer 409
 * for an engagement with nothing to export before it sets a single header.
 */
export async function planExport(engagement: Engagement): Promise<ExportPlan> {
  const requests = await db
    .select()
    .from(schema.requests)
    .where(and(eq(schema.requests.engagementId, engagement.id), eq(schema.requests.status, 'accepted')))
    .orderBy(asc(schema.requests.sortOrder), asc(schema.requests.createdAt));

  /* Deliverables the client can see. An unshared draft is the firm's working
     copy and does not belong in the client's record of the season. */
  const deliverables = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.engagementId, engagement.id),
        eq(schema.documents.kind, 'deliverable'),
        isNotNull(schema.documents.sharedAt),
        isNull(schema.documents.archivedAt)
      )
    )
    .orderBy(asc(schema.documents.createdAt));

  /* The accepted requests' attachments, all of them: H5 made a checklist line
     hold several files, and an export that took only the first would silently
     drop five of six receipts. */
  const requestIds = requests.map((r) => r.id);
  const uploads = requestIds.length
    ? await db
        .select()
        .from(schema.documents)
        .where(
          and(
            inArray(schema.documents.requestId, requestIds),
            eq(schema.documents.kind, 'client_upload'),
            isNull(schema.documents.archivedAt)
          )
        )
        .orderBy(asc(schema.documents.createdAt))
    : [];

  const documents = [...uploads, ...deliverables];
  const versionIds = documents.map((d) => d.currentVersionId).filter((v): v is string => v !== null);
  const versions = versionIds.length
    ? await db.select().from(schema.documentVersions).where(inArray(schema.documentVersions.id, versionIds))
    : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));

  /* Who accepted what, and when. Newest decision per request wins — a line that
     was corrected and then accepted carries the acceptance, not the correction. */
  const reviews = requestIds.length
    ? await db
        .select()
        .from(schema.reviews)
        .where(and(inArray(schema.reviews.requestId, requestIds), eq(schema.reviews.decision, 'accepted')))
        .orderBy(desc(schema.reviews.createdAt))
    : [];
  const acceptanceByRequest = new Map<string, (typeof reviews)[number]>();
  for (const r of reviews) {
    if (r.requestId && !acceptanceByRequest.has(r.requestId)) acceptanceByRequest.set(r.requestId, r);
  }

  const reviewerIds = [...new Set(reviews.map((r) => r.reviewerId))];
  const reviewers = reviewerIds.length
    ? await db
        .select({ id: schema.providers.id, name: schema.providers.name })
        .from(schema.providers)
        .where(inArray(schema.providers.id, reviewerIds))
    : [];
  const reviewerName = new Map(reviewers.map((p) => [p.id, p.name]));

  const requestById = new Map(requests.map((r) => [r.id, r]));
  const taken = new Set<string>();
  const entries: ExportEntry[] = [];
  let totalBytes = 0;

  for (const doc of documents) {
    const request = doc.requestId ? requestById.get(doc.requestId) : undefined;
    const isDeliverable = doc.kind === 'deliverable';
    const requestTitle = request?.title ?? doc.name;
    const category = isDeliverable ? 'Deliverables' : safeName(request?.category || 'Documents');
    const acceptance = doc.requestId ? acceptanceByRequest.get(doc.requestId) : undefined;

    const version = doc.currentVersionId ? versionById.get(doc.currentVersionId) : undefined;
    const base: Omit<ExportEntry, 'path' | 'absPath' | 'omitted'> = {
      requestTitle,
      category,
      originalFilename: version?.originalFilename ?? doc.name,
      versionNo: version?.versionNo ?? 0,
      sizeBytes: version?.sizeBytes ?? 0,
      sha256: version?.sha256 ?? '',
      acceptedAt: acceptance ? acceptance.createdAt.toISOString() : null,
      reviewer: acceptance ? (reviewerName.get(acceptance.reviewerId) ?? null) : null,
      kind: isDeliverable ? 'deliverable' : 'client_upload',
    };

    /* The same guard `/download` applies, applied here rather than trusted:
       clean and published, and the bytes still on disk. Anything else is a row
       in the manifest saying why it is not in the zip. */
    let omitted: string | null = null;
    if (!version) omitted = 'no file was ever attached';
    else if (version.scanStatus === 'infected') omitted = 'quarantined by the virus check';
    /* `pending` and an unpublished clean version are the same thing to the
       person reading this sheet: it has not finished being checked. Naming the
       internal status ("the virus check said pending") told them nothing and
       read like a fault. */
    else if (version.scanStatus !== 'clean' || version.publishedAt === null) omitted = 'still being checked';

    let absPath: string | null = null;
    if (!omitted && version) {
      try {
        const candidate = absPathForKey(version.storageKey);
        if (!fs.existsSync(candidate)) omitted = 'the stored file is missing';
        else absPath = candidate;
      } catch {
        omitted = 'the stored file could not be located';
      }
    }

    if (omitted) {
      entries.push({ ...base, path: null, absPath: null, omitted });
      continue;
    }

    const ext = extOf(base.originalFilename);
    /* A deliverable has no request to be named after, so it falls back to the
       document name — which is already a filename. Without this, `Return.pdf`
       exports as `Return.pdf — v1.pdf`; a checklist title like `W-2` is
       untouched, because it does not end in the file's own extension. */
    let stem = requestTitle;
    if (ext && stem.toLowerCase().endsWith(`.${ext}`)) stem = stem.slice(0, -(ext.length + 1));
    const name = unique(taken, `${category}/${safeName(stem)} — v${base.versionNo}${ext ? `.${ext}` : ''}`);
    entries.push({ ...base, path: name, absPath, omitted: null });
    totalBytes += base.sizeBytes;
  }

  return {
    engagement,
    entries,
    included: entries.filter((e) => e.path !== null).length,
    omitted: entries.filter((e) => e.omitted !== null).length,
    totalBytes,
  };
}

/** The archive's filename, for `Content-Disposition`. */
export function exportFilename(engagement: Engagement, clientName: string): string {
  return `${safeName(clientName)} — ${safeName(engagement.title)}.zip`;
}

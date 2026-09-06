/**
 * Legacy → workflow-model import (plan: "Migration (legacy → target), C2.1").
 *
 *   npm run db:import-legacy -- --backup-manifest <path> [--trust-legacy-files] [--dry-run]
 *
 * This is the one script in the program that touches every existing row, so it
 * is built to be boring and repeatable:
 *
 *   - It REFUSES to run without a backup manifest younger than 24 hours (R18).
 *     There is no override flag; take a backup instead.
 *   - It is IDEMPOTENT. Every step recognises its own previous output, so a
 *     second run converts nothing and changes no counts.
 *   - It COPIES files, never moves them. `server/uploads/` is untouched and
 *     stays the fallback until C5.4 deletes it.
 *   - It KEEPS legacy ids. A request carries the id of the document it came
 *     from, so existing links and any bookmarked URL still resolve.
 *   - A missing file is REPORTED, not fatal: the document survives with no
 *     current version, and the report names it.
 *
 * Rehearse it on a restored copy (`ops/windows/restore.ps1`) before pointing it
 * at anything real.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, pool, schema } from './client.js';
import { ensureKeyDir, extOf, newStorageKey } from '../files/store.js';
import { UPLOADS_DIR, absPathFor } from '../storage.js';
import { audit } from './audit.js';
import { enqueue } from '../jobs/queue.js';

const MANIFEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const IMPORTED_ENGAGEMENT_TITLE = 'Imported documents';

export interface ImportOptions {
  manifestPath: string;
  /** Mark imported versions `clean` instead of queueing them for a scan. */
  trustLegacyFiles?: boolean;
  /** Report only: no writes, no file copies. */
  dryRun?: boolean;
  /** Where to write migration-report.json (default: beside the manifest). */
  reportPath?: string;
  now?: Date;
}

export interface ImportReport {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  trustLegacyFiles: boolean;
  manifest: { path: string; createdAt: string; database: string; ageMinutes: number };
  clientCount: number;
  requestCount: number;
  documentCount: number;
  versionCount: number;
  bytesCopied: number;
  presetsConverted: number;
  engagementsCreated: number;
  reviewsCreated: number;
  /** Documents whose legacy file could not be read; kept, with no current version. */
  missingFiles: Array<{ documentId: string; name: string; storagePath: string; reason: string }>;
  /** Clients sharing a normalized address. C5.4's unique index fails until these are resolved. */
  duplicateEmails: Array<{ emailNormalized: string; clientIds: string[] }>;
  /** What a previous run had already converted (0 on a first run, everything on a second). */
  alreadyImported: { documents: number; requests: number; versions: number; engagements: number; templates: number };
}

class ImportError extends Error {}

/* ---------------------------------------------------------------- manifest */

interface Manifest {
  version: number;
  createdAt: string;
  database: string;
  counts?: Record<string, number>;
}

/**
 * The gate. A stale or missing manifest means there is no recent way back, and
 * this script is not the place to find that out afterwards.
 */
export function readManifest(manifestPath: string, now: Date): Manifest & { ageMs: number } {
  if (!manifestPath) {
    throw new ImportError(
      '--backup-manifest is required. Run ops\\windows\\backup.ps1 first, then pass the manifest.json it wrote.'
    );
  }
  const abs = path.resolve(manifestPath);
  if (!fs.existsSync(abs)) throw new ImportError(`No manifest at ${abs}`);

  let parsed: Manifest;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8')) as Manifest;
  } catch (err) {
    throw new ImportError(`Manifest at ${abs} is not readable JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!parsed || typeof parsed.createdAt !== 'string') {
    throw new ImportError(`Manifest at ${abs} has no createdAt — is it a DocFlow backup manifest?`);
  }

  const createdAt = new Date(parsed.createdAt);
  if (Number.isNaN(createdAt.getTime())) throw new ImportError(`Manifest createdAt is not a date: ${parsed.createdAt}`);
  const ageMs = now.getTime() - createdAt.getTime();
  if (ageMs > MANIFEST_MAX_AGE_MS) {
    throw new ImportError(
      `Backup manifest is ${(ageMs / 3_600_000).toFixed(1)} h old (limit 24 h). Take a fresh backup before importing.`
    );
  }
  if (ageMs < -5 * 60_000) {
    throw new ImportError(`Backup manifest is dated in the future (${parsed.createdAt}) — check the clock on this machine.`);
  }
  return { ...parsed, ageMs };
}

/* ------------------------------------------------------------------ import */

/** `Reports` was the legacy folder for advisor output; everything else came from the client. */
function kindForFolder(folder: string | null): 'deliverable' | 'client_upload' {
  return folder === 'Reports' ? 'deliverable' : 'client_upload';
}

/** Legacy review state → the review row it implies, if any. */
function reviewDecisionFor(status: string | null, hasUpdateRequest: boolean): 'accepted' | 'needs_correction' | null {
  if (hasUpdateRequest) return 'needs_correction';
  if (status === 'reviewed') return 'accepted';
  if (status === 'needs_update') return 'needs_correction';
  return null; // pending / in_review: nobody has decided yet
}

/**
 * Where a fulfilled request stands. The plan's base case is `requested`; a row
 * that already carries a file has plainly been answered, and leaving it as
 * `requested` would tell the advisor to chase a client who already delivered.
 */
function requestStatusFor(hasFile: boolean, status: string | null, hasUpdateRequest: boolean) {
  if (hasUpdateRequest || status === 'needs_update') return 'needs_correction' as const;
  if (!hasFile) return 'requested' as const;
  if (status === 'reviewed') return 'accepted' as const;
  return 'submitted' as const;
}

export async function importLegacy(opts: ImportOptions): Promise<ImportReport> {
  const now = opts.now ?? new Date();
  const startedAt = new Date();
  const manifest = readManifest(opts.manifestPath, now);
  const dryRun = Boolean(opts.dryRun);
  const trust = Boolean(opts.trustLegacyFiles);

  const report: ImportReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    dryRun,
    trustLegacyFiles: trust,
    manifest: {
      path: path.resolve(opts.manifestPath),
      createdAt: manifest.createdAt,
      database: manifest.database ?? '(unknown)',
      ageMinutes: Math.round(manifest.ageMs / 60_000),
    },
    clientCount: 0,
    requestCount: 0,
    documentCount: 0,
    versionCount: 0,
    bytesCopied: 0,
    presetsConverted: 0,
    engagementsCreated: 0,
    reviewsCreated: 0,
    missingFiles: [],
    duplicateEmails: [],
    alreadyImported: { documents: 0, requests: 0, versions: 0, engagements: 0, templates: 0 },
  };

  /* -- 5. Clients: normalized email, and the duplicates C5.4 will trip over -- */
  const clients = await db.select().from(schema.clients);
  report.clientCount = clients.length;
  const byNormalized = new Map<string, string[]>();
  for (const c of clients) {
    const normalized = c.email.trim().toLowerCase();
    byNormalized.set(normalized, [...(byNormalized.get(normalized) ?? []), c.id]);
    if (!dryRun && c.emailNormalized !== normalized) {
      await db.update(schema.clients).set({ emailNormalized: normalized }).where(eq(schema.clients.id, c.id));
    }
  }
  for (const [emailNormalized, clientIds] of byNormalized) {
    if (clientIds.length > 1) report.duplicateEmails.push({ emailNormalized, clientIds });
  }

  /* -- 2. One `imported` engagement per client, reused if it is already there -- */
  const engagementByClient = new Map<string, string>();
  for (const c of clients) {
    const [existing] = await db
      .select({ id: schema.engagements.id })
      .from(schema.engagements)
      .where(and(eq(schema.engagements.clientId, c.id), eq(schema.engagements.kind, 'imported')));
    if (existing) {
      engagementByClient.set(c.id, existing.id);
      report.alreadyImported.engagements++;
      continue;
    }
    if (dryRun) {
      engagementByClient.set(c.id, `(dry-run:${c.id})`);
      report.engagementsCreated++;
      continue;
    }
    const [created] = await db
      .insert(schema.engagements)
      .values({
        providerId: c.providerId,
        clientId: c.id,
        title: IMPORTED_ENGAGEMENT_TITLE,
        kind: 'imported',
        status: 'open',
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.engagements.id });
    engagementByClient.set(c.id, created.id);
    report.engagementsCreated++;
  }

  /* -- 3. Every legacy document row -- */
  const legacyDocs = await db.select().from(schema.documents);
  for (const doc of legacyDocs) {
    const engagementId = engagementByClient.get(doc.clientId);
    if (!engagementId) continue; // orphaned document (no client) — cannot happen through the FK

    if (doc.kind !== null) {
      // Converted by an earlier run. Count what is there and move on.
      report.alreadyImported.documents++;
      report.documentCount++;
      if (doc.requestId) {
        report.alreadyImported.requests++;
        report.requestCount++;
      }
      const versions = await db
        .select({ id: schema.documentVersions.id })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, doc.id));
      report.alreadyImported.versions += versions.length;
      report.versionCount += versions.length;
      continue;
    }

    const kind = kindForFolder(doc.folder);
    const hasUpdateRequest = Boolean(doc.hasUpdateRequest);

    /* The file, if the legacy row points at one we can actually read. */
    let versionId: string | null = null;
    let fileFound = false;
    if (doc.storagePath) {
      let absSource: string | null = null;
      let reason = '';
      try {
        absSource = absPathFor(doc.storagePath);
        if (!fs.existsSync(absSource)) {
          reason = `not found under ${UPLOADS_DIR}`;
          absSource = null;
        }
      } catch (err) {
        reason = err instanceof Error ? err.message : String(err);
        absSource = null;
      }

      if (!absSource) {
        report.missingFiles.push({ documentId: doc.id, name: doc.name, storagePath: doc.storagePath, reason });
      } else {
        const bytes = fs.readFileSync(absSource);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const uploadedAt = doc.uploadedAt ?? doc.createdAt ?? now;
        const ext = extOf(doc.storagePath) || extOf(doc.name) || 'bin';
        const storageKey = newStorageKey(uploadedAt, ext);
        fileFound = true;

        if (!dryRun) {
          // Copy, never move: the legacy tree stays intact until C5.4.
          fs.writeFileSync(ensureKeyDir(storageKey), bytes);
          const [version] = await db
            .insert(schema.documentVersions)
            .values({
              documentId: doc.id,
              versionNo: 1,
              originalFilename: doc.name,
              mimeType: doc.mimeType ?? 'application/octet-stream',
              sizeBytes: bytes.length,
              sha256,
              storageKey,
              // Never claim `clean` we did not verify: without --trust-legacy-files the
              // file waits for the scanner C2.3 wires up (invariant 3).
              scanStatus: trust ? 'clean' : 'pending',
              scannedAt: trust ? now : null,
              scanDetail: trust ? 'imported with --trust-legacy-files (not scanned)' : null,
              uploadedByKind: doc.uploadedByKind ?? 'client',
              uploadedById: doc.uploadedById ?? doc.clientId,
              publishedAt: trust ? uploadedAt : null,
              createdAt: uploadedAt,
            })
            .returning({ id: schema.documentVersions.id });
          versionId = version.id;
          if (!trust) await enqueue('scan_retry', { versionId, documentId: doc.id, source: 'legacy-import' });
        }
        report.versionCount++;
        report.bytesCopied += bytes.length;
      }
    }

    /* -- The document side of the row -- */
    if (!dryRun) {
      await db
        .update(schema.documents)
        .set({
          engagementId,
          kind,
          displayName: doc.name,
          category: doc.folder,
          currentVersionId: versionId,
          // Deliverables were already visible to the client, so they import as shared:
          // making them private now would silently take documents away.
          sharedAt: kind === 'deliverable' ? (doc.uploadedAt ?? doc.createdAt) : null,
          sharedById: kind === 'deliverable' ? doc.providerId : null,
          updatedAt: now,
        })
        .where(eq(schema.documents.id, doc.id));
    }
    report.documentCount++;

    /* -- 3a. A requested row also becomes a checklist line, keeping its id -- */
    if (doc.isRequested) {
      const status = requestStatusFor(fileFound, doc.status, hasUpdateRequest);
      if (!dryRun) {
        await db.insert(schema.requests).values({
          id: doc.id, // same id: old links keep resolving
          providerId: doc.providerId,
          clientId: doc.clientId,
          engagementId,
          title: doc.name,
          instructions: doc.description,
          category: doc.folder,
          required: true,
          dueDate: doc.dueDate,
          status,
          sortOrder: 0,
          importedFromDocumentId: doc.id,
          createdAt: doc.requestedAt ?? doc.createdAt ?? now,
          updatedAt: now,
        });
        await db.update(schema.documents).set({ requestId: doc.id }).where(eq(schema.documents.id, doc.id));
      }
      report.requestCount++;
    }

    /* -- 3b. The decision the legacy status implies -- */
    const decision = reviewDecisionFor(doc.status, hasUpdateRequest);
    if (decision) {
      if (!dryRun) {
        await db.insert(schema.reviews).values({
          documentId: doc.id,
          versionId,
          requestId: doc.isRequested ? doc.id : null,
          reviewerId: doc.providerId,
          decision,
          // The advisor's correction note is the one piece of legacy text worth carrying over.
          note: hasUpdateRequest ? doc.updateRequestDescription : null,
          createdAt: doc.updateRequestedAt ?? doc.uploadedAt ?? now,
        });
      }
      report.reviewsCreated++;
    }
  }

  /* -- 4. Presets → request templates -- */
  const presets = await db.select().from(schema.presets);
  for (const preset of presets) {
    const [existing] = await db
      .select({ id: schema.requestTemplates.id })
      .from(schema.requestTemplates)
      .where(and(eq(schema.requestTemplates.providerId, preset.providerId), eq(schema.requestTemplates.name, preset.name)));
    if (existing) {
      report.alreadyImported.templates++;
      report.presetsConverted++;
      continue;
    }
    const items = itemsFromBins(preset.bins);
    if (!dryRun) {
      await db.insert(schema.requestTemplates).values({
        providerId: preset.providerId,
        name: preset.name,
        kind: 'custom',
        items,
        createdAt: preset.createdAt ?? now,
        updatedAt: now,
      });
    }
    report.presetsConverted++;
  }

  report.finishedAt = new Date().toISOString();

  if (!dryRun) {
    await audit({
      action: 'legacy.import',
      targetType: 'database',
      actorKind: 'admin',
      meta: {
        documents: report.documentCount,
        requests: report.requestCount,
        versions: report.versionCount,
        missingFiles: report.missingFiles.length,
        trustLegacyFiles: trust,
      },
    });
  }

  return report;
}

/** Preset bins `[{label, items:[{name}]}]` → template items, category = the bin label. */
export function itemsFromBins(bins: unknown): Array<{ key: string; title: string; category: string | null; instructions: string | null; required: boolean }> {
  if (!Array.isArray(bins)) return [];
  const out: Array<{ key: string; title: string; category: string | null; instructions: string | null; required: boolean }> = [];
  for (const bin of bins) {
    const b = bin as { id?: unknown; label?: unknown; items?: unknown };
    const category = typeof b.label === 'string' ? b.label : null;
    const binKey = typeof b.id === 'string' ? b.id : slug(category ?? 'bin');
    if (!Array.isArray(b.items)) continue;
    for (const item of b.items) {
      const i = item as { name?: unknown; description?: unknown };
      const title = typeof i.name === 'string' ? i.name : null;
      if (!title) continue;
      out.push({
        key: `${binKey}:${slug(title)}`,
        title,
        category,
        instructions: typeof i.description === 'string' ? i.description : null,
        required: true,
      });
    }
  }
  return out;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';
}

/* --------------------------------------------------------------------- CLI */

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function value(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}

async function main() {
  const manifestPath = value('backup-manifest') ?? '';
  const dryRun = flag('dry-run');
  const opts: ImportOptions = {
    manifestPath,
    trustLegacyFiles: flag('trust-legacy-files'),
    dryRun,
    reportPath: value('report'),
  };

  const report = await importLegacy(opts);

  const reportPath = path.resolve(
    opts.reportPath ?? path.join(path.dirname(path.resolve(manifestPath)), 'migration-report.json')
  );
  if (!dryRun) {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log('');
  console.log(dryRun ? 'DRY RUN — nothing was written.' : 'Import complete.');
  console.log(`  manifest        ${report.manifest.path} (${report.manifest.ageMinutes} min old, db "${report.manifest.database}")`);
  console.log(`  clients         ${report.clientCount}`);
  console.log(`  engagements     ${report.engagementsCreated} created, ${report.alreadyImported.engagements} already there`);
  console.log(`  documents       ${report.documentCount} (${report.alreadyImported.documents} already imported)`);
  console.log(`  requests        ${report.requestCount}`);
  console.log(`  versions        ${report.versionCount} (${(report.bytesCopied / 1024).toFixed(1)} KB copied)`);
  console.log(`  reviews         ${report.reviewsCreated}`);
  console.log(`  templates       ${report.presetsConverted}`);
  console.log(`  scan status     ${report.trustLegacyFiles ? 'clean (--trust-legacy-files: NOT scanned)' : 'pending — scan jobs queued'}`);
  if (report.missingFiles.length) {
    console.log(`  MISSING FILES   ${report.missingFiles.length} (documents kept, no current version):`);
    for (const m of report.missingFiles.slice(0, 20)) console.log(`      ${m.name} — ${m.storagePath} (${m.reason})`);
    if (report.missingFiles.length > 20) console.log(`      … and ${report.missingFiles.length - 20} more (see the report)`);
  }
  if (report.duplicateEmails.length) {
    console.log(`  DUPLICATE EMAILS ${report.duplicateEmails.length} — resolve before C5.4 adds the unique index:`);
    for (const d of report.duplicateEmails) console.log(`      ${d.emailNormalized} → ${d.clientIds.join(', ')}`);
  }
  if (!dryRun) console.log(`\n  report written to ${reportPath}`);
  console.log('');
}

/** CLI mode only: importing this module from a test must not start a run. */
const invokedDirectly = Boolean(
  process.argv[1] && /migrate-legacy\.(ts|js)$/i.test(path.resolve(process.argv[1]))
);
if (invokedDirectly) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(`\n${err instanceof ImportError ? err.message : err}\n`);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}

export { ImportError };

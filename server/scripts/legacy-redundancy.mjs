#!/usr/bin/env node
/**
 * Is the legacy `server/uploads` tree redundant? — C5.4's deletion precondition.
 *
 * `npm run integrity` proves the legacy tree is *intact*. That is a different
 * question from whether it is *redundant*, and only the second one licenses an
 * `rm`. This script asks the second one: for every `documents.storage_path` that
 * is still set, are those exact bytes already under `DATA_ROOT` as a retained
 * version of the same document?
 *
 * Run it against a database that still HAS `storage_path` — that is, before
 * `0008_contract`. Afterwards there is nothing left to ask, and the script says
 * so instead of pretending to check.
 *
 * A legacy file counts as redundant when some version of the same document has
 * the same sha256, that version's bytes exist under DATA_ROOT, and they hash to
 * the same value. A superseded version still counts: the bytes are retained, and
 * keeping history is the point. A quarantined version does NOT count — its bytes
 * were deleted on purpose, so a hash match against its row proves nothing.
 *
 *   node scripts/legacy-redundancy.mjs [--url ...] [--data-root <dir>] [--uploads <dir>] [--json]
 *
 * Exit 0 only when every legacy file is redundant AND no file in the tree is an
 * orphan. Anything else exits 1 with a reason, and the tree stays.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { argValue, databaseUrl, hasFlag, isMain, redact, serverDir, sha256File } from './lib.mjs';

const norm = (p) => p.replace(/\\/g, '/');

/** Bytes were deliberately destroyed for these, so a row match means nothing. */
const BYTES_DELETED_ON_PURPOSE = new Set(['infected', 'encrypted']);

/**
 * Resolve a legacy storage path inside the uploads directory, refusing anything
 * that would escape it — the same guard the deleted `storage.ts#absPathFor` had.
 * A traversing value in the database is a finding, not something to follow.
 */
function legacyAbs(uploadsDir, storagePath) {
  const abs = path.resolve(uploadsDir, storagePath);
  const rel = path.relative(uploadsDir, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

/** @param {{ url: string, dataRoot: string, uploadsDir: string }} opts */
export async function checkRedundancy({ url, dataRoot, uploadsDir }) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let docs;
  let versions;
  try {
    const hasColumn = (
      await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'documents' AND column_name = 'storage_path'`
      )
    ).rowCount;
    if (!hasColumn) {
      return {
        ok: true,
        contracted: true,
        note: 'documents.storage_path no longer exists — 0008_contract has already run, so there is nothing to check.',
        legacyFiles: 0,
        redundant: [],
        notRedundant: [],
        orphans: [],
      };
    }
    docs = (
      await client.query(
        `SELECT id, name, storage_path, current_version_id
           FROM documents WHERE storage_path IS NOT NULL ORDER BY created_at`
      )
    ).rows;
    versions = (
      await client.query(
        `SELECT id, document_id, version_no, storage_key, sha256, scan_status,
                published_at IS NOT NULL AS published,
                superseded_at IS NOT NULL AS superseded
           FROM document_versions ORDER BY document_id, version_no`
      )
    ).rows;
  } finally {
    await client.end();
  }

  const byDocument = new Map();
  for (const v of versions) {
    if (!byDocument.has(v.document_id)) byDocument.set(v.document_id, []);
    byDocument.get(v.document_id).push(v);
  }

  const redundant = [];
  const notRedundant = [];
  const referenced = new Set();

  for (const doc of docs) {
    const abs = legacyAbs(uploadsDir, doc.storage_path);
    if (!abs) {
      notRedundant.push({ documentId: doc.id, name: doc.name, path: doc.storage_path, reason: 'storage_path escapes the uploads directory' });
      continue;
    }
    referenced.add(norm(abs).toLowerCase());
    if (!fs.existsSync(abs)) {
      // The row points at bytes that are already gone. Nothing can be lost by
      // deleting a tree that does not hold them, but it is a finding either way.
      notRedundant.push({ documentId: doc.id, name: doc.name, path: doc.storage_path, reason: 'legacy file is already missing from the tree' });
      continue;
    }

    const legacySha = sha256File(abs);
    const candidates = (byDocument.get(doc.id) ?? []).filter((v) => v.sha256 === legacySha);
    if (candidates.length === 0) {
      notRedundant.push({
        documentId: doc.id,
        name: doc.name,
        path: doc.storage_path,
        sha256: legacySha,
        reason: 'no version of this document has these bytes — deleting the tree would lose them',
      });
      continue;
    }

    let matched = null;
    const rejected = [];
    for (const v of candidates) {
      if (BYTES_DELETED_ON_PURPOSE.has(v.scan_status)) {
        rejected.push(`v${v.version_no} is ${v.scan_status} (bytes removed on purpose)`);
        continue;
      }
      const target = path.join(dataRoot, norm(v.storage_key));
      if (!fs.existsSync(target)) {
        rejected.push(`v${v.version_no} is recorded but its bytes are missing under DATA_ROOT`);
        continue;
      }
      if (sha256File(target) !== legacySha) {
        rejected.push(`v${v.version_no}'s bytes on disk differ from its recorded sha256`);
        continue;
      }
      matched = v;
      break;
    }

    if (!matched) {
      notRedundant.push({ documentId: doc.id, name: doc.name, path: doc.storage_path, sha256: legacySha, reason: rejected.join('; ') });
      continue;
    }
    redundant.push({
      documentId: doc.id,
      name: doc.name,
      path: doc.storage_path,
      sha256: legacySha,
      versionId: matched.id,
      versionNo: matched.version_no,
      storageKey: matched.storage_key,
      isCurrent: matched.id === doc.current_version_id,
      superseded: Boolean(matched.superseded),
      published: Boolean(matched.published),
      scanStatus: matched.scan_status,
    });
  }

  // Anything in the tree that no row points at. Deleting an orphan destroys the
  // only copy of something nobody is tracking, which is exactly the case that
  // deserves a human look before an `rm`.
  const orphans = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!referenced.has(norm(full).toLowerCase())) orphans.push(norm(path.relative(uploadsDir, full)));
    }
  };
  walk(uploadsDir);

  return {
    ok: notRedundant.length === 0 && orphans.length === 0,
    contracted: false,
    legacyFiles: redundant.length + notRedundant.length,
    redundant,
    notRedundant,
    orphans,
  };
}

if (isMain(import.meta.url)) {
  const url = databaseUrl();
  const dataRoot = path.resolve(argValue('--data-root') || process.env.DATA_ROOT || path.join(serverDir, '.data'));
  const uploadsDir = path.resolve(argValue('--uploads') || process.env.UPLOADS_DIR || path.join(serverDir, 'uploads'));
  const result = await checkRedundancy({ url, dataRoot, uploadsDir });

  if (hasFlag('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`database:  ${redact(url)}`);
    console.log(`DATA_ROOT: ${dataRoot}`);
    console.log(`uploads:   ${uploadsDir}`);
    console.log('');
    if (result.contracted) {
      console.log(result.note);
    } else {
      for (const r of result.redundant) {
        const where = r.isCurrent ? 'current' : r.superseded ? 'superseded' : 'retained';
        console.log(`  OK       ${r.path}  ->  v${r.versionNo} (${where}, ${r.scanStatus})  ${r.sha256.slice(0, 12)}…`);
      }
      for (const n of result.notRedundant) console.log(`  NOT OK   ${n.path}  ${n.reason}`);
      for (const o of result.orphans) console.log(`  ORPHAN   ${o}  no document row points at this file`);
      console.log('');
      console.log(
        `${result.redundant.length}/${result.legacyFiles} legacy file(s) redundant, ${result.orphans.length} orphan(s).`
      );
    }
    console.log(
      result.contracted
        ? 'N/A — this database is already contracted; the question no longer applies.'
        : result.ok
          ? 'PASS — every byte in the legacy tree is retained under DATA_ROOT. Safe to delete after a backup.'
          : 'FAIL — the legacy tree still holds bytes nothing else does. Do NOT delete it.'
    );
  }
  process.exit(result.ok ? 0 : 1);
}

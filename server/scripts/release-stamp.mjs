#!/usr/bin/env node
/**
 * Stamps `dist/release.json` after a build (H7).
 *
 * "Which build is this?" is the first question of any incident, and the audit
 * had to answer it by hand. The obvious implementation — shell out to `git` at
 * runtime — is the wrong one twice over: a deployed tree may not be a checkout
 * at all, and a server that runs `git` on request has turned a status page into
 * a subprocess. So the commit is recorded once, at build time, by the machine
 * that has the checkout, and read back as a plain file.
 *
 * `dirty` matters as much as the commit. A build made from a tree with
 * uncommitted changes is not the commit it names, and on a laptop deployment
 * that is not a hypothetical.
 *
 *   node scripts/release-stamp.mjs [--out dist/release.json]
 *
 * Never fails a build: a tree with no git available is stamped with nulls and a
 * note, because a missing commit id is a worse reason to fail than to record.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { argValue, isMain, serverDir } from './lib.mjs';

const repoRoot = path.resolve(serverDir, '..');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function releaseStamp(now = new Date()) {
  const commit = git(['rev-parse', 'HEAD']);
  const porcelain = commit === null ? null : git(['status', '--porcelain']);
  return {
    commit,
    short: commit ? commit.slice(0, 7) : null,
    branch: commit ? git(['rev-parse', '--abbrev-ref', 'HEAD']) : null,
    /* Null, not false, when git could not answer: "we did not look" and "the
       tree was clean" are different facts and the panel says which it has. */
    dirty: porcelain === null ? null : porcelain.length > 0,
    builtAt: now.toISOString(),
    node: process.version,
    note: commit === null ? 'not built from a git checkout, or git is not on PATH' : null,
  };
}

if (isMain(import.meta.url)) {
  const out = path.resolve(argValue('--out') || path.join(serverDir, 'dist', 'release.json'));
  const stamp = releaseStamp();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(stamp, null, 2), 'utf8');
  console.log(`release ${stamp.short ?? 'unknown'}${stamp.dirty ? ' (dirty)' : ''} -> ${path.relative(serverDir, out)}`);
}

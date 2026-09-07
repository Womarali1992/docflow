// Remove dist/ before a build.
//
// `tsc` only writes files; it never removes ones whose source has gone. After
// C5.4 deleted db/migrate-legacy.ts and routes/presets.ts, a plain rebuild left
// dist/db/migrate-legacy.js and dist/routes/presets.js behind — and the first of
// those is an operator-runnable importer that reads the `presets` table
// 0008_contract drops. ops\windows\update.ps1 builds in place on the firm PC, so
// without this the deployed tree keeps modules that cannot work any more.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');
rmSync(dist, { recursive: true, force: true });

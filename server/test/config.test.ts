/**
 * Where the server binds, and what production refuses to start without
 * (F7, hardening plan 2.7).
 *
 * Both halves of F7 are "the default is wrong and nothing says so": `listen`
 * without a host binds every interface on a laptop that joins other people's
 * wifi, and a production process with `DATA_ROOT` unset writes client documents
 * inside the checkout without complaint. The fix for each is a default that is
 * safe and a failure that is loud, so these tests assert the *messages* too —
 * a startup refusal nobody can act on just gets worked around with
 * NODE_ENV=development.
 */
import path from 'node:path';
import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { bindHost, productionConfigProblems, validateProductionConfig } from '../src/config/validate.js';

/** A production environment with nothing wrong with it. */
const GOOD: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATA_ROOT: process.platform === 'win32' ? 'D:\\docflow-data' : '/srv/docflow-data',
  APP_ENCRYPTION_KEY: 'a'.repeat(64),
  APP_BASE_URL: 'https://docs.example.com',
};

const keys = (env: NodeJS.ProcessEnv) => productionConfigProblems(env).map((p) => p.key);
const problem = (env: NodeJS.ProcessEnv, key: string) =>
  productionConfigProblems(env).find((p) => p.key === key)?.problem ?? '';

describe('bindHost', () => {
  it('is loopback unless something asks for otherwise, by name', () => {
    expect(bindHost({})).toBe('127.0.0.1');
    expect(bindHost({ HOST: '' })).toBe('127.0.0.1');
    expect(bindHost({ HOST: '   ' })).toBe('127.0.0.1');
    expect(bindHost({ HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(bindHost({ HOST: '192.168.1.20' })).toBe('192.168.1.20');
  });
});

describe('production configuration', () => {
  it('lets a correct production environment start', () => {
    expect(productionConfigProblems(GOOD)).toEqual([]);
  });

  it('refuses to start without somewhere outside the checkout to put documents', () => {
    const { DATA_ROOT: _omitted, ...missing } = GOOD;
    expect(keys(missing)).toContain('DATA_ROOT');
    expect(problem(missing, 'DATA_ROOT')).toMatch(/server\/\.data/);

    // The dangerous case is not "unset" but "set, and inside the repository":
    // documents would sit in the tree that gets rebuilt, synced and pushed.
    const inside = { ...GOOD, DATA_ROOT: path.resolve(process.cwd(), '.data') };
    expect(keys(inside)).toContain('DATA_ROOT');
    expect(problem(inside, 'DATA_ROOT')).toMatch(/inside the checkout/);

    // The repository root itself, and the server directory, are both inside it.
    expect(keys({ ...GOOD, DATA_ROOT: path.resolve(process.cwd(), '..') })).toContain('DATA_ROOT');
    expect(keys({ ...GOOD, DATA_ROOT: process.cwd() })).toContain('DATA_ROOT');
  });

  it('requires a real encryption key, because the development one is a published constant', () => {
    const { APP_ENCRYPTION_KEY: _omitted, ...missing } = GOOD;
    expect(keys(missing)).toContain('APP_ENCRYPTION_KEY');

    expect(keys({ ...GOOD, APP_ENCRYPTION_KEY: 'too-short' })).toContain('APP_ENCRYPTION_KEY');
    expect(keys({ ...GOOD, APP_ENCRYPTION_KEY: 'a'.repeat(62) })).toContain('APP_ENCRYPTION_KEY');

    // Both spellings the app itself accepts (crypto.ts parseKey) are accepted here.
    expect(keys({ ...GOOD, APP_ENCRYPTION_KEY: 'A'.repeat(64) })).not.toContain('APP_ENCRYPTION_KEY');
    expect(keys({ ...GOOD, APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') })).not.toContain('APP_ENCRYPTION_KEY');
  });

  it('requires an origin it can actually parse, and takes it from the same place appOrigin does', () => {
    const { APP_BASE_URL: _omitted, ...missing } = GOOD;
    expect(keys(missing)).toContain('APP_BASE_URL');

    expect(keys({ ...GOOD, APP_BASE_URL: 'docs.example.com' })).toContain('APP_BASE_URL');
    expect(keys({ ...GOOD, APP_BASE_URL: 'ftp://docs.example.com' })).toContain('APP_BASE_URL');

    // CORS_ORIGIN is the fallback in auth/csrf.ts appOrigin(); a validator that
    // disagreed with it would refuse a configuration that actually works.
    expect(keys({ ...missing, CORS_ORIGIN: 'https://docs.example.com' })).not.toContain('APP_BASE_URL');
  });

  it('says out loud that SCAN_REQUIRED=false is ignored, instead of letting it read as a setting', () => {
    expect(keys({ ...GOOD, SCAN_REQUIRED: 'false' })).toContain('SCAN_REQUIRED');
    expect(problem({ ...GOOD, SCAN_REQUIRED: 'false' }, 'SCAN_REQUIRED')).toMatch(/ignores/);
    expect(keys({ ...GOOD, SCAN_REQUIRED: 'true' })).not.toContain('SCAN_REQUIRED');
  });

  it('checks SMTP_URL only when it is set, because mail is optional', () => {
    expect(keys(GOOD)).not.toContain('SMTP_URL');
    expect(keys({ ...GOOD, SMTP_URL: 'not a url' })).toContain('SMTP_URL');
    expect(keys({ ...GOOD, SMTP_URL: 'smtps://user%40firm.com:pw@smtp.example.com:465' })).not.toContain('SMTP_URL');
  });

  it('lists every problem at once, so five broken lines are one restart and not five', () => {
    const found = keys({ NODE_ENV: 'production', SCAN_REQUIRED: 'false', SMTP_URL: 'nope' });
    expect(found).toEqual(['DATA_ROOT', 'APP_ENCRYPTION_KEY', 'APP_BASE_URL', 'SCAN_REQUIRED', 'SMTP_URL']);
  });

  /**
   * The list is only useful if it is what the operator actually sees, and that
   * depends on load order rather than on `validate.ts`.
   *
   * `app.ts` calls `appOrigin()` and `encryptionKey()` at module scope, and both
   * throw in production when unset. ESM evaluates imports before the module
   * body, so a static `import app from './app.js'` in `index.ts` meant the
   * process died on whichever threw first — one problem, as a stack trace —
   * and the list below was never reached. `index.ts` imports the app
   * dynamically for exactly this reason, and nothing but starting the real
   * process proves it stayed that way.
   */
  it('refuses to start, saying everything that is wrong, before anything else can throw', async () => {
    const run = (entry: string) =>
      new Promise<{ code: number | null; output: string }>((resolve) => {
        const child = execFile(
          process.execPath,
          [path.resolve(import.meta.dirname, '../node_modules/tsx/dist/cli.mjs'), entry],
          {
            cwd: path.resolve(import.meta.dirname, '..'),
            env: {
              ...process.env,
              NODE_ENV: 'production',
              // Explicitly empty rather than absent: `.env` would otherwise
              // supply the development values through dotenv.
              DATA_ROOT: '',
              APP_ENCRYPTION_KEY: '',
              APP_BASE_URL: '',
              CORS_ORIGIN: '',
              SCAN_REQUIRED: 'false',
            },
            timeout: 30_000,
          },
          (err, stdout, stderr) => {
            // exitCode is null when a child is killed by a signal; the callback's
            // error carries the status in that case.
            const fromError = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null;
            resolve({ code: child.exitCode ?? fromError, output: `${stdout}${stderr}` });
          }
        );
      });

    for (const entry of ['src/index.ts', 'src/worker.ts']) {
      const { code, output } = await run(entry);
      expect(code, entry).toBe(1);
      expect(output, entry).toContain('DocFlow cannot start in production');
      // Every problem, not just the first one to throw.
      expect(output, entry).toContain('DATA_ROOT');
      expect(output, entry).toContain('APP_ENCRYPTION_KEY');
      expect(output, entry).toContain('APP_BASE_URL');
      // And not the raw throw from auth/crypto.ts that used to win the race.
      expect(output, entry).not.toContain('at encryptionKey');
      expect(output, entry).not.toContain('listening on');
    }
  }, 70_000);

  it('leaves development and test alone, however wrong they look', () => {
    const broken = { DATA_ROOT: '', APP_ENCRYPTION_KEY: '', SCAN_REQUIRED: 'false' };
    // Nothing is checked and nothing exits: these both return normally.
    expect(() => validateProductionConfig({ ...broken, NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateProductionConfig({ ...broken, NODE_ENV: 'test' })).not.toThrow();
    expect(() => validateProductionConfig(broken)).not.toThrow();
  });
});

import 'dotenv/config';
import { bindHost, validateProductionConfig } from './config/validate.js';

/**
 * Before `./app.js` is even loaded (F7).
 *
 * `app.ts` calls `appOrigin()` and `encryptionKey()` at module scope, and both
 * throw in production when their variable is missing. ESM runs imports before
 * the module body, so a static `import app from './app.js'` would mean an
 * unconfigured production died on whichever of those came first, with a stack
 * trace, instead of printing every problem at once. Hence the dynamic import
 * below: the readable answer has to come first or it never comes at all.
 */
validateProductionConfig();

const { default: app, CORS_ORIGIN } = await import('./app.js');
const { defaultDistDir, isStaticEnabled } = await import('./security/static.js');

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = bindHost();

app.listen(PORT, HOST, () => {
  console.log(`docflow server listening on http://${HOST}:${PORT}`);
  if (isStaticEnabled()) {
    console.log(`serving the built app from ${defaultDistDir()}`);
  } else {
    console.log(`CORS allowing: ${CORS_ORIGIN}`);
  }
});

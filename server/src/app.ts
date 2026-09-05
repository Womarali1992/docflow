import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/clients.js';
import documentRoutes from './routes/documents.js';
import messageRoutes from './routes/messages.js';
import presetRoutes from './routes/presets.js';
import activityRoutes from './routes/activities.js';
import { appOrigin, originCheck } from './auth/csrf.js';
import { permissionsPolicy, securityHeaders } from './security/headers.js';
import { JSON_BODY_LIMIT, globalLimiter } from './security/limits.js';

export const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080';

/**
 * The Express application without a listener. `index.ts` binds the port for
 * the real server; the test suite drives this object directly through supertest.
 *
 * Middleware order matters: headers → CORS → body limits → cookies → throttle →
 * origin check → routers. The origin check sits before every router so no
 * state change (multipart uploads included) is reachable cross-site.
 */
const app = express();

app.disable('x-powered-by');
// Only behind Caddy (C5.3 sets TRUST_PROXY=1); express-rate-limit 8 refuses a permissive value.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(permissionsPolicy);
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(cookieParser());
app.use('/api', globalLimiter);
app.use('/api', originCheck);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/presets', presetRoutes);
app.use('/api/activities', activityRoutes);

// Unknown API routes → 404 JSON (must come after all mounts, before the error handler)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (isBodyParserError(err)) {
    res.status(err.status).json({ error: err.status === 413 ? 'Request body too large' : 'Malformed request body' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

function isBodyParserError(err: unknown): err is { status: 400 | 413 } {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 413 || status === 400;
}

// Fail fast on a misconfigured origin instead of refusing every POST at runtime.
appOrigin();

export default app;

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/clients.js';
import documentRoutes from './routes/documents.js';
import messageRoutes from './routes/messages.js';
import presetRoutes from './routes/presets.js';
import activityRoutes from './routes/activities.js';

export const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080';

/**
 * The Express application without a listener. `index.ts` binds the port for
 * the real server; the test suite drives this object directly through supertest.
 */
const app = express();

app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

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
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;

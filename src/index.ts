import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { generalLimiter } from './security';
import contactRouter from './routes/contact';
import { getDb } from './db';

const app = express();

app.set('trust proxy', config.trustedProxies);

app.use(helmet());
app.use(
  cors({
    origin: config.allowedOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  }),
);
app.use((_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader('X-Request-ID', res.locals.requestId);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', generalLimiter);
app.use('/api', contactRouter);

app.use((err: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(new Error('Response already started'));
    return;
  }
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error('request_failed', { requestId: res.locals.requestId });
  const message = status === 400 ? 'Invalid request body'
    : status === 413 ? 'Request body too large'
    : status === 415 ? 'Unsupported request body'
    : status < 500 ? 'Request rejected' : 'Internal server error';
  res.status(status).json({ success: false, error: message });
});

if (require.main === module) {
  try {
    getDb(); // Complete schema initialization before accepting any traffic.
    const server = app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
    });
    server.on('error', () => {
      console.error('server_start_failed');
      getDb().close();
      process.exit(1);
    });
    let shuttingDown = false;
    function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      const deadline = setTimeout(() => process.exit(1), 15_000);
      deadline.unref();
      server.close(() => {
        clearTimeout(deadline);
        getDb().close();
        process.exit(0);
      });
    }

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch {
    console.error('database_start_failed');
    process.exitCode = 1;
  }
}

export default app;

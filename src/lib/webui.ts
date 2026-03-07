import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from './logger.js';
import { loadProfiles } from './profiles.js';
import {
  getAllJobs,
  getStats,
  deleteJob,
  clearFailedJobForFile,
  getJobsByStatus,
  clearJobs,
} from './db.js';
import {
  getQueueStatus,
  pauseQueue,
  resumeQueue,
  isQueuePaused,
  queueFile,
} from './queue.js';
import type { GlobalConfig, Profile } from '../types/index.js';

// Augment express-session to include our custom fields
declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
  }
}

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

let cachedProfiles: Profile[] | null = null;

function getProfiles(): Profile[] {
  if (!cachedProfiles) {
    cachedProfiles = loadProfiles();
  }
  return cachedProfiles;
}

/**
 * Check if request comes from localhost.
 */
function isLocalRequest(req: express.Request): boolean {
  const ip = req.ip || req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Authentication middleware.
 */
function authMiddleware(config: GlobalConfig) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    // Skip auth for login endpoint
    if (req.path === '/auth/login' || req.path === '/auth/status') {
      next();
      return;
    }

    // Allow local requests if localAllow is enabled
    if (config.localAllow && isLocalRequest(req)) {
      next();
      return;
    }

    // Check session
    if (req.session.authenticated) {
      next();
      return;
    }

    res.status(401).json({ error: 'Unauthorized' });
  };
}

/**
 * Create and configure the Express app.
 */
function createApp(config: GlobalConfig): express.Express {
  const app = express();

  // Trust proxy for correct IP detection behind reverse proxies
  app.set('trust proxy', 'loopback');

  // CORS for development (Vite dev server on different port)
  app.use(cors({
    origin: true,
    credentials: true,
  }));

  app.use(express.json());

  // Session middleware
  app.use(session({
    secret: `transcorder-${config.webuiPassword}-${Date.now()}`,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // local tool, no HTTPS needed
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }));

  // Auth middleware for /api routes
  app.use('/api', authMiddleware(config));

  // ─── Auth Routes ────────────────────────────────────────────────────────

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === config.webuiUsername && password === config.webuiPassword) {
      req.session.authenticated = true;
      req.session.username = username;
      res.json({ ok: true, username });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get('/api/auth/status', (req, res) => {
    const localAllowed = config.localAllow && isLocalRequest(req);
    res.json({
      authenticated: req.session.authenticated || localAllowed,
      username: req.session.username || (localAllowed ? 'local' : null),
      localAllow: localAllowed,
    });
  });

  // ─── Stats ──────────────────────────────────────────────────────────────

  app.get('/api/stats', (_req, res) => {
    const stats = getStats();
    const queue = getQueueStatus();
    res.json({ ...stats, ...queue });
  });

  // ─── Jobs ───────────────────────────────────────────────────────────────

  app.get('/api/jobs', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 200;
    const jobs = getAllJobs(limit);
    res.json(jobs);
  });

  app.delete('/api/jobs/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid job ID' });
      return;
    }
    try {
      deleteJob(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/jobs/:id/retry', (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid job ID' });
      return;
    }
    try {
      // Find the failed job
      const failedJobs = getJobsByStatus('failed');
      const job = failedJobs.find(j => j.id === id);
      if (!job) {
        res.status(404).json({ error: 'Failed job not found' });
        return;
      }

      // Find the profile
      const profiles = getProfiles();
      const profile = profiles.find(p => p.name === job.profileName);
      if (!profile) {
        res.status(404).json({ error: `Profile "${job.profileName}" not found` });
        return;
      }

      // Clear the failed job and re-queue
      clearFailedJobForFile(job.sourcePath);
      queueFile(job.sourcePath, profile);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/jobs/clear', (req, res) => {
    const { status } = req.body;
    try {
      if (status) {
        clearJobs(status);
      } else {
        clearJobs();
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Queue Control ──────────────────────────────────────────────────────

  app.get('/api/queue/status', (_req, res) => {
    res.json(getQueueStatus());
  });

  app.post('/api/queue/pause', (_req, res) => {
    pauseQueue();
    res.json({ ok: true, paused: true });
  });

  app.post('/api/queue/resume', (_req, res) => {
    resumeQueue();
    res.json({ ok: true, paused: false });
  });

  // ─── Profiles ───────────────────────────────────────────────────────────

  app.get('/api/profiles', (_req, res) => {
    const profiles = getProfiles();
    res.json(profiles);
  });

  // ─── Serve static frontend ─────────────────────────────────────────────

  const webDistPath = path.join(PROJECT_ROOT, 'web', 'dist');
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    // SPA fallback: serve index.html for any non-API route
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.send(`
        <html>
          <body style="font-family: sans-serif; padding: 2rem; background: #1a1a2e; color: #e0e0e0;">
            <h1>Transcorder Web UI</h1>
            <p>Frontend not built. Run <code>cd web && npm run build</code> to build the dashboard.</p>
            <p>API is available at <code>/api/*</code></p>
          </body>
        </html>
      `);
    });
  }

  return app;
}

/**
 * Start the web UI server.
 * Returns a cleanup function to close the server.
 */
export function startWebUI(config: GlobalConfig): () => void {
  const app = createApp(config);
  const host = '0.0.0.0';
  const port = config.webuiPort;

  const server = app.listen(port, host, () => {
    logger.success(`Web UI available at http://localhost:${port}`);
  });

  return () => {
    server.close();
  };
}

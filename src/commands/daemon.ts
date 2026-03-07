import chalk from 'chalk';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { loadProfiles, loadGlobalConfig } from '../lib/profiles.js';
import { closeDb, getStats, hasCompletedJob, markInterruptedJobsAsFailed } from '../lib/db.js';
import { analyzeFile } from '../lib/check.js';
import { queueFile, resumePendingJobs, pauseQueue, resumeQueue, isQueuePaused, reinitWorkerSlots } from '../lib/queue.js';
import { startWatching, stopWatching, scanFolder } from '../lib/watcher.js';
import { clearAllCaches } from '../lib/cache.js';
import { showBanner } from '../lib/display.js';
import { destroyDashboard, setDashboardStats, setNumWorkers } from '../lib/dashboard.js';
import { startWebUI } from '../lib/webui.js';
import { enableLoggingIfNeeded } from './shared.js';

export async function startDaemon(verbose: boolean): Promise<void> {
  if (verbose) logger.setLevel('debug');

  const profiles = loadProfiles();
  const globalConfig = loadGlobalConfig();
  enableLoggingIfNeeded(profiles);

  // Configure worker count from global settings
  const numWorkers = globalConfig.workers;
  setNumWorkers(numWorkers);
  reinitWorkerSlots();

  console.clear();
  showBanner(profiles.length, numWorkers);

  // Mark interrupted jobs as failed & clean caches
  const interrupted = markInterruptedJobsAsFailed();
  if (interrupted > 0) logger.warn(`Marked ${interrupted} interrupted job(s) as failed`);
  clearAllCaches(profiles);

  // Resume any pending jobs from previous session
  resumePendingJobs(profiles);

  // Load existing stats from DB into dashboard
  const dbStats = getStats();
  setDashboardStats({
    completed: dbStats.completed,
    failed: dbStats.failed,
    skipped: dbStats.skipped,
    savedBytes: dbStats.savedBytes,
  });

  // ── Start Web UI if enabled ──
  let stopWebUI: (() => void) | null = null;
  if (globalConfig.webui) {
    stopWebUI = startWebUI(globalConfig);
  }

  // ── Pause on startup if configured ──
  if (globalConfig.pauseOnStartup) {
    pauseQueue();
    logger.info('Queue paused on startup (pauseOnStartup is enabled)');
  }

  // ── CLI keyboard shortcut: 'p' to toggle pause/resume ──
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key: string) => {
      if (key === 'p' || key === 'P') {
        if (isQueuePaused()) {
          resumeQueue();
          logger.info('Queue resumed via keyboard');
        } else {
          pauseQueue();
          logger.info('Queue paused via keyboard');
        }
      }
      // Ctrl+C
      if (key === '\u0003') {
        process.emit('SIGINT');
      }
    });
  }

  // ── Initial scan: process all existing files first ──
  let totalFiles = 0;
  let queuedFiles = 0;

  for (const profile of profiles) {
    for (const folder of profile.sourceFolders) {
      logger.info(`Scanning: ${folder} (profile: ${profile.name})`);
      const files = scanFolder(folder, profile.recursive);
      totalFiles += files.length;

      for (const filePath of files) {
        try {
          if (hasCompletedJob(filePath)) {
            logger.debug(`Skip: ${path.basename(filePath)} — already completed`);
            continue;
          }

          const result = await analyzeFile(filePath, profile);
          if (result.needsTranscode) {
            queueFile(filePath, profile);
            queuedFiles++;
          } else {
            logger.debug(`Skip: ${path.basename(filePath)} — meets criteria`);
          }
        } catch (err) {
          logger.error(`Error analyzing ${filePath}: ${(err as Error).message}`);
        }
      }
    }
  }

  logger.blank();
  logger.success(`Scan complete: ${totalFiles} files found, ${queuedFiles} queued for transcoding`);
  logger.blank();

  // ── Start watching for new files ──
  const watchers = startWatching(profiles, {
    onFileReady: (filePath, profile) => {
      queueFile(filePath, profile);
    },
  });

  logger.info('Daemon watching for changes. Press [p] to pause/resume, Ctrl+C to stop.');
  logger.blank();

  // Keep alive
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      destroyDashboard();
      if (stopWebUI) stopWebUI();
      logger.blank();
      logger.info('Shutting down...');
      await stopWatching(watchers);
      // Clean cache before exit
      clearAllCaches(profiles);
      logger.disableFileLogging();
      closeDb();
      resolve();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

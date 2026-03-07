import chalk from 'chalk';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { loadProfiles } from '../lib/profiles.js';
import { closeDb, getStats, hasCompletedJob, markInterruptedJobsAsFailed } from '../lib/db.js';
import { analyzeFile } from '../lib/check.js';
import { queueFile, resumePendingJobs } from '../lib/queue.js';
import { startWatching, stopWatching, scanFolder } from '../lib/watcher.js';
import { clearAllCaches } from '../lib/cache.js';
import { showBanner } from '../lib/display.js';
import { destroyDashboard, setDashboardStats } from '../lib/dashboard.js';
import { enableLoggingIfNeeded } from './shared.js';

export async function startDaemon(verbose: boolean): Promise<void> {
  if (verbose) logger.setLevel('debug');

  const profiles = loadProfiles();
  enableLoggingIfNeeded(profiles);
  console.clear();
  showBanner(profiles.length, 2);

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

  logger.info('Daemon watching for changes. Press Ctrl+C to stop.');
  logger.blank();

  // Keep alive
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      destroyDashboard();
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

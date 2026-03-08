import chalk from 'chalk';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { loadProfiles, loadGlobalConfig } from '../lib/profiles.js';
import { closeDb, getStats, hasCompletedJob, hasFailedJob, markInterruptedJobsAsFailed, getAllProcessedFiles } from '../lib/db.js';
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

  // ── Initial scan: discover files and queue new ones (no ffprobe here) ──
  let totalFiles = 0;
  let queuedFiles = 0;
  let knownFiles = 0;

  // Get all already-known files in one query for fast lookup
  const processedFiles = getAllProcessedFiles();
  logger.info(`Found ${processedFiles.size} already-known files in database`);

  for (const profile of profiles) {
    for (const folder of profile.sourceFolders) {
      logger.info(`Scanning: ${folder} (profile: ${profile.name})`);
      const files = scanFolder(folder, profile.recursive);
      totalFiles += files.length;
      logger.info(`Found ${files.length} video files in ${folder}`);

      // Queue all files not yet known to the database — analysis happens
      // later when the worker picks up the job (processFile → analyzeFile)
      for (const filePath of files) {
        if (processedFiles.has(filePath)) {
          knownFiles++;
        } else {
          queueFile(filePath, profile);
          queuedFiles++;
        }
      }
    }
  }

  logger.blank();
  logger.success(`Scan complete: ${totalFiles} files found, ${knownFiles} already known, ${queuedFiles} queued`);
  logger.blank();

  // ── Start watching for new files ──
  const watchers = startWatching(profiles, {
    onFileReady: (filePath, profile) => {
      queueFile(filePath, profile);
    },
  });

  logger.info('Daemon watching for changes. Press [p] to pause/resume, Ctrl+C to stop.');
  logger.blank();

  // ── Periodic rescanning ──────────────────────────────────────────────────
  let rescanTimer: NodeJS.Timeout | null = null;
  if (globalConfig.rescanIntervalHours > 0) {
    const intervalMs = globalConfig.rescanIntervalHours * 60 * 60 * 1000;
    logger.info(`Periodic rescanning enabled: every ${globalConfig.rescanIntervalHours} hours`);
    
    const performRescan = async () => {
      logger.info('Starting periodic rescan...');
      let newFiles = 0;
      
      // Get updated known files list
      const processedFiles = getAllProcessedFiles();
      
      for (const profile of profiles) {
        for (const folder of profile.sourceFolders) {
          const files = scanFolder(folder, profile.recursive);
          
          for (const filePath of files) {
            if (!processedFiles.has(filePath)) {
              queueFile(filePath, profile);
              newFiles++;
            }
          }
        }
      }
      
      if (newFiles > 0) {
        logger.info(`Periodic rescan complete: ${newFiles} new files queued`);
      } else {
        logger.debug('Periodic rescan complete: no new files found');
      }
    };
    
    rescanTimer = setInterval(performRescan, intervalMs);
  }

  // Keep alive
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      destroyDashboard();
      if (stopWebUI) stopWebUI();
      if (rescanTimer) clearInterval(rescanTimer);
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

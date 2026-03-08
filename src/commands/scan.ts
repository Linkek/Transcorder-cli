import chalk from 'chalk';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import { loadProfiles } from '../lib/profiles.js';
import { closeDb, getStats, hasCompletedJob, markInterruptedJobsAsFailed, getJobsByStatus, addJob, addMetadata, updateJobStatus } from '../lib/db.js';
import { formatResolution } from '../lib/ffmpeg.js';
import { analyzeFile } from '../lib/check.js';
import { transcode, replaceOriginal } from '../lib/transcode.js';
import { moveFile } from '../lib/utils.js';
import { queueFile, getQueueStatus } from '../lib/queue.js';
import { scanFolder } from '../lib/watcher.js';
import { clearAllCaches, removeCacheFile } from '../lib/cache.js';
import {
  showBanner,
  showTranscodeStart,
  showTranscodeEnd,
  showTranscodeError,
  createProgressBar,
  updateProgressBar,
} from '../lib/display.js';
import { destroyDashboard, setDashboardStats } from '../lib/dashboard.js';
import { showMenu, confirm, waitForKey } from '../lib/menu.js';
import { enableLoggingIfNeeded } from './shared.js';
import type { Profile } from '../types/index.js';

/** Direct CLI: scan all profiles and process (npm run scan) */
export async function scanAllDirect(verbose: boolean): Promise<void> {
  if (verbose) logger.setLevel('debug');

  const profiles = loadProfiles();
  enableLoggingIfNeeded(profiles);
  console.clear();
  showBanner(profiles.length, 2);

  // Mark interrupted jobs as failed & clean caches
  const interrupted = markInterruptedJobsAsFailed();
  if (interrupted > 0) logger.warn(`Marked ${interrupted} interrupted job(s) as failed`);
  clearAllCaches(profiles);

  // Load existing stats from DB into dashboard
  const dbStats = getStats();
  setDashboardStats({
    completed: dbStats.completed,
    failed: dbStats.failed,
    skipped: dbStats.skipped,
    savedBytes: dbStats.savedBytes,
  });

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

  if (queuedFiles === 0) {
    closeDb();
    return;
  }

  // Wait for all queue workers to finish (timeout after 24 hours as safety net)
  const SCAN_TIMEOUT_MS = 24 * 60 * 60 * 1000;
  await new Promise<void>((resolve) => {
    const startWait = Date.now();
    const check = setInterval(() => {
      const status = getQueueStatus();
      if (status.active === 0 && status.pending === 0) {
        clearInterval(check);
        resolve();
      } else if (Date.now() - startWait > SCAN_TIMEOUT_MS) {
        clearInterval(check);
        logger.warn('Scan timed out after 24 hours — some jobs may still be pending');
        resolve();
      }
    }, 1000);
  });

  destroyDashboard();
  logger.blank();

  // Show final stats
  const stats = getStats();
  const savedGB = stats.savedBytes / (1024 * 1024 * 1024);
  const savedStr = savedGB >= 1024
    ? `${(savedGB / 1024).toFixed(2)} TB`
    : savedGB >= 1
      ? `${savedGB.toFixed(2)} GB`
      : `${(stats.savedBytes / (1024 * 1024)).toFixed(2)} MB`;

  logger.success(`All done! ${stats.completed} completed, ${stats.failed} failed, ${stats.skipped} skipped`);
  logger.success(`Total space saved: ${savedStr}`);

  clearAllCaches(profiles);
  closeDb();
}

/** Interactive menu: scan & process */
export async function scanAndProcess(): Promise<void> {
  const profiles = loadProfiles();

  // Let user pick a profile or all
  const profileNames = profiles.map((p) => p.name);
  const allLabel = `All profiles (${profileNames.join(', ')})`;

  await showMenu('Scan & Process', [
    {
      label: allLabel,
      action: () => runScan(profiles),
    },
    ...profileNames.map((name) => ({
      label: `Profile: ${name}`,
      action: () => runScan(profiles.filter((p) => p.name === name)),
    })),
  ], { showBack: true, backLabel: 'Back to main menu' });
}

async function runScan(profiles: Profile[]): Promise<void> {
  let totalFiles = 0;
  let queuedFiles = 0;

  for (const profile of profiles) {
    for (const folder of profile.sourceFolders) {
      logger.info(`Scanning: ${folder} (profile: ${profile.name})`);
      const files = scanFolder(folder, profile.recursive);
      totalFiles += files.length;

      for (const filePath of files) {
        try {
          // Skip files that are already completed
          if (hasCompletedJob(filePath)) {
            const fileName = path.basename(filePath);
            logger.debug(`Skip: ${fileName} — already completed`);
            continue;
          }

          const result = await analyzeFile(filePath, profile);
          if (result.needsTranscode) {
            queueFile(filePath, profile);
            queuedFiles++;
          } else {
            const fileName = path.basename(filePath);
            logger.debug(`Skip: ${fileName} — meets criteria`);
          }
        } catch (err) {
          logger.error(`Error analyzing ${filePath}: ${(err as Error).message}`);
        }
      }
    }
  }

  logger.blank();
  logger.success(`Scan complete: ${totalFiles} files found, ${queuedFiles} queued for transcoding`);

  if (queuedFiles > 0) {
    const proceed = await confirm('Start processing queued files now?', true);
    if (proceed) {
      await processQueuedFiles(profiles);
    }
  }

  await waitForKey();
}

async function processQueuedFiles(profiles: Profile[]): Promise<void> {
  const pendingJobs = getJobsByStatus(['pending']);

  for (const job of pendingJobs) {
    const profile = profiles.find((p) => p.name === job.profileName);
    if (!profile) continue;

    const filePath = job.sourcePath;
    const fileName = path.basename(filePath);
    let cachePath: string | undefined;

    try {
      // Verify source file still exists
      if (!fs.existsSync(filePath)) {
        updateJobStatus(job.id, 'failed', { error: 'Source file no longer exists' });
        logger.warn(`Source file no longer exists: ${fileName}`);
        continue;
      }

      updateJobStatus(job.id, 'checking');
      const result = await analyzeFile(filePath, profile);

      if (!result.needsTranscode) {
        updateJobStatus(job.id, 'skipped');
        logger.info(`Skip: ${fileName}`);
        continue;
      }

      addMetadata(job.id, {
        codec: result.metadata.video.codec_name,
        width: result.metadata.video.width,
        height: result.metadata.video.height,
        duration: result.metadata.duration,
        isHDR: result.metadata.isHDR,
        hdrFormat: result.metadata.hdrFormat,
        fileSize: result.metadata.fileSize,
      });

      updateJobStatus(job.id, 'transcoding');
      const srcRes = formatResolution(result.metadata.video.width, result.metadata.video.height);
      const tgtRes = formatResolution(result.targetWidth, result.targetHeight);

      showTranscodeStart(fileName, srcRes, tgtRes, result.metadata.isHDR, profile.removeHDR);

      const progressBar = createProgressBar();
      progressBar.start(100, 0, { fps: '0', speed: '00:00:00' });
      const startTime = Date.now();

      cachePath = await transcode(result, profile, {
        onProgress: (progress) => updateProgressBar(progressBar, progress),
      }).promise;
      progressBar.stop();

      // Check size reduction before replacing
      const originalSize = result.metadata.fileSize;
      const transcodedSize = fs.statSync(cachePath).size;
      const reductionPercent = ((originalSize - transcodedSize) / originalSize) * 100;

      if (profile.minSizeReduction > 0 && reductionPercent < profile.minSizeReduction) {
        removeCacheFile(cachePath);
        cachePath = undefined;
        updateJobStatus(job.id, 'skipped');
        logger.info(`Skip: ${fileName} — size reduction ${reductionPercent.toFixed(1)}% < required ${profile.minSizeReduction}%`);
        continue;
      }

      updateJobStatus(job.id, 'replacing');
      let outputPath: string;
      if (profile.replaceFile) {
        outputPath = replaceOriginal(filePath, cachePath);
      } else {
        // Move to output location without deleting original
        const newFileName = path.basename(cachePath);
        const destDir = profile.outputFolder ? path.resolve(profile.outputFolder) : path.dirname(filePath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        outputPath = path.join(destDir, newFileName);
        moveFile(cachePath, outputPath);
      }
      cachePath = undefined; // moved successfully
      const outputSize = fs.statSync(outputPath).size;
      const elapsed = (Date.now() - startTime) / 1000;
      const savedBytes = originalSize - outputSize;

      updateJobStatus(job.id, 'completed', { outputPath, savedBytes });
      showTranscodeEnd(fileName, outputSize, elapsed);

    } catch (err) {
      const errMsg = (err as Error).message;
      updateJobStatus(job.id, 'failed', { error: errMsg });
      showTranscodeError(fileName, errMsg);
      // Clean up partial cache file on failure
      if (cachePath) removeCacheFile(cachePath);
    }
  }
}

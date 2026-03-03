import fs from 'node:fs';
import path from 'node:path';
import { moveFile } from './utils.js';
import { logger } from './logger.js';
import { analyzeFile } from './check.js';
import { transcode, replaceOriginal } from './transcode.js';
import { formatResolution, formatFileSize } from './ffmpeg.js';
import { buildOutputFileName } from './utils.js';
import { removeCacheFile } from './cache.js';
import {
  addJob,
  addMetadata,
  updateJobStatus,
  hasActiveJob,
  hasCompletedJob,
  clearFailedJobForFile,
  getJobsByStatus,
} from './db.js';
import {
  showTranscodeStart,
  showTranscodeEnd,
  showTranscodeError,
  showFileQueued,
  showFileSkipped,
  createProgressBar,
  updateProgressBar,
} from './display.js';
import type { Profile } from '../types/index.js';

const MAX_CONCURRENT = 2;
let activeWorkers = 0;
let processing = false;

interface QueueItem {
  filePath: string;
  profile: Profile;
}

const pendingQueue: QueueItem[] = [];

/**
 * Add a file to the processing queue.
 */
export function queueFile(filePath: string, profile: Profile): void {
  // Check if already queued or processing
  if (hasActiveJob(filePath)) {
    logger.debug(`Already queued/processing: ${filePath}`);
    return;
  }

  // Check if already completed
  if (hasCompletedJob(filePath)) {
    logger.debug(`Already completed: ${filePath}`);
    return;
  }

  // Clear any previous failed jobs for this file (allows retry)
  clearFailedJobForFile(filePath);

  const fileName = path.basename(filePath);
  const jobId = addJob(filePath, profile.name);
  showFileQueued(fileName, profile.name);

  pendingQueue.push({ filePath, profile });

  // Sort queue by priority (higher priority first)
  pendingQueue.sort((a, b) => b.profile.priority - a.profile.priority);

  // Kick off processing if not already running
  processNext();
}

/**
 * Process the next item in the queue if workers are available.
 */
function processNext(): void {
  if (activeWorkers >= MAX_CONCURRENT) return;

  // First try pending items from our in-memory queue
  const item = pendingQueue.shift();
  if (!item) return;

  activeWorkers++;
  processFile(item.filePath, item.profile)
    .catch((err) => logger.error(`Queue error: ${err.message}`))
    .finally(() => {
      activeWorkers--;
      processNext();
    });

  // Try to fill remaining worker slots
  if (activeWorkers < MAX_CONCURRENT) {
    processNext();
  }
}

/**
 * Move the transcoded file to its output destination (without deleting original).
 * If profile.outputFolder is set, save there. Otherwise, save alongside the source file.
 */
function moveToOutput(originalPath: string, cachePath: string, profile: Profile): string {
  const newFileName = path.basename(cachePath);
  let destDir: string;

  if (profile.outputFolder) {
    destDir = path.resolve(profile.outputFolder);
  } else {
    destDir = path.dirname(originalPath);
  }

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const newPath = path.join(destDir, newFileName);

  logger.debug(`Moving output: ${cachePath} → ${newPath}`);
  moveFile(cachePath, newPath);
  logger.debug(`Output saved to: ${newPath}`);

  return newPath;
}

/**
 * Process a single file: check → transcode → place output.
 */
async function processFile(filePath: string, profile: Profile): Promise<void> {
  const fileName = path.basename(filePath);
  let expectedCachePath: string | undefined;

  // Find the job in DB
  const jobs = getJobsByStatus('pending');
  const job = jobs.find((j) => j.sourcePath === filePath);
  if (!job) {
    logger.warn(`No pending job found for: ${filePath}`);
    return;
  }

  try {
    // ── Step 1: Check ─────────────────────────────────────────────────────
    updateJobStatus(job.id, 'checking');
    logger.debug(`Checking: ${filePath}`);

    const checkResult = await analyzeFile(filePath, profile);
    const { metadata } = checkResult;

    // Store metadata
    addMetadata(job.id, {
      codec: metadata.video.codec_name,
      width: metadata.video.width,
      height: metadata.video.height,
      duration: metadata.duration,
      bitrate: metadata.video.bit_rate,
      isHDR: metadata.isHDR,
      hdrFormat: metadata.hdrFormat,
      colorTransfer: metadata.video.color_transfer,
      audioStreams: metadata.audioStreams.length,
      subtitleStreams: metadata.subtitleStreams.length,
      fileSize: metadata.fileSize,
    });

    if (!checkResult.needsTranscode) {
      updateJobStatus(job.id, 'skipped');
      showFileSkipped(fileName, checkResult.reasons.join('; '));
      return;
    }

    // ── Step 2: Transcode ─────────────────────────────────────────────────
    updateJobStatus(job.id, 'transcoding');

    const srcRes = formatResolution(metadata.video.width, metadata.video.height);
    const tgtRes = formatResolution(checkResult.targetWidth, checkResult.targetHeight);

    showTranscodeStart(fileName, srcRes, tgtRes, metadata.isHDR, profile.removeHDR);

    // Compute this early so we can clean up on failure
    const hdrBeingRemoved = metadata.isHDR && profile.removeHDR;
    const outputFileName = buildOutputFileName({
      fileName,
      targetWidth: checkResult.targetWidth,
      targetHeight: checkResult.targetHeight,
      outputFormat: profile.outputFormat,
      renameFiles: profile.renameFiles,
      removeHDR: hdrBeingRemoved,
    });
    expectedCachePath = path.join(path.resolve(profile.cacheFolder), outputFileName);

    const progressBar = createProgressBar();
    progressBar.start(100, 0, { fps: '0', speed: '00:00:00' });
    const startTime = Date.now();

    const cachePath = await transcode(checkResult, profile, {
      onProgress: (progress) => {
        updateProgressBar(progressBar, progress);
      },
      onStart: (cmd) => {
        logger.debug(`FFmpeg started: ${cmd.slice(0, 200)}...`);
      },
    });

    progressBar.stop();

    // ── Step 3: Check size reduction ───────────────────────────────────────
    const originalSize = metadata.fileSize;
    const transcodedSize = fs.statSync(cachePath).size;
    const reductionPercent = ((originalSize - transcodedSize) / originalSize) * 100;

    if (profile.minSizeReduction > 0 && reductionPercent < profile.minSizeReduction) {
      // Not enough size reduction, skip this file
      removeCacheFile(cachePath);
      updateJobStatus(job.id, 'skipped');
      const reason = `Size reduction ${reductionPercent.toFixed(1)}% < required ${profile.minSizeReduction}%`;
      showFileSkipped(fileName, reason);
      logger.info(`${fileName}: ${reason}`);
      return;
    }

    // ── Step 4: Place output file ──────────────────────────────────────────
    updateJobStatus(job.id, 'replacing');

    let outputPath: string;
    if (profile.replaceFile) {
      // Replace original file with transcoded version
      outputPath = replaceOriginal(filePath, cachePath);
    } else {
      // Move to output location without deleting original
      outputPath = moveToOutput(filePath, cachePath, profile);
    }
    const outputSize = fs.statSync(outputPath).size;
    const elapsed = (Date.now() - startTime) / 1000;

    updateJobStatus(job.id, 'completed', { outputPath });

    showTranscodeEnd(fileName, outputSize, elapsed);
    logger.success(`${fileName} → ${path.basename(outputPath)} (${formatFileSize(outputSize)})`);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    updateJobStatus(job.id, 'failed', { error: errMsg });
    showTranscodeError(fileName, errMsg);

    // Clean up partial cache file on failure
    if (expectedCachePath) {
      removeCacheFile(expectedCachePath);
    }
  }
}

/**
 * Process existing pending jobs from the database (on startup).
 */
export function resumePendingJobs(profiles: Profile[]): void {
  const pendingJobs = getJobsByStatus('pending');
  if (pendingJobs.length === 0) return;

  logger.info(`Resuming ${pendingJobs.length} pending job(s) from previous session`);

  for (const job of pendingJobs) {
    const profile = profiles.find((p) => p.name === job.profileName);
    if (!profile) {
      logger.warn(`Profile "${job.profileName}" not found for job #${job.id}, skipping`);
      updateJobStatus(job.id, 'failed', { error: `Profile "${job.profileName}" not found` });
      continue;
    }

    pendingQueue.push({ filePath: job.sourcePath, profile });
  }

  processNext();
}

/**
 * Get current queue status.
 */
export function getQueueStatus(): { active: number; pending: number } {
  return {
    active: activeWorkers,
    pending: pendingQueue.length,
  };
}

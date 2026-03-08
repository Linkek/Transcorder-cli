import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import figures from 'figures';
import { moveFile, formatFileSize, formatDuration, buildOutputFileName } from './utils.js';
import { logger } from './logger.js';
import { analyzeFile } from './check.js';
import { transcode, replaceOriginal } from './transcode.js';
import type { TranscodeHandle } from './transcode.js';
import { runPreflight } from './preflight.js';
import { formatResolution, probeFile } from './ffmpeg.js';
import { removeCacheFile } from './cache.js';
import {
  addJob,
  addMetadata,
  addOutputMetadata,
  updateJobStatus,
  hasActiveJob,
  hasCompletedJob,
  getJobsByStatus,
} from './db.js';
import {
  showFileQueued,
  showFileSkipped,
} from './display.js';
import {
  getNumWorkers,
  initDashboard,
  setWorker,
  updateWorkerProgress,
  clearWorkerAndLog,
  clearWorker,
  dashLog,
  setPendingCount,
  updateDashboardStats,
} from './dashboard.js';
import type { Profile } from '../types/index.js';

let MAX_CONCURRENT = getNumWorkers();
let workerSlots: boolean[] = Array(MAX_CONCURRENT).fill(false);

/**
 * Reinitialize worker slots when NUM_WORKERS changes at startup.
 */
export function reinitWorkerSlots(): void {
  MAX_CONCURRENT = getNumWorkers();
  workerSlots = Array(MAX_CONCURRENT).fill(false);
}
let processing = false;
let paused = false;

/** Track active transcode handles per worker slot so we can kill them on pause */
const activeTranscodes = new Map<number, { handle: TranscodeHandle; jobId: number; filePath: string; profile: Profile }>();

interface QueueItem {
  filePath: string;
  profile: Profile;
  priority: number;
}

const pendingQueue: QueueItem[] = [];

function acquireSlot(): number {
  for (let i = 0; i < MAX_CONCURRENT; i++) {
    if (!workerSlots[i]) {
      workerSlots[i] = true;
      return i;
    }
  }
  return -1;
}

function releaseSlot(slot: number): void {
  workerSlots[slot] = false;
}

function activeWorkerCount(): number {
  return workerSlots.filter(Boolean).length;
}

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

  const fileName = path.basename(filePath);
  const jobId = addJob(filePath, profile.name, profile.priority);
  showFileQueued(fileName, profile.name);

  pendingQueue.push({ filePath, profile, priority: profile.priority });

  // Sort queue by priority (higher priority first)
  pendingQueue.sort((a, b) => b.priority - a.priority);
  setPendingCount(pendingQueue.length);

  // Kick off processing if not already running
  processNext();
}

/**
 * Process the next item in the queue if workers are available.
 */
function processNext(): void {
  if (paused) return;

  const slot = acquireSlot();
  if (slot === -1) return;

  // First try pending items from our in-memory queue
  const item = pendingQueue.shift();
  if (!item) {
    releaseSlot(slot);
    return;
  }

  setPendingCount(pendingQueue.length);

  // Ensure dashboard is active once we start processing
  initDashboard();

  processFile(item.filePath, item.profile, slot)
    .catch((err) => logger.error(`Queue error: ${err.message}`))
    .finally(() => {
      releaseSlot(slot);
      processNext();
    });

  // Try to fill remaining worker slots
  processNext();
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
async function processFile(filePath: string, profile: Profile, slot: number): Promise<void> {
  const fileName = path.basename(filePath);
  let expectedCachePath: string | undefined;

  // Find the job in DB
  const jobs = getJobsByStatus(['pending']);
  const job = jobs.find((j) => j.sourcePath === filePath);
  if (!job) {
    logger.warn(`No pending job found for: ${filePath}`);
    return;
  }

  const ts = () => chalk.gray(new Date().toLocaleTimeString('en-GB', { hour12: false }));

  try {
    // ── Step 0: Verify source file exists ──────────────────────────────────
    if (!fs.existsSync(filePath)) {
      updateJobStatus(job.id, 'failed', { error: 'Source file no longer exists' });
      updateDashboardStats({ failed: 1 });
      dashLog(`${ts()} ${chalk.red(figures.cross)} Missing: ${chalk.white(fileName)} — source file no longer exists`);
      return;
    }

    // ── Step 1: Check ─────────────────────────────────────────────────────
    updateJobStatus(job.id, 'checking');
    logger.debug(`Checking: ${filePath}`);

    const checkResult = await analyzeFile(filePath, profile);
    const { metadata } = checkResult;

    // Store source metadata
    addMetadata(job.id, {
      codec: metadata.video.codec_name,
      width: metadata.video.width,
      height: metadata.video.height,
      duration: metadata.duration,
      bitrate: metadata.video.bit_rate,
      isHDR: metadata.isHDR,
      hdrFormat: metadata.hdrFormat,
      colorTransfer: metadata.video.color_transfer,
      colorPrimaries: metadata.video.color_primaries,
      colorSpace: metadata.video.color_space,
      pixFmt: metadata.video.pix_fmt,
      frameRate: metadata.video.frame_rate,
      sar: metadata.video.sample_aspect_ratio,
      dar: metadata.video.display_aspect_ratio,
      audioStreams: metadata.audioStreams.length,
      subtitleStreams: metadata.subtitleStreams.length,
      fileSize: metadata.fileSize,
    });

    if (!checkResult.needsTranscode) {
      updateJobStatus(job.id, 'skipped');
      updateDashboardStats({ skipped: 1 });
      dashLog(`${ts()} ${chalk.gray(figures.line)} Skip: ${chalk.gray(fileName)} — ${chalk.gray(checkResult.reasons.join('; '))}`);
      return;
    }

    // ── Step 1.5: Preflight ────────────────────────────────────────────────
    updateJobStatus(job.id, 'preflight');
    logger.debug(`Running preflight for: ${filePath}`);
    setWorker(slot, fileName, formatResolution(metadata.video.width, metadata.video.height), '', false, false, 'preflight');

    const preflightResult = await runPreflight(metadata, profile, checkResult);

    // Log any preflight issues
    for (const issue of preflightResult.issues) {
      const icon = issue.severity === 'error' ? chalk.red(figures.cross)
        : issue.severity === 'warning' ? chalk.yellow(figures.warning)
        : chalk.blue(figures.info);
      dashLog(`${ts()} ${icon} Preflight: ${chalk.white(fileName)} — ${issue.message}`);
    }

    if (preflightResult.strategies.length === 0) {
      updateJobStatus(job.id, 'failed', { error: 'Preflight: no viable transcode strategy found — all test encodes failed' });
      updateDashboardStats({ failed: 1 });
      clearWorkerAndLog(slot,
        `${ts()} ${chalk.red(figures.cross)} Preflight failed: ${chalk.white(fileName)} — no viable strategy`,
      );
      return;
    }

    logger.debug(`Preflight selected ${preflightResult.strategies.length} strategy(s): ${preflightResult.strategies.map((s) => s.name).join(' → ')}`);

    // ── Step 2: Transcode ─────────────────────────────────────────────────
    updateJobStatus(job.id, 'transcoding');

    const srcRes = formatResolution(metadata.video.width, metadata.video.height);
    const tgtRes = formatResolution(checkResult.targetWidth, checkResult.targetHeight);

    // Set up the dashboard worker slot
    setWorker(slot, fileName, srcRes, tgtRes, metadata.isHDR, profile.removeHDR);

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

    const startTime = Date.now();

    const handle = transcode(checkResult, profile, {
      onProgress: (progress) => {
        updateWorkerProgress(slot, progress);
      },
      onStart: (cmd) => {
        logger.debug(`FFmpeg started: ${cmd.slice(0, 200)}...`);
      },
      onStrategySwitch: (from, to, reason) => {
        dashLog(`${ts()} ${chalk.yellow(figures.warning)} ${chalk.white(fileName)}: strategy ${chalk.gray(from)} → ${chalk.cyan(to)} (${reason})`);
      },
    }, preflightResult);

    // Register active transcode so pause can kill it
    activeTranscodes.set(slot, { handle, jobId: job.id, filePath, profile });

    let cachePath: string;
    try {
      cachePath = await handle.promise;
    } finally {
      activeTranscodes.delete(slot);
    }

    // ── Step 3: Check size reduction ───────────────────────────────────────
    const originalSize = metadata.fileSize;
    const transcodedSize = fs.statSync(cachePath).size;
    const reductionPercent = ((originalSize - transcodedSize) / originalSize) * 100;

    if (profile.minSizeReduction > 0 && reductionPercent < profile.minSizeReduction) {
      // Not enough size reduction, skip this file
      removeCacheFile(cachePath);
      updateJobStatus(job.id, 'skipped');
      updateDashboardStats({ skipped: 1 });
      const reason = `Size reduction ${reductionPercent.toFixed(1)}% < required ${profile.minSizeReduction}%`;
      clearWorkerAndLog(slot,
        `${ts()} ${chalk.gray(figures.line)} Skip: ${chalk.gray(fileName)} — ${chalk.gray(reason)}`,
      );
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
    const savedBytes = originalSize - outputSize;

    updateJobStatus(job.id, 'completed', { outputPath, savedBytes });
    updateDashboardStats({ completed: 1, savedBytes: Math.max(0, savedBytes) });

    // Store output metadata for debugging/auditing
    try {
      const outMeta = await probeFile(outputPath);
      addOutputMetadata(job.id, {
        codec: outMeta.video.codec_name,
        width: outMeta.video.width,
        height: outMeta.video.height,
        duration: outMeta.duration,
        bitrate: outMeta.video.bit_rate,
        isHDR: outMeta.isHDR,
        colorTransfer: outMeta.video.color_transfer,
        colorPrimaries: outMeta.video.color_primaries,
        colorSpace: outMeta.video.color_space,
        pixFmt: outMeta.video.pix_fmt,
        frameRate: outMeta.video.frame_rate,
        sar: outMeta.video.sample_aspect_ratio,
        dar: outMeta.video.display_aspect_ratio,
        audioStreams: outMeta.audioStreams.length,
        subtitleStreams: outMeta.subtitleStreams.length,
        fileSize: outMeta.fileSize,
      });
    } catch (err) {
      logger.debug(`Could not probe output for metadata: ${(err as Error).message}`);
    }

    const savedStr = savedBytes > 0 ? `, saved ${formatFileSize(savedBytes)}` : '';
    clearWorkerAndLog(slot,
      `${ts()} ${chalk.green(figures.tick)} Done: ${chalk.white(fileName)} ${chalk.gray(`(${formatFileSize(outputSize)}, ${formatDuration(elapsed)}${savedStr})`)}`,
    );
    logger.success(`${fileName} → ${path.basename(outputPath)} (${formatFileSize(outputSize)}${savedStr})`);

  } catch (error) {
    // If killed by pause, reset to pending — don't mark as failed
    if (paused) {
      updateJobStatus(job.id, 'pending');
      clearWorker(slot);
      if (expectedCachePath) {
        removeCacheFile(expectedCachePath);
      }
      return;
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    updateJobStatus(job.id, 'failed', { error: errMsg });
    updateDashboardStats({ failed: 1 });
    clearWorkerAndLog(slot,
      `${ts()} ${chalk.red(figures.cross)} Error: ${chalk.white(fileName)} — ${chalk.red(errMsg)}`,
    );

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
  const pendingJobs = getJobsByStatus(['pending']);
  if (pendingJobs.length === 0) return;

  logger.info(`Resuming ${pendingJobs.length} pending job(s) from previous session`);

  for (const job of pendingJobs) {
    const profile = profiles.find((p) => p.name === job.profileName);
    if (!profile) {
      logger.warn(`Profile "${job.profileName}" not found for job #${job.id}, skipping`);
      updateJobStatus(job.id, 'failed', { error: `Profile "${job.profileName}" not found` });
      continue;
    }

    // Check if the source file still exists (may have been replaced/renamed)
    if (!fs.existsSync(job.sourcePath)) {
      const name = path.basename(job.sourcePath);
      logger.warn(`Source file no longer exists, marking as failed: ${name}`);
      updateJobStatus(job.id, 'failed', { error: 'Source file no longer exists' });
      continue;
    }

    pendingQueue.push({ filePath: job.sourcePath, profile, priority: job.priority });
  }

  // Sort by stored priority (higher first)
  pendingQueue.sort((a, b) => b.priority - a.priority);

  processNext();
}

/**
 * Get current queue status.
 */
export function getQueueStatus(): { active: number; pending: number; paused: boolean } {
  return {
    active: activeWorkerCount(),
    pending: pendingQueue.length,
    paused,
  };
}

/**
 * Pause queue processing. Kills all active transcodes and resets their jobs to pending.
 */
export function pauseQueue(): void {
  paused = true;

  // Kill all active ffmpeg processes
  for (const [slot, entry] of activeTranscodes) {
    logger.info(`Killing active transcode on worker ${slot}: ${path.basename(entry.filePath)}`);
    entry.handle.kill();
  }

  logger.info('Queue paused — all workers stopped');
}

/**
 * Resume queue processing.
 */
export function resumeQueue(): void {
  paused = false;
  logger.info('Queue resumed');
  // Kick off processing for any pending items
  processNext();
}

/**
 * Check if queue is paused.
 */
export function isQueuePaused(): boolean {
  return paused;
}

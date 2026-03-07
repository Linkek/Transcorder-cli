import chalk from 'chalk';
import figures from 'figures';
import type { TranscodeProgress } from '../types/index.js';
import { formatDuration, formatFileSize } from './utils.js';
import { emitLogEntry } from './logger.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface WorkerState {
  fileName: string;
  srcRes: string;
  targetRes: string;
  hdr: boolean;
  removeHDR: boolean;
  progress: TranscodeProgress | null;
}

interface DashboardStats {
  completed: number;
  failed: number;
  skipped: number;
  savedBytes: number;
}

// ─── State ──────────────────────────────────────────────────────────────────

let NUM_WORKERS = 2;
const workers: (WorkerState | null)[] = Array(NUM_WORKERS).fill(null);
let active = false;
let renderedLines = 0;
let lastRenderTime = 0;
let pendingRenderTimer: ReturnType<typeof setTimeout> | null = null;
let queuePending = 0;
const stats: DashboardStats = { completed: 0, failed: 0, skipped: 0, savedBytes: 0 };

const RENDER_INTERVAL = 150; // ms between progress-only re-renders

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Activate the dashboard. After this, all output should go through dashLog().
 */
/**
 * Set the number of worker slots. Must be called before initDashboard().
 */
export function setNumWorkers(count: number): void {
  NUM_WORKERS = count;
  // Resize the workers array
  workers.length = count;
  for (let i = 0; i < count; i++) {
    if (workers[i] === undefined) workers[i] = null;
  }
}

export function getNumWorkers(): number {
  return NUM_WORKERS;
}

export function initDashboard(): void {
  if (active) return;
  active = true;
  render();
}

/**
 * Deactivate the dashboard and clear the rendered area.
 */
export function destroyDashboard(): void {
  if (!active) return;
  clearRendered();
  active = false;
  if (pendingRenderTimer) {
    clearTimeout(pendingRenderTimer);
    pendingRenderTimer = null;
  }
}

/**
 * Whether the dashboard is currently rendering.
 */
export function isDashboardActive(): boolean {
  return active;
}

/**
 * Print a message above the dashboard. When the dashboard is active this
 * properly clears the bottom section, writes the message, and re-renders.
 * When inactive it falls through to plain console.log.
 */
export function dashLog(message: string): void {
  // Emit to web UI log buffer (skip empty lines)
  if (message.trim()) {
    emitLogEntry('info', message);
  }
  if (!active) {
    console.log(message);
    return;
  }
  clearRendered();
  process.stdout.write(message + '\n');
  render();
}

/**
 * Update the pending-queue counter shown in the dashboard header.
 */
export function setPendingCount(count: number): void {
  queuePending = count;
  // Will be picked up on the next render — no immediate re-render needed.
}

/**
 * Update dashboard stats counters. Called after each job finishes.
 */
export function updateDashboardStats(update: Partial<DashboardStats>): void {
  if (update.completed !== undefined) stats.completed += update.completed;
  if (update.failed !== undefined) stats.failed += update.failed;
  if (update.skipped !== undefined) stats.skipped += update.skipped;
  if (update.savedBytes !== undefined) stats.savedBytes += update.savedBytes;
}

/**
 * Set dashboard stats to absolute values (e.g. from DB on startup).
 */
export function setDashboardStats(values: DashboardStats): void {
  stats.completed = values.completed;
  stats.failed = values.failed;
  stats.skipped = values.skipped;
  stats.savedBytes = values.savedBytes;
}

/**
 * Assign a worker slot (called when transcoding begins).
 */
export function setWorker(
  slot: number,
  fileName: string,
  srcRes: string,
  targetRes: string,
  hdr: boolean,
  removeHDR: boolean,
): void {
  workers[slot] = { fileName, srcRes, targetRes, hdr, removeHDR, progress: null };
  if (active) {
    clearRendered();
    render();
  }
}

/**
 * Update a worker's progress bar (throttled).
 */
export function updateWorkerProgress(slot: number, progress: TranscodeProgress): void {
  if (!workers[slot]) return;
  workers[slot]!.progress = progress;

  if (!active) return;

  const now = Date.now();
  if (now - lastRenderTime < RENDER_INTERVAL) {
    // Schedule a deferred render if one isn't already pending
    if (!pendingRenderTimer) {
      pendingRenderTimer = setTimeout(() => {
        pendingRenderTimer = null;
        clearRendered();
        render();
      }, RENDER_INTERVAL - (now - lastRenderTime));
    }
    return;
  }

  clearRendered();
  render();
}

/**
 * Clear a worker slot AND print a message in one atomic operation
 * (avoids double-render flicker).
 */
export function clearWorkerAndLog(slot: number, message: string): void {
  workers[slot] = null;
  // Emit to web UI log buffer
  if (message.trim()) {
    emitLogEntry('info', message);
  }
  if (!active) {
    console.log(message);
    return;
  }
  clearRendered();
  process.stdout.write(message + '\n');
  render();
}

/**
 * Clear a worker slot (no message).
 */
export function clearWorker(slot: number): void {
  workers[slot] = null;
  if (active) {
    clearRendered();
    render();
  }
}

/**
 * Get the current worker states for the API.
 */
export function getWorkerStates(): { slot: number; idle: boolean; fileName?: string; srcRes?: string; targetRes?: string; hdr?: boolean; removeHDR?: boolean; progress?: { percent: number; fps: number; speed: number; eta: number; currentSize: number; timemark: string } | null }[] {
  const result = [];
  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = workers[i];
    if (w) {
      result.push({
        slot: i,
        idle: false,
        fileName: w.fileName,
        srcRes: w.srcRes,
        targetRes: w.targetRes,
        hdr: w.hdr,
        removeHDR: w.removeHDR,
        progress: w.progress,
      });
    } else {
      result.push({ slot: i, idle: true });
    }
  }
  return result;
}

// ─── Internal rendering ────────────────────────────────────────────────────

function clearRendered(): void {
  if (renderedLines > 0) {
    process.stdout.write(`\x1B[${renderedLines}A\x1B[0J`);
    renderedLines = 0;
  }
}

function renderBar(progress: TranscodeProgress | null, width = 35): string {
  if (!progress) {
    return '  ' + chalk.gray('░'.repeat(width)) + ' ' + chalk.gray('0% | Waiting...');
  }

  const pct = Math.min(100, Math.max(0, Math.round(progress.percent)));
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = chalk.hex('#7C4DFF')('█'.repeat(filled)) + '░'.repeat(empty);
  const eta = progress.eta > 0 ? `${Math.round(progress.eta)}s` : '0s';

  return `  ${bar} ${chalk.white(String(pct) + '%')} | ETA: ${eta} | ${progress.fps.toFixed(0)} fps | ${progress.timemark}`;
}

function render(): void {
  lastRenderTime = Date.now();

  const lines: string[] = [];

  // Header separator with queue count
  const queueLabel = queuePending > 0
    ? chalk.gray(` Queue: ${chalk.white(String(queuePending))} pending`)
    : '';
  lines.push(
    chalk.gray('  ══════════════════════════════════════════════════════════') + queueLabel,
  );

  for (let i = 0; i < NUM_WORKERS; i++) {
    const w = workers[i];
    if (w) {
      const hdrTag = w.hdr
        ? (w.removeHDR ? chalk.yellow(' HDR→SDR') : chalk.cyan(' HDR'))
        : '';
      lines.push(chalk.gray('  ┌─') + chalk.bold(` Worker ${i + 1} `) + chalk.gray('─'.repeat(44)));
      lines.push(chalk.gray('  │ ') + chalk.white(w.fileName));
      lines.push(
        chalk.gray('  │ ') +
        chalk.gray(`${w.srcRes} → `) +
        chalk.cyan(w.targetRes) +
        hdrTag,
      );
      lines.push(renderBar(w.progress));
      lines.push(chalk.gray('  └' + '─'.repeat(57)));
    } else {
      lines.push(chalk.gray(`  ┌─ Worker ${i + 1} `) + chalk.gray('─'.repeat(44)));
      lines.push(chalk.gray('  │ ') + chalk.gray('Idle'));
      lines.push(chalk.gray('  └' + '─'.repeat(57)));
    }
  }

  // ── Stats row ──
  const savedStr = formatSaved(stats.savedBytes);
  const statsLine = [
    chalk.green(`${figures.tick} ${stats.completed}`),
    chalk.red(`${figures.cross} ${stats.failed}`),
    chalk.gray(`${figures.line} ${stats.skipped} skipped`),
    chalk.cyan(`↓ ${savedStr} saved`),
  ].join(chalk.gray('  │  '));

  lines.push(chalk.gray('  ──────────────────────────────────────────────────────────'));
  lines.push('  ' + statsLine);

  const output = lines.join('\n') + '\n';
  process.stdout.write(output);
  renderedLines = lines.length;
}

function formatSaved(bytes: number): string {
  if (bytes < 0) return '0 B';
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

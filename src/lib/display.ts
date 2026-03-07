import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';
import figures from 'figures';
import cliProgress from 'cli-progress';
import type { Job, TranscodeProgress } from '../types/index.js';
import { formatResolution } from './ffmpeg.js';
import { formatFileSize, formatDuration } from './utils.js';
import { getStats } from './db.js';
import { isDashboardActive, dashLog } from './dashboard.js';
import path from 'node:path';

// ─── Banner ─────────────────────────────────────────────────────────────────

export function showBanner(profiles: number, workers: number): void {
  const title = chalk.bold.hex('#7C4DFF')('TRANSCORDER');
  const version = chalk.gray('v1.0.0');
  const info = chalk.white(`Watching ${chalk.cyan(String(profiles))} profile(s) ${chalk.gray('•')} ${chalk.cyan(String(workers))} worker(s) ready`);

  const banner = boxen(`${title}  ${version}\n${info}`, {
    padding: { top: 0, bottom: 0, left: 2, right: 2 },
    borderColor: '#7C4DFF',
    borderStyle: 'round',
    dimBorder: false,
  });

  console.log(banner);
  console.log();
}

// ─── Status symbols ─────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  pending: chalk.gray(figures.circleDotted),
  checking: chalk.blue(figures.info),
  transcoding: chalk.yellow(figures.play),
  replacing: chalk.cyan(figures.arrowRight),
  completed: chalk.green(figures.tick),
  failed: chalk.red(figures.cross),
  skipped: chalk.gray(figures.line),
};

const STATUS_COLOR: Record<string, (s: string) => string> = {
  pending: chalk.gray,
  checking: chalk.blue,
  transcoding: chalk.yellow,
  replacing: chalk.cyan,
  completed: chalk.green,
  failed: chalk.red,
  skipped: chalk.gray,
};

// ─── Job Table ──────────────────────────────────────────────────────────────

export function showJobTable(jobs: Job[]): void {
  if (jobs.length === 0) {
    console.log(chalk.gray('  No jobs found.'));
    return;
  }

  const table = new Table({
    head: ['ID', 'File', 'Resolution', 'Status', 'Profile', 'Time'].map((h) => chalk.gray(h)),
    colWidths: [6, 40, 14, 14, 12, 20],
    style: { head: [], border: ['gray'] },
    chars: {
      top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
      right: '│', 'right-mid': '┤', middle: '│',
    },
  });

  for (const job of jobs) {
    const fileName = path.basename(job.sourcePath);
    const truncatedName = fileName.length > 36 ? fileName.slice(0, 33) + '...' : fileName;
    const res = job.width && job.height ? `${job.width}x${job.height}` : chalk.gray('—');
    const statusIcon = STATUS_ICON[job.status] ?? '';
    const statusText = STATUS_COLOR[job.status]?.(job.status) ?? job.status;
    const time = job.completedAt ?? job.startedAt ?? job.createdAt ?? '';

    table.push([
      chalk.gray(String(job.id)),
      truncatedName,
      res,
      `${statusIcon} ${statusText}`,
      chalk.gray(job.profileName),
      chalk.gray(time),
    ]);
  }

  console.log(table.toString());
}

// ─── Stats Box ──────────────────────────────────────────────────────────────

export function showStatsBox(): void {
  const stats = getStats();

  // Format saved space: use TB if >= 1 TB, otherwise GB
  let savedStr: string;
  const savedGB = stats.savedBytes / (1024 * 1024 * 1024);
  if (savedGB >= 1024) {
    savedStr = `${(savedGB / 1024).toFixed(2)} TB`;
  } else if (savedGB >= 1) {
    savedStr = `${savedGB.toFixed(2)} GB`;
  } else {
    savedStr = formatFileSize(stats.savedBytes);
  }

  const lines = [
    `${chalk.white('Total:')}      ${stats.total}`,
    `${chalk.cyan('Pending:')}    ${stats.pending}`,
    `${chalk.green('Completed:')}  ${stats.completed}`,
    `${chalk.red('Failed:')}     ${stats.failed}`,
    `${chalk.gray('Skipped:')}    ${stats.skipped}`,
    '',
    `${chalk.hex('#7C4DFF')('Saved:')}      ${chalk.bold(savedStr)}`,
  ];

  const box = boxen(lines.join('\n'), {
    title: chalk.bold('Queue Statistics'),
    titleAlignment: 'left',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderColor: 'gray',
    borderStyle: 'round',
  });

  console.log(box);
}

// ─── Progress Bar ───────────────────────────────────────────────────────────

export function createProgressBar(): cliProgress.SingleBar {
  return new cliProgress.SingleBar({
    format: `  ${chalk.hex('#7C4DFF')('{bar}')} ${chalk.white('{percentage}%')} | ETA: {eta_formatted} | {fps} fps | {speed}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    barsize: 35,
    stopOnComplete: true,
    clearOnComplete: false,
    etaBuffer: 30,
    fps: 5,
    forceRedraw: true,
  });
}

export function updateProgressBar(bar: cliProgress.SingleBar, progress: TranscodeProgress): void {
  bar.update(Math.round(progress.percent), {
    fps: `${progress.fps.toFixed(0)}`,
    speed: progress.timemark,
  });
}

// ─── Transcode header/footer ────────────────────────────────────────────────

export function showTranscodeStart(fileName: string, srcRes: string, targetRes: string, hdr: boolean, removeHDR: boolean): void {
  const hdrTag = hdr ? (removeHDR ? chalk.yellow(' HDR→SDR') : chalk.cyan(' HDR')) : '';
  console.log();
  console.log(
    chalk.gray('  ┌─') +
    chalk.bold(' Transcoding ') +
    chalk.gray('─────────────────────────────────────────')
  );
  console.log(
    chalk.gray('  │ ') +
    chalk.white(fileName)
  );
  console.log(
    chalk.gray('  │ ') +
    chalk.gray(`${srcRes} → `) +
    chalk.cyan(targetRes) +
    hdrTag
  );
}

export function showTranscodeEnd(fileName: string, outputSize: number, duration: number): void {
  console.log(
    chalk.gray('  │ ') +
    chalk.green(figures.tick) +
    chalk.white(` Done in ${formatDuration(duration)}`) +
    chalk.gray(` • ${formatFileSize(outputSize)}`)
  );
  console.log(chalk.gray('  └──────────────────────────────────────────────────────'));
  console.log();
}

export function showTranscodeError(fileName: string, error: string): void {
  console.log(
    chalk.gray('  │ ') +
    chalk.red(figures.cross) +
    chalk.red(` Error: ${error}`)
  );
  console.log(chalk.gray('  └──────────────────────────────────────────────────────'));
  console.log();
}

// ─── File detected ──────────────────────────────────────────────────────────

export function showFileDetected(fileName: string, reason: string): void {
  const ts = chalk.gray(new Date().toLocaleTimeString('en-GB', { hour12: false }));
  console.log(`${ts} ${chalk.cyan(figures.info)} New file: ${chalk.white(fileName)}`);
  console.log(`${ts} ${chalk.cyan(figures.info)} ${chalk.gray(reason)}`);
}

export function showFileQueued(fileName: string, profileName: string): void {
  const ts = chalk.gray(new Date().toLocaleTimeString('en-GB', { hour12: false }));
  const msg = `${ts} ${chalk.green(figures.arrowRight)} Queued: ${chalk.white(fileName)} ${chalk.gray(`(${profileName})`)}`;
  if (isDashboardActive()) {
    dashLog(msg);
  } else {
    console.log(msg);
  }
}

export function showFileSkipped(fileName: string, reason: string): void {
  const ts = chalk.gray(new Date().toLocaleTimeString('en-GB', { hour12: false }));
  const msg = `${ts} ${chalk.gray(figures.line)} Skip: ${chalk.gray(fileName)} — ${chalk.gray(reason)}`;
  if (isDashboardActive()) {
    dashLog(msg);
  } else {
    console.log(msg);
  }
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

export function showDiagnostics(results: { label: string; ok: boolean; detail: string }[]): void {
  console.log();
  console.log(chalk.bold('  Diagnostics'));
  console.log(chalk.gray('  ──────────────────────────────────'));

  for (const r of results) {
    const icon = r.ok ? chalk.green(figures.tick) : chalk.red(figures.cross);
    const detail = r.ok ? chalk.gray(r.detail) : chalk.red(r.detail);
    console.log(`  ${icon} ${chalk.white(r.label)}: ${detail}`);
  }

  console.log();
}

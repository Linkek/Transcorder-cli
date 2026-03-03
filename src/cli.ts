#!/usr/bin/env node

import chalk from 'chalk';
import figures from 'figures';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from './lib/logger.js';
import { loadProfiles, initConfig, formatProfiles } from './lib/profiles.js';
import { resetDatabase, clearJobs, getAllJobs, closeDb, addJob, addMetadata, updateJobStatus, getJobsByStatus, hasCompletedJob, markInterruptedJobsAsFailed } from './lib/db.js';
import { checkFfmpegAvailable, checkNvencAvailable, formatResolution, formatFileSize } from './lib/ffmpeg.js';
import { analyzeFile, formatAnalysis } from './lib/check.js';
import { transcode, replaceOriginal, dryRun } from './lib/transcode.js';
import { startWatching, stopWatching, scanFolder } from './lib/watcher.js';
import { queueFile, resumePendingJobs } from './lib/queue.js';
import { clearAllCaches } from './lib/cache.js';
import {
  showBanner,
  showJobTable,
  showStatsBox,
  showDiagnostics,
  showTranscodeStart,
  showTranscodeEnd,
  showTranscodeError,
  createProgressBar,
  updateProgressBar,
} from './lib/display.js';
import { showMenuLoop, showMenu, confirm, pickFromList, prompt, waitForKey } from './lib/menu.js';
import type { Profile } from './types/index.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

// ─── Wrap in main() to avoid unsettled top-level await (Node 22+) ───────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] === 'start') {
    // Direct daemon start — no menu needed
    await startDaemon(args.includes('--verbose') || args.includes('-v'));
  } else if (args.length === 0 || args[0] === 'menu') {
    // Interactive mode
    await mainMenu();
  } else {
    console.log(chalk.gray(`  Unknown command: ${args[0]}`));
    console.log(chalk.gray(`  Run without arguments for interactive menu, or use "start" for daemon mode.`));
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(chalk.red(`Fatal error: ${err.message}`));
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });

// ─── Enable file logging if any profile has log: true ───────────────────────

function enableLoggingIfNeeded(profiles: Profile[]): void {
  const shouldLog = profiles.some((p) => p.log);
  if (shouldLog) {
    const logDir = path.join(PROJECT_ROOT, 'logs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logPath = path.join(logDir, `transcorder-${timestamp}.log`);
    logger.enableFileLogging(logPath);
    logger.info(`File logging enabled: ${logPath}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN MENU
// ═══════════════════════════════════════════════════════════════════════════

async function mainMenu(): Promise<void> {
  // Enable file logging based on profile settings
  try {
    const profiles = loadProfiles();
    enableLoggingIfNeeded(profiles);
    // Mark any interrupted transcodes as failed
    const interrupted = markInterruptedJobsAsFailed();
    if (interrupted > 0) {
      logger.warn(`Marked ${interrupted} interrupted job(s) as failed`);
    }
    // Clear any stale cache files from previous runs
    clearAllCaches(profiles);
  } catch { /* config may not exist yet */ }

  console.clear();
  showBanner(0, 2);

  await showMenuLoop('Main Menu', [
    {
      label: 'Start Daemon',
      description: 'Watch folders & transcode automatically',
      action: () => startDaemon(false),
    },
    {
      label: 'Scan & Process',
      description: 'Scan folders and process eligible files now',
      action: scanAndProcess,
    },
    {
      label: 'Analyze File',
      description: 'Inspect a video file without transcoding',
      action: analyzeFileMenu,
    },
    {
      label: 'Queue Status',
      description: 'View jobs and statistics',
      action: statusMenu,
    },
    {
      label: 'Database',
      description: 'Reset, clear, or view DB stats',
      action: databaseMenu,
    },
    {
      label: 'Config',
      description: 'View and manage profiles',
      action: configMenu,
    },
    {
      label: 'Diagnostics',
      description: 'Check ffmpeg, NVENC, folders',
      action: diagnosticsMenu,
    },
  ], { exitLabel: 'Quit' });

  closeDb();
  console.log(chalk.gray('  Bye!\n'));
}

// ═══════════════════════════════════════════════════════════════════════════
//  START DAEMON
// ═══════════════════════════════════════════════════════════════════════════

async function startDaemon(verbose: boolean): Promise<void> {
  if (verbose) logger.setLevel('debug');

  const profiles = loadProfiles();
  enableLoggingIfNeeded(profiles);
  console.clear();
  showBanner(profiles.length, 2);

  // Clear any stale cache files from previous runs
  clearAllCaches(profiles);

  // Resume any pending jobs from previous session
  resumePendingJobs(profiles);

  // Start watching
  const watchers = startWatching(profiles, {
    onFileReady: (filePath, profile) => {
      queueFile(filePath, profile);
    },
  });

  logger.info('Daemon started. Press Ctrl+C to stop.');
  logger.blank();

  // Keep alive
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      logger.blank();
      logger.info('Shutting down...');
      await stopWatching(watchers);
      // Clean cache before exit
      clearAllCaches(profiles);
      closeDb();
      resolve();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCAN & PROCESS
// ═══════════════════════════════════════════════════════════════════════════

async function scanAndProcess(): Promise<void> {
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
  const pendingJobs = getJobsByStatus('pending');

  for (const job of pendingJobs) {
    const profile = profiles.find((p) => p.name === job.profileName);
    if (!profile) continue;

    const filePath = job.sourcePath;
    const fileName = path.basename(filePath);

    try {
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

      const cachePath = await transcode(result, profile, {
        onProgress: (progress) => updateProgressBar(progressBar, progress),
      });
      progressBar.stop();

      updateJobStatus(job.id, 'replacing');
      const outputPath = replaceOriginal(filePath, cachePath);
      const outputSize = fs.statSync(outputPath).size;
      const elapsed = (Date.now() - startTime) / 1000;

      updateJobStatus(job.id, 'completed', { outputPath });
      showTranscodeEnd(fileName, outputSize, elapsed);

    } catch (err) {
      const errMsg = (err as Error).message;
      updateJobStatus(job.id, 'failed', { error: errMsg });
      showTranscodeError(fileName, errMsg);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ANALYZE FILE
// ═══════════════════════════════════════════════════════════════════════════

async function analyzeFileMenu(): Promise<void> {
  const profiles = loadProfiles();

  await showMenu('Analyze File', [
    {
      label: 'Browse source folders',
      description: 'Pick a file from watched folders',
      action: () => browseAndAnalyze(profiles),
    },
    {
      label: 'Enter file path',
      description: 'Type a path to any video file',
      action: () => manualAnalyze(profiles),
    },
    {
      label: 'Dry-run',
      description: 'Show what transcoding would do',
      action: () => dryRunMenu(profiles),
    },
  ], { showBack: true, backLabel: 'Back to main menu' });
}

async function browseAndAnalyze(profiles: Profile[]): Promise<void> {
  // Collect all video files from all source folders
  const allFiles: { file: string; profile: Profile }[] = [];

  for (const profile of profiles) {
    for (const folder of profile.sourceFolders) {
      const files = scanFolder(folder, profile.recursive);
      for (const f of files) {
        allFiles.push({ file: f, profile });
      }
    }
  }

  if (allFiles.length === 0) {
    console.log(chalk.gray('\n  No video files found in source folders.'));
    await waitForKey();
    return;
  }

  const labels = allFiles.map((f) => {
    const rel = path.relative(PROJECT_ROOT, f.file);
    return `${rel} ${chalk.gray(`(${f.profile.name})`)}`;
  });

  const picked = await pickFromList('Select a file to analyze', labels);
  if (picked === null) return;

  const idx = labels.indexOf(picked);
  const { file: filePath, profile } = allFiles[idx];

  try {
    const result = await analyzeFile(filePath, profile);
    console.log();
    console.log(chalk.bold('  File Analysis'));
    console.log(chalk.gray('  ' + '─'.repeat(44)));
    for (const line of formatAnalysis(result).split('\n')) {
      console.log(`  ${line}`);
    }
    console.log();

    if (result.needsTranscode) {
      const doTranscode = await confirm('Transcode this file now?');
      if (doTranscode) {
        const jobId = addJob(filePath, profile.name);
        addMetadata(jobId, {
          codec: result.metadata.video.codec_name,
          width: result.metadata.video.width,
          height: result.metadata.video.height,
          duration: result.metadata.duration,
          isHDR: result.metadata.isHDR,
          hdrFormat: result.metadata.hdrFormat,
          fileSize: result.metadata.fileSize,
        });

        updateJobStatus(jobId, 'transcoding');
        const srcRes = formatResolution(result.metadata.video.width, result.metadata.video.height);
        const tgtRes = formatResolution(result.targetWidth, result.targetHeight);

        showTranscodeStart(path.basename(filePath), srcRes, tgtRes, result.metadata.isHDR, profile.removeHDR);

        const progressBar = createProgressBar();
        progressBar.start(100, 0, { fps: '0', speed: '00:00:00' });
        const startTime = Date.now();

        try {
          const cachePath = await transcode(result, profile, {
            onProgress: (progress) => updateProgressBar(progressBar, progress),
          });
          progressBar.stop();

          updateJobStatus(jobId, 'replacing');
          const outputPath = replaceOriginal(filePath, cachePath);
          const outputSize = fs.statSync(outputPath).size;
          const elapsed = (Date.now() - startTime) / 1000;

          updateJobStatus(jobId, 'completed', { outputPath });
          showTranscodeEnd(path.basename(filePath), outputSize, elapsed);
        } catch (err) {
          progressBar.stop();
          updateJobStatus(jobId, 'failed', { error: (err as Error).message });
          showTranscodeError(path.basename(filePath), (err as Error).message);
        }
      }
    }
  } catch (err) {
    logger.error(`Failed to analyze: ${(err as Error).message}`);
  }

  await waitForKey();
}

async function manualAnalyze(profiles: Profile[]): Promise<void> {
  const filePath = await prompt(chalk.gray('  File path: '));
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    logger.error(`File not found: ${resolved}`);
    await waitForKey();
    return;
  }

  // Pick profile
  const profileNames = profiles.map((p) => p.name);
  const picked = await pickFromList('Which profile to check against?', profileNames);
  if (!picked) return;

  const profile = profiles.find((p) => p.name === picked)!;

  try {
    const result = await analyzeFile(resolved, profile);
    console.log();
    console.log(chalk.bold('  File Analysis'));
    console.log(chalk.gray('  ' + '─'.repeat(44)));
    for (const line of formatAnalysis(result).split('\n')) {
      console.log(`  ${line}`);
    }
    console.log();
  } catch (err) {
    logger.error(`Failed: ${(err as Error).message}`);
  }

  await waitForKey();
}

async function dryRunMenu(profiles: Profile[]): Promise<void> {
  const filePath = await prompt(chalk.gray('  File path: '));
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    logger.error(`File not found: ${resolved}`);
    await waitForKey();
    return;
  }

  const profileNames = profiles.map((p) => p.name);
  const picked = await pickFromList('Which profile?', profileNames);
  if (!picked) return;

  const profile = profiles.find((p) => p.name === picked)!;

  try {
    const result = await analyzeFile(resolved, profile);
    console.log();
    for (const line of dryRun(result, profile).split('\n')) {
      console.log(`  ${line}`);
    }
    console.log();
  } catch (err) {
    logger.error(`Failed: ${(err as Error).message}`);
  }

  await waitForKey();
}

// ═══════════════════════════════════════════════════════════════════════════
//  QUEUE STATUS
// ═══════════════════════════════════════════════════════════════════════════

async function statusMenu(): Promise<void> {
  await showMenuLoop('Queue Status', [
    {
      label: 'Overview',
      description: 'Stats + recent jobs',
      action: async () => {
        console.log();
        showStatsBox();
        console.log();
        const jobs = getAllJobs(20);
        showJobTable(jobs);

        // Show error details for any failed jobs
        const failedJobs = jobs.filter((j) => j.status === 'failed' && j.error);
        if (failedJobs.length > 0) {
          console.log();
          for (const job of failedJobs) {
            console.log(chalk.red(`  ${figures.cross} Job #${job.id}: ${job.error}`));
          }
        }

        await waitForKey();
      },
    },
    {
      label: 'All Jobs',
      description: 'Show all job history',
      action: async () => {
        console.log();
        const jobs = getAllJobs(100);
        showJobTable(jobs);
        await waitForKey();
      },
    },
    {
      label: 'Pending Jobs',
      action: async () => {
        console.log();
        const jobs = getAllJobs(100).filter((j) => j.status === 'pending');
        showJobTable(jobs);
        await waitForKey();
      },
    },
    {
      label: 'Failed Jobs',
      action: async () => {
        console.log();
        const jobs = getAllJobs(100).filter((j) => j.status === 'failed');
        showJobTable(jobs);

        if (jobs.length > 0) {
          for (const job of jobs) {
            if (job.error) {
              console.log(chalk.red(`  Job #${job.id}: ${job.error}`));
            }
          }
        }
        await waitForKey();
      },
    },
    {
      label: 'Completed Jobs',
      action: async () => {
        console.log();
        const jobs = getAllJobs(100).filter((j) => j.status === 'completed');
        showJobTable(jobs);
        await waitForKey();
      },
    },
  ], { exitLabel: 'Back to main menu' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════════════════════════════════════

async function databaseMenu(): Promise<void> {
  await showMenuLoop('Database', [
    {
      label: 'Show Stats',
      description: 'Job counts by status',
      action: async () => {
        console.log();
        showStatsBox();
        await waitForKey();
      },
    },
    {
      label: 'Clear Failed Jobs',
      description: 'Remove only failed jobs',
      action: async () => {
        const yes = await confirm('Clear all failed jobs?');
        if (yes) clearJobs('failed');
        await waitForKey();
      },
    },
    {
      label: 'Clear Completed Jobs',
      description: 'Remove only completed jobs',
      action: async () => {
        const yes = await confirm('Clear all completed jobs?');
        if (yes) clearJobs('completed');
        await waitForKey();
      },
    },
    {
      label: 'Clear All Jobs',
      description: 'Remove every job from the database',
      action: async () => {
        const yes = await confirm('Clear ALL jobs? This cannot be undone.');
        if (yes) clearJobs();
        await waitForKey();
      },
    },
    {
      label: 'Reset Database',
      description: 'Drop all tables and start fresh',
      action: async () => {
        const yes = await confirm('RESET the entire database? All data will be lost.');
        if (yes) {
          resetDatabase();
        }
        await waitForKey();
      },
    },
  ], { exitLabel: 'Back to main menu' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════

async function configMenu(): Promise<void> {
  await showMenuLoop('Configuration', [
    {
      label: 'List Profiles',
      description: 'Show all configured profiles',
      action: async () => {
        try {
          const profiles = loadProfiles();
          console.log();
          console.log(chalk.bold('  Profiles'));
          console.log(chalk.gray('  ' + '─'.repeat(44)));
          for (const line of formatProfiles(profiles).split('\n')) {
            console.log(`  ${line}`);
          }
        } catch (err) {
          logger.error(`Failed to load profiles: ${(err as Error).message}`);
        }
        await waitForKey();
      },
    },
    {
      label: 'View Profile Details',
      description: 'Inspect a specific profile',
      action: async () => {
        try {
          const profiles = loadProfiles();
          const names = profiles.map((p) => p.name);
          const picked = await pickFromList('Select profile', names);
          if (picked) {
            const profile = profiles.find((p) => p.name === picked)!;
            console.log();
            console.log(formatProfiles([profile]));
          }
        } catch (err) {
          logger.error(`Failed: ${(err as Error).message}`);
        }
        await waitForKey();
      },
    },
    {
      label: 'Init Default Config',
      description: 'Create config/profiles.json if missing',
      action: async () => {
        initConfig();
        await waitForKey();
      },
    },
    {
      label: 'Open Config File',
      description: 'config/profiles.json',
      action: async () => {
        const configPath = path.join(PROJECT_ROOT, 'config', 'profiles.json');
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf-8');
          console.log();
          console.log(chalk.bold('  config/profiles.json'));
          console.log(chalk.gray('  ' + '─'.repeat(44)));
          for (const line of content.split('\n')) {
            console.log(chalk.white(`  ${line}`));
          }
          console.log();
          console.log(chalk.gray('  Edit this file manually to add/change profiles.'));
        } else {
          logger.error('Config file not found. Use "Init Default Config" first.');
        }
        await waitForKey();
      },
    },
  ], { exitLabel: 'Back to main menu' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

async function diagnosticsMenu(): Promise<void> {
  const results: { label: string; ok: boolean; detail: string }[] = [];

  // FFmpeg
  const ffmpegOk = checkFfmpegAvailable();
  results.push({
    label: 'FFmpeg',
    ok: ffmpegOk,
    detail: ffmpegOk ? 'Found in PATH' : 'Not found — install ffmpeg',
  });

  // NVENC
  if (ffmpegOk) {
    const nvenc = await checkNvencAvailable();
    results.push({
      label: 'NVENC',
      ok: nvenc.available,
      detail: nvenc.available
        ? `Available: ${nvenc.encoders.join(', ')}`
        : 'No NVENC encoders found — check NVIDIA drivers',
    });
  }

  // Config
  const configPath = path.join(PROJECT_ROOT, 'config', 'profiles.json');
  const configExists = fs.existsSync(configPath);
  results.push({
    label: 'Config',
    ok: configExists,
    detail: configExists ? configPath : 'Not found — use Config > Init Default Config',
  });

  // Profiles and folders
  if (configExists) {
    try {
      const profiles = loadProfiles();
      for (const profile of profiles) {
        for (const folder of profile.sourceFolders) {
          const exists = fs.existsSync(folder);
          results.push({
            label: `Folder (${profile.name})`,
            ok: exists,
            detail: exists ? folder : `${folder} — does not exist`,
          });
        }
        const cacheExists = fs.existsSync(profile.cacheFolder);
        results.push({
          label: `Cache (${profile.name})`,
          ok: true,
          detail: cacheExists ? profile.cacheFolder : `${profile.cacheFolder} — will be created`,
        });
      }
    } catch {
      results.push({ label: 'Profiles', ok: false, detail: 'Failed to load profiles' });
    }
  }

  // Data dir
  const dataDir = path.join(PROJECT_ROOT, 'data');
  const dataExists = fs.existsSync(dataDir);
  results.push({
    label: 'Data dir',
    ok: true,
    detail: dataExists ? dataDir : `${dataDir} — will be created`,
  });

  showDiagnostics(results);
  await waitForKey();
}

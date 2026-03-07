import chalk from 'chalk';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import { loadProfiles } from '../lib/profiles.js';
import { addJob, addMetadata, updateJobStatus } from '../lib/db.js';
import { formatResolution } from '../lib/ffmpeg.js';
import { analyzeFile, formatAnalysis } from '../lib/check.js';
import { transcode, replaceOriginal, dryRun } from '../lib/transcode.js';
import { moveFile } from '../lib/utils.js';
import { scanFolder } from '../lib/watcher.js';
import { removeCacheFile } from '../lib/cache.js';
import {
  showTranscodeStart,
  showTranscodeEnd,
  showTranscodeError,
  createProgressBar,
  updateProgressBar,
} from '../lib/display.js';
import { showMenu, confirm, pickFromList, prompt, waitForKey } from '../lib/menu.js';
import type { Profile } from '../types/index.js';

export async function analyzeFileMenu(): Promise<void> {
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
    const rel = path.relative(process.cwd(), f.file);
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

        let cachePath: string | undefined;
        try {
          cachePath = await transcode(result, profile, {
            onProgress: (progress) => updateProgressBar(progressBar, progress),
          }).promise;
          progressBar.stop();

          updateJobStatus(jobId, 'replacing');
          let outputPath: string;
          if (profile.replaceFile) {
            outputPath = replaceOriginal(filePath, cachePath);
          } else {
            const newFileName = path.basename(cachePath);
            const destDir = profile.outputFolder ? path.resolve(profile.outputFolder) : path.dirname(filePath);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            outputPath = path.join(destDir, newFileName);
            moveFile(cachePath, outputPath);
          }
          cachePath = undefined;
          const outputSize = fs.statSync(outputPath).size;
          const elapsed = (Date.now() - startTime) / 1000;
          const savedBytes = result.metadata.fileSize - outputSize;

          updateJobStatus(jobId, 'completed', { outputPath, savedBytes });
          showTranscodeEnd(path.basename(filePath), outputSize, elapsed);
        } catch (err) {
          progressBar.stop();
          updateJobStatus(jobId, 'failed', { error: (err as Error).message });
          showTranscodeError(path.basename(filePath), (err as Error).message);
          if (cachePath) removeCacheFile(cachePath);
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

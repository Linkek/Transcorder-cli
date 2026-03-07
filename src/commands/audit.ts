import chalk from 'chalk';
import figures from 'figures';
import path from 'node:path';
import fs from 'node:fs';
import { loadProfiles } from '../lib/profiles.js';
import { closeDb, getCompletedDownscaledJobs, deleteJob } from '../lib/db.js';
import { probeFile } from '../lib/ffmpeg.js';
import { showBanner } from '../lib/display.js';
import { confirm } from '../lib/menu.js';

export async function auditAspectRatios(): Promise<void> {
  const profiles = loadProfiles();
  console.clear();
  showBanner(profiles.length, 2);

  console.log(chalk.white.bold('  Aspect Ratio Audit'));
  console.log(chalk.gray('  Checking completed transcodes for aspect ratio mismatches...\n'));

  // Gather all completed downscaled jobs across all profile thresholds
  const allJobs = new Map<number, { id: number; sourcePath: string; outputPath: string; srcWidth: number; srcHeight: number; completedAt: string; profileName: string }>();
  for (const profile of profiles) {
    const jobs = getCompletedDownscaledJobs(profile.maxWidth, profile.maxHeight);
    for (const job of jobs) {
      allJobs.set(job.id, job);
    }
  }

  const jobs = [...allJobs.values()];

  if (jobs.length === 0) {
    console.log(chalk.green('  No downscaled files found in the database. Nothing to audit.\n'));
    closeDb();
    return;
  }

  console.log(chalk.gray(`  Found ${jobs.length} completed downscaled job(s). Probing output files...\n`));

  const TOLERANCE = 0.02; // Allow 2% aspect ratio deviation (rounding)
  const problems: { job: typeof jobs[0]; srcAR: number; outAR: number; deviation: number; outWidth: number; outHeight: number }[] = [];
  let checked = 0;
  let missing = 0;

  for (const job of jobs) {
    const outPath = job.outputPath;

    // The file may have been replaced — check if it still exists,
    // also check if a file with the same name exists at the output path
    if (!fs.existsSync(outPath)) {
      missing++;
      continue;
    }

    try {
      const meta = await probeFile(outPath);
      const srcAR = job.srcWidth / job.srcHeight;
      const outAR = meta.video.width / meta.video.height;
      const deviation = Math.abs(srcAR - outAR) / srcAR;

      checked++;

      if (deviation > TOLERANCE) {
        problems.push({
          job,
          srcAR,
          outAR,
          deviation,
          outWidth: meta.video.width,
          outHeight: meta.video.height,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`  ${figures.warning} Could not probe: ${path.basename(outPath)} — ${msg}`));
    }
  }

  console.log(chalk.gray(`  Checked: ${checked} | Missing: ${missing} | Problems: ${problems.length}\n`));

  if (problems.length === 0) {
    console.log(chalk.green(`  ${figures.tick} All checked files have correct aspect ratios!\n`));
  } else {
    console.log(chalk.red.bold(`  ${figures.cross} Found ${problems.length} file(s) with aspect ratio mismatch:\n`));

    for (const p of problems) {
      const name = path.basename(p.job.outputPath);
      const devPct = (p.deviation * 100).toFixed(1);
      console.log(chalk.white(`  ${name}`));
      console.log(chalk.gray(`    Source: ${p.job.srcWidth}x${p.job.srcHeight} (${p.srcAR.toFixed(4)})`));
      console.log(chalk.gray(`    Output: ${p.outWidth}x${p.outHeight} (${p.outAR.toFixed(4)})`));
      console.log(chalk.red(`    Deviation: ${devPct}%`));
      console.log(chalk.gray(`    Profile: ${p.job.profileName} | Completed: ${p.job.completedAt}`));
      console.log();
    }

    // Ask if they want to re-queue the affected files
    const answer = await confirm(`  Re-queue these ${problems.length} file(s) for re-processing?`);
    if (answer) {
      for (const p of problems) {
        // Delete the old job so it can be re-processed
        deleteJob(p.job.id);
        console.log(chalk.gray(`  ${figures.arrowRight} Cleared: ${path.basename(p.job.outputPath)}`));
      }
      console.log();
      console.log(chalk.green(`  ${figures.tick} Cleared ${problems.length} job(s). Run the daemon or scan to re-process them.\n`));
    }
  }

  closeDb();
}

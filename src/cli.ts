#!/usr/bin/env node

import chalk from 'chalk';
import { loadProfiles } from './lib/profiles.js';
import { closeDb, markInterruptedJobsAsFailed } from './lib/db.js';
import { clearAllCaches } from './lib/cache.js';
import { showBanner } from './lib/display.js';
import { showMenuLoop } from './lib/menu.js';
import {
  startDaemon,
  scanAllDirect,
  scanAndProcess,
  auditAspectRatios,
  analyzeFileMenu,
  statusMenu,
  databaseMenu,
  configMenu,
  diagnosticsMenu,
  enableLoggingIfNeeded,
} from './commands/index.js';
import { logger } from './lib/logger.js';

// ─── Wrap in main() to avoid unsettled top-level await (Node 22+) ───────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');

  if (args[0] === 'start' || args[0] === 'daemon') {
    await startDaemon(verbose);
  } else if (args[0] === 'scan') {
    await scanAllDirect(verbose);
  } else if (args[0] === 'audit') {
    await auditAspectRatios();
  } else if (args.length === 0 || args[0] === 'menu') {
    await mainMenu();
  } else {
    console.log(chalk.gray(`  Unknown command: ${args[0]}`));
    console.log();
    console.log(chalk.white('  Usage:'));
    console.log(chalk.gray('    npm start              Interactive menu'));
    console.log(chalk.gray('    npm run daemon          Start watching daemon'));
    console.log(chalk.gray('    npm run scan            Scan & process all profiles'));
    console.log(chalk.gray('    npm run audit           Check completed files for aspect ratio issues'));
    console.log();
    console.log(chalk.gray('  Add --verbose / -v for debug output'));
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

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN MENU
// ═══════════════════════════════════════════════════════════════════════════

async function mainMenu(): Promise<void> {
  try {
    const profiles = loadProfiles();
    enableLoggingIfNeeded(profiles);
    const interrupted = markInterruptedJobsAsFailed();
    if (interrupted > 0) {
      logger.warn(`Marked ${interrupted} interrupted job(s) as failed`);
    }
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

import { resetDatabase, clearJobs } from '../lib/db.js';
import { showStatsBox } from '../lib/display.js';
import { showMenuLoop, confirm, waitForKey } from '../lib/menu.js';

export async function databaseMenu(): Promise<void> {
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

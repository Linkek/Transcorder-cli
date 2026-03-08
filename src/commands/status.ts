import chalk from 'chalk';
import { getAllJobs, getJobsByStatus, getStats } from '../lib/db.js';
import { showJobTable, showStatsBox } from '../lib/display.js';
import { showMenuLoop, waitForKey } from '../lib/menu.js';
import figures from 'figures';

export async function statusMenu(): Promise<void> {
  await showMenuLoop('Queue Status', [
    {
      label: 'Overview',
      description: 'Stats + recent jobs',
      action: async () => {
        console.log();
        showStatsBox();
        console.log();
        const jobs = getAllJobs();
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
        const jobs = getAllJobs();
        showJobTable(jobs);
        await waitForKey();
      },
    },
    {
      label: 'Pending Jobs',
      action: async () => {
        console.log();
        const jobs = getJobsByStatus(['pending']);
        showJobTable(jobs);
        await waitForKey();
      },
    },
    {
      label: 'Failed Jobs',
      action: async () => {
        console.log();
        const jobs = getJobsByStatus(['failed']);
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
        const jobs = getJobsByStatus(['completed']);
        showJobTable(jobs);
        await waitForKey();
      },
    },
    {
      label: 'Space Saved',
      description: 'Total disk space saved by transcoding',
      action: async () => {
        console.log();
        const stats = getStats();
        const savedGB = stats.savedBytes / (1024 * 1024 * 1024);
        let savedStr: string;
        if (savedGB >= 1024) {
          savedStr = `${(savedGB / 1024).toFixed(2)} TB`;
        } else if (savedGB >= 1) {
          savedStr = `${savedGB.toFixed(2)} GB`;
        } else {
          savedStr = `${(stats.savedBytes / (1024 * 1024)).toFixed(2)} MB`;
        }
        console.log(chalk.bold(`  Total space saved: ${chalk.hex('#7C4DFF')(savedStr)}`));
        console.log(chalk.gray(`  From ${stats.completed} completed transcode(s)`));
        console.log();
        await waitForKey();
      },
    },
  ], { exitLabel: 'Back to main menu' });
}

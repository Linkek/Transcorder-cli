import chalk from 'chalk';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import { loadProfiles, initConfig, formatProfiles } from '../lib/profiles.js';
import { showMenuLoop, pickFromList, waitForKey } from '../lib/menu.js';
import { PROJECT_ROOT } from './shared.js';

export async function configMenu(): Promise<void> {
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

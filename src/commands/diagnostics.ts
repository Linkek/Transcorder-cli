import chalk from 'chalk';
import path from 'node:path';
import fs from 'node:fs';
import { loadProfiles } from '../lib/profiles.js';
import { checkFfmpegAvailable, checkNvencAvailable } from '../lib/ffmpeg.js';
import { showDiagnostics } from '../lib/display.js';
import { waitForKey } from '../lib/menu.js';
import { PROJECT_ROOT } from './shared.js';

export async function diagnosticsMenu(): Promise<void> {
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

import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from './logger.js';
import { VIDEO_EXTENSIONS } from '../types/index.js';
import type { Profile } from '../types/index.js';

export interface WatcherCallbacks {
  onFileReady: (filePath: string, profile: Profile) => void;
}

const STABLE_DELAY_MS = 15_000; // Wait 15s of no changes before processing
const fileSizeMap = new Map<string, { size: number; timer: NodeJS.Timeout }>();

/**
 * Start watching all source folders defined in the given profiles.
 */
export function startWatching(profiles: Profile[], callbacks: WatcherCallbacks): FSWatcher[] {
  const watchers: FSWatcher[] = [];

  for (const profile of profiles) {
    for (const folder of profile.sourceFolders) {
      // Ensure folder exists
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
        logger.info(`Created watch folder: ${folder}`);
      }

      logger.info(`Watching: ${folder} (profile: ${profile.name})`);

      const watcher = chokidar.watch(folder, {
        persistent: true,
        ignoreInitial: true, // Don't process existing files on startup
        awaitWriteFinish: false, // We handle stability ourselves
        depth: profile.recursive ? undefined : 0, // Unlimited depth when recursive
        ignored: [
          /(^|[\/\\])\../, // Hidden files
          /node_modules/,
        ],
      });

      watcher.on('add', (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (!VIDEO_EXTENSIONS.has(ext)) return;

        logger.debug(`File detected: ${filePath}`);
        waitForStableFile(filePath, profile, callbacks);
      });

      watcher.on('change', (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (!VIDEO_EXTENSIONS.has(ext)) return;

        // File is still being written — reset the timer
        const existing = fileSizeMap.get(filePath);
        if (existing) {
          clearTimeout(existing.timer);
          logger.debug(`File still changing: ${filePath}`);
          waitForStableFile(filePath, profile, callbacks);
        }
      });

      watcher.on('error', (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Watcher error on ${folder}: ${msg}`);
      });

      watchers.push(watcher);
    }
  }

  return watchers;
}

/**
 * Wait for a file to stop changing size before processing it.
 */
function waitForStableFile(filePath: string, profile: Profile, callbacks: WatcherCallbacks): void {
  // Clear any existing timer for this file
  const existing = fileSizeMap.get(filePath);
  if (existing) clearTimeout(existing.timer);

  let currentSize: number;
  try {
    currentSize = fs.statSync(filePath).size;
  } catch {
    // File might have been removed
    fileSizeMap.delete(filePath);
    return;
  }

  const timer = setTimeout(() => {
    let newSize: number;
    try {
      newSize = fs.statSync(filePath).size;
    } catch {
      fileSizeMap.delete(filePath);
      return;
    }

    if (newSize === currentSize && newSize > 0) {
      // File is stable
      fileSizeMap.delete(filePath);
      logger.debug(`File stable: ${filePath} (${(newSize / (1024 * 1024)).toFixed(1)} MB)`);
      callbacks.onFileReady(filePath, profile);
    } else {
      // File size changed, wait again
      logger.debug(`File still writing: ${filePath}`);
      waitForStableFile(filePath, profile, callbacks);
    }
  }, STABLE_DELAY_MS);

  fileSizeMap.set(filePath, { size: currentSize, timer });
}

/**
 * Scan a folder for existing video files (non-recursive by default).
 */
export function scanFolder(folder: string, recursive = true): string[] {
  const files: string[] = [];

  if (!fs.existsSync(folder)) {
    logger.warn(`Folder does not exist: ${folder}`);
    return files;
  }

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && recursive) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(folder);
  return files;
}

/**
 * Stop all watchers.
 */
export async function stopWatching(watchers: FSWatcher[]): Promise<void> {
  for (const watcher of watchers) {
    await watcher.close();
  }
  // Clear all pending timers
  for (const [, { timer }] of fileSizeMap) {
    clearTimeout(timer);
  }
  fileSizeMap.clear();
}

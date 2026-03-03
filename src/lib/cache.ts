import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import type { Profile } from '../types/index.js';

/**
 * Clear all files from a cache folder.
 */
export function clearCacheFolder(cacheFolder: string): number {
  if (!fs.existsSync(cacheFolder)) {
    return 0;
  }

  let count = 0;
  const entries = fs.readdirSync(cacheFolder, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      const filePath = path.join(cacheFolder, entry.name);
      try {
        fs.unlinkSync(filePath);
        count++;
        logger.debug(`Removed cache file: ${entry.name}`);
      } catch (err) {
        logger.warn(`Failed to remove cache file ${entry.name}: ${(err as Error).message}`);
      }
    }
  }

  return count;
}

/**
 * Clear all cache folders from all profiles.
 */
export function clearAllCaches(profiles: Profile[]): void {
  const seenFolders = new Set<string>();
  let totalRemoved = 0;

  for (const profile of profiles) {
    const cacheFolder = path.resolve(profile.cacheFolder);
    
    // Skip if already processed (multiple profiles might share a cache folder)
    if (seenFolders.has(cacheFolder)) continue;
    seenFolders.add(cacheFolder);

    if (fs.existsSync(cacheFolder)) {
      const removed = clearCacheFolder(cacheFolder);
      if (removed > 0) {
        logger.info(`Cleared ${removed} file(s) from cache: ${cacheFolder}`);
        totalRemoved += removed;
      }
    }
  }

  if (totalRemoved > 0) {
    logger.info(`Total cache files removed: ${totalRemoved}`);
  }
}

/**
 * Remove a specific file from the cache folder (if it exists).
 */
export function removeCacheFile(cachePath: string): boolean {
  if (fs.existsSync(cachePath)) {
    try {
      fs.unlinkSync(cachePath);
      logger.debug(`Removed cache file: ${path.basename(cachePath)}`);
      return true;
    } catch (err) {
      logger.warn(`Failed to remove cache file: ${(err as Error).message}`);
      return false;
    }
  }
  return false;
}

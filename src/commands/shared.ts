import path from 'node:path';
import { logger } from '../lib/logger.js';
import type { Profile } from '../types/index.js';

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

export function enableLoggingIfNeeded(profiles: Profile[]): void {
  const shouldLog = profiles.some((p) => p.log);
  if (shouldLog) {
    const logDir = path.join(PROJECT_ROOT, 'logs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logPath = path.join(logDir, `transcorder-${timestamp}.log`);
    logger.enableFileLogging(logPath);
    logger.info(`File logging enabled: ${logPath}`);
  }
}

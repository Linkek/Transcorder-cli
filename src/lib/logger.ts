import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import type { LogLevel } from '../types/index.js';

let currentLevel: LogLevel = 'info';
let logFile: string | null = null;
let logStream: fs.WriteStream | null = null;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_STYLE: Record<LogLevel, (s: string) => string> = {
  debug: (s) => chalk.gray(s),
  info: (s) => chalk.cyan(s),
  warn: (s) => chalk.yellow(s),
  error: (s) => chalk.red(s),
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

function timestamp(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function writeToFile(message: string): void {
  if (logStream) {
    logStream.write(stripAnsi(message) + '\n');
  }
}

function formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
  const ts = chalk.gray(timestamp());
  const prefix = LEVEL_STYLE[level](`[${LEVEL_PREFIX[level]}]`);
  const parts = [message, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))];
  return `${ts} ${prefix} ${parts.join(' ')}`;
}

export const logger = {
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  getLevel(): LogLevel {
    return currentLevel;
  },

  enableFileLogging(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    logFile = filePath;
    logStream = fs.createWriteStream(filePath, { flags: 'a' });
    logStream.write(`\n--- Log started at ${new Date().toISOString()} ---\n`);
  },

  disableFileLogging(): void {
    if (logStream) {
      logStream.end();
      logStream = null;
    }
    logFile = null;
  },

  debug(message: string, ...args: unknown[]): void {
    if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.debug) {
      const msg = formatMessage('debug', message, ...args);
      console.log(msg);
      writeToFile(msg);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.info) {
      const msg = formatMessage('info', message, ...args);
      console.log(msg);
      writeToFile(msg);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.warn) {
      const msg = formatMessage('warn', message, ...args);
      console.warn(msg);
      writeToFile(msg);
    }
  },

  error(message: string, ...args: unknown[]): void {
    const msg = formatMessage('error', message, ...args);
    console.error(msg);
    writeToFile(msg);
  },

  /** Log a success message (always shown at info level) */
  success(message: string, ...args: unknown[]): void {
    if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.info) {
      const ts = chalk.gray(timestamp());
      const prefix = chalk.green('[OK ]');
      const parts = [message, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))];
      const msg = `${ts} ${prefix} ${parts.join(' ')}`;
      console.log(msg);
      writeToFile(msg);
    }
  },

  /** Raw console.log, no formatting */
  raw(message: string): void {
    console.log(message);
    writeToFile(message);
  },

  /** Blank line */
  blank(): void {
    console.log();
  },
};

import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import type { LogLevel } from '../types/index.js';
import { isDashboardActive, dashLog } from './dashboard.js';

let currentLevel: LogLevel = 'info';
let logFile: string | null = null;
let logStream: fs.WriteStream | null = null;

// ─── In-memory log buffer for web UI streaming ─────────────────────────────

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'success';
  message: string;
}

const LOG_BUFFER_MAX = 1000;
const logBuffer: LogEntry[] = [];
let logIdCounter = 0;

type LogSubscriber = (entry: LogEntry) => void;
const subscribers = new Set<LogSubscriber>();

function addToBuffer(level: LogEntry['level'], rawMessage: string): void {
  const entry: LogEntry = {
    id: ++logIdCounter,
    timestamp: new Date().toISOString(),
    level,
    message: stripAnsi(rawMessage),
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
  }
  for (const sub of subscribers) {
    try { sub(entry); } catch { /* ignore broken subscribers */ }
  }
}

/** Get recent log entries, optionally starting after a given ID. */
export function getLogEntries(afterId = 0, limit = 200): LogEntry[] {
  if (afterId > 0) {
    return logBuffer.filter(e => e.id > afterId).slice(-limit);
  }
  return logBuffer.slice(-limit);
}

/** Subscribe to new log entries (for SSE). Returns unsubscribe function. */
export function subscribeToLogs(callback: LogSubscriber): () => void {
  subscribers.add(callback);
  return () => { subscribers.delete(callback); };
}

/**
 * Emit a log entry to the web UI buffer from outside the logger
 * (e.g. from dashLog, display helpers, queue messages).
 * The message should be the raw chalk-formatted string — ANSI codes will be stripped.
 */
export function emitLogEntry(level: LogEntry['level'], message: string): void {
  addToBuffer(level, message);
}

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
      if (isDashboardActive()) dashLog(msg); else { console.log(msg); addToBuffer('debug', msg); }
      writeToFile(msg);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.info) {
      const msg = formatMessage('info', message, ...args);
      if (isDashboardActive()) dashLog(msg); else { console.log(msg); addToBuffer('info', msg); }
      writeToFile(msg);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.warn) {
      const msg = formatMessage('warn', message, ...args);
      if (isDashboardActive()) dashLog(msg); else { console.warn(msg); addToBuffer('warn', msg); }
      writeToFile(msg);
    }
  },

  error(message: string, ...args: unknown[]): void {
    const msg = formatMessage('error', message, ...args);
    if (isDashboardActive()) dashLog(msg); else { console.error(msg); addToBuffer('error', msg); }
    writeToFile(msg);
  },

  /** Log a success message (always shown at info level) */
  success(message: string, ...args: unknown[]): void {
    if (LEVEL_ORDER[currentLevel] <= LEVEL_ORDER.info) {
      const ts = chalk.gray(timestamp());
      const prefix = chalk.green('[OK ]');
      const parts = [message, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))];
      const msg = `${ts} ${prefix} ${parts.join(' ')}`;
      if (isDashboardActive()) dashLog(msg); else { console.log(msg); addToBuffer('success', msg); }
      writeToFile(msg);
    }
  },

  /** Raw console.log, no formatting */
  raw(message: string): void {
    if (isDashboardActive()) dashLog(message); else console.log(message);
    writeToFile(message);
  },

  /** Blank line */
  blank(): void {
    if (isDashboardActive()) dashLog(''); else console.log();
  },
};

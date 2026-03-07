import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import type { Job, JobStatus } from '../types/index.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DB_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DB_DIR, 'transcorder.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL,
      output_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      profile_name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      saved_bytes INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS source_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      codec TEXT,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      bitrate INTEGER,
      is_hdr INTEGER DEFAULT 0,
      hdr_format TEXT,
      color_transfer TEXT,
      color_primaries TEXT,
      color_space TEXT,
      pix_fmt TEXT,
      frame_rate REAL,
      sample_aspect_ratio TEXT,
      display_aspect_ratio TEXT,
      audio_streams INTEGER,
      subtitle_streams INTEGER,
      file_size_bytes INTEGER
    );

    CREATE TABLE IF NOT EXISTS output_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      codec TEXT,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      bitrate INTEGER,
      is_hdr INTEGER DEFAULT 0,
      color_transfer TEXT,
      color_primaries TEXT,
      color_space TEXT,
      pix_fmt TEXT,
      frame_rate REAL,
      sample_aspect_ratio TEXT,
      display_aspect_ratio TEXT,
      audio_streams INTEGER,
      subtitle_streams INTEGER,
      file_size_bytes INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source_path);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_unique ON jobs(source_path)
      WHERE status IN ('pending', 'checking', 'transcoding', 'replacing');
  `);

  // Migration: add saved_bytes column if missing (for existing DBs)
  const cols = d.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'saved_bytes')) {
    d.exec("ALTER TABLE jobs ADD COLUMN saved_bytes INTEGER DEFAULT 0");
  }

  // Migration: add priority column if missing (for existing DBs)
  if (!cols.some((c) => c.name === 'priority')) {
    d.exec("ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 5");
  }

  // Migration: add new source_metadata columns if missing (for existing DBs)
  const srcCols = d.prepare("PRAGMA table_info(source_metadata)").all() as { name: string }[];
  const srcMigrations: [string, string][] = [
    ['color_primaries', 'TEXT'],
    ['color_space', 'TEXT'],
    ['pix_fmt', 'TEXT'],
    ['frame_rate', 'REAL'],
    ['sample_aspect_ratio', 'TEXT'],
    ['display_aspect_ratio', 'TEXT'],
  ];
  for (const [col, type] of srcMigrations) {
    if (!srcCols.some((c) => c.name === col)) {
      d.exec(`ALTER TABLE source_metadata ADD COLUMN ${col} ${type}`);
    }
  }

  // Migration: create output_metadata table if missing
  d.exec(`
    CREATE TABLE IF NOT EXISTS output_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      codec TEXT,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      bitrate INTEGER,
      is_hdr INTEGER DEFAULT 0,
      color_transfer TEXT,
      color_primaries TEXT,
      color_space TEXT,
      pix_fmt TEXT,
      frame_rate REAL,
      sample_aspect_ratio TEXT,
      display_aspect_ratio TEXT,
      audio_streams INTEGER,
      subtitle_streams INTEGER,
      file_size_bytes INTEGER
    )
  `);
}

// ─── Job CRUD ───────────────────────────────────────────────────────────────

export function addJob(sourcePath: string, profileName: string, priority: number = 5): number {
  const d = getDb();
  try {
    const result = d.prepare(`
      INSERT INTO jobs (source_path, profile_name, priority) VALUES (?, ?, ?)
    `).run(sourcePath, profileName, priority);
    logger.debug(`Added job #${result.lastInsertRowid} for ${sourcePath}`);
    return Number(result.lastInsertRowid);
  } catch (err: unknown) {
    // Handle unique constraint violations (e.g., duplicate pending job for same file)
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      logger.debug(`Job already exists for ${sourcePath}, skipping`);
      return -1;
    }
    throw err;
  }
}

export function addMetadata(
  jobId: number,
  meta: {
    codec?: string;
    width?: number;
    height?: number;
    duration?: number;
    bitrate?: number;
    isHDR?: boolean;
    hdrFormat?: string;
    colorTransfer?: string;
    colorPrimaries?: string;
    colorSpace?: string;
    pixFmt?: string;
    frameRate?: number;
    sar?: string;
    dar?: string;
    audioStreams?: number;
    subtitleStreams?: number;
    fileSize?: number;
  },
): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO source_metadata
      (job_id, codec, width, height, duration_seconds, bitrate, is_hdr, hdr_format,
       color_transfer, color_primaries, color_space, pix_fmt, frame_rate,
       sample_aspect_ratio, display_aspect_ratio,
       audio_streams, subtitle_streams, file_size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    meta.codec ?? null,
    meta.width ?? null,
    meta.height ?? null,
    meta.duration ?? null,
    meta.bitrate ?? null,
    meta.isHDR ? 1 : 0,
    meta.hdrFormat ?? null,
    meta.colorTransfer ?? null,
    meta.colorPrimaries ?? null,
    meta.colorSpace ?? null,
    meta.pixFmt ?? null,
    meta.frameRate ?? null,
    meta.sar ?? null,
    meta.dar ?? null,
    meta.audioStreams ?? null,
    meta.subtitleStreams ?? null,
    meta.fileSize ?? null,
  );
}

export function addOutputMetadata(
  jobId: number,
  meta: {
    codec?: string;
    width?: number;
    height?: number;
    duration?: number;
    bitrate?: number;
    isHDR?: boolean;
    colorTransfer?: string;
    colorPrimaries?: string;
    colorSpace?: string;
    pixFmt?: string;
    frameRate?: number;
    sar?: string;
    dar?: string;
    audioStreams?: number;
    subtitleStreams?: number;
    fileSize?: number;
  },
): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO output_metadata
      (job_id, codec, width, height, duration_seconds, bitrate, is_hdr,
       color_transfer, color_primaries, color_space, pix_fmt, frame_rate,
       sample_aspect_ratio, display_aspect_ratio,
       audio_streams, subtitle_streams, file_size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    meta.codec ?? null,
    meta.width ?? null,
    meta.height ?? null,
    meta.duration ?? null,
    meta.bitrate ?? null,
    meta.isHDR ? 1 : 0,
    meta.colorTransfer ?? null,
    meta.colorPrimaries ?? null,
    meta.colorSpace ?? null,
    meta.pixFmt ?? null,
    meta.frameRate ?? null,
    meta.sar ?? null,
    meta.dar ?? null,
    meta.audioStreams ?? null,
    meta.subtitleStreams ?? null,
    meta.fileSize ?? null,
  );
}

export function updateJobStatus(jobId: number, status: JobStatus, extra?: { outputPath?: string; error?: string; savedBytes?: number }): void {
  const d = getDb();
  const sets: string[] = ['status = ?'];
  const params: unknown[] = [status];

  if (status === 'transcoding' || status === 'checking') {
    sets.push("started_at = datetime('now','localtime')");
  }
  if (status === 'completed' || status === 'failed' || status === 'skipped') {
    sets.push("completed_at = datetime('now','localtime')");
  }
  if (extra?.outputPath) {
    sets.push('output_path = ?');
    params.push(extra.outputPath);
  }
  if (extra?.error) {
    sets.push('error = ?');
    params.push(extra.error);
  }
  if (extra?.savedBytes != null) {
    sets.push('saved_bytes = ?');
    params.push(extra.savedBytes);
  }

  params.push(jobId);
  d.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function getJobsByStatus(...statuses: JobStatus[]): Job[] {
  const d = getDb();
  const placeholders = statuses.map(() => '?').join(', ');
  return d.prepare(`
    SELECT j.id, j.source_path as sourcePath, j.output_path as outputPath, j.status, j.profile_name as profileName,
           j.priority, j.created_at as createdAt, j.started_at as startedAt, j.completed_at as completedAt, j.error,
           m.width, m.height, m.is_hdr as isHDR, m.codec, m.duration_seconds as duration, m.file_size_bytes as fileSize
    FROM jobs j
    LEFT JOIN source_metadata m ON m.job_id = j.id
    WHERE j.status IN (${placeholders})
    ORDER BY j.priority DESC, j.created_at ASC
  `).all(...statuses) as Job[];
}

export function getAllJobs(limit = 50): Job[] {
  const d = getDb();
  return d.prepare(`
    SELECT j.id, j.source_path as sourcePath, j.output_path as outputPath, j.status, j.profile_name as profileName,
           j.priority, j.created_at as createdAt, j.started_at as startedAt, j.completed_at as completedAt, j.error,
           m.width, m.height, m.is_hdr as isHDR, m.codec, m.duration_seconds as duration, m.file_size_bytes as fileSize
    FROM jobs j
    LEFT JOIN source_metadata m ON m.job_id = j.id
    ORDER BY j.created_at DESC
    LIMIT ?
  `).all(limit) as Job[];
}

export function getJobByPath(sourcePath: string): Job | undefined {
  const d = getDb();
  return d.prepare(`
    SELECT j.id, j.source_path as sourcePath, j.output_path as outputPath, j.status, j.profile_name as profileName,
           j.priority, j.created_at as createdAt, j.started_at as startedAt, j.completed_at as completedAt, j.error,
           m.width, m.height, m.is_hdr as isHDR, m.codec, m.duration_seconds as duration, m.file_size_bytes as fileSize
    FROM jobs j
    LEFT JOIN source_metadata m ON m.job_id = j.id
    WHERE j.source_path = ?
    ORDER BY j.created_at DESC
    LIMIT 1
  `).get(sourcePath) as Job | undefined;
}

export function hasActiveJob(sourcePath: string): boolean {
  const d = getDb();
  const row = d.prepare(`
    SELECT COUNT(*) as cnt FROM jobs
    WHERE source_path = ? AND status IN ('pending', 'checking', 'transcoding', 'replacing')
  `).get(sourcePath) as { cnt: number };
  return row.cnt > 0;
}

export function hasCompletedJob(sourcePath: string): boolean {
  const d = getDb();
  const row = d.prepare(`
    SELECT COUNT(*) as cnt FROM jobs
    WHERE source_path = ? AND status IN ('completed', 'skipped')
  `).get(sourcePath) as { cnt: number };
  return row.cnt > 0;
}

/**
 * Clear any failed jobs for a specific file (to allow retry).
 */
export function clearFailedJobForFile(sourcePath: string): number {
  const d = getDb();
  const result = d.prepare(`
    DELETE FROM jobs WHERE source_path = ? AND status = 'failed'
  `).run(sourcePath);
  return result.changes;
}

/**
 * Mark any jobs stuck in an in-progress state as failed.
 * Called at startup to clean up interrupted transcodes.
 */
export function markInterruptedJobsAsFailed(): number {
  const d = getDb();
  const result = d.prepare(`
    UPDATE jobs
    SET status = 'failed', error = 'Interrupted - application was closed during transcode', completed_at = datetime('now','localtime')
    WHERE status IN ('checking', 'transcoding', 'replacing')
  `).run();
  return result.changes;
}

export function getStats(): { total: number; pending: number; completed: number; failed: number; skipped: number; savedBytes: number } {
  const d = getDb();
  const row = d.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN saved_bytes ELSE 0 END), 0) as savedBytes
    FROM jobs
  `).get() as { total: number; pending: number; completed: number; failed: number; skipped: number; savedBytes: number };
  return row;
}

// ─── Debug / Reset ──────────────────────────────────────────────────────────

/**
 * Get all completed jobs that were downscaled (source was larger than given max dimensions).
 * Returns source path, output path, original width/height.
 */
export function getCompletedDownscaledJobs(maxWidth: number, maxHeight: number): {
  id: number;
  sourcePath: string;
  outputPath: string;
  srcWidth: number;
  srcHeight: number;
  completedAt: string;
  profileName: string;
}[] {
  const d = getDb();
  return d.prepare(`
    SELECT j.id, j.source_path as sourcePath, j.output_path as outputPath,
           m.width as srcWidth, m.height as srcHeight,
           j.completed_at as completedAt, j.profile_name as profileName
    FROM jobs j
    JOIN source_metadata m ON m.job_id = j.id
    WHERE j.status = 'completed'
      AND j.output_path IS NOT NULL
      AND (m.width > ? OR m.height > ?)
    ORDER BY j.completed_at ASC
  `).all(maxWidth, maxHeight) as {
    id: number;
    sourcePath: string;
    outputPath: string;
    srcWidth: number;
    srcHeight: number;
    completedAt: string;
    profileName: string;
  }[];
}

/**
 * Delete a completed job by ID (so it can be re-processed).
 */
export function deleteJob(jobId: number): void {
  const d = getDb();
  const del = d.transaction(() => {
    d.prepare('DELETE FROM output_metadata WHERE job_id = ?').run(jobId);
    d.prepare('DELETE FROM source_metadata WHERE job_id = ?').run(jobId);
    d.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  });
  del();
}

export function resetDatabase(): void {
  const d = getDb();
  d.exec('DROP TABLE IF EXISTS source_metadata');
  d.exec('DROP TABLE IF EXISTS jobs');
  initSchema();
  logger.success('Database reset — all tables dropped and recreated');
}

export function clearJobs(status?: JobStatus): void {
  const d = getDb();
  if (status) {
    d.prepare('DELETE FROM source_metadata WHERE job_id IN (SELECT id FROM jobs WHERE status = ?)').run(status);
    d.prepare('DELETE FROM jobs WHERE status = ?').run(status);
    logger.success(`Cleared all jobs with status: ${status}`);
  } else {
    d.exec('DELETE FROM source_metadata');
    d.exec('DELETE FROM jobs');
    logger.success('Cleared all jobs');
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

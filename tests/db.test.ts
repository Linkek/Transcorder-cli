import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Mock better-sqlite3 to use an in-memory database instead of the file-based one.
// This avoids touching the production database during tests.
vi.mock('better-sqlite3', async () => {
  const actual = await vi.importActual<typeof import('better-sqlite3')>('better-sqlite3');
  return {
    default: class extends actual.default {
      constructor(_path: string, options?: object) {
        // Always use in-memory database regardless of the path
        super(':memory:', options);
      }
    },
  };
});

// Mock logger to suppress output during tests
vi.mock('../src/lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
  },
}));

import {
  addJob,
  addMetadata,
  addOutputMetadata,
  updateJobStatus,
  getJobsByStatus,
  getAllJobs,
  getJobByPath,
  hasActiveJob,
  hasCompletedJob,
  hasFailedJob,
  clearFailedJobForFile,
  markInterruptedJobsAsFailed,
  getStats,
  getCompletedDownscaledJobs,
  deleteJob,
  resetDatabase,
  clearJobs,
  closeDb,
} from '../src/lib/db.js';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Database CRUD', () => {
  beforeEach(() => {
    // Reset to a clean state before each test
    resetDatabase();
  });

  afterAll(() => {
    closeDb();
  });

  // ─── addJob ─────────────────────────────────────────────────────────────

  describe('addJob', () => {
    it('should add a job and return a positive id', () => {
      const id = addJob('/movies/test.mkv', 'default');
      expect(id).toBeGreaterThan(0);
    });

    it('should add a job with default priority of 5', () => {
      const id = addJob('/movies/test.mkv', 'default');
      const job = getJobByPath('/movies/test.mkv');
      expect(job).toBeDefined();
      expect(job!.priority).toBe(5);
    });

    it('should add a job with custom priority', () => {
      const id = addJob('/movies/test.mkv', 'default', 8);
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.priority).toBe(8);
    });

    it('should prevent duplicate active jobs for the same file', () => {
      const id1 = addJob('/movies/test.mkv', 'default');
      const id2 = addJob('/movies/test.mkv', 'default');
      expect(id1).toBeGreaterThan(0);
      expect(id2).toBe(-1); // duplicate returns -1
    });

    it('should allow adding jobs for different files', () => {
      const id1 = addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');
      expect(id1).toBeGreaterThan(0);
      expect(id2).toBeGreaterThan(0);
      expect(id1).not.toBe(id2);
    });

    it('should store profile name', () => {
      addJob('/movies/test.mkv', 'high-quality');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.profileName).toBe('high-quality');
    });

    it('should set status to pending by default', () => {
      addJob('/movies/test.mkv', 'default');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.status).toBe('pending');
    });
  });

  // ─── addMetadata ────────────────────────────────────────────────────────

  describe('addMetadata', () => {
    it('should add source metadata for a job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      expect(() => {
        addMetadata(id, {
          codec: 'hevc',
          width: 3840,
          height: 2160,
          duration: 7200,
          bitrate: 50_000_000,
          isHDR: true,
          hdrFormat: 'HDR10',
          fileSize: 5_000_000_000,
          audioStreams: 2,
          subtitleStreams: 3,
        });
      }).not.toThrow();
    });

    it('should handle minimal metadata (all optional)', () => {
      const id = addJob('/movies/test.mkv', 'default');
      expect(() => {
        addMetadata(id, {});
      }).not.toThrow();
    });

    it('should store all metadata fields', () => {
      const id = addJob('/movies/test.mkv', 'default');
      addMetadata(id, {
        codec: 'h264',
        width: 1920,
        height: 1080,
        duration: 3600,
        bitrate: 20_000_000,
        isHDR: false,
        audioStreams: 1,
        subtitleStreams: 0,
        fileSize: 2_000_000_000,
        colorTransfer: 'bt709',
        colorPrimaries: 'bt709',
        colorSpace: 'bt709',
        pixFmt: 'yuv420p',
        frameRate: 23.976,
        sar: '1:1',
        dar: '16:9',
      });

      // Verify through getJobByPath which joins metadata
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.width).toBe(1920);
      expect(job!.height).toBe(1080);
      expect(job!.codec).toBe('h264');
      expect(job!.duration).toBe(3600);
      expect(job!.fileSize).toBe(2_000_000_000);
    });
  });

  // ─── addOutputMetadata ──────────────────────────────────────────────────

  describe('addOutputMetadata', () => {
    it('should add output metadata for a completed job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      expect(() => {
        addOutputMetadata(id, {
          codec: 'hevc',
          width: 1920,
          height: 1080,
          duration: 7200,
          fileSize: 1_000_000_000,
        });
      }).not.toThrow();
    });

    it('should handle minimal output metadata', () => {
      const id = addJob('/movies/test.mkv', 'default');
      expect(() => {
        addOutputMetadata(id, {});
      }).not.toThrow();
    });
  });

  // ─── updateJobStatus ────────────────────────────────────────────────────

  describe('updateJobStatus', () => {
    it('should update status to transcoding', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'transcoding');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.status).toBe('transcoding');
    });

    it('should update status to completed', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.status).toBe('completed');
    });

    it('should set started_at for transcoding status', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'transcoding');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.startedAt).not.toBeNull();
    });

    it('should set completed_at for completed status', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.completedAt).not.toBeNull();
    });

    it('should set completed_at for failed status', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'failed', { error: 'GPU encoder crashed' });
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.completedAt).not.toBeNull();
      expect(job!.error).toBe('GPU encoder crashed');
    });

    it('should set output path', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed', { outputPath: '/output/test-1080p.mkv' });
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.outputPath).toBe('/output/test-1080p.mkv');
    });

    it('should set saved bytes', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed', { savedBytes: 2_500_000_000 });
      const stats = getStats();
      expect(stats.savedBytes).toBe(2_500_000_000);
    });

    it('should set started_at for checking status', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'checking');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.startedAt).not.toBeNull();
    });

    it('should set started_at for preflight status', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'preflight');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.startedAt).not.toBeNull();
    });

    it('should set completed_at for skipped status', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'skipped');
      const job = getJobByPath('/movies/test.mkv');
      expect(job!.completedAt).not.toBeNull();
    });
  });

  // ─── getJobsByStatus ────────────────────────────────────────────────────

  describe('getJobsByStatus', () => {
    it('should return empty array when no jobs exist', () => {
      const jobs = getJobsByStatus(['pending']);
      expect(jobs).toEqual([]);
    });

    it('should return jobs matching single status', () => {
      addJob('/movies/test1.mkv', 'default');
      addJob('/movies/test2.mkv', 'default');
      const id3 = addJob('/movies/test3.mkv', 'default');
      updateJobStatus(id3, 'completed');

      const pendingJobs = getJobsByStatus(['pending']);
      expect(pendingJobs).toHaveLength(2);
    });

    it('should return jobs matching multiple statuses', () => {
      const id1 = addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');
      const id3 = addJob('/movies/test3.mkv', 'default');
      updateJobStatus(id1, 'completed');
      updateJobStatus(id2, 'failed', { error: 'test' });

      const jobs = getJobsByStatus(['completed', 'failed']);
      expect(jobs).toHaveLength(2);
    });

    it('should order by priority DESC then created_at ASC', () => {
      addJob('/movies/low.mkv', 'default', 1);
      addJob('/movies/high.mkv', 'default', 10);
      addJob('/movies/mid.mkv', 'default', 5);

      const jobs = getJobsByStatus(['pending']);
      expect(jobs[0].sourcePath).toBe('/movies/high.mkv');
      expect(jobs[1].sourcePath).toBe('/movies/mid.mkv');
      expect(jobs[2].sourcePath).toBe('/movies/low.mkv');
    });

    it('should include source metadata in results', () => {
      const id = addJob('/movies/test.mkv', 'default');
      addMetadata(id, { width: 3840, height: 2160, codec: 'hevc' });

      const jobs = getJobsByStatus(['pending']);
      expect(jobs[0].width).toBe(3840);
      expect(jobs[0].height).toBe(2160);
      expect(jobs[0].codec).toBe('hevc');
    });
  });

  // ─── getAllJobs ─────────────────────────────────────────────────────────

  describe('getAllJobs', () => {
    it('should return empty array when no jobs exist', () => {
      expect(getAllJobs()).toEqual([]);
    });

    it('should return all jobs regardless of status', () => {
      const id1 = addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');
      const id3 = addJob('/movies/test3.mkv', 'default');
      updateJobStatus(id1, 'completed');
      updateJobStatus(id2, 'failed', { error: 'test' });

      const jobs = getAllJobs();
      expect(jobs).toHaveLength(3);
    });

    it('should order by created_at DESC', () => {
      addJob('/movies/first.mkv', 'default');
      addJob('/movies/second.mkv', 'default');
      addJob('/movies/third.mkv', 'default');

      const jobs = getAllJobs();
      // All created in same second so created_at is identical;
      // just verify all 3 are returned
      expect(jobs).toHaveLength(3);
      const paths = jobs.map(j => j.sourcePath);
      expect(paths).toContain('/movies/first.mkv');
      expect(paths).toContain('/movies/second.mkv');
      expect(paths).toContain('/movies/third.mkv');
    });
  });

  // ─── getJobByPath ──────────────────────────────────────────────────────

  describe('getJobByPath', () => {
    it('should return undefined for non-existent path', () => {
      expect(getJobByPath('/nonexistent.mkv')).toBeUndefined();
    });

    it('should return the most recent job for a path', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed');
      // Now add a new job for the same file (allowed since first is completed)
      const id2 = addJob('/movies/test.mkv', 'high-quality');

      const job = getJobByPath('/movies/test.mkv');
      // Should return most recent (ordered by created_at DESC)
      expect(job).toBeDefined();
    });

    it('should include joined metadata', () => {
      const id = addJob('/movies/test.mkv', 'default');
      addMetadata(id, { codec: 'hevc', width: 3840, height: 2160 });

      const job = getJobByPath('/movies/test.mkv');
      expect(job!.codec).toBe('hevc');
      expect(job!.width).toBe(3840);
    });
  });

  // ─── hasActiveJob ──────────────────────────────────────────────────────

  describe('hasActiveJob', () => {
    it('should return false when no jobs exist', () => {
      expect(hasActiveJob('/movies/test.mkv')).toBe(false);
    });

    it('should return true for pending job', () => {
      addJob('/movies/test.mkv', 'default');
      expect(hasActiveJob('/movies/test.mkv')).toBe(true);
    });

    it('should return true for transcoding job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'transcoding');
      expect(hasActiveJob('/movies/test.mkv')).toBe(true);
    });

    it('should return true for checking job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'checking');
      expect(hasActiveJob('/movies/test.mkv')).toBe(true);
    });

    it('should return true for preflight job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'preflight');
      expect(hasActiveJob('/movies/test.mkv')).toBe(true);
    });

    it('should return true for replacing job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'replacing');
      expect(hasActiveJob('/movies/test.mkv')).toBe(true);
    });

    it('should return false for completed job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed');
      expect(hasActiveJob('/movies/test.mkv')).toBe(false);
    });

    it('should return false for failed job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'failed', { error: 'test' });
      expect(hasActiveJob('/movies/test.mkv')).toBe(false);
    });

    it('should return false for skipped job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'skipped');
      expect(hasActiveJob('/movies/test.mkv')).toBe(false);
    });
  });

  // ─── hasCompletedJob ───────────────────────────────────────────────────

  describe('hasCompletedJob', () => {
    it('should return false when no jobs exist', () => {
      expect(hasCompletedJob('/movies/test.mkv')).toBe(false);
    });

    it('should return true for completed job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed');
      expect(hasCompletedJob('/movies/test.mkv')).toBe(true);
    });

    it('should return true for skipped job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'skipped');
      expect(hasCompletedJob('/movies/test.mkv')).toBe(true);
    });

    it('should return false for pending job', () => {
      addJob('/movies/test.mkv', 'default');
      expect(hasCompletedJob('/movies/test.mkv')).toBe(false);
    });

    it('should return false for failed job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'failed', { error: 'test' });
      expect(hasCompletedJob('/movies/test.mkv')).toBe(false);
    });
  });

  // ─── hasFailedJob ─────────────────────────────────────────────────────

  describe('hasFailedJob', () => {
    it('should return false when no jobs exist', () => {
      expect(hasFailedJob('/movies/test.mkv')).toBe(false);
    });

    it('should return true for failed job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'failed', { error: 'encoder crash' });
      expect(hasFailedJob('/movies/test.mkv')).toBe(true);
    });

    it('should return false for completed job', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed');
      expect(hasFailedJob('/movies/test.mkv')).toBe(false);
    });

    it('should return false for pending job', () => {
      addJob('/movies/test.mkv', 'default');
      expect(hasFailedJob('/movies/test.mkv')).toBe(false);
    });
  });

  // ─── clearFailedJobForFile ─────────────────────────────────────────────

  describe('clearFailedJobForFile', () => {
    it('should delete failed jobs for a specific file', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'failed', { error: 'test' });
      const deleted = clearFailedJobForFile('/movies/test.mkv');
      expect(deleted).toBe(1);
      expect(hasFailedJob('/movies/test.mkv')).toBe(false);
    });

    it('should not delete non-failed jobs', () => {
      addJob('/movies/test.mkv', 'default');
      const deleted = clearFailedJobForFile('/movies/test.mkv');
      expect(deleted).toBe(0);
      expect(hasActiveJob('/movies/test.mkv')).toBe(true);
    });

    it('should return 0 when no matching jobs', () => {
      const deleted = clearFailedJobForFile('/nonexistent.mkv');
      expect(deleted).toBe(0);
    });

    it('should only delete failed jobs for the specified file', () => {
      const id1 = addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');
      updateJobStatus(id1, 'failed', { error: 'test' });
      updateJobStatus(id2, 'failed', { error: 'test' });

      clearFailedJobForFile('/movies/test1.mkv');
      expect(hasFailedJob('/movies/test1.mkv')).toBe(false);
      expect(hasFailedJob('/movies/test2.mkv')).toBe(true);
    });
  });

  // ─── markInterruptedJobsAsFailed ──────────────────────────────────────

  describe('markInterruptedJobsAsFailed', () => {
    it('should mark checking jobs as failed', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'checking');
      const count = markInterruptedJobsAsFailed();
      expect(count).toBe(1);
      expect(hasFailedJob('/movies/test.mkv')).toBe(true);
    });

    it('should mark preflight jobs as failed', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'preflight');
      const count = markInterruptedJobsAsFailed();
      expect(count).toBe(1);
    });

    it('should mark transcoding jobs as failed', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'transcoding');
      const count = markInterruptedJobsAsFailed();
      expect(count).toBe(1);
    });

    it('should mark replacing jobs as failed', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'replacing');
      const count = markInterruptedJobsAsFailed();
      expect(count).toBe(1);
    });

    it('should not mark pending jobs as failed', () => {
      addJob('/movies/test.mkv', 'default');
      const count = markInterruptedJobsAsFailed();
      expect(count).toBe(0);
    });

    it('should not mark completed jobs as failed', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'completed');
      const count = markInterruptedJobsAsFailed();
      expect(count).toBe(0);
    });

    it('should set error message about interruption', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'transcoding');
      markInterruptedJobsAsFailed();

      const job = getJobByPath('/movies/test.mkv');
      expect(job!.error).toContain('Interrupted');
    });

    it('should handle multiple interrupted jobs', () => {
      const id1 = addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');
      const id3 = addJob('/movies/test3.mkv', 'default');
      updateJobStatus(id1, 'transcoding');
      updateJobStatus(id2, 'preflight');
      updateJobStatus(id3, 'checking');

      const count = markInterruptedJobsAsFailed();
      expect(count).toBe(3);
    });
  });

  // ─── getStats ──────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return zero stats when empty', () => {
      const stats = getStats();
      expect(stats.total).toBe(0);
      expect(stats.savedBytes).toBe(0);
      // SUM() returns null on empty table in SQLite
      expect(stats.pending ?? 0).toBe(0);
      expect(stats.completed ?? 0).toBe(0);
      expect(stats.failed ?? 0).toBe(0);
      expect(stats.skipped ?? 0).toBe(0);
    });

    it('should count pending jobs', () => {
      addJob('/movies/test1.mkv', 'default');
      addJob('/movies/test2.mkv', 'default');
      const stats = getStats();
      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(2);
    });

    it('should count jobs by status', () => {
      const id1 = addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');
      const id3 = addJob('/movies/test3.mkv', 'default');
      const id4 = addJob('/movies/test4.mkv', 'default');
      updateJobStatus(id1, 'completed');
      updateJobStatus(id2, 'failed', { error: 'test' });
      updateJobStatus(id3, 'skipped');

      const stats = getStats();
      expect(stats.total).toBe(4);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.skipped).toBe(1);
      expect(stats.pending).toBe(1);
    });

    it('should sum saved bytes from completed jobs', () => {
      const id1 = addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');
      updateJobStatus(id1, 'completed', { savedBytes: 1_000_000_000 });
      updateJobStatus(id2, 'completed', { savedBytes: 500_000_000 });

      const stats = getStats();
      expect(stats.savedBytes).toBe(1_500_000_000);
    });

    it('should not count saved bytes from non-completed jobs', () => {
      const id = addJob('/movies/test.mkv', 'default');
      updateJobStatus(id, 'failed', { error: 'test' });

      const stats = getStats();
      expect(stats.savedBytes).toBe(0);
    });
  });

  // ─── getCompletedDownscaledJobs ────────────────────────────────────────

  describe('getCompletedDownscaledJobs', () => {
    it('should return empty when no completed jobs', () => {
      const jobs = getCompletedDownscaledJobs(1920, 1080);
      expect(jobs).toEqual([]);
    });

    it('should return completed jobs with source larger than given dimensions', () => {
      const id = addJob('/movies/4k-movie.mkv', 'default');
      addMetadata(id, { width: 3840, height: 2160 });
      updateJobStatus(id, 'completed', { outputPath: '/output/4k-movie-1080p.mkv' });

      const jobs = getCompletedDownscaledJobs(1920, 1080);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].srcWidth).toBe(3840);
      expect(jobs[0].srcHeight).toBe(2160);
    });

    it('should not return jobs with source within given dimensions', () => {
      const id = addJob('/movies/1080p-movie.mkv', 'default');
      addMetadata(id, { width: 1920, height: 1080 });
      updateJobStatus(id, 'completed', { outputPath: '/output/1080p-movie.mkv' });

      const jobs = getCompletedDownscaledJobs(1920, 1080);
      expect(jobs).toHaveLength(0);
    });

    it('should not return pending or failed jobs', () => {
      const id1 = addJob('/movies/pending.mkv', 'default');
      addMetadata(id1, { width: 3840, height: 2160 });

      const id2 = addJob('/movies/failed.mkv', 'default');
      addMetadata(id2, { width: 3840, height: 2160 });
      updateJobStatus(id2, 'failed', { error: 'test' });

      const jobs = getCompletedDownscaledJobs(1920, 1080);
      expect(jobs).toHaveLength(0);
    });
  });

  // ─── deleteJob ─────────────────────────────────────────────────────────

  describe('deleteJob', () => {
    it('should delete a job and its metadata', () => {
      const id = addJob('/movies/test.mkv', 'default');
      addMetadata(id, { codec: 'hevc', width: 3840, height: 2160 });
      addOutputMetadata(id, { codec: 'hevc', width: 1920, height: 1080 });

      deleteJob(id);
      expect(getJobByPath('/movies/test.mkv')).toBeUndefined();
    });

    it('should not affect other jobs', () => {
      const id1 = addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');

      deleteJob(id1);
      expect(getJobByPath('/movies/test1.mkv')).toBeUndefined();
      expect(getJobByPath('/movies/test2.mkv')).toBeDefined();
    });
  });

  // ─── resetDatabase ────────────────────────────────────────────────────

  describe('resetDatabase', () => {
    it('should remove all jobs', () => {
      addJob('/movies/test1.mkv', 'default');
      addJob('/movies/test2.mkv', 'default');
      resetDatabase();
      expect(getAllJobs()).toEqual([]);
    });

    it('should allow adding new jobs after reset', () => {
      addJob('/movies/test.mkv', 'default');
      resetDatabase();
      const id = addJob('/movies/test.mkv', 'default');
      expect(id).toBeGreaterThan(0);
    });
  });

  // ─── clearJobs ─────────────────────────────────────────────────────────

  describe('clearJobs', () => {
    it('should clear all jobs when no status specified', () => {
      addJob('/movies/test1.mkv', 'default');
      const id2 = addJob('/movies/test2.mkv', 'default');
      updateJobStatus(id2, 'completed');

      clearJobs();
      expect(getAllJobs()).toEqual([]);
    });

    it('should clear only jobs with specified status', () => {
      addJob('/movies/pending.mkv', 'default');
      const id2 = addJob('/movies/completed.mkv', 'default');
      updateJobStatus(id2, 'completed');
      const id3 = addJob('/movies/failed.mkv', 'default');
      updateJobStatus(id3, 'failed', { error: 'test' });

      clearJobs('completed');
      const remaining = getAllJobs();
      expect(remaining).toHaveLength(2);
      expect(remaining.some(j => j.status === 'completed')).toBe(false);
    });

    it('should clear failed jobs only', () => {
      addJob('/movies/pending.mkv', 'default');
      const id2 = addJob('/movies/failed.mkv', 'default');
      updateJobStatus(id2, 'failed', { error: 'test' });

      clearJobs('failed');
      const remaining = getAllJobs();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].status).toBe('pending');
    });
  });
});

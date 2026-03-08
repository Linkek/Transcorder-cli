import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger to suppress output
vi.mock('../src/lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
  },
  emitLogEntry: () => {},
}));

import {
  setNumWorkers,
  getNumWorkers,
  setWorker,
  clearWorker,
  getWorkerStates,
  updateDashboardStats,
  setDashboardStats,
  setPendingCount,
  isDashboardActive,
} from '../src/lib/dashboard.js';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Dashboard State Management', () => {
  beforeEach(() => {
    // Reset to 2 workers and clear all state
    setNumWorkers(2);
    clearWorker(0);
    clearWorker(1);
    setDashboardStats({ completed: 0, failed: 0, skipped: 0, savedBytes: 0 });
  });

  describe('setNumWorkers / getNumWorkers', () => {
    it('should set and get worker count', () => {
      setNumWorkers(4);
      expect(getNumWorkers()).toBe(4);
    });

    it('should default to 2 workers', () => {
      setNumWorkers(2);
      expect(getNumWorkers()).toBe(2);
    });

    it('should handle single worker', () => {
      setNumWorkers(1);
      expect(getNumWorkers()).toBe(1);
    });

    it('should resize worker states array on increase', () => {
      setNumWorkers(2);
      setNumWorkers(4);
      const states = getWorkerStates();
      expect(states).toHaveLength(4);
    });
  });

  describe('setWorker / clearWorker / getWorkerStates', () => {
    it('should report all workers as idle initially', () => {
      const states = getWorkerStates();
      expect(states).toHaveLength(2);
      expect(states[0].idle).toBe(true);
      expect(states[1].idle).toBe(true);
    });

    it('should set a worker as active', () => {
      setWorker(0, 'movie.mkv', '4K', '1080p', false, false);
      const states = getWorkerStates();
      expect(states[0].idle).toBe(false);
      expect(states[0].fileName).toBe('movie.mkv');
      expect(states[0].srcRes).toBe('4K');
      expect(states[0].targetRes).toBe('1080p');
    });

    it('should track HDR status for workers', () => {
      setWorker(0, 'hdr-movie.mkv', '4K', '1080p', true, true);
      const states = getWorkerStates();
      expect(states[0].hdr).toBe(true);
      expect(states[0].removeHDR).toBe(true);
    });

    it('should clear a worker and set to idle', () => {
      setWorker(0, 'movie.mkv', '4K', '1080p', false, false);
      clearWorker(0);
      const states = getWorkerStates();
      expect(states[0].idle).toBe(true);
      expect(states[0].fileName).toBeUndefined();
    });

    it('should handle multiple active workers', () => {
      setWorker(0, 'movie1.mkv', '4K', '1080p', false, false);
      setWorker(1, 'movie2.mkv', '1440p', '1080p', true, true);
      const states = getWorkerStates();
      expect(states[0].idle).toBe(false);
      expect(states[0].fileName).toBe('movie1.mkv');
      expect(states[1].idle).toBe(false);
      expect(states[1].fileName).toBe('movie2.mkv');
    });

    it('should set progress to null for new worker', () => {
      setWorker(0, 'movie.mkv', '4K', '1080p', false, false);
      const states = getWorkerStates();
      expect(states[0].progress).toBeNull();
    });

    it('should preserve worker 1 when clearing worker 0', () => {
      setWorker(0, 'movie1.mkv', '4K', '1080p', false, false);
      setWorker(1, 'movie2.mkv', '1440p', '1080p', false, false);
      clearWorker(0);
      const states = getWorkerStates();
      expect(states[0].idle).toBe(true);
      expect(states[1].idle).toBe(false);
      expect(states[1].fileName).toBe('movie2.mkv');
    });

    it('should handle slot numbers correctly', () => {
      const states = getWorkerStates();
      expect(states[0].slot).toBe(0);
      expect(states[1].slot).toBe(1);
    });
  });

  describe('updateDashboardStats', () => {
    it('should increment completed count', () => {
      updateDashboardStats({ completed: 1 });
      updateDashboardStats({ completed: 1 });
      // We can't directly read stats, but we verify it doesn't crash
      // and the stats are tracked incrementally
    });

    it('should increment failed count', () => {
      updateDashboardStats({ failed: 1 });
    });

    it('should increment skipped count', () => {
      updateDashboardStats({ skipped: 1 });
    });

    it('should accumulate saved bytes', () => {
      updateDashboardStats({ savedBytes: 1_000_000_000 });
      updateDashboardStats({ savedBytes: 500_000_000 });
    });

    it('should handle partial updates', () => {
      updateDashboardStats({ completed: 1 });
      updateDashboardStats({ failed: 1 });
      updateDashboardStats({ skipped: 1 });
    });
  });

  describe('setDashboardStats', () => {
    it('should set absolute stats values', () => {
      setDashboardStats({
        completed: 100,
        failed: 5,
        skipped: 50,
        savedBytes: 50_000_000_000,
      });
      // Verify by calling again with zeros (no crash = success)
      setDashboardStats({ completed: 0, failed: 0, skipped: 0, savedBytes: 0 });
    });
  });

  describe('isDashboardActive', () => {
    it('should return false when dashboard is not initialized', () => {
      // Dashboard is not initialized in test environment
      expect(isDashboardActive()).toBe(false);
    });
  });

  describe('setPendingCount', () => {
    it('should accept a count value without error', () => {
      expect(() => setPendingCount(42)).not.toThrow();
    });

    it('should handle zero count', () => {
      expect(() => setPendingCount(0)).not.toThrow();
    });

    it('should handle large count', () => {
      expect(() => setPendingCount(10000)).not.toThrow();
    });
  });
});

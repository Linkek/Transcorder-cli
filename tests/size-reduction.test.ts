import { describe, it, expect } from 'vitest';

/**
 * Tests for size reduction calculation logic.
 * The actual implementation is inline in queue.ts, these tests verify the math.
 */

function calculateReductionPercent(originalSize: number, transcodedSize: number): number {
  return ((originalSize - transcodedSize) / originalSize) * 100;
}

function shouldSkipDueToSizeReduction(
  originalSize: number,
  transcodedSize: number,
  minSizeReduction: number,
): boolean {
  if (minSizeReduction <= 0) return false;
  const reductionPercent = calculateReductionPercent(originalSize, transcodedSize);
  return reductionPercent < minSizeReduction;
}

describe('Size Reduction Calculation', () => {
  describe('calculateReductionPercent', () => {
    it('should calculate 50% reduction', () => {
      const result = calculateReductionPercent(1000, 500);
      expect(result).toBe(50);
    });

    it('should calculate 0% when same size', () => {
      const result = calculateReductionPercent(1000, 1000);
      expect(result).toBe(0);
    });

    it('should calculate negative when file grew', () => {
      const result = calculateReductionPercent(1000, 1200);
      expect(result).toBe(-20);
    });

    it('should calculate 100% reduction', () => {
      const result = calculateReductionPercent(1000, 0);
      expect(result).toBe(100);
    });

    it('should calculate small reductions accurately', () => {
      // 1GB -> 980MB = 2% reduction
      const result = calculateReductionPercent(1000000000, 980000000);
      expect(result).toBe(2);
    });

    it('should handle real-world file sizes', () => {
      // 2.75GB -> 900MB = ~67% reduction
      const original = 2750463721;
      const transcoded = 901754688;
      const result = calculateReductionPercent(original, transcoded);
      expect(result).toBeCloseTo(67.2, 1);
    });
  });

  describe('shouldSkipDueToSizeReduction', () => {
    it('should not skip when minSizeReduction is 0', () => {
      expect(shouldSkipDueToSizeReduction(1000, 1000, 0)).toBe(false);
      expect(shouldSkipDueToSizeReduction(1000, 1200, 0)).toBe(false);
    });

    it('should not skip when reduction meets threshold', () => {
      // 10% reduction, require 10%
      expect(shouldSkipDueToSizeReduction(1000, 900, 10)).toBe(false);
      // 15% reduction, require 10%
      expect(shouldSkipDueToSizeReduction(1000, 850, 10)).toBe(false);
    });

    it('should skip when reduction is below threshold', () => {
      // 5% reduction, require 10%
      expect(shouldSkipDueToSizeReduction(1000, 950, 10)).toBe(true);
      // 0% reduction, require 2%
      expect(shouldSkipDueToSizeReduction(1000, 1000, 2)).toBe(true);
    });

    it('should skip when file grew larger', () => {
      // File grew by 20%, require any reduction
      expect(shouldSkipDueToSizeReduction(1000, 1200, 1)).toBe(true);
    });

    it('should handle edge case at exact threshold', () => {
      // Exactly 2% reduction, require 2%
      expect(shouldSkipDueToSizeReduction(1000, 980, 2)).toBe(false);
      // Just under 2% reduction
      expect(shouldSkipDueToSizeReduction(1000, 981, 2)).toBe(true);
    });

    it('should handle real-world scenario - large file with good reduction', () => {
      // 2.75GB -> 900MB, require 50% reduction
      const original = 2750463721;
      const transcoded = 901754688;
      expect(shouldSkipDueToSizeReduction(original, transcoded, 50)).toBe(false);
    });

    it('should handle real-world scenario - minimal reduction', () => {
      // 1GB -> 980MB (2% reduction), require 5%
      expect(shouldSkipDueToSizeReduction(1000000000, 980000000, 5)).toBe(true);
    });
  });
});

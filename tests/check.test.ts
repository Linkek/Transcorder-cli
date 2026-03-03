import { describe, it, expect } from 'vitest';
import { calculateTargetResolution } from '../src/lib/check.js';

describe('calculateTargetResolution', () => {
  describe('when source is within limits', () => {
    it('should keep original resolution when within limits', () => {
      const result = calculateTargetResolution(1920, 1080, 1920, 1080, true);
      expect(result).toEqual({ targetWidth: 1920, targetHeight: 1080 });
    });

    it('should keep original resolution when below limits', () => {
      const result = calculateTargetResolution(1280, 720, 1920, 1080, true);
      expect(result).toEqual({ targetWidth: 1280, targetHeight: 720 });
    });
  });

  describe('when source exceeds limits', () => {
    it('should downscale 4K to 1080p while maintaining aspect ratio', () => {
      const result = calculateTargetResolution(3840, 2160, 1920, 1080, true);
      expect(result).toEqual({ targetWidth: 1920, targetHeight: 1080 });
    });

    it('should downscale 4K to 720p while maintaining aspect ratio', () => {
      const result = calculateTargetResolution(3840, 2160, 1280, 720, true);
      expect(result).toEqual({ targetWidth: 1280, targetHeight: 720 });
    });

    it('should downscale width-limited ultrawide content', () => {
      const result = calculateTargetResolution(5120, 2160, 1920, 1080, true);
      // Width is more limiting: 5120/1920 > 2160/1080
      // Scale by width: 1920 x (2160*1920/5120) = 1920 x 810
      expect(result).toEqual({ targetWidth: 1920, targetHeight: 810 });
    });

    it('should downscale height-limited portrait content', () => {
      const result = calculateTargetResolution(1080, 1920, 1920, 1080, true);
      // Height is more limiting: 1920/1080 > 1080/1920
      // Scale by height: (1080*1080/1920) x 1080 = 607.5 → rounded to 608 (even)
      expect(result).toEqual({ targetWidth: 608, targetHeight: 1080 });
    });

    it('should ensure even dimensions for width', () => {
      const result = calculateTargetResolution(3840, 2160, 1921, 1080, true);
      // Would be 1921 x 1080, but 1921 is odd
      expect(result.targetWidth % 2).toBe(0);
    });

    it('should ensure even dimensions for height', () => {
      const result = calculateTargetResolution(3840, 2161, 1920, 1080, true);
      // Would calculate an odd height
      expect(result.targetHeight % 2).toBe(0);
    });

    it('should handle 21:9 ultrawide to 1080p', () => {
      const result = calculateTargetResolution(2560, 1080, 1920, 1080, true);
      // Width exceeds: 2560 -> 1920, maintain aspect: 1920 x (1080*1920/2560) = 1920 x 810
      expect(result).toEqual({ targetWidth: 1920, targetHeight: 810 });
    });

    it('should handle 4:3 content to 1080p', () => {
      const result = calculateTargetResolution(1600, 1200, 1920, 1080, true);
      // Height exceeds: 1200 > 1080, scale by height
      // 1080 / 1200 = 0.9, new width = 1600 * 0.9 = 1440
      expect(result).toEqual({ targetWidth: 1440, targetHeight: 1080 });
    });
  });

  describe('when downscaleToMax is false', () => {
    it('should keep original resolution even when exceeding limits', () => {
      const result = calculateTargetResolution(3840, 2160, 1920, 1080, false);
      expect(result).toEqual({ targetWidth: 3840, targetHeight: 2160 });
    });

    it('should keep original resolution regardless of size', () => {
      const result = calculateTargetResolution(7680, 4320, 1920, 1080, false);
      expect(result).toEqual({ targetWidth: 7680, targetHeight: 4320 });
    });
  });

  describe('edge cases', () => {
    it('should handle square video', () => {
      const result = calculateTargetResolution(2000, 2000, 1920, 1080, true);
      // Height is more limiting: scale to 1080 height
      // Width = 2000 * (1080/2000) = 1080
      expect(result).toEqual({ targetWidth: 1080, targetHeight: 1080 });
    });

    it('should handle very wide content', () => {
      const result = calculateTargetResolution(10000, 1000, 1920, 1080, true);
      // Width far exceeds limit, scale by width
      // Height = 1000 * (1920/10000) = 192
      expect(result).toEqual({ targetWidth: 1920, targetHeight: 192 });
    });

    it('should handle very tall content', () => {
      const result = calculateTargetResolution(1000, 10000, 1920, 1080, true);
      // Height far exceeds limit, scale by height
      // Width = 1000 * (1080/10000) = 108
      expect(result).toEqual({ targetWidth: 108, targetHeight: 1080 });
    });

    it('should handle exact limit match', () => {
      const result = calculateTargetResolution(1920, 1080, 1920, 1080, true);
      expect(result).toEqual({ targetWidth: 1920, targetHeight: 1080 });
    });
  });

  describe('common transcoding scenarios', () => {
    it('4K HDR movie to 1080p', () => {
      const result = calculateTargetResolution(3840, 2160, 1920, 1080, true);
      expect(result).toEqual({ targetWidth: 1920, targetHeight: 1080 });
    });

    it('4K movie to 1440p', () => {
      const result = calculateTargetResolution(3840, 2160, 2560, 1440, true);
      expect(result).toEqual({ targetWidth: 2560, targetHeight: 1440 });
    });

    it('1440p content to 1080p', () => {
      const result = calculateTargetResolution(2560, 1440, 1920, 1080, true);
      expect(result).toEqual({ targetWidth: 1920, targetHeight: 1080 });
    });

    it('1080p content to 720p', () => {
      const result = calculateTargetResolution(1920, 1080, 1280, 720, true);
      expect(result).toEqual({ targetWidth: 1280, targetHeight: 720 });
    });

    it('iPhone vertical video to 1080p', () => {
      // iPhone 4K vertical: 2160x3840
      const result = calculateTargetResolution(2160, 3840, 1920, 1080, true);
      // Height is way over: 3840/1080 > 2160/1920
      // Scale by height: 1080 height, width = 2160 * (1080/3840) = 607.5 → 608 (even)
      expect(result).toEqual({ targetWidth: 608, targetHeight: 1080 });
    });
  });
});

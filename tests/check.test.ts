import { describe, it, expect } from 'vitest';
import { calculateTargetResolution, formatAnalysis } from '../src/lib/check.js';
import type { CheckResult, VideoMetadata } from '../src/types/index.js';

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

// ─── formatAnalysis ─────────────────────────────────────────────────────────

function makeMetadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    filePath: '/movies/test-movie.mkv',
    fileName: 'test-movie.mkv',
    fileSize: 5_000_000_000,
    container: 'matroska',
    duration: 7200,
    ...overrides,
    video: {
      index: 0,
      codec_name: 'hevc',
      width: 3840,
      height: 2160,
      ...overrides.video,
    } as VideoMetadata['video'],
    audioStreams: overrides.audioStreams ?? [
      { index: 1, codec_name: 'aac', channels: 2 },
    ],
    subtitleStreams: overrides.subtitleStreams ?? [],
    isHDR: overrides.isHDR ?? false,
    hdrFormat: overrides.hdrFormat,
  };
}

function makeCheckResult(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    needsTranscode: true,
    reasons: ['Resolution exceeds max'],
    metadata: makeMetadata(),
    targetWidth: 1920,
    targetHeight: 1080,
    ...overrides,
  };
}

describe('formatAnalysis', () => {
  it('should include file name in output', () => {
    const result = formatAnalysis(makeCheckResult());
    expect(result).toContain('test-movie.mkv');
  });

  it('should include resolution', () => {
    const result = formatAnalysis(makeCheckResult());
    expect(result).toContain('3840x2160');
  });

  it('should include codec', () => {
    const result = formatAnalysis(makeCheckResult());
    expect(result).toContain('hevc');
  });

  it('should show HDR as Yes when file is HDR', () => {
    const result = formatAnalysis(makeCheckResult({
      metadata: makeMetadata({ isHDR: true, hdrFormat: 'HDR10' }),
    }));
    expect(result).toContain('Yes (HDR10)');
  });

  it('should show HDR as No when file is SDR', () => {
    const result = formatAnalysis(makeCheckResult({
      metadata: makeMetadata({ isHDR: false }),
    }));
    expect(result).toContain('HDR:        No');
  });

  it('should show duration in minutes and seconds', () => {
    const result = formatAnalysis(makeCheckResult({
      metadata: makeMetadata({ duration: 5430 }), // 90m 30s
    }));
    expect(result).toContain('90m 30s');
  });

  it('should show audio stream count and codecs', () => {
    const result = formatAnalysis(makeCheckResult({
      metadata: makeMetadata({
        audioStreams: [
          { index: 1, codec_name: 'aac', channels: 2 },
          { index: 2, codec_name: 'dts', channels: 6 },
        ],
      }),
    }));
    expect(result).toContain('2 stream(s)');
    expect(result).toContain('aac, dts');
  });

  it('should show subtitle stream count', () => {
    const result = formatAnalysis(makeCheckResult({
      metadata: makeMetadata({
        subtitleStreams: [
          { index: 3, codec_name: 'srt' },
          { index: 4, codec_name: 'ass' },
        ],
      }),
    }));
    expect(result).toContain('2 stream(s)');
  });

  it('should show file size in MB', () => {
    const result = formatAnalysis(makeCheckResult({
      metadata: makeMetadata({ fileSize: 1_500_000_000 }),
    }));
    expect(result).toContain('1430.5 MB');
  });

  it('should show YES when transcode is needed', () => {
    const result = formatAnalysis(makeCheckResult({ needsTranscode: true }));
    expect(result).toContain('Transcode:  YES');
  });

  it('should show NO (skip) when transcode is not needed', () => {
    const result = formatAnalysis(makeCheckResult({ needsTranscode: false }));
    expect(result).toContain('Transcode:  NO (skip)');
  });

  it('should show target resolution when transcoding', () => {
    const result = formatAnalysis(makeCheckResult({
      needsTranscode: true,
      targetWidth: 1920,
      targetHeight: 1080,
    }));
    expect(result).toContain('Target:     1920x1080');
  });

  it('should not show target resolution when skipping', () => {
    const result = formatAnalysis(makeCheckResult({
      needsTranscode: false,
      targetWidth: 1920,
      targetHeight: 1080,
    }));
    expect(result).not.toContain('Target:');
  });

  it('should include all reasons', () => {
    const result = formatAnalysis(makeCheckResult({
      reasons: ['Resolution exceeds max', 'HDR detected'],
    }));
    expect(result).toContain('→ Resolution exceeds max');
    expect(result).toContain('→ HDR detected');
  });

  it('should handle metadata with zero audio streams', () => {
    const result = formatAnalysis(makeCheckResult({
      metadata: makeMetadata({ audioStreams: [] }),
    }));
    expect(result).toContain('0 stream(s)');
  });

  it('should handle zero duration', () => {
    const result = formatAnalysis(makeCheckResult({
      metadata: makeMetadata({ duration: 0 }),
    }));
    expect(result).toContain('0m 0s');
  });
});

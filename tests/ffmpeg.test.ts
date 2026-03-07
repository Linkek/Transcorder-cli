import { describe, it, expect } from 'vitest';
import {
  formatResolution,
  detectHDR,
} from '../src/lib/ffmpeg.js';
import { formatFileSize, formatDuration } from '../src/lib/utils.js';
import type { VideoStream } from '../src/types/index.js';

describe('formatResolution', () => {
  describe('standard resolutions', () => {
    it('should return 4K for 3840x2160', () => {
      expect(formatResolution(3840, 2160)).toBe('4K');
    });

    it('should return 4K for height >= 2160', () => {
      expect(formatResolution(3200, 2160)).toBe('4K');
    });

    it('should return 4K for width >= 3840', () => {
      expect(formatResolution(3840, 1800)).toBe('4K');
    });

    it('should return 1440p for 2560x1440', () => {
      expect(formatResolution(2560, 1440)).toBe('1440p');
    });

    it('should return 1440p for height >= 1440', () => {
      expect(formatResolution(2000, 1440)).toBe('1440p');
    });

    it('should return 1440p for width >= 2560', () => {
      expect(formatResolution(2560, 1200)).toBe('1440p');
    });

    it('should return 1080p for 1920x1080', () => {
      expect(formatResolution(1920, 1080)).toBe('1080p');
    });

    it('should return 1080p for height >= 1080', () => {
      expect(formatResolution(1600, 1080)).toBe('1080p');
    });

    it('should return 1080p for width >= 1920', () => {
      expect(formatResolution(1920, 900)).toBe('1080p');
    });

    it('should return 720p for 1280x720', () => {
      expect(formatResolution(1280, 720)).toBe('720p');
    });

    it('should return 720p for height >= 720', () => {
      expect(formatResolution(1000, 720)).toBe('720p');
    });

    it('should return 720p for width >= 1280', () => {
      expect(formatResolution(1280, 600)).toBe('720p');
    });

    it('should return 480p for 854x480', () => {
      expect(formatResolution(854, 480)).toBe('480p');
    });

    it('should return 480p for height >= 480', () => {
      expect(formatResolution(700, 480)).toBe('480p');
    });

    it('should return 480p for width >= 854', () => {
      expect(formatResolution(854, 400)).toBe('480p');
    });
  });

  describe('non-standard resolutions', () => {
    it('should return dimensions for small videos', () => {
      expect(formatResolution(640, 360)).toBe('640x360');
    });

    it('should return dimensions for very small videos', () => {
      expect(formatResolution(320, 240)).toBe('320x240');
    });
  });

  describe('ultrawide resolutions', () => {
    it('should return 1080p for ultrawide 2560x1080', () => {
      expect(formatResolution(2560, 1080)).toBe('1440p');
    });

    it('should return 4K for ultrawide 5120x2160', () => {
      expect(formatResolution(5120, 2160)).toBe('4K');
    });
  });
});

describe('formatFileSize', () => {
  it('should format bytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('should format kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('should format kilobytes with decimal', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('should format megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('should format megabytes with decimal', () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('should format large megabytes', () => {
    expect(formatFileSize(500 * 1024 * 1024)).toBe('500.0 MB');
  });

  it('should format gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
  });

  it('should format gigabytes with decimal', () => {
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
  });

  it('should format large gigabytes', () => {
    expect(formatFileSize(10 * 1024 * 1024 * 1024)).toBe('10.00 GB');
  });

  it('should handle zero', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('should format seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('should format minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('should format exact minutes', () => {
    expect(formatDuration(120)).toBe('2m 0s');
  });

  it('should format hours, minutes, and seconds', () => {
    expect(formatDuration(3725)).toBe('1h 2m 5s');
  });

  it('should format exact hours', () => {
    expect(formatDuration(3600)).toBe('1h 0m 0s');
  });

  it('should format multiple hours', () => {
    expect(formatDuration(7265)).toBe('2h 1m 5s');
  });

  it('should handle zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('should truncate decimals', () => {
    expect(formatDuration(45.7)).toBe('45s');
  });
});

describe('detectHDR', () => {
  const createVideoStream = (overrides: Partial<VideoStream> = {}): VideoStream => ({
    width: 3840,
    height: 2160,
    codec_name: 'hevc',
    ...overrides,
  });

  describe('HDR10 detection', () => {
    it('should detect HDR10 via SMPTE2084 transfer', () => {
      const video = createVideoStream({
        color_transfer: 'smpte2084',
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(true);
      expect(result.hdrFormat).toBe('HDR10');
    });
  });

  describe('HDR10+ detection', () => {
    it('should detect HDR10+ via side data', () => {
      const video = createVideoStream({
        color_transfer: 'smpte2084',
        side_data_list: [
          { side_data_type: 'HDR10+ Dynamic Metadata' },
        ],
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(true);
      expect(result.hdrFormat).toBe('HDR10+');
    });
  });

  describe('Dolby Vision detection', () => {
    it('should detect Dolby Vision via side data', () => {
      const video = createVideoStream({
        color_transfer: 'smpte2084',
        side_data_list: [
          { side_data_type: 'DOVI configuration record' },
          { side_data_type: 'Dolby Vision Metadata' },
        ],
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(true);
      expect(result.hdrFormat).toBe('Dolby Vision');
    });

    it('should detect Dolby Vision case-insensitive', () => {
      const video = createVideoStream({
        color_transfer: 'smpte2084',
        side_data_list: [
          { side_data_type: 'dolby vision configuration' },
        ],
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(true);
      expect(result.hdrFormat).toBe('Dolby Vision');
    });
  });

  describe('HLG detection', () => {
    it('should detect HLG via arib-std-b67 transfer', () => {
      const video = createVideoStream({
        color_transfer: 'arib-std-b67',
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(true);
      expect(result.hdrFormat).toBe('HLG');
    });
  });

  describe('BT.2020 10-bit detection', () => {
    it('should detect HDR via BT.2020 + 10-bit pixel format (10le)', () => {
      const video = createVideoStream({
        color_primaries: 'bt2020',
        pix_fmt: 'yuv420p10le',
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(true);
      expect(result.hdrFormat).toBe('HDR (BT.2020 10-bit)');
    });

    it('should detect HDR via BT.2020 + 10-bit pixel format (10be)', () => {
      const video = createVideoStream({
        color_primaries: 'bt2020',
        pix_fmt: 'yuv420p10be',
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(true);
      expect(result.hdrFormat).toBe('HDR (BT.2020 10-bit)');
    });

    it('should detect HDR via BT.2020 + p010 pixel format', () => {
      const video = createVideoStream({
        color_primaries: 'bt2020',
        pix_fmt: 'p010le',
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(true);
      expect(result.hdrFormat).toBe('HDR (BT.2020 10-bit)');
    });
  });

  describe('SDR detection', () => {
    it('should return SDR for standard video', () => {
      const video = createVideoStream({
        color_transfer: 'bt709',
        color_primaries: 'bt709',
        pix_fmt: 'yuv420p',
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(false);
      expect(result.hdrFormat).toBeUndefined();
    });

    it('should return SDR for video without color info', () => {
      const video = createVideoStream({});
      const result = detectHDR(video);
      expect(result.isHDR).toBe(false);
    });

    it('should return SDR for BT.2020 without 10-bit', () => {
      const video = createVideoStream({
        color_primaries: 'bt2020',
        pix_fmt: 'yuv420p',
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(false);
    });

    it('should return SDR for 10-bit without BT.2020', () => {
      const video = createVideoStream({
        color_primaries: 'bt709',
        pix_fmt: 'yuv420p10le',
      });
      const result = detectHDR(video);
      expect(result.isHDR).toBe(false);
    });
  });
});

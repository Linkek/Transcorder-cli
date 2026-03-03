import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeFile } from '../src/lib/check.js';
import * as ffmpegModule from '../src/lib/ffmpeg.js';
import type { Profile, VideoMetadata } from '../src/types/index.js';

// Mock probeFile to return controlled metadata
vi.mock('../src/lib/ffmpeg.js', async () => {
  const actual = await vi.importActual('../src/lib/ffmpeg.js');
  return {
    ...actual,
    probeFile: vi.fn(),
  };
});

const createProfile = (overrides: Partial<Profile> = {}): Profile => ({
  name: 'test',
  sourceFolders: ['input'],
  recursive: true,
  replaceFile: false,
  outputFolder: 'output',
  outputFormat: 'mkv',
  cacheFolder: 'cache',
  maxWidth: 1920,
  maxHeight: 1080,
  downscaleToMax: true,
  renameFiles: true,
  removeHDR: true,
  nvencPreset: 'p4',
  cqValue: 23,
  log: true,
  ...overrides,
});

const createMetadata = (overrides: Partial<VideoMetadata> = {}): VideoMetadata => ({
  filePath: '/test/movie.mkv',
  fileName: 'movie.mkv',
  duration: 7200,
  fileSize: 10 * 1024 * 1024 * 1024,
  video: {
    width: 3840,
    height: 2160,
    codec_name: 'hevc',
    frame_rate: 23.976,
  },
  audioStreams: [{ codec_name: 'aac', channels: 2 }],
  subtitleStreams: [],
  isHDR: false,
  ...overrides,
});

describe('HDR removal logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when removeHDR is true in profile', () => {
    it('should flag HDR10 content for transcoding', async () => {
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          width: 3840,
          height: 2160,
          codec_name: 'hevc',
          color_transfer: 'smpte2084',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      const profile = createProfile({ removeHDR: true });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(true);
      expect(result.reasons.some(r => r.includes('HDR'))).toBe(true);
      expect(result.reasons.some(r => r.includes('SDR'))).toBe(true);
    });

    it('should flag HDR10+ content for transcoding', async () => {
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'HDR10+',
        video: {
          width: 3840,
          height: 2160,
          codec_name: 'hevc',
          color_transfer: 'smpte2084',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      const profile = createProfile({ removeHDR: true });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(true);
      expect(result.reasons.some(r => r.includes('HDR10+'))).toBe(true);
    });

    it('should flag Dolby Vision content for transcoding', async () => {
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'Dolby Vision',
        video: {
          width: 3840,
          height: 2160,
          codec_name: 'hevc',
          color_transfer: 'smpte2084',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      const profile = createProfile({ removeHDR: true });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(true);
      expect(result.reasons.some(r => r.includes('Dolby Vision'))).toBe(true);
    });

    it('should flag HLG content for transcoding', async () => {
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'HLG',
        video: {
          width: 3840,
          height: 2160,
          codec_name: 'hevc',
          color_transfer: 'arib-std-b67',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      const profile = createProfile({ removeHDR: true });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(true);
      expect(result.reasons.some(r => r.includes('HLG'))).toBe(true);
    });

    it('should transcode HDR content even if resolution is within limits', async () => {
      // HDR file that's already 1080p - should still transcode to remove HDR
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          width: 1920,
          height: 1080,
          codec_name: 'hevc',
          color_transfer: 'smpte2084',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      const profile = createProfile({
        removeHDR: true,
        maxWidth: 1920,
        maxHeight: 1080,
      });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(true);
      expect(result.reasons.some(r => r.includes('HDR'))).toBe(true);
    });

    it('should not flag SDR content for transcoding when only HDR check applies', async () => {
      const metadata = createMetadata({
        isHDR: false,
        video: {
          width: 1920,
          height: 1080,
          codec_name: 'hevc',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      const profile = createProfile({
        removeHDR: true,
        maxWidth: 1920,
        maxHeight: 1080,
        downscaleToMax: true,
      });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(false);
      expect(result.reasons.some(r => r.includes('no transcoding needed'))).toBe(true);
    });
  });

  describe('when removeHDR is false in profile', () => {
    it('should NOT flag HDR content for transcoding based on HDR alone', async () => {
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          width: 1920,
          height: 1080,
          codec_name: 'hevc',
          color_transfer: 'smpte2084',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      // removeHDR is false, resolution is within limits
      const profile = createProfile({
        removeHDR: false,
        maxWidth: 1920,
        maxHeight: 1080,
      });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(false);
      expect(result.reasons.some(r => r.includes('HDR'))).toBe(false);
    });

    it('should still transcode HDR content if it exceeds resolution limits', async () => {
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          width: 3840,
          height: 2160,
          codec_name: 'hevc',
          color_transfer: 'smpte2084',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      // removeHDR is false, but resolution exceeds limits
      const profile = createProfile({
        removeHDR: false,
        maxWidth: 1920,
        maxHeight: 1080,
        downscaleToMax: true,
      });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(true);
      expect(result.reasons.some(r => r.includes('Resolution'))).toBe(true);
      expect(result.reasons.some(r => r.includes('downscale'))).toBe(true);
      // HDR should NOT be mentioned since removeHDR is false
      expect(result.reasons.some(r => r.includes('SDR'))).toBe(false);
    });
  });

  describe('combined HDR and resolution handling', () => {
    it('should mention both HDR and resolution when both apply', async () => {
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          width: 3840,
          height: 2160,
          codec_name: 'hevc',
          color_transfer: 'smpte2084',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      const profile = createProfile({
        removeHDR: true,
        maxWidth: 1920,
        maxHeight: 1080,
        downscaleToMax: true,
      });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.needsTranscode).toBe(true);
      expect(result.reasons.some(r => r.includes('Resolution'))).toBe(true);
      expect(result.reasons.some(r => r.includes('HDR'))).toBe(true);
    });

    it('should calculate correct target resolution for HDR content', async () => {
      const metadata = createMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          width: 3840,
          height: 2160,
          codec_name: 'hevc',
        },
      });

      vi.mocked(ffmpegModule.probeFile).mockResolvedValue(metadata);

      const profile = createProfile({
        removeHDR: true,
        maxWidth: 1920,
        maxHeight: 1080,
      });
      const result = await analyzeFile('/test/movie.mkv', profile);

      expect(result.targetWidth).toBe(1920);
      expect(result.targetHeight).toBe(1080);
    });
  });
});

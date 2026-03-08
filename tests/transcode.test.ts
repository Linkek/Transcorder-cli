import { describe, it, expect } from 'vitest';
import { dryRun } from '../src/lib/transcode.js';
import type { CheckResult, Profile, VideoMetadata } from '../src/types/index.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeMetadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    filePath: '/movies/Test.Movie.2023.mkv',
    fileName: 'Test.Movie.2023.mkv',
    fileSize: 5_000_000_000,
    container: 'matroska',
    duration: 7200,
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
    subtitleStreams: overrides.subtitleStreams ?? [
      { index: 2, codec_name: 'srt' },
    ],
    isHDR: overrides.isHDR ?? false,
    hdrFormat: overrides.hdrFormat,
  };
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: 'test-profile',
    sourceFolders: ['/movies'],
    recursive: true,
    replaceFile: false,
    outputFolder: '/output',
    outputFormat: 'mkv',
    cacheFolder: '/cache',
    maxWidth: 1920,
    maxHeight: 1080,
    downscaleToMax: true,
    renameFiles: true,
    removeHDR: false,
    nvencPreset: 'p5',
    cqValue: 28,
    log: false,
    priority: 5,
    minSizeReduction: 2,
    ...overrides,
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('dryRun', () => {
  it('should include DRY RUN header', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('DRY RUN');
  });

  it('should show input file path', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('/movies/Test.Movie.2023.mkv');
  });

  it('should show resolution change', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('3840x2160 → 1920x1080');
  });

  it('should show HDR status as No when not HDR', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('HDR:        No');
  });

  it('should show HDR format and keep when removeHDR is false', () => {
    const result = dryRun(
      makeCheckResult({ metadata: makeMetadata({ isHDR: true, hdrFormat: 'HDR10' }) }),
      makeProfile({ removeHDR: false }),
    );
    expect(result).toContain('HDR10 → keep');
  });

  it('should show HDR format and tone-map when removeHDR is true', () => {
    const result = dryRun(
      makeCheckResult({ metadata: makeMetadata({ isHDR: true, hdrFormat: 'HDR10' }) }),
      makeProfile({ removeHDR: true }),
    );
    expect(result).toContain('HDR10 → SDR (will tone-map)');
  });

  it('should show codec change to NVENC', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('hevc → hevc (NVENC)');
  });

  it('should show audio stream count with copy', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('1 stream(s) → copy');
  });

  it('should show subtitle stream count with copy', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('1 stream(s) → copy');
  });

  it('should show profile name, preset, and cq value', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('test-profile (preset: p5, cq: 28)');
  });

  it('should show SKIP result when no transcode needed', () => {
    const result = dryRun(
      makeCheckResult({ needsTranscode: false }),
      makeProfile(),
    );
    expect(result).toContain('SKIP — file already meets criteria');
  });

  it('should show TRANSCODE result when transcode needed', () => {
    const result = dryRun(makeCheckResult(), makeProfile());
    expect(result).toContain('Result: TRANSCODE');
  });

  it('should show output path in output folder when set', () => {
    const result = dryRun(makeCheckResult(), makeProfile({ outputFolder: '/output' }));
    expect(result).toContain('/output/');
  });

  it('should show replaces original when replaceFile is true', () => {
    const result = dryRun(makeCheckResult(), makeProfile({ replaceFile: true }));
    expect(result).toContain('replaces original');
  });

  it('should show alongside source when no output folder', () => {
    const result = dryRun(
      makeCheckResult(),
      makeProfile({ replaceFile: false, outputFolder: undefined }),
    );
    expect(result).toContain('alongside source');
  });

  it('should include all reasons', () => {
    const result = dryRun(
      makeCheckResult({ reasons: ['Resolution exceeds max', 'HDR removal requested'] }),
      makeProfile(),
    );
    expect(result).toContain('→ Resolution exceeds max');
    expect(result).toContain('→ HDR removal requested');
  });

  it('should show multiple audio streams', () => {
    const result = dryRun(
      makeCheckResult({
        metadata: makeMetadata({
          audioStreams: [
            { index: 1, codec_name: 'aac', channels: 2 },
            { index: 2, codec_name: 'dts', channels: 6 },
            { index: 3, codec_name: 'ac3', channels: 6 },
          ],
        }),
      }),
      makeProfile(),
    );
    expect(result).toContain('3 stream(s) → copy');
  });

  it('should show zero subtitle streams', () => {
    const result = dryRun(
      makeCheckResult({
        metadata: makeMetadata({ subtitleStreams: [] }),
      }),
      makeProfile(),
    );
    expect(result).toContain('0 stream(s) → copy');
  });

  it('should handle different profile presets', () => {
    const result = dryRun(makeCheckResult(), makeProfile({ nvencPreset: 'p1', cqValue: 18 }));
    expect(result).toContain('preset: p1, cq: 18');
  });

  it('should handle h264 source codec', () => {
    const result = dryRun(
      makeCheckResult({
        metadata: makeMetadata({ video: { index: 0, codec_name: 'h264', width: 3840, height: 2160 } }),
      }),
      makeProfile(),
    );
    expect(result).toContain('h264 → hevc (NVENC)');
  });
});

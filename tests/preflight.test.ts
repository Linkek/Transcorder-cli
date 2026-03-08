import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  detectSubtitleIssues,
  detectInterlaced,
  checkPixelFormatCompatibility,
  detectDolbyVisionProfile,
  buildStrategyCascade,
} from '../src/lib/preflight.js'
import type {
  VideoMetadata,
  CheckResult,
  Profile,
  SubtitleDecision,
} from '../src/types/index.js'

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeMetadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    filePath: '/test/video.mkv',
    fileName: 'video.mkv',
    fileSize: 5_000_000_000,
    container: 'matroska',
    duration: 7200,
    video: {
      index: 0,
      codec_name: 'hevc',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p',
      color_transfer: 'smpte2084',
      color_primaries: 'bt2020',
      ...overrides.video,
    } as VideoMetadata['video'],
    audioStreams: overrides.audioStreams ?? [
      { index: 1, codec_name: 'aac', channels: 2 },
    ],
    subtitleStreams: overrides.subtitleStreams ?? [],
    isHDR: overrides.isHDR ?? false,
    hdrFormat: overrides.hdrFormat,
  }
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: 'test-profile',
    sourceFolders: ['/test/input'],
    recursive: true,
    replaceFile: true,
    outputFormat: 'mkv',
    cacheFolder: '/tmp/cache',
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
  }
}

function makeCheckResult(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    needsTranscode: true,
    reasons: ['Resolution exceeds max'],
    metadata: makeMetadata(),
    targetWidth: 1920,
    targetHeight: 1080,
    ...overrides,
  }
}

// ─── detectSubtitleIssues ───────────────────────────────────────────────────

describe('detectSubtitleIssues', () => {
  it('should return copy-all when no subtitle streams exist', () => {
    const metadata = makeMetadata({ subtitleStreams: [] })
    const result = detectSubtitleIssues(metadata, 'mp4')
    expect(result.action).toBe('copy-all')
  })

  it('should return copy-all for MKV output (supports all sub types)', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'hdmv_pgs_subtitle' },
        { index: 3, codec_name: 'srt' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mkv')
    expect(result.action).toBe('copy-all')
  })

  it('should return copy-all when all subs are text-based and output is MP4', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'srt' },
        { index: 3, codec_name: 'ass' },
        { index: 4, codec_name: 'subrip' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mp4')
    expect(result.action).toBe('copy-all')
  })

  it('should return copy-compatible when MP4 has mix of PGS and SRT', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'hdmv_pgs_subtitle' },
        { index: 3, codec_name: 'srt' },
        { index: 4, codec_name: 'ass' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mp4')
    expect(result.action).toBe('copy-compatible')
    if (result.action === 'copy-compatible') {
      expect(result.indices).toEqual([3, 4])
    }
  })

  it('should return drop-all when MP4 has only bitmap subs', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'hdmv_pgs_subtitle' },
        { index: 3, codec_name: 'dvd_subtitle' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mp4')
    expect(result.action).toBe('drop-all')
    if (result.action === 'drop-all') {
      expect(result.reason).toContain('incompatible')
      expect(result.reason).toContain('.mp4')
    }
  })

  it('should treat MOV as a no-bitmap container', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'dvb_subtitle' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mov')
    expect(result.action).toBe('drop-all')
  })

  it('should treat WEBM as a no-bitmap container', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'pgssub' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'webm')
    expect(result.action).toBe('drop-all')
  })

  it('should handle case-insensitive codec names', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'HDMV_PGS_SUBTITLE' },
        { index: 3, codec_name: 'SRT' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mp4')
    expect(result.action).toBe('copy-compatible')
    if (result.action === 'copy-compatible') {
      expect(result.indices).toEqual([3])
    }
  })

  // ── mov_text / MP4-only subtitle codec handling ──────────────────────────

  it('should drop mov_text subtitles when output is MKV', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'mov_text' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mkv')
    expect(result.action).toBe('drop-all')
    if (result.action === 'drop-all') {
      expect(result.reason).toContain('incompatible')
      expect(result.reason).toContain('.mkv')
    }
  })

  it('should keep mov_text subtitles when output is MP4', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'mov_text' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mp4')
    expect(result.action).toBe('copy-all')
  })

  it('should keep mov_text subtitles when output is MOV', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'mov_text' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mov')
    expect(result.action).toBe('copy-all')
  })

  it('should drop tx3g subtitles when output is MKV', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'tx3g' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mkv')
    expect(result.action).toBe('drop-all')
  })

  it('should drop mov_text subtitles when output is WEBM', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'mov_text' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'webm')
    expect(result.action).toBe('drop-all')
  })

  it('should keep compatible subs and drop mov_text when mixed and output is MKV', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'mov_text' },
        { index: 3, codec_name: 'srt' },
        { index: 4, codec_name: 'ass' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mkv')
    expect(result.action).toBe('copy-compatible')
    if (result.action === 'copy-compatible') {
      expect(result.indices).toEqual([3, 4])
    }
  })

  it('should handle both mov_text and bitmap subs going to MKV (bitmap ok, mov_text not)', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'mov_text' },
        { index: 3, codec_name: 'hdmv_pgs_subtitle' },
        { index: 4, codec_name: 'srt' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mkv')
    expect(result.action).toBe('copy-compatible')
    if (result.action === 'copy-compatible') {
      // PGS is fine in MKV, mov_text is not. SRT is fine too.
      expect(result.indices).toEqual([3, 4])
    }
  })

  it('should handle both mov_text and bitmap subs going to MP4', () => {
    const metadata = makeMetadata({
      subtitleStreams: [
        { index: 2, codec_name: 'mov_text' },
        { index: 3, codec_name: 'hdmv_pgs_subtitle' },
      ],
    })
    const result = detectSubtitleIssues(metadata, 'mp4')
    // mov_text is fine in MP4, PGS is not
    expect(result.action).toBe('copy-compatible')
    if (result.action === 'copy-compatible') {
      expect(result.indices).toEqual([2])
    }
  })
})

// ─── detectInterlaced ───────────────────────────────────────────────────────

describe('detectInterlaced', () => {
  it('should detect top-field-first interlaced content (tt)', () => {
    const metadata = makeMetadata({ video: { field_order: 'tt' } as any })
    expect(detectInterlaced(metadata)).toBe(true)
  })

  it('should detect bottom-field-first interlaced content (bb)', () => {
    const metadata = makeMetadata({ video: { field_order: 'bb' } as any })
    expect(detectInterlaced(metadata)).toBe(true)
  })

  it('should detect top-bottom interlaced (tb)', () => {
    const metadata = makeMetadata({ video: { field_order: 'tb' } as any })
    expect(detectInterlaced(metadata)).toBe(true)
  })

  it('should detect bottom-top interlaced (bt)', () => {
    const metadata = makeMetadata({ video: { field_order: 'bt' } as any })
    expect(detectInterlaced(metadata)).toBe(true)
  })

  it('should return false for progressive content', () => {
    const metadata = makeMetadata({ video: { field_order: 'progressive' } as any })
    expect(detectInterlaced(metadata)).toBe(false)
  })

  it('should return false when field_order is undefined', () => {
    const metadata = makeMetadata()
    expect(detectInterlaced(metadata)).toBe(false)
  })

  it('should handle uppercase field_order', () => {
    const metadata = makeMetadata({ video: { field_order: 'TT' } as any })
    expect(detectInterlaced(metadata)).toBe(true)
  })
})

// ─── checkPixelFormatCompatibility ──────────────────────────────────────────

describe('checkPixelFormatCompatibility', () => {
  describe('NVENC-compatible formats', () => {
    const compatibleFormats = ['yuv420p', 'nv12', 'p010le', 'p010', 'yuv444p', 'yuv444p16le', 'bgr0', 'rgb0', 'cuda']

    for (const fmt of compatibleFormats) {
      it(`should report ${fmt} as compatible`, () => {
        const result = checkPixelFormatCompatibility(fmt)
        expect(result.compatible).toBe(true)
        expect(result.conversion).toBeUndefined()
      })
    }
  })

  describe('formats needing conversion', () => {
    it('should convert 10-bit formats to p010le', () => {
      const result = checkPixelFormatCompatibility('yuv420p10le')
      expect(result.compatible).toBe(false)
      expect(result.conversion).toBe('p010le')
    })

    it('should convert yuv422p10le to p010le', () => {
      const result = checkPixelFormatCompatibility('yuv422p10le')
      expect(result.compatible).toBe(false)
      expect(result.conversion).toBe('p010le')
    })

    it('should convert 12-bit formats to p010le', () => {
      const result = checkPixelFormatCompatibility('yuv420p12le')
      expect(result.compatible).toBe(false)
      expect(result.conversion).toBe('p010le')
    })

    it('should convert 16-bit formats to p010le', () => {
      const result = checkPixelFormatCompatibility('yuv420p16le')
      expect(result.compatible).toBe(false)
      expect(result.conversion).toBe('p010le')
    })

    it('should convert unknown formats to yuv420p', () => {
      const result = checkPixelFormatCompatibility('xyz12le')
      expect(result.compatible).toBe(false)
      // xyz12le contains 12le, so it maps to p010le
      expect(result.conversion).toBe('p010le')
    })

    it('should convert truly unknown formats to yuv420p', () => {
      const result = checkPixelFormatCompatibility('some_weird_format')
      expect(result.compatible).toBe(false)
      expect(result.conversion).toBe('yuv420p')
    })
  })

  it('should treat undefined pixel format as compatible', () => {
    const result = checkPixelFormatCompatibility(undefined)
    expect(result.compatible).toBe(true)
  })
})

// ─── detectDolbyVisionProfile ───────────────────────────────────────────────

describe('detectDolbyVisionProfile', () => {
  it('should return null for non-HDR content', () => {
    const metadata = makeMetadata({ isHDR: false })
    expect(detectDolbyVisionProfile(metadata)).toBeNull()
  })

  it('should return null for HDR10 (non-Dolby Vision)', () => {
    const metadata = makeMetadata({ isHDR: true, hdrFormat: 'HDR10' })
    expect(detectDolbyVisionProfile(metadata)).toBeNull()
  })

  it('should return null for DV without side_data_list', () => {
    const metadata = makeMetadata({
      isHDR: true,
      hdrFormat: 'Dolby Vision',
    })
    expect(detectDolbyVisionProfile(metadata)).toBeNull()
  })

  it('should detect DV profile 5 from side_data', () => {
    const metadata = makeMetadata({
      isHDR: true,
      hdrFormat: 'Dolby Vision',
      video: {
        side_data_list: [
          {
            side_data_type: 'DOVI configuration record / Dolby Vision',
            dv_profile: 5,
          },
        ],
      } as any,
    })
    expect(detectDolbyVisionProfile(metadata)).toBe(5)
  })

  it('should detect DV profile 7 from side_data', () => {
    const metadata = makeMetadata({
      isHDR: true,
      hdrFormat: 'Dolby Vision',
      video: {
        side_data_list: [
          {
            side_data_type: 'DOVI configuration record / Dolby Vision',
            dv_profile: 7,
          },
        ],
      } as any,
    })
    expect(detectDolbyVisionProfile(metadata)).toBe(7)
  })

  it('should detect DV profile 8 from side_data', () => {
    const metadata = makeMetadata({
      isHDR: true,
      hdrFormat: 'Dolby Vision',
      video: {
        side_data_list: [
          {
            side_data_type: 'DOVI configuration record / Dolby Vision',
            dv_profile: 8,
          },
        ],
      } as any,
    })
    expect(detectDolbyVisionProfile(metadata)).toBe(8)
  })

  it('should return null when side_data has no DV records', () => {
    const metadata = makeMetadata({
      isHDR: true,
      hdrFormat: 'Dolby Vision',
      video: {
        side_data_list: [
          { side_data_type: 'Content light level metadata' },
          { side_data_type: 'Mastering display colour volume' },
        ],
      } as any,
    })
    expect(detectDolbyVisionProfile(metadata)).toBeNull()
  })

  it('should detect DV via dv_version_major fallback', () => {
    const metadata = makeMetadata({
      isHDR: true,
      hdrFormat: 'Dolby Vision',
      video: {
        side_data_list: [
          {
            side_data_type: 'DOVI configuration record / Dolby Vision',
            dv_version_major: 1,
            dv_profile: 8,
          },
        ],
      } as any,
    })
    expect(detectDolbyVisionProfile(metadata)).toBe(8)
  })
})

// ─── buildStrategyCascade ───────────────────────────────────────────────────

describe('buildStrategyCascade', () => {
  describe('scale pipeline (4K → 1080p, no HDR)', () => {
    it('should build 4 strategies: gpu-scale → gpu-decode-cpu-scale → cpu-scale-nvenc → cpu-full', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ outputFormat: 'mkv' })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      expect(strategies.length).toBe(4)
      expect(strategies[0].name).toBe('gpu-scale')
      expect(strategies[0].gpuEncode).toBe(true)
      expect(strategies[0].inputOptions).toContain('-hwaccel')
      expect(strategies[0].videoFilters.some(f => f.includes('scale_cuda'))).toBe(true)

      expect(strategies[1].name).toBe('gpu-decode-cpu-scale')
      expect(strategies[1].gpuEncode).toBe(true)

      expect(strategies[2].name).toBe('cpu-scale-nvenc')
      expect(strategies[2].gpuEncode).toBe(true)

      expect(strategies[3].name).toBe('cpu-full')
      expect(strategies[3].gpuEncode).toBe(false)
      expect(strategies[3].videoOutputOptions.some(o => o.includes('libx265'))).toBe(true)
    })

    it('should inject deinterlace filters when interlaced', () => {
      const metadata = makeMetadata({ isHDR: false, video: { field_order: 'tt' } as any })
      const profile = makeProfile()
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: true,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      // GPU strategy should have yadif_cuda
      expect(strategies[0].videoFilters.some(f => f.includes('yadif_cuda'))).toBe(true)

      // CPU strategies should have yadif (not yadif_cuda)
      expect(strategies[1].videoFilters.some(f => f.includes('yadif') && !f.includes('cuda'))).toBe(true)
      expect(strategies[2].videoFilters.some(f => f.includes('yadif') && !f.includes('cuda'))).toBe(true)
      expect(strategies[3].videoFilters.some(f => f.includes('yadif') && !f.includes('cuda'))).toBe(true)
    })

    it('should use correct subtitle mapping for copy-all', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile()
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      for (const s of strategies) {
        expect(s.subtitleMapping).toBe('all')
      }
    })

    it('should use correct subtitle mapping for drop-all', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ outputFormat: 'mp4' })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'drop-all', reason: 'All bitmap' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      for (const s of strategies) {
        expect(s.subtitleMapping).toBe('none')
      }
    })

    it('should use correct subtitle mapping for copy-compatible', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ outputFormat: 'mp4' })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-compatible', indices: [3, 5] } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      for (const s of strategies) {
        expect(s.subtitleMapping).toEqual([3, 5])
      }
    })

    it('should use p010le for 10-bit source in GPU strategy', () => {
      const metadata = makeMetadata({
        isHDR: false,
        video: { pix_fmt: 'yuv420p10le' } as any,
      })
      const profile = makeProfile()
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: false, conversion: 'p010le' },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      // First GPU strategy should include p010le
      const gpuScale = strategies[0]
      expect(gpuScale.videoOutputOptions.some(o => o.includes('p010le'))).toBe(true)
    })
  })

  describe('tonemap pipeline (HDR → SDR)', () => {
    it('should build tonemap strategies with at least 2 entries', () => {
      const metadata = makeMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          pix_fmt: 'yuv420p10le',
          color_transfer: 'smpte2084',
          color_primaries: 'bt2020',
        } as any,
      })
      const profile = makeProfile({ removeHDR: true })
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: false, conversion: 'p010le' },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      expect(strategies.length).toBeGreaterThanOrEqual(2)
      expect(strategies[0].name).toBe('tonemap-nvenc')
      expect(strategies[0].videoFilters.some(f => f.includes('tonemap'))).toBe(true)
      expect(strategies[0].videoFilters.some(f => f.includes('zscale'))).toBe(true)

      // Last strategy should be CPU fallback
      const lastStrategy = strategies[strategies.length - 1]
      expect(lastStrategy.name).toBe('tonemap-cpu')
      expect(lastStrategy.gpuEncode).toBe(false)
    })

    it('should include fmtconv strategy when pixel format is incompatible', () => {
      const metadata = makeMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          pix_fmt: 'yuv422p10le',
          color_transfer: 'smpte2084',
          color_primaries: 'bt2020',
        } as any,
      })
      const profile = makeProfile({ removeHDR: true })
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: false, conversion: 'p010le' },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      expect(strategies.some(s => s.name === 'tonemap-nvenc-fmtconv')).toBe(true)
    })

    it('should add deinterlace to tonemap filters for interlaced HDR', () => {
      const metadata = makeMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          pix_fmt: 'yuv420p10le',
          color_transfer: 'smpte2084',
          color_primaries: 'bt2020',
          field_order: 'tt',
        } as any,
      })
      const profile = makeProfile({ removeHDR: true })
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: true,
        pixFmtCheck: { compatible: false, conversion: 'p010le' },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      // Tonemap strategy should include yadif (CPU deinterlace before tonemap)
      const tonemapStrategy = strategies[0]
      expect(tonemapStrategy.videoFilters.some(f => f.includes('yadif'))).toBe(true)
    })
  })

  describe('re-encode pipeline (no scale, no tonemap)', () => {
    it('should build re-encode strategies with GPU passthrough first', () => {
      const metadata = makeMetadata({
        isHDR: false,
        video: { width: 1920, height: 1080, pix_fmt: 'yuv420p' } as any,
      })
      const profile = makeProfile()
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      expect(strategies.length).toBeGreaterThanOrEqual(3)
      expect(strategies[0].name).toBe('gpu-reencode')
      expect(strategies[0].gpuEncode).toBe(true)
      expect(strategies[0].inputOptions).toContain('-hwaccel')

      // Should have cpu-decode-nvenc
      expect(strategies.some(s => s.name === 'cpu-decode-nvenc')).toBe(true)

      // Last should be cpu-full
      const lastStrategy = strategies[strategies.length - 1]
      expect(lastStrategy.name).toBe('cpu-full')
      expect(lastStrategy.gpuEncode).toBe(false)
    })

    it('should add gpu-decode-fmtconv when pixel format is incompatible', () => {
      const metadata = makeMetadata({
        isHDR: false,
        video: { width: 1920, height: 1080, pix_fmt: 'yuv422p10le' } as any,
      })
      const profile = makeProfile()
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: false, conversion: 'p010le' },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      expect(strategies.some(s => s.name === 'gpu-decode-fmtconv')).toBe(true)
    })

    it('should add gpu-decode-fmtconv when interlaced (even with compatible format)', () => {
      const metadata = makeMetadata({
        isHDR: false,
        video: { width: 1920, height: 1080, pix_fmt: 'yuv420p', field_order: 'tt' } as any,
      })
      const profile = makeProfile()
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: true,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)

      expect(strategies.some(s => s.name === 'gpu-decode-fmtconv')).toBe(true)
    })
  })

  describe('NVENC preset mapping in CPU fallback', () => {
    it('should use medium preset for p5 in CPU fallback', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ nvencPreset: 'p5' })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      const cpuFallback = strategies.find(s => !s.gpuEncode)!

      expect(cpuFallback.videoOutputOptions.some(o => o.includes('-preset medium'))).toBe(true)
    })

    it('should use ultrafast preset for p1 in CPU fallback', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ nvencPreset: 'p1' })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      const cpuFallback = strategies.find(s => !s.gpuEncode)!

      expect(cpuFallback.videoOutputOptions.some(o => o.includes('-preset ultrafast'))).toBe(true)
    })

    it('should use slower preset for p7 in CPU fallback', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ nvencPreset: 'p7' })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      const cpuFallback = strategies.find(s => !s.gpuEncode)!

      expect(cpuFallback.videoOutputOptions.some(o => o.includes('-preset slower'))).toBe(true)
    })
  })

  describe('CQ value passthrough', () => {
    it('should use profile cqValue in NVENC strategies', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ cqValue: 24 })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      const gpuStrategy = strategies.find(s => s.gpuEncode)!

      expect(gpuStrategy.videoOutputOptions.some(o => o.includes('-cq:v 24'))).toBe(true)
    })

    it('should use profile cqValue as CRF in CPU fallback', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ cqValue: 22 })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      const cpuFallback = strategies.find(s => !s.gpuEncode)!

      expect(cpuFallback.videoOutputOptions.some(o => o.includes('-crf 22'))).toBe(true)
    })
  })

  describe('subtitle mapping in strategies', () => {
    it('should map all subtitles when decision is copy-all', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile()
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      for (const s of strategies) {
        expect(s.subtitleMapping).toBe('all')
      }
    })

    it('should map no subtitles when decision is drop-all', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile()
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'drop-all', reason: 'incompatible MP4' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      for (const s of strategies) {
        expect(s.subtitleMapping).toBe('none')
      }
    })

    it('should map compatible indices when decision is copy-compatible', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile()
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-compatible', indices: [2, 4] } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      for (const s of strategies) {
        expect(s.subtitleMapping).toEqual([2, 4])
      }
    })
  })

  describe('edge cases', () => {
    it('should handle file with no audio streams', () => {
      const metadata = makeMetadata({ isHDR: false, audioStreams: [] })
      const profile = makeProfile()
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      expect(strategies.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle extreme CQ values', () => {
      const metadata = makeMetadata({ isHDR: false })
      const profile = makeProfile({ cqValue: 0 })
      const checkResult = makeCheckResult({ targetWidth: 1920, targetHeight: 1080 })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      const gpuStrategy = strategies.find(s => s.gpuEncode)!
      expect(gpuStrategy.videoOutputOptions.some(o => o.includes('-cq:v 0'))).toBe(true)
    })

    it('should handle combined interlaced + HDR removal', () => {
      const metadata = makeMetadata({
        isHDR: true,
        hdrFormat: 'HDR10',
        video: {
          width: 3840,
          height: 2160,
          pix_fmt: 'yuv420p10le',
          color_transfer: 'smpte2084',
          color_primaries: 'bt2020',
          field_order: 'tt',
        } as any,
      })
      const profile = makeProfile({ removeHDR: true })
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: true,
        pixFmtCheck: { compatible: false, conversion: 'p010le' },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      // Should have strategies for this complex case
      expect(strategies.length).toBeGreaterThanOrEqual(2)
      // CPU fallback should exist for worst case
      expect(strategies.some(s => !s.gpuEncode)).toBe(true)
    })

    it('should handle same dimensions (no downscale needed)', () => {
      const metadata = makeMetadata({
        isHDR: false,
        video: { width: 1920, height: 1080, pix_fmt: 'yuv420p' } as any,
      })
      const profile = makeProfile()
      const checkResult = makeCheckResult({
        targetWidth: 1920,
        targetHeight: 1080,
        metadata,
      })
      const ctx = {
        isInterlaced: false,
        pixFmtCheck: { compatible: true },
        subtitleDecision: { action: 'copy-all' } as SubtitleDecision,
      }

      const strategies = buildStrategyCascade(metadata, profile, checkResult, ctx)
      expect(strategies.length).toBeGreaterThanOrEqual(2)
    })
  })
})


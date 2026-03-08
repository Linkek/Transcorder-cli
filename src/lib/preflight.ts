import { execSync } from 'node:child_process';
import { logger } from './logger.js';
import type {
  VideoMetadata,
  CheckResult,
  Profile,
  TranscodeStrategy,
  PreflightResult,
  PreflightIssue,
  SubtitleDecision,
} from '../types/index.js';

// ─── Pixel formats NVENC can accept directly ────────────────────────────────

const NVENC_COMPATIBLE_FORMATS = new Set([
  'yuv420p', 'nv12', 'p010le', 'p010',
  'yuv444p', 'yuv444p16le',
  'bgr0', 'rgb0', 'cuda',
]);

// ─── Bitmap-based subtitle codecs (can't go in MP4/MOV containers) ──────────

const BITMAP_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'xsub',
]);

// ─── Containers that DON'T support bitmap subtitles ─────────────────────────

const NO_BITMAP_SUBS_CONTAINERS = new Set([
  'mp4', 'm4v', 'mov', 'webm',
]);

// ─── MP4-only subtitle codecs (only work in MP4/MOV containers) ─────────────

const MP4_ONLY_SUBTITLE_CODECS = new Set([
  'mov_text', 'tx3g',
]);

// ─── Containers that support MP4-native subtitle codecs ─────────────────────

const MP4_FAMILY_CONTAINERS = new Set([
  'mp4', 'm4v', 'mov',
]);

// ─── Interlaced field orders ────────────────────────────────────────────────

const INTERLACED_FIELD_ORDERS = new Set([
  'tt', 'bb', 'tb', 'bt',
]);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run full preflight analysis on a file before transcoding.
 * Detects edge cases, builds an ordered cascade of transcode strategies,
 * and optionally runs a short test encode to validate the GPU pipeline.
 */
export async function runPreflight(
  metadata: VideoMetadata,
  profile: Profile,
  checkResult: CheckResult,
): Promise<PreflightResult> {
  const issues: PreflightIssue[] = [];

  // ── Static analysis checks ──────────────────────────────────────────────
  const subtitleDecision = detectSubtitleIssues(metadata, profile.outputFormat);
  if (subtitleDecision.action === 'copy-compatible') {
    issues.push({
      type: 'subtitle-incompatible',
      severity: 'warning',
      message: `Some subtitle streams are incompatible with .${profile.outputFormat} — only compatible streams will be copied`,
      detail: `Keeping stream indices: ${subtitleDecision.indices.join(', ')}`,
    });
  } else if (subtitleDecision.action === 'drop-all') {
    issues.push({
      type: 'subtitle-incompatible',
      severity: 'warning',
      message: `All subtitle streams are incompatible with .${profile.outputFormat} — subtitles will be dropped`,
      detail: subtitleDecision.reason,
    });
  }

  const isInterlaced = detectInterlaced(metadata);
  if (isInterlaced) {
    issues.push({
      type: 'interlaced',
      severity: 'info',
      message: `Interlaced content detected (field_order: ${metadata.video.field_order}) — deinterlace filter will be applied`,
    });
  }

  const pixFmtCheck = checkPixelFormatCompatibility(metadata.video.pix_fmt);
  if (!pixFmtCheck.compatible) {
    issues.push({
      type: 'unusual-pixfmt',
      severity: 'warning',
      message: `Pixel format "${metadata.video.pix_fmt}" is not directly NVENC-compatible — will convert to ${pixFmtCheck.conversion}`,
    });
  }

  const dvProfile = detectDolbyVisionProfile(metadata);
  if (dvProfile !== null) {
    issues.push({
      type: 'dolby-vision-profile',
      severity: 'info',
      message: `Dolby Vision Profile ${dvProfile} detected`,
      detail: dvProfile === 5 ? 'MEL-only (no HDR10 base layer)' : `Profile ${dvProfile} with HDR10 base layer`,
    });
  }

  // ── File integrity check (fast — first 30s) ────────────────────────────
  const integrityResult = await checkFileIntegrity(metadata.filePath, metadata.duration);
  if (!integrityResult.healthy) {
    issues.push({
      type: 'corrupt-suspect',
      severity: 'warning',
      message: `Potential file corruption detected in first 30 seconds`,
      detail: integrityResult.errorAt !== undefined
        ? `Errors at ~${integrityResult.errorAt}s`
        : 'Decode errors found during integrity check',
    });
  }

  // ── Build strategy cascade ──────────────────────────────────────────────
  const strategies = buildStrategyCascade(
    metadata,
    profile,
    checkResult,
    { isInterlaced, pixFmtCheck, subtitleDecision },
  );

  // ── Test encode with preferred strategy ─────────────────────────────────
  const testedStrategies = await testStrategies(
    metadata.filePath,
    metadata.duration,
    strategies,
  );

  return {
    issues,
    strategies: testedStrategies,
    subtitleDecision,
    isInterlaced,
    dvProfile,
  };
}

// ─── Subtitle Compatibility ─────────────────────────────────────────────────

/**
 * Check if subtitle streams are compatible with the target container.
 * Bitmap-based subs (PGS, VOBSUB) can't go in MP4/MOV/WEBM.
 */
export function detectSubtitleIssues(
  metadata: VideoMetadata,
  outputFormat: string,
): SubtitleDecision {
  // If no subs, nothing to worry about
  if (metadata.subtitleStreams.length === 0) {
    return { action: 'copy-all' };
  }

  const format = outputFormat.toLowerCase();

  // Check each subtitle stream for compatibility with the target container
  const compatibleIndices: number[] = [];
  let hasIncompatible = false;

  for (const sub of metadata.subtitleStreams) {
    const codec = sub.codec_name.toLowerCase();

    // Bitmap subs can't go in MP4/MOV/WEBM
    if (BITMAP_SUBTITLE_CODECS.has(codec) && NO_BITMAP_SUBS_CONTAINERS.has(format)) {
      hasIncompatible = true;
      continue;
    }

    // MP4-only subtitle codecs (mov_text/tx3g) can only go in MP4/MOV
    if (MP4_ONLY_SUBTITLE_CODECS.has(codec) && !MP4_FAMILY_CONTAINERS.has(format)) {
      hasIncompatible = true;
      continue;
    }

    compatibleIndices.push(sub.index);
  }

  if (!hasIncompatible) {
    return { action: 'copy-all' };
  }

  if (compatibleIndices.length > 0) {
    return { action: 'copy-compatible', indices: compatibleIndices };
  }

  return {
    action: 'drop-all',
    reason: `All subtitle streams are incompatible with .${format}`,
  };
}

// ─── Interlace Detection ────────────────────────────────────────────────────

/**
 * Detect interlaced content from ffprobe field_order metadata.
 */
export function detectInterlaced(metadata: VideoMetadata): boolean {
  const fieldOrder = metadata.video.field_order?.toLowerCase();
  if (!fieldOrder) return false;
  return INTERLACED_FIELD_ORDERS.has(fieldOrder);
}

// ─── Pixel Format Compatibility ─────────────────────────────────────────────

/**
 * Check if a pixel format can be processed by NVENC directly.
 * Returns the conversion target format if not compatible.
 */
export function checkPixelFormatCompatibility(
  pixFmt?: string,
): { compatible: boolean; conversion?: string } {
  if (!pixFmt) return { compatible: true }; // Unknown format, let ffmpeg handle it

  const fmt = pixFmt.toLowerCase();

  if (NVENC_COMPATIBLE_FORMATS.has(fmt)) {
    return { compatible: true };
  }

  // 10-bit formats should convert to p010le
  if (fmt.includes('10le') || fmt.includes('10be') || fmt.includes('p010') || fmt.includes('10bit')) {
    return { compatible: false, conversion: 'p010le' };
  }

  // 12-bit or higher → convert to p010le (best quality loss compromise)
  if (fmt.includes('12le') || fmt.includes('12be') || fmt.includes('16le') || fmt.includes('16be')) {
    return { compatible: false, conversion: 'p010le' };
  }

  // Everything else → yuv420p
  return { compatible: false, conversion: 'yuv420p' };
}

// ─── Dolby Vision Profile Detection ────────────────────────────────────────

/**
 * Parse Dolby Vision configuration record from side_data_list.
 * Returns the DV profile number (5, 7, 8) or null.
 */
export function detectDolbyVisionProfile(metadata: VideoMetadata): number | null {
  if (!metadata.isHDR || metadata.hdrFormat !== 'Dolby Vision') return null;

  const sideData = metadata.video.side_data_list;
  if (!sideData) return null;

  for (const sd of sideData) {
    const sdType = (sd as Record<string, unknown>).side_data_type;
    if (typeof sdType === 'string' && sdType.toLowerCase().includes('dolby vision')) {
      // Try to extract dv_profile from the side data
      const dvProfile = (sd as Record<string, unknown>).dv_profile;
      if (typeof dvProfile === 'number') return dvProfile;
      // Some ffprobe versions embed it as dv_version_major/dv_profile
      const dvConfig = (sd as Record<string, unknown>).dv_version_major;
      if (dvConfig !== undefined) {
        const profile = (sd as Record<string, unknown>).dv_profile;
        if (typeof profile === 'number') return profile;
      }
    }
  }

  // Couldn't parse profile, return null (unknown)
  return null;
}

// ─── File Integrity Check ───────────────────────────────────────────────────

/**
 * Run a quick decode check on the first 30 seconds of the file.
 * Uses ffmpeg to decode without producing output, capturing errors.
 */
export async function checkFileIntegrity(
  filePath: string,
  duration: number,
): Promise<{ healthy: boolean; errorAt?: number }> {
  const checkDuration = Math.min(30, duration);
  if (checkDuration <= 0) return { healthy: true };

  try {
    // Decode first 30s, output to null — stderr will contain any decode errors
    const cmd = `ffmpeg -v error -i "${filePath}" -t ${checkDuration} -f null - 2>&1`;
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 60_000, // 60s timeout for the integrity check itself
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // If there's output on error-level logging, there are decode issues
    const errorLines = output.trim().split('\n').filter((l) => l.trim().length > 0);
    if (errorLines.length > 0) {
      logger.debug(`File integrity issues in ${filePath}: ${errorLines.length} error(s)`);
      return { healthy: false };
    }

    return { healthy: true };
  } catch (err) {
    // execSync throws if the command exits non-zero
    logger.debug(`File integrity check error for ${filePath}: ${(err as Error).message}`);
    return { healthy: false };
  }
}

// ─── Strategy Cascade Builder ───────────────────────────────────────────────

interface AnalysisContext {
  isInterlaced: boolean;
  pixFmtCheck: { compatible: boolean; conversion?: string };
  subtitleDecision: SubtitleDecision;
}

/**
 * Build an ordered cascade of transcode strategies based on the file's
 * characteristics and detected issues.
 */
export function buildStrategyCascade(
  metadata: VideoMetadata,
  profile: Profile,
  checkResult: CheckResult,
  ctx: AnalysisContext,
): TranscodeStrategy[] {
  const { targetWidth, targetHeight } = checkResult;
  const needsScale = metadata.video.width > targetWidth || metadata.video.height > targetHeight;
  const needsTonemap = metadata.isHDR && profile.removeHDR;

  const is10bit = metadata.video.pix_fmt &&
    (metadata.video.pix_fmt.includes('10le') || metadata.video.pix_fmt.includes('10be') || metadata.video.pix_fmt.includes('p010'));

  const subMapping = subtitleDecisionToMapping(ctx.subtitleDecision);

  // Common NVENC output options
  const nvencOpts = [
    `-c:v hevc_nvenc`,
    `-preset ${profile.nvencPreset}`,
    `-tune hq`,
    `-rc:v vbr`,
    `-cq:v ${profile.cqValue}`,
    '-b:v 0',
  ];

  // Common libx265 (CPU encode) output options
  const x265Opts = [
    `-c:v libx265`,
    `-preset ${nvencPresetToX265(profile.nvencPreset)}`,
    `-crf ${profile.cqValue}`,
  ];

  // Deinterlace filters
  const deintGpu = ctx.isInterlaced ? ['yadif_cuda=mode=send_frame:parity=auto:deint=interlaced'] : [];
  const deintCpu = ctx.isInterlaced ? ['yadif=mode=send_frame:parity=auto:deint=interlaced'] : [];

  const strategies: TranscodeStrategy[] = [];

  if (needsTonemap) {
    // ── Tonemap strategies ────────────────────────────────────────────────
    // Strategy 1: CPU tonemap filters + NVENC encode (current proven pipeline)
    const tonemapFilters = buildTonemapFilters(metadata, targetWidth, targetHeight, needsScale, ctx.isInterlaced);
    strategies.push({
      name: 'tonemap-nvenc',
      description: 'CPU tonemap (zscale + mobius) → NVENC encode',
      inputOptions: [],
      videoFilters: tonemapFilters,
      videoOutputOptions: [...nvencOpts, '-pix_fmt yuv420p'],
      subtitleMapping: subMapping,
      gpuEncode: true,
    });

    // Strategy 2: CPU tonemap with explicit pixel format conversion + NVENC
    if (!ctx.pixFmtCheck.compatible) {
      const tonemapFiltersAlt = [...tonemapFilters];
      if (!tonemapFiltersAlt.includes('format=yuv420p')) {
        tonemapFiltersAlt.push('format=yuv420p');
      }
      strategies.push({
        name: 'tonemap-nvenc-fmtconv',
        description: 'CPU tonemap with explicit format conversion → NVENC encode',
        inputOptions: [],
        videoFilters: tonemapFiltersAlt,
        videoOutputOptions: [...nvencOpts, '-pix_fmt yuv420p'],
        subtitleMapping: subMapping,
        gpuEncode: true,
      });
    }

    // Strategy 3: Full CPU tonemap + libx265 encode (last resort)
    strategies.push({
      name: 'tonemap-cpu',
      description: 'CPU tonemap → CPU encode (libx265) — slowest but most compatible',
      inputOptions: [],
      videoFilters: tonemapFilters,
      videoOutputOptions: [...x265Opts, '-pix_fmt yuv420p'],
      subtitleMapping: subMapping,
      gpuEncode: false,
    });

  } else if (needsScale) {
    // ── Scale strategies ──────────────────────────────────────────────────
    // Strategy 1: Full GPU pipeline (CUDA decode + scale_cuda + NVENC)
    strategies.push({
      name: 'gpu-scale',
      description: 'CUDA hwaccel → scale_cuda → NVENC encode (fastest)',
      inputOptions: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      videoFilters: [
        ...deintGpu,
        `scale_cuda=${targetWidth}:${targetHeight}:interp_algo=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      ],
      videoOutputOptions: [
        ...nvencOpts,
        ...(is10bit ? ['-pix_fmt p010le'] : []),
      ],
      subtitleMapping: subMapping,
      gpuEncode: true,
    });

    // Strategy 2: CUDA decode + CPU scale + NVENC encode
    strategies.push({
      name: 'gpu-decode-cpu-scale',
      description: 'CUDA hwaccel → CPU scale (lanczos) → NVENC encode',
      inputOptions: ['-hwaccel', 'cuda'],
      videoFilters: [
        ...deintCpu,
        `scale=${targetWidth}:${targetHeight}:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        'format=yuv420p',
      ],
      videoOutputOptions: [...nvencOpts],
      subtitleMapping: subMapping,
      gpuEncode: true,
    });

    // Strategy 3: Pure CPU decode + scale + NVENC encode
    strategies.push({
      name: 'cpu-scale-nvenc',
      description: 'CPU decode + scale → NVENC encode',
      inputOptions: [],
      videoFilters: [
        ...deintCpu,
        `scale=${targetWidth}:${targetHeight}:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        'format=yuv420p',
      ],
      videoOutputOptions: [...nvencOpts],
      subtitleMapping: subMapping,
      gpuEncode: true,
    });

    // Strategy 4: Full CPU pipeline (libx265) — last resort
    strategies.push({
      name: 'cpu-full',
      description: 'CPU decode + scale + libx265 encode — slowest but always works',
      inputOptions: [],
      videoFilters: [
        ...deintCpu,
        `scale=${targetWidth}:${targetHeight}:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2`,
        'format=yuv420p',
      ],
      videoOutputOptions: [...x265Opts, '-pix_fmt yuv420p'],
      subtitleMapping: subMapping,
      gpuEncode: false,
    });

  } else {
    // ── Re-encode only strategies ─────────────────────────────────────────
    // Strategy 1: Full GPU passthrough + NVENC
    strategies.push({
      name: 'gpu-reencode',
      description: 'CUDA hwaccel passthrough → NVENC encode',
      inputOptions: ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      videoFilters: [...deintGpu],
      videoOutputOptions: [
        ...nvencOpts,
        ...(is10bit ? ['-pix_fmt p010le'] : []),
      ],
      subtitleMapping: subMapping,
      gpuEncode: true,
    });

    // Strategy 2: GPU decode + explicit format conversion + NVENC
    if (!ctx.pixFmtCheck.compatible || ctx.isInterlaced) {
      strategies.push({
        name: 'gpu-decode-fmtconv',
        description: 'CUDA hwaccel → format conversion → NVENC encode',
        inputOptions: ['-hwaccel', 'cuda'],
        videoFilters: [...deintCpu, `format=${ctx.pixFmtCheck.conversion ?? 'yuv420p'}`],
        videoOutputOptions: [...nvencOpts],
        subtitleMapping: subMapping,
        gpuEncode: true,
      });
    }

    // Strategy 3: CPU decode + NVENC
    strategies.push({
      name: 'cpu-decode-nvenc',
      description: 'CPU decode → NVENC encode',
      inputOptions: [],
      videoFilters: [
        ...deintCpu,
        ...(ctx.pixFmtCheck.compatible ? [] : [`format=${ctx.pixFmtCheck.conversion ?? 'yuv420p'}`]),
      ],
      videoOutputOptions: [...nvencOpts],
      subtitleMapping: subMapping,
      gpuEncode: true,
    });

    // Strategy 4: Full CPU (libx265) — last resort
    strategies.push({
      name: 'cpu-full',
      description: 'CPU decode + libx265 encode — slowest but always works',
      inputOptions: [],
      videoFilters: [
        ...deintCpu,
        'format=yuv420p',
      ],
      videoOutputOptions: [...x265Opts, '-pix_fmt yuv420p'],
      subtitleMapping: subMapping,
      gpuEncode: false,
    });
  }

  return strategies;
}

// ─── Test Encode ────────────────────────────────────────────────────────────

/**
 * Run a short test encode (5 seconds) with the preferred strategy to validate
 * it works before committing to the full file. Re-orders the cascade based on
 * which strategies pass.
 */
async function testStrategies(
  filePath: string,
  duration: number,
  strategies: TranscodeStrategy[],
): Promise<TranscodeStrategy[]> {
  if (strategies.length <= 1) return strategies;

  const testDuration = Math.min(5, duration);
  if (testDuration <= 0) return strategies;

  // Test the preferred (first) strategy
  const preferred = strategies[0];
  const passed = await testEncode(filePath, preferred, testDuration);

  if (passed) {
    logger.debug(`Preflight test encode passed for strategy: ${preferred.name}`);
    return strategies; // Keep preferred order
  }

  logger.info(`Preflight: preferred strategy "${preferred.name}" failed test encode, trying alternatives...`);

  // Preferred failed — test the remaining strategies
  const working: TranscodeStrategy[] = [];
  const failed: TranscodeStrategy[] = [preferred];

  for (let i = 1; i < strategies.length; i++) {
    const strategy = strategies[i];

    // Don't test the CPU-only fallback — it always works
    if (!strategy.gpuEncode) {
      working.push(strategy);
      continue;
    }

    const ok = await testEncode(filePath, strategy, testDuration);
    if (ok) {
      logger.debug(`Preflight: strategy "${strategy.name}" passed test encode`);
      working.push(strategy);
    } else {
      logger.debug(`Preflight: strategy "${strategy.name}" failed test encode`);
      failed.push(strategy);
    }
  }

  if (working.length === 0) {
    logger.warn(`Preflight: all GPU strategies failed test encode — only CPU fallback remains`);
  }

  return working; // Failed strategies are excluded entirely
}

/**
 * Run a short test encode with a specific strategy.
 * Encodes ~5 seconds to /dev/null to validate the pipeline.
 */
export async function testEncode(
  filePath: string,
  strategy: TranscodeStrategy,
  testDuration: number,
): Promise<boolean> {
  try {
    const inputOpts = strategy.inputOptions.length > 0
      ? strategy.inputOptions.join(' ') + ' '
      : '';
    const filterOpts = strategy.videoFilters.length > 0
      ? `-vf "${strategy.videoFilters.join(',')}" `
      : '';
    const outputOpts = strategy.videoOutputOptions.join(' ');

    const cmd = `ffmpeg -y ${inputOpts}-i "${filePath}" -t ${testDuration} ${filterOpts}${outputOpts} -an -sn -f null /dev/null 2>&1`;

    logger.debug(`Preflight test encode: ${cmd.slice(0, 300)}...`);

    execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30_000, // 30s timeout for a 5s test encode
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return true;
  } catch (err) {
    const msg = (err as Error).message || '';
    logger.debug(`Test encode failed for ${strategy.name}: ${msg.slice(0, 200)}`);
    return false;
  }
}

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Build the tonemap filter chain (zscale → format → scale → tonemap → format).
 */
function buildTonemapFilters(
  metadata: VideoMetadata,
  targetWidth: number,
  targetHeight: number,
  needsScale: boolean,
  isInterlaced: boolean,
): string[] {
  const filters: string[] = [];

  // Deinterlace first if needed (before any color space operations)
  if (isInterlaced) {
    filters.push('yadif=mode=send_frame:parity=auto:deint=interlaced');
  }

  // Convert to linear light
  filters.push(
    'zscale=t=linear:npl=100',
    'format=gbrpf32le',
  );

  if (needsScale) {
    // Scale in linear light for correct HDR→SDR results
    if (metadata.video.width / targetWidth >= metadata.video.height / targetHeight) {
      filters.push(`scale=${targetWidth}:-2:flags=lanczos`);
    } else {
      filters.push(`scale=-2:${targetHeight}:flags=lanczos`);
    }
  }

  filters.push(
    'zscale=p=bt709',
    'tonemap=mobius:desat=2',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  );

  return filters;
}

/**
 * Convert an NVENC preset name to the closest libx265 preset.
 * NVENC: p1 (fastest) … p7 (slowest). libx265: ultrafast … veryslow.
 */
function nvencPresetToX265(nvencPreset: string): string {
  const map: Record<string, string> = {
    p1: 'ultrafast',
    p2: 'superfast',
    p3: 'veryfast',
    p4: 'faster',
    p5: 'medium',
    p6: 'slow',
    p7: 'slower',
  };
  return map[nvencPreset] ?? 'medium';
}

/**
 * Convert a SubtitleDecision to the mapping format used by TranscodeStrategy.
 */
function subtitleDecisionToMapping(decision: SubtitleDecision): 'all' | 'none' | number[] {
  switch (decision.action) {
    case 'copy-all': return 'all';
    case 'drop-all': return 'none';
    case 'copy-compatible': return decision.indices;
  }
}

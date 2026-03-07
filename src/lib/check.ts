import { probeFile, formatResolution } from './ffmpeg.js';
import { logger } from './logger.js';
import type { Profile, CheckResult, VideoMetadata } from '../types/index.js';

/**
 * Analyze a video file against a profile and determine if it needs transcoding.
 */
export async function analyzeFile(filePath: string, profile: Profile): Promise<CheckResult> {
  logger.debug(`Analyzing file: ${filePath}`);
  const metadata = await probeFile(filePath);

  const reasons: string[] = [];
  let needsTranscode = false;

  const { width, height } = metadata.video;
  const currentRes = formatResolution(width, height);

  // Check resolution
  if (width > profile.maxWidth || height > profile.maxHeight) {
    if (profile.downscaleToMax) {
      needsTranscode = true;
      reasons.push(
        `Resolution ${width}x${height} (${currentRes}) exceeds max ${profile.maxWidth}x${profile.maxHeight} — will downscale`,
      );
    } else {
      reasons.push(
        `Resolution ${width}x${height} (${currentRes}) exceeds max ${profile.maxWidth}x${profile.maxHeight} — downscaling disabled`,
      );
    }
  }

  // Check HDR
  if (metadata.isHDR && profile.removeHDR) {
    needsTranscode = true;
    reasons.push(`HDR detected (${metadata.hdrFormat ?? 'unknown format'}) — profile requires SDR`);
  }

  // Calculate target resolution (maintain aspect ratio)
  const { targetWidth, targetHeight } = calculateTargetResolution(
    width,
    height,
    profile.maxWidth,
    profile.maxHeight,
    profile.downscaleToMax,
  );

  if (!needsTranscode) {
    reasons.push('File meets all criteria — no transcoding needed');
  }

  const result: CheckResult = {
    needsTranscode,
    reasons,
    metadata,
    targetWidth,
    targetHeight,
  };

  logger.debug(
    `Analysis result for ${metadata.fileName}: ${needsTranscode ? 'NEEDS TRANSCODE' : 'SKIP'}`,
    reasons,
  );

  return result;
}

/**
 * Calculate target resolution while maintaining aspect ratio.
 * Rounds down to nearest even number (required by most encoders).
 */
export function calculateTargetResolution(
  srcWidth: number,
  srcHeight: number,
  maxWidth: number,
  maxHeight: number,
  downscaleToMax = true,
): { targetWidth: number; targetHeight: number } {
  // If already within limits or downscaling is disabled, keep original
  if (!downscaleToMax || (srcWidth <= maxWidth && srcHeight <= maxHeight)) {
    return { targetWidth: srcWidth, targetHeight: srcHeight };
  }

  const aspectRatio = srcWidth / srcHeight;

  let targetWidth: number;
  let targetHeight: number;

  // Scale based on which dimension exceeds the limit more
  if (srcWidth / maxWidth > srcHeight / maxHeight) {
    targetWidth = maxWidth;
    targetHeight = Math.round(maxWidth / aspectRatio);
  } else {
    targetHeight = maxHeight;
    targetWidth = Math.round(maxHeight * aspectRatio);
  }

  // Ensure even dimensions (required by video encoders)
  targetWidth = targetWidth - (targetWidth % 2);
  targetHeight = targetHeight - (targetHeight % 2);

  // Guard against zero dimensions from extreme aspect ratios
  if (targetWidth < 2) targetWidth = 2;
  if (targetHeight < 2) targetHeight = 2;

  return { targetWidth, targetHeight };
}

/**
 * Quick check if a file should be transcoded (without full analysis).
 */
export async function shouldTranscode(filePath: string, profile: Profile): Promise<boolean> {
  const result = await analyzeFile(filePath, profile);
  return result.needsTranscode;
}

/**
 * Print a human-readable analysis of a video file.
 */
export function formatAnalysis(result: CheckResult): string {
  const { metadata, needsTranscode, reasons, targetWidth, targetHeight } = result;
  const lines: string[] = [];

  lines.push(`File:       ${metadata.fileName}`);
  lines.push(`Resolution: ${metadata.video.width}x${metadata.video.height} (${formatResolution(metadata.video.width, metadata.video.height)})`);
  lines.push(`Codec:      ${metadata.video.codec_name}`);
  lines.push(`HDR:        ${metadata.isHDR ? `Yes (${metadata.hdrFormat})` : 'No'}`);
  lines.push(`Duration:   ${Math.floor(metadata.duration / 60)}m ${Math.floor(metadata.duration % 60)}s`);
  lines.push(`Audio:      ${metadata.audioStreams.length} stream(s) [${metadata.audioStreams.map((a) => a.codec_name).join(', ')}]`);
  lines.push(`Subtitles:  ${metadata.subtitleStreams.length} stream(s)`);
  lines.push(`File size:  ${(metadata.fileSize / (1024 * 1024)).toFixed(1)} MB`);
  lines.push('');
  lines.push(`Transcode:  ${needsTranscode ? 'YES' : 'NO (skip)'}`);
  if (needsTranscode) {
    lines.push(`Target:     ${targetWidth}x${targetHeight} (${formatResolution(targetWidth, targetHeight)})`);
  }
  for (const reason of reasons) {
    lines.push(`  → ${reason}`);
  }

  return lines.join('\n');
}

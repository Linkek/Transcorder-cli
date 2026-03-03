import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import path from 'node:path';
import { moveFile } from './utils.js';
import { logger } from './logger.js';
import { formatResolution, formatFileSize } from './ffmpeg.js';
import { buildOutputFileName } from './utils.js';
import type { Profile, CheckResult, TranscodeProgress } from '../types/index.js';

export interface TranscodeCallbacks {
  onProgress?: (progress: TranscodeProgress) => void;
  onStart?: (command: string) => void;
  onEnd?: (outputPath: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Transcode a video file according to the profile settings.
 * Returns the path to the transcoded file in the cache folder.
 */
export function transcode(
  checkResult: CheckResult,
  profile: Profile,
  callbacks?: TranscodeCallbacks,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { metadata, targetWidth, targetHeight } = checkResult;
    const { filePath, fileName } = metadata;

    // Determine if HDR is being removed (source has HDR and profile wants to remove it)
    const hdrBeingRemoved = metadata.isHDR && profile.removeHDR;

    // Build output filename using utility function
    const outputFileName = buildOutputFileName({
      fileName,
      targetWidth,
      targetHeight,
      outputFormat: profile.outputFormat,
      renameFiles: profile.renameFiles,
      removeHDR: hdrBeingRemoved,
    });

    // Ensure cache folder exists
    const cacheDir = path.resolve(profile.cacheFolder);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const outputPath = path.join(cacheDir, outputFileName);

    // Remove existing cache file if present
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    logger.debug(`Transcoding: ${filePath} → ${outputPath}`);
    logger.debug(`Target: ${targetWidth}x${targetHeight}, HDR removal: ${metadata.isHDR && profile.removeHDR}`);

    // Build the ffmpeg command
    const cmd = ffmpeg(filePath);

    // ── Video filters ──────────────────────────────────────────────────────
    const needsScale = metadata.video.width > targetWidth || metadata.video.height > targetHeight;
    const needsTonemap = metadata.isHDR && profile.removeHDR;

    if (needsTonemap) {
      // HDR→SDR: must go through CPU filters for tonemap, then back to NVENC
      // Use zscale + tonemap pipeline
      const filters: string[] = [];

      if (needsScale) {
        filters.push(`scale=${targetWidth}:${targetHeight}:flags=lanczos`);
      }

      filters.push(
        'zscale=t=linear:npl=100',
        'format=gbrpf32le',
        'zscale=p=bt709',
        'tonemap=hable:desat=0',
        'zscale=t=bt709:m=bt709:r=tv',
        'format=yuv420p',
      );

      cmd
        .videoFilters(filters)
        .outputOptions([
          `-c:v hevc_nvenc`,
          `-preset ${profile.nvencPreset}`,
          `-tune hq`,
          `-rc:v vbr`,
          `-cq:v ${profile.cqValue}`,
          '-b:v 0',
          '-pix_fmt yuv420p',
        ]);
    } else if (needsScale) {
      // Scale only — use CUDA hardware scaling
      cmd
        .inputOptions(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'])
        .videoFilters([
          `scale_cuda=${targetWidth}:${targetHeight}:interp_algo=lanczos`,
        ])
        .outputOptions([
          `-c:v hevc_nvenc`,
          `-preset ${profile.nvencPreset}`,
          `-tune hq`,
          `-rc:v vbr`,
          `-cq:v ${profile.cqValue}`,
          '-b:v 0',
        ]);
    } else {
      // No scale, no tonemap — re-encode only
      // Use hwaccel for decoding but let FFmpeg handle format conversion
      cmd
        .inputOptions(['-hwaccel', 'cuda'])
        .outputOptions([
          `-c:v hevc_nvenc`,
          `-preset ${profile.nvencPreset}`,
          `-tune hq`,
          `-rc:v vbr`,
          `-cq:v ${profile.cqValue}`,
          '-b:v 0',
        ]);
    }

    // ── Audio: copy all streams ─────────────────────────────────────────────
    cmd.outputOptions([
      '-map 0:v:0',   // First video stream
      '-map 0:a?',    // All audio streams (? = don't fail if none)
      '-map 0:s?',    // All subtitle streams
      '-c:a copy',    // Copy audio as-is
      '-c:s copy',    // Copy subtitles as-is
    ]);

    // ── Preserve original frame rate ────────────────────────────────────────
    if (metadata.video.frame_rate && metadata.video.frame_rate > 0) {
      const fps = metadata.video.frame_rate;
      logger.debug(`Preserving frame rate: ${fps.toFixed(3)} fps`);
      cmd.outputOptions([`-r ${fps}`]);
    }

    // ── Metadata ────────────────────────────────────────────────────────────
    cmd.outputOptions([
      '-map_metadata 0',           // Copy global metadata
      '-movflags +faststart',      // Web-friendly (for MP4)
    ]);

    cmd.output(outputPath);

    // ── Progress tracking ───────────────────────────────────────────────────
    let startTime = Date.now();

    cmd.on('start', (commandLine) => {
      startTime = Date.now();
      logger.debug(`FFmpeg command: ${commandLine}`);
      callbacks?.onStart?.(commandLine);
    });

    cmd.on('progress', (progress) => {
      const percent = progress.percent ?? 0;
      const elapsed = (Date.now() - startTime) / 1000;
      const eta = percent > 0 ? (elapsed / percent) * (100 - percent) : 0;

      const tp: TranscodeProgress = {
        percent: Math.min(100, Math.max(0, percent)),
        fps: progress.currentFps ?? 0,
        speed: parseFloat(String(progress.currentKbps ?? 0)),
        eta,
        currentSize: progress.targetSize ? progress.targetSize * 1024 : 0,
        timemark: progress.timemark ?? '00:00:00',
      };

      callbacks?.onProgress?.(tp);
    });

    cmd.on('end', () => {
      logger.debug(`Transcode complete: ${outputPath}`);
      callbacks?.onEnd?.(outputPath);
      resolve(outputPath);
    });

    cmd.on('error', (err) => {
      logger.error(`Transcode failed: ${err.message}`);
      callbacks?.onError?.(err);
      reject(err);
    });

    cmd.run();
  });
}

/**
 * Replace the original file with the transcoded version.
 * Moves the cache file to the original directory with the updated filename.
 */
export function replaceOriginal(
  originalPath: string,
  cachePath: string,
): string {
  const originalDir = path.dirname(originalPath);
  const newFileName = path.basename(cachePath);
  const newPath = path.join(originalDir, newFileName);

  logger.debug(`Replacing: ${originalPath} → ${newPath}`);

  // If new path is different from original, remove original first
  if (newPath !== originalPath && fs.existsSync(originalPath)) {
    fs.unlinkSync(originalPath);
    logger.debug(`Deleted original: ${originalPath}`);
  }

  // Move cache file to original location (handles cross-device moves)
  moveFile(cachePath, newPath);
  logger.debug(`Moved cache file to: ${newPath}`);

  return newPath;
}

/**
 * Dry-run: show what would happen without actually transcoding.
 */
export function dryRun(checkResult: CheckResult, profile: Profile): string {
  const { metadata, targetWidth, targetHeight, needsTranscode, reasons } = checkResult;
  const lines: string[] = [];

  lines.push('═══ DRY RUN ═══');
  lines.push(`Input:      ${metadata.filePath}`);
  lines.push(`Resolution: ${metadata.video.width}x${metadata.video.height} → ${targetWidth}x${targetHeight}`);
  lines.push(`HDR:        ${metadata.isHDR ? `${metadata.hdrFormat} → ${profile.removeHDR ? 'SDR (will tone-map)' : 'keep'}` : 'No'}`);
  lines.push(`Codec:      ${metadata.video.codec_name} → hevc (NVENC)`);
  lines.push(`Audio:      ${metadata.audioStreams.length} stream(s) → copy`);
  lines.push(`Subtitles:  ${metadata.subtitleStreams.length} stream(s) → copy`);
  lines.push(`Profile:    ${profile.name} (preset: ${profile.nvencPreset}, cq: ${profile.cqValue})`);
  lines.push('');

  if (!needsTranscode) {
    lines.push('Result: SKIP — file already meets criteria');
  } else {
    const hdrBeingRemoved = metadata.isHDR && profile.removeHDR;
    const outputFileName = buildOutputFileName({
      fileName: metadata.fileName,
      targetWidth,
      targetHeight,
      outputFormat: profile.outputFormat,
      renameFiles: profile.renameFiles,
      removeHDR: hdrBeingRemoved,
    });

    lines.push(`Result: TRANSCODE`);

    if (profile.replaceFile) {
      lines.push(`Output: ${path.join(path.dirname(metadata.filePath), outputFileName)} (replaces original)`);
    } else if (profile.outputFolder) {
      lines.push(`Output: ${path.join(profile.outputFolder, outputFileName)}`);
    } else {
      lines.push(`Output: ${path.join(path.dirname(metadata.filePath), outputFileName)} (alongside source)`);
    }
  }

  lines.push('');
  lines.push('Reasons:');
  for (const reason of reasons) {
    lines.push(`  → ${reason}`);
  }

  return lines.join('\n');
}

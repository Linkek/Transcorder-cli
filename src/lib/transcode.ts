import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import path from 'node:path';
import { moveFile, formatFileSize, buildOutputFileName } from './utils.js';
import { logger } from './logger.js';
import { formatResolution } from './ffmpeg.js';
import type { Profile, CheckResult, TranscodeProgress } from '../types/index.js';

export interface TranscodeCallbacks {
  onProgress?: (progress: TranscodeProgress) => void;
  onStart?: (command: string) => void;
  onEnd?: (outputPath: string) => void;
  onError?: (error: Error) => void;
}

export interface TranscodeHandle {
  /** Promise that resolves with the output path on completion */
  promise: Promise<string>;
  /** Kill the ffmpeg process immediately */
  kill: () => void;
}

/**
 * Transcode a video file according to the profile settings.
 * Returns a handle with the promise and a kill function to abort.
 *
 * For files that need scaling (non-HDR), uses GPU-first with automatic CPU fallback:
 *   1. Try the proven GPU pipeline (scale_cuda) — fast
 *   2. If ffmpeg fails with a filter/format error, retry with CPU scaling — universal compat
 * All other paths (tonemap, re-encode only) run single-attempt as they already work reliably.
 */
export function transcode(
  checkResult: CheckResult,
  profile: Profile,
  callbacks?: TranscodeCallbacks,
): TranscodeHandle {
  let cmd: ReturnType<typeof ffmpeg> | undefined;
  const kill = () => { cmd?.kill('SIGKILL'); };

  const promise = new Promise<string>((resolve, reject) => {
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

    // ── Video filters ──────────────────────────────────────────────────────
    const needsScale = metadata.video.width > targetWidth || metadata.video.height > targetHeight;
    const needsTonemap = metadata.isHDR && profile.removeHDR;

    /**
     * Build an ffmpeg command for a given scale strategy.
     * 'gpu' = scale_cuda (original proven pipeline)
     * 'cpu' = software scale (fallback for edge-case codecs/formats)
     * null  = not a scale job (tonemap or re-encode only)
     */
    const buildCommand = (scaleStrategy: 'gpu' | 'cpu' | null) => {
      const c = ffmpeg(filePath);

      if (needsTonemap) {
        // HDR→SDR: must go through CPU filters for tonemap, then back to NVENC
        // Use zscale + tonemap pipeline
        const filters: string[] = [];

        // Convert to linear light first, then scale, then tonemap
        // Scaling must happen in linear light for correct results with HDR content
        filters.push(
          'zscale=t=linear:npl=100',
          'format=gbrpf32le',
        );

        if (needsScale) {
          // Scale in linear light — use -2 for auto-calculated dimension to preserve AR
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

        c
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
      } else if (needsScale && scaleStrategy === 'gpu') {
        // ── Original proven GPU scale pipeline ──────────────────────────────
        // Scale only — use CUDA hardware scaling
        // force_original_aspect_ratio=decrease fits within target box preserving aspect ratio
        // force_divisible_by=2 ensures even dimensions (required by encoders)
        const is10bit = metadata.video.pix_fmt &&
          (metadata.video.pix_fmt.includes('10le') || metadata.video.pix_fmt.includes('10be') || metadata.video.pix_fmt.includes('p010'));

        c
          .inputOptions(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'])
          .videoFilters([
            `scale_cuda=${targetWidth}:${targetHeight}:interp_algo=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2`,
          ])
          .outputOptions([
            `-c:v hevc_nvenc`,
            `-preset ${profile.nvencPreset}`,
            `-tune hq`,
            `-rc:v vbr`,
            `-cq:v ${profile.cqValue}`,
            '-b:v 0',
            ...(is10bit ? ['-pix_fmt p010le'] : []),
          ]);
      } else if (needsScale && scaleStrategy === 'cpu') {
        // ── CPU scale fallback ──────────────────────────────────────────────
        // For edge-case codecs/formats where scale_cuda fails with filter errors.
        // CUDA decode auto-downloads frames to CPU; software lanczos; NVENC encodes.
        // Slower but universally compatible.
        c
          .inputOptions(['-hwaccel', 'cuda'])
          .videoFilters([
            `scale=${targetWidth}:${targetHeight}:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2`,
            'format=yuv420p',
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
        // Keep frames on GPU to avoid CPU-side pixel format conversion issues
        const is10bit = metadata.video.pix_fmt &&
          (metadata.video.pix_fmt.includes('10le') || metadata.video.pix_fmt.includes('10be') || metadata.video.pix_fmt.includes('p010'));

        c
          .inputOptions(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'])
          .outputOptions([
            `-c:v hevc_nvenc`,
            `-preset ${profile.nvencPreset}`,
            `-tune hq`,
            `-rc:v vbr`,
            `-cq:v ${profile.cqValue}`,
            '-b:v 0',
            ...(is10bit ? ['-pix_fmt p010le'] : []),
          ]);
      }

      // ── Audio: copy all streams ───────────────────────────────────────────
      c.outputOptions([
        '-map 0:v:0',   // First video stream
        '-map 0:a?',    // All audio streams (? = don't fail if none)
        '-map 0:s?',    // All subtitle streams
        '-c:a copy',    // Copy audio as-is
        '-c:s copy',    // Copy subtitles as-is
      ]);

      // ── Preserve original frame rate ──────────────────────────────────────
      if (metadata.video.frame_rate && metadata.video.frame_rate > 0) {
        const fps = metadata.video.frame_rate;
        logger.debug(`Preserving frame rate: ${fps.toFixed(3)} fps`);
        c.outputOptions([`-r ${fps}`]);
      }

      // ── Metadata ──────────────────────────────────────────────────────────
      c.outputOptions([
        '-map_metadata 0',           // Copy global metadata
        '-movflags +faststart',      // Web-friendly (for MP4)
      ]);

      c.output(outputPath);
      return c;
    };

    /** Wire up progress/start/end/error events on an ffmpeg command */
    const attachEvents = (
      c: ReturnType<typeof ffmpeg>,
      onDone: (out: string) => void,
      onFail: (err: Error) => void,
    ) => {
      let startTime = Date.now();

      c.on('start', (commandLine) => {
        startTime = Date.now();
        logger.debug(`FFmpeg command: ${commandLine}`);
        callbacks?.onStart?.(commandLine);
      });

      c.on('progress', (progress) => {
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

      c.on('end', () => onDone(outputPath));
      c.on('error', (err) => onFail(err));
    };

    // ── Execution with optional GPU→CPU fallback for scale jobs ─────────────
    const canFallback = needsScale && !needsTonemap;

    if (canFallback) {
      // GPU-first: try scale_cuda, auto-retry with CPU scale on filter errors
      cmd = buildCommand('gpu');

      attachEvents(
        cmd,
        (out) => {
          logger.debug(`Transcode complete (GPU scale): ${out}`);
          callbacks?.onEnd?.(out);
          resolve(out);
        },
        (err) => {
          const msg = err.message.toLowerCase();
          const isFilterError = msg.includes('filter') || msg.includes('auto_scale')
            || msg.includes('impossible to convert') || msg.includes('invalid argument');

          if (!isFilterError) {
            logger.error(`Transcode failed: ${err.message}`);
            callbacks?.onError?.(err);
            reject(err);
            return;
          }

          // Filter error → retry with CPU scaling
          logger.info(`GPU scale failed for ${fileName}, retrying with CPU scale...`);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

          cmd = buildCommand('cpu');
          attachEvents(
            cmd,
            (out) => {
              logger.debug(`Transcode complete (CPU scale fallback): ${out}`);
              callbacks?.onEnd?.(out);
              resolve(out);
            },
            (retryErr) => {
              logger.error(`Transcode failed (CPU fallback): ${retryErr.message}`);
              callbacks?.onError?.(retryErr);
              reject(retryErr);
            },
          );
          cmd.run();
        },
      );
    } else {
      // Single-attempt paths: tonemap or re-encode only (no fallback needed)
      cmd = buildCommand(null);

      attachEvents(
        cmd,
        (out) => {
          logger.debug(`Transcode complete: ${out}`);
          callbacks?.onEnd?.(out);
          resolve(out);
        },
        (err) => {
          logger.error(`Transcode failed: ${err.message}`);
          callbacks?.onError?.(err);
          reject(err);
        },
      );
    }

    cmd.run();
  });

  return { promise, kill };
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

  // Move cache file first to avoid data loss if move fails
  // (if original is deleted first and move fails, both files are lost)
  if (newPath === originalPath) {
    // Same path: write to temp, remove original, rename temp
    const tmpPath = newPath + '.tmp';
    moveFile(cachePath, tmpPath);
    fs.unlinkSync(originalPath);
    fs.renameSync(tmpPath, newPath);
  } else {
    // Different paths: move cache to destination, then remove original
    moveFile(cachePath, newPath);
    if (fs.existsSync(originalPath)) {
      fs.unlinkSync(originalPath);
      logger.debug(`Deleted original: ${originalPath}`);
    }
  }
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

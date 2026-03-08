import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import path from 'node:path';
import { moveFile, formatFileSize, buildOutputFileName } from './utils.js';
import { logger } from './logger.js';
import { formatResolution } from './ffmpeg.js';
import type { Profile, CheckResult, TranscodeProgress, PreflightResult, TranscodeStrategy } from '../types/index.js';

export interface TranscodeCallbacks {
  onProgress?: (progress: TranscodeProgress) => void;
  onStart?: (command: string) => void;
  onEnd?: (outputPath: string) => void;
  onError?: (error: Error) => void;
  /** Called when the transcode falls back to an alternative strategy */
  onStrategySwitch?: (fromStrategy: string, toStrategy: string, reason: string) => void;
}

export interface TranscodeHandle {
  /** Promise that resolves with the output path on completion */
  promise: Promise<string>;
  /** Kill the ffmpeg process immediately */
  kill: () => void;
}

/**
 * Transcode a video file using the preflight-determined strategy cascade.
 * Tries each strategy in order until one succeeds or all fail.
 *
 * When a preflight result is provided, uses its strategy cascade.
 * Without preflight (legacy path), falls back to the original GPU→CPU approach.
 */
export function transcode(
  checkResult: CheckResult,
  profile: Profile,
  callbacks?: TranscodeCallbacks,
  preflightResult?: PreflightResult,
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

    // ── Strategy-driven execution ──────────────────────────────────────────

    if (preflightResult && preflightResult.strategies.length > 0) {
      // Use the preflight strategy cascade
      executeStrategyCascade(
        filePath, outputPath, metadata, profile, preflightResult.strategies,
        callbacks, cmd, (c) => { cmd = c; }, resolve, reject,
      );
    } else {
      // Legacy path (no preflight result) — use original GPU→CPU approach
      executeLegacy(
        filePath, outputPath, metadata, profile, checkResult,
        callbacks, cmd, (c) => { cmd = c; }, resolve, reject,
      );
    }
  });

  return { promise, kill };
}

// ─── Strategy-driven execution ──────────────────────────────────────────────

/**
 * Build an ffmpeg command from a TranscodeStrategy object.
 */
function buildCommandFromStrategy(
  filePath: string,
  outputPath: string,
  metadata: { video: { frame_rate?: number } },
  strategy: TranscodeStrategy,
): ReturnType<typeof ffmpeg> {
  const c = ffmpeg(filePath);

  // Input options (hwaccel etc.)
  if (strategy.inputOptions.length > 0) {
    c.inputOptions(strategy.inputOptions);
  }

  // Video filters
  if (strategy.videoFilters.length > 0) {
    c.videoFilters(strategy.videoFilters);
  }

  // Video output options (encoder, preset, quality)
  c.outputOptions(strategy.videoOutputOptions);

  // ── Stream mapping ──────────────────────────────────────────────────────
  const mapOpts = ['-map 0:v:0', '-map 0:a?', '-c:a copy'];

  if (strategy.subtitleMapping === 'all') {
    mapOpts.push('-map 0:s?', '-c:s copy');
  } else if (strategy.subtitleMapping === 'none') {
    // No subtitle mapping — drop all subs
  } else {
    // Map specific subtitle streams by absolute index
    for (const idx of strategy.subtitleMapping) {
      mapOpts.push(`-map 0:${idx}`);
    }
    if (strategy.subtitleMapping.length > 0) {
      mapOpts.push('-c:s copy');
    }
  }

  c.outputOptions(mapOpts);

  // ── Preserve original frame rate ────────────────────────────────────────
  if (metadata.video.frame_rate && metadata.video.frame_rate > 0) {
    const fps = metadata.video.frame_rate;
    logger.debug(`Preserving frame rate: ${fps.toFixed(3)} fps`);
    c.outputOptions([`-r ${fps}`]);
  }

  // ── Metadata ────────────────────────────────────────────────────────────
  c.outputOptions(['-map_metadata 0', '-movflags +faststart']);

  c.output(outputPath);
  return c;
}

/** Wire up progress/start/end/error events on an ffmpeg command */
function attachEvents(
  c: ReturnType<typeof ffmpeg>,
  outputPath: string,
  callbacks: TranscodeCallbacks | undefined,
  onDone: (out: string) => void,
  onFail: (err: Error) => void,
) {
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
}

/**
 * Execute strategies in cascade order. On failure, clean up and try next.
 */
function executeStrategyCascade(
  filePath: string,
  outputPath: string,
  metadata: CheckResult['metadata'],
  profile: Profile,
  strategies: TranscodeStrategy[],
  callbacks: TranscodeCallbacks | undefined,
  _cmd: ReturnType<typeof ffmpeg> | undefined,
  setCmd: (c: ReturnType<typeof ffmpeg>) => void,
  resolve: (path: string) => void,
  reject: (err: Error) => void,
  strategyIndex = 0,
): void {
  if (strategyIndex >= strategies.length) {
    reject(new Error('All transcode strategies exhausted — file cannot be transcoded'));
    return;
  }

  const strategy = strategies[strategyIndex];
  const isFirstAttempt = strategyIndex === 0;
  const isLastStrategy = strategyIndex === strategies.length - 1;

  if (!isFirstAttempt) {
    const prevStrategy = strategies[strategyIndex - 1];
    logger.info(`Strategy cascade: "${prevStrategy.name}" → "${strategy.name}" (${strategy.description})`);
    callbacks?.onStrategySwitch?.(prevStrategy.name, strategy.name, strategy.description);
  } else {
    logger.debug(`Using strategy: ${strategy.name} (${strategy.description})`);
  }

  const c = buildCommandFromStrategy(filePath, outputPath, metadata, strategy);
  setCmd(c);

  attachEvents(
    c,
    outputPath,
    callbacks,
    (out) => {
      logger.debug(`Transcode complete (${strategy.name}): ${out}`);
      callbacks?.onEnd?.(out);
      resolve(out);
    },
    (err) => {
      if (isLastStrategy) {
        // Last strategy — no more fallbacks
        logger.error(`Transcode failed (${strategy.name}, final strategy): ${err.message}`);
        callbacks?.onError?.(err);
        reject(err);
        return;
      }

      // Clean up partial output and try the next strategy
      logger.warn(`Transcode failed (${strategy.name}): ${err.message} — trying next strategy...`);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

      executeStrategyCascade(
        filePath, outputPath, metadata, profile, strategies,
        callbacks, _cmd, setCmd, resolve, reject,
        strategyIndex + 1,
      );
    },
  );

  c.run();
}

// ─── Legacy execution path (backward compatible) ────────────────────────────

/**
 * Original GPU→CPU fallback logic for when no preflight result is provided.
 * Kept for backward compatibility with direct transcode() calls.
 */
function executeLegacy(
  filePath: string,
  outputPath: string,
  metadata: CheckResult['metadata'],
  profile: Profile,
  checkResult: CheckResult,
  callbacks: TranscodeCallbacks | undefined,
  _cmd: ReturnType<typeof ffmpeg> | undefined,
  setCmd: (c: ReturnType<typeof ffmpeg>) => void,
  resolve: (path: string) => void,
  reject: (err: Error) => void,
): void {
  const { targetWidth, targetHeight } = checkResult;
  const needsScale = metadata.video.width > targetWidth || metadata.video.height > targetHeight;
  const needsTonemap = metadata.isHDR && profile.removeHDR;

  /**
   * Build an ffmpeg command for a given scale strategy (legacy).
   */
  const buildCommand = (scaleStrategy: 'gpu' | 'cpu' | null) => {
    const c = ffmpeg(filePath);

    if (needsTonemap) {
      const filters: string[] = [];
      filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le');
      if (needsScale) {
        if (metadata.video.width / targetWidth >= metadata.video.height / targetHeight) {
          filters.push(`scale=${targetWidth}:-2:flags=lanczos`);
        } else {
          filters.push(`scale=-2:${targetHeight}:flags=lanczos`);
        }
      }
      filters.push('zscale=p=bt709', 'tonemap=mobius:desat=2', 'zscale=t=bt709:m=bt709:r=tv', 'format=yuv420p');
      c.videoFilters(filters).outputOptions([
        `-c:v hevc_nvenc`, `-preset ${profile.nvencPreset}`, `-tune hq`,
        `-rc:v vbr`, `-cq:v ${profile.cqValue}`, '-b:v 0', '-pix_fmt yuv420p',
      ]);
    } else if (needsScale && scaleStrategy === 'gpu') {
      const is10bit = metadata.video.pix_fmt &&
        (metadata.video.pix_fmt.includes('10le') || metadata.video.pix_fmt.includes('10be') || metadata.video.pix_fmt.includes('p010'));
      c.inputOptions(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'])
        .videoFilters([`scale_cuda=${targetWidth}:${targetHeight}:interp_algo=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2`])
        .outputOptions([
          `-c:v hevc_nvenc`, `-preset ${profile.nvencPreset}`, `-tune hq`,
          `-rc:v vbr`, `-cq:v ${profile.cqValue}`, '-b:v 0',
          ...(is10bit ? ['-pix_fmt p010le'] : []),
        ]);
    } else if (needsScale && scaleStrategy === 'cpu') {
      c.inputOptions(['-hwaccel', 'cuda'])
        .videoFilters([
          `scale=${targetWidth}:${targetHeight}:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2`,
          'format=yuv420p',
        ])
        .outputOptions([
          `-c:v hevc_nvenc`, `-preset ${profile.nvencPreset}`, `-tune hq`,
          `-rc:v vbr`, `-cq:v ${profile.cqValue}`, '-b:v 0',
        ]);
    } else {
      const is10bit = metadata.video.pix_fmt &&
        (metadata.video.pix_fmt.includes('10le') || metadata.video.pix_fmt.includes('10be') || metadata.video.pix_fmt.includes('p010'));
      c.inputOptions(['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'])
        .outputOptions([
          `-c:v hevc_nvenc`, `-preset ${profile.nvencPreset}`, `-tune hq`,
          `-rc:v vbr`, `-cq:v ${profile.cqValue}`, '-b:v 0',
          ...(is10bit ? ['-pix_fmt p010le'] : []),
        ]);
    }

    c.outputOptions(['-map 0:v:0', '-map 0:a?', '-map 0:s?', '-c:a copy', '-c:s copy']);
    if (metadata.video.frame_rate && metadata.video.frame_rate > 0) {
      c.outputOptions([`-r ${metadata.video.frame_rate}`]);
    }
    c.outputOptions(['-map_metadata 0', '-movflags +faststart']);
    c.output(outputPath);
    return c;
  };

  const canFallback = needsScale && !needsTonemap;

  if (canFallback) {
    const c = buildCommand('gpu');
    setCmd(c);

    attachEvents(c, outputPath, callbacks,
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

        logger.info(`GPU scale failed for ${metadata.fileName}, retrying with CPU scale...`);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

        const c2 = buildCommand('cpu');
        setCmd(c2);
        attachEvents(c2, outputPath, callbacks,
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
        c2.run();
      },
    );
    c.run();
  } else {
    const c = buildCommand(null);
    setCmd(c);

    attachEvents(c, outputPath, callbacks,
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
    c.run();
  }
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

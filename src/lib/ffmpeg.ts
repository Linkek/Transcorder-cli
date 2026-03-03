import ffmpeg from 'fluent-ffmpeg';
import { logger } from './logger.js';
import type { VideoMetadata, VideoStream, AudioStream, SubtitleStream } from '../types/index.js';
import path from 'node:path';
import fs from 'node:fs';

// ─── Probe a video file ─────────────────────────────────────────────────────

export function probeFile(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        reject(new Error(`ffprobe failed for ${filePath}: ${err.message}`));
        return;
      }

      // Find video stream
      const rawVideo = data.streams.find((s) => s.codec_type === 'video');
      if (!rawVideo) {
        reject(new Error(`No video stream found in ${filePath}`));
        return;
      }

      // Parse frame rate from r_frame_rate (e.g., "24000/1001" → 23.976)
      let frameRate: number | undefined;
      const rFrameRate = (rawVideo as Record<string, unknown>).r_frame_rate as string | undefined;
      const avgFrameRate = (rawVideo as Record<string, unknown>).avg_frame_rate as string | undefined;
      const fpsStr = rFrameRate || avgFrameRate;
      if (fpsStr && fpsStr.includes('/')) {
        const [num, den] = fpsStr.split('/').map(Number);
        if (den > 0) frameRate = num / den;
      } else if (fpsStr) {
        frameRate = parseFloat(fpsStr);
      }

      const video: VideoStream = {
        index: rawVideo.index,
        codec_name: rawVideo.codec_name ?? 'unknown',
        codec_long_name: rawVideo.codec_long_name,
        width: rawVideo.width ?? 0,
        height: rawVideo.height ?? 0,
        frame_rate: frameRate,
        duration: rawVideo.duration ? parseFloat(String(rawVideo.duration)) : undefined,
        bit_rate: rawVideo.bit_rate ? parseInt(String(rawVideo.bit_rate), 10) : undefined,
        color_transfer: (rawVideo as Record<string, unknown>).color_transfer as string | undefined,
        color_primaries: (rawVideo as Record<string, unknown>).color_primaries as string | undefined,
        color_space: (rawVideo as Record<string, unknown>).color_space as string | undefined,
        pix_fmt: rawVideo.pix_fmt,
        side_data_list: (rawVideo as Record<string, unknown>).side_data_list as unknown[] | undefined,
      };

      // Detect HDR
      const { isHDR, hdrFormat } = detectHDR(video);

      // Audio streams
      const audioStreams: AudioStream[] = data.streams
        .filter((s) => s.codec_type === 'audio')
        .map((s) => ({
          index: s.index,
          codec_name: s.codec_name ?? 'unknown',
          codec_long_name: s.codec_long_name,
          channels: s.channels ?? 2,
          channel_layout: s.channel_layout,
          sample_rate: s.sample_rate != null ? String(s.sample_rate) : undefined,
          bit_rate: s.bit_rate ? parseInt(String(s.bit_rate), 10) : undefined,
        }));

      // Subtitle streams
      const subtitleStreams: SubtitleStream[] = data.streams
        .filter((s) => s.codec_type === 'subtitle')
        .map((s) => ({
          index: s.index,
          codec_name: s.codec_name ?? 'unknown',
          codec_long_name: s.codec_long_name,
          language: s.tags?.language,
        }));

      const stats = fs.statSync(filePath);
      const duration =
        (data.format.duration ? parseFloat(String(data.format.duration)) : 0) ||
        (video.duration ?? 0);

      const metadata: VideoMetadata = {
        filePath,
        fileName: path.basename(filePath),
        fileSize: stats.size,
        container: path.extname(filePath).slice(1).toLowerCase(),
        duration,
        video,
        audioStreams,
        subtitleStreams,
        isHDR,
        hdrFormat,
      };

      resolve(metadata);
    });
  });
}

// ─── HDR Detection ──────────────────────────────────────────────────────────

export function detectHDR(video: VideoStream): { isHDR: boolean; hdrFormat?: string } {
  // PQ (HDR10, HDR10+, Dolby Vision)
  if (video.color_transfer === 'smpte2084') {
    // Check for Dolby Vision side data
    const hasDV = video.side_data_list?.some(
      (sd: Record<string, unknown>) =>
        typeof sd.side_data_type === 'string' &&
        sd.side_data_type.toLowerCase().includes('dolby vision'),
    );
    if (hasDV) return { isHDR: true, hdrFormat: 'Dolby Vision' };

    // Check for HDR10+ dynamic metadata
    const hasHDR10Plus = video.side_data_list?.some(
      (sd: Record<string, unknown>) =>
        typeof sd.side_data_type === 'string' &&
        sd.side_data_type.toLowerCase().includes('hdr10+'),
    );
    if (hasHDR10Plus) return { isHDR: true, hdrFormat: 'HDR10+' };

    return { isHDR: true, hdrFormat: 'HDR10' };
  }

  // HLG
  if (video.color_transfer === 'arib-std-b67') {
    return { isHDR: true, hdrFormat: 'HLG' };
  }

  // Check by pixel format (10-bit + BT.2020 = likely HDR)
  if (
    video.color_primaries === 'bt2020' &&
    video.pix_fmt &&
    (video.pix_fmt.includes('10le') || video.pix_fmt.includes('10be') || video.pix_fmt.includes('p010'))
  ) {
    return { isHDR: true, hdrFormat: 'HDR (BT.2020 10-bit)' };
  }

  return { isHDR: false };
}

// ─── Check NVENC availability ───────────────────────────────────────────────

export function checkNvencAvailable(): Promise<{ available: boolean; encoders: string[] }> {
  return new Promise((resolve) => {
    const proc = ffmpeg()
      .addOption('-encoders')
      .output('/dev/null')
      .on('error', () => {
        // ffmpeg -encoders exits with an error code but still outputs
      });

    // Use a different approach: just run ffmpeg -encoders and parse output
    const { execSync } = require('node:child_process');
    try {
      const output = execSync('ffmpeg -encoders 2>/dev/null || true', { encoding: 'utf-8' });
      const nvencEncoders: string[] = [];

      for (const line of output.split('\n')) {
        if (line.includes('nvenc')) {
          const match = line.match(/^\s*V\S*\s+(\S+)/);
          if (match) nvencEncoders.push(match[1]);
        }
      }

      resolve({
        available: nvencEncoders.length > 0,
        encoders: nvencEncoders,
      });
    } catch {
      resolve({ available: false, encoders: [] });
    }
  });
}

// ─── Check ffmpeg availability ──────────────────────────────────────────────

export function checkFfmpegAvailable(): boolean {
  const { execSync } = require('node:child_process');
  try {
    execSync('ffmpeg -version 2>/dev/null', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

// ─── Format helpers ─────────────────────────────────────────────────────────

export function formatResolution(width: number, height: number): string {
  if (height >= 2160 || width >= 3840) return '4K';
  if (height >= 1440 || width >= 2560) return '1440p';
  if (height >= 1080 || width >= 1920) return '1080p';
  if (height >= 720 || width >= 1280) return '720p';
  if (height >= 480 || width >= 854) return '480p';
  return `${width}x${height}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

import fs from 'node:fs';
import path from 'node:path';
import { formatResolution } from './ffmpeg.js';

export interface OutputFileNameOptions {
  /** Original filename (with extension) */
  fileName: string;
  /** Target width in pixels */
  targetWidth: number;
  /** Target height in pixels */
  targetHeight: number;
  /** Output format extension (without dot), e.g. "mkv", "mp4" */
  outputFormat: string;
  /** Whether to rename files with resolution tags */
  renameFiles: boolean;
  /** Whether HDR is being removed (to strip HDR tags from filename) */
  removeHDR?: boolean;
}

// Common release tags to strip from filenames (order matters - more specific first)
const RELEASE_TAGS = [
  // HDR formats (most specific first)
  'HDR10\\+', 'HDR10', 'HDR', 'DV', 'DoVi', 'Dolby[\\s\\._-]*Vision', 'HLG',
  // Resolution (handled separately but included for completeness)
  '4k', '2160p', '1440p', '1080p', '720p', '480p', '576p', '576i', '480i',
  // Source/Quality
  'UHD', 'BluRay', 'Blu-Ray', 'BDRip', 'BRRip', 'BD[\\s\\._-]?Remux', 'Remux',
  'WEB-DL', 'WEBDL', 'WEBRip', 'WEB', 'HDTV', 'DVDRip', 'DVD', 'SDTV',
  'CAM', 'HDCAM', 'TS', 'TELESYNC', 'TC', 'TELECINE', 'SCR', 'SCREENER',
  'R5', 'DVDScr', 'DVDR', 'DSR', 'SATRip', 'VHSRip', 'PPV', 'PDTV',
  // Codecs
  'x264', 'x265', 'H\\.?264', 'H\\.?265', 'HEVC', 'AVC', 'XviD', 'DivX',
  'MPEG-?2', 'MPEG-?4', 'VC-?1', 'VP9', 'AV1',
  // Audio codecs & formats
  'DTS-HD[\\s\\._-]?MA', 'DTS-HD', 'DTS-X', 'DTS', 'TrueHD', 'Atmos',
  'DDP[\\s\\._-]?5[\\s\\._-]?1', 'DDP[\\s\\._-]?7[\\s\\._-]?1', 'DDP[\\s\\._-]?2[\\s\\._-]?0', 'DDP',
  'DD[\\s\\._-]?5\\.1', 'DD[\\s\\._-]?7\\.1', 'DD[\\s\\._-]?2\\.0', 'DD\\+', 'DD',
  'EAC3', 'E-AC-?3', 'AC3',
  'AAC[\\s\\._-]?2\\.0', 'AAC[\\s\\._-]?5\\.1', 'AAC', 'FLAC', 'LPCM', 'PCM',
  'MP3', 'OGG', 'Opus',
  '7\\.1', '5\\.1', '2\\.0', '2\\.1',
  // Streaming services
  'AMZN', 'AMAZON', 'NF', 'NETFLIX', 'DSNP', 'DISNEY\\+?', 'HMAX', 'HBO[\\s\\._-]?MAX',
  'ATVP', 'APPLE[\\s\\._-]?TV\\+?', 'PCOK', 'PEACOCK', 'PMTP', 'PARAMOUNT\\+?',
  'HULU', 'STAN', 'iT', 'iTunes', 'VUDU', 'MA', 'CRAV', 'CRAVE',
  // Quality/Edition tags
  'PROPER', 'REPACK', 'RERIP', 'REAL', 'INTERNAL', 'LIMITED', 'EXTENDED',
  'UNRATED', 'UNCUT', 'DC', 'DIRECTORS[\\s\\._-]?CUT', 'THEATRICAL', 'IMAX',
  'REMASTERED', 'RESTORED', 'CRITERION', 'OPEN[\\s\\._-]?MATTE',
  // 3D
  '3D', 'HSBS', 'HOU', 'SBS',
  // Bit depth
  '10bit', '10-bit', '8bit', '8-bit', '12bit', '12-bit',
  // Misc technical
  'HYBRID', 'AI[\\s\\._-]?UPSCALE', 'UPSCALED?',
  // Common scene tags
  'SUBBED', 'DUBBED', 'DUAL[\\s\\._-]?AUDIO', 'MULTI', 'MULTi',
  'HC', 'HARDCODED', 'HARDCODE',
];

// Build a single regex from all tags (with word boundaries)
const RELEASE_TAGS_PATTERN = new RegExp(
  `(?<=[\\s\\._-]|^)(${RELEASE_TAGS.join('|')})(?=[\\s\\._-]|$)`,
  'gi'
);

// Release group pattern - only match clear release group indicators:
// e.g., -SPARKS, -YTS at the very end after typical scene naming
// Must be: dash followed by 3-12 uppercase letters/numbers at end of string
const RELEASE_GROUP_PATTERN = /-[A-Z0-9]{3,12}$/i;

// Bracketed content like [YTS.MX], (2020), etc.
const RELEASE_GROUP_BRACKET_PATTERN = /\s*[\[\(][^\]\)]+[\]\)]\s*/g;

/**
 * Build the output filename based on profile settings.
 *
 * If renameFiles is true:
 * - Removes all release tags (resolution, codec, source, audio, HDR, etc.)
 * - Removes release group names
 * - Appends the target resolution tag
 *
 * @example
 * buildOutputFileName({
 *   fileName: 'Movie.2160p.BluRay.HEVC.HDR.DTS-GROUP.mkv',
 *   targetWidth: 1920,
 *   targetHeight: 1080,
 *   outputFormat: 'mkv',
 *   renameFiles: true,
 *   removeHDR: true,
 * }) // => 'Movie-1080p.mkv'
 */
export function buildOutputFileName(options: OutputFileNameOptions): string {
  const { fileName, targetWidth, targetHeight, outputFormat, renameFiles } = options;

  const srcExt = path.extname(fileName);
  const baseName = path.basename(fileName, srcExt);
  const outExt = `.${outputFormat}`;

  if (renameFiles) {
    const targetRes = formatResolution(targetWidth, targetHeight).toLowerCase();
    
    let cleanName = baseName;
    
    // Remove bracketed content first (e.g., [YTS.MX], (2020), etc.)
    cleanName = cleanName.replace(RELEASE_GROUP_BRACKET_PATTERN, ' ');
    
    // Remove all release tags (multiple passes to catch nested tags)
    let prevName = '';
    while (prevName !== cleanName) {
      prevName = cleanName;
      cleanName = cleanName.replace(RELEASE_TAGS_PATTERN, '');
    }
    
    // Remove trailing release group (e.g., -SPARKS)
    cleanName = cleanName.replace(RELEASE_GROUP_PATTERN, '');
    
    // Clean up separators: replace dots/underscores with spaces, normalize
    cleanName = cleanName
      .replace(/[._]/g, ' ')           // Convert . and _ to spaces
      .replace(/-+/g, ' ')             // Convert dashes to spaces (but keep single for compound words)
      .replace(/\s+/g, ' ')            // Collapse multiple spaces
      .trim();
    
    // If the name is empty after cleaning, use a fallback
    if (!cleanName) {
      cleanName = 'video';
    }
    
    return `${cleanName}-${targetRes}${outExt}`;
  }

  return `${baseName}${outExt}`;
}

/**
 * Clean a filename by removing all release tags.
 * Useful for normalization before comparison.
 */
export function cleanFileName(name: string): string {
  let cleanName = name;
  
  // Remove bracketed content
  cleanName = cleanName.replace(RELEASE_GROUP_BRACKET_PATTERN, ' ');
  
  // Remove all release tags
  let prevName = '';
  while (prevName !== cleanName) {
    prevName = cleanName;
    cleanName = cleanName.replace(RELEASE_TAGS_PATTERN, '');
  }
  
  // Remove trailing release group
  cleanName = cleanName.replace(RELEASE_GROUP_PATTERN, '');
  
  // Clean up
  return cleanName
    .replace(/[._]/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract resolution tag from a filename if present.
 */
export function extractResolutionTag(name: string): string | null {
  const match = name.match(/[\.\-_\s]*(4k|2160p|1440p|1080p|720p|480p)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Move a file from source to destination, handling cross-device moves
 * by falling back to copy + delete when fs.renameSync fails with EXDEV.
 */
export function moveFile(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EXDEV') {
      // Cross-device move: copy then delete, with size verification
      fs.copyFileSync(src, dest);
      const srcSize = fs.statSync(src).size;
      const destSize = fs.statSync(dest).size;
      if (srcSize !== destSize) {
        // Copy was incomplete — remove corrupt destination and throw
        try { fs.unlinkSync(dest); } catch { /* best effort */ }
        throw new Error(`Cross-device copy failed: size mismatch (src=${srcSize}, dest=${destSize})`);
      }
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
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

/**
 * Calculate the percentage reduction between original and transcoded file size.
 * Returns a positive value if the file got smaller, negative if it grew.
 */
export function calculateReductionPercent(originalSize: number, transcodedSize: number): number {
  return ((originalSize - transcodedSize) / originalSize) * 100;
}

/**
 * Determine whether a transcode should be skipped due to insufficient size reduction.
 * Returns true if the reduction is below the minimum threshold (i.e., should skip).
 */
export function shouldSkipDueToSizeReduction(
  originalSize: number,
  transcodedSize: number,
  minSizeReduction: number,
): boolean {
  if (minSizeReduction <= 0) return false;
  const reductionPercent = calculateReductionPercent(originalSize, transcodedSize);
  return reductionPercent < minSizeReduction;
}

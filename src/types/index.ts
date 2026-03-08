// ─── Global Configuration ────────────────────────────────────────────────────

export interface GlobalConfig {
  /** Enable the web UI dashboard (default: false) */
  webui: boolean;
  /** Port for the web UI server (default: 9800) */
  webuiPort: number;
  /** Username for web UI login */
  webuiUsername: string;
  /** Password for web UI login */
  webuiPassword: string;
  /** If true, requests from localhost skip authentication (default: true) */
  localAllow: boolean;
  /** If true, the queue starts paused on daemon startup (default: false) */
  pauseOnStartup: boolean;
  /** Number of concurrent transcode workers (default: 2) */
  workers: number;
  /** Hours between automatic folder rescans (0 = disabled, default: 24) */
  rescanIntervalHours: number;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  webui: false,
  webuiPort: 9800,
  webuiUsername: 'admin',
  webuiPassword: 'transcorder',
  localAllow: true,
  pauseOnStartup: false,
  workers: 2,
  rescanIntervalHours: 24,
};

// ─── Profile Configuration ───────────────────────────────────────────────────

export interface Profile {
  /** Unique name for this profile */
  name: string;
  /** Folders to watch for video files (string or array of strings) */
  sourceFolders: string[];
  /** Whether to recurse into subdirectories when scanning/watching */
  recursive: boolean;
  /** If true, replace the original file. If false, save alongside source or to outputFolder */
  replaceFile: boolean;
  /** Output folder for transcoded files (used when replaceFile is false; omit to save alongside source) */
  outputFolder?: string;
  /** Output container format (e.g. "mkv", "mp4") */
  outputFormat: string;
  /** Temporary folder for transcoding output */
  cacheFolder: string;
  /** Maximum allowed width — files wider than this get transcoded */
  maxWidth: number;
  /** Maximum allowed height — files taller than this get transcoded */
  maxHeight: number;
  /** Whether to downscale videos that exceed maxWidth/maxHeight */
  downscaleToMax: boolean;
  /** Whether to add/update resolution tag in the filename */
  renameFiles: boolean;
  /** Whether to tone-map HDR to SDR */
  removeHDR: boolean;
  /** NVENC preset (p1=fastest … p7=slowest/best quality) */
  nvencPreset: string;
  /** Constant quality value for NVENC (lower = better quality, bigger file) */
  cqValue: number;
  /** Enable file logging to logs/ folder */
  log: boolean;
  /** Processing priority (higher number = higher priority, default 5) */
  priority: number;
  /** Minimum size reduction percentage required (0-100, e.g. 2 means 2% smaller) */
  minSizeReduction: number;
}

// ─── Video Metadata ─────────────────────────────────────────────────────────

export interface VideoStream {
  index: number;
  codec_name: string;
  codec_long_name?: string;
  width: number;
  height: number;
  /** Frame rate as a decimal (e.g., 23.976, 29.97, 60) */
  frame_rate?: number;
  duration?: number;
  bit_rate?: number;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  pix_fmt?: string;
  /** Field order: 'progressive', 'tt', 'bb', 'tb', 'bt' etc. Used for interlace detection. */
  field_order?: string;
  /** Sample aspect ratio (e.g., "1:1", "32:27") */
  sample_aspect_ratio?: string;
  /** Display aspect ratio (e.g., "16:9", "4:3") */
  display_aspect_ratio?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  side_data_list?: any[];
}

export interface AudioStream {
  index: number;
  codec_name: string;
  codec_long_name?: string;
  channels: number;
  channel_layout?: string;
  sample_rate?: string;
  bit_rate?: number;
}

export interface SubtitleStream {
  index: number;
  codec_name: string;
  codec_long_name?: string;
  language?: string;
}

export interface VideoMetadata {
  filePath: string;
  fileName: string;
  fileSize: number;
  container: string;
  duration: number;
  video: VideoStream;
  audioStreams: AudioStream[];
  subtitleStreams: SubtitleStream[];
  isHDR: boolean;
  hdrFormat?: string;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'checking' | 'preflight' | 'transcoding' | 'replacing' | 'completed' | 'failed' | 'skipped';

export interface Job {
  id: number;
  sourcePath: string;
  outputPath: string | null;
  status: JobStatus;
  profileName: string;
  priority: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  // Metadata fields (joined from source_metadata)
  width?: number;
  height?: number;
  isHDR?: boolean;
  codec?: string;
  duration?: number;
  fileSize?: number;
}

// ─── Check Result ───────────────────────────────────────────────────────────

export interface CheckResult {
  needsTranscode: boolean;
  reasons: string[];
  metadata: VideoMetadata;
  targetWidth: number;
  targetHeight: number;
}

// ─── Transcode Progress ─────────────────────────────────────────────────────

export interface TranscodeProgress {
  percent: number;
  fps: number;
  speed: number;
  eta: number; // seconds
  currentSize: number; // bytes
  timemark: string;
}

// ─── Log Levels ─────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ─── Video file extensions ──────────────────────────────────────────────────

export const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.ts', '.flv', '.mpg', '.mpeg',
]);

// ─── Preflight & Strategy Types ─────────────────────────────────────────────

/** Describes which subtitle streams to map in the output */
export type SubtitleDecision =
  | { action: 'copy-all' }
  | { action: 'copy-compatible'; indices: number[] }
  | { action: 'drop-all'; reason: string };

/** A detected issue that the preflight system found */
export interface PreflightIssue {
  type:
    | 'subtitle-incompatible'
    | 'interlaced'
    | 'unusual-pixfmt'
    | 'dolby-vision-profile'
    | 'corrupt-suspect'
    | 'nvenc-unsupported-input';
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Extra data depending on type */
  detail?: string;
}

/** A single transcode strategy to attempt, in priority order */
export interface TranscodeStrategy {
  /** Human-readable name for this strategy */
  name: string;
  /** Description of what this strategy does differently */
  description: string;
  /** hwaccel input options (e.g. ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']) */
  inputOptions: string[];
  /** Video filter chain (e.g. ['scale_cuda=...']) */
  videoFilters: string[];
  /** Output options for video encoding (e.g. ['-c:v hevc_nvenc', ...]) */
  videoOutputOptions: string[];
  /** Subtitle stream mapping: indices of subtitle streams to include, or 'all' | 'none' */
  subtitleMapping: 'all' | 'none' | number[];
  /** Whether this strategy uses GPU encoding (false = libx265 CPU) */
  gpuEncode: boolean;
}

/** Result of running the preflight analysis */
export interface PreflightResult {
  /** All detected issues/warnings about the file */
  issues: PreflightIssue[];
  /** Ordered list of strategies to try (first = preferred) */
  strategies: TranscodeStrategy[];
  /** How to handle subtitle streams */
  subtitleDecision: SubtitleDecision;
  /** Whether deinterlace filter was injected */
  isInterlaced: boolean;
  /** Dolby Vision profile number if detected, null otherwise */
  dvProfile: number | null;
}

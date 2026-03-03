import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import type { Profile } from '../types/index.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'profiles.json');

/**
 * Load all profiles from config/profiles.json.
 */
export function loadProfiles(): Profile[] {
  if (!fs.existsSync(CONFIG_PATH)) {
    logger.error(`Config file not found: ${CONFIG_PATH}`);
    logger.info('Run "transcorder config init" to create a default config.');
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  // Strip single-line comments (// ...) to support JSONC
  const stripped = raw.replace(/\/\/.*$/gm, '');
  let profiles: Profile[];

  try {
    profiles = JSON.parse(stripped);
  } catch (e) {
    logger.error(`Failed to parse config file: ${(e as Error).message}`);
    process.exit(1);
  }

  if (!Array.isArray(profiles) || profiles.length === 0) {
    logger.error('Config file must contain a non-empty array of profiles.');
    process.exit(1);
  }

  // Validate and resolve paths
  for (const profile of profiles) {
    // Normalize sourceFolders: accept string or string[]
    if (typeof profile.sourceFolders === 'string') {
      profile.sourceFolders = [profile.sourceFolders];
    }

    const errors = validateProfile(profile);
    if (errors.length > 0) {
      logger.error(`Invalid profile "${profile.name}":`);
      for (const err of errors) logger.error(`  → ${err}`);
      process.exit(1);
    }

    // Resolve relative paths against project root
    profile.sourceFolders = profile.sourceFolders.map((f) =>
      path.isAbsolute(f) ? f : path.resolve(PROJECT_ROOT, f),
    );
    profile.cacheFolder = path.isAbsolute(profile.cacheFolder)
      ? profile.cacheFolder
      : path.resolve(PROJECT_ROOT, profile.cacheFolder);
    if (profile.outputFolder) {
      profile.outputFolder = path.isAbsolute(profile.outputFolder)
        ? profile.outputFolder
        : path.resolve(PROJECT_ROOT, profile.outputFolder);
    }
  }

  logger.debug(`Loaded ${profiles.length} profile(s) from ${CONFIG_PATH}`);
  return profiles;
}

/**
 * Get a specific profile by name.
 */
export function getProfile(name: string): Profile | undefined {
  const profiles = loadProfiles();
  return profiles.find((p) => p.name === name);
}

/**
 * Validate a profile object.
 */
export function validateProfile(profile: Partial<Profile>): string[] {
  const errors: string[] = [];

  if (!profile.name || typeof profile.name !== 'string') {
    errors.push('Missing or invalid "name"');
  }
  if (!Array.isArray(profile.sourceFolders) || profile.sourceFolders.length === 0) {
    errors.push('Missing or empty "sourceFolders" (string or array of strings)');
  }
  if (typeof profile.recursive !== 'boolean') {
    errors.push('Missing or invalid "recursive" (must be a boolean)');
  }
  if (typeof profile.replaceFile !== 'boolean') {
    errors.push('Missing or invalid "replaceFile" (must be a boolean)');
  }
  if (profile.outputFolder !== undefined && typeof profile.outputFolder !== 'string') {
    errors.push('Invalid "outputFolder" (must be a string)');
  }
  if (!profile.outputFormat || typeof profile.outputFormat !== 'string') {
    errors.push('Missing or invalid "outputFormat" (e.g. "mkv", "mp4")');
  }
  if (!profile.cacheFolder || typeof profile.cacheFolder !== 'string') {
    errors.push('Missing or invalid "cacheFolder"');
  }
  if (typeof profile.maxWidth !== 'number' || profile.maxWidth < 1) {
    errors.push('Missing or invalid "maxWidth" (must be a positive number)');
  }
  if (typeof profile.maxHeight !== 'number' || profile.maxHeight < 1) {
    errors.push('Missing or invalid "maxHeight" (must be a positive number)');
  }
  if (typeof profile.downscaleToMax !== 'boolean') {
    errors.push('Missing or invalid "downscaleToMax" (must be a boolean)');
  }
  if (typeof profile.renameFiles !== 'boolean') {
    errors.push('Missing or invalid "renameFiles" (must be a boolean)');
  }
  if (typeof profile.removeHDR !== 'boolean') {
    errors.push('Missing or invalid "removeHDR" (must be a boolean)');
  }
  if (!profile.nvencPreset || typeof profile.nvencPreset !== 'string') {
    errors.push('Missing or invalid "nvencPreset"');
  }
  if (typeof profile.cqValue !== 'number' || profile.cqValue < 0 || profile.cqValue > 51) {
    errors.push('Missing or invalid "cqValue" (must be 0-51)');
  }
  if (typeof profile.log !== 'boolean') {
    errors.push('Missing or invalid "log" (must be a boolean)');
  }
  if (typeof profile.priority !== 'number' || profile.priority < 1 || profile.priority > 10) {
    errors.push('Missing or invalid "priority" (must be 1-10)');
  }
  if (typeof profile.minSizeReduction !== 'number' || profile.minSizeReduction < 0 || profile.minSizeReduction > 100) {
    errors.push('Missing or invalid "minSizeReduction" (must be 0-100)');
  }

  return errors;
}

/**
 * Create a default config file.
 */
export function initConfig(): void {
  const configDir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  if (fs.existsSync(CONFIG_PATH)) {
    logger.warn(`Config already exists: ${CONFIG_PATH}`);
    return;
  }

  const defaultProfiles: Profile[] = [
    {
      name: 'test',
      sourceFolders: ['input'],
      recursive: true,
      replaceFile: false,
      outputFolder: 'output',
      outputFormat: 'mkv',
      cacheFolder: 'cache',
      maxWidth: 1920,
      maxHeight: 1080,
      downscaleToMax: true,
      renameFiles: true,
      removeHDR: true,
      nvencPreset: 'p4',
      cqValue: 23,
      log: true,
      priority: 5,
      minSizeReduction: 0,
    },
  ];

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultProfiles, null, 2) + '\n');
  logger.success(`Created default config: ${CONFIG_PATH}`);
}

/**
 * Format profiles into a human-readable string.
 */
export function formatProfiles(profiles: Profile[]): string {
  const lines: string[] = [];

  for (const p of profiles) {
    lines.push(`Profile: ${p.name}`);
    lines.push(`  Source folders: ${p.sourceFolders.join(', ')}`);
    lines.push(`  Recursive:     ${p.recursive ? 'yes' : 'no'}`);
    lines.push(`  Replace file:  ${p.replaceFile ? 'yes' : 'no'}`);
    if (p.outputFolder) {
      lines.push(`  Output folder: ${p.outputFolder}`);
    }
    lines.push(`  Output format: ${p.outputFormat}`);
    lines.push(`  Cache folder:  ${p.cacheFolder}`);
    lines.push(`  Max resolution: ${p.maxWidth}x${p.maxHeight}`);
    lines.push(`  Downscale:     ${p.downscaleToMax ? 'yes' : 'no'}`);
    lines.push(`  Rename files:  ${p.renameFiles ? 'yes' : 'no'}`);
    lines.push(`  Remove HDR:    ${p.removeHDR ? 'yes' : 'no'}`);
    lines.push(`  NVENC preset:  ${p.nvencPreset}`);
    lines.push(`  CQ value:      ${p.cqValue}`);
    lines.push(`  Logging:       ${p.log ? 'yes' : 'no'}`);
    lines.push(`  Priority:      ${p.priority}`);
    lines.push(`  Min reduction: ${p.minSizeReduction}%`);
    lines.push('');
  }

  return lines.join('\n');
}

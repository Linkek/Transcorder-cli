import { describe, it, expect } from 'vitest';
import { validateProfile } from '../src/lib/profiles.js';
import type { Profile } from '../src/types/index.js';

const createValidProfile = (overrides: Partial<Profile> = {}): Partial<Profile> => ({
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
  ...overrides,
});

describe('validateProfile', () => {
  describe('valid profiles', () => {
    it('should accept a valid profile', () => {
      const profile = createValidProfile();
      const errors = validateProfile(profile);
      expect(errors).toHaveLength(0);
    });

    it('should accept profile with outputFolder undefined', () => {
      const profile = createValidProfile({ outputFolder: undefined });
      const errors = validateProfile(profile);
      expect(errors).toHaveLength(0);
    });

    it('should accept profile with multiple source folders', () => {
      const profile = createValidProfile({
        sourceFolders: ['input1', 'input2', 'input3'],
      });
      const errors = validateProfile(profile);
      expect(errors).toHaveLength(0);
    });

    it('should accept cqValue at boundaries', () => {
      expect(validateProfile(createValidProfile({ cqValue: 0 }))).toHaveLength(0);
      expect(validateProfile(createValidProfile({ cqValue: 51 }))).toHaveLength(0);
    });
  });

  describe('name validation', () => {
    it('should reject missing name', () => {
      const profile = createValidProfile({ name: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "name"');
    });

    it('should reject empty name', () => {
      const profile = createValidProfile({ name: '' });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "name"');
    });

    it('should reject non-string name', () => {
      const profile = createValidProfile({ name: 123 as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "name"');
    });
  });

  describe('sourceFolders validation', () => {
    it('should reject missing sourceFolders', () => {
      const profile = createValidProfile({ sourceFolders: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or empty "sourceFolders" (string or array of strings)');
    });

    it('should reject empty sourceFolders array', () => {
      const profile = createValidProfile({ sourceFolders: [] });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or empty "sourceFolders" (string or array of strings)');
    });

    it('should reject non-array sourceFolders', () => {
      const profile = createValidProfile({ sourceFolders: 'input' as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or empty "sourceFolders" (string or array of strings)');
    });
  });

  describe('recursive validation', () => {
    it('should reject missing recursive', () => {
      const profile = createValidProfile({ recursive: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "recursive" (must be a boolean)');
    });

    it('should reject non-boolean recursive', () => {
      const profile = createValidProfile({ recursive: 'true' as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "recursive" (must be a boolean)');
    });
  });

  describe('replaceFile validation', () => {
    it('should reject missing replaceFile', () => {
      const profile = createValidProfile({ replaceFile: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "replaceFile" (must be a boolean)');
    });

    it('should reject non-boolean replaceFile', () => {
      const profile = createValidProfile({ replaceFile: 1 as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "replaceFile" (must be a boolean)');
    });
  });

  describe('outputFolder validation', () => {
    it('should reject non-string outputFolder when defined', () => {
      const profile = createValidProfile({ outputFolder: 123 as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Invalid "outputFolder" (must be a string)');
    });
  });

  describe('outputFormat validation', () => {
    it('should reject missing outputFormat', () => {
      const profile = createValidProfile({ outputFormat: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "outputFormat" (e.g. "mkv", "mp4")');
    });

    it('should reject empty outputFormat', () => {
      const profile = createValidProfile({ outputFormat: '' });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "outputFormat" (e.g. "mkv", "mp4")');
    });

    it('should accept various formats', () => {
      expect(validateProfile(createValidProfile({ outputFormat: 'mkv' }))).toHaveLength(0);
      expect(validateProfile(createValidProfile({ outputFormat: 'mp4' }))).toHaveLength(0);
      expect(validateProfile(createValidProfile({ outputFormat: 'avi' }))).toHaveLength(0);
    });
  });

  describe('cacheFolder validation', () => {
    it('should reject missing cacheFolder', () => {
      const profile = createValidProfile({ cacheFolder: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "cacheFolder"');
    });

    it('should reject empty cacheFolder', () => {
      const profile = createValidProfile({ cacheFolder: '' });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "cacheFolder"');
    });
  });

  describe('maxWidth validation', () => {
    it('should reject missing maxWidth', () => {
      const profile = createValidProfile({ maxWidth: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "maxWidth" (must be a positive number)');
    });

    it('should reject zero maxWidth', () => {
      const profile = createValidProfile({ maxWidth: 0 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "maxWidth" (must be a positive number)');
    });

    it('should reject negative maxWidth', () => {
      const profile = createValidProfile({ maxWidth: -1920 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "maxWidth" (must be a positive number)');
    });

    it('should reject non-number maxWidth', () => {
      const profile = createValidProfile({ maxWidth: '1920' as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "maxWidth" (must be a positive number)');
    });
  });

  describe('maxHeight validation', () => {
    it('should reject missing maxHeight', () => {
      const profile = createValidProfile({ maxHeight: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "maxHeight" (must be a positive number)');
    });

    it('should reject zero maxHeight', () => {
      const profile = createValidProfile({ maxHeight: 0 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "maxHeight" (must be a positive number)');
    });

    it('should reject negative maxHeight', () => {
      const profile = createValidProfile({ maxHeight: -1080 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "maxHeight" (must be a positive number)');
    });
  });

  describe('downscaleToMax validation', () => {
    it('should reject missing downscaleToMax', () => {
      const profile = createValidProfile({ downscaleToMax: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "downscaleToMax" (must be a boolean)');
    });

    it('should reject non-boolean downscaleToMax', () => {
      const profile = createValidProfile({ downscaleToMax: 'yes' as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "downscaleToMax" (must be a boolean)');
    });
  });

  describe('renameFiles validation', () => {
    it('should reject missing renameFiles', () => {
      const profile = createValidProfile({ renameFiles: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "renameFiles" (must be a boolean)');
    });

    it('should reject non-boolean renameFiles', () => {
      const profile = createValidProfile({ renameFiles: 0 as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "renameFiles" (must be a boolean)');
    });
  });

  describe('removeHDR validation', () => {
    it('should reject missing removeHDR', () => {
      const profile = createValidProfile({ removeHDR: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "removeHDR" (must be a boolean)');
    });

    it('should reject non-boolean removeHDR', () => {
      const profile = createValidProfile({ removeHDR: null as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "removeHDR" (must be a boolean)');
    });
  });

  describe('nvencPreset validation', () => {
    it('should reject missing nvencPreset', () => {
      const profile = createValidProfile({ nvencPreset: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "nvencPreset"');
    });

    it('should reject empty nvencPreset', () => {
      const profile = createValidProfile({ nvencPreset: '' });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "nvencPreset"');
    });

    it('should accept various presets', () => {
      expect(validateProfile(createValidProfile({ nvencPreset: 'p1' }))).toHaveLength(0);
      expect(validateProfile(createValidProfile({ nvencPreset: 'p4' }))).toHaveLength(0);
      expect(validateProfile(createValidProfile({ nvencPreset: 'p7' }))).toHaveLength(0);
    });
  });

  describe('cqValue validation', () => {
    it('should reject missing cqValue', () => {
      const profile = createValidProfile({ cqValue: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "cqValue" (must be 0-51)');
    });

    it('should reject cqValue below 0', () => {
      const profile = createValidProfile({ cqValue: -1 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "cqValue" (must be 0-51)');
    });

    it('should reject cqValue above 51', () => {
      const profile = createValidProfile({ cqValue: 52 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "cqValue" (must be 0-51)');
    });

    it('should reject non-number cqValue', () => {
      const profile = createValidProfile({ cqValue: '23' as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "cqValue" (must be 0-51)');
    });
  });

  describe('log validation', () => {
    it('should reject missing log', () => {
      const profile = createValidProfile({ log: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "log" (must be a boolean)');
    });

    it('should reject non-boolean log', () => {
      const profile = createValidProfile({ log: 'true' as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "log" (must be a boolean)');
    });
  });

  describe('priority validation', () => {
    it('should accept priority at boundaries', () => {
      expect(validateProfile(createValidProfile({ priority: 1 }))).toHaveLength(0);
      expect(validateProfile(createValidProfile({ priority: 10 }))).toHaveLength(0);
    });

    it('should accept priority mid-range', () => {
      expect(validateProfile(createValidProfile({ priority: 5 }))).toHaveLength(0);
    });

    it('should reject missing priority', () => {
      const profile = createValidProfile({ priority: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "priority" (must be 1-10)');
    });

    it('should reject priority below 1', () => {
      const profile = createValidProfile({ priority: 0 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "priority" (must be 1-10)');
    });

    it('should reject priority above 10', () => {
      const profile = createValidProfile({ priority: 11 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "priority" (must be 1-10)');
    });

    it('should reject non-number priority', () => {
      const profile = createValidProfile({ priority: 'high' as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "priority" (must be 1-10)');
    });
  });

  describe('minSizeReduction validation', () => {
    it('should accept minSizeReduction at boundaries', () => {
      expect(validateProfile(createValidProfile({ minSizeReduction: 0 }))).toHaveLength(0);
      expect(validateProfile(createValidProfile({ minSizeReduction: 100 }))).toHaveLength(0);
    });

    it('should accept minSizeReduction mid-range', () => {
      expect(validateProfile(createValidProfile({ minSizeReduction: 2 }))).toHaveLength(0);
      expect(validateProfile(createValidProfile({ minSizeReduction: 50 }))).toHaveLength(0);
    });

    it('should reject missing minSizeReduction', () => {
      const profile = createValidProfile({ minSizeReduction: undefined });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "minSizeReduction" (must be 0-100)');
    });

    it('should reject minSizeReduction below 0', () => {
      const profile = createValidProfile({ minSizeReduction: -1 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "minSizeReduction" (must be 0-100)');
    });

    it('should reject minSizeReduction above 100', () => {
      const profile = createValidProfile({ minSizeReduction: 101 });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "minSizeReduction" (must be 0-100)');
    });

    it('should reject non-number minSizeReduction', () => {
      const profile = createValidProfile({ minSizeReduction: '2%' as any });
      const errors = validateProfile(profile);
      expect(errors).toContain('Missing or invalid "minSizeReduction" (must be 0-100)');
    });
  });

  describe('multiple errors', () => {
    it('should return all errors for completely invalid profile', () => {
      const errors = validateProfile({});
      expect(errors.length).toBeGreaterThan(10);
      expect(errors).toContain('Missing or invalid "name"');
      expect(errors).toContain('Missing or empty "sourceFolders" (string or array of strings)');
      expect(errors).toContain('Missing or invalid "recursive" (must be a boolean)');
    });

    it('should accumulate errors for multiple invalid fields', () => {
      const profile = createValidProfile({
        name: '',
        cqValue: 100,
        maxWidth: -1,
      });
      const errors = validateProfile(profile);
      expect(errors.length).toBe(3);
    });
  });
});

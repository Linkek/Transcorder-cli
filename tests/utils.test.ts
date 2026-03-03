import { describe, it, expect } from 'vitest';
import {
  buildOutputFileName,
  cleanFileName,
  extractResolutionTag,
} from '../src/lib/utils.js';

describe('buildOutputFileName', () => {
  describe('with renameFiles: true - strips all release tags', () => {
    it('should strip resolution and add new one', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip BluRay tag', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.BluRay.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip HEVC/x265 codec tags', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.x265.HEVC.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip HDR tags', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip HDR10+ tags', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.HDR10+.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip Dolby Vision tags', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.DV.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip audio codec tags (DTS, AAC, etc)', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.DTS-HD.MA.5.1.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip streaming service tags', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.AMZN.WEB-DL.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip release group names', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.BluRay.x265-SPARKS.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip bracketed release groups', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.BluRay[YTS.MX].mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should handle complex real-world filenames', () => {
      const result = buildOutputFileName({
        fileName: 'The.Matrix.1999.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.7.1-SWTYBLZ.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('The Matrix 1999-1080p.mkv');
    });

    it('should handle underscore separators', () => {
      const result = buildOutputFileName({
        fileName: 'Movie_2160p_BluRay_x265_HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should handle dash separators', () => {
      const result = buildOutputFileName({
        fileName: 'Movie-2160p-BluRay-x265-HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should handle space separators', () => {
      const result = buildOutputFileName({
        fileName: 'Movie 2160p BluRay x265 HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should handle mixed separators', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.Name_2160p-BluRay x265.HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie Name-1080p.mkv');
    });

    it('should preserve movie title with year', () => {
      const result = buildOutputFileName({
        fileName: 'Inception.2010.2160p.BluRay.x265.HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Inception 2010-1080p.mkv');
    });

    it('should handle TV show format', () => {
      const result = buildOutputFileName({
        fileName: 'Breaking.Bad.S01E01.2160p.BluRay.x265.HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Breaking Bad S01E01-1080p.mkv');
    });

    it('should strip REMUX tag', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.UHD.Remux.HEVC.HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip edition tags (Extended, Unrated, etc)', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.EXTENDED.2160p.BluRay.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip PROPER/REPACK tags', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.BluRay.PROPER.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should strip 10bit tag', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.10bit.HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should change format extension', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.mp4',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should handle 720p target resolution', () => {
      const result = buildOutputFileName({
        fileName: 'Movie-1080p.mkv',
        targetWidth: 1280,
        targetHeight: 720,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-720p.mkv');
    });

    it('should output 4K for high resolution targets', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.mkv',
        targetWidth: 3840,
        targetHeight: 2160,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-4k.mkv');
    });

    it('should handle file without any tags', () => {
      const result = buildOutputFileName({
        fileName: 'My Home Video.mp4',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('My Home Video-1080p.mkv');
    });

    it('should handle Netflix originals format', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.NF.WEB-DL.DDP5.1.Atmos.DV.HEVC-GROUP.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should handle Disney+ format', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.DSNP.WEB-DL.DDP5.1.DV.H.265-GROUP.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('Movie-1080p.mkv');
    });

    it('should use fallback name if all content is stripped', () => {
      const result = buildOutputFileName({
        fileName: '2160p.BluRay.x265.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: true,
      });
      expect(result).toBe('video-1080p.mkv');
    });
  });

  describe('with renameFiles: false', () => {
    it('should keep original filename with tags', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.BluRay.x265.HDR.mkv',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: false,
      });
      expect(result).toBe('Movie.2160p.BluRay.x265.HDR.mkv');
    });

    it('should only change extension if different', () => {
      const result = buildOutputFileName({
        fileName: 'Movie.2160p.BluRay.mp4',
        targetWidth: 1920,
        targetHeight: 1080,
        outputFormat: 'mkv',
        renameFiles: false,
      });
      expect(result).toBe('Movie.2160p.BluRay.mkv');
    });
  });
});

describe('cleanFileName', () => {
  it('should strip all release tags', () => {
    expect(cleanFileName('Movie.2160p.BluRay.x265.HDR.DTS-GROUP')).toBe('Movie');
  });

  it('should preserve title and year', () => {
    expect(cleanFileName('The.Matrix.1999.2160p.BluRay')).toBe('The Matrix 1999');
  });

  it('should handle mixed separators', () => {
    expect(cleanFileName('Movie_Name-2160p.BluRay')).toBe('Movie Name');
  });

  it('should remove bracketed content', () => {
    expect(cleanFileName('Movie.2160p[YTS.MX]')).toBe('Movie');
  });

  it('should handle TV show format', () => {
    expect(cleanFileName('Show.S01E02.1080p.WEB-DL')).toBe('Show S01E02');
  });
});

describe('extractResolutionTag', () => {
  it('should extract 2160p', () => {
    expect(extractResolutionTag('Movie.2160p.mkv')).toBe('2160p');
  });

  it('should extract 4k', () => {
    expect(extractResolutionTag('Movie-4k.mkv')).toBe('4k');
  });

  it('should extract 4K uppercase', () => {
    expect(extractResolutionTag('Movie.4K.mkv')).toBe('4k');
  });

  it('should extract 1080p', () => {
    expect(extractResolutionTag('Movie-1080p.mkv')).toBe('1080p');
  });

  it('should extract 720p', () => {
    expect(extractResolutionTag('Movie-720p.mkv')).toBe('720p');
  });

  it('should extract 480p', () => {
    expect(extractResolutionTag('Movie_480p.mkv')).toBe('480p');
  });

  it('should extract 1440p', () => {
    expect(extractResolutionTag('Movie 1440p.mkv')).toBe('1440p');
  });

  it('should return null if no tag', () => {
    expect(extractResolutionTag('Movie.mkv')).toBeNull();
  });

  it('should return first tag if multiple present', () => {
    expect(extractResolutionTag('Movie.2160p.to-1080p.mkv')).toBe('2160p');
  });
});

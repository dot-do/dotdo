/**
 * S3 Table Function Module Tests (TDD Phase - RED)
 *
 * Tests for the extracted s3 table function module that handles:
 * - S3 URL parsing (bucket, key, credentials)
 * - R2 integration
 * - Parquet file reading via hyparquet
 * - CSV/TSV file reading
 * - Result streaming
 *
 * These tests target the s3.ts module extracted from http-query-handler.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseS3Url,
  parseS3FunctionArgs,
  parseUrlFunctionArgs,
  type S3UrlParts,
  type S3FunctionArgs,
  type UrlFunctionArgs,
  S3TableFunctionError,
  UrlTableFunctionError,
  validateS3Args,
  validateUrlArgs,
  detectFormatFromUrl,
  type S3SupportedFormat,
} from '../../src/table-functions/s3';

describe('S3 Table Function Module', () => {
  // ============================================================================
  // S3 URL Parsing
  // ============================================================================

  describe('parseS3Url', () => {
    describe('AWS S3 URLs', () => {
      it('should parse virtual-hosted-style AWS S3 URL', () => {
        const result = parseS3Url('https://my-bucket.s3.amazonaws.com/path/to/file.csv');
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'path/to/file.csv',
          region: undefined,
          endpoint: 's3.amazonaws.com',
          protocol: 'https',
        });
      });

      it('should parse path-style AWS S3 URL', () => {
        const result = parseS3Url('https://s3.amazonaws.com/my-bucket/path/to/file.csv');
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'path/to/file.csv',
          region: undefined,
          endpoint: 's3.amazonaws.com',
          protocol: 'https',
        });
      });

      it('should parse regional endpoint', () => {
        const result = parseS3Url('https://my-bucket.s3.us-west-2.amazonaws.com/file.csv');
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'file.csv',
          region: 'us-west-2',
          endpoint: 's3.us-west-2.amazonaws.com',
          protocol: 'https',
        });
      });

      it('should parse s3:// protocol', () => {
        const result = parseS3Url('s3://my-bucket/path/to/file.csv');
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'path/to/file.csv',
          region: undefined,
          endpoint: undefined,
          protocol: 's3',
        });
      });
    });

    describe('Cloudflare R2 URLs', () => {
      it('should parse R2 URL', () => {
        const result = parseS3Url('https://my-bucket.account-id.r2.cloudflarestorage.com/file.csv');
        expect(result).toEqual({
          bucket: 'my-bucket',
          key: 'file.csv',
          region: undefined,
          endpoint: 'account-id.r2.cloudflarestorage.com',
          protocol: 'https',
          isR2: true,
          accountId: 'account-id',
        });
      });

      it('should parse R2 URL with nested path', () => {
        const result = parseS3Url('https://data-bucket.abc123.r2.cloudflarestorage.com/data/2024/01/users.parquet');
        expect(result).toEqual({
          bucket: 'data-bucket',
          key: 'data/2024/01/users.parquet',
          region: undefined,
          endpoint: 'abc123.r2.cloudflarestorage.com',
          protocol: 'https',
          isR2: true,
          accountId: 'abc123',
        });
      });
    });

    describe('S3-compatible endpoints', () => {
      it('should parse MinIO URL', () => {
        const result = parseS3Url('https://minio.example.com/bucket/file.csv');
        expect(result).toEqual({
          bucket: 'bucket',
          key: 'file.csv',
          region: undefined,
          endpoint: 'minio.example.com',
          protocol: 'https',
        });
      });

      it('should parse URL with port', () => {
        const result = parseS3Url('http://localhost:9000/bucket/path/to/file.csv');
        expect(result).toEqual({
          bucket: 'bucket',
          key: 'path/to/file.csv',
          region: undefined,
          endpoint: 'localhost:9000',
          protocol: 'http',
        });
      });
    });

    describe('Edge cases', () => {
      it('should handle URL with query parameters', () => {
        const result = parseS3Url('https://my-bucket.s3.amazonaws.com/file.csv?version=123');
        expect(result.bucket).toBe('my-bucket');
        expect(result.key).toBe('file.csv');
      });

      it('should handle deeply nested paths', () => {
        const result = parseS3Url('https://my-bucket.s3.amazonaws.com/a/b/c/d/e/file.csv');
        expect(result.key).toBe('a/b/c/d/e/file.csv');
      });

      it('should throw for invalid URL format', () => {
        expect(() => parseS3Url('not-a-valid-url')).toThrow();
      });

      it('should throw for missing bucket', () => {
        expect(() => parseS3Url('https://s3.amazonaws.com/')).toThrow();
      });
    });
  });

  // ============================================================================
  // S3 Function Arguments Parsing
  // ============================================================================

  describe('parseS3FunctionArgs', () => {
    it('should parse single URL argument', () => {
      const args = ["'https://bucket.s3.amazonaws.com/file.csv'"];
      const result = parseS3FunctionArgs(args);

      expect(result.url).toBe('https://bucket.s3.amazonaws.com/file.csv');
      expect(result.format).toBeUndefined();
      expect(result.structure).toBeUndefined();
      expect(result.accessKey).toBeUndefined();
      expect(result.secretKey).toBeUndefined();
    });

    it('should parse URL with format', () => {
      const args = ["'https://bucket.s3.amazonaws.com/file.txt'", "'CSV'"];
      const result = parseS3FunctionArgs(args);

      expect(result.url).toBe('https://bucket.s3.amazonaws.com/file.txt');
      expect(result.format).toBe('CSV');
    });

    it('should parse URL with format and structure', () => {
      const args = [
        "'https://bucket.s3.amazonaws.com/file.csv'",
        "'CSV'",
        "'id UInt64, name String, value Float64'",
      ];
      const result = parseS3FunctionArgs(args);

      expect(result.url).toBe('https://bucket.s3.amazonaws.com/file.csv');
      expect(result.format).toBe('CSV');
      expect(result.structure).toBe('id UInt64, name String, value Float64');
    });

    it('should parse URL with credentials (2-arg form)', () => {
      const args = [
        "'https://bucket.s3.amazonaws.com/file.csv'",
        "'AKIAIOSFODNN7EXAMPLE'",
        "'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'",
      ];
      const result = parseS3FunctionArgs(args);

      expect(result.url).toBe('https://bucket.s3.amazonaws.com/file.csv');
      expect(result.accessKey).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });

    it('should parse URL with credentials and format', () => {
      const args = [
        "'https://bucket.s3.amazonaws.com/file.csv'",
        "'AKIAIOSFODNN7EXAMPLE'",
        "'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'",
        "'CSV'",
      ];
      const result = parseS3FunctionArgs(args);

      expect(result.url).toBe('https://bucket.s3.amazonaws.com/file.csv');
      expect(result.accessKey).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      expect(result.format).toBe('CSV');
    });

    it('should parse URL with credentials, format and structure', () => {
      const args = [
        "'https://bucket.s3.amazonaws.com/file.csv'",
        "'AKIAIOSFODNN7EXAMPLE'",
        "'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'",
        "'CSV'",
        "'id UInt64, name String'",
      ];
      const result = parseS3FunctionArgs(args);

      expect(result.url).toBe('https://bucket.s3.amazonaws.com/file.csv');
      expect(result.accessKey).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(result.secretKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      expect(result.format).toBe('CSV');
      expect(result.structure).toBe('id UInt64, name String');
    });

    it('should distinguish between format and credentials', () => {
      // When the second arg is a known format, treat as format
      const argsWithFormat = ["'https://bucket.s3.amazonaws.com/file.txt'", "'CSV'"];
      const resultFormat = parseS3FunctionArgs(argsWithFormat);
      expect(resultFormat.format).toBe('CSV');
      expect(resultFormat.accessKey).toBeUndefined();

      // When the second arg looks like an access key (longer), treat as credentials
      const argsWithCreds = ["'https://bucket.s3.amazonaws.com/file.csv'", "'AKIAIOSFODNN7EXAMPLE'", "'secret'"];
      const resultCreds = parseS3FunctionArgs(argsWithCreds);
      expect(resultCreds.accessKey).toBe('AKIAIOSFODNN7EXAMPLE');
    });
  });

  // ============================================================================
  // S3 Arguments Validation
  // ============================================================================

  describe('validateS3Args', () => {
    it('should pass for valid URL', () => {
      expect(() =>
        validateS3Args({ url: 'https://bucket.s3.amazonaws.com/file.csv' })
      ).not.toThrow();
    });

    it('should throw for missing URL', () => {
      expect(() =>
        validateS3Args({ url: '' })
      ).toThrow(S3TableFunctionError);
    });

    it('should throw for invalid URL format', () => {
      expect(() =>
        validateS3Args({ url: 'not-a-valid-url' })
      ).toThrow(S3TableFunctionError);

      try {
        validateS3Args({ url: 'not-a-valid-url' });
      } catch (e) {
        expect(e).toBeInstanceOf(S3TableFunctionError);
        expect((e as S3TableFunctionError).statusCode).toBe(400);
      }
    });

    it('should throw for unsupported format', () => {
      expect(() =>
        validateS3Args({
          url: 'https://bucket.s3.amazonaws.com/file.csv',
          format: 'UnsupportedFormat',
        })
      ).toThrow(S3TableFunctionError);
    });

    it('should accept supported formats', () => {
      const formats: S3SupportedFormat[] = [
        'CSV',
        'CSVWithNames',
        'TSV',
        'TSVWithNames',
        'JSONEachRow',
        'Parquet',
      ];

      for (const format of formats) {
        expect(() =>
          validateS3Args({
            url: 'https://bucket.s3.amazonaws.com/file.csv',
            format,
          })
        ).not.toThrow();
      }
    });
  });

  // ============================================================================
  // Format Detection
  // ============================================================================

  describe('detectFormatFromUrl', () => {
    it('should detect CSV format', () => {
      expect(detectFormatFromUrl('https://bucket.s3.amazonaws.com/data.csv')).toBe('CSV');
    });

    it('should detect Parquet format', () => {
      expect(detectFormatFromUrl('https://bucket.s3.amazonaws.com/data.parquet')).toBe('Parquet');
    });

    it('should detect TSV format', () => {
      expect(detectFormatFromUrl('https://bucket.s3.amazonaws.com/data.tsv')).toBe('TSV');
    });

    it('should detect JSON format', () => {
      expect(detectFormatFromUrl('https://bucket.s3.amazonaws.com/data.json')).toBe('JSONEachRow');
    });

    it('should detect format with query parameters', () => {
      expect(detectFormatFromUrl('https://bucket.s3.amazonaws.com/data.csv?version=123')).toBe('CSV');
    });

    it('should return undefined for unknown extension', () => {
      expect(detectFormatFromUrl('https://bucket.s3.amazonaws.com/data.xyz')).toBeUndefined();
    });

    it('should be case insensitive', () => {
      expect(detectFormatFromUrl('https://bucket.s3.amazonaws.com/data.CSV')).toBe('CSV');
      expect(detectFormatFromUrl('https://bucket.s3.amazonaws.com/data.PARQUET')).toBe('Parquet');
    });
  });

  // ============================================================================
  // S3TableFunctionError
  // ============================================================================

  describe('S3TableFunctionError', () => {
    it('should have correct properties', () => {
      const error = new S3TableFunctionError('Test error', 404, 'not_found');

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('not_found');
      expect(error.name).toBe('S3TableFunctionError');
    });

    it('should extend Error', () => {
      const error = new S3TableFunctionError('Test', 400);
      expect(error).toBeInstanceOf(Error);
    });
  });
});

// ============================================================================
// URL Table Function Tests (shares implementation with s3)
// ============================================================================

describe('URL Table Function Module', () => {
  describe('parseUrlFunctionArgs', () => {
    it('should parse single URL argument', () => {
      const args = ["'https://example.com/data.csv'"];
      const result = parseUrlFunctionArgs(args);

      expect(result.url).toBe('https://example.com/data.csv');
    });

    it('should parse URL with format', () => {
      const args = ["'https://api.example.com/data'", "'JSONEachRow'"];
      const result = parseUrlFunctionArgs(args);

      expect(result.url).toBe('https://api.example.com/data');
      expect(result.format).toBe('JSONEachRow');
    });

    it('should parse URL with format and structure', () => {
      const args = [
        "'https://example.com/data'",
        "'CSV'",
        "'id UInt64, name String'",
      ];
      const result = parseUrlFunctionArgs(args);

      expect(result.format).toBe('CSV');
      expect(result.structure).toBe('id UInt64, name String');
    });

    it('should parse URL with headers', () => {
      const args = [
        "'https://api.example.com/data'",
        "'JSONEachRow'",
        "'id UInt64'",
        "'Authorization: Bearer token123'",
      ];
      const result = parseUrlFunctionArgs(args);

      expect(result.headers).toBe('Authorization: Bearer token123');
    });
  });

  describe('validateUrlArgs', () => {
    it('should pass for valid HTTPS URL', () => {
      expect(() =>
        validateUrlArgs({ url: 'https://example.com/data.csv' })
      ).not.toThrow();
    });

    it('should pass for valid HTTP URL', () => {
      expect(() =>
        validateUrlArgs({ url: 'http://example.com/data.csv' })
      ).not.toThrow();
    });

    it('should throw for unsupported protocol', () => {
      expect(() =>
        validateUrlArgs({ url: 'ftp://example.com/data.csv' })
      ).toThrow(UrlTableFunctionError);
    });

    it('should throw for missing URL', () => {
      expect(() =>
        validateUrlArgs({ url: '' })
      ).toThrow(UrlTableFunctionError);
    });
  });
});

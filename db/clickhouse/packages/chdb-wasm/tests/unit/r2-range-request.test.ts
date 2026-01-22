/**
 * R2 Range Request Tests
 *
 * Tests R2 range request support for efficient Parquet file reading.
 * Range requests are critical for:
 * - Fetching only the Parquet footer (metadata) first
 * - Reading specific row groups without downloading entire files
 * - Enabling predicate pushdown and column pruning
 *
 * This is TDD RED phase - tests are expected to FAIL initially
 * because the range request implementation doesn't exist yet.
 *
 * @see https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2objectbody
 * @see https://parquet.apache.org/docs/file-format/
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { generateMockParquetData, createTestRequest } from '../utils/test-helpers';

// ============================================================================
// Types for R2 Range Request Testing
// ============================================================================

/**
 * R2 Range request options
 */
interface R2GetOptions {
  range?: R2Range;
  onlyIf?: R2Conditional;
}

/**
 * R2 Range specification
 */
interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

/**
 * R2 Conditional request options
 */
interface R2Conditional {
  etagMatches?: string;
  etagDoesNotMatch?: string;
  uploadedBefore?: Date;
  uploadedAfter?: Date;
}

/**
 * R2 Object with body (for range request responses)
 */
interface MockR2ObjectBody {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  range?: { offset: number; length: number };
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(): Promise<Blob>;
  writeHttpMetadata(headers: Headers): void;
}

// ============================================================================
// Mock R2 Bucket with Range Request Support
// ============================================================================

/**
 * Creates a mock R2 bucket that supports range requests
 * This simulates Cloudflare R2's range request behavior
 */
function createMockR2BucketWithRangeSupport(objects: Record<string, ArrayBuffer>) {
  return {
    get: vi.fn().mockImplementation(async (key: string, options?: R2GetOptions): Promise<MockR2ObjectBody | null> => {
      const data = objects[key];
      if (!data) return null;

      let slicedData: ArrayBuffer;
      let rangeInfo: { offset: number; length: number } | undefined;

      if (options?.range) {
        const { offset, length, suffix } = options.range;

        if (suffix !== undefined) {
          // Suffix range: last N bytes
          const start = Math.max(0, data.byteLength - suffix);
          slicedData = data.slice(start);
          rangeInfo = { offset: start, length: slicedData.byteLength };
        } else if (offset !== undefined && length !== undefined) {
          // Offset + length range
          slicedData = data.slice(offset, offset + length);
          rangeInfo = { offset, length: slicedData.byteLength };
        } else if (offset !== undefined) {
          // Offset only: from offset to end
          slicedData = data.slice(offset);
          rangeInfo = { offset, length: slicedData.byteLength };
        } else {
          slicedData = data;
        }
      } else {
        slicedData = data;
      }

      // Handle conditional requests
      if (options?.onlyIf) {
        const etag = `"${key}-etag"`;
        if (options.onlyIf.etagMatches && options.onlyIf.etagMatches !== etag) {
          return null; // ETag doesn't match - return null (simulating 412 Precondition Failed)
        }
        if (options.onlyIf.etagDoesNotMatch && options.onlyIf.etagDoesNotMatch === etag) {
          return null; // ETag matches when it shouldn't - return null (simulating 304 Not Modified)
        }
      }

      return {
        key,
        size: data.byteLength,
        etag: `${key}-etag`,
        httpEtag: `"${key}-etag"`,
        range: rangeInfo,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(slicedData));
            controller.close();
          },
        }),
        arrayBuffer: async () => slicedData,
        text: async () => new TextDecoder().decode(slicedData),
        blob: async () => new Blob([slicedData]),
        writeHttpMetadata: (headers: Headers) => {
          headers.set('etag', `"${key}-etag"`);
          headers.set('content-length', String(slicedData.byteLength));
          if (rangeInfo) {
            headers.set('content-range', `bytes ${rangeInfo.offset}-${rangeInfo.offset + rangeInfo.length - 1}/${data.byteLength}`);
          }
        },
      };
    }),

    head: vi.fn().mockImplementation(async (key: string) => {
      const data = objects[key];
      if (!data) return null;
      return {
        key,
        size: data.byteLength,
        etag: `${key}-etag`,
        httpEtag: `"${key}-etag"`,
      };
    }),
  };
}

// ============================================================================
// Test Suite: R2 Range Request Support
// ============================================================================

describe('R2 Range Request Support', () => {
  // Test data - simulate a Parquet file
  let testParquetData: ArrayBuffer;
  let mockBucket: ReturnType<typeof createMockR2BucketWithRangeSupport>;

  beforeAll(() => {
    // Generate mock Parquet data (1000 rows = ~8KB of data)
    testParquetData = generateMockParquetData(1000);
  });

  beforeEach(() => {
    mockBucket = createMockR2BucketWithRangeSupport({
      'test-data.parquet': testParquetData,
    });
  });

  // ==========================================================================
  // Basic Range Request Tests
  // ==========================================================================

  describe('Basic Range Requests', () => {
    it('should handle basic range request (bytes=0-1023)', async () => {
      // Arrange
      const rangeStart = 0;
      const rangeLength = 1024;

      // Act - This should use R2's range request feature
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: rangeStart, length: rangeLength },
      });

      // Assert
      expect(object).not.toBeNull();
      expect(object!.range).toBeDefined();
      expect(object!.range!.offset).toBe(rangeStart);
      expect(object!.range!.length).toBeLessThanOrEqual(rangeLength);

      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBeLessThanOrEqual(rangeLength);

      // Verify Content-Range header would be set correctly
      const headers = new Headers();
      object!.writeHttpMetadata(headers);
      const contentRange = headers.get('content-range');
      expect(contentRange).toMatch(/^bytes \d+-\d+\/\d+$/);
    });

    it('should handle range request from middle of file', async () => {
      // Arrange - request bytes 500-1499
      const rangeStart = 500;
      const rangeLength = 1000;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: rangeStart, length: rangeLength },
      });

      // Assert
      expect(object).not.toBeNull();
      expect(object!.range!.offset).toBe(rangeStart);

      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBeLessThanOrEqual(rangeLength);
    });

    it('should handle range request with only offset (to end of file)', async () => {
      // Arrange - request from byte 100 to end
      const rangeStart = 100;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: rangeStart },
      });

      // Assert
      expect(object).not.toBeNull();
      expect(object!.range!.offset).toBe(rangeStart);

      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBe(testParquetData.byteLength - rangeStart);
    });

    it('should handle suffix range request (last N bytes)', async () => {
      // Arrange - request last 100 bytes
      const suffixLength = 100;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { suffix: suffixLength },
      });

      // Assert
      expect(object).not.toBeNull();
      expect(object!.range!.length).toBe(suffixLength);
      expect(object!.range!.offset).toBe(testParquetData.byteLength - suffixLength);
    });
  });

  // ==========================================================================
  // Parquet-Specific Range Requests
  // ==========================================================================

  describe('Parquet Footer Range Requests', () => {
    it('should fetch Parquet magic bytes with suffix range (last 4 bytes)', async () => {
      // Parquet files end with "PAR1" magic bytes
      const magicBytesLength = 4;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { suffix: magicBytesLength },
      });

      // Assert
      expect(object).not.toBeNull();
      const data = await object!.arrayBuffer();
      const view = new Uint8Array(data);

      // Should get PAR1 magic bytes
      expect(view[0]).toBe(0x50); // P
      expect(view[1]).toBe(0x41); // A
      expect(view[2]).toBe(0x52); // R
      expect(view[3]).toBe(0x31); // 1
    });

    it('should fetch Parquet footer metadata (last 8 bytes: 4-byte length + 4-byte magic)', async () => {
      // Parquet footer: [metadata][4-byte metadata length][PAR1]
      // To read footer, first get last 8 bytes to find metadata length
      const footerSuffixLength = 8;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { suffix: footerSuffixLength },
      });

      // Assert
      expect(object).not.toBeNull();
      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBe(footerSuffixLength);

      const view = new Uint8Array(data);
      // Last 4 bytes should be PAR1 magic
      expect(view[4]).toBe(0x50); // P
      expect(view[5]).toBe(0x41); // A
      expect(view[6]).toBe(0x52); // R
      expect(view[7]).toBe(0x31); // 1
    });

    it('should fetch specific row group by byte range', async () => {
      // Simulate fetching a specific row group (bytes 100-500)
      // In real Parquet files, row group offsets come from footer metadata
      const rowGroupOffset = 100;
      const rowGroupLength = 400;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: rowGroupOffset, length: rowGroupLength },
      });

      // Assert
      expect(object).not.toBeNull();
      expect(object!.range!.offset).toBe(rowGroupOffset);

      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBe(rowGroupLength);

      // Content-Range header should indicate partial content
      const headers = new Headers();
      object!.writeHttpMetadata(headers);
      expect(headers.get('content-range')).toBe(
        `bytes ${rowGroupOffset}-${rowGroupOffset + rowGroupLength - 1}/${testParquetData.byteLength}`
      );
    });
  });

  // ==========================================================================
  // Parallel Range Requests
  // ==========================================================================

  describe('Multiple Parallel Range Requests', () => {
    it('should handle multiple concurrent range requests', async () => {
      // Simulate parallel reads for different parts of the file
      const ranges = [
        { offset: 0, length: 100 },      // Header
        { offset: 100, length: 200 },    // Row group 1
        { offset: 300, length: 200 },    // Row group 2
        { suffix: 8 },                   // Footer
      ];

      // Act - fetch all ranges in parallel
      const results = await Promise.all(
        ranges.map(range => mockBucket.get('test-data.parquet', { range }))
      );

      // Assert - all requests should succeed
      expect(results.every(r => r !== null)).toBe(true);

      // Verify each result has correct size
      const buffers = await Promise.all(results.map(r => r!.arrayBuffer()));

      expect(buffers[0].byteLength).toBe(100);  // Header
      expect(buffers[1].byteLength).toBe(200);  // Row group 1
      expect(buffers[2].byteLength).toBe(200);  // Row group 2
      expect(buffers[3].byteLength).toBe(8);    // Footer
    });

    it('should not interfere between parallel requests', async () => {
      // Add another file to the bucket
      const anotherFile = generateMockParquetData(500);
      mockBucket = createMockR2BucketWithRangeSupport({
        'file1.parquet': testParquetData,
        'file2.parquet': anotherFile,
      });

      // Act - parallel requests to different files
      const [result1, result2] = await Promise.all([
        mockBucket.get('file1.parquet', { range: { offset: 0, length: 100 } }),
        mockBucket.get('file2.parquet', { range: { offset: 0, length: 100 } }),
      ]);

      // Assert - both should succeed independently
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();

      // They should have different ETags
      expect(result1!.etag).not.toBe(result2!.etag);
    });
  });

  // ==========================================================================
  // Conditional Requests
  // ==========================================================================

  describe('Conditional Requests (If-Match, If-None-Match)', () => {
    it('should return data when If-Match etag matches', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        onlyIf: { etagMatches: '"test-data.parquet-etag"' },
      });

      // Assert
      expect(object).not.toBeNull();
    });

    it('should return null when If-Match etag does not match', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        onlyIf: { etagMatches: '"wrong-etag"' },
      });

      // Assert - should simulate 412 Precondition Failed
      expect(object).toBeNull();
    });

    it('should return data when If-None-Match etag does not match', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        onlyIf: { etagDoesNotMatch: '"different-etag"' },
      });

      // Assert
      expect(object).not.toBeNull();
    });

    it('should return null when If-None-Match etag matches (304 Not Modified)', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        onlyIf: { etagDoesNotMatch: '"test-data.parquet-etag"' },
      });

      // Assert - should simulate 304 Not Modified
      expect(object).toBeNull();
    });

    it('should combine conditional request with range request', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: 0, length: 100 },
        onlyIf: { etagMatches: '"test-data.parquet-etag"' },
      });

      // Assert
      expect(object).not.toBeNull();
      expect(object!.range).toBeDefined();
      expect(object!.range!.length).toBeLessThanOrEqual(100);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should return null for non-existent file', async () => {
      // Act
      const object = await mockBucket.get('non-existent.parquet', {
        range: { offset: 0, length: 100 },
      });

      // Assert
      expect(object).toBeNull();
    });

    it('should handle range request beyond file size gracefully', async () => {
      // Request starts beyond file end
      const beyondFileSize = testParquetData.byteLength + 1000;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: beyondFileSize, length: 100 },
      });

      // Assert - should return empty or partial data
      expect(object).not.toBeNull();
      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBe(0);
    });

    it('should handle range request that extends past file end', async () => {
      // Request extends beyond file
      const startOffset = testParquetData.byteLength - 50;
      const requestedLength = 200; // Only 50 bytes available

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: startOffset, length: requestedLength },
      });

      // Assert - should return only available bytes
      expect(object).not.toBeNull();
      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBe(50); // Only 50 bytes available
    });

    it('should handle suffix range larger than file size', async () => {
      // Request last N bytes where N > file size
      const suffixLength = testParquetData.byteLength * 2;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { suffix: suffixLength },
      });

      // Assert - should return entire file
      expect(object).not.toBeNull();
      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBe(testParquetData.byteLength);
    });

    it('should handle zero-length range request', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: 0, length: 0 },
      });

      // Assert
      expect(object).not.toBeNull();
      const data = await object!.arrayBuffer();
      expect(data.byteLength).toBe(0);
    });
  });

  // ==========================================================================
  // HTTP Response Headers
  // ==========================================================================

  describe('HTTP Response Headers', () => {
    it('should set correct Content-Range header for range request', async () => {
      // Arrange
      const offset = 100;
      const length = 200;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset, length },
      });

      // Assert
      const headers = new Headers();
      object!.writeHttpMetadata(headers);

      const contentRange = headers.get('content-range');
      expect(contentRange).toBe(
        `bytes ${offset}-${offset + length - 1}/${testParquetData.byteLength}`
      );
    });

    it('should set ETag header', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: 0, length: 100 },
      });

      // Assert
      const headers = new Headers();
      object!.writeHttpMetadata(headers);

      expect(headers.get('etag')).toBe('"test-data.parquet-etag"');
    });

    it('should set Content-Length header for partial content', async () => {
      // Arrange
      const length = 500;

      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: 0, length },
      });

      // Assert
      const headers = new Headers();
      object!.writeHttpMetadata(headers);

      expect(headers.get('content-length')).toBe(String(length));
    });
  });

  // ==========================================================================
  // Streaming Partial Content
  // ==========================================================================

  describe('Streaming Partial Content (206 Responses)', () => {
    it('should return ReadableStream for range request', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: 0, length: 100 },
      });

      // Assert
      expect(object).not.toBeNull();
      expect(object!.body).toBeInstanceOf(ReadableStream);
    });

    it('should be able to read stream in chunks', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: 0, length: 1000 },
      });

      // Read stream
      const reader = object!.body.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;

      while (!done) {
        const result = await reader.read();
        if (result.done) {
          done = true;
        } else {
          chunks.push(result.value);
        }
      }

      // Assert
      expect(chunks.length).toBeGreaterThan(0);

      // Combine chunks and verify length
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      expect(totalLength).toBeLessThanOrEqual(1000);
    });

    it('should be able to cancel stream mid-read', async () => {
      // Act
      const object = await mockBucket.get('test-data.parquet', {
        range: { offset: 0, length: 1000 },
      });

      const reader = object!.body.getReader();

      // Read one chunk then cancel
      await reader.read();
      await reader.cancel();

      // Assert - should not throw
      expect(true).toBe(true);
    });
  });
});

// ============================================================================
// R2 Range Request Handler Tests (TDD RED - Must Fail)
// ============================================================================

/**
 * These tests attempt to import and use the R2 range request handler.
 * They will FAIL because the implementation doesn't exist yet.
 *
 * When implementing the handler, create: src/r2-range-handler.ts
 * with exports: parseRangeHeader, buildRangeResponse, handleRangeRequest
 */

describe('R2 Range Request Handler (TDD RED - Implementation Required)', () => {
  /**
   * These tests define the contract for the R2 range request handler.
   * They will FAIL until the implementation exists.
   *
   * The handler should:
   * 1. Parse HTTP Range headers
   * 2. Translate them to R2 range options
   * 3. Return proper 206 Partial Content responses
   * 4. Handle edge cases and errors
   */

  describe('Range Header Parsing', () => {
    it('should parse basic range header (bytes=0-1023)', async () => {
      // Import the module that should be implemented
      // This will fail until src/r2-range-handler.ts exists
      const { parseRangeHeader } = await import('../../src/r2-range-handler');

      const result = parseRangeHeader('bytes=0-1023');

      expect(result).not.toBeNull();
      expect(result!.offset).toBe(0);
      expect(result!.length).toBe(1024);
    });

    it('should parse suffix range header (bytes=-500)', async () => {
      const { parseRangeHeader } = await import('../../src/r2-range-handler');

      const result = parseRangeHeader('bytes=-500');

      expect(result).not.toBeNull();
      expect(result!.suffix).toBe(500);
    });

    it('should parse open-ended range header (bytes=1000-)', async () => {
      const { parseRangeHeader } = await import('../../src/r2-range-handler');

      const result = parseRangeHeader('bytes=1000-');

      expect(result).not.toBeNull();
      expect(result!.offset).toBe(1000);
      expect(result!.length).toBeUndefined();
    });

    it('should return null for invalid range header', async () => {
      const { parseRangeHeader } = await import('../../src/r2-range-handler');

      const result = parseRangeHeader('invalid-range');

      expect(result).toBeNull();
    });

    it('should handle multipart range requests', async () => {
      const { parseRangeHeader } = await import('../../src/r2-range-handler');

      // Multipart ranges like "bytes=0-100,200-300" - should return first range or null
      const result = parseRangeHeader('bytes=0-100,200-300');

      // For simplicity, first implementation can return null for multipart
      // or return array of ranges
      expect(result).toBeDefined();
    });
  });

  describe('Range Request Response Building', () => {
    it('should build 206 Partial Content response with correct headers', async () => {
      const { buildRangeResponse } = await import('../../src/r2-range-handler');

      const testData = new ArrayBuffer(50);
      const response = await buildRangeResponse(
        testData,
        { offset: 0, length: 50 },
        1000
      );

      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toBe('bytes 0-49/1000');
      expect(response.headers.get('Content-Length')).toBe('50');
    });

    it('should include Accept-Ranges header in response', async () => {
      const { buildRangeResponse } = await import('../../src/r2-range-handler');

      const testData = new ArrayBuffer(100);
      const response = await buildRangeResponse(
        testData,
        { offset: 0, length: 100 },
        1000
      );

      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    });

    it('should set Content-Range header correctly for suffix range', async () => {
      const { buildRangeResponse } = await import('../../src/r2-range-handler');

      const testData = new ArrayBuffer(100);
      const response = await buildRangeResponse(
        testData,
        { offset: 900, length: 100 }, // Last 100 bytes of 1000 byte file
        1000
      );

      expect(response.headers.get('Content-Range')).toBe('bytes 900-999/1000');
    });
  });

  describe('Full Range Request Handler', () => {
    it('should handle complete range request flow', async () => {
      const { handleRangeRequest } = await import('../../src/r2-range-handler');

      const testParquetData = generateMockParquetData(1000);
      const mockBucket = createMockR2BucketWithRangeSupport({
        'test.parquet': testParquetData,
      });

      const request = createTestRequest('/data/test.parquet', {
        headers: { 'Range': 'bytes=0-1023' },
      });

      const response = await handleRangeRequest(request, mockBucket, 'test.parquet');

      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toMatch(/^bytes 0-\d+\/\d+$/);
      expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    });

    it('should return 416 for unsatisfiable range', async () => {
      const { handleRangeRequest } = await import('../../src/r2-range-handler');

      const testParquetData = generateMockParquetData(100); // Small file
      const mockBucket = createMockR2BucketWithRangeSupport({
        'small.parquet': testParquetData,
      });

      const request = createTestRequest('/data/small.parquet', {
        headers: { 'Range': 'bytes=999999-1000000' }, // Beyond file size
      });

      const response = await handleRangeRequest(request, mockBucket, 'small.parquet');

      expect(response.status).toBe(416); // Range Not Satisfiable
      expect(response.headers.get('Content-Range')).toMatch(/^bytes \*\/\d+$/);
    });

    it('should support conditional range requests with If-Range', async () => {
      const { handleRangeRequest } = await import('../../src/r2-range-handler');

      const testParquetData = generateMockParquetData(1000);
      const mockBucket = createMockR2BucketWithRangeSupport({
        'test.parquet': testParquetData,
      });

      const request = createTestRequest('/data/test.parquet', {
        headers: {
          'Range': 'bytes=0-100',
          'If-Range': '"test.parquet-etag"', // Valid ETag
        },
      });

      const response = await handleRangeRequest(request, mockBucket, 'test.parquet');

      // If ETag matches, should return partial content
      expect(response.status).toBe(206);
    });

    it('should return full content when If-Range etag does not match', async () => {
      const { handleRangeRequest } = await import('../../src/r2-range-handler');

      const testParquetData = generateMockParquetData(1000);
      const mockBucket = createMockR2BucketWithRangeSupport({
        'test.parquet': testParquetData,
      });

      const request = createTestRequest('/data/test.parquet', {
        headers: {
          'Range': 'bytes=0-100',
          'If-Range': '"old-etag"', // Mismatched ETag
        },
      });

      const response = await handleRangeRequest(request, mockBucket, 'test.parquet');

      // If ETag doesn't match, should return full content (200)
      expect(response.status).toBe(200);
    });

    it('should handle missing file gracefully', async () => {
      const { handleRangeRequest } = await import('../../src/r2-range-handler');

      const mockBucket = createMockR2BucketWithRangeSupport({});

      const request = createTestRequest('/data/missing.parquet', {
        headers: { 'Range': 'bytes=0-100' },
      });

      const response = await handleRangeRequest(request, mockBucket, 'missing.parquet');

      expect(response.status).toBe(404);
    });
  });
});

// ============================================================================
// Integration Tests: R2 Range Requests in Worker Context
// ============================================================================

describe('R2 Range Requests - Worker Integration', () => {
  /**
   * These tests verify that range requests work correctly when
   * integrated with the chdb-lake Worker. They test the full request
   * flow from HTTP request to R2 range fetch.
   *
   * NOTE: These tests will FAIL until the range request handler is implemented
   */

  it.skip('should handle HTTP Range header and return 206 Partial Content', async () => {
    // This test requires the Worker implementation to handle Range headers
    // and translate them to R2 range requests

    // Arrange
    const request = createTestRequest('/data/test.parquet', {
      headers: {
        'Range': 'bytes=0-1023',
      },
    });

    // Act - Would call worker.fetch(request, env)
    // const response = await worker.fetch(request, env);

    // Assert
    // expect(response.status).toBe(206); // Partial Content
    // expect(response.headers.get('Content-Range')).toMatch(/^bytes 0-1023\/\d+$/);
    // expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it.skip('should support Accept-Ranges header for Parquet files', async () => {
    // HEAD request should indicate range support

    // Arrange
    const request = createTestRequest('/data/test.parquet', {
      method: 'HEAD',
    });

    // Act - Would call worker.fetch(request, env)
    // const response = await worker.fetch(request, env);

    // Assert
    // expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it.skip('should return 416 Range Not Satisfiable for invalid range', async () => {
    // Arrange
    const request = createTestRequest('/data/test.parquet', {
      headers: {
        'Range': 'bytes=999999999-1000000000', // Beyond file size
      },
    });

    // Act - Would call worker.fetch(request, env)
    // const response = await worker.fetch(request, env);

    // Assert
    // expect(response.status).toBe(416); // Range Not Satisfiable
    // expect(response.headers.get('Content-Range')).toMatch(/^bytes \*\/\d+$/);
  });
});

// ============================================================================
// Performance Tests: Range Request Efficiency
// ============================================================================

describe('Range Request Performance', () => {
  /**
   * These tests verify that range requests actually reduce data transfer
   * compared to full file downloads.
   */

  it('should transfer less data with range request than full download', async () => {
    // Arrange
    const largeParquetData = generateMockParquetData(10000); // ~80KB
    const bucket = createMockR2BucketWithRangeSupport({
      'large.parquet': largeParquetData,
    });

    // Act - Range request for just footer
    const rangeObject = await bucket.get('large.parquet', {
      range: { suffix: 8 }, // Just footer
    });

    // Full download (no range)
    const fullObject = await bucket.get('large.parquet');

    // Assert
    const rangeData = await rangeObject!.arrayBuffer();
    const fullData = await fullObject!.arrayBuffer();

    expect(rangeData.byteLength).toBeLessThan(fullData.byteLength);
    expect(rangeData.byteLength).toBe(8); // Just the footer
  });

  it('should allow efficient two-phase Parquet reading pattern', async () => {
    /**
     * Efficient Parquet reading pattern:
     * 1. First, read footer (last 8 bytes) to get metadata length
     * 2. Then, read full footer metadata
     * 3. Finally, read only needed row groups
     *
     * This should result in much less data transfer than reading entire file
     */

    // Arrange
    const parquetData = generateMockParquetData(5000);
    const bucket = createMockR2BucketWithRangeSupport({
      'data.parquet': parquetData,
    });

    // Phase 1: Read footer suffix
    const phase1 = await bucket.get('data.parquet', { range: { suffix: 8 } });
    const phase1Data = await phase1!.arrayBuffer();
    expect(phase1Data.byteLength).toBe(8);

    // Phase 2: Read full footer (simulated - in reality we'd parse metadata length from phase 1)
    const metadataLength = 100; // Simulated
    const phase2 = await bucket.get('data.parquet', { range: { suffix: metadataLength + 8 } });
    const phase2Data = await phase2!.arrayBuffer();
    expect(phase2Data.byteLength).toBe(metadataLength + 8);

    // Phase 3: Read specific row group (simulated offsets)
    const rowGroupOffset = 4;
    const rowGroupLength = 1000;
    const phase3 = await bucket.get('data.parquet', {
      range: { offset: rowGroupOffset, length: rowGroupLength },
    });
    const phase3Data = await phase3!.arrayBuffer();

    // Assert - Total bytes read should be much less than full file
    const totalBytesRead = phase1Data.byteLength + phase2Data.byteLength + phase3Data.byteLength;
    expect(totalBytesRead).toBeLessThan(parquetData.byteLength);
  });
});

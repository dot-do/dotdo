/**
 * R2 Virtual File System (VFS) Tests
 *
 * Tests for the R2 VFS layer which provides a file system abstraction over
 * Cloudflare R2 storage. The VFS enables ClickHouse-style file operations
 * on R2 objects:
 * - Opening files for reading, writing, or appending
 * - Reading bytes at specific offsets (range requests)
 * - Writing new files and appending to existing files
 * - Deleting files and listing directories
 * - File metadata operations (stat, size)
 * - Concurrent access support
 * - Metadata caching for reduced API calls
 *
 * This is TDD RED phase - tests are expected to FAIL initially
 * because the R2 VFS implementation doesn't exist yet.
 *
 * @see https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockR2Bucket, createTestRequest } from '../utils/test-helpers';

// ============================================================================
// Types for R2 VFS Testing
// ============================================================================

/**
 * File handle returned by VFS open operations
 */
interface FileHandle {
  /** Unique handle identifier */
  id: string;
  /** Path to the file */
  path: string;
  /** Open mode */
  mode: 'r' | 'w' | 'a';
  /** Current position in file (for sequential reads/writes) */
  position: number;
  /** Whether handle is still valid */
  valid: boolean;
}

/**
 * File statistics
 */
interface FileStat {
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modified: Date;
  /** ETag for conditional requests */
  etag?: string;
}

/**
 * R2 VFS interface to be implemented
 */
interface R2VFS {
  /** Open a file for reading, writing, or appending */
  open(path: string, mode: 'r' | 'w' | 'a'): Promise<FileHandle>;
  /** Read bytes from file at offset */
  read(handle: FileHandle, offset: number, length: number): Promise<Uint8Array>;
  /** Write data to file (at current position or end for append) */
  write(handle: FileHandle, data: Uint8Array): Promise<void>;
  /** Close file handle and release resources */
  close(handle: FileHandle): Promise<void>;
  /** Get file statistics without downloading */
  stat(path: string): Promise<FileStat>;
  /** List files with given prefix */
  list(prefix: string): Promise<string[]>;
  /** Delete a file */
  delete(path: string): Promise<void>;
  /** Check if file exists */
  exists(path: string): Promise<boolean>;
  /** Get file size without downloading full file */
  size(path: string): Promise<number>;
}

/**
 * R2 VFS options
 */
interface R2VFSOptions {
  /** Enable metadata caching */
  cacheMetadata?: boolean;
  /** Cache TTL in milliseconds */
  cacheTTL?: number;
  /** Maximum concurrent reads */
  maxConcurrentReads?: number;
  /** Enable range request coalescing */
  coalesceRangeRequests?: boolean;
}

// ============================================================================
// Mock R2 Bucket with Full VFS Support
// ============================================================================

/**
 * Creates a mock R2 bucket that supports all VFS operations
 */
function createMockR2BucketForVFS(objects: Record<string, ArrayBuffer>) {
  const storedObjects = new Map(Object.entries(objects));
  const etags = new Map<string, string>();

  // Generate ETags
  for (const key of storedObjects.keys()) {
    etags.set(key, `"${key}-etag-${Date.now()}"`);
  }

  return {
    get: vi.fn().mockImplementation(async (key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) => {
      const data = storedObjects.get(key);
      if (!data) return null;

      let slicedData: ArrayBuffer;
      let rangeInfo: { offset: number; length: number } | undefined;

      if (options?.range) {
        const { offset, length, suffix } = options.range;
        if (suffix !== undefined) {
          const start = Math.max(0, data.byteLength - suffix);
          slicedData = data.slice(start);
          rangeInfo = { offset: start, length: slicedData.byteLength };
        } else if (offset !== undefined && length !== undefined) {
          slicedData = data.slice(offset, offset + length);
          rangeInfo = { offset, length: slicedData.byteLength };
        } else if (offset !== undefined) {
          slicedData = data.slice(offset);
          rangeInfo = { offset, length: slicedData.byteLength };
        } else {
          slicedData = data;
        }
      } else {
        slicedData = data;
      }

      return {
        key,
        size: data.byteLength,
        etag: etags.get(key)?.replace(/"/g, ''),
        httpEtag: etags.get(key),
        uploaded: new Date(),
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
          headers.set('etag', etags.get(key) || '');
          headers.set('content-length', String(slicedData.byteLength));
          if (rangeInfo) {
            headers.set('content-range', `bytes ${rangeInfo.offset}-${rangeInfo.offset + rangeInfo.length - 1}/${data.byteLength}`);
          }
        },
      };
    }),

    head: vi.fn().mockImplementation(async (key: string) => {
      const data = storedObjects.get(key);
      if (!data) return null;
      return {
        key,
        size: data.byteLength,
        etag: etags.get(key)?.replace(/"/g, ''),
        httpEtag: etags.get(key),
        uploaded: new Date(),
        customMetadata: {},
      };
    }),

    put: vi.fn().mockImplementation(async (key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string) => {
      let data: ArrayBuffer;
      if (typeof value === 'string') {
        data = new TextEncoder().encode(value).buffer;
      } else if (value instanceof Uint8Array) {
        data = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      } else if (value instanceof ArrayBuffer) {
        data = value;
      } else {
        // ReadableStream
        const reader = value.getReader();
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
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        data = combined.buffer;
      }
      storedObjects.set(key, data);
      const newEtag = `"${key}-etag-${Date.now()}"`;
      etags.set(key, newEtag);
      return {
        key,
        etag: newEtag.replace(/"/g, ''),
        httpEtag: newEtag,
      };
    }),

    delete: vi.fn().mockImplementation(async (key: string) => {
      storedObjects.delete(key);
      etags.delete(key);
    }),

    list: vi.fn().mockImplementation(async (options?: { prefix?: string; limit?: number; cursor?: string; delimiter?: string }) => {
      let keys = Array.from(storedObjects.keys());

      if (options?.prefix) {
        keys = keys.filter(k => k.startsWith(options.prefix!));
      }

      if (options?.delimiter) {
        // Handle directory-style listing
        const prefixLen = (options.prefix || '').length;
        const dirs = new Set<string>();
        const files: string[] = [];

        for (const key of keys) {
          const remainder = key.slice(prefixLen);
          const delimIndex = remainder.indexOf(options.delimiter);
          if (delimIndex >= 0) {
            dirs.add(key.slice(0, prefixLen + delimIndex + 1));
          } else {
            files.push(key);
          }
        }

        return {
          objects: files.map(key => ({
            key,
            size: storedObjects.get(key)!.byteLength,
            etag: etags.get(key)?.replace(/"/g, ''),
            httpEtag: etags.get(key),
            uploaded: new Date(),
          })),
          delimitedPrefixes: Array.from(dirs),
          truncated: false,
          cursor: undefined,
        };
      }

      if (options?.limit) {
        keys = keys.slice(0, options.limit);
      }

      return {
        objects: keys.map(key => ({
          key,
          size: storedObjects.get(key)!.byteLength,
          etag: etags.get(key)?.replace(/"/g, ''),
          httpEtag: etags.get(key),
          uploaded: new Date(),
        })),
        truncated: false,
        cursor: undefined,
        delimitedPrefixes: [],
      };
    }),

    // Expose internal state for testing
    _getStoredObjects: () => storedObjects,
    _getEtags: () => etags,
  };
}

/**
 * Generate test file data with predictable content
 */
function generateTestFileData(size: number, seed: number = 0): ArrayBuffer {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < size; i++) {
    view[i] = (i + seed) % 256;
  }
  return buffer;
}

// ============================================================================
// Test Suite: R2 VFS - File Opening Operations
// ============================================================================

describe('R2 VFS - File Opening (TDD RED)', () => {
  /**
   * These tests verify the VFS can open files in different modes.
   * They will FAIL until src/r2-vfs.ts is implemented.
   */

  describe('VFS can open file from R2 bucket', () => {
    it('should open existing file for reading', async () => {
      // Import the module that should be implemented
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/test-file.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test-file.dat', 'r');

      expect(handle).toBeDefined();
      expect(handle.id).toBeTruthy();
      expect(handle.path).toBe('data/test-file.dat');
      expect(handle.mode).toBe('r');
      expect(handle.position).toBe(0);
      expect(handle.valid).toBe(true);
    });

    it('should open file for writing (creates new file)', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/new-file.dat', 'w');

      expect(handle).toBeDefined();
      expect(handle.path).toBe('data/new-file.dat');
      expect(handle.mode).toBe('w');
      expect(handle.valid).toBe(true);
    });

    it('should open existing file for appending', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const existingData = generateTestFileData(500);
      const mockBucket = createMockR2BucketForVFS({
        'data/append-file.dat': existingData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/append-file.dat', 'a');

      expect(handle).toBeDefined();
      expect(handle.path).toBe('data/append-file.dat');
      expect(handle.mode).toBe('a');
      expect(handle.position).toBe(500); // Position at end for append
      expect(handle.valid).toBe(true);
    });

    it('should create new file when opening non-existent file for appending', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/new-append-file.dat', 'a');

      expect(handle).toBeDefined();
      expect(handle.mode).toBe('a');
      expect(handle.position).toBe(0);
      expect(handle.valid).toBe(true);
    });

    it('should throw error when opening non-existent file for reading', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      await expect(vfs.open('data/non-existent.dat', 'r')).rejects.toThrow(/not found|does not exist/i);
    });

    it('should generate unique handle IDs for multiple opens', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'file1.dat': testData,
        'file2.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle1 = await vfs.open('file1.dat', 'r');
      const handle2 = await vfs.open('file2.dat', 'r');
      const handle3 = await vfs.open('file1.dat', 'r'); // Same file, different handle

      expect(handle1.id).not.toBe(handle2.id);
      expect(handle1.id).not.toBe(handle3.id);
      expect(handle2.id).not.toBe(handle3.id);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Range Read Operations
// ============================================================================

describe('R2 VFS - Range Reads (TDD RED)', () => {
  /**
   * These tests verify the VFS can read bytes at specific offsets
   * using R2 range requests.
   */

  describe('VFS can read bytes at offset (range requests)', () => {
    it('should read bytes from beginning of file', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test.dat', 'r');
      const bytes = await vfs.read(handle, 0, 100);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(100);
      // Verify content matches source
      const expectedView = new Uint8Array(testData, 0, 100);
      expect(bytes).toEqual(expectedView);
    });

    it('should read bytes from middle of file', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test.dat', 'r');
      const bytes = await vfs.read(handle, 500, 100);

      expect(bytes.length).toBe(100);
      const expectedView = new Uint8Array(testData, 500, 100);
      expect(bytes).toEqual(expectedView);
    });

    it('should read bytes from end of file', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test.dat', 'r');
      const bytes = await vfs.read(handle, 950, 50);

      expect(bytes.length).toBe(50);
      const expectedView = new Uint8Array(testData, 950, 50);
      expect(bytes).toEqual(expectedView);
    });

    it('should handle read beyond file end gracefully', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/small.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/small.dat', 'r');

      // Request extends beyond file
      const bytes = await vfs.read(handle, 80, 50);

      // Should return only available bytes (20)
      expect(bytes.length).toBe(20);
    });

    it('should return empty array for read starting beyond file end', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/small.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/small.dat', 'r');

      const bytes = await vfs.read(handle, 200, 50);

      expect(bytes.length).toBe(0);
    });

    it('should throw error when reading with write-mode handle', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/new-file.dat', 'w');

      await expect(vfs.read(handle, 0, 100)).rejects.toThrow(/not open for reading|wrong mode/i);
    });
  });

  describe('Range reads use R2 range request headers', () => {
    it('should use offset+length range for reads', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test.dat', 'r');
      await vfs.read(handle, 100, 200);

      // Verify bucket.get was called with range options
      expect(mockBucket.get).toHaveBeenCalledWith(
        'data/test.dat',
        expect.objectContaining({
          range: expect.objectContaining({
            offset: 100,
            length: 200,
          }),
        })
      );
    });

    it('should use suffix range for reading from end', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      // readFromEnd is a convenience method for reading last N bytes
      const bytes = await vfs.readFromEnd('data/test.dat', 100);

      expect(bytes.length).toBe(100);
      // Verify suffix range was used
      expect(mockBucket.get).toHaveBeenCalledWith(
        'data/test.dat',
        expect.objectContaining({
          range: expect.objectContaining({
            suffix: 100,
          }),
        })
      );
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Write Operations
// ============================================================================

describe('R2 VFS - Write Operations (TDD RED)', () => {
  /**
   * These tests verify the VFS can write new files and append to existing files.
   */

  describe('VFS can write new file to R2', () => {
    it('should write new file with data', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/new-file.dat', 'w');
      const dataToWrite = new Uint8Array([1, 2, 3, 4, 5]);
      await vfs.write(handle, dataToWrite);
      await vfs.close(handle);

      // Verify file was written
      expect(mockBucket.put).toHaveBeenCalled();

      // Verify file exists and has correct content
      const exists = await vfs.exists('data/new-file.dat');
      expect(exists).toBe(true);
    });

    it('should overwrite existing file when opened in write mode', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const existingData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/existing.dat': existingData,
      });

      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/existing.dat', 'w');
      const newData = new Uint8Array([10, 20, 30]);
      await vfs.write(handle, newData);
      await vfs.close(handle);

      // Verify new content size
      const stat = await vfs.stat('data/existing.dat');
      expect(stat.size).toBe(3);
    });

    it('should support multiple writes to same handle', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/multi-write.dat', 'w');
      await vfs.write(handle, new Uint8Array([1, 2, 3]));
      await vfs.write(handle, new Uint8Array([4, 5, 6]));
      await vfs.write(handle, new Uint8Array([7, 8, 9]));
      await vfs.close(handle);

      // Verify final size is sum of all writes
      const stat = await vfs.stat('data/multi-write.dat');
      expect(stat.size).toBe(9);
    });

    it('should update handle position after write', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/test.dat', 'w');
      expect(handle.position).toBe(0);

      await vfs.write(handle, new Uint8Array([1, 2, 3, 4, 5]));
      expect(handle.position).toBe(5);

      await vfs.write(handle, new Uint8Array([6, 7, 8]));
      expect(handle.position).toBe(8);
    });
  });

  describe('VFS can append to existing file', () => {
    it('should append data to existing file', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const existingData = new Uint8Array([1, 2, 3, 4, 5]).buffer;
      const mockBucket = createMockR2BucketForVFS({
        'data/append.dat': existingData,
      });

      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/append.dat', 'a');
      await vfs.write(handle, new Uint8Array([6, 7, 8, 9, 10]));
      await vfs.close(handle);

      // Verify final size includes both original and appended data
      const stat = await vfs.stat('data/append.dat');
      expect(stat.size).toBe(10);
    });

    it('should start position at end of file for append mode', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const existingData = generateTestFileData(500);
      const mockBucket = createMockR2BucketForVFS({
        'data/append.dat': existingData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/append.dat', 'a');

      expect(handle.position).toBe(500);
    });

    it('should preserve existing content when appending', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const existingData = new Uint8Array([1, 2, 3]).buffer;
      const mockBucket = createMockR2BucketForVFS({
        'data/append.dat': existingData,
      });

      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/append.dat', 'a');
      await vfs.write(handle, new Uint8Array([4, 5]));
      await vfs.close(handle);

      // Read back the full content
      const readHandle = await vfs.open('data/append.dat', 'r');
      const content = await vfs.read(readHandle, 0, 10);

      expect(Array.from(content)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should throw error when writing to read-only handle', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test.dat', 'r');

      await expect(vfs.write(handle, new Uint8Array([1, 2, 3]))).rejects.toThrow(/not open for writing|wrong mode/i);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Delete Operations
// ============================================================================

describe('R2 VFS - Delete Operations (TDD RED)', () => {
  describe('VFS can delete file from R2', () => {
    it('should delete existing file', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/to-delete.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      // Verify file exists before delete
      expect(await vfs.exists('data/to-delete.dat')).toBe(true);

      await vfs.delete('data/to-delete.dat');

      // Verify file no longer exists
      expect(await vfs.exists('data/to-delete.dat')).toBe(false);
      expect(mockBucket.delete).toHaveBeenCalledWith('data/to-delete.dat');
    });

    it('should not throw when deleting non-existent file', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      // Should not throw
      await expect(vfs.delete('data/non-existent.dat')).resolves.toBeUndefined();
    });

    it('should invalidate cached metadata after delete', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/cached.dat': testData,
      });

      const vfs = new R2VFS(mockBucket, { cacheMetadata: true });

      // Access to populate cache
      await vfs.stat('data/cached.dat');

      // Delete file
      await vfs.delete('data/cached.dat');

      // Stat should now fail (cache invalidated)
      await expect(vfs.stat('data/cached.dat')).rejects.toThrow(/not found/i);
    });

    it('should delete multiple files', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/file1.dat': testData,
        'data/file2.dat': testData,
        'data/file3.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      await vfs.delete('data/file1.dat');
      await vfs.delete('data/file2.dat');
      await vfs.delete('data/file3.dat');

      expect(await vfs.exists('data/file1.dat')).toBe(false);
      expect(await vfs.exists('data/file2.dat')).toBe(false);
      expect(await vfs.exists('data/file3.dat')).toBe(false);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - List Operations
// ============================================================================

describe('R2 VFS - List Operations (TDD RED)', () => {
  describe('VFS can list files in directory/prefix', () => {
    it('should list all files with prefix', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/file1.dat': testData,
        'data/file2.dat': testData,
        'data/subdir/file3.dat': testData,
        'other/file4.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const files = await vfs.list('data/');

      expect(files).toContain('data/file1.dat');
      expect(files).toContain('data/file2.dat');
      expect(files).toContain('data/subdir/file3.dat');
      expect(files).not.toContain('other/file4.dat');
    });

    it('should list files with empty prefix (all files)', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'file1.dat': testData,
        'data/file2.dat': testData,
        'other/file3.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const files = await vfs.list('');

      expect(files.length).toBe(3);
    });

    it('should return empty array for non-matching prefix', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/file1.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const files = await vfs.list('nonexistent/');

      expect(files).toEqual([]);
    });

    it('should support directory-style listing with delimiter', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/file1.dat': testData,
        'data/file2.dat': testData,
        'data/subdir/file3.dat': testData,
        'data/subdir/file4.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const result = await vfs.listDir('data/');

      // Should return files directly under prefix, plus subdirectory prefixes
      expect(result.files).toContain('data/file1.dat');
      expect(result.files).toContain('data/file2.dat');
      expect(result.directories).toContain('data/subdir/');
    });

    it('should handle pagination for large directories', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(10);
      const objects: Record<string, ArrayBuffer> = {};
      for (let i = 0; i < 100; i++) {
        objects[`data/file${i.toString().padStart(3, '0')}.dat`] = testData;
      }

      const mockBucket = createMockR2BucketForVFS(objects);
      const vfs = new R2VFS(mockBucket);

      const files = await vfs.list('data/');

      expect(files.length).toBe(100);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Stat Operations
// ============================================================================

describe('R2 VFS - Stat Operations (TDD RED)', () => {
  describe('VFS can get file size without downloading', () => {
    it('should return file size via stat', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(12345);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const stat = await vfs.stat('data/test.dat');

      expect(stat.size).toBe(12345);
      // Verify we used head, not get
      expect(mockBucket.head).toHaveBeenCalledWith('data/test.dat');
      expect(mockBucket.get).not.toHaveBeenCalled();
    });

    it('should return modified date via stat', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const stat = await vfs.stat('data/test.dat');

      expect(stat.modified).toBeInstanceOf(Date);
    });

    it('should return etag via stat', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const stat = await vfs.stat('data/test.dat');

      expect(stat.etag).toBeTruthy();
      expect(typeof stat.etag).toBe('string');
    });

    it('should throw for non-existent file', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      await expect(vfs.stat('data/nonexistent.dat')).rejects.toThrow(/not found/i);
    });

    it('should provide convenience size() method', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(5678);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const size = await vfs.size('data/test.dat');

      expect(size).toBe(5678);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Concurrent Access
// ============================================================================

describe('R2 VFS - Concurrent Access (TDD RED)', () => {
  describe('VFS supports concurrent reads from same file', () => {
    it('should handle multiple concurrent read handles', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/shared.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      // Open multiple handles to same file
      const handles = await Promise.all([
        vfs.open('data/shared.dat', 'r'),
        vfs.open('data/shared.dat', 'r'),
        vfs.open('data/shared.dat', 'r'),
      ]);

      expect(handles.length).toBe(3);
      expect(handles.every(h => h.valid)).toBe(true);
      expect(new Set(handles.map(h => h.id)).size).toBe(3); // All unique IDs
    });

    it('should handle concurrent reads at different offsets', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/shared.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/shared.dat', 'r');

      // Concurrent reads at different offsets
      const [bytes1, bytes2, bytes3] = await Promise.all([
        vfs.read(handle, 0, 100),
        vfs.read(handle, 100, 100),
        vfs.read(handle, 200, 100),
      ]);

      expect(bytes1.length).toBe(100);
      expect(bytes2.length).toBe(100);
      expect(bytes3.length).toBe(100);

      // Verify they got different data
      expect(bytes1[0]).not.toBe(bytes2[0]);
      expect(bytes2[0]).not.toBe(bytes3[0]);
    });

    it('should handle concurrent reads from different files', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({
        'file1.dat': generateTestFileData(100, 1),
        'file2.dat': generateTestFileData(100, 2),
        'file3.dat': generateTestFileData(100, 3),
      });

      const vfs = new R2VFS(mockBucket);

      // Open all files and read concurrently
      const handles = await Promise.all([
        vfs.open('file1.dat', 'r'),
        vfs.open('file2.dat', 'r'),
        vfs.open('file3.dat', 'r'),
      ]);

      const results = await Promise.all(
        handles.map(h => vfs.read(h, 0, 50))
      );

      expect(results.length).toBe(3);
      // Each file has different seed, so content should differ
      expect(results[0][0]).not.toBe(results[1][0]);
      expect(results[1][0]).not.toBe(results[2][0]);
    });

    it('should respect maxConcurrentReads option', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(1000);
      const mockBucket = createMockR2BucketForVFS({
        'data/shared.dat': testData,
      });

      // Limit concurrent reads to 2
      const vfs = new R2VFS(mockBucket, { maxConcurrentReads: 2 });
      const handle = await vfs.open('data/shared.dat', 'r');

      // Queue up 5 concurrent reads
      const startTime = Date.now();
      const results = await Promise.all([
        vfs.read(handle, 0, 100),
        vfs.read(handle, 100, 100),
        vfs.read(handle, 200, 100),
        vfs.read(handle, 300, 100),
        vfs.read(handle, 400, 100),
      ]);

      expect(results.length).toBe(5);
      // Reads should complete (implementation should handle queueing)
      expect(results.every(r => r.length === 100)).toBe(true);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Metadata Caching
// ============================================================================

describe('R2 VFS - Metadata Caching (TDD RED)', () => {
  describe('VFS caches file metadata to reduce R2 API calls', () => {
    it('should cache stat results', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket, { cacheMetadata: true });

      // First stat - should call bucket
      await vfs.stat('data/test.dat');
      expect(mockBucket.head).toHaveBeenCalledTimes(1);

      // Second stat - should use cache
      await vfs.stat('data/test.dat');
      expect(mockBucket.head).toHaveBeenCalledTimes(1); // Still 1

      // Third stat - still cached
      await vfs.stat('data/test.dat');
      expect(mockBucket.head).toHaveBeenCalledTimes(1);
    });

    it('should cache exists results', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket, { cacheMetadata: true });

      await vfs.exists('data/test.dat');
      await vfs.exists('data/test.dat');
      await vfs.exists('data/test.dat');

      // Should only make one head call
      expect(mockBucket.head).toHaveBeenCalledTimes(1);
    });

    it('should respect cache TTL', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      // Very short TTL for testing
      const vfs = new R2VFS(mockBucket, { cacheMetadata: true, cacheTTL: 50 });

      await vfs.stat('data/test.dat');
      expect(mockBucket.head).toHaveBeenCalledTimes(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      await vfs.stat('data/test.dat');
      expect(mockBucket.head).toHaveBeenCalledTimes(2); // Cache expired
    });

    it('should invalidate cache on write', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket, { cacheMetadata: true });

      // Cache the stat
      const stat1 = await vfs.stat('data/test.dat');
      expect(stat1.size).toBe(100);

      // Write to file
      const handle = await vfs.open('data/test.dat', 'w');
      await vfs.write(handle, new Uint8Array([1, 2, 3]));
      await vfs.close(handle);

      // Stat should reflect new size (cache invalidated)
      const stat2 = await vfs.stat('data/test.dat');
      expect(stat2.size).toBe(3);
    });

    it('should invalidate cache on delete', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket, { cacheMetadata: true });

      // Cache the existence
      expect(await vfs.exists('data/test.dat')).toBe(true);

      // Delete file
      await vfs.delete('data/test.dat');

      // Should reflect deletion (cache invalidated)
      expect(await vfs.exists('data/test.dat')).toBe(false);
    });

    it('should provide method to manually clear cache', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket, { cacheMetadata: true });

      await vfs.stat('data/test.dat');
      expect(mockBucket.head).toHaveBeenCalledTimes(1);

      // Clear cache
      vfs.clearCache();

      // Should make new call
      await vfs.stat('data/test.dat');
      expect(mockBucket.head).toHaveBeenCalledTimes(2);
    });

    it('should not cache when cacheMetadata is false', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket, { cacheMetadata: false });

      await vfs.stat('data/test.dat');
      await vfs.stat('data/test.dat');
      await vfs.stat('data/test.dat');

      // Should make call each time
      expect(mockBucket.head).toHaveBeenCalledTimes(3);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Large File Support
// ============================================================================

describe('R2 VFS - Large File Support (TDD RED)', () => {
  describe('VFS handles large files (multi-GB) efficiently', () => {
    it('should stat large file without downloading', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      // Simulate a 5GB file (we just mock the size, not actual data)
      const mockBucket = {
        head: vi.fn().mockResolvedValue({
          key: 'data/large.dat',
          size: 5 * 1024 * 1024 * 1024, // 5GB
          etag: 'large-file-etag',
          httpEtag: '"large-file-etag"',
          uploaded: new Date(),
        }),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const vfs = new R2VFS(mockBucket);
      const stat = await vfs.stat('data/large.dat');

      expect(stat.size).toBe(5 * 1024 * 1024 * 1024);
      expect(mockBucket.get).not.toHaveBeenCalled(); // Never downloaded
    });

    it('should support range reads on large files', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      // Mock bucket that returns specific range data
      const mockBucket = {
        head: vi.fn().mockResolvedValue({
          key: 'data/large.dat',
          size: 5 * 1024 * 1024 * 1024, // 5GB
          etag: 'large-file-etag',
          httpEtag: '"large-file-etag"',
          uploaded: new Date(),
        }),
        get: vi.fn().mockImplementation(async (_key: string, options?: { range?: { offset?: number; length?: number } }) => {
          const requestedLength = options?.range?.length || 1024;
          const data = new ArrayBuffer(requestedLength);
          const view = new Uint8Array(data);
          for (let i = 0; i < requestedLength; i++) {
            view[i] = i % 256;
          }
          return {
            key: 'data/large.dat',
            size: 5 * 1024 * 1024 * 1024,
            range: { offset: options?.range?.offset || 0, length: requestedLength },
            arrayBuffer: async () => data,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(view);
                controller.close();
              },
            }),
          };
        }),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/large.dat', 'r');

      // Read small chunk from middle of 5GB file
      const offset = 2.5 * 1024 * 1024 * 1024; // 2.5GB offset
      const bytes = await vfs.read(handle, offset, 1024);

      expect(bytes.length).toBe(1024);
      // Verify range was used
      expect(mockBucket.get).toHaveBeenCalledWith(
        'data/large.dat',
        expect.objectContaining({
          range: expect.objectContaining({
            offset: offset,
            length: 1024,
          }),
        })
      );
    });

    it('should support streaming reads for large chunks', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(10000);
      const mockBucket = createMockR2BucketForVFS({
        'data/medium.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/medium.dat', 'r');

      // Stream interface for large reads
      const stream = vfs.readStream(handle, 0, 10000);

      expect(stream).toBeInstanceOf(ReadableStream);

      // Read stream
      const reader = stream.getReader();
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

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      expect(totalLength).toBe(10000);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - File Handle Abstraction
// ============================================================================

describe('R2 VFS - File Handle Abstraction (TDD RED)', () => {
  describe('VFS provides file handle abstraction', () => {
    it('should track handle validity', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test.dat', 'r');

      expect(handle.valid).toBe(true);

      await vfs.close(handle);

      expect(handle.valid).toBe(false);
    });

    it('should throw when using closed handle', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test.dat', 'r');
      await vfs.close(handle);

      await expect(vfs.read(handle, 0, 100)).rejects.toThrow(/closed|invalid/i);
    });

    it('should throw when closing already closed handle', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('data/test.dat', 'r');

      await vfs.close(handle);

      await expect(vfs.close(handle)).rejects.toThrow(/already closed|invalid/i);
    });

    it('should track multiple handles independently', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      const handle1 = await vfs.open('data/test.dat', 'r');
      const handle2 = await vfs.open('data/test.dat', 'r');

      await vfs.close(handle1);

      expect(handle1.valid).toBe(false);
      expect(handle2.valid).toBe(true); // Still valid

      // Can still read with handle2
      const bytes = await vfs.read(handle2, 0, 10);
      expect(bytes.length).toBe(10);
    });

    it('should flush pending writes on close', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('data/test.dat', 'w');
      await vfs.write(handle, new Uint8Array([1, 2, 3]));

      // Before close, data might be buffered
      // After close, data must be persisted
      await vfs.close(handle);

      expect(mockBucket.put).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Sync and Async Operations
// ============================================================================

describe('R2 VFS - Sync and Async Operations (TDD RED)', () => {
  describe('VFS supports both sync and async operations', () => {
    it('should provide async open/read/write/close', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      // All operations return promises
      const handlePromise = vfs.open('data/test.dat', 'r');
      expect(handlePromise).toBeInstanceOf(Promise);

      const handle = await handlePromise;
      const readPromise = vfs.read(handle, 0, 10);
      expect(readPromise).toBeInstanceOf(Promise);

      await readPromise;
      const closePromise = vfs.close(handle);
      expect(closePromise).toBeInstanceOf(Promise);
    });

    it('should provide synchronous-style wrapper with callbacks', async () => {
      const { R2VFS, createSyncVFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const asyncVfs = new R2VFS(mockBucket);
      const syncVfs = createSyncVFS(asyncVfs);

      // Callback-style API for SQLite integration
      let result: Uint8Array | null = null;
      let error: Error | null = null;

      syncVfs.open('data/test.dat', 'r', (err, handle) => {
        if (err) {
          error = err;
          return;
        }
        syncVfs.read(handle!, 0, 10, (readErr, data) => {
          if (readErr) {
            error = readErr;
            return;
          }
          result = data;
          syncVfs.close(handle!, () => {});
        });
      });

      // Wait for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(error).toBeNull();
      expect(result).not.toBeNull();
      expect(result!.length).toBe(10);
    });

    it('should support promise chaining', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      // Chain operations
      const result = await vfs.open('data/test.dat', 'r')
        .then(handle => vfs.read(handle, 0, 10)
          .then(data => ({ handle, data })))
        .then(({ handle, data }) => {
          return vfs.close(handle).then(() => data);
        });

      expect(result.length).toBe(10);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Error Handling
// ============================================================================

describe('R2 VFS - Error Handling (TDD RED)', () => {
  describe('Error handling for missing files, permission errors', () => {
    it('should throw FileNotFoundError for missing file read', async () => {
      const { R2VFS, FileNotFoundError } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      try {
        await vfs.open('nonexistent/file.dat', 'r');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FileNotFoundError);
        expect((err as Error).message).toMatch(/not found/i);
      }
    });

    it('should throw PermissionError for unauthorized operations', async () => {
      const { R2VFS, PermissionError } = await import('../../src/r2-vfs');

      // Mock bucket that rejects writes
      const mockBucket = {
        head: vi.fn().mockResolvedValue({ key: 'test.dat', size: 100 }),
        get: vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(100) }),
        put: vi.fn().mockRejectedValue(new Error('Access Denied')),
        delete: vi.fn().mockRejectedValue(new Error('Access Denied')),
        list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
      };

      const vfs = new R2VFS(mockBucket);

      const handle = await vfs.open('test.dat', 'w');
      try {
        await vfs.write(handle, new Uint8Array([1, 2, 3]));
        await vfs.close(handle);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PermissionError);
      }
    });

    it('should throw InvalidHandleError for operations on closed handle', async () => {
      const { R2VFS, InvalidHandleError } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('test.dat', 'r');
      await vfs.close(handle);

      try {
        await vfs.read(handle, 0, 10);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidHandleError);
      }
    });

    it('should throw ModeError for wrong operation mode', async () => {
      const { R2VFS, ModeError } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'test.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);
      const handle = await vfs.open('test.dat', 'r');

      try {
        await vfs.write(handle, new Uint8Array([1, 2, 3]));
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ModeError);
        expect((err as Error).message).toMatch(/not open for writing/i);
      }
    });

    it('should handle network errors gracefully', async () => {
      const { R2VFS, NetworkError } = await import('../../src/r2-vfs');

      const mockBucket = {
        head: vi.fn().mockRejectedValue(new Error('Network timeout')),
        get: vi.fn().mockRejectedValue(new Error('Network timeout')),
        put: vi.fn().mockRejectedValue(new Error('Network timeout')),
        delete: vi.fn().mockRejectedValue(new Error('Network timeout')),
        list: vi.fn().mockRejectedValue(new Error('Network timeout')),
      };

      const vfs = new R2VFS(mockBucket);

      try {
        await vfs.stat('test.dat');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NetworkError);
      }
    });

    it('should include path in error messages', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      try {
        await vfs.open('some/specific/path/file.dat', 'r');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('some/specific/path/file.dat');
      }
    });

    it('should handle R2 rate limiting', async () => {
      const { R2VFS, RateLimitError } = await import('../../src/r2-vfs');

      let callCount = 0;
      const mockBucket = {
        head: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 3) {
            const err = new Error('Rate limited');
            (err as Error & { code: number }).code = 429;
            throw err;
          }
          return { key: 'test.dat', size: 100 };
        }),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const vfs = new R2VFS(mockBucket, { retryOnRateLimit: false });

      try {
        await vfs.stat('test.dat');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
      }
    });

    it('should retry on transient errors when configured', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      let callCount = 0;
      const testData = generateTestFileData(100);
      const mockBucket = {
        head: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error('Temporary failure');
          }
          return {
            key: 'test.dat',
            size: testData.byteLength,
            etag: 'test-etag',
          };
        }),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      };

      const vfs = new R2VFS(mockBucket, { retryCount: 3, retryDelayMs: 10 });

      const stat = await vfs.stat('test.dat');

      expect(stat.size).toBe(100);
      expect(callCount).toBe(3);
    });
  });
});

// ============================================================================
// Test Suite: R2 VFS - Integration Scenarios
// ============================================================================

describe('R2 VFS - Integration Scenarios (TDD RED)', () => {
  describe('Real-world usage patterns', () => {
    it('should support Parquet footer reading pattern', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      // Simulate a Parquet file
      const parquetData = new ArrayBuffer(10000);
      const view = new Uint8Array(parquetData);
      // Magic bytes at start and end
      view.set([0x50, 0x41, 0x52, 0x31], 0); // PAR1 at start
      view.set([0x50, 0x41, 0x52, 0x31], parquetData.byteLength - 4); // PAR1 at end
      // Footer length (4 bytes before magic)
      const footerLen = 100;
      const footerLenView = new DataView(parquetData, parquetData.byteLength - 8, 4);
      footerLenView.setUint32(0, footerLen, true);

      const mockBucket = createMockR2BucketForVFS({
        'data/file.parquet': parquetData,
      });

      const vfs = new R2VFS(mockBucket);

      // Step 1: Read last 8 bytes (footer length + magic)
      const tail = await vfs.readFromEnd('data/file.parquet', 8);
      expect(tail.length).toBe(8);

      // Verify magic
      expect(tail[4]).toBe(0x50);
      expect(tail[5]).toBe(0x41);
      expect(tail[6]).toBe(0x52);
      expect(tail[7]).toBe(0x31);

      // Step 2: Read full footer
      const footerLength = new DataView(tail.buffer, tail.byteOffset, 4).getUint32(0, true);
      const fullFooter = await vfs.readFromEnd('data/file.parquet', footerLength + 8);
      expect(fullFooter.length).toBe(footerLength + 8);
    });

    it('should support incremental write pattern (log files)', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const mockBucket = createMockR2BucketForVFS({});
      const vfs = new R2VFS(mockBucket);

      // Create new log file
      let handle = await vfs.open('logs/app.log', 'w');
      await vfs.write(handle, new TextEncoder().encode('Log entry 1\n'));
      await vfs.close(handle);

      // Append more entries
      handle = await vfs.open('logs/app.log', 'a');
      await vfs.write(handle, new TextEncoder().encode('Log entry 2\n'));
      await vfs.write(handle, new TextEncoder().encode('Log entry 3\n'));
      await vfs.close(handle);

      // Verify content
      handle = await vfs.open('logs/app.log', 'r');
      const content = await vfs.read(handle, 0, 1000);
      await vfs.close(handle);

      const text = new TextDecoder().decode(content);
      expect(text).toContain('Log entry 1');
      expect(text).toContain('Log entry 2');
      expect(text).toContain('Log entry 3');
    });

    it('should support directory traversal pattern', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'data/2024/01/file1.dat': testData,
        'data/2024/01/file2.dat': testData,
        'data/2024/02/file3.dat': testData,
        'data/2024/02/file4.dat': testData,
        'data/2025/01/file5.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      // List years
      const yearResult = await vfs.listDir('data/');
      expect(yearResult.directories).toContain('data/2024/');
      expect(yearResult.directories).toContain('data/2025/');

      // List months in 2024
      const monthResult = await vfs.listDir('data/2024/');
      expect(monthResult.directories).toContain('data/2024/01/');
      expect(monthResult.directories).toContain('data/2024/02/');

      // List files in specific month
      const fileResult = await vfs.listDir('data/2024/01/');
      expect(fileResult.files).toContain('data/2024/01/file1.dat');
      expect(fileResult.files).toContain('data/2024/01/file2.dat');
    });

    it('should support batch file operations', async () => {
      const { R2VFS } = await import('../../src/r2-vfs');

      const testData = generateTestFileData(100);
      const mockBucket = createMockR2BucketForVFS({
        'batch/file1.dat': testData,
        'batch/file2.dat': testData,
        'batch/file3.dat': testData,
      });

      const vfs = new R2VFS(mockBucket);

      // Batch stat
      const files = await vfs.list('batch/');
      const stats = await Promise.all(files.map(f => vfs.stat(f)));

      expect(stats.length).toBe(3);
      expect(stats.every(s => s.size === 100)).toBe(true);

      // Batch delete
      await Promise.all(files.map(f => vfs.delete(f)));

      const remaining = await vfs.list('batch/');
      expect(remaining.length).toBe(0);
    });
  });
});

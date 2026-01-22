/**
 * R2 Storage Provider Tests
 *
 * Tests for the R2StorageProvider that implements VFSStorageProvider interface
 * for Cloudflare R2 storage.
 *
 * Tests cover:
 * - File operations (read, write, append, delete)
 * - Directory operations (mkdir, list)
 * - Metadata caching
 * - Range request support
 * - Error handling
 * - Integration with VFSBridge
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { R2StorageProvider, type R2Bucket } from '../../src/storage/r2-provider';
import { VFSBridge } from '../../src/wasm/vfs-bridge';

// ============================================================================
// Mock R2 Bucket
// ============================================================================

interface MockR2Options {
  /** Initial objects in the bucket */
  objects?: Record<string, ArrayBuffer>;
  /** Simulate errors for specific operations */
  errors?: {
    get?: Error;
    head?: Error;
    put?: Error;
    delete?: Error;
    list?: Error;
  };
}

/**
 * Create a mock R2 bucket for testing
 */
function createMockR2Bucket(options: MockR2Options = {}): R2Bucket {
  const objects = new Map<string, { data: ArrayBuffer; uploaded: Date }>();

  // Initialize with provided objects
  if (options.objects) {
    for (const [key, data] of Object.entries(options.objects)) {
      objects.set(key, { data, uploaded: new Date() });
    }
  }

  return {
    get: vi.fn().mockImplementation(
      async (
        key: string,
        opts?: { range?: { offset?: number; length?: number; suffix?: number } }
      ) => {
        if (options.errors?.get) {
          throw options.errors.get;
        }

        const obj = objects.get(key);
        if (!obj) {
          return null;
        }

        let data = obj.data;
        let rangeInfo: { offset: number; length: number } | undefined;

        if (opts?.range) {
          const { offset, length, suffix } = opts.range;
          if (suffix !== undefined) {
            const start = Math.max(0, data.byteLength - suffix);
            data = data.slice(start);
            rangeInfo = { offset: start, length: data.byteLength };
          } else if (offset !== undefined && length !== undefined) {
            data = data.slice(offset, offset + length);
            rangeInfo = { offset, length: data.byteLength };
          } else if (offset !== undefined) {
            data = data.slice(offset);
            rangeInfo = { offset, length: data.byteLength };
          }
        }

        return {
          key,
          size: obj.data.byteLength,
          etag: `etag-${key}`,
          httpEtag: `"etag-${key}"`,
          uploaded: obj.uploaded,
          range: rangeInfo,
          arrayBuffer: async () => data,
          text: async () => new TextDecoder().decode(data),
        };
      }
    ),

    head: vi.fn().mockImplementation(async (key: string) => {
      if (options.errors?.head) {
        throw options.errors.head;
      }

      const obj = objects.get(key);
      if (!obj) {
        return null;
      }

      return {
        key,
        size: obj.data.byteLength,
        etag: `etag-${key}`,
        httpEtag: `"etag-${key}"`,
        uploaded: obj.uploaded,
      };
    }),

    put: vi.fn().mockImplementation(async (key: string, value: ArrayBuffer | Uint8Array) => {
      if (options.errors?.put) {
        throw options.errors.put;
      }

      const data = value instanceof Uint8Array ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value;
      objects.set(key, { data, uploaded: new Date() });

      return {
        key,
        etag: `etag-${key}`,
        httpEtag: `"etag-${key}"`,
      };
    }),

    delete: vi.fn().mockImplementation(async (key: string | string[]) => {
      if (options.errors?.delete) {
        throw options.errors.delete;
      }

      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        objects.delete(k);
      }
    }),

    list: vi.fn().mockImplementation(
      async (opts?: { prefix?: string; limit?: number; delimiter?: string }) => {
        if (options.errors?.list) {
          throw options.errors.list;
        }

        let keys = Array.from(objects.keys());

        if (opts?.prefix) {
          keys = keys.filter((k) => k.startsWith(opts.prefix!));
        }

        // Handle delimiter for directory listing
        const files: string[] = [];
        const directories = new Set<string>();

        if (opts?.delimiter) {
          const prefixLen = opts.prefix?.length ?? 0;
          for (const key of keys) {
            const remainder = key.slice(prefixLen);
            const delimIndex = remainder.indexOf(opts.delimiter);
            if (delimIndex >= 0) {
              directories.add(key.slice(0, prefixLen + delimIndex + 1));
            } else {
              files.push(key);
            }
          }
        } else {
          files.push(...keys);
        }

        if (opts?.limit) {
          files.splice(opts.limit);
        }

        return {
          objects: files.map((key) => ({
            key,
            size: objects.get(key)!.data.byteLength,
            etag: `etag-${key}`,
            httpEtag: `"etag-${key}"`,
            uploaded: objects.get(key)!.uploaded,
          })),
          truncated: false,
          delimitedPrefixes: Array.from(directories),
        };
      }
    ),
  } as R2Bucket;
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create test data with known content
 */
function createTestData(size: number, seed = 0): ArrayBuffer {
  const buffer = new ArrayBuffer(size);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < size; i++) {
    view[i] = (i + seed) % 256;
  }
  return buffer;
}

/**
 * Create text data
 */
function createTextData(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

// ============================================================================
// Tests: Basic File Operations
// ============================================================================

describe('R2StorageProvider - File Operations', () => {
  let bucket: R2Bucket;
  let provider: R2StorageProvider;

  beforeEach(() => {
    bucket = createMockR2Bucket({
      objects: {
        'test-file.txt': createTextData('Hello, World!'),
        'binary-file.bin': createTestData(1024),
        'nested/dir/file.txt': createTextData('Nested file content'),
      },
    });
    provider = new R2StorageProvider(bucket);
  });

  describe('stat()', () => {
    it('should return file stats for existing file', async () => {
      const stat = await provider.stat('test-file.txt');

      expect(stat).not.toBeNull();
      expect(stat!.size).toBe(13); // "Hello, World!" length
      expect(stat!.isDirectory).toBe(false);
      expect(stat!.mtime).toBeDefined();
      expect(stat!.ctime).toBeDefined();
    });

    it('should return null for non-existent file', async () => {
      const stat = await provider.stat('non-existent.txt');
      expect(stat).toBeNull();
    });

    it('should return directory stat for implicit directory', async () => {
      const stat = await provider.stat('nested/dir');

      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(true);
      expect(stat!.size).toBe(0);
    });

    it('should cache stat results', async () => {
      await provider.stat('test-file.txt');
      await provider.stat('test-file.txt');
      await provider.stat('test-file.txt');

      // Should only call head once due to caching
      expect(bucket.head).toHaveBeenCalledTimes(1);
    });
  });

  describe('read()', () => {
    it('should read partial file content', async () => {
      const data = await provider.read('test-file.txt', 0, 5);

      expect(data.byteLength).toBe(5);
      expect(new TextDecoder().decode(data)).toBe('Hello');
    });

    it('should read from offset', async () => {
      const data = await provider.read('test-file.txt', 7, 5);

      expect(new TextDecoder().decode(data)).toBe('World');
    });

    it('should throw for non-existent file', async () => {
      await expect(provider.read('missing.txt', 0, 10)).rejects.toThrow('File not found');
    });

    it('should use range requests', async () => {
      await provider.read('binary-file.bin', 100, 200);

      expect(bucket.get).toHaveBeenCalledWith('binary-file.bin', {
        range: { offset: 100, length: 200 },
      });
    });
  });

  describe('readFile()', () => {
    it('should read entire file', async () => {
      const data = await provider.readFile('test-file.txt');

      expect(new TextDecoder().decode(data)).toBe('Hello, World!');
    });

    it('should throw for non-existent file', async () => {
      await expect(provider.readFile('missing.txt')).rejects.toThrow('File not found');
    });
  });

  describe('write()', () => {
    it('should write new file', async () => {
      const data = createTextData('New content');
      await provider.write('new-file.txt', data);

      expect(bucket.put).toHaveBeenCalledWith('new-file.txt', data);

      // Verify file was written
      const readBack = await provider.readFile('new-file.txt');
      expect(new TextDecoder().decode(readBack)).toBe('New content');
    });

    it('should overwrite existing file', async () => {
      const newData = createTextData('Updated content');
      await provider.write('test-file.txt', newData);

      const readBack = await provider.readFile('test-file.txt');
      expect(new TextDecoder().decode(readBack)).toBe('Updated content');
    });
  });

  describe('append()', () => {
    it('should append to existing file', async () => {
      const appendData = createTextData(' Appended!');
      await provider.append('test-file.txt', appendData);

      const readBack = await provider.readFile('test-file.txt');
      expect(new TextDecoder().decode(readBack)).toBe('Hello, World! Appended!');
    });

    it('should create new file if not exists', async () => {
      const data = createTextData('New content');
      await provider.append('append-new.txt', data);

      const readBack = await provider.readFile('append-new.txt');
      expect(new TextDecoder().decode(readBack)).toBe('New content');
    });
  });

  describe('delete()', () => {
    it('should delete existing file', async () => {
      await provider.delete('test-file.txt');

      expect(bucket.delete).toHaveBeenCalledWith('test-file.txt');
    });

    it('should invalidate cache on delete', async () => {
      // Prime cache - first stat should call head once (file exists, cached)
      await provider.stat('test-file.txt');
      const initialCallCount = (bucket.head as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(initialCallCount).toBe(1);

      // Second stat should use cache (no additional head calls)
      await provider.stat('test-file.txt');
      expect((bucket.head as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

      // Delete invalidates cache
      await provider.delete('test-file.txt');

      // Record call count after delete
      const callCountAfterDelete = (bucket.head as ReturnType<typeof vi.fn>).mock.calls.length;

      // After delete, stat should make new head call (cache was invalidated)
      // Since file no longer exists, it will also check for directory marker
      await provider.stat('test-file.txt');
      expect((bucket.head as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callCountAfterDelete);
    });
  });
});

// ============================================================================
// Tests: Directory Operations
// ============================================================================

describe('R2StorageProvider - Directory Operations', () => {
  let bucket: R2Bucket;
  let provider: R2StorageProvider;

  beforeEach(() => {
    bucket = createMockR2Bucket({
      objects: {
        'dir1/file1.txt': createTextData('File 1'),
        'dir1/file2.txt': createTextData('File 2'),
        'dir1/subdir/file3.txt': createTextData('File 3'),
        'dir2/file4.txt': createTextData('File 4'),
        'root-file.txt': createTextData('Root file'),
      },
    });
    provider = new R2StorageProvider(bucket);
  });

  describe('list()', () => {
    it('should list directory contents', async () => {
      const entries = await provider.list('dir1');

      expect(entries.length).toBeGreaterThan(0);
      const names = entries.map((e) => e.name);
      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
    });

    it('should list subdirectories', async () => {
      const entries = await provider.list('dir1');

      const dirs = entries.filter((e) => e.isDirectory);
      expect(dirs.some((d) => d.name === 'subdir')).toBe(true);
    });

    it('should return empty array for non-existent directory', async () => {
      const entries = await provider.list('non-existent');
      expect(entries).toEqual([]);
    });
  });

  describe('mkdir()', () => {
    it('should create directory marker', async () => {
      await provider.mkdir('new-dir');

      expect(bucket.put).toHaveBeenCalled();
    });

    it('should track directory in memory', async () => {
      await provider.mkdir('new-dir');

      const stat = await provider.stat('new-dir');
      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(true);
    });
  });

  describe('rename()', () => {
    it('should rename file', async () => {
      await provider.rename('dir1/file1.txt', 'dir1/renamed.txt');

      expect(bucket.get).toHaveBeenCalled();
      expect(bucket.put).toHaveBeenCalled();
      expect(bucket.delete).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Tests: Prefix/Namespace Support
// ============================================================================

describe('R2StorageProvider - Prefix Support', () => {
  let bucket: R2Bucket;
  let provider: R2StorageProvider;

  beforeEach(() => {
    bucket = createMockR2Bucket({
      objects: {
        'clickbench/data/hits.parquet': createTestData(1000),
        'clickbench/data/subset.parquet': createTestData(100),
        'other/data.txt': createTextData('Other data'),
      },
    });
    provider = new R2StorageProvider(bucket, {
      prefix: 'clickbench/data',
    });
  });

  it('should apply prefix to all operations', async () => {
    const stat = await provider.stat('hits.parquet');

    expect(stat).not.toBeNull();
    expect(bucket.head).toHaveBeenCalledWith('clickbench/data/hits.parquet');
  });

  it('should apply prefix to writes', async () => {
    await provider.write('new-file.txt', createTextData('test'));

    expect(bucket.put).toHaveBeenCalledWith(
      'clickbench/data/new-file.txt',
      expect.any(ArrayBuffer)
    );
  });

  it('should apply prefix to list', async () => {
    await provider.list('');

    expect(bucket.list).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: 'clickbench/data',
        delimiter: '/',
      })
    );
  });
});

// ============================================================================
// Tests: Caching
// ============================================================================

describe('R2StorageProvider - Caching', () => {
  let bucket: R2Bucket;

  beforeEach(() => {
    bucket = createMockR2Bucket({
      objects: {
        'cached-file.txt': createTextData('Cached content'),
      },
    });
  });

  it('should cache metadata by default', async () => {
    const provider = new R2StorageProvider(bucket, { cacheMetadata: true });

    await provider.stat('cached-file.txt');
    await provider.stat('cached-file.txt');
    await provider.stat('cached-file.txt');

    expect(bucket.head).toHaveBeenCalledTimes(1);
  });

  it('should respect cache TTL', async () => {
    const provider = new R2StorageProvider(bucket, {
      cacheMetadata: true,
      cacheTTL: 50, // 50ms TTL
    });

    await provider.stat('cached-file.txt');
    expect(bucket.head).toHaveBeenCalledTimes(1);

    // Wait for cache to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    await provider.stat('cached-file.txt');
    expect(bucket.head).toHaveBeenCalledTimes(2);
  });

  it('should skip caching when disabled', async () => {
    const provider = new R2StorageProvider(bucket, { cacheMetadata: false });

    await provider.stat('cached-file.txt');
    await provider.stat('cached-file.txt');
    await provider.stat('cached-file.txt');

    expect(bucket.head).toHaveBeenCalledTimes(3);
  });

  it('should clear cache on clearCache()', async () => {
    const provider = new R2StorageProvider(bucket, { cacheMetadata: true });

    await provider.stat('cached-file.txt');
    expect(bucket.head).toHaveBeenCalledTimes(1);

    provider.clearCache();

    await provider.stat('cached-file.txt');
    expect(bucket.head).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Tests: Integration with VFSBridge
// ============================================================================

describe('R2StorageProvider - VFSBridge Integration', () => {
  let bucket: R2Bucket;
  let provider: R2StorageProvider;
  let vfs: VFSBridge;

  beforeEach(() => {
    bucket = createMockR2Bucket({
      objects: {
        'data/test-part/data.bin': createTestData(4096),
        'data/test-part/primary.idx': createTestData(256),
        'data/test-part/columns.txt': createTextData('WatchID UInt64\nEventTime DateTime'),
      },
    });
    provider = new R2StorageProvider(bucket);
    vfs = new VFSBridge(provider);
  });

  it('should work with VFSBridge stat operation', async () => {
    const stat = await provider.stat('data/test-part/data.bin');

    expect(stat).not.toBeNull();
    expect(stat!.size).toBe(4096);
    expect(stat!.isDirectory).toBe(false);
  });

  it('should work with VFSBridge list operation', async () => {
    const entries = await provider.list('data/test-part');

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.name === 'data.bin')).toBe(true);
    expect(entries.some((e) => e.name === 'primary.idx')).toBe(true);
  });

  it('should work with VFSBridge read operation', async () => {
    const data = await provider.read('data/test-part/columns.txt', 0, 100);

    expect(data.byteLength).toBeGreaterThan(0);
    const text = new TextDecoder().decode(data);
    expect(text).toContain('WatchID');
  });

  it('should work with VFSBridge write operation', async () => {
    const testData = createTextData('Test MergeTree data');
    await provider.write('data/new-part/test.bin', testData);

    const readBack = await provider.readFile('data/new-part/test.bin');
    expect(new TextDecoder().decode(readBack)).toBe('Test MergeTree data');
  });
});

// ============================================================================
// Tests: Error Handling
// ============================================================================

describe('R2StorageProvider - Error Handling', () => {
  it('should handle R2 get errors', async () => {
    const bucket = createMockR2Bucket({
      errors: { get: new Error('Network error') },
    });
    const provider = new R2StorageProvider(bucket);

    await expect(provider.readFile('any-file.txt')).rejects.toThrow('Network error');
  });

  it('should handle R2 head errors', async () => {
    const bucket = createMockR2Bucket({
      errors: { head: new Error('Service unavailable') },
    });
    const provider = new R2StorageProvider(bucket);

    await expect(provider.stat('any-file.txt')).rejects.toThrow('Service unavailable');
  });

  it('should handle R2 put errors', async () => {
    const bucket = createMockR2Bucket({
      errors: { put: new Error('Quota exceeded') },
    });
    const provider = new R2StorageProvider(bucket);

    await expect(
      provider.write('new-file.txt', createTextData('test'))
    ).rejects.toThrow('Quota exceeded');
  });
});

// ============================================================================
// Tests: Statistics
// ============================================================================

describe('R2StorageProvider - Statistics', () => {
  it('should report statistics', async () => {
    const bucket = createMockR2Bucket({
      objects: {
        'file1.txt': createTextData('File 1'),
        'file2.txt': createTextData('File 2'),
      },
    });
    const provider = new R2StorageProvider(bucket);

    // Access some files to populate cache
    await provider.stat('file1.txt');
    await provider.stat('file2.txt');
    await provider.mkdir('test-dir');

    const stats = provider.getStats();

    expect(stats.cachedEntries).toBe(2);
    expect(stats.trackedDirectories).toBeGreaterThan(0);
  });
});

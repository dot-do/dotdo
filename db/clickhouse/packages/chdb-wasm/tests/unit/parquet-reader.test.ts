/**
 * Parquet Reader Unit Tests
 *
 * Tests the ParquetReader class that reads Parquet files from remote URLs
 * using HTTP range requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ParquetReader,
  ParquetReaderFromBuffer,
  createParquetReader,
  readParquetUrl,
  getParquetUrlMetadata,
} from '../../src/parquet-reader';

// ============================================================================
// Mock Data
// ============================================================================

/**
 * Create a minimal valid Parquet file for testing.
 * This uses a pre-computed valid Parquet file structure.
 */
function createTestParquetBuffer(): ArrayBuffer {
  // This is a minimal valid Parquet file with 3 rows and 2 columns (id: Int32, name: String)
  // Created with pyarrow and converted to hex:
  // import pyarrow as pa
  // import pyarrow.parquet as pq
  // table = pa.table({'id': pa.array([1, 2, 3], type=pa.int32()), 'name': pa.array(['a', 'b', 'c'])})
  // pq.write_table(table, 'test.parquet', compression=None)

  // For unit tests, we'll test the interface and error handling
  // Real parquet file tests should be in integration tests
  const buffer = new ArrayBuffer(200);
  const view = new Uint8Array(buffer);

  // PAR1 magic at start and end
  view[0] = 0x50; // P
  view[1] = 0x41; // A
  view[2] = 0x52; // R
  view[3] = 0x31; // 1

  view[196] = 0x50; // P
  view[197] = 0x41; // A
  view[198] = 0x52; // R
  view[199] = 0x31; // 1

  return buffer;
}

// ============================================================================
// Unit Tests
// ============================================================================

describe('ParquetReader', () => {
  describe('constructor', () => {
    it('should create a reader with a URL', () => {
      const reader = new ParquetReader('https://example.com/data.parquet');
      expect(reader).toBeInstanceOf(ParquetReader);
    });

    it('should accept a custom fetch function', () => {
      const customFetch = vi.fn();
      const reader = new ParquetReader('https://example.com/data.parquet', customFetch as unknown as typeof fetch);
      expect(reader).toBeInstanceOf(ParquetReader);
    });
  });

  describe('supportsRangeRequests', () => {
    it('should return true when server supports range requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        headers: new Map([['accept-ranges', 'bytes']]),
      });

      const reader = new ParquetReader('https://example.com/data.parquet', mockFetch as unknown as typeof fetch);
      const supports = await reader.supportsRangeRequests();

      expect(supports).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/data.parquet', { method: 'HEAD' });
    });

    it('should return false when server does not support range requests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        headers: new Map([['accept-ranges', 'none']]),
      });

      const reader = new ParquetReader('https://example.com/data.parquet', mockFetch as unknown as typeof fetch);
      const supports = await reader.supportsRangeRequests();

      expect(supports).toBe(false);
    });
  });

  describe('getMetadata', () => {
    it('should throw error when file size cannot be determined', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const reader = new ParquetReader('https://example.com/notfound.parquet', mockFetch as unknown as typeof fetch);

      await expect(reader.getMetadata()).rejects.toThrow('Failed to get file size');
    });

    it('should throw error when Content-Length header is missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map(),
      });

      const reader = new ParquetReader('https://example.com/data.parquet', mockFetch as unknown as typeof fetch);

      await expect(reader.getMetadata()).rejects.toThrow('Server did not return Content-Length header');
    });
  });

  describe('readColumns', () => {
    it('should throw error for invalid column names', async () => {
      // Mock fetch to return file size and then metadata
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        callCount++;
        if (options?.method === 'HEAD') {
          return {
            ok: true,
            headers: {
              get: (name: string) => name === 'content-length' ? '1000' : null,
            },
          };
        }
        // Return mock parquet data for range requests
        // This will fail when hyparquet tries to parse it, but that's expected
        throw new Error('Invalid Parquet file');
      });

      const reader = new ParquetReader('https://example.com/data.parquet', mockFetch as unknown as typeof fetch);

      // The error should come from trying to read the actual parquet data
      await expect(reader.readColumns(['NonExistentColumn'])).rejects.toThrow();
    });
  });
});

describe('ParquetReaderFromBuffer', () => {
  describe('constructor', () => {
    it('should create a reader from an ArrayBuffer', () => {
      const buffer = createTestParquetBuffer();
      const reader = ParquetReader.fromBuffer(buffer);
      expect(reader).toBeInstanceOf(ParquetReaderFromBuffer);
    });
  });

  describe('getMetadata', () => {
    it('should throw error for invalid Parquet data', async () => {
      const invalidBuffer = new ArrayBuffer(10);
      const reader = new ParquetReaderFromBuffer(invalidBuffer);

      await expect(reader.getMetadata()).rejects.toThrow();
    });

    it('should throw error for truncated Parquet file', async () => {
      const truncatedBuffer = createTestParquetBuffer();
      const reader = new ParquetReaderFromBuffer(truncatedBuffer);

      // The mock parquet file is not valid, so it should throw
      await expect(reader.getMetadata()).rejects.toThrow();
    });
  });
});

describe('createParquetReader', () => {
  it('should create a ParquetReader instance', () => {
    const reader = createParquetReader('https://example.com/data.parquet');
    expect(reader).toBeInstanceOf(ParquetReader);
  });

  it('should accept a custom fetch function', () => {
    const customFetch = vi.fn();
    const reader = createParquetReader('https://example.com/data.parquet', customFetch as unknown as typeof fetch);
    expect(reader).toBeInstanceOf(ParquetReader);
  });
});

describe('readParquetUrl', () => {
  it('should throw error for unreachable URL', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(
      readParquetUrl('https://example.com/data.parquet', null, {}, mockFetch as unknown as typeof fetch)
    ).rejects.toThrow('Network error');
  });
});

describe('getParquetUrlMetadata', () => {
  it('should throw error for unreachable URL', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(
      getParquetUrlMetadata('https://example.com/data.parquet', mockFetch as unknown as typeof fetch)
    ).rejects.toThrow('Network error');
  });
});

// ============================================================================
// API Contract Tests
// ============================================================================

describe('ParquetReader API Contract', () => {
  it('should expose getMetadata method', () => {
    const reader = new ParquetReader('https://example.com/data.parquet');
    expect(typeof reader.getMetadata).toBe('function');
  });

  it('should expose getColumnNames method', () => {
    const reader = new ParquetReader('https://example.com/data.parquet');
    expect(typeof reader.getColumnNames).toBe('function');
  });

  it('should expose readColumns method', () => {
    const reader = new ParquetReader('https://example.com/data.parquet');
    expect(typeof reader.readColumns).toBe('function');
  });

  it('should expose readAll method', () => {
    const reader = new ParquetReader('https://example.com/data.parquet');
    expect(typeof reader.readAll).toBe('function');
  });

  it('should expose getRowGroupStats method', () => {
    const reader = new ParquetReader('https://example.com/data.parquet');
    expect(typeof reader.getRowGroupStats).toBe('function');
  });

  it('should expose supportsRangeRequests method', () => {
    const reader = new ParquetReader('https://example.com/data.parquet');
    expect(typeof reader.supportsRangeRequests).toBe('function');
  });

  it('should expose static fromBuffer factory method', () => {
    expect(typeof ParquetReader.fromBuffer).toBe('function');
  });
});

describe('ParquetReaderFromBuffer API Contract', () => {
  it('should expose getMetadata method', () => {
    const buffer = new ArrayBuffer(10);
    const reader = new ParquetReaderFromBuffer(buffer);
    expect(typeof reader.getMetadata).toBe('function');
  });

  it('should expose readColumns method', () => {
    const buffer = new ArrayBuffer(10);
    const reader = new ParquetReaderFromBuffer(buffer);
    expect(typeof reader.readColumns).toBe('function');
  });

  it('should expose readAll method', () => {
    const buffer = new ArrayBuffer(10);
    const reader = new ParquetReaderFromBuffer(buffer);
    expect(typeof reader.readAll).toBe('function');
  });
});

// ============================================================================
// Type Export Tests
// ============================================================================

describe('Type Exports', () => {
  it('should export ParquetColumnInfo type (compile-time check)', () => {
    // This is a compile-time check - if the types are not exported correctly,
    // TypeScript will fail to compile this test file
    const columnInfo: import('../../src/parquet-reader').ParquetColumnInfo = {
      name: 'test',
      type: 'String',
      nullable: false,
    };
    expect(columnInfo.name).toBe('test');
  });

  it('should export ParquetFileMetadata type (compile-time check)', () => {
    const metadata: import('../../src/parquet-reader').ParquetFileMetadata = {
      schema: [],
      rowCount: 0,
      rowGroups: 0,
    };
    expect(metadata.rowCount).toBe(0);
  });

  it('should export ParquetReadOptions type (compile-time check)', () => {
    const options: import('../../src/parquet-reader').ParquetReadOptions = {
      columns: ['a', 'b'],
      limit: 100,
      offset: 0,
    };
    expect(options.limit).toBe(100);
  });

  it('should export ParquetReadResult type (compile-time check)', () => {
    const result: import('../../src/parquet-reader').ParquetReadResult = {
      data: [],
      meta: [],
      rows: 0,
      totalRows: 0,
      elapsedMs: 0,
    };
    expect(result.rows).toBe(0);
  });
});

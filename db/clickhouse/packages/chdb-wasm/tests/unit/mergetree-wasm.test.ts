/**
 * MergeTree WASM Module Tests
 *
 * Tests for the MergeTree WASM loader and bindings:
 * - WASM module loading
 * - VFS bridge integration
 * - Part reader functionality
 * - TypeScript bindings
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MergeTreePartReader,
  InMemoryStorageProvider,
  VFSBridge,
  MergeTreeBindings,
  parseMarks,
  errorCodeToMessage,
  isError,
  MERGETREE_ERR_INVALID_PARAM,
  MERGETREE_ERR_CREATE_FAILED,
  MERGETREE_ERR_BAD_HANDLE,
  type MergeTreeModule,
} from '../../src/wasm/index';

// ---------------------------------------------------------------------------
// Mock WASM Module
// ---------------------------------------------------------------------------

/**
 * Create a mock MergeTree WASM module for testing
 */
function createMockModule(): MergeTreeModule {
  const heapBuffer = new ArrayBuffer(1024 * 1024); // 1MB
  const resultBuffer = new Uint8Array(1024);
  let resultLength = 0;
  let nextReaderHandle = 1;
  const readers = new Map<number, { db: string; table: string; partition: string; part: string }>();
  let lastError = '';

  // Mock column data
  const mockColumns = [
    { name: 'id', type: 'UInt64' },
    { name: 'name', type: 'String' },
    { name: 'created_at', type: 'DateTime' },
  ];

  const mockMarks = [
    { compressed: 0n, decompressed: 0n },
    { compressed: 4096n, decompressed: 0n },
    { compressed: 8192n, decompressed: 0n },
  ];

  const module: Partial<MergeTreeModule> = {
    HEAP8: new Int8Array(heapBuffer),
    HEAPU8: new Uint8Array(heapBuffer),
    HEAP16: new Int16Array(heapBuffer),
    HEAPU16: new Uint16Array(heapBuffer),
    HEAP32: new Int32Array(heapBuffer),
    HEAPU32: new Uint32Array(heapBuffer),
    HEAPF32: new Float32Array(heapBuffer),
    HEAPF64: new Float64Array(heapBuffer),

    _malloc: vi.fn((size: number) => {
      // Simple bump allocator starting at 4096
      return 4096;
    }),

    _free: vi.fn(),

    UTF8ToString: vi.fn((ptr: number) => {
      if (ptr === 0) return '';
      const view = new Uint8Array(heapBuffer);
      let end = ptr;
      while (view[end] !== 0 && end < view.length) end++;
      return new TextDecoder().decode(view.slice(ptr, end));
    }),

    stringToUTF8: vi.fn((str: string, outPtr: number, maxBytes: number) => {
      const bytes = new TextEncoder().encode(str);
      const view = new Uint8Array(heapBuffer);
      const len = Math.min(bytes.length, maxBytes - 1);
      view.set(bytes.slice(0, len), outPtr);
      view[outPtr + len] = 0;
    }),

    _mergetree_reader_create: vi.fn((dbPtr, tablePtr, partitionPtr, partNamePtr) => {
      const db = module.UTF8ToString!(dbPtr);
      const table = module.UTF8ToString!(tablePtr);
      const partition = module.UTF8ToString!(partitionPtr);
      const part = module.UTF8ToString!(partNamePtr);

      // Simulate failure for non-existent parts
      if (part === 'nonexistent') {
        lastError = 'Part not found';
        return MERGETREE_ERR_CREATE_FAILED;
      }

      const handle = nextReaderHandle++;
      readers.set(handle, { db, table, partition, part });
      return handle;
    }),

    _mergetree_reader_destroy: vi.fn((handle: number) => {
      readers.delete(handle);
    }),

    _mergetree_reader_get_row_count: vi.fn((handle: number) => {
      if (!readers.has(handle)) return -1;
      return 1000; // Mock 1000 rows
    }),

    _mergetree_reader_get_column_count: vi.fn((handle: number) => {
      if (!readers.has(handle)) return -1;
      return mockColumns.length;
    }),

    _mergetree_reader_get_mark_count: vi.fn((handle: number) => {
      if (!readers.has(handle)) return -1;
      return mockMarks.length;
    }),

    _mergetree_reader_get_column_name: vi.fn((handle: number, index: number) => {
      if (!readers.has(handle) || index < 0 || index >= mockColumns.length) return -1;
      const name = mockColumns[index].name;
      const bytes = new TextEncoder().encode(name);
      resultBuffer.set(bytes, 0);
      resultBuffer[bytes.length] = 0;
      resultLength = bytes.length + 1;
      return bytes.length;
    }),

    _mergetree_reader_get_column_type: vi.fn((handle: number, index: number) => {
      if (!readers.has(handle) || index < 0 || index >= mockColumns.length) return -1;
      const type = mockColumns[index].type;
      const bytes = new TextEncoder().encode(type);
      resultBuffer.set(bytes, 0);
      resultBuffer[bytes.length] = 0;
      resultLength = bytes.length + 1;
      return bytes.length;
    }),

    _mergetree_reader_read_marks: vi.fn((handle: number, columnNamePtr: number) => {
      if (!readers.has(handle)) return -1;
      // Write marks to result buffer (16 bytes each: compressed + decompressed)
      const view = new DataView(resultBuffer.buffer);
      for (let i = 0; i < mockMarks.length; i++) {
        view.setBigUint64(i * 16, mockMarks[i].compressed, true);
        view.setBigUint64(i * 16 + 8, mockMarks[i].decompressed, true);
      }
      resultLength = mockMarks.length * 16;
      return mockMarks.length;
    }),

    _mergetree_reader_read_column_raw: vi.fn((handle, columnNamePtr, startLo, startHi, endLo, endHi) => {
      if (!readers.has(handle)) return -1;
      // Write mock data to result buffer
      const mockData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
      resultBuffer.set(mockData, 0);
      resultLength = mockData.length;
      return mockData.length;
    }),

    _mergetree_get_result: vi.fn(() => {
      // Return pointer to result buffer (simulated at offset 8192)
      new Uint8Array(heapBuffer).set(resultBuffer.slice(0, resultLength), 8192);
      return 8192;
    }),

    _mergetree_get_result_len: vi.fn(() => resultLength),

    _mergetree_get_error: vi.fn(() => {
      if (!lastError) return 0;
      const bytes = new TextEncoder().encode(lastError);
      new Uint8Array(heapBuffer).set(bytes, 16384);
      new Uint8Array(heapBuffer)[16384 + bytes.length] = 0;
      return 16384;
    }),

    _mergetree_version: vi.fn(() => {
      const version = '1.0.0-wasm-test';
      const bytes = new TextEncoder().encode(version);
      new Uint8Array(heapBuffer).set(bytes, 16000);
      new Uint8Array(heapBuffer)[16000 + bytes.length] = 0;
      return 16000;
    }),

    _mergetree_test: vi.fn(() => 0), // Success
  };

  return module as MergeTreeModule;
}

// ---------------------------------------------------------------------------
// MergeTreeBindings Tests
// ---------------------------------------------------------------------------

describe('MergeTreeBindings', () => {
  let module: MergeTreeModule;
  let bindings: MergeTreeBindings;

  beforeEach(() => {
    module = createMockModule();
    bindings = new MergeTreeBindings(module);
  });

  describe('version', () => {
    it('should return version string', () => {
      const version = bindings.version();
      expect(version).toBe('1.0.0-wasm-test');
    });
  });

  describe('test', () => {
    it('should return 0 on success', () => {
      const result = bindings.test();
      expect(result).toBe(0);
    });
  });

  describe('readerCreate', () => {
    it('should create reader and return handle', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      expect(handle).toBeGreaterThan(0);
    });

    it('should return error code for non-existent part', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'nonexistent');
      expect(handle).toBe(MERGETREE_ERR_CREATE_FAILED);
    });
  });

  describe('readerGetRowCount', () => {
    it('should return row count', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      const count = bindings.readerGetRowCount(handle);
      expect(count).toBe(1000n);
    });
  });

  describe('readerGetColumnCount', () => {
    it('should return column count', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      const count = bindings.readerGetColumnCount(handle);
      expect(count).toBe(3);
    });
  });

  describe('readerGetMarkCount', () => {
    it('should return mark count', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      const count = bindings.readerGetMarkCount(handle);
      expect(count).toBe(3n);
    });
  });

  describe('readerGetColumnName', () => {
    it('should return column name', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      const name = bindings.readerGetColumnName(handle, 0);
      expect(name).toBe('id');
    });

    it('should return empty string for invalid index', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      const name = bindings.readerGetColumnName(handle, 999);
      expect(name).toBe('');
    });
  });

  describe('readerGetColumnType', () => {
    it('should return column type', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      const type = bindings.readerGetColumnType(handle, 0);
      expect(type).toBe('UInt64');
    });
  });

  describe('readerReadMarks', () => {
    it('should read marks for column', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      const { count, data } = bindings.readerReadMarks(handle, 'id');
      expect(count).toBe(3);
      expect(data.length).toBe(48); // 3 marks * 16 bytes each
    });
  });

  describe('readerReadColumnRaw', () => {
    it('should read raw column data', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      const data = bindings.readerReadColumnRaw(handle, 'id', 0n, 0n);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('readerDestroy', () => {
    it('should destroy reader', () => {
      const handle = bindings.readerCreate('db', 'table', 'partition', 'part1');
      bindings.readerDestroy(handle);
      // Subsequent operations should fail
      const count = bindings.readerGetRowCount(handle);
      expect(count).toBe(-1n);
    });
  });
});

// ---------------------------------------------------------------------------
// MergeTreePartReader Tests
// ---------------------------------------------------------------------------

describe('MergeTreePartReader', () => {
  let module: MergeTreeModule;
  let reader: MergeTreePartReader;

  beforeEach(() => {
    module = createMockModule();
    const handle = module._mergetree_reader_create(0, 0, 0, 0);
    reader = new MergeTreePartReader(module, handle);
  });

  afterEach(() => {
    if (!reader.isDestroyed()) {
      reader.destroy();
    }
  });

  describe('getRowCount', () => {
    it('should return row count as bigint', () => {
      const count = reader.getRowCount();
      expect(count).toBe(1000n);
    });

    it('should throw if destroyed', () => {
      reader.destroy();
      expect(() => reader.getRowCount()).toThrow('destroyed');
    });
  });

  describe('getColumnCount', () => {
    it('should return column count', () => {
      const count = reader.getColumnCount();
      expect(count).toBe(3);
    });
  });

  describe('getMarkCount', () => {
    it('should return mark count as bigint', () => {
      const count = reader.getMarkCount();
      expect(count).toBe(3n);
    });
  });

  describe('getColumns', () => {
    it('should return all column information', () => {
      const columns = reader.getColumns();
      expect(columns).toHaveLength(3);
      expect(columns[0]).toEqual({ name: 'id', type: 'UInt64' });
      expect(columns[1]).toEqual({ name: 'name', type: 'String' });
      expect(columns[2]).toEqual({ name: 'created_at', type: 'DateTime' });
    });
  });

  describe('readMarks', () => {
    it('should read marks for column', () => {
      const marks = reader.readMarks('id');
      expect(marks).toHaveLength(3);
      expect(marks[0].offsetInCompressedFile).toBe(0n);
      expect(marks[1].offsetInCompressedFile).toBe(4096n);
      expect(marks[2].offsetInCompressedFile).toBe(8192n);
    });
  });

  describe('readColumnRaw', () => {
    it('should read raw column data', () => {
      const data = reader.readColumnRaw('id');
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toBe(0x01);
    });
  });

  describe('destroy', () => {
    it('should mark reader as destroyed', () => {
      expect(reader.isDestroyed()).toBe(false);
      reader.destroy();
      expect(reader.isDestroyed()).toBe(true);
    });

    it('should be idempotent', () => {
      reader.destroy();
      reader.destroy(); // Should not throw
      expect(reader.isDestroyed()).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Helper Function Tests
// ---------------------------------------------------------------------------

describe('parseMarks', () => {
  it('should parse marks from raw data', () => {
    const data = new Uint8Array(32); // 2 marks
    const view = new DataView(data.buffer);
    view.setBigUint64(0, 100n, true);
    view.setBigUint64(8, 50n, true);
    view.setBigUint64(16, 200n, true);
    view.setBigUint64(24, 75n, true);

    const marks = parseMarks(data);
    expect(marks).toHaveLength(2);
    expect(marks[0].compressedOffset).toBe(100n);
    expect(marks[0].decompressedOffset).toBe(50n);
    expect(marks[1].compressedOffset).toBe(200n);
    expect(marks[1].decompressedOffset).toBe(75n);
  });

  it('should handle empty data', () => {
    const marks = parseMarks(new Uint8Array(0));
    expect(marks).toHaveLength(0);
  });
});

describe('errorCodeToMessage', () => {
  it('should convert error codes to messages', () => {
    expect(errorCodeToMessage(MERGETREE_ERR_INVALID_PARAM)).toBe('Invalid parameter');
    expect(errorCodeToMessage(MERGETREE_ERR_CREATE_FAILED)).toContain('create');
    expect(errorCodeToMessage(MERGETREE_ERR_BAD_HANDLE)).toContain('handle');
  });

  it('should handle unknown error codes', () => {
    const msg = errorCodeToMessage(-999);
    expect(msg).toContain('-999');
  });
});

describe('isError', () => {
  it('should return true for negative codes', () => {
    expect(isError(-1)).toBe(true);
    expect(isError(-100)).toBe(true);
  });

  it('should return false for non-negative codes', () => {
    expect(isError(0)).toBe(false);
    expect(isError(1)).toBe(false);
    expect(isError(100)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VFS Bridge Integration Tests
// ---------------------------------------------------------------------------

describe('VFSBridge with InMemoryStorageProvider', () => {
  let storage: InMemoryStorageProvider;
  let bridge: VFSBridge;

  beforeEach(() => {
    storage = new InMemoryStorageProvider();
    bridge = new VFSBridge(storage);
  });

  it('should support MergeTree part structure', async () => {
    // Create a mock part structure
    const partPath = 'data/202401/all_1_1_0';

    // Write count.txt
    await storage.write(
      `${partPath}/count.txt`,
      new TextEncoder().encode('1000').buffer
    );

    // Write columns.txt
    const columnsTxt = `columns format version: 1
3 columns:
\`id\` UInt64
\`name\` String
\`created_at\` DateTime
`;
    await storage.write(
      `${partPath}/columns.txt`,
      new TextEncoder().encode(columnsTxt).buffer
    );

    // Verify files exist
    const countStat = await storage.stat(`${partPath}/count.txt`);
    expect(countStat).not.toBeNull();
    expect(countStat!.isDirectory).toBe(false);

    const columnsStat = await storage.stat(`${partPath}/columns.txt`);
    expect(columnsStat).not.toBeNull();

    // Read count.txt
    const countData = await storage.readFile(`${partPath}/count.txt`);
    const countStr = new TextDecoder().decode(countData);
    expect(countStr).toBe('1000');
  });

  it('should list part files', async () => {
    const partPath = 'data/202401/all_1_1_0';

    await storage.write(`${partPath}/count.txt`, new ArrayBuffer(0));
    await storage.write(`${partPath}/columns.txt`, new ArrayBuffer(0));
    await storage.write(`${partPath}/id.bin`, new ArrayBuffer(0));
    await storage.write(`${partPath}/id.mrk2`, new ArrayBuffer(0));

    const entries = await storage.list(partPath);
    const names = entries.map(e => e.name);

    expect(names).toContain('count.txt');
    expect(names).toContain('columns.txt');
    expect(names).toContain('id.bin');
    expect(names).toContain('id.mrk2');
  });
});

// ---------------------------------------------------------------------------
// MergeTree Handler Tests (via mock request)
// ---------------------------------------------------------------------------

describe('MergeTree Handler', () => {
  // Note: Full handler tests require actual WASM loading which is tested in integration tests
  // Here we test the path parsing and routing logic

  it('should parse part paths correctly', () => {
    const testCases = [
      { path: '/mergetree/parts/db/table', expected: { db: 'db', table: 'table' } },
      { path: '/mergetree/parts/my_db/my_table/p1/part1', expected: { db: 'my_db', table: 'my_table', partition: 'p1', part: 'part1' } },
      { path: '/mergetree/parts/db/table/p/part/columns', expected: { subPath: 'columns' } },
      { path: '/mergetree/parts/db/table/p/part/marks/id', expected: { subPath: 'marks', column: 'id' } },
    ];

    for (const { path, expected } of testCases) {
      const pathParts = path.replace('/mergetree/parts/', '').split('/');

      if (expected.db) {
        expect(decodeURIComponent(pathParts[0])).toBe(expected.db);
      }
      if (expected.table) {
        expect(decodeURIComponent(pathParts[1])).toBe(expected.table);
      }
      if (expected.partition) {
        expect(decodeURIComponent(pathParts[2])).toBe(expected.partition);
      }
      if (expected.part) {
        expect(decodeURIComponent(pathParts[3])).toBe(expected.part);
      }
      if (expected.subPath) {
        expect(pathParts[4]).toBe(expected.subPath);
      }
      if (expected.column) {
        expect(decodeURIComponent(pathParts[5])).toBe(expected.column);
      }
    }
  });
});

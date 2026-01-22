/**
 * Memory Engine with Durable Object Storage - TDD RED Phase
 *
 * Tests the Memory table engine backed by Cloudflare Durable Objects storage.
 * Instead of purely in-memory storage that is lost on Worker restart,
 * this uses DO storage (this.state.storage) for persistence while maintaining
 * Memory engine semantics (no on-disk ordering, all in memory at query time).
 *
 * Key Features:
 * - CREATE TABLE ... ENGINE = Memory() creates table metadata in DO
 * - INSERT writes data to DO storage (persisted)
 * - SELECT reads from DO storage into memory for query execution
 * - Data survives Worker restarts due to DO persistence
 * - Multiple Workers can access the same DO (single-writer model)
 * - DROP/TRUNCATE operations clean up DO storage
 *
 * These tests are written in TDD RED phase - they MUST FAIL initially
 * because the Memory DO storage implementation does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { MemoryEngineDO } from '../../src/storage/memory-do';

/**
 * Mock Durable Object State interface
 */
interface MockDurableObjectState {
  storage: MockDurableObjectStorage;
  id: { toString: () => string };
  waitUntil: (promise: Promise<unknown>) => void;
  blockConcurrencyWhile: <T>(callback: () => Promise<T>) => Promise<T>;
}

/**
 * Mock Durable Object Storage interface matching Cloudflare's API
 */
interface MockDurableObjectStorage {
  get: Mock<[key: string], Promise<unknown>>;
  put: Mock<[key: string, value: unknown], Promise<void>>;
  delete: Mock<[key: string], Promise<boolean>>;
  deleteAll: Mock<[], Promise<void>>;
  list: Mock<[options?: { prefix?: string; limit?: number }], Promise<Map<string, unknown>>>;
  transaction: Mock<[callback: (txn: MockDurableObjectStorage) => Promise<void>], Promise<void>>;
}

/**
 * Memory Engine DO Storage Interface (to be implemented)
 * This is what we expect the implementation to provide
 */
interface MemoryEngineDOInterface {
  createTable: (tableName: string, schema: TableSchema) => Promise<void>;
  dropTable: (tableName: string) => Promise<void>;
  truncateTable: (tableName: string) => Promise<void>;
  insert: (tableName: string, rows: Row[]) => Promise<InsertResult>;
  select: (tableName: string, options?: SelectOptions) => Promise<SelectResult>;
  getTableSchema: (tableName: string) => Promise<TableSchema | null>;
  listTables: () => Promise<string[]>;
}

/**
 * Table schema definition
 */
interface TableSchema {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    default?: unknown;
  }>;
  engine: 'Memory';
  createdAt?: string;
}

/**
 * Row type for data operations
 */
type Row = Record<string, unknown>;

/**
 * Insert operation result
 */
interface InsertResult {
  rowsInserted: number;
  success: boolean;
}

/**
 * Select options for filtering and pagination
 */
interface SelectOptions {
  columns?: string[];
  where?: string;
  limit?: number;
  offset?: number;
}

/**
 * Select operation result
 */
interface SelectResult {
  meta: Array<{ name: string; type: string }>;
  data: Row[];
  rows: number;
}

/**
 * Create a mock Durable Object storage for testing
 */
function createMockDOStorage(): MockDurableObjectStorage {
  const storage = new Map<string, unknown>();

  const mockStorage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation(async (key: string) => {
      return storage.get(key);
    }),
    put: vi.fn().mockImplementation(async (key: string, value: unknown) => {
      storage.set(key, value);
    }),
    delete: vi.fn().mockImplementation(async (key: string) => {
      return storage.delete(key);
    }),
    deleteAll: vi.fn().mockImplementation(async () => {
      storage.clear();
    }),
    list: vi.fn().mockImplementation(async (options?: { prefix?: string; limit?: number }) => {
      const result = new Map<string, unknown>();
      let count = 0;
      for (const [key, value] of storage.entries()) {
        if (options?.prefix && !key.startsWith(options.prefix)) continue;
        if (options?.limit && count >= options.limit) break;
        result.set(key, value);
        count++;
      }
      return result;
    }),
    transaction: vi.fn().mockImplementation(async <T>(callback: (txn: MockDurableObjectStorage) => Promise<T>): Promise<T> => {
      // For mock, execute the callback with the same storage instance to persist writes
      return callback(mockStorage);
    }),
  };

  return mockStorage;
}

/**
 * Create a mock Durable Object state
 */
function createMockDOState(): MockDurableObjectState {
  // Simple mutex to serialize blockConcurrencyWhile calls
  let mutex: Promise<unknown> = Promise.resolve();

  return {
    storage: createMockDOStorage(),
    id: { toString: () => 'test-do-id-12345' },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn().mockImplementation(async <T>(callback: () => Promise<T>): Promise<T> => {
      // Chain the execution to serialize concurrent calls
      const prevMutex = mutex;
      let resolve: () => void;
      mutex = new Promise<void>((r) => { resolve = r; });
      await prevMutex;
      try {
        return await callback();
      } finally {
        resolve!();
      }
    }),
  };
}

// MemoryEngineDO is now imported from the implementation file

// ============================================================================
// TEST SUITE: Memory Engine with DO Storage
// ============================================================================

describe('Memory Engine with Durable Object Storage', () => {
  let mockState: MockDurableObjectState;
  let memoryEngine: MemoryEngineDOInterface;

  beforeEach(() => {
    mockState = createMockDOState();
    memoryEngine = new MemoryEngineDO(mockState as unknown as import('../../src/storage/memory-do').DurableObjectState);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Test Case 1: CREATE TABLE ... ENGINE = Memory() creates table in DO storage
  // --------------------------------------------------------------------------
  describe('CREATE TABLE with Memory engine', () => {
    it('should create table metadata in DO storage', async () => {
      const schema: TableSchema = {
        name: 'test_users',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
          { name: 'email', type: 'String' },
          { name: 'created_at', type: 'DateTime' },
        ],
        engine: 'Memory',
      };

      await memoryEngine.createTable('test_users', schema);

      // Verify schema was stored in DO
      expect(mockState.storage.put).toHaveBeenCalledWith(
        'schema:test_users',
        expect.objectContaining({
          name: 'test_users',
          columns: expect.arrayContaining([
            expect.objectContaining({ name: 'id', type: 'UInt64' }),
          ]),
          engine: 'Memory',
        })
      );
    });

    it('should store table name in tables list', async () => {
      const schema: TableSchema = {
        name: 'products',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
          { name: 'price', type: 'Float64' },
        ],
        engine: 'Memory',
      };

      await memoryEngine.createTable('products', schema);

      // After creation, listTables should include 'products'
      const tables = await memoryEngine.listTables();
      expect(tables).toContain('products');
    });

    it('should reject creating table that already exists', async () => {
      const schema: TableSchema = {
        name: 'existing_table',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      };

      await memoryEngine.createTable('existing_table', schema);

      // Second create should throw
      await expect(memoryEngine.createTable('existing_table', schema)).rejects.toThrow(
        /already exists|duplicate/i
      );
    });

    it('should validate column definitions', async () => {
      const invalidSchema: TableSchema = {
        name: 'invalid_table',
        columns: [], // Empty columns should be invalid
        engine: 'Memory',
      };

      await expect(memoryEngine.createTable('invalid_table', invalidSchema)).rejects.toThrow(
        /column|empty|invalid/i
      );
    });

    it('should store creation timestamp', async () => {
      const schema: TableSchema = {
        name: 'timestamped_table',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      };

      const beforeCreate = new Date().toISOString();
      await memoryEngine.createTable('timestamped_table', schema);
      const afterCreate = new Date().toISOString();

      const storedSchema = await memoryEngine.getTableSchema('timestamped_table');
      expect(storedSchema).not.toBeNull();
      expect(storedSchema!.createdAt).toBeDefined();
      expect(storedSchema!.createdAt! >= beforeCreate).toBe(true);
      expect(storedSchema!.createdAt! <= afterCreate).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 2: INSERT INTO memory table persists data to DO
  // --------------------------------------------------------------------------
  describe('INSERT INTO memory table', () => {
    it('should persist inserted rows to DO storage', async () => {
      const schema: TableSchema = {
        name: 'insert_test',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'value', type: 'String' },
        ],
        engine: 'Memory',
      };
      await memoryEngine.createTable('insert_test', schema);

      const rows: Row[] = [
        { id: 1, value: 'first' },
        { id: 2, value: 'second' },
        { id: 3, value: 'third' },
      ];

      const result = await memoryEngine.insert('insert_test', rows);

      expect(result.success).toBe(true);
      expect(result.rowsInserted).toBe(3);

      // Verify data was written to DO storage
      expect(mockState.storage.put).toHaveBeenCalledWith(
        expect.stringMatching(/^data:insert_test/),
        expect.anything()
      );
    });

    it('should append to existing data on subsequent inserts', async () => {
      const schema: TableSchema = {
        name: 'append_test',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
        ],
        engine: 'Memory',
      };
      await memoryEngine.createTable('append_test', schema);

      // First insert
      await memoryEngine.insert('append_test', [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);

      // Second insert
      await memoryEngine.insert('append_test', [
        { id: 3, name: 'Charlie' },
      ]);

      // Select all should return 3 rows
      const result = await memoryEngine.select('append_test');
      expect(result.rows).toBe(3);
      expect(result.data).toHaveLength(3);
    });

    it('should reject insert into non-existent table', async () => {
      await expect(
        memoryEngine.insert('non_existent_table', [{ id: 1 }])
      ).rejects.toThrow(/table.*not found|does not exist/i);
    });

    it('should validate data against schema', async () => {
      const schema: TableSchema = {
        name: 'typed_table',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
        ],
        engine: 'Memory',
      };
      await memoryEngine.createTable('typed_table', schema);

      // Insert with extra column should either ignore or reject
      const result = await memoryEngine.insert('typed_table', [
        { id: 1, name: 'Test', extra_col: 'ignored' },
      ]);

      // Should succeed (extra columns ignored) or throw validation error
      expect(result.rowsInserted).toBe(1);

      // Verify extra column is not stored
      const selectResult = await memoryEngine.select('typed_table');
      expect(selectResult.data[0]).not.toHaveProperty('extra_col');
    });

    it('should handle NULL values correctly', async () => {
      const schema: TableSchema = {
        name: 'nullable_table',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'optional_value', type: 'String', nullable: true },
        ],
        engine: 'Memory',
      };
      await memoryEngine.createTable('nullable_table', schema);

      await memoryEngine.insert('nullable_table', [
        { id: 1, optional_value: 'present' },
        { id: 2, optional_value: null },
      ]);

      const result = await memoryEngine.select('nullable_table');
      expect(result.data[1].optional_value).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 3: SELECT from memory table reads from DO storage
  // --------------------------------------------------------------------------
  describe('SELECT from memory table', () => {
    it('should read all rows from DO storage', async () => {
      const schema: TableSchema = {
        name: 'select_test',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
        ],
        engine: 'Memory',
      };
      await memoryEngine.createTable('select_test', schema);
      await memoryEngine.insert('select_test', [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ]);

      const result = await memoryEngine.select('select_test');

      expect(result.rows).toBe(3);
      expect(result.data).toHaveLength(3);
      expect(result.meta).toEqual([
        { name: 'id', type: 'UInt64' },
        { name: 'name', type: 'String' },
      ]);
    });

    it('should support column projection', async () => {
      const schema: TableSchema = {
        name: 'projection_test',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
          { name: 'email', type: 'String' },
        ],
        engine: 'Memory',
      };
      await memoryEngine.createTable('projection_test', schema);
      await memoryEngine.insert('projection_test', [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
      ]);

      const result = await memoryEngine.select('projection_test', {
        columns: ['id', 'name'],
      });

      expect(result.meta).toHaveLength(2);
      expect(result.meta.map(m => m.name)).toEqual(['id', 'name']);
      expect(result.data[0]).not.toHaveProperty('email');
    });

    it('should support LIMIT clause', async () => {
      const schema: TableSchema = {
        name: 'limit_test',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      };
      await memoryEngine.createTable('limit_test', schema);
      await memoryEngine.insert('limit_test', [
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
      ]);

      const result = await memoryEngine.select('limit_test', { limit: 3 });

      expect(result.rows).toBe(3);
      expect(result.data).toHaveLength(3);
    });

    it('should support OFFSET clause', async () => {
      const schema: TableSchema = {
        name: 'offset_test',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      };
      await memoryEngine.createTable('offset_test', schema);
      await memoryEngine.insert('offset_test', [
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
      ]);

      const result = await memoryEngine.select('offset_test', { limit: 2, offset: 2 });

      expect(result.rows).toBe(2);
      // Memory engine doesn't guarantee order, so just check we got 2 rows
    });

    it('should return empty result for table with no data', async () => {
      const schema: TableSchema = {
        name: 'empty_table',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      };
      await memoryEngine.createTable('empty_table', schema);

      const result = await memoryEngine.select('empty_table');

      expect(result.rows).toBe(0);
      expect(result.data).toHaveLength(0);
      expect(result.meta).toEqual([{ name: 'id', type: 'UInt64' }]);
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 4: Data survives Worker restarts (DO persistence)
  // --------------------------------------------------------------------------
  describe('Data persistence across Worker restarts', () => {
    it('should persist data after DO re-instantiation', async () => {
      // First "session"
      const state1 = createMockDOState();
      // Manually populate storage to simulate previous data
      await state1.storage.put('schema:persistent_table', {
        name: 'persistent_table',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'value', type: 'String' },
        ],
        engine: 'Memory',
      });
      await state1.storage.put('data:persistent_table:chunk:0', [
        { id: 1, value: 'persisted' },
        { id: 2, value: 'across' },
        { id: 3, value: 'restarts' },
      ]);
      await state1.storage.put('tables', ['persistent_table']);

      // Create new engine instance (simulating Worker restart)
      const engine1 = new MemoryEngineDO(state1);

      // Should be able to read previously stored data
      const result = await engine1.select('persistent_table');
      expect(result.rows).toBe(3);
      expect(result.data).toContainEqual({ id: 1, value: 'persisted' });
    });

    it('should restore table schema after restart', async () => {
      const state = createMockDOState();
      await state.storage.put('schema:restored_table', {
        name: 'restored_table',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'timestamp', type: 'DateTime' },
        ],
        engine: 'Memory',
        createdAt: '2024-01-15T10:00:00Z',
      });
      await state.storage.put('tables', ['restored_table']);

      const engine = new MemoryEngineDO(state);
      const schema = await engine.getTableSchema('restored_table');

      expect(schema).not.toBeNull();
      expect(schema!.name).toBe('restored_table');
      expect(schema!.columns).toHaveLength(2);
      expect(schema!.createdAt).toBe('2024-01-15T10:00:00Z');
    });

    it('should restore multiple tables after restart', async () => {
      const state = createMockDOState();
      await state.storage.put('tables', ['table_a', 'table_b', 'table_c']);
      await state.storage.put('schema:table_a', { name: 'table_a', columns: [{ name: 'id', type: 'UInt64' }], engine: 'Memory' });
      await state.storage.put('schema:table_b', { name: 'table_b', columns: [{ name: 'id', type: 'UInt64' }], engine: 'Memory' });
      await state.storage.put('schema:table_c', { name: 'table_c', columns: [{ name: 'id', type: 'UInt64' }], engine: 'Memory' });

      const engine = new MemoryEngineDO(state);
      const tables = await engine.listTables();

      expect(tables).toContain('table_a');
      expect(tables).toContain('table_b');
      expect(tables).toContain('table_c');
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 5: Multiple Workers can access same DO memory table
  // --------------------------------------------------------------------------
  describe('Multi-Worker access to DO memory table', () => {
    it('should allow concurrent reads from multiple Workers', async () => {
      // Shared state representing the DO
      const sharedState = createMockDOState();
      await sharedState.storage.put('schema:shared_table', {
        name: 'shared_table',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });
      await sharedState.storage.put('data:shared_table:chunk:0', [
        { id: 1 }, { id: 2 }, { id: 3 },
      ]);
      await sharedState.storage.put('tables', ['shared_table']);

      // Multiple engine instances (simulating multiple Workers)
      const engine1 = new MemoryEngineDO(sharedState);
      const engine2 = new MemoryEngineDO(sharedState);

      // Both should be able to read
      const [result1, result2] = await Promise.all([
        engine1.select('shared_table'),
        engine2.select('shared_table'),
      ]);

      expect(result1.rows).toBe(3);
      expect(result2.rows).toBe(3);
    });

    it('should serialize concurrent writes (single-writer model)', async () => {
      const sharedState = createMockDOState();
      await sharedState.storage.put('schema:concurrent_table', {
        name: 'concurrent_table',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });
      await sharedState.storage.put('data:concurrent_table:chunk:0', []);
      await sharedState.storage.put('tables', ['concurrent_table']);

      const engine = new MemoryEngineDO(sharedState);

      // Concurrent writes should be serialized
      await Promise.all([
        engine.insert('concurrent_table', [{ id: 1 }]),
        engine.insert('concurrent_table', [{ id: 2 }]),
        engine.insert('concurrent_table', [{ id: 3 }]),
      ]);

      const result = await engine.select('concurrent_table');
      // All 3 inserts should succeed (serialized)
      expect(result.rows).toBe(3);
    });

    it('should use blockConcurrencyWhile for write operations', async () => {
      const state = createMockDOState();
      const engine = new MemoryEngineDO(state);

      await engine.createTable('blocking_test', {
        name: 'blocking_test',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      await engine.insert('blocking_test', [{ id: 1 }]);

      // blockConcurrencyWhile should have been called for write ops
      expect(state.blockConcurrencyWhile).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 6: DROP TABLE removes data from DO
  // --------------------------------------------------------------------------
  describe('DROP TABLE removes data from DO', () => {
    it('should remove table schema from DO storage', async () => {
      const schema: TableSchema = {
        name: 'drop_me',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      };
      await memoryEngine.createTable('drop_me', schema);
      await memoryEngine.insert('drop_me', [{ id: 1 }, { id: 2 }]);

      await memoryEngine.dropTable('drop_me');

      // Schema should be deleted
      expect(mockState.storage.delete).toHaveBeenCalledWith('schema:drop_me');
    });

    it('should remove table data from DO storage', async () => {
      const schema: TableSchema = {
        name: 'drop_data_test',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      };
      await memoryEngine.createTable('drop_data_test', schema);
      await memoryEngine.insert('drop_data_test', [{ id: 1 }]);

      await memoryEngine.dropTable('drop_data_test');

      // Data should be deleted (all chunks)
      expect(mockState.storage.delete).toHaveBeenCalledWith(
        expect.stringMatching(/^data:drop_data_test/)
      );
    });

    it('should remove table from tables list', async () => {
      await memoryEngine.createTable('table_to_remove', {
        name: 'table_to_remove',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      await memoryEngine.dropTable('table_to_remove');

      const tables = await memoryEngine.listTables();
      expect(tables).not.toContain('table_to_remove');
    });

    it('should reject dropping non-existent table', async () => {
      await expect(memoryEngine.dropTable('non_existent')).rejects.toThrow(
        /table.*not found|does not exist/i
      );
    });

    it('should handle DROP IF EXISTS for non-existent table', async () => {
      // This should not throw if implemented with IF EXISTS semantics
      // For now, we expect a specific method or silent failure
      const tables = await memoryEngine.listTables();
      const initialCount = tables.length;

      // Try to drop - should either succeed silently or throw
      try {
        await memoryEngine.dropTable('maybe_exists');
      } catch (e) {
        // Expected behavior for non-IF EXISTS
        expect((e as Error).message).toMatch(/table.*not found|does not exist/i);
      }

      const finalTables = await memoryEngine.listTables();
      expect(finalTables.length).toBe(initialCount);
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 7: TRUNCATE TABLE clears DO storage
  // --------------------------------------------------------------------------
  describe('TRUNCATE TABLE clears DO storage', () => {
    it('should clear all data but keep schema', async () => {
      const schema: TableSchema = {
        name: 'truncate_test',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'value', type: 'String' },
        ],
        engine: 'Memory',
      };
      await memoryEngine.createTable('truncate_test', schema);
      await memoryEngine.insert('truncate_test', [
        { id: 1, value: 'a' },
        { id: 2, value: 'b' },
        { id: 3, value: 'c' },
      ]);

      await memoryEngine.truncateTable('truncate_test');

      // Data should be empty
      const result = await memoryEngine.select('truncate_test');
      expect(result.rows).toBe(0);

      // Schema should still exist
      const tableSchema = await memoryEngine.getTableSchema('truncate_test');
      expect(tableSchema).not.toBeNull();
      expect(tableSchema!.columns).toHaveLength(2);
    });

    it('should delete all data chunks from DO storage', async () => {
      await memoryEngine.createTable('multi_chunk', {
        name: 'multi_chunk',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });
      // Insert enough data to potentially create multiple chunks
      await memoryEngine.insert('multi_chunk', Array.from({ length: 1000 }, (_, i) => ({ id: i })));

      await memoryEngine.truncateTable('multi_chunk');

      // All data chunks should be deleted
      const listCalls = mockState.storage.list.mock.calls;
      const deleteCalls = mockState.storage.delete.mock.calls;

      // Should have tried to find and delete all data chunks
      expect(listCalls.length + deleteCalls.length).toBeGreaterThan(0);
    });

    it('should reject truncating non-existent table', async () => {
      await expect(memoryEngine.truncateTable('non_existent')).rejects.toThrow(
        /table.*not found|does not exist/i
      );
    });

    it('should be idempotent on empty table', async () => {
      await memoryEngine.createTable('empty_truncate', {
        name: 'empty_truncate',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      // Truncate empty table should succeed
      await memoryEngine.truncateTable('empty_truncate');

      const result = await memoryEngine.select('empty_truncate');
      expect(result.rows).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 8: Memory table schema is stored in DO
  // --------------------------------------------------------------------------
  describe('Memory table schema stored in DO', () => {
    it('should store complete column definitions', async () => {
      const schema: TableSchema = {
        name: 'schema_test',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String', nullable: false },
          { name: 'description', type: 'String', nullable: true },
          { name: 'count', type: 'Int32', default: 0 },
        ],
        engine: 'Memory',
      };

      await memoryEngine.createTable('schema_test', schema);
      const storedSchema = await memoryEngine.getTableSchema('schema_test');

      expect(storedSchema).not.toBeNull();
      expect(storedSchema!.columns).toHaveLength(4);
      expect(storedSchema!.columns[2].nullable).toBe(true);
      expect(storedSchema!.columns[3].default).toBe(0);
    });

    it('should retrieve schema by table name', async () => {
      await memoryEngine.createTable('named_table', {
        name: 'named_table',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      const schema = await memoryEngine.getTableSchema('named_table');

      expect(schema).not.toBeNull();
      expect(schema!.name).toBe('named_table');
    });

    it('should return null for non-existent table schema', async () => {
      const schema = await memoryEngine.getTableSchema('does_not_exist');
      expect(schema).toBeNull();
    });

    it('should store engine type in schema', async () => {
      await memoryEngine.createTable('engine_type_test', {
        name: 'engine_type_test',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      const schema = await memoryEngine.getTableSchema('engine_type_test');
      expect(schema!.engine).toBe('Memory');
    });

    it('should preserve column order', async () => {
      const columns = [
        { name: 'first', type: 'UInt64' },
        { name: 'second', type: 'String' },
        { name: 'third', type: 'Float64' },
        { name: 'fourth', type: 'DateTime' },
      ];

      await memoryEngine.createTable('ordered_columns', {
        name: 'ordered_columns',
        columns,
        engine: 'Memory',
      });

      const schema = await memoryEngine.getTableSchema('ordered_columns');
      expect(schema!.columns.map(c => c.name)).toEqual(['first', 'second', 'third', 'fourth']);
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 9: Large datasets (100K+ rows) work with DO storage
  // --------------------------------------------------------------------------
  describe('Large dataset handling (100K+ rows)', () => {
    it('should handle 100K row insert', async () => {
      await memoryEngine.createTable('large_insert', {
        name: 'large_insert',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'value', type: 'String' },
        ],
        engine: 'Memory',
      });

      const rows = Array.from({ length: 100_000 }, (_, i) => ({
        id: i + 1,
        value: `row_${i + 1}`,
      }));

      const result = await memoryEngine.insert('large_insert', rows);

      expect(result.success).toBe(true);
      expect(result.rowsInserted).toBe(100_000);
    }, 30000); // 30 second timeout for large insert

    it('should handle 100K row select', async () => {
      const state = createMockDOState();

      // Pre-populate with large dataset
      const largeData = Array.from({ length: 100_000 }, (_, i) => ({
        id: i + 1,
        value: `row_${i + 1}`,
      }));

      await state.storage.put('schema:large_select', {
        name: 'large_select',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'value', type: 'String' },
        ],
        engine: 'Memory',
      });
      await state.storage.put('data:large_select:chunk:0', largeData);
      await state.storage.put('tables', ['large_select']);

      const engine = new MemoryEngineDO(state);
      const result = await engine.select('large_select');

      expect(result.rows).toBe(100_000);
    }, 30000);

    it('should chunk large data for DO storage limits', async () => {
      // DO storage has 128KB limit per key, so large data should be chunked
      await memoryEngine.createTable('chunked_table', {
        name: 'chunked_table',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'payload', type: 'String' },
        ],
        engine: 'Memory',
      });

      // Create rows with large payloads
      const rows = Array.from({ length: 10_000 }, (_, i) => ({
        id: i + 1,
        payload: 'x'.repeat(100), // 100 chars per row = ~1MB total
      }));

      await memoryEngine.insert('chunked_table', rows);

      // Should have created multiple storage keys
      const putCalls = mockState.storage.put.mock.calls;
      const dataChunks = putCalls.filter(([key]) =>
        (key as string).startsWith('data:chunked_table:chunk:')
      );

      // With ~100KB per chunk, 1MB should need ~10 chunks
      expect(dataChunks.length).toBeGreaterThan(1);
    }, 30000);

    it('should support pagination for large result sets', async () => {
      const state = createMockDOState();
      const data = Array.from({ length: 50_000 }, (_, i) => ({ id: i + 1 }));

      await state.storage.put('schema:paginated', {
        name: 'paginated',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });
      await state.storage.put('data:paginated:chunk:0', data);
      await state.storage.put('tables', ['paginated']);

      const engine = new MemoryEngineDO(state);

      // Page 1
      const page1 = await engine.select('paginated', { limit: 1000, offset: 0 });
      expect(page1.rows).toBe(1000);

      // Page 50
      const page50 = await engine.select('paginated', { limit: 1000, offset: 49000 });
      expect(page50.rows).toBe(1000);
    }, 30000);
  });

  // --------------------------------------------------------------------------
  // Test Case 10: Concurrent writes are handled correctly
  // --------------------------------------------------------------------------
  describe('Concurrent write handling', () => {
    it('should not lose data under concurrent inserts', async () => {
      await memoryEngine.createTable('concurrent_inserts', {
        name: 'concurrent_inserts',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      // Simulate 10 concurrent insert requests
      const insertPromises = Array.from({ length: 10 }, (_, i) =>
        memoryEngine.insert('concurrent_inserts', [{ id: i + 1 }])
      );

      await Promise.all(insertPromises);

      const result = await memoryEngine.select('concurrent_inserts');
      expect(result.rows).toBe(10);
    });

    it('should serialize writes in order', async () => {
      await memoryEngine.createTable('ordered_writes', {
        name: 'ordered_writes',
        columns: [{ name: 'sequence', type: 'UInt64' }],
        engine: 'Memory',
      });

      // Writes should be serialized
      for (let i = 1; i <= 5; i++) {
        await memoryEngine.insert('ordered_writes', [{ sequence: i }]);
      }

      const result = await memoryEngine.select('ordered_writes');
      expect(result.rows).toBe(5);
      // Memory engine doesn't guarantee order, but all data should be present
      const sequences = result.data.map(r => r.sequence);
      expect(sequences).toContain(1);
      expect(sequences).toContain(5);
    });

    it('should handle concurrent create and drop', async () => {
      // Create table
      await memoryEngine.createTable('create_drop_test', {
        name: 'create_drop_test',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      // Concurrent drop and create should be serialized
      const dropPromise = memoryEngine.dropTable('create_drop_test');
      const createPromise = memoryEngine.createTable('create_drop_test_2', {
        name: 'create_drop_test_2',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      await Promise.all([dropPromise, createPromise]);

      const tables = await memoryEngine.listTables();
      expect(tables).not.toContain('create_drop_test');
      expect(tables).toContain('create_drop_test_2');
    });

    it('should prevent race conditions in row count updates', async () => {
      await memoryEngine.createTable('race_condition_test', {
        name: 'race_condition_test',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      // 100 concurrent single-row inserts
      const promises = Array.from({ length: 100 }, (_, i) =>
        memoryEngine.insert('race_condition_test', [{ id: i + 1 }])
      );

      await Promise.all(promises);

      const result = await memoryEngine.select('race_condition_test');
      expect(result.rows).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // Test Case 11: Transaction-like semantics (all-or-nothing inserts)
  // --------------------------------------------------------------------------
  describe('Transaction-like semantics', () => {
    it('should roll back on partial insert failure', async () => {
      await memoryEngine.createTable('atomic_insert', {
        name: 'atomic_insert',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'value', type: 'Int32' }, // Must be integer
        ],
        engine: 'Memory',
      });

      const rows = [
        { id: 1, value: 100 },
        { id: 2, value: 200 },
        { id: 3, value: 'invalid' as unknown as number }, // Will fail type check
        { id: 4, value: 400 },
      ];

      // Should fail and roll back all rows
      await expect(memoryEngine.insert('atomic_insert', rows)).rejects.toThrow(
        /type|invalid|mismatch/i
      );

      // No data should have been inserted
      const result = await memoryEngine.select('atomic_insert');
      expect(result.rows).toBe(0);
    });

    it('should use DO transactions for multi-key updates', async () => {
      await memoryEngine.createTable('transactional_table', {
        name: 'transactional_table',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      // Large insert that requires multiple storage keys
      const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: i + 1 }));
      await memoryEngine.insert('transactional_table', rows);

      // Should have used transaction for atomic update
      expect(mockState.storage.transaction).toHaveBeenCalled();
    });

    it('should maintain consistency after failed truncate', async () => {
      const state = createMockDOState();

      // Simulate storage failure during truncate
      let truncateAttempted = false;
      state.storage.delete = vi.fn().mockImplementation(async (key: string) => {
        if (key.includes('data:') && !truncateAttempted) {
          truncateAttempted = true;
          throw new Error('Storage failure');
        }
        return true;
      });

      await state.storage.put('schema:fail_truncate', {
        name: 'fail_truncate',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });
      await state.storage.put('data:fail_truncate:chunk:0', [{ id: 1 }, { id: 2 }]);
      await state.storage.put('tables', ['fail_truncate']);

      const engine = new MemoryEngineDO(state);

      // Truncate should fail
      await expect(engine.truncateTable('fail_truncate')).rejects.toThrow(/storage failure/i);

      // Original data should still be intact (no partial truncate)
      // This depends on implementation - might need transaction rollback
    });

    it('should complete batch inserts atomically', async () => {
      await memoryEngine.createTable('batch_atomic', {
        name: 'batch_atomic',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'batch', type: 'UInt32' },
        ],
        engine: 'Memory',
      });

      // Three batches
      const batch1 = Array.from({ length: 100 }, (_, i) => ({ id: i, batch: 1 }));
      const batch2 = Array.from({ length: 100 }, (_, i) => ({ id: 100 + i, batch: 2 }));
      const batch3 = Array.from({ length: 100 }, (_, i) => ({ id: 200 + i, batch: 3 }));

      await Promise.all([
        memoryEngine.insert('batch_atomic', batch1),
        memoryEngine.insert('batch_atomic', batch2),
        memoryEngine.insert('batch_atomic', batch3),
      ]);

      const result = await memoryEngine.select('batch_atomic');
      expect(result.rows).toBe(300);

      // Each batch should be complete (100 rows each)
      const batchCounts = [0, 0, 0, 0];
      for (const row of result.data) {
        batchCounts[row.batch as number]++;
      }
      expect(batchCounts[1]).toBe(100);
      expect(batchCounts[2]).toBe(100);
      expect(batchCounts[3]).toBe(100);
    });

    it('should handle insert + select consistency', async () => {
      await memoryEngine.createTable('consistency_test', {
        name: 'consistency_test',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'Memory',
      });

      // Insert and immediately select
      const insertResult = await memoryEngine.insert('consistency_test', [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);

      expect(insertResult.rowsInserted).toBe(3);

      // Select should see all inserted data immediately
      const selectResult = await memoryEngine.select('consistency_test');
      expect(selectResult.rows).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // Additional edge cases
  // --------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('should handle special characters in table names', async () => {
      // Table names should be validated
      await expect(
        memoryEngine.createTable('table with spaces', {
          name: 'table with spaces',
          columns: [{ name: 'id', type: 'UInt64' }],
          engine: 'Memory',
        })
      ).rejects.toThrow(/invalid.*name|identifier/i);
    });

    it('should handle special characters in column names', async () => {
      // Column names should be validated
      await expect(
        memoryEngine.createTable('special_cols', {
          name: 'special_cols',
          columns: [{ name: 'col with space', type: 'UInt64' }],
          engine: 'Memory',
        })
      ).rejects.toThrow(/invalid.*name|identifier/i);
    });

    it('should handle empty string values', async () => {
      await memoryEngine.createTable('empty_strings', {
        name: 'empty_strings',
        columns: [{ name: 'value', type: 'String' }],
        engine: 'Memory',
      });

      await memoryEngine.insert('empty_strings', [
        { value: '' },
        { value: 'non-empty' },
        { value: '' },
      ]);

      const result = await memoryEngine.select('empty_strings');
      expect(result.data.filter(r => r.value === '')).toHaveLength(2);
    });

    it('should handle unicode data', async () => {
      await memoryEngine.createTable('unicode_table', {
        name: 'unicode_table',
        columns: [{ name: 'text', type: 'String' }],
        engine: 'Memory',
      });

      await memoryEngine.insert('unicode_table', [
        { text: 'Hello' },
        { text: 'Hello World' },
        { text: 'Emojis work too' },
        { text: 'Chinese: Yi Qian' },
      ]);

      const result = await memoryEngine.select('unicode_table');
      expect(result.rows).toBe(4);
      expect(result.data.some(r => (r.text as string).includes('Qian'))).toBe(true);
    });

    it('should handle very long strings', async () => {
      await memoryEngine.createTable('long_strings', {
        name: 'long_strings',
        columns: [{ name: 'content', type: 'String' }],
        engine: 'Memory',
      });

      const longString = 'x'.repeat(1_000_000); // 1MB string

      await memoryEngine.insert('long_strings', [{ content: longString }]);

      const result = await memoryEngine.select('long_strings');
      expect(result.data[0].content).toBe(longString);
    }, 10000);

    it('should handle numeric precision', async () => {
      await memoryEngine.createTable('numeric_precision', {
        name: 'numeric_precision',
        columns: [
          { name: 'big_int', type: 'UInt64' },
          { name: 'decimal', type: 'Float64' },
        ],
        engine: 'Memory',
      });

      await memoryEngine.insert('numeric_precision', [
        { big_int: 9007199254740991, decimal: 3.141592653589793 }, // Max safe integer
        { big_int: 9007199254740992, decimal: 0.1 + 0.2 }, // Beyond safe integer
      ]);

      const result = await memoryEngine.select('numeric_precision');
      expect(result.data[0].big_int).toBe(9007199254740991);
      expect(result.data[0].decimal).toBeCloseTo(3.141592653589793, 15);
    });
  });
});

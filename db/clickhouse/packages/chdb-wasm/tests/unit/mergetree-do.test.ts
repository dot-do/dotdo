/**
 * MergeTree Durable Object Storage Tests
 *
 * Tests the MergeTree table engine backed by Cloudflare Durable Objects storage.
 * This validates the wiring between the HTTP query handler and MergeTree DO storage.
 *
 * Key Features Tested:
 * - CREATE TABLE creates table metadata in DO
 * - INSERT writes data to DO storage
 * - SELECT reads from DO storage with filtering
 * - DROP TABLE removes table and all data
 * - HTTP request handling (fetch interface)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { MergeTreeDO } from '../../src/storage/mergetree-do';
import type {
  MergeTreeTableSchema,
  DurableObjectState,
  DurableObjectStorage,
} from '../../src/storage/mergetree-do';

// ============================================================================
// Mock Types and Factories
// ============================================================================

/**
 * Mock Durable Object Storage interface
 */
interface MockDurableObjectStorage extends DurableObjectStorage {
  get: Mock;
  put: Mock;
  delete: Mock;
  deleteAll: Mock;
  list: Mock;
  transaction: Mock;
}

/**
 * Create a mock Durable Object storage for testing
 */
function createMockDOStorage(): MockDurableObjectStorage {
  const storage = new Map<string, unknown>();

  const mockStorage: MockDurableObjectStorage = {
    get: vi.fn().mockImplementation(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        const result = new Map<string, unknown>();
        for (const k of key) {
          const val = storage.get(k);
          if (val !== undefined) result.set(k, val);
        }
        return result;
      }
      return storage.get(key);
    }),
    put: vi.fn().mockImplementation(async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrEntries === 'string') {
        storage.set(keyOrEntries, value);
      } else {
        for (const [k, v] of Object.entries(keyOrEntries)) {
          storage.set(k, v);
        }
      }
    }),
    delete: vi.fn().mockImplementation(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        let count = 0;
        for (const k of key) {
          if (storage.delete(k)) count++;
        }
        return count;
      }
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
      return callback(mockStorage);
    }),
  };

  return mockStorage;
}

/**
 * Create a mock Durable Object state
 */
function createMockDOState(): DurableObjectState {
  let mutex: Promise<unknown> = Promise.resolve();

  return {
    storage: createMockDOStorage(),
    id: { toString: () => 'test-mergetree-do-id' },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn().mockImplementation(async <T>(callback: () => Promise<T>): Promise<T> => {
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

// ============================================================================
// TEST SUITE: MergeTree Durable Object Storage
// ============================================================================

describe('MergeTree Durable Object Storage', () => {
  let mockState: DurableObjectState;
  let mergeTreeDO: MergeTreeDO;

  beforeEach(() => {
    mockState = createMockDOState();
    mergeTreeDO = new MergeTreeDO(mockState);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // CREATE TABLE Tests
  // --------------------------------------------------------------------------
  describe('CREATE TABLE', () => {
    it('should create table metadata in DO storage', async () => {
      const schema: MergeTreeTableSchema = {
        name: 'test_users',
        database: 'default',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
          { name: 'created_at', type: 'DateTime' },
        ],
        engine: 'MergeTree',
        orderBy: ['id'],
      };

      await mergeTreeDO.createTable('test_users', 'default', schema);

      // Verify schema was stored
      const storedSchema = await mergeTreeDO.getTableSchema('test_users', 'default');
      expect(storedSchema).not.toBeNull();
      expect(storedSchema?.name).toBe('test_users');
      expect(storedSchema?.columns).toHaveLength(3);
      expect(storedSchema?.engine).toBe('MergeTree');
    });

    it('should reject invalid table names', async () => {
      const schema: MergeTreeTableSchema = {
        name: '123invalid',
        database: 'default',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'MergeTree',
      };

      await expect(mergeTreeDO.createTable('123invalid', 'default', schema))
        .rejects.toThrow(/Invalid table name/);
    });

    it('should reject tables with no columns', async () => {
      const schema: MergeTreeTableSchema = {
        name: 'empty_table',
        database: 'default',
        columns: [],
        engine: 'MergeTree',
      };

      await expect(mergeTreeDO.createTable('empty_table', 'default', schema))
        .rejects.toThrow(/at least one column/);
    });

    it('should reject duplicate table creation', async () => {
      const schema: MergeTreeTableSchema = {
        name: 'test_table',
        database: 'default',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'MergeTree',
      };

      await mergeTreeDO.createTable('test_table', 'default', schema);

      await expect(mergeTreeDO.createTable('test_table', 'default', schema))
        .rejects.toThrow(/already exists/);
    });
  });

  // --------------------------------------------------------------------------
  // INSERT Tests
  // --------------------------------------------------------------------------
  describe('INSERT', () => {
    beforeEach(async () => {
      const schema: MergeTreeTableSchema = {
        name: 'test_users',
        database: 'default',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
          { name: 'score', type: 'Float64' },
        ],
        engine: 'MergeTree',
        orderBy: ['id'],
      };
      await mergeTreeDO.createTable('test_users', 'default', schema);
    });

    it('should insert single row', async () => {
      const result = await mergeTreeDO.insert(
        'test_users',
        'default',
        ['id', 'name', 'score'],
        [[1, 'Alice', 95.5]]
      );

      expect(result.success).toBe(true);
      expect(result.rowsInserted).toBe(1);
    });

    it('should insert multiple rows', async () => {
      const result = await mergeTreeDO.insert(
        'test_users',
        'default',
        ['id', 'name', 'score'],
        [
          [1, 'Alice', 95.5],
          [2, 'Bob', 87.0],
          [3, 'Charlie', 92.3],
        ]
      );

      expect(result.success).toBe(true);
      expect(result.rowsInserted).toBe(3);
    });

    it('should reject insert to non-existent table', async () => {
      await expect(
        mergeTreeDO.insert(
          'nonexistent',
          'default',
          ['id', 'name'],
          [[1, 'Alice']]
        )
      ).rejects.toThrow(/does not exist/);
    });
  });

  // --------------------------------------------------------------------------
  // SELECT Tests
  // --------------------------------------------------------------------------
  describe('SELECT', () => {
    beforeEach(async () => {
      const schema: MergeTreeTableSchema = {
        name: 'test_users',
        database: 'default',
        columns: [
          { name: 'id', type: 'UInt64' },
          { name: 'name', type: 'String' },
          { name: 'score', type: 'Float64' },
        ],
        engine: 'MergeTree',
        orderBy: ['id'],
      };
      await mergeTreeDO.createTable('test_users', 'default', schema);
      await mergeTreeDO.insert(
        'test_users',
        'default',
        ['id', 'name', 'score'],
        [
          [1, 'Alice', 95.5],
          [2, 'Bob', 87.0],
          [3, 'Charlie', 92.3],
        ]
      );
    });

    it('should select all rows', async () => {
      const result = await mergeTreeDO.select('test_users', 'default');

      expect(result.rows).toBe(3);
      expect(result.data).toHaveLength(3);
      expect(result.meta).toHaveLength(3);
    });

    it('should filter rows with WHERE clause', async () => {
      const result = await mergeTreeDO.select('test_users', 'default', {
        where: 'score > 90',
      });

      expect(result.rows).toBe(2);
      expect(result.data.map((r) => r.name)).toContain('Alice');
      expect(result.data.map((r) => r.name)).toContain('Charlie');
    });

    it('should order rows with ORDER BY', async () => {
      const result = await mergeTreeDO.select('test_users', 'default', {
        orderBy: 'score DESC',
      });

      expect(result.data[0].name).toBe('Alice');
      expect(result.data[1].name).toBe('Charlie');
      expect(result.data[2].name).toBe('Bob');
    });

    it('should limit rows with LIMIT', async () => {
      const result = await mergeTreeDO.select('test_users', 'default', {
        limit: 2,
      });

      expect(result.rows).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it('should select specific columns', async () => {
      const result = await mergeTreeDO.select('test_users', 'default', {
        columns: 'id, name',
      });

      expect(result.meta).toHaveLength(2);
      expect(result.meta.map((m) => m.name)).toContain('id');
      expect(result.meta.map((m) => m.name)).toContain('name');
      expect(result.data[0]).not.toHaveProperty('score');
    });

    it('should reject select from non-existent table', async () => {
      await expect(
        mergeTreeDO.select('nonexistent', 'default')
      ).rejects.toThrow(/does not exist/);
    });
  });

  // --------------------------------------------------------------------------
  // DROP TABLE Tests
  // --------------------------------------------------------------------------
  describe('DROP TABLE', () => {
    beforeEach(async () => {
      const schema: MergeTreeTableSchema = {
        name: 'test_users',
        database: 'default',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'MergeTree',
      };
      await mergeTreeDO.createTable('test_users', 'default', schema);
    });

    it('should drop table and remove data', async () => {
      await mergeTreeDO.dropTable('test_users', 'default');

      const schema = await mergeTreeDO.getTableSchema('test_users', 'default');
      expect(schema).toBeNull();
    });

    it('should reject drop of non-existent table', async () => {
      await expect(mergeTreeDO.dropTable('nonexistent', 'default'))
        .rejects.toThrow(/does not exist/);
    });
  });

  // --------------------------------------------------------------------------
  // HTTP Request Handler (fetch) Tests
  // --------------------------------------------------------------------------
  describe('HTTP Request Handler', () => {
    it('should handle POST /create request', async () => {
      const request = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'test_http',
          database: 'default',
          columns: [
            { name: 'id', type: 'UInt64' },
            { name: 'name', type: 'String' },
          ],
          engine: 'MergeTree',
          orderBy: ['id'],
        }),
      });

      const response = await mergeTreeDO.fetch(request);
      const result = await response.json();

      expect(response.ok).toBe(true);
      expect(result.success).toBe(true);
    });

    it('should handle POST /insert request', async () => {
      // First create the table
      const createRequest = new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'test_http',
          database: 'default',
          columns: [{ name: 'id', type: 'UInt64' }],
          engine: 'MergeTree',
        }),
      });
      await mergeTreeDO.fetch(createRequest);

      // Then insert data
      const insertRequest = new Request('http://do/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'test_http',
          database: 'default',
          columns: ['id'],
          values: [[1], [2], [3]],
        }),
      });

      const response = await mergeTreeDO.fetch(insertRequest);
      const result = await response.json();

      expect(response.ok).toBe(true);
      expect(result.rowsInserted).toBe(3);
    });

    it('should handle POST /select request', async () => {
      // Setup table with data
      await mergeTreeDO.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'test_http',
          database: 'default',
          columns: [{ name: 'id', type: 'UInt64' }],
          engine: 'MergeTree',
        }),
      }));
      await mergeTreeDO.fetch(new Request('http://do/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'test_http',
          database: 'default',
          columns: ['id'],
          values: [[1], [2]],
        }),
      }));

      // Select data
      const selectRequest = new Request('http://do/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'test_http',
          database: 'default',
          columns: '*',
        }),
      });

      const response = await mergeTreeDO.fetch(selectRequest);
      const result = await response.json();

      expect(response.ok).toBe(true);
      expect(result.rows).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it('should return 404 for unknown endpoints', async () => {
      const request = new Request('http://do/unknown', {
        method: 'GET',
      });

      const response = await mergeTreeDO.fetch(request);

      expect(response.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // Integration Tests (HTTP handler wiring)
  // --------------------------------------------------------------------------
  describe('HTTP Handler Wiring', () => {
    it('should support complete table lifecycle via HTTP', async () => {
      // 1. CREATE TABLE
      const createResponse = await mergeTreeDO.fetch(new Request('http://do/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'lifecycle_test',
          database: 'test_db',
          columns: [
            { name: 'id', type: 'UInt64' },
            { name: 'value', type: 'String' },
          ],
          engine: 'MergeTree',
          orderBy: ['id'],
        }),
      }));
      expect(createResponse.ok).toBe(true);

      // 2. INSERT data
      const insertResponse = await mergeTreeDO.fetch(new Request('http://do/insert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'lifecycle_test',
          database: 'test_db',
          columns: ['id', 'value'],
          values: [
            [1, 'first'],
            [2, 'second'],
          ],
        }),
      }));
      expect(insertResponse.ok).toBe(true);

      // 3. SELECT data
      const selectResponse = await mergeTreeDO.fetch(new Request('http://do/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'lifecycle_test',
          database: 'test_db',
        }),
      }));
      const selectResult = await selectResponse.json();
      expect(selectResult.rows).toBe(2);

      // 4. DROP TABLE
      const dropResponse = await mergeTreeDO.fetch(new Request('http://do/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'lifecycle_test',
          database: 'test_db',
        }),
      }));
      expect(dropResponse.ok).toBe(true);

      // 5. Verify table is gone
      const schemaResponse = await mergeTreeDO.fetch(new Request('http://do/schema?table=lifecycle_test&database=test_db', {
        method: 'GET',
      }));
      expect(schemaResponse.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // List Tables Tests
  // --------------------------------------------------------------------------
  describe('listTables', () => {
    it('should list all tables across databases', async () => {
      // Create tables in different databases
      await mergeTreeDO.createTable('users', 'db1', {
        name: 'users',
        database: 'db1',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'MergeTree',
      });
      await mergeTreeDO.createTable('orders', 'db2', {
        name: 'orders',
        database: 'db2',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'MergeTree',
      });

      const tables = await mergeTreeDO.listTables();
      expect(tables).toContain('db1.users');
      expect(tables).toContain('db2.orders');
    });

    it('should filter tables by database', async () => {
      await mergeTreeDO.createTable('users', 'db1', {
        name: 'users',
        database: 'db1',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'MergeTree',
      });
      await mergeTreeDO.createTable('orders', 'db2', {
        name: 'orders',
        database: 'db2',
        columns: [{ name: 'id', type: 'UInt64' }],
        engine: 'MergeTree',
      });

      const db1Tables = await mergeTreeDO.listTables('db1');
      expect(db1Tables).toContain('users');
      expect(db1Tables).not.toContain('orders');
    });
  });
});

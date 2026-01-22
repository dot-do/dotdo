/**
 * MergeTree Durable Object - Metadata & Coordination
 *
 * This Durable Object provides the metadata storage and coordination layer
 * for the MergeTree VFS implementation. It handles:
 * - Table schema storage
 * - Part registry (tracking which parts exist and their state)
 * - Mutation log for tracking changes
 * - Write lock coordination
 */

import { DurableObject } from 'cloudflare:workers';

// =============================================================================
// Types
// =============================================================================

/**
 * MergeTree part state
 */
export type PartState =
  | 'temporary' // Being written
  | 'committed' // Ready for queries
  | 'merging' // Being merged
  | 'obsolete' // Superseded by merge
  | 'deleting'; // Scheduled for deletion

/**
 * MergeTree part metadata
 */
export interface PartInfo {
  /** Part name (e.g., "20240115_1_1_0") */
  name: string;

  /** Part state */
  state: PartState;

  /** Partition key value */
  partition: string;

  /** Minimum block number */
  minBlock: number;

  /** Maximum block number */
  maxBlock: number;

  /** Merge level */
  level: number;

  /** Row count */
  rows: number;

  /** Compressed bytes */
  bytesCompressed: number;

  /** Uncompressed bytes */
  bytesUncompressed: number;

  /** Modification time */
  modificationTime: number;

  /** R2 object keys for this part */
  r2Keys: string[];

  /** Checksum of part data */
  checksum: string;
}

/**
 * Table schema stored in DO
 */
export interface TableSchema {
  /** Table name */
  name: string;

  /** Database name */
  database: string;

  /** Column definitions */
  columns: Array<{
    name: string;
    type: string;
    codec?: string;
    ttl?: string;
  }>;

  /** Primary key columns */
  primaryKey: string[];

  /** Order by columns */
  orderBy: string[];

  /** Partition by expression */
  partitionBy?: string;

  /** Engine settings */
  settings: Record<string, string | number | boolean>;

  /** Creation timestamp */
  createdAt: string;

  /** Last modification timestamp */
  modifiedAt: string;
}

/**
 * Mutation entry
 */
export interface Mutation {
  /** Mutation ID */
  id: string;

  /** Mutation type */
  type: 'DELETE' | 'UPDATE' | 'MATERIALIZE_INDEX';

  /** Mutation command/predicate */
  command: string;

  /** Parts affected */
  partsToMutate: string[];

  /** Status */
  status: 'pending' | 'executing' | 'done' | 'failed';

  /** Creation time (Unix timestamp ms) */
  createdAt: number;

  /** Completion time (Unix timestamp ms) */
  completedAt?: number;

  /** Error message if failed */
  error?: string;
}

/**
 * Lock info for write coordination
 */
interface LockInfo {
  /** Lock ID */
  lockId: string;
  /** Lock holder identifier */
  holder: string;
  /** Lock acquisition time */
  acquiredAt: number;
  /** Lock expiration time */
  expiresAt: number;
}

/**
 * Environment bindings for MergeTreeDO
 */
export interface MergeTreeDOEnv {
  MERGETREE_DO: DurableObjectNamespace<MergeTreeDO>;
}

// =============================================================================
// MergeTreeDO Implementation
// =============================================================================

/**
 * MergeTree metadata Durable Object
 *
 * Provides consistent metadata storage and write coordination for MergeTree tables.
 * Each table gets its own Durable Object instance, identified by database.table name.
 */
export class MergeTreeDO extends DurableObject {
  private schemas: Map<string, TableSchema> = new Map();
  private parts: Map<string, Map<string, PartInfo>> = new Map();
  private mutations: Map<string, Map<string, Mutation>> = new Map();
  private nextBlockNumber: Map<string, number> = new Map();
  private locks: Map<string, LockInfo> = new Map();
  private initialized = false;

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Load state from storage on first access
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.initialized) return;

      // Load schemas
      const storedSchemas = await this.ctx.storage.get<
        Record<string, TableSchema>
      >('schemas');
      if (storedSchemas) {
        this.schemas = new Map(Object.entries(storedSchemas));
      }

      // Load next block numbers
      const storedBlockNumbers =
        await this.ctx.storage.get<Record<string, number>>('nextBlockNumbers');
      if (storedBlockNumbers) {
        this.nextBlockNumber = new Map(Object.entries(storedBlockNumbers));
      }

      // Load parts for each table
      const tableList = await this.ctx.storage.get<string[]>('tableList');
      if (tableList) {
        for (const table of tableList) {
          const storedParts = await this.ctx.storage.get<
            Record<string, PartInfo>
          >(`parts:${table}`);
          if (storedParts) {
            this.parts.set(table, new Map(Object.entries(storedParts)));
          }
        }
      }

      this.initialized = true;
    });
  }

  // ---------------------------------------------------------------------------
  // Schema Operations
  // ---------------------------------------------------------------------------

  /**
   * Get table schema
   */
  async getSchema(table: string): Promise<TableSchema | null> {
    await this.ensureInitialized();
    return this.schemas.get(table) || null;
  }

  /**
   * Set/update table schema
   */
  async setSchema(table: string, schema: TableSchema): Promise<void> {
    await this.ensureInitialized();

    await this.ctx.blockConcurrencyWhile(async () => {
      const isNew = !this.schemas.has(table);
      this.schemas.set(table, schema);

      // Persist schema
      await this.ctx.storage.put(
        'schemas',
        Object.fromEntries(this.schemas.entries())
      );

      // Update table list if new table
      if (isNew) {
        const tableList = Array.from(this.schemas.keys());
        await this.ctx.storage.put('tableList', tableList);

        // Initialize parts map for new table
        if (!this.parts.has(table)) {
          this.parts.set(table, new Map());
        }

        // Initialize block number for new table
        if (!this.nextBlockNumber.has(table)) {
          this.nextBlockNumber.set(table, 1);
          await this.ctx.storage.put(
            'nextBlockNumbers',
            Object.fromEntries(this.nextBlockNumber.entries())
          );
        }
      }
    });
  }

  /**
   * Delete table schema and all associated data
   */
  async deleteSchema(table: string): Promise<void> {
    await this.ensureInitialized();

    await this.ctx.blockConcurrencyWhile(async () => {
      this.schemas.delete(table);
      this.parts.delete(table);
      this.mutations.delete(table);
      this.nextBlockNumber.delete(table);
      this.locks.delete(table);

      // Persist changes
      await this.ctx.storage.put(
        'schemas',
        Object.fromEntries(this.schemas.entries())
      );
      await this.ctx.storage.put('tableList', Array.from(this.schemas.keys()));
      await this.ctx.storage.delete(`parts:${table}`);
      await this.ctx.storage.delete(`mutations:${table}`);
      await this.ctx.storage.put(
        'nextBlockNumbers',
        Object.fromEntries(this.nextBlockNumber.entries())
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Part Registry Operations
  // ---------------------------------------------------------------------------

  /**
   * List all parts for a table
   */
  async listParts(table: string): Promise<PartInfo[]> {
    await this.ensureInitialized();
    const tableParts = this.parts.get(table);
    if (!tableParts) {
      return [];
    }
    return Array.from(tableParts.values());
  }

  /**
   * Get active (committed) parts for a table
   */
  async getActiveParts(table: string, partition?: string): Promise<PartInfo[]> {
    await this.ensureInitialized();
    const tableParts = this.parts.get(table);
    if (!tableParts) {
      return [];
    }

    return Array.from(tableParts.values())
      .filter((p) => p.state === 'committed')
      .filter((p) => !partition || p.partition === partition);
  }

  /**
   * Register a new part (during insert)
   */
  async registerPart(
    table: string,
    part: Omit<PartInfo, 'minBlock' | 'maxBlock' | 'state'>
  ): Promise<PartInfo> {
    await this.ensureInitialized();

    return await this.ctx.blockConcurrencyWhile(async () => {
      // Get or create parts map for table
      let tableParts = this.parts.get(table);
      if (!tableParts) {
        tableParts = new Map();
        this.parts.set(table, tableParts);
      }

      // Allocate block number
      const blockNum = this.nextBlockNumber.get(table) || 1;
      this.nextBlockNumber.set(table, blockNum + 1);

      const fullPart: PartInfo = {
        ...part,
        minBlock: blockNum,
        maxBlock: blockNum,
        state: 'temporary',
      };

      tableParts.set(fullPart.name, fullPart);

      // Persist
      await this.persistParts(table);
      await this.ctx.storage.put(
        'nextBlockNumbers',
        Object.fromEntries(this.nextBlockNumber.entries())
      );

      return fullPart;
    });
  }

  /**
   * Commit a part (make visible for queries)
   */
  async commitPart(table: string, partId: string): Promise<void> {
    await this.ensureInitialized();

    await this.ctx.blockConcurrencyWhile(async () => {
      const tableParts = this.parts.get(table);
      if (!tableParts) {
        throw new Error(`Table ${table} not found`);
      }

      const part = tableParts.get(partId);
      if (!part) {
        throw new Error(`Part ${partId} not found in table ${table}`);
      }

      if (part.state !== 'temporary') {
        throw new Error(`Part ${partId} is not in temporary state`);
      }

      part.state = 'committed';
      part.modificationTime = Date.now();

      await this.persistParts(table);
    });
  }

  /**
   * Mark a part as obsolete (after merge)
   */
  async markObsolete(table: string, partId: string): Promise<void> {
    await this.ensureInitialized();

    await this.ctx.blockConcurrencyWhile(async () => {
      const tableParts = this.parts.get(table);
      if (!tableParts) {
        throw new Error(`Table ${table} not found`);
      }

      const part = tableParts.get(partId);
      if (!part) {
        throw new Error(`Part ${partId} not found in table ${table}`);
      }

      part.state = 'obsolete';
      part.modificationTime = Date.now();

      await this.persistParts(table);
    });
  }

  /**
   * Register a merge result
   */
  async registerMerge(
    table: string,
    resultPart: Omit<PartInfo, 'state'>,
    sourceParts: string[]
  ): Promise<void> {
    await this.ensureInitialized();

    await this.ctx.blockConcurrencyWhile(async () => {
      const tableParts = this.parts.get(table);
      if (!tableParts) {
        throw new Error(`Table ${table} not found`);
      }

      // Mark source parts as obsolete
      for (const name of sourceParts) {
        const part = tableParts.get(name);
        if (part && part.state === 'committed') {
          part.state = 'obsolete';
        }
      }

      // Add merged part as committed
      tableParts.set(resultPart.name, { ...resultPart, state: 'committed' });

      await this.persistParts(table);
    });
  }

  /**
   * Delete obsolete parts (cleanup)
   */
  async cleanupObsoleteParts(table: string): Promise<string[]> {
    await this.ensureInitialized();

    return await this.ctx.blockConcurrencyWhile(async () => {
      const tableParts = this.parts.get(table);
      if (!tableParts) {
        return [];
      }

      const toDelete: string[] = [];

      for (const [name, part] of tableParts) {
        if (part.state === 'obsolete') {
          toDelete.push(name);
        }
      }

      for (const name of toDelete) {
        tableParts.delete(name);
      }

      await this.persistParts(table);
      return toDelete;
    });
  }

  // ---------------------------------------------------------------------------
  // Mutation Log Operations
  // ---------------------------------------------------------------------------

  /**
   * Append a mutation to the log
   */
  async appendMutation(
    table: string,
    mutation: Omit<Mutation, 'id' | 'status' | 'createdAt'>
  ): Promise<string> {
    await this.ensureInitialized();

    const id = `mutation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const entry: Mutation = {
      ...mutation,
      id,
      status: 'pending',
      createdAt: Date.now(),
    };

    await this.ctx.blockConcurrencyWhile(async () => {
      let tableMutations = this.mutations.get(table);
      if (!tableMutations) {
        tableMutations = new Map();
        this.mutations.set(table, tableMutations);
      }

      tableMutations.set(id, entry);
      await this.ctx.storage.put(
        `mutations:${table}`,
        Object.fromEntries(tableMutations.entries())
      );
    });

    return id;
  }

  /**
   * Get mutations since a given timestamp
   */
  async getMutations(table: string, since?: number): Promise<Mutation[]> {
    await this.ensureInitialized();

    // Load mutations from storage if not in memory
    let tableMutations = this.mutations.get(table);
    if (!tableMutations) {
      const stored = await this.ctx.storage.get<Record<string, Mutation>>(
        `mutations:${table}`
      );
      if (stored) {
        tableMutations = new Map(Object.entries(stored));
        this.mutations.set(table, tableMutations);
      } else {
        return [];
      }
    }

    let results = Array.from(tableMutations.values());

    if (since !== undefined) {
      results = results.filter((m) => m.createdAt > since);
    }

    return results.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Update mutation status
   */
  async updateMutationStatus(
    table: string,
    mutationId: string,
    status: Mutation['status'],
    error?: string
  ): Promise<void> {
    await this.ensureInitialized();

    await this.ctx.blockConcurrencyWhile(async () => {
      const tableMutations = this.mutations.get(table);
      if (!tableMutations) {
        throw new Error(`No mutations for table ${table}`);
      }

      const mutation = tableMutations.get(mutationId);
      if (!mutation) {
        throw new Error(`Mutation ${mutationId} not found`);
      }

      mutation.status = status;
      if (status === 'done' || status === 'failed') {
        mutation.completedAt = Date.now();
      }
      if (error) {
        mutation.error = error;
      }

      await this.ctx.storage.put(
        `mutations:${table}`,
        Object.fromEntries(tableMutations.entries())
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Write Coordination / Locking
  // ---------------------------------------------------------------------------

  /**
   * Acquire a write lock for a table
   * @param table Table name
   * @param timeout Lock timeout in milliseconds
   * @returns Lock ID if acquired, or throws if lock cannot be acquired
   */
  async acquireLock(table: string, timeout: number): Promise<string> {
    await this.ensureInitialized();

    const lockId = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();
    const maxWait = Math.min(timeout, 30000); // Cap at 30 seconds

    while (Date.now() - startTime < maxWait) {
      const acquired = await this.ctx.blockConcurrencyWhile(async () => {
        const existingLock = this.locks.get(table);

        // Check if existing lock has expired
        if (existingLock && existingLock.expiresAt < Date.now()) {
          this.locks.delete(table);
        }

        // Try to acquire lock
        if (!this.locks.has(table)) {
          const lockInfo: LockInfo = {
            lockId,
            holder: lockId,
            acquiredAt: Date.now(),
            expiresAt: Date.now() + timeout,
          };
          this.locks.set(table, lockInfo);
          return true;
        }

        return false;
      });

      if (acquired) {
        return lockId;
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Failed to acquire lock for table ${table} within timeout`);
  }

  /**
   * Release a write lock
   * @param table Table name
   * @param lockId Lock ID returned from acquireLock
   */
  async releaseLock(table: string, lockId: string): Promise<void> {
    await this.ensureInitialized();

    await this.ctx.blockConcurrencyWhile(async () => {
      const existingLock = this.locks.get(table);

      if (existingLock && existingLock.lockId === lockId) {
        this.locks.delete(table);
      }
      // If lock doesn't exist or doesn't match, silently succeed
      // (lock may have expired or been released by another mechanism)
    });
  }

  /**
   * Check if a lock is held
   */
  async isLocked(table: string): Promise<boolean> {
    await this.ensureInitialized();

    const lock = this.locks.get(table);
    if (!lock) {
      return false;
    }

    // Check if expired
    if (lock.expiresAt < Date.now()) {
      this.locks.delete(table);
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // HTTP Interface (optional RPC-style access)
  // ---------------------------------------------------------------------------

  /**
   * Handle HTTP requests to the Durable Object
   * This allows RPC-style access from Workers
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // Route requests to appropriate methods
      if (path === '/schema' && method === 'GET') {
        const table = url.searchParams.get('table');
        if (!table) {
          return new Response('Missing table parameter', { status: 400 });
        }
        const schema = await this.getSchema(table);
        return Response.json(schema);
      }

      if (path === '/schema' && method === 'PUT') {
        const { table, schema } = (await request.json()) as {
          table: string;
          schema: TableSchema;
        };
        await this.setSchema(table, schema);
        return new Response('OK');
      }

      if (path === '/parts' && method === 'GET') {
        const table = url.searchParams.get('table');
        if (!table) {
          return new Response('Missing table parameter', { status: 400 });
        }
        const parts = await this.listParts(table);
        return Response.json(parts);
      }

      if (path === '/parts/active' && method === 'GET') {
        const table = url.searchParams.get('table');
        const partition = url.searchParams.get('partition') || undefined;
        if (!table) {
          return new Response('Missing table parameter', { status: 400 });
        }
        const parts = await this.getActiveParts(table, partition);
        return Response.json(parts);
      }

      if (path === '/parts/register' && method === 'POST') {
        const { table, part } = (await request.json()) as {
          table: string;
          part: Omit<PartInfo, 'minBlock' | 'maxBlock' | 'state'>;
        };
        const registered = await this.registerPart(table, part);
        return Response.json(registered);
      }

      if (path === '/parts/commit' && method === 'POST') {
        const { table, partId } = (await request.json()) as {
          table: string;
          partId: string;
        };
        await this.commitPart(table, partId);
        return new Response('OK');
      }

      if (path === '/parts/obsolete' && method === 'POST') {
        const { table, partId } = (await request.json()) as {
          table: string;
          partId: string;
        };
        await this.markObsolete(table, partId);
        return new Response('OK');
      }

      if (path === '/mutations' && method === 'GET') {
        const table = url.searchParams.get('table');
        const since = url.searchParams.get('since');
        if (!table) {
          return new Response('Missing table parameter', { status: 400 });
        }
        const mutations = await this.getMutations(
          table,
          since ? parseInt(since) : undefined
        );
        return Response.json(mutations);
      }

      if (path === '/mutations' && method === 'POST') {
        const { table, mutation } = (await request.json()) as {
          table: string;
          mutation: Omit<Mutation, 'id' | 'status' | 'createdAt'>;
        };
        const id = await this.appendMutation(table, mutation);
        return Response.json({ id });
      }

      if (path === '/lock/acquire' && method === 'POST') {
        const { table, timeout } = (await request.json()) as {
          table: string;
          timeout: number;
        };
        const lockId = await this.acquireLock(table, timeout);
        return Response.json({ lockId });
      }

      if (path === '/lock/release' && method === 'POST') {
        const { table, lockId } = (await request.json()) as {
          table: string;
          lockId: string;
        };
        await this.releaseLock(table, lockId);
        return new Response('OK');
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(message, { status: 500 });
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async persistParts(table: string): Promise<void> {
    const tableParts = this.parts.get(table);
    if (tableParts) {
      await this.ctx.storage.put(
        `parts:${table}`,
        Object.fromEntries(tableParts.entries())
      );
    }
  }
}

// =============================================================================
// Helper function for getting DO stub
// =============================================================================

/**
 * Get the MergeTreeDO instance for a specific database.table
 */
export function getMergeTreeDO(
  env: MergeTreeDOEnv,
  database: string,
  table: string
): DurableObjectStub<MergeTreeDO> {
  const id = env.MERGETREE_DO.idFromName(`${database}.${table}`);
  return env.MERGETREE_DO.get(id);
}

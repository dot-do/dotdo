/**
 * MergeTree Durable Object Storage
 *
 * Implements a Cloudflare Durable Object that manages MergeTree table metadata
 * and coordinates with R2 for data storage. This provides persistent storage
 * for ClickHouse MergeTree tables in a serverless environment.
 *
 * Architecture:
 * - DO Storage: Table schema, part metadata, row counts
 * - R2 Storage: Actual data files (bin, mrk, idx)
 *
 * Key Features:
 * - CREATE TABLE creates table metadata in DO
 * - INSERT writes data to DO storage (later synced to R2)
 * - SELECT reads from DO storage with aggregation support
 * - Data survives Worker restarts due to DO persistence
 *
 * @module storage/mergetree-do
 */

// =============================================================================
// Constants
// =============================================================================

/** DO storage has 128KB limit per key, so we chunk at ~100KB */
const MAX_CHUNK_SIZE_BYTES = 100 * 1024;

/** Maximum number of keys to read/write in a single batch operation */
const BATCH_SIZE = 128;

/** Storage key prefixes for different data types */
const STORAGE_KEYS = {
  SCHEMA_PREFIX: 'schema:',
  DATA_PREFIX: 'data:',
  CHUNK_INFIX: ':chunk:',
  PART_PREFIX: 'part:',
  TABLES_LIST: 'tables',
} as const;

// =============================================================================
// TypeScript Type Definitions
// =============================================================================

/**
 * Table schema definition for MergeTree tables
 */
export interface MergeTreeTableSchema {
  name: string;
  database: string;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    default?: unknown;
  }>;
  engine: string;
  orderBy?: string[];
  partitionBy?: string;
  createdAt?: string;
}

/**
 * Column metadata for query results
 */
export interface ColumnMeta {
  name: string;
  type: string;
}

/**
 * Row type for data operations
 */
export type Row = Record<string, unknown>;

/**
 * Insert operation result
 */
export interface InsertResult {
  rowsInserted: number;
  success: boolean;
}

/**
 * Select options for filtering and pagination
 */
export interface SelectOptions {
  columns?: string;
  where?: string | null;
  orderBy?: string | null;
  limit?: number | null;
}

/**
 * Select operation result
 */
export interface SelectResult {
  meta: ColumnMeta[];
  data: Row[];
  rows: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
}

/**
 * Durable Object State interface matching Cloudflare's API
 */
export interface DurableObjectState {
  storage: DurableObjectStorage;
  id: { toString: () => string };
  waitUntil?: (promise: Promise<unknown>) => void;
  blockConcurrencyWhile: <T>(callback: () => Promise<T>) => Promise<T>;
}

/**
 * Durable Object Storage interface matching Cloudflare's API
 */
export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  deleteAll(): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>>;
  transaction<T>(callback: (txn: DurableObjectStorage) => Promise<T>): Promise<T>;
}

/**
 * MergeTreeDO Interface
 */
export interface MergeTreeDOInterface {
  createTable(tableName: string, database: string, schema: MergeTreeTableSchema): Promise<void>;
  dropTable(tableName: string, database: string): Promise<void>;
  insert(tableName: string, database: string, columns: string[], values: unknown[][]): Promise<InsertResult>;
  select(tableName: string, database: string, options?: SelectOptions): Promise<SelectResult>;
  getTableSchema(tableName: string, database: string): Promise<MergeTreeTableSchema | null>;
  listTables(database?: string): Promise<string[]>;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build storage key for table schema
 */
function buildSchemaKey(database: string, tableName: string): string {
  return `${STORAGE_KEYS.SCHEMA_PREFIX}${database}.${tableName}`;
}

/**
 * Build storage key for data chunk
 */
function buildChunkKey(database: string, tableName: string, chunkIndex: number): string {
  return `${STORAGE_KEYS.DATA_PREFIX}${database}.${tableName}${STORAGE_KEYS.CHUNK_INFIX}${chunkIndex}`;
}

/**
 * Validate identifier (table/column names)
 */
function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Get ClickHouse type for a JavaScript value
 */
function inferClickHouseType(value: unknown): string {
  if (value === null) return 'Nullable(String)';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'Int64' : 'Float64';
  }
  if (typeof value === 'boolean') return 'Bool';
  if (typeof value === 'string') return 'String';
  if (Array.isArray(value)) return `Array(${inferClickHouseType(value[0])})`;
  return 'String';
}

/**
 * Evaluate a simple WHERE clause against a row
 * Supports: =, !=, <, >, <=, >=, LIKE, AND, OR
 */
function evaluateWhereClause(where: string, row: Row): boolean {
  if (!where || where.trim() === '') return true;

  // Handle AND
  if (/\bAND\b/i.test(where)) {
    const parts = where.split(/\bAND\b/i);
    return parts.every((part) => evaluateWhereClause(part.trim(), row));
  }

  // Handle OR
  if (/\bOR\b/i.test(where)) {
    const parts = where.split(/\bOR\b/i);
    return parts.some((part) => evaluateWhereClause(part.trim(), row));
  }

  // Parse comparison: column op value
  const compMatch = where.match(/^\s*(\w+)\s*(=|!=|<>|<=|>=|<|>|LIKE)\s*'?([^']*)'?\s*$/i);
  if (compMatch) {
    const [, column, op, valueStr] = compMatch;
    const rowValue = row[column];
    const compareValue = isNaN(Number(valueStr)) ? valueStr : Number(valueStr);

    switch (op.toUpperCase()) {
      case '=':
        return rowValue == compareValue;
      case '!=':
      case '<>':
        return rowValue != compareValue;
      case '<':
        return Number(rowValue) < Number(compareValue);
      case '>':
        return Number(rowValue) > Number(compareValue);
      case '<=':
        return Number(rowValue) <= Number(compareValue);
      case '>=':
        return Number(rowValue) >= Number(compareValue);
      case 'LIKE':
        const pattern = String(compareValue).replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(`^${pattern}$`, 'i').test(String(rowValue));
      default:
        return true;
    }
  }

  return true;
}

/**
 * Parse ORDER BY clause
 */
function parseOrderBy(orderBy: string): Array<{ column: string; direction: 'ASC' | 'DESC' }> {
  const parts = orderBy.split(',').map((p) => p.trim());
  return parts.map((part) => {
    const match = part.match(/^(\w+)(?:\s+(ASC|DESC))?$/i);
    if (match) {
      return {
        column: match[1],
        direction: (match[2]?.toUpperCase() as 'ASC' | 'DESC') || 'ASC',
      };
    }
    return { column: part, direction: 'ASC' as const };
  });
}

/**
 * Apply ORDER BY to data
 */
function applyOrderBy(data: Row[], orderBy: string): Row[] {
  const specs = parseOrderBy(orderBy);
  return [...data].sort((a, b) => {
    for (const spec of specs) {
      const aVal = a[spec.column];
      const bVal = b[spec.column];

      let cmp = 0;
      if (aVal === null || aVal === undefined) cmp = -1;
      else if (bVal === null || bVal === undefined) cmp = 1;
      else if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }

      if (cmp !== 0) {
        return spec.direction === 'DESC' ? -cmp : cmp;
      }
    }
    return 0;
  });
}

// =============================================================================
// Main Class: MergeTreeDO
// =============================================================================

/**
 * MergeTreeDO - MergeTree table engine backed by Durable Object storage
 *
 * This class provides a ClickHouse-compatible MergeTree table engine that
 * persists metadata to Cloudflare Durable Object storage. Data can be stored
 * in DO (for small tables) or R2 (for large tables).
 *
 * @example
 * ```typescript
 * // In a Durable Object class:
 * export class MergeTreeStorageDO {
 *   private mergeTreeEngine: MergeTreeDO;
 *
 *   constructor(state: DurableObjectState) {
 *     this.mergeTreeEngine = new MergeTreeDO(state);
 *   }
 *
 *   async fetch(request: Request): Promise<Response> {
 *     return this.mergeTreeEngine.handleRequest(request);
 *   }
 * }
 * ```
 */
export class MergeTreeDO implements MergeTreeDOInterface {
  private readonly state: DurableObjectState;

  /**
   * Create a new MergeTreeDO instance
   * @param state - The Durable Object state
   */
  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Handle incoming HTTP requests
   * Routes to appropriate handler based on URL path
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/create' && request.method === 'POST') {
        return this.handleCreate(request);
      }
      if (path === '/insert' && request.method === 'POST') {
        return this.handleInsert(request);
      }
      if (path === '/select' && request.method === 'POST') {
        return this.handleSelect(request);
      }
      if (path === '/drop' && request.method === 'POST') {
        return this.handleDrop(request);
      }
      if (path === '/schema' && request.method === 'GET') {
        return this.handleGetSchema(request);
      }
      if (path === '/tables' && request.method === 'GET') {
        return this.handleListTables(request);
      }

      return new Response(JSON.stringify({ error: 'Not found', path }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Handle CREATE TABLE request
   */
  private async handleCreate(request: Request): Promise<Response> {
    const body = await request.json() as {
      table: string;
      database: string;
      columns: Array<{ name: string; type: string }>;
      engine: string;
      orderBy?: string[];
    };

    const schema: MergeTreeTableSchema = {
      name: body.table,
      database: body.database,
      columns: body.columns,
      engine: body.engine,
      orderBy: body.orderBy,
    };

    await this.createTable(body.table, body.database, schema);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle INSERT request
   */
  private async handleInsert(request: Request): Promise<Response> {
    const body = await request.json() as {
      table: string;
      database: string;
      columns: string[];
      values: unknown[][];
    };

    const result = await this.insert(body.table, body.database, body.columns, body.values);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle SELECT request
   */
  private async handleSelect(request: Request): Promise<Response> {
    const body = await request.json() as {
      table: string;
      database: string;
      columns?: string;
      where?: string | null;
      orderBy?: string | null;
      limit?: number | null;
    };

    const result = await this.select(body.table, body.database, {
      columns: body.columns,
      where: body.where,
      orderBy: body.orderBy,
      limit: body.limit,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle DROP TABLE request
   */
  private async handleDrop(request: Request): Promise<Response> {
    const body = await request.json() as {
      table: string;
      database: string;
    };

    await this.dropTable(body.table, body.database);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle GET schema request
   */
  private async handleGetSchema(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const table = url.searchParams.get('table') || '';
    const database = url.searchParams.get('database') || 'default';

    const schema = await this.getTableSchema(table, database);

    if (!schema) {
      return new Response(JSON.stringify({ error: 'Table not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(schema), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Handle list tables request
   */
  private async handleListTables(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const database = url.searchParams.get('database') || undefined;

    const tables = await this.listTables(database);

    return new Response(JSON.stringify({ tables }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Create a new table with the given schema
   */
  async createTable(tableName: string, database: string, schema: MergeTreeTableSchema): Promise<void> {
    if (!isValidIdentifier(tableName)) {
      throw new Error(
        `Invalid table name: "${tableName}". Identifiers must start with a letter or underscore.`
      );
    }

    if (!schema.columns || schema.columns.length === 0) {
      throw new Error('Table must have at least one column');
    }

    for (const col of schema.columns) {
      if (!isValidIdentifier(col.name)) {
        throw new Error(`Invalid column name: "${col.name}".`);
      }
    }

    return this.state.blockConcurrencyWhile(async () => {
      const schemaKey = buildSchemaKey(database, tableName);
      const existingSchema = await this.state.storage.get<MergeTreeTableSchema>(schemaKey);

      if (existingSchema) {
        throw new Error(`Table "${database}.${tableName}" already exists`);
      }

      const schemaWithTimestamp: MergeTreeTableSchema = {
        ...schema,
        database,
        createdAt: new Date().toISOString(),
      };

      // Store schema and empty initial chunk
      const tables = (await this.state.storage.get<string[]>(STORAGE_KEYS.TABLES_LIST)) || [];
      const fullTableName = `${database}.${tableName}`;
      if (!tables.includes(fullTableName)) {
        tables.push(fullTableName);
      }

      await this.state.storage.put({
        [schemaKey]: schemaWithTimestamp,
        [buildChunkKey(database, tableName, 0)]: [],
        [STORAGE_KEYS.TABLES_LIST]: tables,
      });
    });
  }

  /**
   * Drop a table and all its data
   */
  async dropTable(tableName: string, database: string): Promise<void> {
    return this.state.blockConcurrencyWhile(async () => {
      const schemaKey = buildSchemaKey(database, tableName);
      const schema = await this.state.storage.get<MergeTreeTableSchema>(schemaKey);

      if (!schema) {
        throw new Error(`Table "${database}.${tableName}" does not exist`);
      }

      // Get all data chunk keys
      const chunkKeys = await this.state.storage.list({
        prefix: `${STORAGE_KEYS.DATA_PREFIX}${database}.${tableName}${STORAGE_KEYS.CHUNK_INFIX}`,
      });

      // Delete all chunks
      const keysToDelete = [...chunkKeys.keys()];
      if (keysToDelete.length > 0) {
        for (let i = 0; i < keysToDelete.length; i += BATCH_SIZE) {
          const batch = keysToDelete.slice(i, i + BATCH_SIZE);
          await this.state.storage.delete(batch);
        }
      }

      // Delete schema
      await this.state.storage.delete(schemaKey);

      // Remove from tables list
      const tables = (await this.state.storage.get<string[]>(STORAGE_KEYS.TABLES_LIST)) || [];
      const fullTableName = `${database}.${tableName}`;
      const index = tables.indexOf(fullTableName);
      if (index !== -1) {
        tables.splice(index, 1);
        await this.state.storage.put(STORAGE_KEYS.TABLES_LIST, tables);
      }
    });
  }

  /**
   * Insert rows into a table
   */
  async insert(
    tableName: string,
    database: string,
    columns: string[],
    values: unknown[][]
  ): Promise<InsertResult> {
    return this.state.blockConcurrencyWhile(async () => {
      const schemaKey = buildSchemaKey(database, tableName);
      const schema = await this.state.storage.get<MergeTreeTableSchema>(schemaKey);

      if (!schema) {
        throw new Error(`Table "${database}.${tableName}" does not exist`);
      }

      // Convert values to row objects
      const rows: Row[] = values.map((valueRow) => {
        const row: Row = {};
        columns.forEach((col, i) => {
          row[col] = valueRow[i];
        });
        return row;
      });

      // Find the last chunk
      const chunkKeys = await this.state.storage.list({
        prefix: `${STORAGE_KEYS.DATA_PREFIX}${database}.${tableName}${STORAGE_KEYS.CHUNK_INFIX}`,
      });

      const chunkIndices = [...chunkKeys.keys()]
        .map((k) => parseInt(k.split(STORAGE_KEYS.CHUNK_INFIX)[1], 10))
        .filter((n) => !isNaN(n));

      const lastChunkIndex = chunkIndices.length > 0 ? Math.max(...chunkIndices) : 0;
      const lastChunkKey = buildChunkKey(database, tableName, lastChunkIndex);
      const existingData = (await this.state.storage.get<Row[]>(lastChunkKey)) || [];

      // Check if we need a new chunk
      const combinedData = [...existingData, ...rows];
      const dataSize = JSON.stringify(combinedData).length * 2; // rough estimate

      if (dataSize > MAX_CHUNK_SIZE_BYTES && existingData.length > 0) {
        // Create new chunk for new data
        const newChunkKey = buildChunkKey(database, tableName, lastChunkIndex + 1);
        await this.state.storage.put(newChunkKey, rows);
      } else {
        // Append to existing chunk
        await this.state.storage.put(lastChunkKey, combinedData);
      }

      return {
        rowsInserted: rows.length,
        success: true,
      };
    });
  }

  /**
   * Select rows from a table
   */
  async select(tableName: string, database: string, options?: SelectOptions): Promise<SelectResult> {
    const startTime = Date.now();
    const schemaKey = buildSchemaKey(database, tableName);
    const schema = await this.state.storage.get<MergeTreeTableSchema>(schemaKey);

    if (!schema) {
      throw new Error(`Table "${database}.${tableName}" does not exist`);
    }

    // Read all chunks
    const chunkKeys = await this.state.storage.list({
      prefix: `${STORAGE_KEYS.DATA_PREFIX}${database}.${tableName}${STORAGE_KEYS.CHUNK_INFIX}`,
    });

    let allData: Row[] = [];
    for (const [, chunkData] of chunkKeys) {
      if (Array.isArray(chunkData)) {
        allData = allData.concat(chunkData as Row[]);
      }
    }

    const totalRowsRead = allData.length;

    // Apply WHERE clause
    if (options?.where) {
      allData = allData.filter((row) => evaluateWhereClause(options.where!, row));
    }

    // Apply ORDER BY
    if (options?.orderBy) {
      allData = applyOrderBy(allData, options.orderBy);
    }

    // Apply LIMIT
    if (options?.limit !== null && options?.limit !== undefined) {
      allData = allData.slice(0, options.limit);
    }

    // Filter columns
    let selectedColumns: string[];
    if (options?.columns && options.columns !== '*') {
      selectedColumns = options.columns.split(',').map((c) => c.trim());
      allData = allData.map((row) => {
        const filteredRow: Row = {};
        selectedColumns.forEach((col) => {
          filteredRow[col] = row[col];
        });
        return filteredRow;
      });
    } else {
      selectedColumns = schema.columns.map((c) => c.name);
    }

    // Build metadata
    const meta: ColumnMeta[] = selectedColumns.map((colName) => {
      const schemaCol = schema.columns.find((c) => c.name === colName);
      return {
        name: colName,
        type: schemaCol?.type || inferClickHouseType(allData[0]?.[colName]),
      };
    });

    const elapsed = (Date.now() - startTime) / 1000;

    return {
      meta,
      data: allData,
      rows: allData.length,
      statistics: {
        elapsed,
        rows_read: totalRowsRead,
        bytes_read: JSON.stringify(allData).length * 2,
      },
    };
  }

  /**
   * Get table schema
   */
  async getTableSchema(tableName: string, database: string): Promise<MergeTreeTableSchema | null> {
    const schemaKey = buildSchemaKey(database, tableName);
    const schema = await this.state.storage.get<MergeTreeTableSchema>(schemaKey);
    return schema || null;
  }

  /**
   * List all tables
   */
  async listTables(database?: string): Promise<string[]> {
    const tables = (await this.state.storage.get<string[]>(STORAGE_KEYS.TABLES_LIST)) || [];
    if (database) {
      return tables
        .filter((t) => t.startsWith(`${database}.`))
        .map((t) => t.replace(`${database}.`, ''));
    }
    return tables;
  }
}

// =============================================================================
// Exports
// =============================================================================

export { MergeTreeDO as default };

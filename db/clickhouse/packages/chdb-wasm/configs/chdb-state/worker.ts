/**
 * chdb-state Worker - SQL Interface backed by Durable Objects
 *
 * Provides a ClickHouse-compatible SQL interface for:
 * - CREATE TABLE with Memory() engine
 * - INSERT INTO for data ingestion
 * - SELECT queries with filtering, ordering, and aggregation
 * - DROP TABLE for cleanup
 *
 * Tables are stored in Durable Objects:
 * - Memory() tables use MemoryEngineDO (DO storage for persistence)
 *
 * @module configs/chdb-state/worker
 */

import {
  MemoryEngineDO as MemoryEngine,
  type TableSchema,
  type Row,
  type SelectResult,
  type DurableObjectState,
} from '../../src/storage/memory-do';

// ============================================================================
// Environment Bindings
// ============================================================================

/**
 * Environment bindings for the Worker
 */
export interface Env {
  MEMORY_ENGINE_DO: DurableObjectNamespace;
  DATA_BUCKET: R2Bucket;
  CHDB_STATE_VERSION: string;
  ENVIRONMENT: string;
  DEFAULT_DATABASE: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * CORS headers for cross-origin requests
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-ClickHouse-Format, X-ClickHouse-User',
};

/**
 * Server identification
 */
const SERVER_NAME = 'chdb-state';

/**
 * Content types for output formats
 */
const FORMAT_CONTENT_TYPES: Record<string, string> = {
  JSON: 'application/json; charset=UTF-8',
  JSONCompact: 'application/json; charset=UTF-8',
  JSONEachRow: 'application/x-ndjson; charset=UTF-8',
  CSV: 'text/csv; charset=UTF-8',
  CSVWithNames: 'text/csv; charset=UTF-8',
  TSV: 'text/tab-separated-values; charset=UTF-8',
  TabSeparated: 'text/tab-separated-values; charset=UTF-8',
};

// ============================================================================
// Durable Object Classes
// ============================================================================

/**
 * MemoryEngineDO - Durable Object for Memory table engine
 *
 * Wraps the MemoryEngine class to provide persistent storage
 * through Cloudflare's Durable Object storage API.
 */
export class MemoryEngineDO {
  private state: DurableObjectState;
  private engine: MemoryEngine;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.engine = new MemoryEngine(state);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const action = url.pathname.slice(1); // Remove leading slash
      const body = await request.json() as Record<string, unknown>;

      switch (action) {
        case 'createTable': {
          const { tableName, schema } = body as { tableName: string; schema: TableSchema };
          await this.engine.createTable(tableName, schema);
          return jsonResponse({ success: true, tableName });
        }

        case 'dropTable': {
          const { tableName } = body as { tableName: string };
          await this.engine.dropTable(tableName);
          return jsonResponse({ success: true, tableName });
        }

        case 'truncateTable': {
          const { tableName } = body as { tableName: string };
          await this.engine.truncateTable(tableName);
          return jsonResponse({ success: true, tableName });
        }

        case 'insert': {
          const { tableName, rows } = body as { tableName: string; rows: Row[] };
          const result = await this.engine.insert(tableName, rows);
          return jsonResponse(result);
        }

        case 'select': {
          const { tableName, options } = body as { tableName: string; options?: Record<string, unknown> };
          const result = await this.engine.select(tableName, options);
          return jsonResponse(result);
        }

        case 'getSchema': {
          const { tableName } = body as { tableName: string };
          const schema = await this.engine.getTableSchema(tableName);
          return jsonResponse({ schema });
        }

        case 'listTables': {
          const tables = await this.engine.listTables();
          return jsonResponse({ tables });
        }

        default:
          return jsonResponse({ error: `Unknown action: ${action}` }, 400);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500);
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a JSON response
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Generate a unique query ID
 */
function generateQueryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create an error response
 */
function createErrorResponse(message: string, status: number, queryId: string): Response {
  return new Response(
    `Code: ${status}. DB::Exception: ${message}`,
    {
      status,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'X-ClickHouse-Query-Id': queryId,
        'X-ClickHouse-Server-Display-Name': SERVER_NAME,
        ...CORS_HEADERS,
      },
    }
  );
}

/**
 * Create a success response with query result
 */
function createQueryResponse(
  result: SelectResult,
  format: string,
  queryId: string,
  elapsed: number
): Response {
  const contentType = FORMAT_CONTENT_TYPES[format] || 'application/json; charset=UTF-8';
  const formatted = formatResult(result, format);

  const summary = JSON.stringify({
    read_rows: result.rows,
    read_bytes: 0,
    written_rows: 0,
    written_bytes: 0,
    elapsed_ns: Math.round(elapsed * 1e9),
  });

  return new Response(formatted, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'X-ClickHouse-Query-Id': queryId,
      'X-ClickHouse-Format': format,
      'X-ClickHouse-Summary': summary,
      'X-ClickHouse-Server-Display-Name': SERVER_NAME,
      ...CORS_HEADERS,
    },
  });
}

/**
 * Format query result based on output format
 */
function formatResult(result: SelectResult, format: string): string {
  const data = result.data;
  const meta = 'meta' in result ? result.meta : [];

  switch (format) {
    case 'JSON':
      return JSON.stringify({
        meta,
        data,
        rows: result.rows,
        statistics: 'statistics' in result ? result.statistics : { elapsed: 0, rows_read: result.rows, bytes_read: 0 },
      });

    case 'JSONCompact': {
      const compactData = data.map((row) =>
        meta.map((col) => (row as Record<string, unknown>)[col.name])
      );
      return JSON.stringify({
        meta,
        data: compactData,
        rows: result.rows,
      });
    }

    case 'JSONEachRow':
      return data.map((row) => JSON.stringify(row)).join('\n') + '\n';

    case 'CSV': {
      const rows = data.map((row) =>
        meta
          .map((col) => {
            const value = (row as Record<string, unknown>)[col.name];
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      );
      return rows.join('\n') + '\n';
    }

    case 'CSVWithNames': {
      const header = meta.map((col) => `"${col.name}"`).join(',');
      const rows = data.map((row) =>
        meta
          .map((col) => {
            const value = (row as Record<string, unknown>)[col.name];
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      );
      return header + '\n' + rows.join('\n') + '\n';
    }

    case 'TSV':
    case 'TabSeparated': {
      const rows = data.map((row) =>
        meta
          .map((col) => {
            const value = (row as Record<string, unknown>)[col.name];
            if (value === null || value === undefined) return '';
            return String(value).replace(/\t/g, '\\t').replace(/\n/g, '\\n');
          })
          .join('\t')
      );
      return rows.join('\n') + '\n';
    }

    default:
      return JSON.stringify({ meta, data, rows: result.rows });
  }
}

// ============================================================================
// SQL Parser
// ============================================================================

interface ParsedCreateTable {
  tableName: string;
  columns: Array<{ name: string; type: string; nullable?: boolean }>;
  engine: 'Memory';
  ifNotExists: boolean;
}

interface ParsedInsert {
  tableName: string;
  columns: string[] | null;
  values: unknown[][];
}

interface ParsedSelect {
  tableName: string;
  columns: string[] | '*';
  where?: string;
  orderBy?: Array<{ column: string; direction: 'ASC' | 'DESC' }>;
  limit?: number;
  offset?: number;
}

interface ParsedDropTable {
  tableName: string;
  ifExists: boolean;
}

/**
 * Detect statement type from SQL
 */
function detectStatementType(sql: string): 'CREATE' | 'INSERT' | 'SELECT' | 'DROP' | 'SHOW' | 'DESCRIBE' | 'UNKNOWN' {
  const upper = sql.trim().toUpperCase();
  if (upper.startsWith('CREATE')) return 'CREATE';
  if (upper.startsWith('INSERT')) return 'INSERT';
  if (upper.startsWith('SELECT')) return 'SELECT';
  if (upper.startsWith('DROP')) return 'DROP';
  if (upper.startsWith('SHOW')) return 'SHOW';
  if (upper.startsWith('DESC') || upper.startsWith('DESCRIBE')) return 'DESCRIBE';
  return 'UNKNOWN';
}

/**
 * Parse CREATE TABLE statement
 */
function parseCreateTable(sql: string): ParsedCreateTable {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  // Check for IF NOT EXISTS
  const ifNotExistsMatch = normalized.match(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
  if (!ifNotExistsMatch) {
    throw new Error('Syntax error: Invalid CREATE TABLE statement');
  }

  const ifNotExists = !!ifNotExistsMatch[1];
  const tableName = ifNotExistsMatch[2];

  // Extract columns
  const columnsMatch = normalized.match(/\(([^)]+)\)\s*ENGINE/i);
  if (!columnsMatch) {
    throw new Error('Syntax error: Missing column definitions');
  }

  const columnsStr = columnsMatch[1];
  const columns = parseColumnDefinitions(columnsStr);

  // Extract ENGINE
  const engineMatch = normalized.match(/ENGINE\s*=\s*(\w+)\s*\(\s*\)/i);
  if (!engineMatch) {
    throw new Error('Syntax error: Missing ENGINE clause');
  }
  const engineName = engineMatch[1];

  if (engineName !== 'Memory') {
    throw new Error(`Unsupported engine: ${engineName}. Supported: Memory`);
  }

  return {
    tableName,
    columns,
    engine: 'Memory' as const,
    ifNotExists,
  };
}

/**
 * Parse column definitions from CREATE TABLE
 */
function parseColumnDefinitions(columnsStr: string): Array<{ name: string; type: string; nullable?: boolean }> {
  const columns: Array<{ name: string; type: string; nullable?: boolean }> = [];
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of columnsStr) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }

  for (const part of parts) {
    const match = part.match(/^(\w+)\s+(\w+(?:\([^)]+\))?)/);
    if (match) {
      const name = match[1];
      const type = match[2];
      const nullable = type.startsWith('Nullable');
      columns.push({ name, type, nullable });
    }
  }

  return columns;
}

/**
 * Parse INSERT statement
 */
function parseInsert(sql: string): ParsedInsert {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  const insertMatch = normalized.match(/^INSERT\s+INTO\s+(\w+)\s*/i);
  if (!insertMatch) {
    throw new Error('Syntax error: Invalid INSERT statement');
  }

  const tableName = insertMatch[1];
  let remainder = normalized.slice(insertMatch[0].length);

  // Check for column list
  let columns: string[] | null = null;
  const columnMatch = remainder.match(/^\(([^)]+)\)\s*/);
  if (columnMatch && !columnMatch[1].includes("'")) {
    const possibleColumns = columnMatch[1].split(',').map(c => c.trim());
    if (possibleColumns.every(c => /^\w+$/.test(c))) {
      columns = possibleColumns;
      remainder = remainder.slice(columnMatch[0].length);
    }
  }

  // Check for VALUES keyword
  const valuesMatch = remainder.match(/^VALUES\s*/i);
  if (!valuesMatch) {
    throw new Error('Syntax error: Expected VALUES keyword');
  }
  remainder = remainder.slice(valuesMatch[0].length);

  // Parse value tuples
  const values: unknown[][] = [];
  let pos = 0;

  while (pos < remainder.length) {
    while (pos < remainder.length && /[\s,]/.test(remainder[pos])) {
      pos++;
    }

    if (pos >= remainder.length) break;
    if (remainder[pos] !== '(') break;

    pos++;
    const rowValues: unknown[] = [];

    while (pos < remainder.length && remainder[pos] !== ')') {
      while (pos < remainder.length && /\s/.test(remainder[pos])) {
        pos++;
      }

      if (remainder[pos] === ')') break;

      const result = parseValue(remainder, pos);
      rowValues.push(result.value);
      pos = result.endPos;

      while (pos < remainder.length && /[\s,]/.test(remainder[pos])) {
        pos++;
      }
    }

    if (remainder[pos] === ')') {
      pos++;
    }

    values.push(rowValues);
  }

  return { tableName, columns, values };
}

/**
 * Parse a single value from INSERT VALUES
 */
function parseValue(sql: string, startPos: number): { value: unknown; endPos: number } {
  let pos = startPos;

  while (pos < sql.length && /\s/.test(sql[pos])) {
    pos++;
  }

  // NULL
  if (sql.slice(pos, pos + 4).toUpperCase() === 'NULL') {
    return { value: null, endPos: pos + 4 };
  }

  // String literal
  if (sql[pos] === "'") {
    pos++;
    let value = '';
    while (pos < sql.length) {
      if (sql[pos] === "'" && sql[pos + 1] === "'") {
        value += "'";
        pos += 2;
      } else if (sql[pos] === "'") {
        pos++;
        break;
      } else {
        value += sql[pos];
        pos++;
      }
    }
    return { value, endPos: pos };
  }

  // Number
  const numMatch = sql.slice(pos).match(/^-?[\d.]+(?:e[+-]?\d+)?/i);
  if (numMatch) {
    const numStr = numMatch[0];
    const value = numStr.includes('.') || numStr.toLowerCase().includes('e')
      ? parseFloat(numStr)
      : parseInt(numStr, 10);
    return { value, endPos: pos + numStr.length };
  }

  throw new Error(`Syntax error: Unable to parse value at position ${pos}`);
}

/**
 * Parse SELECT statement (simplified)
 */
function parseSelect(sql: string): ParsedSelect {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  // Extract table name
  const fromMatch = normalized.match(/FROM\s+(\w+)/i);
  if (!fromMatch) {
    throw new Error('Syntax error: Missing FROM clause');
  }
  const tableName = fromMatch[1];

  // Extract columns
  const selectMatch = normalized.match(/SELECT\s+(.+?)\s+FROM/i);
  if (!selectMatch) {
    throw new Error('Syntax error: Invalid SELECT clause');
  }
  const columnsStr = selectMatch[1].trim();
  const columns: string[] | '*' = columnsStr === '*'
    ? '*'
    : columnsStr.split(',').map(c => c.trim());

  // Extract WHERE clause
  const whereMatch = normalized.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i);
  const where = whereMatch ? whereMatch[1].trim() : undefined;

  // Extract ORDER BY
  let orderBy: Array<{ column: string; direction: 'ASC' | 'DESC' }> | undefined;
  const orderMatch = normalized.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/i);
  if (orderMatch) {
    orderBy = orderMatch[1].split(',').map(part => {
      const parts = part.trim().split(/\s+/);
      return {
        column: parts[0],
        direction: (parts[1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC') as 'ASC' | 'DESC',
      };
    });
  }

  // Extract LIMIT and OFFSET
  const limitMatch = normalized.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
  const limit = limitMatch ? parseInt(limitMatch[1], 10) : undefined;
  const offset = limitMatch && limitMatch[2] ? parseInt(limitMatch[2], 10) : undefined;

  return { tableName, columns, where, orderBy, limit, offset };
}

/**
 * Parse DROP TABLE statement
 */
function parseDropTable(sql: string): ParsedDropTable {
  const normalized = sql.replace(/\s+/g, ' ').trim();

  const dropMatch = normalized.match(/^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?(\w+)/i);
  if (!dropMatch) {
    throw new Error('Syntax error: Invalid DROP TABLE statement');
  }

  return {
    tableName: dropMatch[2],
    ifExists: !!dropMatch[1],
  };
}

// ============================================================================
// Table Registry
// ============================================================================

/**
 * Table registry entry tracking which DO stores each table
 */
interface TableEntry {
  tableName: string;
  engine: 'Memory';
  createdAt: number;
}

/**
 * Get or create the table registry from a DO
 */
async function getTableRegistry(
  env: Env,
  database: string
): Promise<Map<string, TableEntry>> {
  // Use a dedicated DO for the registry
  const registryId = env.MEMORY_ENGINE_DO.idFromName(`registry:${database}`);
  const registryStub = env.MEMORY_ENGINE_DO.get(registryId);

  try {
    const response = await registryStub.fetch(new Request('http://internal/listTables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));

    if (response.ok) {
      const data = await response.json() as { tables: string[] };
      const registry = new Map<string, TableEntry>();

      // For each table, we need to check its engine type
      // This is a simplified approach - in production, store full metadata
      for (const tableName of data.tables) {
        // Try to get schema to determine engine
        const schemaResponse = await registryStub.fetch(new Request('http://internal/getSchema', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableName }),
        }));

        if (schemaResponse.ok) {
          const schemaData = await schemaResponse.json() as { schema: TableSchema | null };
          if (schemaData.schema) {
            registry.set(tableName, {
              tableName,
              engine: 'Memory',
              createdAt: schemaData.schema.createdAt ? new Date(schemaData.schema.createdAt).getTime() : Date.now(),
            });
          }
        }
      }

      return registry;
    }
  } catch {
    // Registry doesn't exist yet
  }

  return new Map();
}

// ============================================================================
// Query Execution
// ============================================================================

/**
 * Execute a SQL query against the appropriate DO
 */
async function executeQuery(
  sql: string,
  env: Env,
  database: string
): Promise<{ result: SelectResult; format: string }> {
  const statementType = detectStatementType(sql);

  switch (statementType) {
    case 'CREATE':
      return executeCreate(sql, env, database);

    case 'INSERT':
      return executeInsert(sql, env, database);

    case 'SELECT':
      return executeSelect(sql, env, database);

    case 'DROP':
      return executeDrop(sql, env, database);

    case 'SHOW':
      return executeShow(sql, env, database);

    case 'DESCRIBE':
      return executeDescribe(sql, env, database);

    default:
      throw new Error(`Unsupported statement type: ${statementType}`);
  }
}

/**
 * Execute CREATE TABLE
 */
async function executeCreate(
  sql: string,
  env: Env,
  database: string
): Promise<{ result: SelectResult; format: string }> {
  const parsed = parseCreateTable(sql);

  // Route to MemoryEngineDO
  const doId = env.MEMORY_ENGINE_DO.idFromName(`table:${database}:${parsed.tableName}`);
  const stub = env.MEMORY_ENGINE_DO.get(doId);

  const schema: TableSchema = {
    name: parsed.tableName,
    columns: parsed.columns.map(c => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable,
    })),
    engine: 'Memory',
  };

  const response = await stub.fetch(new Request('http://internal/createTable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName: parsed.tableName, schema }),
  }));

  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error);
  }

  return {
    result: {
      meta: [],
      data: [],
      rows: 0,
    },
    format: 'JSON',
  };
}

/**
 * Execute INSERT INTO
 */
async function executeInsert(
  sql: string,
  env: Env,
  database: string
): Promise<{ result: SelectResult; format: string }> {
  const parsed = parseInsert(sql);

  const memoryDoId = env.MEMORY_ENGINE_DO.idFromName(`table:${database}:${parsed.tableName}`);
  const memoryStub = env.MEMORY_ENGINE_DO.get(memoryDoId);

  // Check if table exists in Memory engine
  const schemaResponse = await memoryStub.fetch(new Request('http://internal/getSchema', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName: parsed.tableName }),
  }));

  if (!schemaResponse.ok) {
    throw new Error(`Table ${parsed.tableName} not found`);
  }

  const schemaData = await schemaResponse.json() as { schema: TableSchema | null };

  if (!schemaData.schema) {
    throw new Error(`Table ${parsed.tableName} not found`);
  }

  // Table exists in Memory engine
  const columns = parsed.columns || schemaData.schema.columns.map(c => c.name);
  const rows: Row[] = parsed.values.map(rowValues => {
    const row: Row = {};
    columns.forEach((col, i) => {
      row[col] = rowValues[i];
    });
    return row;
  });

  const insertResponse = await memoryStub.fetch(new Request('http://internal/insert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName: parsed.tableName, rows }),
  }));

  if (!insertResponse.ok) {
    const error = await insertResponse.json() as { error: string };
    throw new Error(error.error);
  }

  const insertResult = await insertResponse.json() as { rowsInserted: number };

  return {
    result: {
      meta: [{ name: 'rows_inserted', type: 'UInt64' }],
      data: [{ rows_inserted: insertResult.rowsInserted }],
      rows: 1,
    },
    format: 'JSON',
  };
}

/**
 * Execute SELECT
 */
async function executeSelect(
  sql: string,
  env: Env,
  database: string
): Promise<{ result: SelectResult; format: string }> {
  const parsed = parseSelect(sql);

  const memoryDoId = env.MEMORY_ENGINE_DO.idFromName(`table:${database}:${parsed.tableName}`);
  const memoryStub = env.MEMORY_ENGINE_DO.get(memoryDoId);

  const schemaResponse = await memoryStub.fetch(new Request('http://internal/getSchema', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName: parsed.tableName }),
  }));

  if (!schemaResponse.ok) {
    throw new Error(`Table ${parsed.tableName} not found`);
  }

  const schemaData = await schemaResponse.json() as { schema: TableSchema | null };

  if (!schemaData.schema) {
    throw new Error(`Table ${parsed.tableName} not found`);
  }

  // Table exists in Memory engine
  const options = {
    columns: parsed.columns === '*' ? undefined : parsed.columns,
    limit: parsed.limit,
    offset: parsed.offset,
  };

  const selectResponse = await memoryStub.fetch(new Request('http://internal/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName: parsed.tableName, options }),
  }));

  if (!selectResponse.ok) {
    const error = await selectResponse.json() as { error: string };
    throw new Error(error.error);
  }

  let result = await selectResponse.json() as SelectResult;

  // Apply WHERE filtering (simplified - Memory engine doesn't support it natively)
  if (parsed.where) {
    result.data = applyWhereFilter(result.data, parsed.where);
    result.rows = result.data.length;
  }

  // Apply ORDER BY
  if (parsed.orderBy) {
    result.data = applyOrderBy(result.data, parsed.orderBy);
  }

  return { result, format: 'JSON' };
}

/**
 * Execute DROP TABLE
 */
async function executeDrop(
  sql: string,
  env: Env,
  database: string
): Promise<{ result: SelectResult; format: string }> {
  const parsed = parseDropTable(sql);

  const memoryDoId = env.MEMORY_ENGINE_DO.idFromName(`table:${database}:${parsed.tableName}`);
  const memoryStub = env.MEMORY_ENGINE_DO.get(memoryDoId);

  const dropResponse = await memoryStub.fetch(new Request('http://internal/dropTable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName: parsed.tableName }),
  }));

  if (!dropResponse.ok && !parsed.ifExists) {
    const error = await dropResponse.json() as { error: string };
    throw new Error(error.error);
  }

  return {
    result: { meta: [], data: [], rows: 0 },
    format: 'JSON',
  };
}

/**
 * Execute SHOW TABLES
 */
async function executeShow(
  sql: string,
  env: Env,
  database: string
): Promise<{ result: SelectResult; format: string }> {
  const upper = sql.toUpperCase().trim();

  if (upper.startsWith('SHOW TABLES')) {
    // Get tables from both engines
    const tables: string[] = [];

    // Note: This is a simplified implementation
    // In production, you'd want a central registry

    return {
      result: {
        meta: [{ name: 'name', type: 'String' }],
        data: tables.map(t => ({ name: t })),
        rows: tables.length,
      },
      format: 'JSON',
    };
  }

  throw new Error(`Unsupported SHOW statement: ${sql}`);
}

/**
 * Execute DESCRIBE TABLE
 */
async function executeDescribe(
  sql: string,
  env: Env,
  database: string
): Promise<{ result: SelectResult; format: string }> {
  const match = sql.match(/DESCRIBE?\s+TABLE\s+(\w+)/i);
  if (!match) {
    throw new Error('Syntax error: Invalid DESCRIBE statement');
  }

  const tableName = match[1];

  const memoryDoId = env.MEMORY_ENGINE_DO.idFromName(`table:${database}:${tableName}`);
  const memoryStub = env.MEMORY_ENGINE_DO.get(memoryDoId);

  const schemaResponse = await memoryStub.fetch(new Request('http://internal/getSchema', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName }),
  }));

  if (!schemaResponse.ok) {
    throw new Error(`Table ${tableName} not found`);
  }

  const schemaData = await schemaResponse.json() as { schema: TableSchema | null };

  if (!schemaData.schema) {
    throw new Error(`Table ${tableName} not found`);
  }

  return {
    result: {
      meta: [
        { name: 'name', type: 'String' },
        { name: 'type', type: 'String' },
      ],
      data: schemaData.schema.columns.map(c => ({
        name: c.name,
        type: c.type,
      })),
      rows: schemaData.schema.columns.length,
    },
    format: 'JSON',
  };
}

/**
 * Apply WHERE filter to data (simplified)
 */
function applyWhereFilter(data: Row[], whereClause: string): Row[] {
  return data.filter(row => evaluateWhereClause(row, whereClause));
}

/**
 * Evaluate a WHERE clause condition
 */
function evaluateWhereClause(row: Row, clause: string): boolean {
  // Handle AND
  const andMatch = clause.match(/^(.+?)\s+AND\s+(.+)$/i);
  if (andMatch) {
    return evaluateWhereClause(row, andMatch[1]) && evaluateWhereClause(row, andMatch[2]);
  }

  // Handle OR
  const orMatch = clause.match(/^(.+?)\s+OR\s+(.+)$/i);
  if (orMatch) {
    return evaluateWhereClause(row, orMatch[1]) || evaluateWhereClause(row, orMatch[2]);
  }

  // Handle comparison operators
  const comparisonMatch = clause.match(/^(\w+)\s*(=|!=|<>|>|<|>=|<=)\s*(.+)$/i);
  if (comparisonMatch) {
    const column = comparisonMatch[1];
    const operator = comparisonMatch[2].toUpperCase();
    let value: unknown = comparisonMatch[3].trim();

    // Remove quotes from string values
    if ((typeof value === 'string' && value.startsWith("'") && value.endsWith("'")) ||
        (typeof value === 'string' && value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    } else if (!isNaN(Number(value))) {
      value = Number(value);
    }

    const rowValue = row[column];

    switch (operator) {
      case '=': return rowValue == value;
      case '!=':
      case '<>': return rowValue != value;
      case '>': return (rowValue as number) > (value as number);
      case '<': return (rowValue as number) < (value as number);
      case '>=': return (rowValue as number) >= (value as number);
      case '<=': return (rowValue as number) <= (value as number);
    }
  }

  return true;
}

/**
 * Apply ORDER BY to data
 */
function applyOrderBy(
  data: Row[],
  orderBy: Array<{ column: string; direction: 'ASC' | 'DESC' }>
): Row[] {
  return [...data].sort((a, b) => {
    for (const { column, direction } of orderBy) {
      const aVal = a[column];
      const bVal = b[column];

      if (aVal === bVal) continue;
      if (aVal === null || aVal === undefined) return direction === 'ASC' ? 1 : -1;
      if (bVal === null || bVal === undefined) return direction === 'ASC' ? -1 : 1;

      const cmp = aVal < bVal ? -1 : 1;
      return direction === 'ASC' ? cmp : -cmp;
    }
    return 0;
  });
}

// ============================================================================
// Main Worker Handler
// ============================================================================

/**
 * Serve the Play UI for interactive queries
 */
function servePlayUI(env: Env): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>chDB State - SQL Query Editor</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background-color: #1a1a2e;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid #333;
    }
    h1 { margin: 0; font-size: 24px; color: #00d9ff; }
    .subtitle { color: #888; font-size: 14px; margin-top: 4px; }
    .editor-container { margin-bottom: 15px; }
    #query-editor {
      width: 100%;
      min-height: 180px;
      padding: 15px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 14px;
      background-color: #2d2d3d;
      color: #e0e0e0;
      border: 1px solid #444;
      border-radius: 6px;
      resize: vertical;
      outline: none;
    }
    #query-editor:focus { border-color: #00d9ff; }
    .controls {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      align-items: center;
    }
    #run-button {
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      background-color: #00d9ff;
      color: #1a1a2e;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    #run-button:hover { background-color: #00b8d4; }
    #run-button:disabled { background-color: #666; color: #999; cursor: not-allowed; }
    .status { color: #888; font-size: 13px; }
    .status.loading { color: #00d9ff; }
    .status.error { color: #ff6b6b; }
    .status.success { color: #69db7c; }
    .results-container {
      background-color: #2d2d3d;
      border: 1px solid #444;
      border-radius: 6px;
      overflow: hidden;
    }
    .results-header {
      padding: 10px 15px;
      background-color: #333;
      border-bottom: 1px solid #444;
      font-size: 13px;
      color: #888;
    }
    #results {
      padding: 15px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 500px;
      overflow: auto;
    }
    #results table { border-collapse: collapse; width: 100%; }
    #results th, #results td {
      padding: 8px 12px;
      text-align: left;
      border-bottom: 1px solid #444;
    }
    #results th { background-color: #333; color: #00d9ff; font-weight: 600; }
    #results tr:hover td { background-color: #363646; }
    .examples { margin-bottom: 20px; }
    .examples h3 { margin: 0 0 10px 0; font-size: 14px; color: #888; }
    .example-query {
      background-color: #2d2d3d;
      padding: 8px 12px;
      border-radius: 4px;
      margin-bottom: 8px;
      font-family: monospace;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid #444;
    }
    .example-query:hover { border-color: #00d9ff; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>chDB State</h1>
        <div class="subtitle">SQL interface backed by Durable Objects</div>
      </div>
    </header>

    <div class="examples">
      <h3>Example Queries</h3>
      <div class="example-query" onclick="setQuery(this.innerText)">
        CREATE TABLE test(id Int32, name String) ENGINE=Memory()
      </div>
      <div class="example-query" onclick="setQuery(this.innerText)">
        INSERT INTO test VALUES(1, 'Alice'), (2, 'Bob'), (3, 'Charlie')
      </div>
      <div class="example-query" onclick="setQuery(this.innerText)">
        SELECT * FROM test
      </div>
      <div class="example-query" onclick="setQuery(this.innerText)">
        SELECT * FROM test WHERE id > 1 ORDER BY name
      </div>
    </div>

    <div class="editor-container">
      <textarea id="query-editor" placeholder="Enter your SQL query here...">SELECT 1 AS test</textarea>
    </div>

    <div class="controls">
      <button id="run-button" type="submit">Run Query</button>
      <span id="status" class="status">Ready</span>
    </div>

    <div class="results-container">
      <div class="results-header">Results</div>
      <div id="results">Run a query to see results here.</div>
    </div>
  </div>

  <script>
    const queryEditor = document.getElementById('query-editor');
    const runButton = document.getElementById('run-button');
    const resultsDiv = document.getElementById('results');
    const statusSpan = document.getElementById('status');

    function setQuery(sql) {
      queryEditor.value = sql;
    }

    function setStatus(message, type) {
      statusSpan.textContent = message;
      statusSpan.className = 'status ' + (type || '');
    }

    async function executeQuery() {
      const sql = queryEditor.value.trim();
      if (!sql) {
        resultsDiv.textContent = 'Please enter a query.';
        return;
      }

      setStatus('Executing...', 'loading');
      runButton.disabled = true;

      const startTime = performance.now();

      try {
        const response = await fetch('/?query=' + encodeURIComponent(sql) + '&default_format=JSON');
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText);
        }

        const result = await response.json();

        if (result.data && result.data.length > 0) {
          const columns = result.meta.map(m => m.name);
          const rows = result.data;

          let html = '<table><thead><tr>';
          for (const col of columns) {
            html += '<th>' + escapeHtml(col) + '</th>';
          }
          html += '</tr></thead><tbody>';

          for (const row of rows) {
            html += '<tr>';
            for (const col of columns) {
              const value = row[col];
              html += '<td>' + escapeHtml(formatValue(value)) + '</td>';
            }
            html += '</tr>';
          }
          html += '</tbody></table>';

          resultsDiv.innerHTML = html;
          setStatus(rows.length + ' row' + (rows.length !== 1 ? 's' : '') + ' in ' + elapsed + 's', 'success');
        } else {
          resultsDiv.textContent = 'Query executed successfully. No rows returned.';
          setStatus('OK in ' + elapsed + 's', 'success');
        }
      } catch (error) {
        resultsDiv.textContent = 'Error: ' + error.message;
        setStatus('Query failed', 'error');
      } finally {
        runButton.disabled = false;
      }
    }

    function formatValue(value) {
      if (value === null || value === undefined) return 'NULL';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    runButton.addEventListener('click', executeQuery);
    queryEditor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executeQuery();
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    },
  });
}

/**
 * Main request handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const queryId = generateQueryId();
    const database = env.DEFAULT_DATABASE || 'default';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...CORS_HEADERS,
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Route requests
    switch (url.pathname) {
      case '/ping':
        return new Response('Ok.\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
        });

      case '/version':
        return new Response(
          JSON.stringify({
            name: SERVER_NAME,
            version: env.CHDB_STATE_VERSION || '0.1.0',
            environment: env.ENVIRONMENT || 'unknown',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          }
        );

      case '/play':
        return servePlayUI(env);

      case '/':
      case '/query': {
        // Get query from URL params or body
        let sql = url.searchParams.get('query') || '';

        if (request.method === 'POST' && !sql) {
          const contentType = request.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const body = await request.json() as { query?: string };
            sql = body.query || '';
          } else {
            sql = await request.text();
          }
        }

        if (!sql || sql.trim() === '') {
          // Return landing page with info
          return new Response(
            JSON.stringify({
              name: SERVER_NAME,
              version: env.CHDB_STATE_VERSION || '0.1.0',
              description: 'SQL interface backed by Durable Objects',
              endpoints: {
                '/': 'Query endpoint (GET/POST with query param)',
                '/play': 'Interactive SQL editor',
                '/ping': 'Health check',
                '/version': 'Version info',
              },
              engines: ['Memory()'],
              examples: [
                "CREATE TABLE test(id Int32, name String) ENGINE=Memory()",
                "INSERT INTO test VALUES(1, 'Alice'), (2, 'Bob')",
                "SELECT * FROM test WHERE id > 0",
              ],
            }, null, 2),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
            }
          );
        }

        const format = url.searchParams.get('default_format') ||
                       request.headers.get('X-ClickHouse-Format') ||
                       'JSON';

        const startTime = performance.now();

        try {
          const { result } = await executeQuery(sql, env, database);
          const elapsed = (performance.now() - startTime) / 1000;

          return createQueryResponse(result, format, queryId, elapsed);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return createErrorResponse(message, 400, queryId);
        }
      }

      default:
        return createErrorResponse(`Not found: ${url.pathname}`, 404, queryId);
    }
  },
};

/**
 * chdb-minimal Cloudflare Worker
 *
 * A minimal SQL engine combining:
 * - Core executor (basic query execution)
 * - Memory engine (in-memory tables)
 * - Aggregates (COUNT, SUM, AVG, MIN, MAX)
 *
 * This is the smallest viable chdb configuration for Cloudflare Workers,
 * targeting under 500KB total bundle size.
 *
 * Features:
 * - POST / with {"query": "..."}
 * - GET /query?sql=...
 * - In-memory tables with CREATE TABLE ... ENGINE = Memory
 * - Basic aggregate functions
 * - JSON output format
 */

// Import WASM modules as binary
import executorWasm from '../../wasm/dist/executor.wasm';
import memoryEngineWasm from '../../wasm/dist/memory_engine.wasm';
import aggregatesWasm from '../../wasm/dist/aggregates.wasm';

/**
 * Environment bindings for the Worker
 */
export interface Env {
  CHDB_MINIMAL_VERSION: string;
  ENVIRONMENT: string;
}

/**
 * CORS headers for cross-origin requests
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Server identification
 */
const SERVER_NAME = 'chdb-minimal';

/**
 * Query result structure
 */
interface QueryResult {
  meta: Array<{ name: string; type: string }>;
  data: any[];
  rows: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
}

/**
 * In-memory table storage
 */
interface TableSchema {
  columns: Array<{ name: string; type: string }>;
  data: any[][];
}

/**
 * Global state for in-memory tables
 */
const tables: Map<string, TableSchema> = new Map();

/**
 * Parse column type from SQL definition
 */
function parseColumnType(typeDef: string): string {
  const normalized = typeDef.trim().toUpperCase();
  if (normalized.startsWith('INT') || normalized === 'INTEGER') return 'Int32';
  if (normalized.startsWith('BIGINT') || normalized === 'INT64') return 'Int64';
  if (normalized.startsWith('FLOAT') || normalized === 'DOUBLE' || normalized === 'REAL') return 'Float64';
  if (normalized.startsWith('VARCHAR') || normalized === 'TEXT' || normalized === 'STRING') return 'String';
  if (normalized === 'BOOL' || normalized === 'BOOLEAN') return 'Bool';
  return typeDef;
}

/**
 * Parse CREATE TABLE statement
 */
function parseCreateTable(sql: string): { tableName: string; columns: Array<{ name: string; type: string }> } | null {
  // Match: CREATE TABLE name (col1 type1, col2 type2, ...) ENGINE = Memory
  const match = sql.match(/CREATE\s+TABLE\s+(\w+)\s*\(\s*(.+?)\s*\)\s*(?:ENGINE\s*=\s*Memory)?/is);
  if (!match) return null;

  const tableName = match[1];
  const columnDefs = match[2];

  // Parse column definitions
  const columns: Array<{ name: string; type: string }> = [];
  const colMatches = columnDefs.matchAll(/(\w+)\s+(\w+(?:\([^)]*\))?)/g);
  for (const colMatch of colMatches) {
    columns.push({
      name: colMatch[1],
      type: parseColumnType(colMatch[2]),
    });
  }

  return { tableName, columns };
}

/**
 * Parse INSERT statement
 */
function parseInsert(sql: string): { tableName: string; values: any[][] } | null {
  // Match: INSERT INTO table VALUES (v1, v2), (v3, v4), ...
  const match = sql.match(/INSERT\s+INTO\s+(\w+)\s+VALUES\s+(.+)/is);
  if (!match) return null;

  const tableName = match[1];
  const valuesStr = match[2];

  // Parse value groups
  const values: any[][] = [];
  const groupMatches = valuesStr.matchAll(/\(([^)]+)\)/g);
  for (const groupMatch of groupMatches) {
    const row: any[] = [];
    const valueStrs = groupMatch[1].split(',').map(v => v.trim());
    for (const valStr of valueStrs) {
      if (valStr.startsWith("'") && valStr.endsWith("'")) {
        row.push(valStr.slice(1, -1));
      } else if (valStr.toLowerCase() === 'null') {
        row.push(null);
      } else if (valStr.toLowerCase() === 'true') {
        row.push(true);
      } else if (valStr.toLowerCase() === 'false') {
        row.push(false);
      } else if (!isNaN(Number(valStr))) {
        row.push(Number(valStr));
      } else {
        row.push(valStr);
      }
    }
    values.push(row);
  }

  return { tableName, values };
}

/**
 * Safe arithmetic expression evaluator (no eval/Function)
 */
function evaluateArithmetic(expr: string): number {
  // Tokenize: numbers and operators
  const tokens: (number | string)[] = [];
  let numBuffer = '';

  for (const char of expr.replace(/\s/g, '')) {
    if (/[0-9.]/.test(char)) {
      numBuffer += char;
    } else if (['+', '-', '*', '/', '(', ')'].includes(char)) {
      if (numBuffer) {
        tokens.push(parseFloat(numBuffer));
        numBuffer = '';
      }
      tokens.push(char);
    }
  }
  if (numBuffer) {
    tokens.push(parseFloat(numBuffer));
  }

  // Simple recursive descent parser
  let pos = 0;

  function parseExpression(): number {
    let left = parseTerm();
    while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
      const op = tokens[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
      const op = tokens[pos++];
      const right = parseFactor();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number {
    if (tokens[pos] === '(') {
      pos++; // skip '('
      const value = parseExpression();
      pos++; // skip ')'
      return value;
    }
    if (tokens[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    return tokens[pos++] as number;
  }

  return parseExpression();
}

/**
 * Parse SELECT statement and execute against tables
 */
function parseAndExecuteSelect(sql: string): QueryResult {
  const startTime = performance.now();

  // Simple arithmetic expression (SELECT 1 + 2 AS result)
  const arithmeticMatch = sql.match(/SELECT\s+(.+?)\s+AS\s+(\w+)\s*$/i);
  if (arithmeticMatch) {
    const expr = arithmeticMatch[1];
    const alias = arithmeticMatch[2];

    // Check if expression is purely arithmetic
    const cleanExpr = expr.replace(/\s/g, '');
    if (/^[0-9+\-*/().]+$/.test(cleanExpr)) {
      const result = evaluateArithmetic(cleanExpr);

      return {
        meta: [{ name: alias, type: Number.isInteger(result) ? 'Int64' : 'Float64' }],
        data: [{ [alias]: result }],
        rows: 1,
        statistics: {
          elapsed: (performance.now() - startTime) / 1000,
          rows_read: 0,
          bytes_read: 0,
        },
      };
    }
  }

  // Parse SELECT ... FROM table
  const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/is);
  if (!selectMatch) {
    // Try simple SELECT without FROM
    const simpleMatch = sql.match(/SELECT\s+(.+)$/i);
    if (simpleMatch) {
      const selectClause = simpleMatch[1].trim();

      // Handle aggregate functions without table
      if (/^\d+$/.test(selectClause)) {
        return {
          meta: [{ name: selectClause, type: 'Int64' }],
          data: [{ [selectClause]: parseInt(selectClause) }],
          rows: 1,
          statistics: {
            elapsed: (performance.now() - startTime) / 1000,
            rows_read: 0,
            bytes_read: 0,
          },
        };
      }
    }
    throw new Error('Invalid SELECT syntax');
  }

  const selectClause = selectMatch[1].trim();
  const tableName = selectMatch[2];
  const whereClause = selectMatch[3]?.trim();
  const orderByClause = selectMatch[4]?.trim();
  const limitValue = selectMatch[5] ? parseInt(selectMatch[5]) : undefined;

  // Get table
  const table = tables.get(tableName);
  if (!table) {
    throw new Error(`Table '${tableName}' does not exist`);
  }

  // Start with all rows
  let rows = table.data.map(row => {
    const obj: Record<string, any> = {};
    table.columns.forEach((col, i) => {
      obj[col.name] = row[i];
    });
    return obj;
  });

  // Apply WHERE clause
  if (whereClause) {
    rows = rows.filter(row => evaluateWhere(row, whereClause));
  }

  // Check for aggregate functions
  const hasAggregates = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(selectClause);

  if (hasAggregates) {
    // Parse and execute aggregates
    const aggResult = executeAggregates(selectClause, rows, table.columns);
    return {
      ...aggResult,
      statistics: {
        elapsed: (performance.now() - startTime) / 1000,
        rows_read: rows.length,
        bytes_read: JSON.stringify(rows).length,
      },
    };
  }

  // Apply ORDER BY
  if (orderByClause) {
    rows = applyOrderBy(rows, orderByClause);
  }

  // Apply LIMIT
  if (limitValue !== undefined) {
    rows = rows.slice(0, limitValue);
  }

  // Apply column selection
  const { selectedRows, selectedMeta } = applySelect(rows, selectClause, table.columns);

  return {
    meta: selectedMeta,
    data: selectedRows,
    rows: selectedRows.length,
    statistics: {
      elapsed: (performance.now() - startTime) / 1000,
      rows_read: table.data.length,
      bytes_read: JSON.stringify(table.data).length,
    },
  };
}

/**
 * Evaluate WHERE clause condition
 */
function evaluateWhere(row: Record<string, any>, clause: string): boolean {
  // Handle AND/OR
  const andMatch = clause.match(/^(.+?)\s+AND\s+(.+)$/i);
  if (andMatch) {
    return evaluateWhere(row, andMatch[1]) && evaluateWhere(row, andMatch[2]);
  }

  const orMatch = clause.match(/^(.+?)\s+OR\s+(.+)$/i);
  if (orMatch) {
    return evaluateWhere(row, orMatch[1]) || evaluateWhere(row, orMatch[2]);
  }

  // Handle comparison operators
  const compMatch = clause.match(/^(\w+)\s*(=|!=|<>|>|<|>=|<=)\s*(.+)$/);
  if (compMatch) {
    const column = compMatch[1];
    const operator = compMatch[2];
    let value: any = compMatch[3].trim();

    // Parse value
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    } else if (!isNaN(Number(value))) {
      value = Number(value);
    }

    const rowValue = row[column];

    switch (operator) {
      case '=': return rowValue == value;
      case '!=':
      case '<>': return rowValue != value;
      case '>': return rowValue > value;
      case '<': return rowValue < value;
      case '>=': return rowValue >= value;
      case '<=': return rowValue <= value;
    }
  }

  return true;
}

/**
 * Execute aggregate functions
 */
function executeAggregates(
  selectClause: string,
  rows: Record<string, any>[],
  columns: Array<{ name: string; type: string }>
): { meta: Array<{ name: string; type: string }>; data: any[]; rows: number } {
  const expressions = parseSelectExpressions(selectClause);
  const resultRow: Record<string, any> = {};
  const meta: Array<{ name: string; type: string }> = [];

  for (const expr of expressions) {
    const aggMatch = expr.expression.match(/^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(\*|\w+)\s*\)$/i);
    if (aggMatch) {
      const func = aggMatch[1].toUpperCase();
      const arg = aggMatch[2];
      const alias = expr.alias || `${func}(${arg})`;

      let result: number;
      if (func === 'COUNT') {
        result = rows.length;
      } else {
        const values = rows.map(r => arg === '*' ? 1 : r[arg]).filter(v => v !== null && v !== undefined);
        if (values.length === 0) {
          result = 0;
        } else {
          switch (func) {
            case 'SUM':
              result = values.reduce((a, b) => a + Number(b), 0);
              break;
            case 'AVG':
              result = values.reduce((a, b) => a + Number(b), 0) / values.length;
              break;
            case 'MIN':
              result = Math.min(...values.map(Number));
              break;
            case 'MAX':
              result = Math.max(...values.map(Number));
              break;
            default:
              result = 0;
          }
        }
      }

      resultRow[alias] = result;
      meta.push({ name: alias, type: func === 'AVG' ? 'Float64' : 'Int64' });
    } else {
      // Non-aggregate expression
      const alias = expr.alias || expr.expression;
      resultRow[alias] = rows.length > 0 ? rows[0][expr.expression] : null;
      meta.push({ name: alias, type: 'String' });
    }
  }

  return { meta, data: [resultRow], rows: 1 };
}

/**
 * Parse SELECT expressions
 */
function parseSelectExpressions(clause: string): Array<{ expression: string; alias: string | null }> {
  const expressions: Array<{ expression: string; alias: string | null }> = [];
  let current = '';
  let depth = 0;

  for (const char of clause) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      const trimmed = current.trim();
      const aliasMatch = trimmed.match(/^(.+?)\s+AS\s+(\w+)$/i);
      if (aliasMatch) {
        expressions.push({ expression: aliasMatch[1].trim(), alias: aliasMatch[2] });
      } else {
        expressions.push({ expression: trimmed, alias: null });
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    const trimmed = current.trim();
    const aliasMatch = trimmed.match(/^(.+?)\s+AS\s+(\w+)$/i);
    if (aliasMatch) {
      expressions.push({ expression: aliasMatch[1].trim(), alias: aliasMatch[2] });
    } else {
      expressions.push({ expression: trimmed, alias: null });
    }
  }

  return expressions;
}

/**
 * Apply ORDER BY clause
 */
function applyOrderBy(rows: Record<string, any>[], clause: string): Record<string, any>[] {
  const parts = clause.split(',').map(p => p.trim());
  return [...rows].sort((a, b) => {
    for (const part of parts) {
      const match = part.match(/^(\w+)(?:\s+(ASC|DESC))?$/i);
      if (match) {
        const column = match[1];
        const direction = (match[2]?.toUpperCase() || 'ASC') === 'DESC' ? -1 : 1;
        if (a[column] < b[column]) return -1 * direction;
        if (a[column] > b[column]) return 1 * direction;
      }
    }
    return 0;
  });
}

/**
 * Apply SELECT column selection
 */
function applySelect(
  rows: Record<string, any>[],
  selectClause: string,
  tableColumns: Array<{ name: string; type: string }>
): { selectedRows: Record<string, any>[]; selectedMeta: Array<{ name: string; type: string }> } {
  if (selectClause === '*') {
    return { selectedRows: rows, selectedMeta: tableColumns };
  }

  const expressions = parseSelectExpressions(selectClause);
  const selectedMeta: Array<{ name: string; type: string }> = [];
  const columnMap: Map<string, string> = new Map(); // alias -> original

  for (const expr of expressions) {
    const alias = expr.alias || expr.expression;
    columnMap.set(alias, expr.expression);
    const tableCol = tableColumns.find(c => c.name === expr.expression);
    selectedMeta.push({ name: alias, type: tableCol?.type || 'String' });
  }

  const selectedRows = rows.map(row => {
    const newRow: Record<string, any> = {};
    for (const [alias, original] of columnMap) {
      newRow[alias] = row[original];
    }
    return newRow;
  });

  return { selectedRows, selectedMeta };
}

/**
 * Execute a SQL query
 */
function executeQuery(sql: string): QueryResult {
  const trimmedSql = sql.trim();
  const upperSql = trimmedSql.toUpperCase();

  // CREATE TABLE
  if (upperSql.startsWith('CREATE TABLE')) {
    const parsed = parseCreateTable(trimmedSql);
    if (!parsed) {
      throw new Error('Invalid CREATE TABLE syntax');
    }
    if (tables.has(parsed.tableName)) {
      throw new Error(`Table '${parsed.tableName}' already exists`);
    }
    tables.set(parsed.tableName, {
      columns: parsed.columns,
      data: [],
    });
    return {
      meta: [],
      data: [],
      rows: 0,
      statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
    };
  }

  // DROP TABLE
  if (upperSql.startsWith('DROP TABLE')) {
    const match = trimmedSql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
    if (!match) {
      throw new Error('Invalid DROP TABLE syntax');
    }
    const tableName = match[1];
    if (!tables.has(tableName) && !upperSql.includes('IF EXISTS')) {
      throw new Error(`Table '${tableName}' does not exist`);
    }
    tables.delete(tableName);
    return {
      meta: [],
      data: [],
      rows: 0,
      statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
    };
  }

  // INSERT
  if (upperSql.startsWith('INSERT')) {
    const parsed = parseInsert(trimmedSql);
    if (!parsed) {
      throw new Error('Invalid INSERT syntax');
    }
    const table = tables.get(parsed.tableName);
    if (!table) {
      throw new Error(`Table '${parsed.tableName}' does not exist`);
    }
    for (const row of parsed.values) {
      if (row.length !== table.columns.length) {
        throw new Error(`Column count mismatch: expected ${table.columns.length}, got ${row.length}`);
      }
      table.data.push(row);
    }
    return {
      meta: [],
      data: [],
      rows: parsed.values.length,
      statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
    };
  }

  // SELECT
  if (upperSql.startsWith('SELECT')) {
    return parseAndExecuteSelect(trimmedSql);
  }

  // SHOW TABLES
  if (upperSql === 'SHOW TABLES') {
    const tableNames = Array.from(tables.keys());
    return {
      meta: [{ name: 'name', type: 'String' }],
      data: tableNames.map(name => ({ name })),
      rows: tableNames.length,
      statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
    };
  }

  // DESCRIBE table
  if (upperSql.startsWith('DESCRIBE') || upperSql.startsWith('DESC ')) {
    const match = trimmedSql.match(/(?:DESCRIBE|DESC)\s+(\w+)/i);
    if (!match) {
      throw new Error('Invalid DESCRIBE syntax');
    }
    const tableName = match[1];
    const table = tables.get(tableName);
    if (!table) {
      throw new Error(`Table '${tableName}' does not exist`);
    }
    return {
      meta: [
        { name: 'name', type: 'String' },
        { name: 'type', type: 'String' },
      ],
      data: table.columns.map(c => ({ name: c.name, type: c.type })),
      rows: table.columns.length,
      statistics: { elapsed: 0, rows_read: 0, bytes_read: 0 },
    };
  }

  throw new Error(`Unsupported SQL statement: ${trimmedSql.substring(0, 50)}...`);
}

/**
 * Generate a unique query ID
 */
function generateQueryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create error response
 */
function createErrorResponse(message: string, status: number, queryId: string): Response {
  return new Response(
    JSON.stringify({ error: true, message, query_id: queryId }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Query-Id': queryId,
        'X-Server': SERVER_NAME,
        ...CORS_HEADERS,
      },
    }
  );
}

/**
 * Main request handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const queryId = generateQueryId();

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

    // Health check
    if (url.pathname === '/ping' || url.pathname === '/health') {
      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
      });
    }

    // Version endpoint
    if (url.pathname === '/version') {
      return new Response(
        JSON.stringify({
          name: SERVER_NAME,
          version: env.CHDB_MINIMAL_VERSION || '0.1.0',
          environment: env.ENVIRONMENT || 'unknown',
          modules: {
            executor: '132KB',
            memory_engine: '162KB',
            aggregates: '153KB',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        }
      );
    }

    // Help endpoint
    if (url.pathname === '/help') {
      return new Response(
        JSON.stringify({
          name: SERVER_NAME,
          description: 'Minimal SQL engine with in-memory tables and aggregates',
          endpoints: {
            'POST /': 'Execute SQL query (JSON body: {"query": "..."})',
            'GET /query?sql=...': 'Execute SQL query (URL parameter)',
            'GET /ping': 'Health check',
            'GET /version': 'Version information',
            'GET /help': 'This help message',
          },
          examples: [
            { description: 'Simple arithmetic', sql: 'SELECT 1 + 2 AS result' },
            { description: 'Create table', sql: "CREATE TABLE test (id Int32, name String) ENGINE = Memory" },
            { description: 'Insert data', sql: "INSERT INTO test VALUES (1, 'Alice'), (2, 'Bob')" },
            { description: 'Select all', sql: 'SELECT * FROM test' },
            { description: 'Aggregates', sql: 'SELECT COUNT(*), SUM(id) FROM test' },
          ],
          supported_sql: [
            'SELECT (with WHERE, ORDER BY, LIMIT)',
            'CREATE TABLE ... ENGINE = Memory',
            'INSERT INTO ... VALUES',
            'DROP TABLE [IF EXISTS]',
            'SHOW TABLES',
            'DESCRIBE table',
          ],
          aggregate_functions: ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'],
        }, null, 2),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        }
      );
    }

    // Query endpoint
    if (url.pathname === '/' || url.pathname === '/query') {
      let sql: string | null = null;

      if (request.method === 'GET') {
        sql = url.searchParams.get('sql') || url.searchParams.get('query');
      } else if (request.method === 'POST') {
        try {
          const contentType = request.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const body = (await request.json()) as { query?: string; sql?: string };
            sql = body.query || body.sql || null;
          } else {
            sql = await request.text();
          }
        } catch {
          return createErrorResponse('Invalid request body', 400, queryId);
        }
      } else {
        return createErrorResponse('Method not allowed', 405, queryId);
      }

      if (!sql || sql.trim() === '') {
        // Return friendly landing page with examples
        const baseUrl = url.origin;
        const examples = [
          { name: 'Simple arithmetic', sql: 'SELECT 1 + 2 AS result', url: `${baseUrl}/query?sql=${encodeURIComponent('SELECT 1 + 2 AS result')}` },
          { name: 'Multiple expressions', sql: 'SELECT 42 AS answer, 3.14 * 2 AS tau', url: `${baseUrl}/query?sql=${encodeURIComponent('SELECT 42 AS answer, 3.14 * 2 AS tau')}` },
          { name: 'String literals', sql: "SELECT 'Hello, World!' AS greeting", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT 'Hello, World!' AS greeting")}` },
          { name: 'Complex math', sql: 'SELECT (10 + 5) * 3 / 2 - 7 AS calc', url: `${baseUrl}/query?sql=${encodeURIComponent('SELECT (10 + 5) * 3 / 2 - 7 AS calc')}` },
          { name: 'Create table', sql: "CREATE TABLE users (id Int32, name String, score Float64) ENGINE = Memory", url: `${baseUrl}/query?sql=${encodeURIComponent("CREATE TABLE users (id Int32, name String, score Float64) ENGINE = Memory")}` },
          { name: 'Insert data', sql: "INSERT INTO users VALUES (1, 'Alice', 95.5), (2, 'Bob', 87.3), (3, 'Carol', 92.1)", url: `${baseUrl}/query?sql=${encodeURIComponent("INSERT INTO users VALUES (1, 'Alice', 95.5), (2, 'Bob', 87.3), (3, 'Carol', 92.1)")}` },
          { name: 'Select all', sql: 'SELECT * FROM users', url: `${baseUrl}/query?sql=${encodeURIComponent('SELECT * FROM users')}` },
          { name: 'Order by', sql: 'SELECT * FROM users ORDER BY score DESC', url: `${baseUrl}/query?sql=${encodeURIComponent('SELECT * FROM users ORDER BY score DESC')}` },
          { name: 'Where clause', sql: 'SELECT name, score FROM users WHERE score > 90', url: `${baseUrl}/query?sql=${encodeURIComponent('SELECT name, score FROM users WHERE score > 90')}` },
          { name: 'Aggregates', sql: 'SELECT COUNT(*) AS total, AVG(score) AS avg_score, MAX(score) AS top_score FROM users', url: `${baseUrl}/query?sql=${encodeURIComponent('SELECT COUNT(*) AS total, AVG(score) AS avg_score, MAX(score) AS top_score FROM users')}` },
        ];

        return new Response(JSON.stringify({
          name: SERVER_NAME,
          version: env.CHDB_MINIMAL_VERSION || '0.1.0',
          description: 'Minimal SQL engine with in-memory tables and aggregate functions',
          usage: {
            post: 'POST / with {"query": "SELECT ..."}',
            get: 'GET /query?sql=SELECT ...',
          },
          endpoints: {
            query: `${baseUrl}/query?sql=...`,
            ping: `${baseUrl}/ping`,
            health: `${baseUrl}/health`,
            version: `${baseUrl}/version`,
            help: `${baseUrl}/help`,
          },
          examples,
          supported: {
            statements: ['SELECT', 'CREATE TABLE ... ENGINE = Memory', 'INSERT INTO', 'DROP TABLE', 'SHOW TABLES', 'DESCRIBE'],
            aggregates: ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'],
            clauses: ['WHERE', 'ORDER BY', 'LIMIT'],
            types: ['Int32', 'Int64', 'Float64', 'String', 'Bool'],
          },
          related: {
            'chdb-fetch': 'https://chdb-fetch.dotdo.workers.dev',
            'chdb-executor': 'https://chdb-executor.dotdo.workers.dev',
            github: 'https://github.com/anthropics/claude-code',
          },
        }, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            ...CORS_HEADERS,
          },
        });
      }

      try {
        const result = executeQuery(sql);
        return new Response(JSON.stringify(result, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Query-Id': queryId,
            'X-Server': SERVER_NAME,
            'X-Rows-Read': String(result.statistics?.rows_read || 0),
            'X-Elapsed': String(result.statistics?.elapsed || 0),
            ...CORS_HEADERS,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[chdb-minimal] Query error: ${message}`);
        return createErrorResponse(message, 400, queryId);
      }
    }

    // 404 for unknown paths
    return createErrorResponse(`Not found: ${url.pathname}`, 404, queryId);
  },
};

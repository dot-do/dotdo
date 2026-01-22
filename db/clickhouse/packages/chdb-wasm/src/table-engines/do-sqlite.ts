/**
 * doSqlite() Table Function Implementation
 *
 * Provides a table function that queries Durable Object SQLite databases
 * directly from ClickHouse SQL queries.
 *
 * Syntax:
 *   doSqlite('namespace', 'do-id', 'SELECT * FROM table')
 *   doSqlite(DO_BINDING, 'do-id', 'SELECT * FROM table WHERE col = ?', [param1, param2])
 *
 * @module table-engines/do-sqlite
 */

/**
 * Durable Object Namespace interface
 */
interface DurableObjectNamespace {
  get: (id: DurableObjectId) => DurableObjectStub;
  idFromName: (name: string) => DurableObjectId;
  idFromString: (id: string) => DurableObjectId;
}

/**
 * Durable Object ID interface
 */
interface DurableObjectId {
  toString: () => string;
  equals: (other: DurableObjectId) => boolean;
}

/**
 * Durable Object Stub interface
 */
interface DurableObjectStub {
  id: DurableObjectId;
  fetch: (request: Request) => Promise<Response>;
}

/**
 * Result from doSqlite execution
 */
export interface DoSqliteResult {
  meta: Array<{ name: string; type: string }>;
  data: Array<Record<string, unknown>>;
  rows: number;
}

/**
 * Parse doSqlite() function arguments from SQL
 * Handles both quoted string namespaces and unquoted binding references
 *
 * @param argsStr - The arguments string inside doSqlite(...)
 * @returns Parsed arguments { namespace, doId, sql, params }
 */
export function parseDoSqliteArgs(argsStr: string): {
  namespace: string;
  isBindingRef: boolean;
  doId: string;
  sql: string;
  params: unknown[];
} {
  // Parse arguments respecting nested parentheses, quotes, and brackets
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let current = '';

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    const prevChar = i > 0 ? argsStr[i - 1] : '';

    // Handle string detection
    if ((char === "'" || char === '"') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
    }

    if (!inString) {
      if (char === '(' || char === '[') depth++;
      if (char === ')' || char === ']') depth--;
      if (char === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }
  if (current.trim()) {
    args.push(current.trim());
  }

  // Validate minimum arguments (namespace, doId, sql)
  if (args.length < 3) {
    throw new Error('doSqlite() requires at least 3 arguments: namespace, do-id, sql');
  }

  // Parse namespace (can be quoted string or unquoted binding reference)
  const namespaceArg = args[0];
  let namespace: string;
  let isBindingRef = false;

  if (namespaceArg.startsWith("'") && namespaceArg.endsWith("'")) {
    namespace = namespaceArg.slice(1, -1);
  } else if (/^\d+$/.test(namespaceArg)) {
    throw new Error('Invalid type for namespace argument: expected string or binding reference');
  } else {
    // Unquoted identifier - treat as binding reference
    namespace = namespaceArg;
    isBindingRef = true;
  }

  // Parse DO ID (must be quoted string or idFromName() call)
  const doIdArg = args[1];
  let doId: string;

  if (doIdArg.startsWith("'") && doIdArg.endsWith("'")) {
    doId = doIdArg.slice(1, -1);
  } else if (doIdArg.toLowerCase().startsWith('idfromname(')) {
    // Extract name from idFromName('name')
    const match = doIdArg.match(/idFromName\s*\(\s*'([^']+)'\s*\)/i);
    if (match) {
      doId = `name:${match[1]}`;
    } else {
      throw new Error('Invalid idFromName() call');
    }
  } else {
    throw new Error('DO ID must be a quoted string');
  }

  // Parse SQL query (must be quoted string)
  const sqlArg = args[2];
  let sql: string;

  if (sqlArg.startsWith("'") && sqlArg.endsWith("'")) {
    sql = sqlArg.slice(1, -1);
    // Handle escaped single quotes
    sql = sql.replace(/''/g, "'");
  } else {
    throw new Error('SQL query must be a quoted string');
  }

  // Validate SQL is not empty
  if (!sql.trim()) {
    throw new Error('Empty query provided to doSqlite()');
  }

  // Parse optional parameters array
  let params: unknown[] = [];
  if (args.length >= 4) {
    const paramsArg = args[3];
    if (paramsArg.startsWith('[') && paramsArg.endsWith(']')) {
      const paramsStr = paramsArg.slice(1, -1).trim();
      if (paramsStr) {
        // Parse array elements
        params = parseArrayElements(paramsStr);
      }
    }
  }

  return { namespace, isBindingRef, doId, sql, params };
}

/**
 * Parse array elements from a string like "1, 'hello', null"
 */
function parseArrayElements(str: string): unknown[] {
  const elements: unknown[] = [];
  let inString = false;
  let stringChar = '';
  let current = '';

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const prevChar = i > 0 ? str[i - 1] : '';

    if ((char === "'" || char === '"') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
    }

    if (!inString && char === ',') {
      elements.push(parseValue(current.trim()));
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    elements.push(parseValue(current.trim()));
  }

  return elements;
}

/**
 * Parse a single value (string, number, null, etc.)
 */
function parseValue(str: string): unknown {
  if (str === 'null') return null;
  if (str === 'true') return true;
  if (str === 'false') return false;

  // Check for string literal
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
    return str.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
  }

  // Check for number
  if (/^-?\d+(\.\d+)?$/.test(str)) {
    return str.includes('.') ? parseFloat(str) : parseInt(str, 10);
  }

  return str;
}

/**
 * Execute a doSqlite() query against a Durable Object
 *
 * @param namespace - The DO namespace (binding name)
 * @param doId - The Durable Object ID
 * @param sql - The SQL query to execute
 * @param params - Query parameters for prepared statements
 * @param env - Environment containing DO bindings
 * @returns Query result
 */
export async function executeDoSqlite(
  namespace: string,
  isBindingRef: boolean,
  doId: string,
  sql: string,
  params: unknown[],
  env: Record<string, unknown>
): Promise<DoSqliteResult> {
  // Get the DO namespace from environment
  const bindingName = isBindingRef ? namespace : namespace;
  const doNamespace = env[bindingName] as DurableObjectNamespace | undefined;

  if (!doNamespace) {
    const error = new Error(`Binding or namespace not found: ${bindingName}`);
    (error as any).status = 400;
    throw error;
  }

  // Get the DO ID
  let id: DurableObjectId;
  if (doId.startsWith('name:')) {
    id = doNamespace.idFromName(doId.slice(5));
  } else {
    id = doNamespace.idFromString(doId);
  }

  // Get the DO stub
  const stub = doNamespace.get(id);

  // Build the request URL
  const url = new URL('http://durable-object/query');
  url.searchParams.set('query', sql);
  if (params.length > 0) {
    url.searchParams.set('params', JSON.stringify(params));
  }

  // Make the request to the DO
  const request = new Request(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  const response = await stub.fetch(request);

  // Handle errors
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(body);
    (error as any).status = response.status;
    throw error;
  }

  // Parse the response
  const result = (await response.json()) as {
    columns?: string[];
    rows?: Array<Record<string, unknown>>;
    rowCount?: number;
    error?: string;
  };

  if (result.error) {
    const error = new Error(result.error);
    (error as any).status = 500;
    throw error;
  }

  // Convert to our result format
  const columns = result.columns || [];
  const rows = result.rows || [];

  // Infer types from data
  const meta = columns.map((name) => {
    let type = 'String';
    // Look at first row for type inference
    if (rows.length > 0) {
      const value = rows[0][name];
      if (typeof value === 'number') {
        type = Number.isInteger(value) ? 'Int64' : 'Float64';
      } else if (typeof value === 'boolean') {
        type = 'UInt8';
      } else if (value === null) {
        type = 'Nullable(String)';
      }
    }
    return { name, type };
  });

  return {
    meta,
    data: rows,
    rows: rows.length,
  };
}

/**
 * Infer column types from data
 */
export function inferColumnTypes(data: Array<Record<string, unknown>>): Array<{ name: string; type: string }> {
  if (data.length === 0) {
    return [];
  }

  const firstRow = data[0];
  const columns = Object.keys(firstRow);

  return columns.map((name) => {
    let type = 'String';

    // Check all rows to determine type
    for (const row of data) {
      const value = row[name];
      if (value === null || value === undefined) continue;

      if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          type = 'Int64';
        } else {
          type = 'Float64';
        }
        break;
      } else if (typeof value === 'boolean') {
        type = 'UInt8';
        break;
      } else if (typeof value === 'string') {
        // Check for date pattern
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          type = 'Date';
        } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value)) {
          type = 'DateTime';
        } else {
          type = 'String';
        }
        break;
      }
    }

    return { name, type };
  });
}

/**
 * Check if a SQL string contains doSqlite() calls
 */
export function containsDoSqlite(sql: string): boolean {
  return /\bdoSqlite\s*\(/i.test(sql);
}

/**
 * Extract all doSqlite() calls from SQL
 * Returns array of { fullMatch, args, startIndex, endIndex }
 */
export function extractDoSqliteCalls(sql: string): Array<{
  fullMatch: string;
  args: string;
  startIndex: number;
  endIndex: number;
}> {
  const calls: Array<{
    fullMatch: string;
    args: string;
    startIndex: number;
    endIndex: number;
  }> = [];

  // Find all doSqlite( positions
  const regex = /\bdoSqlite\s*\(/gi;
  let match;

  while ((match = regex.exec(sql)) !== null) {
    const startIndex = match.index;
    let parenDepth = 1;
    let i = match.index + match[0].length;
    let inString = false;
    let stringChar = '';

    while (i < sql.length && parenDepth > 0) {
      const char = sql[i];
      const prevChar = i > 0 ? sql[i - 1] : '';

      if ((char === "'" || char === '"') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
          stringChar = '';
        }
      }

      if (!inString) {
        if (char === '(') parenDepth++;
        if (char === ')') parenDepth--;
      }

      i++;
    }

    const fullMatch = sql.slice(startIndex, i);
    const argsStart = startIndex + match[0].length;
    const args = sql.slice(argsStart, i - 1);

    calls.push({
      fullMatch,
      args,
      startIndex,
      endIndex: i,
    });
  }

  return calls;
}

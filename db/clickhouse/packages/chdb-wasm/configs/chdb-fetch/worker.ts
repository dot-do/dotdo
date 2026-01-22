/**
 * chdb-fetch Cloudflare Worker
 *
 * A SQL interface for querying HTTP APIs using ClickHouse-compatible syntax.
 * Supports the url() table function for fetching and querying remote data.
 *
 * Features:
 * - POST / with {"query": "SELECT * FROM url('...')"}
 * - GET /query?sql=...
 * - Cache results in Cache API with configurable TTL
 * - Support CORS for browser usage
 * - JSON and CSV format parsing
 *
 * Example queries:
 * ```sql
 * SELECT * FROM url('https://api.github.com/users/octocat', 'JSON')
 * SELECT name, stargazers_count
 *   FROM url('https://api.github.com/users/cloudflare/repos', 'JSONEachRow')
 *   ORDER BY stargazers_count DESC LIMIT 10
 * ```
 */

/**
 * Environment bindings for the Worker
 */
export interface Env {
  WASM_BUCKET: R2Bucket;
  CHDB_FETCH_VERSION: string;
  ENVIRONMENT: string;
  DEFAULT_CACHE_TTL: string;
  MAX_RESPONSE_SIZE: string;
  FETCH_TIMEOUT: string;
}

/**
 * CORS headers for cross-origin requests
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Cache-TTL, X-No-Cache',
};

/**
 * Server identification header
 */
const SERVER_NAME = 'chdb-fetch';

/**
 * Supported formats for URL table function
 */
type SupportedFormat = 'JSON' | 'JSONEachRow' | 'JSONCompact' | 'CSV' | 'CSVWithNames' | 'TSV' | 'TSVWithNames';

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
    urls_fetched: number;
  };
}

/**
 * URL table function match result
 */
interface UrlTableMatch {
  url: string;
  format: SupportedFormat;
  fullMatch: string;
}

/**
 * Parse a URL table function call from SQL
 *
 * Matches patterns like:
 * - url('https://example.com', 'JSON')
 * - url('https://example.com', 'JSONEachRow')
 * - url('https://example.com/data.csv', 'CSV')
 */
function parseUrlTableFunction(sql: string): UrlTableMatch | null {
  // Match url('...', 'FORMAT') or url('...')
  const urlRegex = /\burl\s*\(\s*'([^']+)'\s*(?:,\s*'(\w+)')?\s*\)/i;
  const match = sql.match(urlRegex);

  if (!match) {
    return null;
  }

  const url = match[1];
  const format = (match[2]?.toUpperCase() || 'JSON') as SupportedFormat;

  // Validate format
  const validFormats: SupportedFormat[] = ['JSON', 'JSONEachRow', 'JSONCompact', 'CSV', 'CSVWithNames', 'TSV', 'TSVWithNames'];
  if (!validFormats.includes(format)) {
    throw new Error(`Unsupported format '${format}'. Supported formats: ${validFormats.join(', ')}`);
  }

  return {
    url,
    format,
    fullMatch: match[0],
  };
}

/**
 * Fetch data from a URL with proper error handling
 */
async function fetchUrl(
  url: string,
  env: Env,
  cacheKey?: string,
  cacheTtl?: number
): Promise<string> {
  const maxSize = parseInt(env.MAX_RESPONSE_SIZE || '10485760', 10);
  const timeout = parseInt(env.FETCH_TIMEOUT || '30000', 10);

  // Check cache first
  if (cacheKey && cacheTtl && cacheTtl > 0) {
    const cache = caches.default;
    const cachedResponse = await cache.match(new Request(cacheKey));
    if (cachedResponse) {
      console.log(`[chdb-fetch] Cache hit for ${url}`);
      return cachedResponse.text();
    }
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    console.log(`[chdb-fetch] Fetching ${url}`);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': `${SERVER_NAME}/${env.CHDB_FETCH_VERSION || '0.1.0'}`,
        'Accept': 'application/json, text/csv, text/plain, */*',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} for URL: ${url}`);
    }

    // Check content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
      throw new Error(`Response too large: ${contentLength} bytes exceeds maximum of ${maxSize} bytes`);
    }

    const data = await response.text();

    // Verify actual size
    if (data.length > maxSize) {
      throw new Error(`Response too large: ${data.length} bytes exceeds maximum of ${maxSize} bytes`);
    }

    // Cache the response if caching is enabled
    if (cacheKey && cacheTtl && cacheTtl > 0) {
      const cache = caches.default;
      const cacheResponse = new Response(data, {
        headers: {
          'Cache-Control': `public, max-age=${cacheTtl}`,
          'Content-Type': 'text/plain',
        },
      });
      // Use waitUntil if available, otherwise cache synchronously
      await cache.put(new Request(cacheKey), cacheResponse);
      console.log(`[chdb-fetch] Cached response for ${url} (TTL: ${cacheTtl}s)`);
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms for URL: ${url}`);
    }
    throw error;
  }
}

/**
 * Parse JSON data into rows
 */
function parseJsonData(data: string, format: SupportedFormat): { rows: any[]; columns: string[] } {
  if (format === 'JSONEachRow') {
    // Parse newline-delimited JSON
    const lines = data.trim().split('\n').filter(line => line.trim());
    const rows = lines.map(line => JSON.parse(line));
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, columns };
  }

  if (format === 'JSON' || format === 'JSONCompact') {
    const parsed = JSON.parse(data);

    // Handle array of objects
    if (Array.isArray(parsed)) {
      const columns = parsed.length > 0 ? Object.keys(parsed[0]) : [];
      return { rows: parsed, columns };
    }

    // Handle object with data property (ClickHouse JSON format)
    if (parsed.data && Array.isArray(parsed.data)) {
      const columns = parsed.meta?.map((m: any) => m.name) || (parsed.data.length > 0 ? Object.keys(parsed.data[0]) : []);
      return { rows: parsed.data, columns };
    }

    // Handle single object
    const columns = Object.keys(parsed);
    return { rows: [parsed], columns };
  }

  throw new Error(`Unsupported JSON format: ${format}`);
}

/**
 * Parse CSV data into rows
 */
function parseCsvData(data: string, format: SupportedFormat): { rows: any[]; columns: string[] } {
  const lines = data.trim().split('\n');
  if (lines.length === 0) {
    return { rows: [], columns: [] };
  }

  const hasHeader = format === 'CSVWithNames' || format === 'TSVWithNames';
  const delimiter = format.startsWith('TSV') ? '\t' : ',';

  // Parse header or generate column names
  let columns: string[];
  let dataStartIndex: number;

  if (hasHeader) {
    columns = parseCsvLine(lines[0], delimiter);
    dataStartIndex = 1;
  } else {
    // Generate column names based on first data row
    const firstRow = parseCsvLine(lines[0], delimiter);
    columns = firstRow.map((_, i) => `column${i + 1}`);
    dataStartIndex = 0;
  }

  // Parse data rows
  const rows = lines.slice(dataStartIndex).map(line => {
    const values = parseCsvLine(line, delimiter);
    const row: Record<string, any> = {};
    columns.forEach((col, i) => {
      row[col] = parseValue(values[i]);
    });
    return row;
  });

  return { rows, columns };
}

/**
 * Parse a single CSV line, handling quoted values
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i += 2;
      } else if (char === '"') {
        // End of quoted value
        inQuotes = false;
        i++;
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        // Start of quoted value
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        // End of field
        values.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }

  // Add last field
  values.push(current.trim());

  return values;
}

/**
 * Parse a string value to its appropriate type
 */
function parseValue(val: string | undefined): any {
  if (val === undefined || val === '' || val === 'NULL' || val === '\\N') {
    return null;
  }

  // Try to parse as number
  if (/^-?\d+$/.test(val)) {
    const num = parseInt(val, 10);
    if (num >= Number.MIN_SAFE_INTEGER && num <= Number.MAX_SAFE_INTEGER) {
      return num;
    }
    return val;
  }

  if (/^-?\d+\.\d+$/.test(val)) {
    return parseFloat(val);
  }

  // Boolean
  if (val.toLowerCase() === 'true') return true;
  if (val.toLowerCase() === 'false') return false;

  return val;
}

/**
 * Infer column type from value
 */
function inferType(value: any): string {
  if (value === null) return 'Nullable(String)';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'Int64' : 'Float64';
  }
  if (typeof value === 'boolean') return 'Bool';
  if (Array.isArray(value)) return 'Array(String)';
  if (typeof value === 'object') return 'JSON';
  return 'String';
}

/**
 * Apply SQL operations to data (simplified SQL engine)
 */
function applySqlOperations(
  data: any[],
  columns: string[],
  sql: string,
  urlMatch: UrlTableMatch
): QueryResult {
  let rows = [...data];

  // Replace the url() function with a placeholder table name for parsing
  const simplifiedSql = sql.replace(urlMatch.fullMatch, '__url_table__');

  // Parse SELECT columns
  const selectMatch = simplifiedSql.match(/SELECT\s+(.+?)\s+FROM/i);
  const selectClause = selectMatch ? selectMatch[1].trim() : '*';

  // Parse WHERE clause
  const whereMatch = simplifiedSql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
  if (whereMatch) {
    const whereClause = whereMatch[1].trim();
    rows = rows.filter(row => evaluateWhereClause(row, whereClause));
  }

  // Parse ORDER BY clause
  const orderMatch = simplifiedSql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/i);
  if (orderMatch) {
    const orderClause = orderMatch[1].trim();
    rows = applySorting(rows, orderClause);
  }

  // Parse LIMIT clause
  const limitMatch = simplifiedSql.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10);
    const offset = limitMatch[2] ? parseInt(limitMatch[2], 10) : 0;
    rows = rows.slice(offset, offset + limit);
  }

  // Apply column selection and transformations
  const { selectedRows, selectedColumns } = applySelectClause(rows, columns, selectClause);

  // Build metadata
  const meta = selectedColumns.map(col => ({
    name: col,
    type: selectedRows.length > 0 ? inferType(selectedRows[0][col]) : 'String',
  }));

  return {
    meta,
    data: selectedRows,
    rows: selectedRows.length,
    statistics: {
      elapsed: 0,
      rows_read: data.length,
      bytes_read: JSON.stringify(data).length,
      urls_fetched: 1,
    },
  };
}

/**
 * Evaluate a WHERE clause condition
 */
function evaluateWhereClause(row: any, clause: string): boolean {
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
  const comparisonMatch = clause.match(/^(\w+)\s*(=|!=|<>|>|<|>=|<=|LIKE|NOT\s+LIKE)\s*(.+)$/i);
  if (comparisonMatch) {
    const column = comparisonMatch[1];
    const operator = comparisonMatch[2].toUpperCase();
    let value: any = comparisonMatch[3].trim();

    // Remove quotes from string values
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
      case 'LIKE': {
        const pattern = String(value).replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(`^${pattern}$`, 'i').test(String(rowValue));
      }
      case 'NOT LIKE': {
        const pattern = String(value).replace(/%/g, '.*').replace(/_/g, '.');
        return !new RegExp(`^${pattern}$`, 'i').test(String(rowValue));
      }
    }
  }

  // Handle IS NULL / IS NOT NULL
  const isNullMatch = clause.match(/^(\w+)\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNullMatch) {
    const column = isNullMatch[1];
    const isNotNull = !!isNullMatch[2];
    const rowValue = row[column];
    return isNotNull ? (rowValue !== null && rowValue !== undefined) : (rowValue === null || rowValue === undefined);
  }

  // Default to true if we can't parse
  return true;
}

/**
 * Apply sorting to rows
 */
function applySorting(rows: any[], orderClause: string): any[] {
  const parts = orderClause.split(',').map(p => p.trim());

  return rows.sort((a, b) => {
    for (const part of parts) {
      const match = part.match(/^(\w+)(?:\s+(ASC|DESC))?$/i);
      if (match) {
        const column = match[1];
        const direction = (match[2]?.toUpperCase() || 'ASC') === 'DESC' ? -1 : 1;

        const aVal = a[column];
        const bVal = b[column];

        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
      }
    }
    return 0;
  });
}

/**
 * Apply SELECT clause to rows
 */
function applySelectClause(
  rows: any[],
  availableColumns: string[],
  selectClause: string
): { selectedRows: any[]; selectedColumns: string[] } {
  // Handle SELECT *
  if (selectClause === '*') {
    return { selectedRows: rows, selectedColumns: availableColumns };
  }

  // Parse column list
  const columnExpressions = parseColumnList(selectClause);
  const selectedColumns: string[] = [];
  const columnMappings: Array<{ source: string; alias: string; transform?: (val: any) => any }> = [];

  for (const expr of columnExpressions) {
    const aliasMatch = expr.match(/^(.+?)\s+AS\s+(\w+)$/i);
    const source = aliasMatch ? aliasMatch[1].trim() : expr;
    const alias = aliasMatch ? aliasMatch[2] : expr;

    selectedColumns.push(alias);
    columnMappings.push({ source, alias });
  }

  // Transform rows
  const selectedRows = rows.map(row => {
    const newRow: Record<string, any> = {};
    for (const mapping of columnMappings) {
      // Check if it's a simple column reference
      if (row.hasOwnProperty(mapping.source)) {
        newRow[mapping.alias] = row[mapping.source];
      } else {
        // Try to evaluate as expression
        newRow[mapping.alias] = evaluateExpression(mapping.source, row);
      }
    }
    return newRow;
  });

  return { selectedRows, selectedColumns };
}

/**
 * Parse a comma-separated column list, respecting parentheses
 */
function parseColumnList(selectClause: string): string[] {
  const columns: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of selectClause) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    columns.push(current.trim());
  }

  return columns;
}

/**
 * Evaluate a simple expression
 */
function evaluateExpression(expr: string, row: any): any {
  const trimmed = expr.trim();

  // String literal
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Column reference
  if (row.hasOwnProperty(trimmed)) {
    return row[trimmed];
  }

  // Function call
  const funcMatch = trimmed.match(/^(\w+)\s*\((.+)\)$/);
  if (funcMatch) {
    const funcName = funcMatch[1].toLowerCase();
    const argExpr = funcMatch[2].trim();
    const argValue = evaluateExpression(argExpr, row);

    switch (funcName) {
      case 'lower':
      case 'lcase':
        return String(argValue).toLowerCase();
      case 'upper':
      case 'ucase':
        return String(argValue).toUpperCase();
      case 'length':
      case 'char_length':
        return String(argValue).length;
      case 'trim':
        return String(argValue).trim();
      case 'coalesce':
        return argValue ?? null;
      case 'tostring':
        return String(argValue);
      case 'toint':
      case 'toint32':
      case 'toint64':
        return parseInt(String(argValue), 10);
      case 'tofloat':
      case 'tofloat64':
        return parseFloat(String(argValue));
    }
  }

  // Return as-is if we can't evaluate
  return trimmed;
}

/**
 * Execute a query with URL table function
 */
async function executeQuery(
  sql: string,
  env: Env,
  request: Request
): Promise<QueryResult> {
  const startTime = performance.now();

  // Parse URL table function from SQL
  const urlMatch = parseUrlTableFunction(sql);
  if (!urlMatch) {
    throw new Error(
      'Query must contain a url() table function. ' +
      "Example: SELECT * FROM url('https://api.example.com/data', 'JSON')"
    );
  }

  // Get cache settings from headers or use defaults
  const noCache = request.headers.get('X-No-Cache') === 'true';
  const cacheTtlHeader = request.headers.get('X-Cache-TTL');
  const cacheTtl = noCache ? 0 : (cacheTtlHeader ? parseInt(cacheTtlHeader, 10) : parseInt(env.DEFAULT_CACHE_TTL || '3600', 10));

  // Create cache key from URL
  const cacheKey = `https://chdb-fetch.cache/${encodeURIComponent(urlMatch.url)}`;

  // Fetch data from URL
  const rawData = await fetchUrl(urlMatch.url, env, cacheKey, cacheTtl);

  // Parse data based on format
  let parsedData: { rows: any[]; columns: string[] };
  try {
    if (urlMatch.format.startsWith('JSON')) {
      parsedData = parseJsonData(rawData, urlMatch.format);
    } else {
      parsedData = parseCsvData(rawData, urlMatch.format);
    }
  } catch (parseError) {
    throw new Error(`Failed to parse response as ${urlMatch.format}: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }

  // Apply SQL operations
  const result = applySqlOperations(parsedData.rows, parsedData.columns, sql, urlMatch);

  // Update statistics
  const elapsed = (performance.now() - startTime) / 1000;
  if (result.statistics) {
    result.statistics.elapsed = elapsed;
  }

  return result;
}

/**
 * Format query result as JSON
 */
function formatResult(result: QueryResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Create an error response
 */
function createErrorResponse(message: string, status: number, queryId: string): Response {
  return new Response(
    JSON.stringify({
      error: true,
      message,
      query_id: queryId,
    }),
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
 * Generate a unique query ID
 */
function generateQueryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
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

    // Health check endpoints
    if (url.pathname === '/ping' || url.pathname === '/health') {
      return new Response('OK', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          ...CORS_HEADERS,
        },
      });
    }

    // Version endpoint
    if (url.pathname === '/version') {
      return new Response(
        JSON.stringify({
          name: SERVER_NAME,
          version: env.CHDB_FETCH_VERSION || '0.1.0',
          environment: env.ENVIRONMENT || 'unknown',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Help endpoint
    if (url.pathname === '/help') {
      return new Response(
        JSON.stringify({
          name: SERVER_NAME,
          description: 'SQL interface for querying HTTP APIs',
          endpoints: {
            'POST /': 'Execute SQL query (JSON body: {"query": "..."})',
            'GET /query?sql=...': 'Execute SQL query (URL parameter)',
            'GET /ping': 'Health check',
            'GET /version': 'Version information',
            'GET /help': 'This help message',
          },
          examples: [
            {
              description: 'Query GitHub API',
              sql: "SELECT * FROM url('https://api.github.com/users/octocat', 'JSON')",
            },
            {
              description: 'Query GitHub repos with filtering',
              sql: "SELECT name, stargazers_count FROM url('https://api.github.com/users/cloudflare/repos', 'JSONEachRow') ORDER BY stargazers_count DESC LIMIT 10",
            },
            {
              description: 'Query CSV data',
              sql: "SELECT * FROM url('https://example.com/data.csv', 'CSVWithNames') WHERE status = 'active'",
            },
          ],
          headers: {
            'X-Cache-TTL': 'Cache TTL in seconds (default: 3600)',
            'X-No-Cache': 'Set to "true" to bypass cache',
          },
          supported_formats: ['JSON', 'JSONEachRow', 'JSONCompact', 'CSV', 'CSVWithNames', 'TSV', 'TSVWithNames'],
        }, null, 2),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    }

    // Query endpoint
    if (url.pathname === '/' || url.pathname === '/query') {
      let sql: string | null = null;

      // GET with query parameter
      if (request.method === 'GET') {
        sql = url.searchParams.get('sql') || url.searchParams.get('query');
      }
      // POST with JSON body
      else if (request.method === 'POST') {
        try {
          const contentType = request.headers.get('content-type') || '';

          if (contentType.includes('application/json')) {
            const body = (await request.json()) as { query?: string; sql?: string };
            sql = body.query || body.sql || null;
          } else {
            // Plain text body
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
          { name: 'GitHub user info', sql: "SELECT * FROM url('https://api.github.com/users/octocat', 'JSON')", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT * FROM url('https://api.github.com/users/octocat', 'JSON')")}` },
          { name: 'Anthropic repos', sql: "SELECT name, stargazers_count FROM url('https://api.github.com/users/anthropics/repos', 'JSON') ORDER BY stargazers_count DESC LIMIT 5", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT name, stargazers_count FROM url('https://api.github.com/users/anthropics/repos', 'JSON') ORDER BY stargazers_count DESC LIMIT 5")}` },
          { name: 'Cloudflare repos', sql: "SELECT name, language, stargazers_count FROM url('https://api.github.com/users/cloudflare/repos', 'JSON') ORDER BY stargazers_count DESC LIMIT 10", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT name, language, stargazers_count FROM url('https://api.github.com/users/cloudflare/repos', 'JSON') ORDER BY stargazers_count DESC LIMIT 10")}` },
          { name: 'JSONPlaceholder posts', sql: "SELECT id, title FROM url('https://jsonplaceholder.typicode.com/posts', 'JSON') LIMIT 5", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT id, title FROM url('https://jsonplaceholder.typicode.com/posts', 'JSON') LIMIT 5")}` },
          { name: 'JSONPlaceholder users', sql: "SELECT name, email, company FROM url('https://jsonplaceholder.typicode.com/users', 'JSON')", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT name, email, company FROM url('https://jsonplaceholder.typicode.com/users', 'JSON')")}` },
          { name: 'Random user API', sql: "SELECT * FROM url('https://randomuser.me/api/?results=3', 'JSON')", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT * FROM url('https://randomuser.me/api/?results=3', 'JSON')")}` },
          { name: 'IP geolocation', sql: "SELECT * FROM url('https://ipapi.co/json/', 'JSON')", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT * FROM url('https://ipapi.co/json/', 'JSON')")}` },
          { name: 'Cat facts', sql: "SELECT fact FROM url('https://catfact.ninja/facts?limit=5', 'JSON')", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT fact FROM url('https://catfact.ninja/facts?limit=5', 'JSON')")}` },
          { name: 'World time', sql: "SELECT * FROM url('https://worldtimeapi.org/api/timezone/America/New_York', 'JSON')", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT * FROM url('https://worldtimeapi.org/api/timezone/America/New_York', 'JSON')")}` },
          { name: 'Bitcoin price', sql: "SELECT * FROM url('https://api.coindesk.com/v1/bpi/currentprice.json', 'JSON')", url: `${baseUrl}/query?sql=${encodeURIComponent("SELECT * FROM url('https://api.coindesk.com/v1/bpi/currentprice.json', 'JSON')")}` },
        ];

        return new Response(JSON.stringify({
          name: 'chdb-fetch',
          version: env.CHDB_FETCH_VERSION || '0.1.0',
          description: 'SQL interface for querying HTTP APIs using url() table function',
          usage: {
            post: 'POST / with {"query": "SELECT ... FROM url(...)"}',
            get: 'GET /query?sql=SELECT ... FROM url(...)',
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
            formats: ['JSON', 'JSONEachRow', 'JSONCompact', 'CSV', 'CSVWithNames', 'TSV', 'TSVWithNames'],
            clauses: ['SELECT', 'WHERE', 'ORDER BY', 'LIMIT'],
            operators: ['=', '!=', '<', '>', '<=', '>=', 'LIKE', 'IS NULL', 'IS NOT NULL', 'AND', 'OR'],
          },
          syntax: "SELECT columns FROM url('https://...', 'FORMAT') [WHERE ...] [ORDER BY ...] [LIMIT n]",
          related: {
            'chdb-minimal': 'https://chdb-minimal.dotdo.workers.dev',
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
        const result = await executeQuery(sql, env, request);

        return new Response(formatResult(result), {
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
        console.error(`[chdb-fetch] Query error: ${message}`);
        return createErrorResponse(message, 400, queryId);
      }
    }

    // 404 for unknown paths
    return createErrorResponse(`Not found: ${url.pathname}`, 404, queryId);
  },
};

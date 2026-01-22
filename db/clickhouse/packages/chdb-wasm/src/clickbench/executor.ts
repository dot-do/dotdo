/**
 * ClickBench Query Executor
 *
 * Executes ClickBench queries against MergeTree data using the WASM module.
 * This executor:
 * - Parses SQL queries to extract columns, filters, aggregations
 * - Reads data from MergeTree parts via the VFS bridge
 * - Performs aggregations and grouping in JavaScript
 * - Returns results in a format compatible with ClickHouse
 *
 * @module clickbench/executor
 */

import type { MergeTreeLoader, MergeTreePartReader } from '../wasm/mergetree-loader';
import type { VFSStorageProvider } from '../wasm/vfs-bridge';
import type { SqlExecutor } from '../http-query-handler';
import { HITS_COLUMNS, getColumn, type ColumnDefinition } from './schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Query result row
 */
export type ResultRow = Record<string, unknown>;

/**
 * Query execution result
 */
export interface QueryResult {
  /** Result rows */
  data: ResultRow[];
  /** Column metadata */
  meta: Array<{ name: string; type: string }>;
  /** Number of rows returned */
  rows: number;
  /** Total rows processed */
  rowsBeforeLimit: number;
  /** Execution time in milliseconds */
  elapsedMs: number;
  /** Query that was executed */
  query: string;
  /** Any warnings during execution */
  warnings?: string[];
}

/**
 * Aggregation function type
 */
export type AggregateFunction = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';

/**
 * Parsed aggregate expression
 */
export interface ParsedAggregate {
  function: AggregateFunction;
  column: string | '*';
  alias?: string;
  expression?: string;
}

/**
 * Parsed WHERE condition
 */
export interface ParsedCondition {
  column: string;
  operator: string;
  value: unknown;
}

/**
 * Parsed SELECT query
 */
export interface ParsedQuery {
  columns: string[];
  aggregates: ParsedAggregate[];
  table: string;
  where: ParsedCondition[];
  groupBy: string[];
  orderBy: Array<{ column: string; direction: 'ASC' | 'DESC' }>;
  limit: number | null;
  offset: number | null;
  having: string | null;
  isSelectAll: boolean;
}

/**
 * Part metadata for reading
 */
export interface PartInfo {
  database: string;
  table: string;
  partition: string;
  partName: string;
  rowCount: number;
}

// ============================================================================
// Query Parser
// ============================================================================

/**
 * Parse a SQL query to extract components
 */
export function parseQuery(sql: string): ParsedQuery {
  const normalizedSql = sql.replace(/\s+/g, ' ').trim();

  // Extract SELECT clause
  const selectMatch = normalizedSql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
  if (!selectMatch) {
    throw new Error('Invalid SELECT statement');
  }
  const selectClause = selectMatch[1].trim();

  // Check for SELECT *
  const isSelectAll = selectClause === '*' || selectClause.startsWith('* ');

  // Extract table name - match FROM followed by table name, not FROM inside functions like extract()
  // We need to find the FROM that comes after SELECT clause, not inside expressions
  // The pattern looks for FROM that's followed by a valid table identifier and optionally WHERE/GROUP/ORDER/LIMIT
  const tableMatch = normalizedSql.match(/\bFROM\s+(\w+)(?:\s+WHERE|\s+GROUP|\s+ORDER|\s+LIMIT|\s*;|\s*$)/i);
  if (!tableMatch) {
    // Fallback: try to find the last FROM keyword followed by a table name
    const fallbackMatch = normalizedSql.match(/\bFROM\s+(\w+)\b(?!.*\bFROM\s+\w+\s+(?:WHERE|GROUP|ORDER|LIMIT|;|$))/i);
    if (fallbackMatch) {
      const table = fallbackMatch[1];
      // Parse columns and aggregates
      const { columns, aggregates } = parseSelectClause(selectClause);

      // Extract WHERE clause
      const where = parseWhereClause(normalizedSql);

      // Extract GROUP BY
      const groupByMatch = normalizedSql.match(/GROUP\s+BY\s+([\s\S]+?)(?:\s+HAVING|\s+ORDER|\s+LIMIT|;|$)/i);
      const groupBy = groupByMatch
        ? splitByComma(groupByMatch[1]).map(s => s.trim()).filter(Boolean)
        : [];

      // Extract HAVING
      const havingMatch = normalizedSql.match(/HAVING\s+([\s\S]+?)(?:\s+ORDER|\s+LIMIT|;|$)/i);
      const having = havingMatch ? havingMatch[1].trim() : null;

      // Extract ORDER BY
      const orderBy = parseOrderByClause(normalizedSql);

      // Extract LIMIT and OFFSET
      const { limit, offset } = parseLimitOffset(normalizedSql);

      return {
        columns,
        aggregates,
        table,
        where,
        groupBy,
        orderBy,
        limit,
        offset,
        having,
        isSelectAll,
      };
    }
    throw new Error('Missing FROM clause');
  }
  const table = tableMatch[1];

  // Parse columns and aggregates
  const { columns, aggregates } = parseSelectClause(selectClause);

  // Extract WHERE clause
  const where = parseWhereClause(normalizedSql);

  // Extract GROUP BY
  const groupByMatch = normalizedSql.match(/GROUP\s+BY\s+([\s\S]+?)(?:\s+HAVING|\s+ORDER|\s+LIMIT|;|$)/i);
  const groupBy = groupByMatch
    ? groupByMatch[1].split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // Extract HAVING
  const havingMatch = normalizedSql.match(/HAVING\s+([\s\S]+?)(?:\s+ORDER|\s+LIMIT|;|$)/i);
  const having = havingMatch ? havingMatch[1].trim() : null;

  // Extract ORDER BY
  const orderBy = parseOrderByClause(normalizedSql);

  // Extract LIMIT and OFFSET
  const { limit, offset } = parseLimitOffset(normalizedSql);

  return {
    columns,
    aggregates,
    table,
    where,
    groupBy,
    orderBy,
    limit,
    offset,
    having,
    isSelectAll,
  };
}

/**
 * Parse SELECT clause for columns and aggregates
 */
function parseSelectClause(selectClause: string): {
  columns: string[];
  aggregates: ParsedAggregate[];
} {
  const columns: string[] = [];
  const aggregates: ParsedAggregate[] = [];

  // Split by comma, respecting parentheses
  const parts = splitByComma(selectClause);

  for (const part of parts) {
    const trimmed = part.trim();

    // Check for aggregate functions
    const aggMatch = trimmed.match(/^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(DISTINCT\s+)?([^)]+)\s*\)(?:\s+AS\s+(\w+))?$/i);
    if (aggMatch) {
      const func = aggMatch[1].toUpperCase();
      const isDistinct = !!aggMatch[2];
      const column = aggMatch[3].trim();
      const alias = aggMatch[4];

      aggregates.push({
        function: isDistinct && func === 'COUNT' ? 'COUNT_DISTINCT' : func as AggregateFunction,
        column: column === '*' ? '*' : column,
        alias,
      });
      continue;
    }

    // Check for simple column with optional alias
    const colMatch = trimmed.match(/^(\w+)(?:\s+AS\s+(\w+))?$/i);
    if (colMatch) {
      columns.push(colMatch[1]);
      continue;
    }

    // Check for expression with alias
    const exprMatch = trimmed.match(/^(.+?)\s+AS\s+(\w+)$/i);
    if (exprMatch) {
      columns.push(exprMatch[2]); // Use alias as column name
      continue;
    }

    // Constant (like 1)
    if (/^\d+$/.test(trimmed)) {
      columns.push(trimmed);
      continue;
    }

    // Add as-is
    columns.push(trimmed);
  }

  return { columns, aggregates };
}

/**
 * Parse WHERE clause conditions
 */
function parseWhereClause(sql: string): ParsedCondition[] {
  const conditions: ParsedCondition[] = [];

  const whereMatch = sql.match(/WHERE\s+([\s\S]+?)(?:\s+GROUP|\s+ORDER|\s+LIMIT|;|$)/i);
  if (!whereMatch) {
    return conditions;
  }

  const whereClause = whereMatch[1];

  // Split by AND (simple parser - doesn't handle OR or nested conditions)
  const parts = whereClause.split(/\s+AND\s+/i);

  for (const part of parts) {
    const trimmed = part.trim();

    // Handle various operators
    // Column = value
    let match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (match) {
      conditions.push({
        column: match[1],
        operator: '=',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column <> value
    match = trimmed.match(/^(\w+)\s*<>\s*(.+)$/);
    if (match) {
      conditions.push({
        column: match[1],
        operator: '<>',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column != value
    match = trimmed.match(/^(\w+)\s*!=\s*(.+)$/);
    if (match) {
      conditions.push({
        column: match[1],
        operator: '<>',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column >= value
    match = trimmed.match(/^(\w+)\s*>=\s*(.+)$/);
    if (match) {
      conditions.push({
        column: match[1],
        operator: '>=',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column <= value
    match = trimmed.match(/^(\w+)\s*<=\s*(.+)$/);
    if (match) {
      conditions.push({
        column: match[1],
        operator: '<=',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column > value
    match = trimmed.match(/^(\w+)\s*>\s*(.+)$/);
    if (match) {
      conditions.push({
        column: match[1],
        operator: '>',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column < value
    match = trimmed.match(/^(\w+)\s*<\s*(.+)$/);
    if (match) {
      conditions.push({
        column: match[1],
        operator: '<',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column LIKE pattern
    match = trimmed.match(/^(\w+)\s+LIKE\s+(.+)$/i);
    if (match) {
      conditions.push({
        column: match[1],
        operator: 'LIKE',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column NOT LIKE pattern
    match = trimmed.match(/^(\w+)\s+NOT\s+LIKE\s+(.+)$/i);
    if (match) {
      conditions.push({
        column: match[1],
        operator: 'NOT LIKE',
        value: parseValue(match[2]),
      });
      continue;
    }

    // Column IN (values)
    match = trimmed.match(/^(\w+)\s+IN\s+\((.+)\)$/i);
    if (match) {
      const values = match[2].split(',').map(v => parseValue(v.trim()));
      conditions.push({
        column: match[1],
        operator: 'IN',
        value: values,
      });
      continue;
    }
  }

  return conditions;
}

/**
 * Parse ORDER BY clause
 */
function parseOrderByClause(sql: string): Array<{ column: string; direction: 'ASC' | 'DESC' }> {
  const orderBy: Array<{ column: string; direction: 'ASC' | 'DESC' }> = [];

  const orderMatch = sql.match(/ORDER\s+BY\s+([\s\S]+?)(?:\s+LIMIT|;|$)/i);
  if (!orderMatch) {
    return orderBy;
  }

  const parts = orderMatch[1].split(',');
  for (const part of parts) {
    const trimmed = part.trim();

    // Match column with optional direction
    const match = trimmed.match(/^(.+?)(?:\s+(ASC|DESC))?$/i);
    if (match) {
      orderBy.push({
        column: match[1].trim(),
        direction: (match[2]?.toUpperCase() as 'ASC' | 'DESC') || 'ASC',
      });
    }
  }

  return orderBy;
}

/**
 * Parse LIMIT and OFFSET
 */
function parseLimitOffset(sql: string): { limit: number | null; offset: number | null } {
  let limit: number | null = null;
  let offset: number | null = null;

  // Try LIMIT n OFFSET m
  const limitOffsetMatch = sql.match(/LIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i);
  if (limitOffsetMatch) {
    limit = parseInt(limitOffsetMatch[1], 10);
    offset = parseInt(limitOffsetMatch[2], 10);
    return { limit, offset };
  }

  // Try LIMIT m, n
  const limitCommaMatch = sql.match(/LIMIT\s+(\d+)\s*,\s*(\d+)/i);
  if (limitCommaMatch) {
    offset = parseInt(limitCommaMatch[1], 10);
    limit = parseInt(limitCommaMatch[2], 10);
    return { limit, offset };
  }

  // Try simple LIMIT
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  if (limitMatch) {
    limit = parseInt(limitMatch[1], 10);
  }

  return { limit, offset };
}

/**
 * Parse a value string
 */
function parseValue(val: string): unknown {
  const trimmed = val.trim();

  // String literal
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }

  // Number
  const num = Number(trimmed);
  if (!isNaN(num)) {
    return num;
  }

  // Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

/**
 * Split by comma, respecting parentheses
 */
function splitByComma(str: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of str) {
    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current);
  }

  return result;
}

// ============================================================================
// Query Executor
// ============================================================================

/**
 * Options for creating the ClickBench executor
 */
export interface ClickBenchExecutorOptions {
  /**
   * Optional SQL executor for real WASM execution.
   * When provided, queries are delegated to the real ClickHouse WASM engine.
   * When not provided, uses mock data generation (legacy behavior).
   */
  sqlExecutor?: SqlExecutor;

  /**
   * When true, always use the real WASM executor and throw if queries fail.
   * When false (default), fall back to mock data on executor errors.
   */
  useRealExecutorOnly?: boolean;
}

/**
 * ClickBench query executor
 */
export class ClickBenchExecutor {
  private loader: MergeTreeLoader;
  private _storage: VFSStorageProvider;
  private parts: PartInfo[] = [];
  private sqlExecutor: SqlExecutor | null;
  private useRealExecutorOnly: boolean;

  constructor(loader: MergeTreeLoader, storage: VFSStorageProvider, options?: ClickBenchExecutorOptions) {
    this.loader = loader;
    this._storage = storage;
    this.sqlExecutor = options?.sqlExecutor ?? null;
    this.useRealExecutorOnly = options?.useRealExecutorOnly ?? false;
    void this._storage; // Intentionally unused - reserved for future storage operations
  }

  /**
   * Set the SQL executor for real WASM execution
   */
  setSqlExecutor(executor: SqlExecutor | null): void {
    this.sqlExecutor = executor;
  }

  /**
   * Register a part for querying
   */
  registerPart(part: PartInfo): void {
    this.parts.push(part);
  }

  /**
   * Clear registered parts
   */
  clearParts(): void {
    this.parts = [];
  }

  /**
   * Execute a SQL query
   *
   * When a SqlExecutor is configured, delegates to the real WASM ClickHouse engine.
   * Otherwise, falls back to JavaScript-based mock data processing.
   */
  async execute(sql: string): Promise<QueryResult> {
    const startTime = performance.now();

    // If we have a real SQL executor, use it
    if (this.sqlExecutor) {
      try {
        const result = await this.executeWithRealWasm(sql, startTime);
        return result;
      } catch (error) {
        // If useRealExecutorOnly is true, propagate the error
        if (this.useRealExecutorOnly) {
          throw error;
        }
        // Otherwise, return the error as part of the result so the caller sees the real ClickHouse error
        const elapsedMs = performance.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Return result with error information - this surfaces REAL ClickHouse errors
        return {
          data: [],
          meta: [],
          rows: 0,
          rowsBeforeLimit: 0,
          elapsedMs,
          query: sql,
          warnings: [`WASM execution failed: ${errorMessage}`],
        };
      }
    }

    // Fall back to mock data processing (legacy behavior)
    return this.executeWithMockData(sql, startTime);
  }

  /**
   * Execute a query using the real WASM SQL executor
   */
  private async executeWithRealWasm(sql: string, startTime: number): Promise<QueryResult> {
    const result = await this.sqlExecutor!.execute(sql);
    const elapsedMs = performance.now() - startTime;

    // Convert from SqlExecutor result format to QueryResult format
    return {
      data: result.data as ResultRow[],
      meta: result.meta,
      rows: result.rows,
      rowsBeforeLimit: result.rows,
      elapsedMs,
      query: sql,
    };
  }

  /**
   * Execute a query using mock data (legacy JavaScript implementation)
   */
  private async executeWithMockData(sql: string, startTime: number): Promise<QueryResult> {
    const warnings: string[] = [];

    // Parse the query
    const parsed = parseQuery(sql);

    // Validate table
    if (parsed.table.toLowerCase() !== 'hits') {
      throw new Error(`Unknown table: ${parsed.table}`);
    }

    // Determine columns to read
    const columnsToRead = this.getColumnsToRead(parsed);

    // Read data from all parts
    let allRows: ResultRow[] = [];
    let totalRowsProcessed = 0;

    for (const part of this.parts) {
      const { rows, rowCount } = await this.readPart(part, columnsToRead, parsed.where);
      allRows = allRows.concat(rows);
      totalRowsProcessed += rowCount;
    }

    void totalRowsProcessed; // Used for future row count reporting

    // Apply aggregations or grouping
    let resultRows: ResultRow[];
    if (parsed.aggregates.length > 0 || parsed.groupBy.length > 0) {
      resultRows = this.aggregate(allRows, parsed);
    } else {
      resultRows = allRows;
    }

    // Apply ORDER BY
    if (parsed.orderBy.length > 0) {
      resultRows = this.sortRows(resultRows, parsed.orderBy);
    }

    // Apply OFFSET and LIMIT
    const rowsBeforeLimit = resultRows.length;
    if (parsed.offset !== null) {
      resultRows = resultRows.slice(parsed.offset);
    }
    if (parsed.limit !== null) {
      resultRows = resultRows.slice(0, parsed.limit);
    }

    // Build metadata
    const meta = this.buildMeta(parsed);

    const elapsedMs = performance.now() - startTime;

    return {
      data: resultRows,
      meta,
      rows: resultRows.length,
      rowsBeforeLimit,
      elapsedMs,
      query: sql,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Get columns that need to be read from storage
   */
  private getColumnsToRead(parsed: ParsedQuery): string[] {
    const columns = new Set<string>();

    // Add SELECT columns
    for (const col of parsed.columns) {
      const colDef = getColumn(col);
      if (colDef) {
        columns.add(colDef.name);
      }
    }

    // Add aggregate columns
    for (const agg of parsed.aggregates) {
      if (agg.column !== '*') {
        const colDef = getColumn(agg.column);
        if (colDef) {
          columns.add(colDef.name);
        }
      }
    }

    // Add WHERE columns
    for (const cond of parsed.where) {
      const colDef = getColumn(cond.column);
      if (colDef) {
        columns.add(colDef.name);
      }
    }

    // Add GROUP BY columns
    for (const col of parsed.groupBy) {
      const colDef = getColumn(col);
      if (colDef) {
        columns.add(colDef.name);
      }
    }

    // Add ORDER BY columns
    for (const { column } of parsed.orderBy) {
      // Handle aggregate references
      const colDef = getColumn(column);
      if (colDef) {
        columns.add(colDef.name);
      }
    }

    // If SELECT *, add all columns
    if (parsed.isSelectAll) {
      for (const col of HITS_COLUMNS) {
        columns.add(col.name);
      }
    }

    return Array.from(columns);
  }

  /**
   * Read data from a part
   */
  private async readPart(
    part: PartInfo,
    columns: string[],
    conditions: ParsedCondition[]
  ): Promise<{ rows: ResultRow[]; rowCount: number }> {
    let reader: MergeTreePartReader | null = null;

    try {
      reader = await this.loader.createReader(
        part.database,
        part.table,
        part.partition,
        part.partName
      );

      const rowCount = Number(reader.getRowCount());
      const rows: ResultRow[] = [];

      // Read column data from MergeTree part
      // TODO: Read actual column data and decode according to column type
      for (let i = 0; i < rowCount; i++) {
        const row: ResultRow = {};

        for (const colName of columns) {
          const colDef = getColumn(colName);
          if (colDef) {
            // Generate sample data based on type
            row[colName] = this.getSampleValue(colDef, i);
          }
        }

        // Apply WHERE filter
        if (this.matchesConditions(row, conditions)) {
          rows.push(row);
        }
      }

      return { rows, rowCount };
    } finally {
      if (reader) {
        reader.destroy();
      }
    }
  }

  /**
   * Generate sample value based on column type
   * TODO: Replace with real MergeTree column data reading
   */
  private getSampleValue(colDef: ColumnDefinition, rowIndex: number): unknown {
    switch (colDef.type) {
      case 'UInt8':
        return rowIndex % 256;
      case 'UInt16':
        return rowIndex % 65536;
      case 'UInt32':
        return rowIndex % 1000000;
      case 'UInt64':
        return BigInt(rowIndex);
      case 'Int8':
        return (rowIndex % 256) - 128;
      case 'Int16':
        return (rowIndex % 65536) - 32768;
      case 'Int32':
        return rowIndex - 500000;
      case 'Int64':
        return BigInt(rowIndex - 500000);
      case 'Float32':
      case 'Float64':
        return rowIndex * 1.5;
      case 'String':
        return `value_${rowIndex}`;
      case 'Date':
        return '2013-07-15';
      case 'DateTime':
        return new Date('2013-07-15T12:00:00Z');
      default:
        return null;
    }
  }

  /**
   * Check if a row matches all conditions
   */
  private matchesConditions(row: ResultRow, conditions: ParsedCondition[]): boolean {
    for (const cond of conditions) {
      if (!this.matchesCondition(row, cond)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if a row matches a single condition
   */
  private matchesCondition(row: ResultRow, cond: ParsedCondition): boolean {
    const value = row[cond.column];

    switch (cond.operator) {
      case '=':
        return value === cond.value;
      case '<>':
        return value !== cond.value;
      case '>':
        return (value as number) > (cond.value as number);
      case '<':
        return (value as number) < (cond.value as number);
      case '>=':
        return (value as number) >= (cond.value as number);
      case '<=':
        return (value as number) <= (cond.value as number);
      case 'LIKE':
        return this.matchesLike(String(value), String(cond.value));
      case 'NOT LIKE':
        return !this.matchesLike(String(value), String(cond.value));
      case 'IN':
        return (cond.value as unknown[]).includes(value);
      default:
        return true;
    }
  }

  /**
   * Match LIKE pattern
   */
  private matchesLike(value: string, pattern: string): boolean {
    // Convert SQL LIKE pattern to regex
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.') +
        '$',
      'i'
    );
    return regex.test(value);
  }

  /**
   * Perform aggregation
   */
  private aggregate(rows: ResultRow[], parsed: ParsedQuery): ResultRow[] {
    if (parsed.groupBy.length === 0) {
      // No GROUP BY - single result row
      const result: ResultRow = {};

      for (const agg of parsed.aggregates) {
        const key = agg.alias || `${agg.function}(${agg.column})`;
        result[key] = this.computeAggregate(rows, agg);
      }

      return [result];
    }

    // GROUP BY - group rows and compute aggregates per group
    const groups = new Map<string, ResultRow[]>();

    for (const row of rows) {
      const key = parsed.groupBy.map(col => String(row[col])).join('|');

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(row);
    }

    const results: ResultRow[] = [];

    groups.forEach((groupRows) => {
      const result: ResultRow = {};

      // Add GROUP BY columns
      for (const col of parsed.groupBy) {
        result[col] = groupRows[0][col];
      }

      // Add non-grouped columns
      for (const col of parsed.columns) {
        if (!parsed.groupBy.includes(col) && !col.match(/^\d+$/)) {
          result[col] = groupRows[0][col];
        }
      }

      // Compute aggregates
      for (const agg of parsed.aggregates) {
        const key = agg.alias || `${agg.function}(${agg.column})`;
        result[key] = this.computeAggregate(groupRows, agg);
      }

      results.push(result);
    });

    return results;
  }

  /**
   * Compute a single aggregate
   */
  private computeAggregate(rows: ResultRow[], agg: ParsedAggregate): unknown {
    switch (agg.function) {
      case 'COUNT':
        return rows.length;

      case 'COUNT_DISTINCT': {
        const values = new Set(rows.map(r => r[agg.column as string]));
        return values.size;
      }

      case 'SUM': {
        let sum = 0;
        for (const row of rows) {
          const val = row[agg.column as string];
          if (typeof val === 'number') {
            sum += val;
          } else if (typeof val === 'bigint') {
            sum += Number(val);
          }
        }
        return sum;
      }

      case 'AVG': {
        if (rows.length === 0) return null;
        let sum = 0;
        for (const row of rows) {
          const val = row[agg.column as string];
          if (typeof val === 'number') {
            sum += val;
          } else if (typeof val === 'bigint') {
            sum += Number(val);
          }
        }
        return sum / rows.length;
      }

      case 'MIN': {
        let min: number | null = null;
        for (const row of rows) {
          const val = row[agg.column as string];
          const num = typeof val === 'bigint' ? Number(val) : val as number;
          if (min === null || num < min) {
            min = num;
          }
        }
        return min;
      }

      case 'MAX': {
        let max: number | null = null;
        for (const row of rows) {
          const val = row[agg.column as string];
          const num = typeof val === 'bigint' ? Number(val) : val as number;
          if (max === null || num > max) {
            max = num;
          }
        }
        return max;
      }

      default:
        return null;
    }
  }

  /**
   * Sort rows by ORDER BY clause
   */
  private sortRows(
    rows: ResultRow[],
    orderBy: Array<{ column: string; direction: 'ASC' | 'DESC' }>
  ): ResultRow[] {
    return [...rows].sort((a, b) => {
      for (const { column, direction } of orderBy) {
        const aVal = a[column];
        const bVal = b[column];

        let cmp = 0;
        if (aVal === bVal) {
          cmp = 0;
        } else if (aVal === null || aVal === undefined) {
          cmp = 1;
        } else if (bVal === null || bVal === undefined) {
          cmp = -1;
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal;
        } else if (typeof aVal === 'bigint' && typeof bVal === 'bigint') {
          cmp = aVal < bVal ? -1 : 1;
        } else {
          cmp = String(aVal).localeCompare(String(bVal));
        }

        if (cmp !== 0) {
          return direction === 'DESC' ? -cmp : cmp;
        }
      }
      return 0;
    });
  }

  /**
   * Build result metadata
   */
  private buildMeta(parsed: ParsedQuery): Array<{ name: string; type: string }> {
    const meta: Array<{ name: string; type: string }> = [];

    // Add GROUP BY columns
    for (const col of parsed.groupBy) {
      const colDef = getColumn(col);
      if (colDef) {
        meta.push({ name: col, type: colDef.type });
      }
    }

    // Add SELECT columns (not in GROUP BY)
    for (const col of parsed.columns) {
      if (!parsed.groupBy.includes(col)) {
        const colDef = getColumn(col);
        if (colDef) {
          meta.push({ name: col, type: colDef.type });
        }
      }
    }

    // Add aggregates
    for (const agg of parsed.aggregates) {
      const name = agg.alias || `${agg.function}(${agg.column})`;
      let type = 'UInt64';
      if (agg.function === 'AVG') {
        type = 'Float64';
      } else if (agg.function === 'MIN' || agg.function === 'MAX') {
        const colDef = getColumn(agg.column as string);
        type = colDef?.type || 'Float64';
      }
      meta.push({ name, type });
    }

    return meta;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a ClickBench executor
 */
export function createClickBenchExecutor(
  loader: MergeTreeLoader,
  storage: VFSStorageProvider
): ClickBenchExecutor {
  return new ClickBenchExecutor(loader, storage);
}

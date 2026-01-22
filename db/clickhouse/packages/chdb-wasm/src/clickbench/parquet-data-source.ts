/**
 * Parquet Data Source for ClickBench Executor
 *
 * Provides a data source that reads ClickBench hits data from a remote Parquet file
 * using HTTP range requests. This enables running ClickBench queries against the
 * real ~100M row dataset without loading everything into memory.
 *
 * @module clickbench/parquet-data-source
 */

import { ParquetReader, type ParquetFileMetadata } from '../parquet-reader';
import type { ResultRow, QueryResult, ParsedQuery, ParsedCondition } from './executor';
import { getColumn } from './schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating the Parquet data source
 */
export interface ParquetDataSourceOptions {
  /** URL to the Parquet file */
  url: string;
  /** Custom fetch function (for testing or auth) */
  fetchFn?: typeof fetch;
  /** Maximum rows to read per query (default: 100000) */
  maxRowsPerQuery?: number;
  /** Cache metadata between queries */
  cacheMetadata?: boolean;
}

/**
 * Data source interface for ClickBench executor
 */
export interface ClickBenchDataSource {
  /** Get metadata about the data source */
  getMetadata(): Promise<ParquetFileMetadata>;
  /** Read data matching a parsed query */
  readData(query: ParsedQuery): Promise<{ rows: ResultRow[]; totalRows: number }>;
  /** Read specific columns with optional filters */
  readColumns(columns: string[], options?: ReadColumnsOptions): Promise<ResultRow[]>;
}

/**
 * Options for reading columns
 */
export interface ReadColumnsOptions {
  limit?: number;
  offset?: number;
  conditions?: ParsedCondition[];
}

// ============================================================================
// Parquet Data Source Implementation
// ============================================================================

/**
 * Data source that reads from a remote Parquet file
 *
 * @example
 * ```typescript
 * const dataSource = new ParquetDataSource({
 *   url: 'https://datasets.clickhouse.com/hits_compatible/hits.parquet',
 * });
 *
 * const metadata = await dataSource.getMetadata();
 * console.log(`Dataset has ${metadata.rowCount} rows`);
 *
 * const data = await dataSource.readColumns(['CounterID', 'UserID'], { limit: 1000 });
 * ```
 */
export class ParquetDataSource implements ClickBenchDataSource {
  private reader: ParquetReader;
  private metadata: ParquetFileMetadata | null = null;
  private maxRowsPerQuery: number;
  private cacheMetadata: boolean;

  constructor(options: ParquetDataSourceOptions) {
    this.reader = new ParquetReader(options.url, options.fetchFn);
    this.maxRowsPerQuery = options.maxRowsPerQuery ?? 100000;
    this.cacheMetadata = options.cacheMetadata ?? true;
  }

  /**
   * Get metadata about the Parquet file
   */
  async getMetadata(): Promise<ParquetFileMetadata> {
    if (this.cacheMetadata && this.metadata) {
      return this.metadata;
    }

    this.metadata = await this.reader.getMetadata();
    return this.metadata;
  }

  /**
   * Read data for a parsed query
   */
  async readData(query: ParsedQuery): Promise<{ rows: ResultRow[]; totalRows: number }> {
    // Determine columns to read based on the query
    const columnsNeeded = this.getColumnsNeededForQuery(query);

    // Calculate limit
    const limit = query.limit !== null
      ? Math.min(query.limit, this.maxRowsPerQuery)
      : this.maxRowsPerQuery;

    // Read data from Parquet
    const result = await this.reader.readColumns(columnsNeeded.length > 0 ? columnsNeeded : null, {
      limit,
      offset: query.offset ?? undefined,
    });

    // Apply WHERE filters in JavaScript (predicate pushdown not yet implemented)
    let rows = result.data as ResultRow[];
    if (query.where.length > 0) {
      rows = rows.filter(row => this.matchesConditions(row, query.where));
    }

    return {
      rows,
      totalRows: result.totalRows,
    };
  }

  /**
   * Read specific columns with optional options
   */
  async readColumns(columns: string[], options: ReadColumnsOptions = {}): Promise<ResultRow[]> {
    const result = await this.reader.readColumns(columns, {
      limit: options.limit ?? this.maxRowsPerQuery,
      offset: options.offset,
    });

    let rows = result.data as ResultRow[];

    // Apply conditions if provided
    if (options.conditions && options.conditions.length > 0) {
      rows = rows.filter(row => this.matchesConditions(row, options.conditions!));
    }

    return rows;
  }

  /**
   * Determine which columns are needed for a query
   */
  private getColumnsNeededForQuery(query: ParsedQuery): string[] {
    const columns = new Set<string>();

    // Add SELECT columns
    for (const col of query.columns) {
      const colDef = getColumn(col);
      if (colDef) {
        columns.add(colDef.name);
      }
    }

    // Add aggregate columns
    for (const agg of query.aggregates) {
      if (agg.column !== '*') {
        const colDef = getColumn(agg.column);
        if (colDef) {
          columns.add(colDef.name);
        }
      }
    }

    // Add WHERE columns
    for (const cond of query.where) {
      const colDef = getColumn(cond.column);
      if (colDef) {
        columns.add(colDef.name);
      }
    }

    // Add GROUP BY columns
    for (const col of query.groupBy) {
      const colDef = getColumn(col);
      if (colDef) {
        columns.add(colDef.name);
      }
    }

    // Add ORDER BY columns
    for (const { column } of query.orderBy) {
      const colDef = getColumn(column);
      if (colDef) {
        columns.add(colDef.name);
      }
    }

    return Array.from(columns);
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
        return value === cond.value || String(value) === String(cond.value);
      case '<>':
        return value !== cond.value && String(value) !== String(cond.value);
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
        return (cond.value as unknown[]).some(v => v === value || String(v) === String(value));
      default:
        return true;
    }
  }

  /**
   * Match LIKE pattern
   */
  private matchesLike(value: string, pattern: string): boolean {
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
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a Parquet data source for the ClickBench hits dataset
 *
 * @example
 * ```typescript
 * // Use the official ClickHouse dataset
 * const dataSource = createClickBenchParquetSource();
 *
 * // Or use a custom URL
 * const customSource = createClickBenchParquetSource({
 *   url: 'https://my-bucket.s3.amazonaws.com/hits.parquet',
 * });
 * ```
 */
export function createClickBenchParquetSource(
  options?: Partial<ParquetDataSourceOptions>
): ParquetDataSource {
  const defaultUrl = 'https://datasets.clickhouse.com/hits_compatible/hits.parquet';

  return new ParquetDataSource({
    url: options?.url ?? defaultUrl,
    fetchFn: options?.fetchFn,
    maxRowsPerQuery: options?.maxRowsPerQuery ?? 100000,
    cacheMetadata: options?.cacheMetadata ?? true,
  });
}

// ============================================================================
// ClickBench Executor Integration
// ============================================================================

/**
 * Execute a simple query against Parquet data
 *
 * This is a convenience function for running queries without setting up
 * the full ClickBench executor infrastructure.
 *
 * @example
 * ```typescript
 * const result = await executeParquetQuery(
 *   'https://datasets.clickhouse.com/hits_compatible/hits.parquet',
 *   'SELECT CounterID, COUNT(*) FROM hits GROUP BY CounterID LIMIT 10'
 * );
 * ```
 */
export async function executeParquetQuery(
  url: string,
  _sql: string,
  options?: Partial<ParquetDataSourceOptions>
): Promise<QueryResult> {
  const startTime = performance.now();
  const dataSource = new ParquetDataSource({
    url,
    ...options,
  });

  // For now, just return metadata - full SQL execution requires the executor
  const metadata = await dataSource.getMetadata();

  const elapsedMs = performance.now() - startTime;

  return {
    data: [],
    meta: metadata.schema.map(col => ({ name: col.name, type: col.type })),
    rows: 0,
    rowsBeforeLimit: metadata.rowCount,
    elapsedMs,
    query: _sql,
    warnings: ['Full SQL execution not yet implemented - use ClickBenchExecutor for queries'],
  };
}

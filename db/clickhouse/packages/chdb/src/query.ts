/**
 * Core query methods for @dotdo/chdb
 *
 * Provides reusable query execution functions that can work with any
 * query executor implementing the QueryExecutor interface.
 */

import type { QueryOptions } from './types';
import { QueryError } from './types';

/**
 * Interface for query executors
 * Any backend can implement this interface to use the query functions
 */
export interface QueryExecutor {
  /**
   * Execute a SQL query and return the raw result
   */
  execute(sql: string, options?: QueryOptions): Promise<string>;

  /**
   * Execute a SQL query and return results as an async iterable of chunks
   */
  executeStream(sql: string, options?: QueryOptions): AsyncIterable<string>;
}

/**
 * Supported parseable formats
 */
type ParseableFormat = 'JSON' | 'JSONEachRow' | 'JSONCompact' | 'JSONColumns';

/**
 * Check if a format is parseable to typed data
 */
function isParseableFormat(format: string): format is ParseableFormat {
  return ['JSON', 'JSONEachRow', 'JSONCompact', 'JSONColumns'].includes(format);
}

/**
 * Parse JSON format result from ClickHouse
 * JSON format: { "data": [...], "meta": [...], "statistics": {...} }
 */
function parseJsonFormat<T>(result: string): T[] {
  if (!result.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result);

    // Standard ClickHouse JSON format with metadata
    if (parsed.data !== undefined && Array.isArray(parsed.data)) {
      return parsed.data as T[];
    }

    // Plain array result
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }

    // Single object result
    return [parsed as T];
  } catch (error) {
    throw new QueryError(
      `Failed to parse JSON result: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Parse JSONEachRow format (newline-delimited JSON)
 */
function parseJsonEachRowFormat<T>(result: string): T[] {
  if (!result.trim()) {
    return [];
  }

  const lines = result.trim().split('\n');
  const results: T[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        results.push(JSON.parse(trimmed) as T);
      } catch (error) {
        throw new QueryError(
          `Failed to parse JSONEachRow line: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  }

  return results;
}

/**
 * Parse JSONCompact format
 * JSONCompact format: { "data": [[...], [...]], "meta": [...] }
 */
function parseJsonCompactFormat<T>(result: string): T[] {
  if (!result.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result);

    if (!parsed.data || !Array.isArray(parsed.data)) {
      return [];
    }

    // JSONCompact returns arrays, need to convert to objects using meta
    if (parsed.meta && Array.isArray(parsed.meta)) {
      const columnNames = parsed.meta.map((m: { name: string }) => m.name);
      return parsed.data.map((row: unknown[]) => {
        const obj: Record<string, unknown> = {};
        columnNames.forEach((name: string, index: number) => {
          obj[name] = row[index];
        });
        return obj as T;
      });
    }

    // If no meta, return as-is (arrays)
    return parsed.data as T[];
  } catch (error) {
    throw new QueryError(
      `Failed to parse JSONCompact result: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Parse JSONColumns format
 * JSONColumns format: { "column1": [...], "column2": [...] }
 */
function parseJsonColumnsFormat<T>(result: string): T[] {
  if (!result.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result);

    // JSONColumns returns columns as arrays
    const columns = Object.keys(parsed);
    if (columns.length === 0) {
      return [];
    }

    const rowCount = Array.isArray(parsed[columns[0]]) ? parsed[columns[0]].length : 0;
    const results: T[] = [];

    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        row[col] = parsed[col][i];
      }
      results.push(row as T);
    }

    return results;
  } catch (error) {
    throw new QueryError(
      `Failed to parse JSONColumns result: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Execute a query and return parsed results
 *
 * @param executor - The query executor to use
 * @param sql - SQL query string
 * @param options - Query options including format
 * @returns Promise resolving to an array of typed results
 *
 * @example
 * ```typescript
 * interface User {
 *   id: number;
 *   name: string;
 * }
 *
 * const users = await query<User>(executor, 'SELECT id, name FROM users');
 * console.log(users[0].name);
 * ```
 */
export async function query<T = Record<string, unknown>>(
  executor: QueryExecutor,
  sql: string,
  options?: QueryOptions
): Promise<T[]> {
  const format = options?.format || 'JSON';
  const result = await executor.execute(sql, { ...options, format });

  // Parse based on format
  switch (format) {
    case 'JSON':
      return parseJsonFormat<T>(result);

    case 'JSONEachRow':
      return parseJsonEachRowFormat<T>(result);

    case 'JSONCompact':
      return parseJsonCompactFormat<T>(result);

    case 'JSONColumns':
      return parseJsonColumnsFormat<T>(result);

    default:
      if (!isParseableFormat(format)) {
        throw new QueryError(
          `Cannot parse format: ${format}. Use queryRaw() for non-JSON formats.`
        );
      }
      throw new QueryError(`Unsupported format: ${format}`);
  }
}

/**
 * Execute a query and return the raw string result
 *
 * @param executor - The query executor to use
 * @param sql - SQL query string
 * @param options - Query options
 * @returns Promise resolving to the raw query result string
 *
 * @example
 * ```typescript
 * const csv = await queryRaw(executor, 'SELECT * FROM users', { format: 'CSV' });
 * console.log(csv); // Raw CSV output
 * ```
 */
export async function queryRaw(
  executor: QueryExecutor,
  sql: string,
  options?: QueryOptions
): Promise<string> {
  return executor.execute(sql, options);
}

/**
 * Options for streaming queries
 */
export interface StreamOptions extends QueryOptions {
  /**
   * High water mark for backpressure (number of pending batches)
   * When this many batches are pending, the stream will pause reading
   * Default: 16
   */
  highWaterMark?: number;

  /**
   * Batch size hint (number of rows per batch)
   * This is a hint and actual batches may be larger or smaller
   * Default: 1000
   */
  batchSizeHint?: number;
}

/**
 * Execute a streaming query and yield batches of parsed results
 *
 * This function implements proper backpressure handling - if the consumer
 * processes batches slowly, the generator will naturally pause reading
 * from the upstream source.
 *
 * @param executor - The query executor to use
 * @param sql - SQL query string
 * @param options - Query options including streaming configuration
 * @yields Arrays of typed results (batches)
 *
 * @example
 * ```typescript
 * interface LogEntry {
 *   timestamp: string;
 *   message: string;
 * }
 *
 * // Process large result sets efficiently with backpressure
 * for await (const batch of queryStream<LogEntry>(executor, 'SELECT * FROM logs')) {
 *   for (const entry of batch) {
 *     await processLogEntry(entry); // Slow processing won't overwhelm memory
 *   }
 * }
 * ```
 */
export async function* queryStream<T = Record<string, unknown>>(
  executor: QueryExecutor,
  sql: string,
  options?: StreamOptions
): AsyncGenerator<T[], void, undefined> {
  // JSONEachRow is ideal for streaming as each line is a complete JSON object
  const format = options?.format || 'JSONEachRow';
  const batchSizeHint = options?.batchSizeHint ?? 1000;

  // Validate format
  if (format !== 'JSONEachRow' && format !== 'JSON') {
    throw new QueryError(
      `Streaming only supports JSONEachRow and JSON formats. Got: ${format}`
    );
  }

  // Buffer for incomplete lines
  let buffer = '';
  let lineCount = 0;
  let pendingBatch: T[] = [];

  try {
    for await (const chunk of executor.executeStream(sql, { ...options, format })) {
      // Append chunk to buffer
      buffer += chunk;

      // Parse complete lines from buffer
      const lines = buffer.split('\n');

      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const parsed = JSON.parse(trimmed) as T;
          pendingBatch.push(parsed);
          lineCount++;

          // Yield batch when it reaches the size hint
          // This provides natural backpressure - if the consumer is slow,
          // we won't read more from the executor until the yield completes
          if (pendingBatch.length >= batchSizeHint) {
            yield pendingBatch;
            pendingBatch = [];
          }
        } catch (error) {
          throw new QueryError(
            `Failed to parse streaming JSON at line ${lineCount + 1}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      }
    }

    // Flush remaining buffer content
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim()) as T;
        pendingBatch.push(parsed);
      } catch (error) {
        throw new QueryError(
          `Failed to parse final streaming JSON: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    }

    // Yield any remaining items
    if (pendingBatch.length > 0) {
      yield pendingBatch;
    }
  } catch (error) {
    // Re-throw QueryError as-is
    if (error instanceof QueryError) {
      throw error;
    }
    // Wrap other errors
    throw new QueryError(
      `Streaming query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Execute a streaming query with single-row iteration
 *
 * This is a convenience wrapper around queryStream that yields individual
 * rows instead of batches, simplifying consumption for most use cases.
 *
 * @param executor - The query executor to use
 * @param sql - SQL query string
 * @param options - Query options
 * @yields Individual typed results
 *
 * @example
 * ```typescript
 * for await (const user of queryStreamRows<User>(executor, 'SELECT * FROM users')) {
 *   console.log(user.name);
 * }
 * ```
 */
export async function* queryStreamRows<T = Record<string, unknown>>(
  executor: QueryExecutor,
  sql: string,
  options?: StreamOptions
): AsyncGenerator<T, void, undefined> {
  for await (const batch of queryStream<T>(executor, sql, options)) {
    for (const row of batch) {
      yield row;
    }
  }
}

/**
 * Execute a query and return the first result or null
 *
 * @param executor - The query executor to use
 * @param sql - SQL query string
 * @param options - Query options
 * @returns Promise resolving to the first result or null if no results
 *
 * @example
 * ```typescript
 * const user = await queryOne<User>(executor, 'SELECT * FROM users WHERE id = 1');
 * if (user) {
 *   console.log(user.name);
 * }
 * ```
 */
export async function queryOne<T = Record<string, unknown>>(
  executor: QueryExecutor,
  sql: string,
  options?: QueryOptions
): Promise<T | null> {
  const results = await query<T>(executor, sql, options);
  return results.length > 0 ? results[0] : null;
}

/**
 * Execute a query and return the first result or throw if no results
 *
 * @param executor - The query executor to use
 * @param sql - SQL query string
 * @param options - Query options
 * @returns Promise resolving to the first result
 * @throws QueryError if no results are returned
 *
 * @example
 * ```typescript
 * try {
 *   const user = await queryOneOrThrow<User>(executor, 'SELECT * FROM users WHERE id = 1');
 *   console.log(user.name);
 * } catch (error) {
 *   console.log('User not found');
 * }
 * ```
 */
export async function queryOneOrThrow<T = Record<string, unknown>>(
  executor: QueryExecutor,
  sql: string,
  options?: QueryOptions
): Promise<T> {
  const result = await queryOne<T>(executor, sql, options);
  if (result === null) {
    throw new QueryError('Query returned no results');
  }
  return result;
}

/**
 * Execute a query expecting exactly one result
 *
 * @param executor - The query executor to use
 * @param sql - SQL query string
 * @param options - Query options
 * @returns Promise resolving to the single result
 * @throws QueryError if zero or more than one result is returned
 *
 * @example
 * ```typescript
 * const count = await querySingle<{ count: number }>(
 *   executor,
 *   'SELECT count() as count FROM users'
 * );
 * console.log(count.count);
 * ```
 */
export async function querySingle<T = Record<string, unknown>>(
  executor: QueryExecutor,
  sql: string,
  options?: QueryOptions
): Promise<T> {
  const results = await query<T>(executor, sql, options);

  if (results.length === 0) {
    throw new QueryError('Query returned no results, expected exactly one');
  }

  if (results.length > 1) {
    throw new QueryError(`Query returned ${results.length} results, expected exactly one`);
  }

  return results[0];
}

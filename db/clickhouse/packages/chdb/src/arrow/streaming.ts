/**
 * Arrow IPC streaming utilities for @dotdo/chdb
 *
 * Provides efficient streaming support for Apache Arrow IPC format,
 * enabling memory-constrained environments to process large result sets
 * without loading everything into memory at once.
 */

import * as Arrow from 'apache-arrow';

/**
 * Options for Arrow streaming operations
 */
export interface ArrowStreamOptions {
  /** Maximum batch size for streaming (defaults to Arrow's natural batching) */
  maxBatchSize?: number;
}

/**
 * Schema information extracted from Arrow data
 */
export interface ArrowSchemaInfo {
  /** Field names in the schema */
  fieldNames: string[];
  /** Field types as Arrow type IDs */
  fieldTypes: Arrow.Type[];
  /** Full Arrow schema object */
  schema: Arrow.Schema;
}

/**
 * Stream Arrow record batches from Arrow IPC data
 *
 * This is the most memory-efficient way to process large Arrow datasets
 * as it yields batches one at a time without accumulating all data in memory.
 *
 * @param arrowData - Arrow IPC stream data as Uint8Array
 * @yields Record batches as they are read from the stream
 *
 * @example
 * ```typescript
 * const arrowData = await client.queryRaw('SELECT * FROM large_table', { format: 'Arrow' });
 *
 * for await (const batch of streamArrowBatches(new Uint8Array(arrowData))) {
 *   console.log(`Processing batch with ${batch.numRows} rows`);
 *   // Process batch...
 * }
 * ```
 */
export async function* streamArrowBatches(
  arrowData: Uint8Array
): AsyncGenerator<Arrow.RecordBatch> {
  const reader = await Arrow.RecordBatchStreamReader.from(arrowData);

  for await (const batch of reader) {
    yield batch;
  }
}

/**
 * Convert Arrow IPC data to a JSON array
 *
 * Reads all Arrow data and converts it to an array of JavaScript objects.
 * Best for smaller result sets where you need the full data in memory.
 *
 * @param arrowData - Arrow IPC stream data as Uint8Array
 * @returns Promise resolving to an array of row objects
 *
 * @example
 * ```typescript
 * interface User {
 *   id: number;
 *   name: string;
 *   email: string;
 * }
 *
 * const arrowData = await client.queryRaw('SELECT * FROM users', { format: 'Arrow' });
 * const users = await arrowToJson<User>(new Uint8Array(arrowData));
 * console.log(users[0].name);
 * ```
 */
export async function arrowToJson<T = Record<string, unknown>>(
  arrowData: Uint8Array
): Promise<T[]> {
  const reader = await Arrow.RecordBatchStreamReader.from(arrowData);
  const table = await reader.readAll();
  return table.toArray() as T[];
}

/**
 * Stream Arrow data as individual JSON rows
 *
 * Memory-efficient streaming that yields one row at a time as JavaScript objects.
 * Ideal for processing large datasets row by row without accumulating in memory.
 *
 * @param arrowData - Arrow IPC stream data as Uint8Array
 * @yields Individual row objects as they are decoded
 *
 * @example
 * ```typescript
 * interface LogEntry {
 *   timestamp: Date;
 *   level: string;
 *   message: string;
 * }
 *
 * const arrowData = await client.queryRaw('SELECT * FROM logs', { format: 'Arrow' });
 *
 * for await (const log of arrowToJsonStream<LogEntry>(new Uint8Array(arrowData))) {
 *   if (log.level === 'ERROR') {
 *     await alertOnError(log);
 *   }
 * }
 * ```
 */
export async function* arrowToJsonStream<T = Record<string, unknown>>(
  arrowData: Uint8Array
): AsyncGenerator<T> {
  for await (const batch of streamArrowBatches(arrowData)) {
    for (const row of batch.toArray()) {
      yield row as T;
    }
  }
}

/**
 * Extract schema information from Arrow IPC data
 *
 * Reads only the schema from Arrow data without processing all the data,
 * useful for introspection and validation before processing.
 *
 * @param arrowData - Arrow IPC stream data as Uint8Array
 * @returns Promise resolving to schema information
 *
 * @example
 * ```typescript
 * const arrowData = await client.queryRaw('SELECT * FROM users', { format: 'Arrow' });
 * const schemaInfo = await extractArrowSchema(new Uint8Array(arrowData));
 *
 * console.log('Fields:', schemaInfo.fieldNames);
 * // ['id', 'name', 'email', 'created_at']
 * ```
 */
export async function extractArrowSchema(
  arrowData: Uint8Array
): Promise<ArrowSchemaInfo> {
  const reader = await Arrow.RecordBatchStreamReader.from(arrowData);
  const schema = reader.schema;

  return {
    fieldNames: schema.fields.map(f => f.name),
    fieldTypes: schema.fields.map(f => f.typeId),
    schema,
  };
}

/**
 * Convert Arrow IPC data to an Arrow Table
 *
 * Reads all data into an Arrow Table for further processing with Arrow APIs.
 * Useful when you need to perform Arrow-native operations like filtering,
 * slicing, or vector operations.
 *
 * @param arrowData - Arrow IPC stream data as Uint8Array
 * @returns Promise resolving to an Arrow Table
 *
 * @example
 * ```typescript
 * const arrowData = await client.queryRaw('SELECT * FROM metrics', { format: 'Arrow' });
 * const table = await arrowToTable(new Uint8Array(arrowData));
 *
 * console.log(`Table has ${table.numRows} rows and ${table.numCols} columns`);
 * const idColumn = table.getChild('id');
 * ```
 */
export async function arrowToTable(
  arrowData: Uint8Array
): Promise<Arrow.Table> {
  const reader = await Arrow.RecordBatchStreamReader.from(arrowData);
  return reader.readAll();
}

/**
 * Count rows in Arrow IPC data without fully materializing
 *
 * Streams through the data counting rows without building the full dataset,
 * useful for getting counts on large datasets efficiently.
 *
 * @param arrowData - Arrow IPC stream data as Uint8Array
 * @returns Promise resolving to the total row count
 *
 * @example
 * ```typescript
 * const arrowData = await client.queryRaw('SELECT * FROM events', { format: 'Arrow' });
 * const count = await countArrowRows(new Uint8Array(arrowData));
 * console.log(`Total rows: ${count}`);
 * ```
 */
export async function countArrowRows(
  arrowData: Uint8Array
): Promise<number> {
  let count = 0;
  for await (const batch of streamArrowBatches(arrowData)) {
    count += batch.numRows;
  }
  return count;
}

/**
 * Stream Arrow data with batch information
 *
 * Similar to streamArrowBatches but includes metadata about each batch,
 * useful for progress reporting and debugging.
 *
 * @param arrowData - Arrow IPC stream data as Uint8Array
 * @yields Objects containing batch data and metadata
 *
 * @example
 * ```typescript
 * const arrowData = await client.queryRaw('SELECT * FROM data', { format: 'Arrow' });
 *
 * for await (const { batch, batchIndex, rowCount } of streamArrowBatchesWithInfo(new Uint8Array(arrowData))) {
 *   console.log(`Batch ${batchIndex}: ${rowCount} rows`);
 *   // Process batch...
 * }
 * ```
 */
export async function* streamArrowBatchesWithInfo(
  arrowData: Uint8Array
): AsyncGenerator<{
  batch: Arrow.RecordBatch;
  batchIndex: number;
  rowCount: number;
}> {
  let batchIndex = 0;
  for await (const batch of streamArrowBatches(arrowData)) {
    yield {
      batch,
      batchIndex,
      rowCount: batch.numRows,
    };
    batchIndex++;
  }
}

/**
 * Stream slices of Arrow data
 *
 * Streams rows with offset and limit support, useful for pagination
 * or processing specific ranges of data.
 *
 * @param arrowData - Arrow IPC stream data as Uint8Array
 * @param offset - Number of rows to skip from the beginning
 * @param limit - Maximum number of rows to yield (undefined for no limit)
 * @yields Row objects within the specified range
 *
 * @example
 * ```typescript
 * const arrowData = await client.queryRaw('SELECT * FROM users ORDER BY id', { format: 'Arrow' });
 *
 * // Get rows 100-199 (page 2 with page size 100)
 * const page2 = [];
 * for await (const row of streamArrowSlice(new Uint8Array(arrowData), 100, 100)) {
 *   page2.push(row);
 * }
 * ```
 */
export async function* streamArrowSlice<T = Record<string, unknown>>(
  arrowData: Uint8Array,
  offset: number = 0,
  limit?: number
): AsyncGenerator<T> {
  let rowIndex = 0;
  let yieldedCount = 0;

  for await (const batch of streamArrowBatches(arrowData)) {
    const batchRows = batch.toArray();

    for (const row of batchRows) {
      if (rowIndex >= offset) {
        if (limit !== undefined && yieldedCount >= limit) {
          return;
        }
        yield row as T;
        yieldedCount++;
      }
      rowIndex++;
    }
  }
}

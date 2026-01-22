/**
 * Arrow IPC streaming module for @dotdo/chdb
 *
 * Provides utilities for working with Apache Arrow IPC format,
 * enabling efficient streaming and conversion of query results.
 */

// Core streaming utilities
export {
  streamArrowBatches,
  arrowToJson,
  arrowToJsonStream,
  extractArrowSchema,
  arrowToTable,
  countArrowRows,
  streamArrowBatchesWithInfo,
  streamArrowSlice,
} from './streaming';

// Type exports
export type { ArrowStreamOptions, ArrowSchemaInfo } from './streaming';

// Re-export commonly used Arrow types for convenience
export type {
  RecordBatch,
  Table,
  Schema,
  Field,
  DataType,
  Type,
} from 'apache-arrow';

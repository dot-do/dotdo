/**
 * CLI Types Index
 *
 * Central export point for all CLI type definitions.
 * Import types from this module for convenience:
 *
 * ```ts
 * import type { EvaluateResult, LogEntry } from './types/index.js'
 * ```
 *
 * @module types
 */

// Evaluation types
export {
  // Core types
  type LogLevel,
  type LogEntry,
  type EvaluateResult,
  type EvaluateError,
  type EvaluateErrorCode,

  // Streaming types
  type StreamingEvaluation,
  type LogCallback,

  // Configuration types
  type EvaluateOptions,
  type EvaluateWithSdkOptions,
  DEFAULT_EVAL_TIMEOUT,

  // REPL types
  type ReplOptions,
  type ReplResult,
  type Repl,
  type EvaluateFn,

  // Output types
  type OutputType,
  LOG_LEVEL_TO_OUTPUT_TYPE,

  // Error utilities
  createEvaluateError,
  classifyError,
} from './evaluate.js'

// Generator types (for TypeScript definition generation)
export type { TypeGeneratorOptions } from './generator.js'
export { generateTypesFromSchema } from './generator.js'

/**
 * Evalite Custom Storage Adapter
 *
 * Sends eval results to the /e events pipeline, converting eval traces to 5W+H events.
 *
 * Reference: https://v1.evalite.dev/api/storage#implementing-custom-storage
 *
 * TODO: Implement this module to pass the tests in evals/tests/storage.test.ts
 */

// ============================================================================
// Types
// ============================================================================

export interface EvaliteStorageOptions {
  endpoint: string
  fetch?: typeof fetch
  ns?: string
  actor?: string
  authorization?: string
  defaultModel?: string
  batchSize?: number
  flushInterval?: number
  retryAttempts?: number
  queueOffline?: boolean
}

export interface ConvertOptions {
  ns: string
  actor: string
  model?: string
  scores?: Array<{ id: string; evalId: string; name: string; score: number; reason?: string }>
}

// ============================================================================
// Stub Exports - These need to be implemented
// ============================================================================

/**
 * Creates an evalite storage adapter that sends events to the /e endpoint.
 *
 * @throws {Error} Not implemented - this is a stub for RED phase testing
 */
export function createEvaliteStorage(_options: EvaliteStorageOptions): never {
  throw new Error('Not implemented: createEvaliteStorage must be implemented to pass tests')
}

/**
 * Converts an eval result to a 5W+H Event format.
 *
 * @throws {Error} Not implemented - this is a stub for RED phase testing
 */
export function convertEvalToEvent(_eval: unknown, _options: ConvertOptions): never {
  throw new Error('Not implemented: convertEvalToEvent must be implemented to pass tests')
}

/**
 * Converts a trace to a 5W+H Event format.
 *
 * @throws {Error} Not implemented - this is a stub for RED phase testing
 */
export function convertTraceToEvent(_trace: unknown, _options: ConvertOptions): never {
  throw new Error('Not implemented: convertTraceToEvent must be implemented to pass tests')
}

/**
 * EvaliteStorage class implementing the Storage interface.
 * This is exported as a type alias for the implementation.
 */
export type EvaliteStorage = ReturnType<typeof createEvaliteStorage>

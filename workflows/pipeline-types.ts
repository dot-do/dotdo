/**
 * Pipeline Types - Shared type definitions for pipeline expressions
 *
 * This module exists to break circular dependencies between:
 * - workflows/pipeline-promise.ts
 * - workflows/analyzer.ts
 *
 * By extracting shared types and helper functions here, both modules
 * can import from this shared file without creating import cycles.
 */

// ============================================================================
// Types
// ============================================================================

export type PipelineExpression =
  | { type: 'call'; domain: string; method: string[]; context: unknown; args: unknown[] }
  | { type: 'property'; base: PipelineExpression; property: string }
  | { type: 'map'; array: PipelineExpression; mapper: MapperInstruction[] }
  | { type: 'conditional'; condition: PipelineExpression; thenBranch: PipelineExpression; elseBranch: PipelineExpression | null }
  | { type: 'branch'; value: PipelineExpression; cases: Record<string, PipelineExpression> }
  | { type: 'match'; value: PipelineExpression; patterns: Array<{ predicateSource: string; result: PipelineExpression }> }
  | { type: 'waitFor'; eventName: string; options: { timeout?: string; type?: string } }
  | { type: 'literal'; value: unknown }
  | { type: 'placeholder'; path: string[] }

export interface MapperInstruction {
  operation: 'call' | 'property'
  path: string[]
  inputPaths: string[][]
}

export interface PipelinePromise<T = unknown> extends PromiseLike<T> {
  readonly __expr: PipelineExpression
  readonly __isPipelinePromise: true
  [key: string]: any
}

export interface WorkflowProxyOptions {
  /** Called when a PipelinePromise is awaited */
  execute?: (expr: PipelineExpression) => Promise<unknown>
  /** Called when any domain method is called (for testing) */
  onExecute?: (expr: PipelineExpression) => void
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a PipelinePromise
 */
export function isPipelinePromise(value: unknown): value is PipelinePromise {
  return value !== null && typeof value === 'object' && '__isPipelinePromise' in value && (value as any).__isPipelinePromise === true
}

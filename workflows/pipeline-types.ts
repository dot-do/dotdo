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
  [key: string]: unknown
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
  return value !== null && typeof value === 'object' && '__isPipelinePromise' in value && (value as { __isPipelinePromise?: boolean }).__isPipelinePromise === true
}

// ============================================================================
// Analysis Types (shared between pipeline-promise.ts and analyzer.ts)
// ============================================================================

/**
 * Full analysis result with dependency graph and execution order
 */
export interface AnalysisResult {
  /** All expressions that were analyzed */
  expressions: PipelineExpression[]
  /** Map of each expression to the set of expressions it depends on */
  dependencies: Map<PipelineExpression, Set<PipelineExpression>>
  /** Groups of expressions that can run in parallel, in execution order */
  executionOrder: PipelineExpression[][]
}

/**
 * Simple analysis result for basic independent/dependent classification
 */
export interface SimpleAnalysisResult {
  /** Expressions with no dependencies on other analyzed expressions */
  independent: PipelinePromise[]
  /** Expressions that depend on at least one other analyzed expression */
  dependent: PipelinePromise[]
}

/**
 * PipelinePromise - Capnweb-style Lazy Execution
 *
 * Enables no-await workflows by capturing operations as expressions
 * that can be analyzed and batched before execution.
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
// Core Implementation
// ============================================================================

const PIPELINE_PROMISE_MARKER = Symbol.for('__isPipelinePromise')

/**
 * Type guard to check if a value is a PipelinePromise
 */
export function isPipelinePromise(value: unknown): value is PipelinePromise {
  return value !== null && typeof value === 'object' && '__isPipelinePromise' in value && (value as any).__isPipelinePromise === true
}

/**
 * Creates a PipelinePromise that captures an expression without executing it.
 * The promise is both a Thenable (can be awaited) and a Proxy (property access works).
 */
export function createPipelinePromise<T = unknown>(expr: PipelineExpression, options: WorkflowProxyOptions): PipelinePromise<T> {
  const defaultExecute = async (e: PipelineExpression): Promise<unknown> => {
    throw new Error('No execute function provided - cannot resolve pipeline')
  }

  const execute = options.execute ?? defaultExecute

  // Create the base promise object with thenable interface
  const promiseBase = {
    __expr: expr,
    __isPipelinePromise: true as const,

    then<TResult1 = T, TResult2 = never>(
      onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): PipelinePromise<TResult1 | TResult2> {
      // When awaited, trigger execution
      const resultPromise = execute(expr).then(onFulfilled as any, onRejected)

      // Wrap the result in a PipelinePromise for chaining
      // This creates a "resolved" pipeline promise
      return createResolvedPipelinePromise(resultPromise, options)
    },

    catch<TResult = never>(onRejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): PipelinePromise<T | TResult> {
      return this.then(undefined, onRejected) as PipelinePromise<T | TResult>
    },

    // Map support for magic map (record-replay)
    map<U>(callback: (item: any, index?: number) => PipelinePromise<U>): PipelinePromise<U[]> {
      // Create a placeholder to record operations
      const placeholder = createPlaceholderProxy([], options)

      // Record phase: execute callback once with placeholder
      const recordedResult = callback(placeholder, 0)

      // Capture mapper instructions from the recorded result
      const mapper = extractMapperInstructions(recordedResult, placeholder)

      const mapExpr: PipelineExpression = {
        type: 'map',
        array: expr,
        mapper,
      }

      return createPipelinePromise<U[]>(mapExpr, options)
    },
  }

  // Wrap in Proxy for property access
  return new Proxy(promiseBase, {
    get(target, prop, receiver) {
      // Handle special properties
      if (prop === '__expr' || prop === '__isPipelinePromise') {
        return (target as any)[prop]
      }

      // Handle thenable methods
      if (prop === 'then' || prop === 'catch') {
        return (target as any)[prop].bind(target)
      }

      // Handle map
      if (prop === 'map') {
        return (target as any).map.bind(target)
      }

      // Handle Symbol properties
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Property access returns a new PipelinePromise
      const propertyExpr: PipelineExpression = {
        type: 'property',
        base: expr,
        property: String(prop),
      }

      return createPipelinePromise(propertyExpr, options)
    },
  }) as PipelinePromise<T>
}

/**
 * Creates a resolved pipeline promise (for chained .then() calls)
 */
function createResolvedPipelinePromise<T>(resultPromise: Promise<T>, options: WorkflowProxyOptions): PipelinePromise<T> {
  const promiseBase = {
    __expr: { type: 'call', domain: '__resolved__', method: [], context: null, args: [] } as PipelineExpression,
    __isPipelinePromise: true as const,

    then<TResult1 = T, TResult2 = never>(
      onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): PipelinePromise<TResult1 | TResult2> {
      const nextPromise = resultPromise.then(onFulfilled as any, onRejected)
      return createResolvedPipelinePromise(nextPromise, options)
    },

    catch<TResult = never>(onRejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): PipelinePromise<T | TResult> {
      return this.then(undefined, onRejected) as PipelinePromise<T | TResult>
    },
  }

  return new Proxy(promiseBase, {
    get(target, prop) {
      if (prop === '__expr' || prop === '__isPipelinePromise' || prop === 'then' || prop === 'catch') {
        const value = (target as any)[prop]
        return typeof value === 'function' ? value.bind(target) : value
      }
      return undefined
    },
  }) as PipelinePromise<T>
}

/**
 * Creates a placeholder proxy for map recording.
 * The placeholder supports property access and .map() for nested maps.
 */
function createPlaceholderProxy(path: string[], options: WorkflowProxyOptions): any {
  const expr: PipelineExpression = { type: 'placeholder', path }

  const placeholder = {
    __expr: expr,
    __isPipelinePromise: true,
    __isPlaceholder: true,
    __path: path,

    // Support .map() for nested map operations
    map<U>(callback: (item: any, index?: number) => any): any {
      // Create a nested placeholder for the inner map callback
      const innerPlaceholder = createPlaceholderProxy([], options)

      // Record the callback with the inner placeholder
      const recordedResult = callback(innerPlaceholder, 0)

      // Capture mapper instructions
      const mapper = extractMapperInstructions(recordedResult, innerPlaceholder)

      const mapExpr: PipelineExpression = {
        type: 'map',
        array: expr,
        mapper,
      }

      return createPipelinePromise(mapExpr, options)
    },
  }

  return new Proxy(placeholder, {
    get(target, prop) {
      if (prop === '__expr' || prop === '__isPipelinePromise' || prop === '__isPlaceholder' || prop === '__path') {
        return (target as any)[prop]
      }

      // Handle map method
      if (prop === 'map') {
        return (target as any).map.bind(target)
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      // Return a new placeholder with extended path for property access
      return createPlaceholderProxy([...path, String(prop)], options)
    },
  })
}

/**
 * Extracts mapper instructions from a recorded callback result
 */
function extractMapperInstructions(result: any, placeholder: any): MapperInstruction[] {
  // For now, return a simple instruction based on the result expression
  if (isPipelinePromise(result)) {
    const expr = result.__expr
    if (expr.type === 'call') {
      // Find input paths by looking at placeholder properties used in context
      const inputPaths = findPlaceholderPaths(expr.context)
      return [
        {
          operation: 'call',
          path: [expr.domain, ...expr.method],
          inputPaths,
        },
      ]
    }
  }
  return []
}

/**
 * Finds placeholder paths in a value tree
 */
function findPlaceholderPaths(value: unknown): string[][] {
  const paths: string[][] = []

  function traverse(v: unknown): void {
    if (v === null || v === undefined) return

    if (typeof v === 'object') {
      if ((v as any).__isPlaceholder) {
        paths.push((v as any).__path)
        return
      }

      if (isPipelinePromise(v)) {
        const expr = v.__expr
        if (expr.type === 'placeholder') {
          paths.push(expr.path)
        }
        return
      }

      if (Array.isArray(v)) {
        v.forEach(traverse)
      } else {
        Object.values(v).forEach(traverse)
      }
    }
  }

  traverse(value)
  return paths
}

// ============================================================================
// Expression Capture Helpers
// ============================================================================

/**
 * Captures an expression from a value, handling PipelinePromises and literals
 */
function captureExpr(value: unknown, options: WorkflowProxyOptions): PipelineExpression {
  if (isPipelinePromise(value)) {
    return value.__expr
  }

  // Handle plain objects that might contain PipelinePromises
  if (typeof value === 'object' && value !== null) {
    return { type: 'literal', value }
  }

  // Handle primitive values
  return { type: 'literal', value }
}

// ============================================================================
// Workflow Proxy
// ============================================================================

/**
 * Creates the $ workflow proxy that captures domain method calls
 */
export function createWorkflowProxy(options: WorkflowProxyOptions = {}): any {
  return new Proxy(
    {},
    {
      get(target, domain) {
        if (typeof domain === 'symbol') {
          return undefined
        }

        // Handle $.when(condition, { then, else }) - simple conditional
        if (domain === 'when') {
          return (condition: PipelinePromise<boolean>, branches: { then: () => unknown; else?: () => unknown }) => {
            const conditionExpr = isPipelinePromise(condition)
              ? condition.__expr
              : {
                  type: 'literal' as const,
                  value: condition,
                }

            // Capture branch expressions
            const thenResult = branches.then()
            const elseResult = branches.else?.()

            const thenBranch = captureExpr(thenResult, options)
            const elseBranch = elseResult !== undefined ? captureExpr(elseResult, options) : null

            const conditionalExpr: PipelineExpression = {
              type: 'conditional',
              condition: conditionExpr,
              thenBranch,
              elseBranch,
            }

            return createPipelinePromise(conditionalExpr, options)
          }
        }

        // Handle $.branch(value, cases) - multi-way conditional
        if (domain === 'branch') {
          return (value: PipelinePromise<string>, cases: Record<string, () => unknown> & { default?: () => unknown }) => {
            const valueExpr = isPipelinePromise(value)
              ? value.__expr
              : {
                  type: 'literal' as const,
                  value,
                }

            const capturedCases: Record<string, PipelineExpression> = {}
            for (const [key, fn] of Object.entries(cases)) {
              if (typeof fn === 'function') {
                const result = fn()
                capturedCases[key] = captureExpr(result, options)
              }
            }

            const branchExpr: PipelineExpression = {
              type: 'branch',
              value: valueExpr,
              cases: capturedCases,
            }

            return createPipelinePromise(branchExpr, options)
          }
        }

        // Handle $.match(value, patterns) - pattern matching
        if (domain === 'match') {
          return (value: PipelinePromise, patterns: Array<[(v: unknown) => boolean, () => unknown]>) => {
            const valueExpr = isPipelinePromise(value)
              ? value.__expr
              : {
                  type: 'literal' as const,
                  value,
                }

            const capturedPatterns = patterns.map(([predicate, resultFn]) => ({
              predicateSource: predicate.toString(),
              result: captureExpr(resultFn(), options),
            }))

            const matchExpr: PipelineExpression = {
              type: 'match',
              value: valueExpr,
              patterns: capturedPatterns,
            }

            return createPipelinePromise(matchExpr, options)
          }
        }

        // Handle $.waitFor(eventName, options) - human-in-the-loop / external events
        // This causes the workflow to hibernate until the event is received
        if (domain === 'waitFor') {
          return (eventName: string, waitOptions: { timeout?: string; type?: string } = {}) => {
            const waitForExpr: PipelineExpression = {
              type: 'waitFor',
              eventName,
              options: waitOptions,
            }

            return createPipelinePromise(waitForExpr, options)
          }
        }

        // Return a function that creates the domain context
        return (context: unknown) => {
          // Return a proxy for method calls on the domain
          return new Proxy(
            {},
            {
              get(methodTarget, method) {
                if (typeof method === 'symbol') {
                  return undefined
                }

                // Return a function that creates the pipeline expression
                return (...args: unknown[]) => {
                  const expr: PipelineExpression = {
                    type: 'call',
                    domain: String(domain),
                    method: [String(method)],
                    context,
                    args,
                  }

                  // Don't execute immediately, just capture
                  // Note: onExecute is NOT called here - that's the point of deferred execution

                  return createPipelinePromise(expr, options)
                }
              },
            },
          )
        }
      },
    },
  )
}

// ============================================================================
// Expression Collection
// ============================================================================

/**
 * Collects all PipelinePromises from a value tree
 */
export function collectExpressions(value: unknown): PipelinePromise[] {
  const collected: PipelinePromise[] = []
  const seen = new WeakSet()

  function traverse(v: unknown): void {
    if (v === null || v === undefined) return

    if (typeof v === 'object') {
      // Avoid cycles
      if (seen.has(v as object)) return
      seen.add(v as object)

      if (isPipelinePromise(v)) {
        collected.push(v)
        // Also traverse the expression for nested PipelinePromises (e.g., in context/args)
        traverseExpression(v.__expr)
        return
      }

      if (Array.isArray(v)) {
        v.forEach(traverse)
      } else {
        Object.values(v).forEach(traverse)
      }
    }
  }

  function traverseExpression(expr: PipelineExpression): void {
    if (expr.type === 'call') {
      traverse(expr.context)
      expr.args.forEach(traverse)
    } else if (expr.type === 'property') {
      // Don't re-add the base, but check its contents
      if (isPipelinePromise(expr.base)) {
        // Already collected via parent traversal
      }
    } else if (expr.type === 'map') {
      // Already collected the array expression
    } else if (expr.type === 'conditional') {
      // Traverse branches for nested PipelinePromises
      if (expr.thenBranch.type === 'literal') {
        traverse(expr.thenBranch.value)
      }
      if (expr.elseBranch?.type === 'literal') {
        traverse(expr.elseBranch.value)
      }
    } else if (expr.type === 'branch') {
      // Traverse all cases for nested PipelinePromises
      for (const caseExpr of Object.values(expr.cases)) {
        if (caseExpr.type === 'literal') {
          traverse(caseExpr.value)
        }
      }
    } else if (expr.type === 'match') {
      // Traverse all pattern results for nested PipelinePromises
      for (const pattern of expr.patterns) {
        if (pattern.result.type === 'literal') {
          traverse(pattern.result.value)
        }
      }
    }
  }

  traverse(value)
  return collected
}

// ============================================================================
// Dependency Analysis (for batching)
// ============================================================================

/**
 * Analyzes expressions to determine which can run in parallel
 */
export function analyzeExpressions(expressions: PipelinePromise[]): {
  independent: PipelinePromise[]
  dependent: PipelinePromise[]
} {
  const independent: PipelinePromise[] = []
  const dependent: PipelinePromise[] = []

  // Build a set of all expression references
  const exprSet = new Set(expressions.map((e) => e.__expr))

  for (const expr of expressions) {
    const deps = findDependencies(expr.__expr, exprSet)
    if (deps.length > 0) {
      dependent.push(expr)
    } else {
      independent.push(expr)
    }
  }

  return { independent, dependent }
}

/**
 * Finds dependencies of an expression within a set of known expressions
 */
function findDependencies(expr: PipelineExpression, knownExprs: Set<PipelineExpression>): PipelineExpression[] {
  const deps: PipelineExpression[] = []

  function traverse(v: unknown): void {
    if (v === null || v === undefined) return

    if (isPipelinePromise(v)) {
      const baseExpr = findBaseExpression(v.__expr)
      if (knownExprs.has(baseExpr) && baseExpr !== expr) {
        deps.push(baseExpr)
      }
      return
    }

    if (typeof v === 'object') {
      if (Array.isArray(v)) {
        v.forEach(traverse)
      } else {
        Object.values(v).forEach(traverse)
      }
    }
  }

  if (expr.type === 'call') {
    traverse(expr.context)
    expr.args.forEach(traverse)
  }

  return deps
}

/**
 * Finds the root call expression from a property chain
 */
function findBaseExpression(expr: PipelineExpression): PipelineExpression {
  if (expr.type === 'property') {
    return findBaseExpression(expr.base)
  }
  return expr
}

// ============================================================================
// Re-exports from analyzer module (for advanced analysis)
// ============================================================================

export { analyzeExpressionsFull, findEmbeddedPromises, type AnalysisResult, type SimpleAnalysisResult } from './analyzer'

/**
 * Expression Dependency Analyzer for ai-workflows
 *
 * Analyzes PipelineExpression trees to:
 * 1. Build dependency graphs
 * 2. Identify independent operations (can parallelize)
 * 3. Identify dependent operations (must sequence)
 * 4. Produce optimal execution order via topological sort
 */

// Import from pipeline-types.ts to break circular dependency with pipeline-promise.ts
import type { PipelineExpression, PipelinePromise, AnalysisResult, SimpleAnalysisResult } from './pipeline-types'
import { isPipelinePromise } from './pipeline-types'

// Re-export types from pipeline-types.ts for backwards compatibility
export type { AnalysisResult, SimpleAnalysisResult } from './pipeline-types'

// ============================================================================
// Main Analysis Functions
// ============================================================================

/**
 * Performs full dependency analysis on a set of PipelinePromises.
 *
 * Returns a complete dependency graph and optimal execution order.
 *
 * @example
 * ```typescript
 * const crm = $.CRM(customer).createAccount()
 * const billing = $.Billing(customer).setupSubscription()
 * // These are INDEPENDENT - can run in parallel
 *
 * const order = $.Orders({}).create({ items: [] })
 * const payment = $.Payment({ orderId: order.id }).process()
 * // payment DEPENDS on order (uses order.id)
 *
 * const result = analyzeExpressionsFull([crm, billing, order, payment])
 * // result.executionOrder = [
 * //   [crm.__expr, billing.__expr, order.__expr],  // Parallel group 1
 * //   [payment.__expr]                              // Parallel group 2 (waits for order)
 * // ]
 * ```
 */
export function analyzeExpressionsFull(expressions: PipelinePromise[]): AnalysisResult {
  const exprs = expressions.map((e) => e.__expr)
  const deps = new Map<PipelineExpression, Set<PipelineExpression>>()

  // Build dependency map
  for (const expr of expressions) {
    deps.set(expr.__expr, findDependencies(expr.__expr, expressions))
  }

  // Topological sort into parallel execution groups
  const executionOrder = topologicalSort(deps)

  return {
    expressions: exprs,
    dependencies: deps,
    executionOrder,
  }
}

/**
 * Simple analysis that classifies expressions as independent or dependent.
 *
 * This is a convenience function for basic parallel/sequential classification.
 *
 * @example
 * ```typescript
 * const order = $.Orders({}).create({ items: [] })
 * const payment = $.Payment({ orderId: order.id }).process()
 *
 * const { independent, dependent } = analyzeExpressions([order, payment])
 * // independent = [order]  // No dependencies on other expressions
 * // dependent = [payment]  // Depends on order
 * ```
 */
export function analyzeExpressions(expressions: PipelinePromise[]): SimpleAnalysisResult {
  const independent: PipelinePromise[] = []
  const dependent: PipelinePromise[] = []

  // Build a set of all expression references for dependency detection
  const exprSet = new Set(expressions.map((e) => e.__expr))

  for (const expr of expressions) {
    const deps = findDependenciesInSet(expr.__expr, exprSet)
    if (deps.size > 0) {
      dependent.push(expr)
    } else {
      independent.push(expr)
    }
  }

  return { independent, dependent }
}

// ============================================================================
// Dependency Detection
// ============================================================================

/**
 * Finds all dependencies of an expression within a set of PipelinePromises.
 *
 * Traverses the expression's context and args to find embedded PipelinePromises,
 * then traces those back to their root call expressions.
 */
function findDependencies(expr: PipelineExpression, allExprs: PipelinePromise[]): Set<PipelineExpression> {
  const deps = new Set<PipelineExpression>()
  const exprSet = new Set(allExprs.map((e) => e.__expr))

  // Visitor to traverse values and find PipelinePromises
  function visitValue(v: unknown): void {
    if (v === null || v === undefined) return

    if (isPipelinePromise(v)) {
      // Trace to the root call expression
      const baseExpr = findBaseExpression(v.__expr)
      // Only add if it's one of the known expressions and not self
      if (exprSet.has(baseExpr) && baseExpr !== expr) {
        deps.add(baseExpr)
      }
      return
    }

    if (typeof v === 'object') {
      if (Array.isArray(v)) {
        v.forEach(visitValue)
      } else {
        Object.values(v).forEach(visitValue)
      }
    }
  }

  // Visit expression based on type
  visitExpression(expr, visitValue)

  return deps
}

/**
 * Finds dependencies that exist in a specific set of expressions.
 * Used for simple independent/dependent classification.
 */
function findDependenciesInSet(expr: PipelineExpression, knownExprs: Set<PipelineExpression>): Set<PipelineExpression> {
  const deps = new Set<PipelineExpression>()

  function visitValue(v: unknown): void {
    if (v === null || v === undefined) return

    if (isPipelinePromise(v)) {
      const baseExpr = findBaseExpression(v.__expr)
      if (knownExprs.has(baseExpr) && baseExpr !== expr) {
        deps.add(baseExpr)
      }
      return
    }

    if (typeof v === 'object') {
      if (Array.isArray(v)) {
        v.forEach(visitValue)
      } else {
        Object.values(v).forEach(visitValue)
      }
    }
  }

  visitExpression(expr, visitValue)

  return deps
}

/**
 * Visits an expression and calls the visitor for all embedded values
 * that might contain PipelinePromises.
 */
function visitExpression(expr: PipelineExpression, visitor: (v: unknown) => void): void {
  switch (expr.type) {
    case 'call':
      // Check context and args for embedded PipelinePromises
      visitor(expr.context)
      for (const arg of expr.args) {
        visitor(arg)
      }
      break

    case 'property':
      // Property expressions don't directly contain values,
      // but their base might be a dependency
      // (handled via findBaseExpression when encountering PipelinePromises)
      break

    case 'map':
      // Map expressions depend on the array expression
      // (handled via the array reference itself)
      break

    case 'conditional':
      // Conditionals have condition and branches
      // The condition is already a PipelineExpression
      // Branches might contain PipelinePromises
      if ('thenBranch' in expr && typeof expr.thenBranch === 'object') {
        visitor(expr.thenBranch)
      }
      if ('elseBranch' in expr && typeof expr.elseBranch === 'object') {
        visitor(expr.elseBranch)
      }
      break

    case 'placeholder':
      // Placeholders don't have dependencies
      break
  }
}

/**
 * Finds embedded PipelinePromises in a value tree.
 *
 * Used to detect when method arguments contain references to other
 * pipeline results.
 */
export function findEmbeddedPromises(value: unknown, allExprs: PipelinePromise[]): Set<PipelineExpression> {
  const embedded = new Set<PipelineExpression>()
  const exprSet = new Set(allExprs.map((e) => e.__expr))

  function traverse(v: unknown): void {
    if (v === null || v === undefined) return

    if (isPipelinePromise(v)) {
      const baseExpr = findBaseExpression(v.__expr)
      if (exprSet.has(baseExpr)) {
        embedded.add(baseExpr)
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

  traverse(value)
  return embedded
}

// ============================================================================
// Topological Sort
// ============================================================================

/**
 * Performs topological sort on the dependency graph, grouping
 * expressions that can execute in parallel.
 *
 * Returns an array of "execution groups" where:
 * - All expressions in a group have no dependencies on each other
 * - Each group must complete before the next group starts
 * - Groups are ordered from no-dependency to most-dependent
 *
 * @throws Error if circular dependency is detected
 */
function topologicalSort(deps: Map<PipelineExpression, Set<PipelineExpression>>): PipelineExpression[][] {
  const result: PipelineExpression[][] = []
  const remaining = new Set(deps.keys())

  while (remaining.size > 0) {
    // Find all expressions with no unresolved dependencies
    const ready: PipelineExpression[] = []

    for (const expr of remaining) {
      const exprDeps = deps.get(expr)!
      // Check if all dependencies have been resolved (not in remaining)
      const hasUnresolved = [...exprDeps].some((d) => remaining.has(d))
      if (!hasUnresolved) {
        ready.push(expr)
      }
    }

    // If nothing is ready but we have remaining expressions,
    // we have a circular dependency
    if (ready.length === 0 && remaining.size > 0) {
      const cycle = detectCycle(deps, remaining)
      throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`)
    }

    // Add this parallel group to result
    result.push(ready)

    // Remove processed expressions from remaining
    for (const expr of ready) {
      remaining.delete(expr)
    }
  }

  return result
}

/**
 * Attempts to detect and report a circular dependency path.
 */
function detectCycle(deps: Map<PipelineExpression, Set<PipelineExpression>>, remaining: Set<PipelineExpression>): string[] {
  // Simple DFS to find a cycle
  const visited = new Set<PipelineExpression>()
  const path: PipelineExpression[] = []

  function dfs(expr: PipelineExpression): boolean {
    if (path.includes(expr)) {
      // Found cycle - extract it
      const cycleStart = path.indexOf(expr)
      path.push(expr) // Complete the cycle
      return true
    }

    if (visited.has(expr)) {
      return false
    }

    visited.add(expr)
    path.push(expr)

    const exprDeps = deps.get(expr)
    if (exprDeps) {
      for (const dep of exprDeps) {
        if (remaining.has(dep) && dfs(dep)) {
          return true
        }
      }
    }

    path.pop()
    return false
  }

  for (const expr of remaining) {
    if (dfs(expr)) {
      break
    }
  }

  // Format the cycle for error message
  return path.map(formatExpression)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Finds the root call expression from a property chain.
 *
 * Given: order.items[0].sku (a chain of property accesses)
 * Returns: the original order call expression
 */
function findBaseExpression(expr: PipelineExpression): PipelineExpression {
  if (expr.type === 'property') {
    return findBaseExpression(expr.base)
  }
  return expr
}

/**
 * Formats an expression for debugging/error messages.
 */
function formatExpression(expr: PipelineExpression): string {
  switch (expr.type) {
    case 'call':
      return `${expr.domain}.${expr.method.join('.')}()`
    case 'property':
      return `${formatExpression(expr.base)}.${expr.property}`
    case 'map':
      return `${formatExpression(expr.array)}.map()`
    case 'conditional':
      return `$.when(...)`
    case 'placeholder':
      return `<placeholder:${expr.path.join('.')}>`
    default:
      return '<unknown>'
  }
}

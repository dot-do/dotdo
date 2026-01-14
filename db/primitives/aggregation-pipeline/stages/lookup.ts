/**
 * $lookup Stage - MongoDB-style collection joins
 *
 * Supports:
 * - Basic lookup (foreign key join)
 * - Uncorrelated subqueries (pipeline syntax)
 * - Correlated subqueries ($expr in pipeline)
 * - Multiple join conditions
 * - Left outer join semantics (unmatched documents get empty array)
 *
 * @example Basic lookup
 * ```typescript
 * createLookupStage({
 *   from: orders,
 *   localField: 'customerId',
 *   foreignField: '_id',
 *   as: 'customerOrders'
 * })
 * ```
 *
 * @example Pipeline lookup (uncorrelated)
 * ```typescript
 * createLookupStage({
 *   from: products,
 *   pipeline: [
 *     { $match: { inStock: true } },
 *     { $limit: 5 }
 *   ],
 *   as: 'topProducts'
 * })
 * ```
 *
 * @example Correlated subquery with let
 * ```typescript
 * createLookupStage({
 *   from: inventory,
 *   let: { productId: '$_id', minQty: '$minQuantity' },
 *   pipeline: [
 *     { $match: { $expr: { $and: [
 *       { $eq: ['$productId', '$$productId'] },
 *       { $gte: ['$quantity', '$$minQty'] }
 *     ]}}}
 *   ],
 *   as: 'availableInventory'
 * })
 * ```
 */

import type { Stage } from '../index'

// ============================================================================
// Types
// ============================================================================

/**
 * Basic lookup specification (equality join)
 */
export interface BasicLookupSpec<TFrom> {
  /** The "foreign" collection to join */
  from: TFrom[]
  /** Field from the input documents */
  localField: string
  /** Field from the documents in "from" */
  foreignField: string
  /** Output array field name */
  as: string
}

/**
 * Pipeline stage for uncorrelated/correlated subqueries
 */
export interface PipelineStageSpec {
  $match?: Record<string, unknown>
  $project?: Record<string, unknown>
  $sort?: Record<string, number>
  $limit?: number
  $skip?: number
  $group?: Record<string, unknown>
  $unwind?: string | { path: string; preserveNullAndEmptyArrays?: boolean }
}

/**
 * Pipeline lookup specification (subquery join)
 */
export interface PipelineLookupSpec<TFrom> {
  /** The "foreign" collection to join */
  from: TFrom[]
  /** Variables to use in the pipeline (bound to input document fields) */
  let?: Record<string, string>
  /** Pipeline to execute on the foreign collection */
  pipeline: PipelineStageSpec[]
  /** Output array field name */
  as: string
}

/**
 * Combined lookup specification
 */
export type LookupSpec<TFrom> = BasicLookupSpec<TFrom> | PipelineLookupSpec<TFrom>

/**
 * Lookup stage interface
 */
export interface LookupStage<TInput, TFrom> extends Stage<TInput, TInput & Record<string, TFrom[]>> {
  name: '$lookup'
  specification: LookupSpec<TFrom>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined

  // Handle field references ($field)
  const cleanPath = path.startsWith('$') ? path.slice(1) : path
  const parts = cleanPath.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Check if spec is a pipeline lookup
 */
function isPipelineLookup<TFrom>(spec: LookupSpec<TFrom>): spec is PipelineLookupSpec<TFrom> {
  return 'pipeline' in spec
}

/**
 * Resolve let variables from an input document
 */
function resolveLetVariables(
  doc: unknown,
  letSpec: Record<string, string> | undefined
): Map<string, unknown> {
  const variables = new Map<string, unknown>()

  if (!letSpec) return variables

  for (const [varName, fieldRef] of Object.entries(letSpec)) {
    variables.set(varName, getNestedValue(doc, fieldRef))
  }

  return variables
}

/**
 * Evaluate an expression with variable substitution
 */
function evaluateExpression(
  expr: unknown,
  doc: unknown,
  variables: Map<string, unknown>
): unknown {
  if (expr === null || expr === undefined) return expr

  // Handle variable reference ($$var)
  if (typeof expr === 'string') {
    if (expr.startsWith('$$')) {
      const varName = expr.slice(2)
      return variables.get(varName)
    }
    if (expr.startsWith('$')) {
      return getNestedValue(doc, expr)
    }
    return expr
  }

  // Handle arrays
  if (Array.isArray(expr)) {
    return expr.map((item) => evaluateExpression(item, doc, variables))
  }

  // Handle objects
  if (typeof expr === 'object') {
    const exprObj = expr as Record<string, unknown>

    // $expr operator - evaluate expression in match context
    if ('$expr' in exprObj) {
      return evaluateCondition(exprObj.$expr, doc, variables)
    }

    // $eq comparison
    if ('$eq' in exprObj) {
      const [a, b] = (exprObj.$eq as unknown[]).map((v) =>
        evaluateExpression(v, doc, variables)
      )
      return a === b
    }

    // $ne comparison
    if ('$ne' in exprObj) {
      const [a, b] = (exprObj.$ne as unknown[]).map((v) =>
        evaluateExpression(v, doc, variables)
      )
      return a !== b
    }

    // $gt comparison
    if ('$gt' in exprObj) {
      const [a, b] = (exprObj.$gt as unknown[]).map((v) =>
        evaluateExpression(v, doc, variables)
      ) as [number, number]
      return a > b
    }

    // $gte comparison
    if ('$gte' in exprObj) {
      const [a, b] = (exprObj.$gte as unknown[]).map((v) =>
        evaluateExpression(v, doc, variables)
      ) as [number, number]
      return a >= b
    }

    // $lt comparison
    if ('$lt' in exprObj) {
      const [a, b] = (exprObj.$lt as unknown[]).map((v) =>
        evaluateExpression(v, doc, variables)
      ) as [number, number]
      return a < b
    }

    // $lte comparison
    if ('$lte' in exprObj) {
      const [a, b] = (exprObj.$lte as unknown[]).map((v) =>
        evaluateExpression(v, doc, variables)
      ) as [number, number]
      return a <= b
    }

    // $and logical
    if ('$and' in exprObj) {
      const conditions = exprObj.$and as unknown[]
      return conditions.every((c) => evaluateCondition(c, doc, variables))
    }

    // $or logical
    if ('$or' in exprObj) {
      const conditions = exprObj.$or as unknown[]
      return conditions.some((c) => evaluateCondition(c, doc, variables))
    }

    // $in operator
    if ('$in' in exprObj) {
      const [value, arr] = (exprObj.$in as unknown[]).map((v) =>
        evaluateExpression(v, doc, variables)
      )
      return Array.isArray(arr) && arr.includes(value)
    }

    // Recursively evaluate object properties
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(exprObj)) {
      result[key] = evaluateExpression(value, doc, variables)
    }
    return result
  }

  return expr
}

/**
 * Evaluate a condition expression
 */
function evaluateCondition(
  condition: unknown,
  doc: unknown,
  variables: Map<string, unknown>
): boolean {
  const result = evaluateExpression(condition, doc, variables)
  return Boolean(result)
}

/**
 * Apply a simple match predicate
 */
function matchDocument(
  doc: unknown,
  predicate: Record<string, unknown>,
  variables: Map<string, unknown>
): boolean {
  const docObj = doc as Record<string, unknown>

  for (const [field, value] of Object.entries(predicate)) {
    // Handle $expr for correlated subqueries
    if (field === '$expr') {
      if (!evaluateCondition(value, doc, variables)) {
        return false
      }
      continue
    }

    const fieldValue = getNestedValue(docObj, field)

    // Handle operator objects
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>

      for (const [op, opValue] of Object.entries(ops)) {
        const resolvedOpValue = evaluateExpression(opValue, doc, variables)

        switch (op) {
          case '$eq':
            if (fieldValue !== resolvedOpValue) return false
            break
          case '$ne':
            if (fieldValue === resolvedOpValue) return false
            break
          case '$gt':
            if ((fieldValue as number) <= (resolvedOpValue as number)) return false
            break
          case '$gte':
            if ((fieldValue as number) < (resolvedOpValue as number)) return false
            break
          case '$lt':
            if ((fieldValue as number) >= (resolvedOpValue as number)) return false
            break
          case '$lte':
            if ((fieldValue as number) > (resolvedOpValue as number)) return false
            break
          case '$in':
            if (!Array.isArray(resolvedOpValue) || !resolvedOpValue.includes(fieldValue)) return false
            break
          case '$nin':
            if (Array.isArray(resolvedOpValue) && resolvedOpValue.includes(fieldValue)) return false
            break
          case '$regex':
            if (typeof fieldValue !== 'string') return false
            const regex = resolvedOpValue instanceof RegExp
              ? resolvedOpValue
              : new RegExp(resolvedOpValue as string)
            if (!regex.test(fieldValue)) return false
            break
          case '$exists':
            if (resolvedOpValue === true && fieldValue === undefined) return false
            if (resolvedOpValue === false && fieldValue !== undefined) return false
            break
        }
      }
    } else {
      // Direct value comparison
      const resolvedValue = evaluateExpression(value, doc, variables)
      if (fieldValue !== resolvedValue) return false
    }
  }

  return true
}

/**
 * Execute a mini-pipeline on a collection
 */
function executePipeline<T>(
  collection: T[],
  pipeline: PipelineStageSpec[],
  variables: Map<string, unknown>
): T[] {
  let result = [...collection]

  for (const stage of pipeline) {
    if ('$match' in stage && stage.$match) {
      result = result.filter((doc) => matchDocument(doc, stage.$match!, variables))
    }

    if ('$sort' in stage && stage.$sort) {
      const sortSpec = stage.$sort
      result = [...result].sort((a, b) => {
        for (const [field, direction] of Object.entries(sortSpec)) {
          const aVal = getNestedValue(a, field)
          const bVal = getNestedValue(b, field)

          if (aVal === bVal) continue

          const cmp = aVal! < bVal! ? -1 : 1
          return cmp * direction
        }
        return 0
      })
    }

    if ('$skip' in stage && stage.$skip !== undefined) {
      result = result.slice(stage.$skip)
    }

    if ('$limit' in stage && stage.$limit !== undefined) {
      result = result.slice(0, stage.$limit)
    }

    if ('$project' in stage && stage.$project) {
      const projectSpec = stage.$project
      result = result.map((doc) => {
        const projected: Record<string, unknown> = {}
        for (const [field, value] of Object.entries(projectSpec)) {
          if (value === 1 || value === true) {
            projected[field] = getNestedValue(doc, field)
          } else if (typeof value === 'string' && value.startsWith('$')) {
            projected[field] = getNestedValue(doc, value)
          } else if (value === 0 || value === false) {
            // Exclude field
          } else {
            projected[field] = evaluateExpression(value, doc, variables)
          }
        }
        return projected as T
      })
    }
  }

  return result
}

// ============================================================================
// Lookup Stage Factory
// ============================================================================

/**
 * Create a $lookup stage for joining collections
 */
export function createLookupStage<TInput, TFrom>(
  spec: LookupSpec<TFrom>
): LookupStage<TInput, TFrom> {
  return {
    name: '$lookup',
    specification: spec,

    process(input: TInput[]): (TInput & Record<string, TFrom[]>)[] {
      if (isPipelineLookup(spec)) {
        // Pipeline lookup
        return input.map((doc) => {
          const variables = resolveLetVariables(doc, spec.let)
          const matched = executePipeline(spec.from, spec.pipeline, variables)

          return {
            ...doc,
            [spec.as]: matched,
          } as TInput & Record<string, TFrom[]>
        })
      } else {
        // Basic equality lookup
        // Build an index on the foreign collection for O(1) lookups
        const foreignIndex = new Map<unknown, TFrom[]>()

        for (const foreignDoc of spec.from) {
          const foreignValue = getNestedValue(foreignDoc, spec.foreignField)
          const existing = foreignIndex.get(foreignValue) || []
          existing.push(foreignDoc)
          foreignIndex.set(foreignValue, existing)
        }

        return input.map((doc) => {
          const localValue = getNestedValue(doc, spec.localField)
          const matched = foreignIndex.get(localValue) || []

          return {
            ...doc,
            [spec.as]: matched,
          } as TInput & Record<string, TFrom[]>
        })
      }
    },
  }
}

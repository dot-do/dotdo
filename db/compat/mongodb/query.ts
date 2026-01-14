/**
 * MongoDB Query Execution using QueryEngine Primitive
 *
 * Leverages the unified QueryEngine to parse MongoDB queries into AST
 * and execute them against document collections.
 *
 * @module db/compat/mongodb/query
 */

import { MongoQueryParser, type MongoQuery } from '../../primitives/query-engine'
import { PredicateCompiler, type TCSPredicate, type CompiledPredicate, type CompilationResult } from '../../primitives/query-engine'
import type { Document, Filter, WithId, ObjectId } from './types'

// ============================================================================
// Query Executor
// ============================================================================

/**
 * Compiled query that can be executed against documents
 */
export interface CompiledQuery<T extends Document = Document> {
  /** The original filter */
  filter: Filter<T>
  /** Compiled predicate function */
  predicate: (doc: WithId<T>) => boolean
}

/**
 * QueryExecutor uses the unified QueryEngine primitives to execute MongoDB-style queries
 */
export class QueryExecutor<T extends Document = Document> {
  private parser: MongoQueryParser
  private compiler: PredicateCompiler

  constructor() {
    this.parser = new MongoQueryParser()
    this.compiler = new PredicateCompiler()
  }

  /**
   * Compile a MongoDB filter into an executable predicate
   */
  compile(filter: Filter<T>): CompiledQuery<T> {
    // For empty filter, match all documents
    if (!filter || Object.keys(filter).length === 0) {
      return {
        filter,
        predicate: () => true,
      }
    }

    // Parse the MongoDB query to AST
    const ast = this.parser.parse(filter as MongoQuery)

    // Compile the AST to a predicate
    const compiled = this.compiler.compile(ast)

    // Create the predicate function
    const predicate = (doc: WithId<T>): boolean => {
      return this.evaluateCompilationResult(compiled, doc)
    }

    return { filter, predicate }
  }

  /**
   * Execute a filter against an array of documents
   */
  execute(filter: Filter<T>, documents: WithId<T>[]): WithId<T>[] {
    const compiled = this.compile(filter)
    return documents.filter(compiled.predicate)
  }

  /**
   * Find the first document matching the filter
   */
  findOne(filter: Filter<T>, documents: WithId<T>[]): WithId<T> | null {
    const compiled = this.compile(filter)
    return documents.find(compiled.predicate) ?? null
  }

  /**
   * Count documents matching the filter
   */
  count(filter: Filter<T>, documents: WithId<T>[]): number {
    const compiled = this.compile(filter)
    return documents.filter(compiled.predicate).length
  }

  /**
   * Evaluate a compilation result against a document
   */
  private evaluateCompilationResult(compiled: CompilationResult, doc: WithId<T>): boolean {
    // Handle branches if present (OR scenarios)
    if (compiled.branches && compiled.branches.length > 0) {
      for (const branch of compiled.branches) {
        // Each branch is a conjunction of predicates
        const branchMatch = this.evaluatePredicates(branch.predicates, branch.logicalOp ?? 'AND', doc)
        if (branchMatch) {
          return true
        }
      }
      return false
    }

    // Handle direct predicates
    return this.evaluatePredicates(compiled.predicates, compiled.logicalOp ?? 'AND', doc)
  }

  /**
   * Evaluate an array of predicates against a document
   */
  private evaluatePredicates(predicates: CompiledPredicate[], logicalOp: 'AND' | 'OR', doc: WithId<T>): boolean {
    if (predicates.length === 0) {
      return true
    }

    if (logicalOp === 'AND') {
      return predicates.every((p) => this.evaluatePredicate(p, doc))
    } else {
      return predicates.some((p) => this.evaluatePredicate(p, doc))
    }
  }

  /**
   * Evaluate a single compiled predicate against a document
   */
  private evaluatePredicate(compiled: CompiledPredicate, doc: WithId<T>): boolean {
    return this.evaluateBranch(compiled.tcsPredicate, doc)
  }

  /**
   * Evaluate a TCS predicate against a document
   */
  private evaluateBranch(predicate: TCSPredicate, doc: WithId<T>): boolean {
    const value = this.getNestedValue(doc, predicate.column)

    switch (predicate.op) {
      case 'eq':
        return this.compareValues(value, predicate.value) === 0
      case 'neq':
        return this.compareValues(value, predicate.value) !== 0
      case 'gt':
        return this.compareValues(value, predicate.value) > 0
      case 'gte':
        return this.compareValues(value, predicate.value) >= 0
      case 'lt':
        return this.compareValues(value, predicate.value) < 0
      case 'lte':
        return this.compareValues(value, predicate.value) <= 0
      case 'in':
        return Array.isArray(predicate.value) && predicate.value.some((v) => this.compareValues(value, v) === 0)
      case 'nin':
        return Array.isArray(predicate.value) && !predicate.value.some((v) => this.compareValues(value, v) === 0)
      case 'exists':
        return predicate.value ? value !== undefined : value === undefined
      case 'like':
      case 'contains':
        return typeof value === 'string' && typeof predicate.value === 'string' && value.includes(predicate.value)
      case 'startsWith':
        return typeof value === 'string' && typeof predicate.value === 'string' && value.startsWith(predicate.value)
      case 'isNull':
        return value === null
      case 'isNotNull':
        return value !== null && value !== undefined
      default:
        return true
    }
  }

  /**
   * Get a nested value from a document using dot notation
   */
  private getNestedValue(doc: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = doc

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined
      }
      if (typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Compare two values for sorting/filtering
   */
  private compareValues(a: unknown, b: unknown): number {
    // Handle nulls
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0
      return -1
    }
    if (b === null || b === undefined) return 1

    // Handle ObjectId comparison
    if (this.isObjectId(a) && this.isObjectId(b)) {
      return (a as any).toHexString().localeCompare((b as any).toHexString())
    }

    // Handle numbers
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b
    }

    // Handle strings
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b)
    }

    // Handle dates
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime()
    }

    // Handle booleans
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return a === b ? 0 : a ? 1 : -1
    }

    // Default comparison
    return String(a).localeCompare(String(b))
  }

  /**
   * Check if a value is an ObjectId
   */
  private isObjectId(value: unknown): boolean {
    return value !== null && typeof value === 'object' && 'toHexString' in value && typeof (value as any).toHexString === 'function'
  }
}

// ============================================================================
// Standalone Query Functions
// ============================================================================

/**
 * Create a query executor for a specific document type
 */
export function createQueryExecutor<T extends Document = Document>(): QueryExecutor<T> {
  return new QueryExecutor<T>()
}

/**
 * Execute a filter against documents
 */
export function executeQuery<T extends Document = Document>(
  filter: Filter<T>,
  documents: WithId<T>[]
): WithId<T>[] {
  const executor = new QueryExecutor<T>()
  return executor.execute(filter, documents)
}

/**
 * Compile a filter to a reusable predicate
 */
export function compileFilter<T extends Document = Document>(filter: Filter<T>): CompiledQuery<T> {
  const executor = new QueryExecutor<T>()
  return executor.compile(filter)
}

// ============================================================================
// Direct Filter Evaluation (Fallback)
// ============================================================================

/**
 * Direct filter evaluation without using the QueryEngine
 * This is a fallback implementation for simple queries or when the QueryEngine
 * doesn't support certain operators.
 */
export function evaluateFilterDirect<T extends Document = Document>(
  filter: Filter<T>,
  doc: WithId<T>
): boolean {
  // Empty filter matches all
  if (!filter || Object.keys(filter).length === 0) {
    return true
  }

  // Handle logical operators
  if ('$and' in filter && Array.isArray(filter.$and)) {
    return filter.$and.every((subFilter) => evaluateFilterDirect(subFilter, doc))
  }

  if ('$or' in filter && Array.isArray(filter.$or)) {
    return filter.$or.some((subFilter) => evaluateFilterDirect(subFilter, doc))
  }

  if ('$nor' in filter && Array.isArray(filter.$nor)) {
    return !filter.$nor.some((subFilter) => evaluateFilterDirect(subFilter, doc))
  }

  // Handle $where operator
  if ('$where' in filter) {
    const whereClause = filter.$where
    let whereResult: boolean
    if (typeof whereClause === 'function') {
      whereResult = whereClause.call(doc)
    } else if (typeof whereClause === 'string') {
      // Execute JavaScript string with 'this' bound to the document
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return ${whereClause}`)
      whereResult = fn.call(doc)
    } else {
      whereResult = false
    }
    if (!whereResult) return false
  }

  // Handle $expr operator
  if ('$expr' in filter) {
    if (!evaluateExpr(filter.$expr, doc)) {
      return false
    }
  }

  // Evaluate each field condition
  for (const [key, condition] of Object.entries(filter)) {
    // Skip logical operators (already handled above)
    if (key.startsWith('$')) continue

    const value = getNestedValue(doc, key)

    // Direct value comparison
    if (condition === null || typeof condition !== 'object') {
      if (!compareEquality(value, condition)) {
        return false
      }
      continue
    }

    // Operator-based comparison
    if (!evaluateOperators(value, condition as Record<string, unknown>)) {
      return false
    }
  }

  return true
}

/**
 * Get a nested value from a document using dot notation
 */
function getNestedValue(doc: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = doc

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Compare two values for equality
 */
function compareEquality(a: unknown, b: unknown): boolean {
  // Handle ObjectId comparison
  if (isObjectId(a) && isObjectId(b)) {
    return (a as any).equals(b)
  }
  if (isObjectId(a) && typeof b === 'string') {
    return (a as any).toHexString() === b
  }
  if (typeof a === 'string' && isObjectId(b)) {
    return a === (b as any).toHexString()
  }

  // Handle arrays - check if value is in array
  if (Array.isArray(a) && !Array.isArray(b)) {
    return a.some((item) => compareEquality(item, b))
  }

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }

  return a === b
}

/**
 * Check if a value is an ObjectId
 */
function isObjectId(value: unknown): boolean {
  return value !== null && typeof value === 'object' && 'toHexString' in value && typeof (value as any).toHexString === 'function'
}

/**
 * Evaluate operator-based conditions
 */
function evaluateOperators(value: unknown, operators: Record<string, unknown>): boolean {
  for (const [op, expected] of Object.entries(operators)) {
    switch (op) {
      case '$eq':
        if (!compareEquality(value, expected)) return false
        break
      case '$ne':
        if (compareEquality(value, expected)) return false
        break
      case '$gt':
        if (!compareGt(value, expected)) return false
        break
      case '$gte':
        if (!compareGte(value, expected)) return false
        break
      case '$lt':
        if (!compareLt(value, expected)) return false
        break
      case '$lte':
        if (!compareLte(value, expected)) return false
        break
      case '$in':
        if (!Array.isArray(expected) || !expected.some((e) => compareEquality(value, e))) return false
        break
      case '$nin':
        if (!Array.isArray(expected) || expected.some((e) => compareEquality(value, e))) return false
        break
      case '$exists':
        if ((expected && value === undefined) || (!expected && value !== undefined)) return false
        break
      case '$regex': {
        const regex = typeof expected === 'string' ? new RegExp(expected, operators.$options as string) : expected
        if (typeof value !== 'string' || !(regex instanceof RegExp) || !regex.test(value)) return false
        break
      }
      case '$options':
        // Handled by $regex
        break
      case '$not':
        if (typeof expected === 'object' && expected !== null) {
          if (evaluateOperators(value, expected as Record<string, unknown>)) return false
        }
        break
      case '$all':
        if (!Array.isArray(value) || !Array.isArray(expected)) return false
        if (!expected.every((e) => value.some((v) => compareEquality(v, e)))) return false
        break
      case '$elemMatch':
        if (!Array.isArray(value)) return false
        if (!value.some((v) => typeof v === 'object' && v !== null && evaluateFilterDirect(expected as any, v as any))) {
          return false
        }
        break
      case '$size':
        if (!Array.isArray(value) || value.length !== expected) return false
        break
      case '$type':
        if (!checkBsonType(value, expected)) return false
        break
      case '$mod': {
        if (!Array.isArray(expected) || expected.length !== 2) return false
        const [divisor, remainder] = expected
        if (typeof value !== 'number' || typeof divisor !== 'number' || typeof remainder !== 'number') return false
        if (value % divisor !== remainder) return false
        break
      }
      default:
        // Unknown operator - ignore
        break
    }
  }

  return true
}

/**
 * Comparison helpers
 */
function compareGt(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a > b
  if (typeof a === 'string' && typeof b === 'string') return a > b
  if (a instanceof Date && b instanceof Date) return a.getTime() > b.getTime()
  return false
}

function compareGte(a: unknown, b: unknown): boolean {
  return compareEquality(a, b) || compareGt(a, b)
}

function compareLt(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b
  if (typeof a === 'string' && typeof b === 'string') return a < b
  if (a instanceof Date && b instanceof Date) return a.getTime() < b.getTime()
  return false
}

function compareLte(a: unknown, b: unknown): boolean {
  return compareEquality(a, b) || compareLt(a, b)
}

/**
 * Evaluate an $expr expression against a document.
 * Supports basic aggregation expression operators:
 * - Comparison: $gt, $gte, $lt, $lte, $eq, $ne
 * - Arithmetic: $add, $subtract, $multiply, $divide, $mod
 * - Logical: $and, $or, $not
 * - Field access: $fieldPath (string starting with $)
 */
function evaluateExpr(expr: unknown, doc: Record<string, unknown>): boolean {
  if (typeof expr !== 'object' || expr === null) {
    return !!expr
  }

  const exprObj = expr as Record<string, unknown>
  const keys = Object.keys(exprObj)

  for (const key of keys) {
    const value = exprObj[key]

    switch (key) {
      case '$gt': {
        const [left, right] = value as [unknown, unknown]
        const leftVal = resolveExprValue(left, doc)
        const rightVal = resolveExprValue(right, doc)
        return compareGt(leftVal, rightVal)
      }
      case '$gte': {
        const [left, right] = value as [unknown, unknown]
        const leftVal = resolveExprValue(left, doc)
        const rightVal = resolveExprValue(right, doc)
        return compareGte(leftVal, rightVal)
      }
      case '$lt': {
        const [left, right] = value as [unknown, unknown]
        const leftVal = resolveExprValue(left, doc)
        const rightVal = resolveExprValue(right, doc)
        return compareLt(leftVal, rightVal)
      }
      case '$lte': {
        const [left, right] = value as [unknown, unknown]
        const leftVal = resolveExprValue(left, doc)
        const rightVal = resolveExprValue(right, doc)
        return compareLte(leftVal, rightVal)
      }
      case '$eq': {
        const [left, right] = value as [unknown, unknown]
        const leftVal = resolveExprValue(left, doc)
        const rightVal = resolveExprValue(right, doc)
        return compareEquality(leftVal, rightVal)
      }
      case '$ne': {
        const [left, right] = value as [unknown, unknown]
        const leftVal = resolveExprValue(left, doc)
        const rightVal = resolveExprValue(right, doc)
        return !compareEquality(leftVal, rightVal)
      }
      case '$and': {
        const conditions = value as unknown[]
        return conditions.every((cond) => evaluateExpr(cond, doc))
      }
      case '$or': {
        const conditions = value as unknown[]
        return conditions.some((cond) => evaluateExpr(cond, doc))
      }
      case '$not': {
        return !evaluateExpr(value, doc)
      }
      default:
        // Unknown expression operator - treat as truthy
        break
    }
  }

  return true
}

/**
 * Resolve an expression value, which can be:
 * - A field path starting with $ (e.g., "$field")
 * - An arithmetic expression object (e.g., { $add: ["$a", "$b"] })
 * - A literal value
 */
function resolveExprValue(value: unknown, doc: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    // Field path - remove the $ and get nested value
    const fieldPath = value.slice(1)
    return getNestedValue(doc, fieldPath)
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const exprObj = value as Record<string, unknown>
    const keys = Object.keys(exprObj)

    if (keys.length === 1) {
      const op = keys[0]!
      const args = exprObj[op]

      switch (op) {
        case '$add': {
          const operands = (args as unknown[]).map((arg) => resolveExprValue(arg, doc))
          return operands.reduce((sum: number, val) => sum + (typeof val === 'number' ? val : 0), 0)
        }
        case '$subtract': {
          const [left, right] = (args as unknown[]).map((arg) => resolveExprValue(arg, doc))
          return (typeof left === 'number' ? left : 0) - (typeof right === 'number' ? right : 0)
        }
        case '$multiply': {
          const operands = (args as unknown[]).map((arg) => resolveExprValue(arg, doc))
          return operands.reduce((prod: number, val) => prod * (typeof val === 'number' ? val : 0), 1)
        }
        case '$divide': {
          const [left, right] = (args as unknown[]).map((arg) => resolveExprValue(arg, doc))
          const rightNum = typeof right === 'number' ? right : 1
          return (typeof left === 'number' ? left : 0) / (rightNum === 0 ? 1 : rightNum)
        }
        case '$mod': {
          const [left, right] = (args as unknown[]).map((arg) => resolveExprValue(arg, doc))
          return (typeof left === 'number' ? left : 0) % (typeof right === 'number' ? right : 1)
        }
      }
    }
  }

  // Literal value
  return value
}

/**
 * Check BSON type
 */
function checkBsonType(value: unknown, type: unknown): boolean {
  // Handle array of types
  if (Array.isArray(type)) {
    return type.some((t) => checkBsonType(value, t))
  }

  const typeMap: Record<string, string[]> = {
    double: ['number'],
    string: ['string'],
    object: ['object'],
    array: ['array'],
    bool: ['boolean'],
    boolean: ['boolean'],
    int: ['number'],
    long: ['number'],
    number: ['number'],
    null: ['null'],
    regex: ['regexp'],
    javascript: ['function'],
    date: ['date'],
    objectId: ['objectId'],
  }

  const typeStr = typeof type === 'string' ? type : String(type)
  const expectedTypes = typeMap[typeStr] || [typeStr]

  const actualType =
    value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : value instanceof RegExp
          ? 'regexp'
          : value instanceof Date
            ? 'date'
            : isObjectId(value)
              ? 'objectId'
              : typeof value

  return expectedTypes.includes(actualType)
}

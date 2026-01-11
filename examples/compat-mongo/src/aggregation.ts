/**
 * MongoDB Aggregation Pipeline Executor
 *
 * Executes MongoDB aggregation pipeline stages on documents.
 * Supports: $match, $group, $sort, $project, $limit, $skip, $unwind, $lookup, $count, $addFields
 */

import { QueryParser, type MongoFilter, type SortSpec } from './query-parser'

// ============================================================================
// Types
// ============================================================================

/** Aggregation pipeline stage */
export type AggregationStage =
  | { $match: MongoFilter }
  | { $group: GroupSpec }
  | { $sort: SortSpec }
  | { $project: ProjectSpec }
  | { $limit: number }
  | { $skip: number }
  | { $unwind: string | UnwindSpec }
  | { $lookup: LookupSpec }
  | { $count: string }
  | { $addFields: Record<string, unknown> }
  | { $set: Record<string, unknown> }
  | { $replaceRoot: { newRoot: string | Record<string, unknown> } }
  | { $sample: { size: number } }
  | { $out: string }

/** Group specification */
export interface GroupSpec {
  _id: string | Record<string, string> | null
  [accumulator: string]: AccumulatorSpec | string | Record<string, string> | null
}

/** Accumulator specification */
export type AccumulatorSpec =
  | { $sum: string | number | AccumulatorExpr }
  | { $avg: string | AccumulatorExpr }
  | { $min: string | AccumulatorExpr }
  | { $max: string | AccumulatorExpr }
  | { $first: string | AccumulatorExpr }
  | { $last: string | AccumulatorExpr }
  | { $push: string | Record<string, string> | AccumulatorExpr }
  | { $addToSet: string | AccumulatorExpr }
  | { $count: Record<string, never> }
  | { $stdDevPop: string }
  | { $stdDevSamp: string }

/** Accumulator expression */
export interface AccumulatorExpr {
  $cond?: { if: MongoFilter; then: unknown; else: unknown }
  $multiply?: unknown[]
  $add?: unknown[]
  $subtract?: unknown[]
  $divide?: unknown[]
}

/** Project specification */
export interface ProjectSpec {
  [field: string]: 0 | 1 | string | ProjectExpr
}

/** Project expression */
export interface ProjectExpr {
  $concat?: unknown[]
  $substr?: [string, number, number]
  $toUpper?: string
  $toLower?: string
  $add?: unknown[]
  $subtract?: unknown[]
  $multiply?: unknown[]
  $divide?: unknown[]
  $cond?: { if: MongoFilter; then: unknown; else: unknown }
  $ifNull?: [string, unknown]
  $arrayElemAt?: [string, number]
  $size?: string
  $literal?: unknown
}

/** Unwind specification */
export interface UnwindSpec {
  path: string
  preserveNullAndEmptyArrays?: boolean
  includeArrayIndex?: string
}

/** Lookup specification */
export interface LookupSpec {
  from: string
  localField: string
  foreignField: string
  as: string
}

/** Document type */
export type Document = Record<string, unknown>

/** Lookup resolver function */
export type LookupResolver = (collection: string, filter: MongoFilter) => Promise<Document[]>

// ============================================================================
// Aggregation Pipeline
// ============================================================================

export class AggregationPipeline {
  private queryParser = new QueryParser()

  /**
   * Execute an aggregation pipeline on documents
   */
  async execute(
    docs: Document[],
    pipeline: AggregationStage[],
    lookupResolver?: LookupResolver
  ): Promise<Document[]> {
    let result = [...docs]

    for (const stage of pipeline) {
      result = await this.executeStage(result, stage, lookupResolver)
    }

    return result
  }

  /**
   * Execute a single pipeline stage
   */
  private async executeStage(
    docs: Document[],
    stage: AggregationStage,
    lookupResolver?: LookupResolver
  ): Promise<Document[]> {
    const stageType = Object.keys(stage)[0] as keyof AggregationStage
    const stageValue = (stage as Record<string, unknown>)[stageType]

    switch (stageType) {
      case '$match':
        return this.executeMatch(docs, stageValue as MongoFilter)

      case '$group':
        return this.executeGroup(docs, stageValue as GroupSpec)

      case '$sort':
        return this.executeSort(docs, stageValue as SortSpec)

      case '$project':
        return this.executeProject(docs, stageValue as ProjectSpec)

      case '$limit':
        return docs.slice(0, stageValue as number)

      case '$skip':
        return docs.slice(stageValue as number)

      case '$unwind':
        return this.executeUnwind(docs, stageValue as string | UnwindSpec)

      case '$lookup':
        return this.executeLookup(docs, stageValue as LookupSpec, lookupResolver)

      case '$count':
        return [{ [stageValue as string]: docs.length }]

      case '$addFields':
      case '$set':
        return this.executeAddFields(docs, stageValue as Record<string, unknown>)

      case '$replaceRoot':
        return this.executeReplaceRoot(docs, (stageValue as { newRoot: string | Record<string, unknown> }).newRoot)

      case '$sample':
        return this.executeSample(docs, (stageValue as { size: number }).size)

      default:
        console.warn(`Unknown aggregation stage: ${stageType}`)
        return docs
    }
  }

  /**
   * Execute $match stage
   */
  private executeMatch(docs: Document[], filter: MongoFilter): Document[] {
    return docs.filter(doc => this.matchesFilter(doc, filter))
  }

  /**
   * Execute $group stage
   */
  private executeGroup(docs: Document[], spec: GroupSpec): Document[] {
    const groups = new Map<string, Document[]>()

    // Group documents by _id
    for (const doc of docs) {
      const groupKey = this.computeGroupKey(doc, spec._id)
      const keyStr = JSON.stringify(groupKey)

      if (!groups.has(keyStr)) {
        groups.set(keyStr, [])
      }
      groups.get(keyStr)!.push(doc)
    }

    // Compute aggregations for each group
    const results: Document[] = []
    for (const [keyStr, groupDocs] of groups) {
      const result: Document = { _id: JSON.parse(keyStr) }

      for (const [field, accumulator] of Object.entries(spec)) {
        if (field === '_id') continue

        result[field] = this.computeAccumulator(groupDocs, accumulator as AccumulatorSpec)
      }

      results.push(result)
    }

    return results
  }

  /**
   * Compute group key from _id expression
   */
  private computeGroupKey(doc: Document, idExpr: string | Record<string, string> | null): unknown {
    if (idExpr === null) {
      return null
    }

    if (typeof idExpr === 'string') {
      if (idExpr.startsWith('$')) {
        return this.getNestedValue(doc, idExpr.slice(1))
      }
      return idExpr
    }

    // Compound key
    const key: Record<string, unknown> = {}
    for (const [field, expr] of Object.entries(idExpr)) {
      if (typeof expr === 'string' && expr.startsWith('$')) {
        key[field] = this.getNestedValue(doc, expr.slice(1))
      } else {
        key[field] = expr
      }
    }
    return key
  }

  /**
   * Compute accumulator value
   */
  private computeAccumulator(docs: Document[], accumulator: AccumulatorSpec): unknown {
    const accType = Object.keys(accumulator)[0]
    const accValue = (accumulator as Record<string, unknown>)[accType]

    switch (accType) {
      case '$sum': {
        if (typeof accValue === 'number') {
          return accValue * docs.length
        }
        const fieldPath = this.getFieldPath(accValue)
        return docs.reduce((sum, d) => {
          const val = this.getNestedValue(d, fieldPath)
          return sum + (typeof val === 'number' ? val : 0)
        }, 0)
      }

      case '$avg': {
        const fieldPath = this.getFieldPath(accValue)
        const values = docs
          .map(d => this.getNestedValue(d, fieldPath))
          .filter(v => typeof v === 'number') as number[]
        if (values.length === 0) return null
        return values.reduce((a, b) => a + b, 0) / values.length
      }

      case '$min': {
        const fieldPath = this.getFieldPath(accValue)
        return docs.reduce((min, d) => {
          const val = this.getNestedValue(d, fieldPath)
          if (min === undefined || this.compareValues(val, min) < 0) return val
          return min
        }, undefined as unknown)
      }

      case '$max': {
        const fieldPath = this.getFieldPath(accValue)
        return docs.reduce((max, d) => {
          const val = this.getNestedValue(d, fieldPath)
          if (max === undefined || this.compareValues(val, max) > 0) return val
          return max
        }, undefined as unknown)
      }

      case '$first': {
        const fieldPath = this.getFieldPath(accValue)
        if (docs.length === 0) return null
        return this.getNestedValue(docs[0], fieldPath)
      }

      case '$last': {
        const fieldPath = this.getFieldPath(accValue)
        if (docs.length === 0) return null
        return this.getNestedValue(docs[docs.length - 1], fieldPath)
      }

      case '$push': {
        if (typeof accValue === 'string') {
          const fieldPath = this.getFieldPath(accValue)
          return docs.map(d => this.getNestedValue(d, fieldPath))
        }
        // Push object expression
        return docs.map(d => {
          const obj: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(accValue as Record<string, string>)) {
            const fieldPath = this.getFieldPath(v)
            obj[k] = this.getNestedValue(d, fieldPath)
          }
          return obj
        })
      }

      case '$addToSet': {
        const fieldPath = this.getFieldPath(accValue)
        const values: unknown[] = []
        for (const d of docs) {
          const val = this.getNestedValue(d, fieldPath)
          if (!values.some(v => this.deepEquals(v, val))) {
            values.push(val)
          }
        }
        return values
      }

      case '$count':
        return docs.length

      case '$stdDevPop': {
        const fieldPath = this.getFieldPath(accValue)
        const values = docs
          .map(d => this.getNestedValue(d, fieldPath))
          .filter(v => typeof v === 'number') as number[]
        if (values.length === 0) return null
        const mean = values.reduce((a, b) => a + b, 0) / values.length
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
        return Math.sqrt(variance)
      }

      case '$stdDevSamp': {
        const fieldPath = this.getFieldPath(accValue)
        const values = docs
          .map(d => this.getNestedValue(d, fieldPath))
          .filter(v => typeof v === 'number') as number[]
        if (values.length <= 1) return null
        const mean = values.reduce((a, b) => a + b, 0) / values.length
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1)
        return Math.sqrt(variance)
      }

      default:
        return null
    }
  }

  /**
   * Execute $sort stage
   */
  private executeSort(docs: Document[], sort: SortSpec): Document[] {
    const sortEntries = Object.entries(sort)

    return [...docs].sort((a, b) => {
      for (const [field, direction] of sortEntries) {
        const aVal = this.getNestedValue(a, field)
        const bVal = this.getNestedValue(b, field)
        const cmp = this.compareValues(aVal, bVal)
        if (cmp !== 0) {
          return direction === 1 ? cmp : -cmp
        }
      }
      return 0
    })
  }

  /**
   * Execute $project stage
   */
  private executeProject(docs: Document[], spec: ProjectSpec): Document[] {
    const entries = Object.entries(spec)
    const hasInclusion = entries.some(([k, v]) => v === 1 && k !== '_id')
    const hasExclusion = entries.some(([k, v]) => v === 0 && k !== '_id')

    return docs.map(doc => {
      const result: Document = {}

      if (hasInclusion && !hasExclusion) {
        // Inclusion mode
        for (const [field, value] of entries) {
          if (value === 0) {
            continue
          }
          if (value === 1) {
            const val = this.getNestedValue(doc, field)
            if (val !== undefined) {
              this.setNestedValue(result, field, val)
            }
          } else if (typeof value === 'string' && value.startsWith('$')) {
            result[field] = this.getNestedValue(doc, value.slice(1))
          } else if (typeof value === 'object') {
            result[field] = this.evaluateExpression(doc, value as ProjectExpr)
          }
        }

        // Always include _id unless explicitly excluded
        if (spec._id !== 0) {
          result._id = doc._id
        }
      } else {
        // Exclusion mode or mixed
        Object.assign(result, JSON.parse(JSON.stringify(doc)))
        for (const [field, value] of entries) {
          if (value === 0) {
            delete result[field]
          } else if (typeof value === 'object') {
            result[field] = this.evaluateExpression(doc, value as ProjectExpr)
          }
        }
      }

      return result
    })
  }

  /**
   * Evaluate a projection expression
   */
  private evaluateExpression(doc: Document, expr: ProjectExpr | Record<string, unknown>): unknown {
    if (typeof expr === 'string') {
      if (expr.startsWith('$')) {
        return this.getNestedValue(doc, expr.slice(1))
      }
      return expr
    }

    if (typeof expr !== 'object' || expr === null) {
      return expr
    }

    const exprObj = expr as ProjectExpr

    if ('$concat' in exprObj) {
      return exprObj.$concat!.map(e => String(this.evaluateExpression(doc, e as ProjectExpr))).join('')
    }

    if ('$substr' in exprObj) {
      const [fieldExpr, start, length] = exprObj.$substr!
      const str = String(this.evaluateExpression(doc, fieldExpr as unknown as ProjectExpr))
      return str.substring(start, start + length)
    }

    if ('$toUpper' in exprObj) {
      const val = this.evaluateExpression(doc, exprObj.$toUpper as unknown as ProjectExpr)
      return String(val).toUpperCase()
    }

    if ('$toLower' in exprObj) {
      const val = this.evaluateExpression(doc, exprObj.$toLower as unknown as ProjectExpr)
      return String(val).toLowerCase()
    }

    if ('$add' in exprObj) {
      return exprObj.$add!.reduce((sum: number, e) => {
        const val = this.evaluateExpression(doc, e as ProjectExpr)
        return sum + (typeof val === 'number' ? val : 0)
      }, 0)
    }

    if ('$subtract' in exprObj) {
      const [a, b] = exprObj.$subtract!
      const aVal = this.evaluateExpression(doc, a as ProjectExpr)
      const bVal = this.evaluateExpression(doc, b as ProjectExpr)
      return (aVal as number) - (bVal as number)
    }

    if ('$multiply' in exprObj) {
      return exprObj.$multiply!.reduce((prod: number, e) => {
        const val = this.evaluateExpression(doc, e as ProjectExpr)
        return prod * (typeof val === 'number' ? val : 0)
      }, 1)
    }

    if ('$divide' in exprObj) {
      const [a, b] = exprObj.$divide!
      const aVal = this.evaluateExpression(doc, a as ProjectExpr)
      const bVal = this.evaluateExpression(doc, b as ProjectExpr)
      return (aVal as number) / (bVal as number)
    }

    if ('$cond' in exprObj) {
      const { if: condition, then: thenVal, else: elseVal } = exprObj.$cond!
      const matches = this.matchesFilter(doc, condition)
      return matches
        ? this.evaluateExpression(doc, thenVal as ProjectExpr)
        : this.evaluateExpression(doc, elseVal as ProjectExpr)
    }

    if ('$ifNull' in exprObj) {
      const [fieldExpr, defaultVal] = exprObj.$ifNull!
      const val = this.evaluateExpression(doc, fieldExpr as unknown as ProjectExpr)
      return val ?? this.evaluateExpression(doc, defaultVal as ProjectExpr)
    }

    if ('$arrayElemAt' in exprObj) {
      const [arrExpr, index] = exprObj.$arrayElemAt!
      const arr = this.evaluateExpression(doc, arrExpr as unknown as ProjectExpr) as unknown[]
      if (!Array.isArray(arr)) return null
      const idx = index < 0 ? arr.length + index : index
      return arr[idx]
    }

    if ('$size' in exprObj) {
      const arr = this.evaluateExpression(doc, exprObj.$size as unknown as ProjectExpr) as unknown[]
      return Array.isArray(arr) ? arr.length : 0
    }

    if ('$literal' in exprObj) {
      return exprObj.$literal
    }

    // Unknown expression - return as is
    return expr
  }

  /**
   * Execute $unwind stage
   */
  private executeUnwind(docs: Document[], spec: string | UnwindSpec): Document[] {
    const path = typeof spec === 'string' ? spec : spec.path
    const preserveNull = typeof spec === 'object' && spec.preserveNullAndEmptyArrays
    const indexField = typeof spec === 'object' ? spec.includeArrayIndex : undefined

    const fieldPath = path.startsWith('$') ? path.slice(1) : path
    const results: Document[] = []

    for (const doc of docs) {
      const arr = this.getNestedValue(doc, fieldPath)

      if (!Array.isArray(arr) || arr.length === 0) {
        if (preserveNull) {
          const newDoc = JSON.parse(JSON.stringify(doc))
          this.setNestedValue(newDoc, fieldPath, null)
          if (indexField) {
            newDoc[indexField] = null
          }
          results.push(newDoc)
        }
        continue
      }

      for (let i = 0; i < arr.length; i++) {
        const newDoc = JSON.parse(JSON.stringify(doc))
        this.setNestedValue(newDoc, fieldPath, arr[i])
        if (indexField) {
          newDoc[indexField] = i
        }
        results.push(newDoc)
      }
    }

    return results
  }

  /**
   * Execute $lookup stage
   */
  private async executeLookup(
    docs: Document[],
    spec: LookupSpec,
    lookupResolver?: LookupResolver
  ): Promise<Document[]> {
    if (!lookupResolver) {
      // Without resolver, return docs with empty lookup results
      return docs.map(doc => ({ ...doc, [spec.as]: [] }))
    }

    const results: Document[] = []

    for (const doc of docs) {
      const localValue = this.getNestedValue(doc, spec.localField)

      // Build filter for foreign collection
      const filter: MongoFilter = {
        [spec.foreignField]: localValue,
      }

      const foreignDocs = await lookupResolver(spec.from, filter)
      results.push({ ...doc, [spec.as]: foreignDocs })
    }

    return results
  }

  /**
   * Execute $addFields / $set stage
   */
  private executeAddFields(docs: Document[], fields: Record<string, unknown>): Document[] {
    return docs.map(doc => {
      const result = { ...doc }
      for (const [field, value] of Object.entries(fields)) {
        if (typeof value === 'string' && value.startsWith('$')) {
          result[field] = this.getNestedValue(doc, value.slice(1))
        } else if (typeof value === 'object' && value !== null) {
          result[field] = this.evaluateExpression(doc, value as ProjectExpr)
        } else {
          result[field] = value
        }
      }
      return result
    })
  }

  /**
   * Execute $replaceRoot stage
   */
  private executeReplaceRoot(docs: Document[], newRoot: string | Record<string, unknown>): Document[] {
    return docs.map(doc => {
      if (typeof newRoot === 'string') {
        const path = newRoot.startsWith('$') ? newRoot.slice(1) : newRoot
        const root = this.getNestedValue(doc, path)
        return (typeof root === 'object' && root !== null ? root : {}) as Document
      }
      // Expression object
      const result: Document = {}
      for (const [field, value] of Object.entries(newRoot)) {
        if (typeof value === 'string' && value.startsWith('$')) {
          result[field] = this.getNestedValue(doc, value.slice(1))
        } else {
          result[field] = value
        }
      }
      return result
    })
  }

  /**
   * Execute $sample stage
   */
  private executeSample(docs: Document[], size: number): Document[] {
    if (size >= docs.length) return [...docs]

    // Fisher-Yates shuffle and take first `size` elements
    const shuffled = [...docs]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled.slice(0, size)
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Check if document matches filter
   */
  private matchesFilter(doc: Document, filter: MongoFilter): boolean {
    for (const [key, value] of Object.entries(filter)) {
      // Handle logical operators
      if (key === '$and') {
        if (!(value as MongoFilter[]).every(f => this.matchesFilter(doc, f))) {
          return false
        }
        continue
      }
      if (key === '$or') {
        if (!(value as MongoFilter[]).some(f => this.matchesFilter(doc, f))) {
          return false
        }
        continue
      }
      if (key === '$nor') {
        if ((value as MongoFilter[]).some(f => this.matchesFilter(doc, f))) {
          return false
        }
        continue
      }
      if (key === '$not') {
        if (this.matchesFilter(doc, value as MongoFilter)) {
          return false
        }
        continue
      }

      // Field condition
      const fieldValue = this.getNestedValue(doc, key)
      if (!this.matchesCondition(fieldValue, value)) {
        return false
      }
    }
    return true
  }

  /**
   * Check if value matches condition
   */
  private matchesCondition(value: unknown, condition: unknown): boolean {
    // Direct equality
    if (condition === null) {
      return value === null || value === undefined
    }

    if (typeof condition !== 'object' || condition instanceof Date || condition instanceof RegExp) {
      if (condition instanceof RegExp) {
        return typeof value === 'string' && condition.test(value)
      }
      return this.deepEquals(value, condition)
    }

    // Array membership check
    if (Array.isArray(value) && !Array.isArray(condition) && typeof condition !== 'object') {
      return value.includes(condition)
    }

    // Operator expression
    const ops = condition as Record<string, unknown>

    for (const [op, opValue] of Object.entries(ops)) {
      if (!op.startsWith('$')) continue

      switch (op) {
        case '$eq':
          if (!this.deepEquals(value, opValue)) return false
          break
        case '$ne':
          if (this.deepEquals(value, opValue)) return false
          break
        case '$gt':
          if (this.compareValues(value, opValue) <= 0) return false
          break
        case '$gte':
          if (this.compareValues(value, opValue) < 0) return false
          break
        case '$lt':
          if (this.compareValues(value, opValue) >= 0) return false
          break
        case '$lte':
          if (this.compareValues(value, opValue) > 0) return false
          break
        case '$in':
          if (!(opValue as unknown[]).some(v => this.deepEquals(value, v))) return false
          break
        case '$nin':
          if ((opValue as unknown[]).some(v => this.deepEquals(value, v))) return false
          break
        case '$exists':
          if (opValue ? value === undefined : value !== undefined) return false
          break
        case '$regex': {
          if (typeof value !== 'string') return false
          const regex = opValue instanceof RegExp ? opValue : new RegExp(opValue as string, ops.$options as string)
          if (!regex.test(value)) return false
          break
        }
        case '$size':
          if (!Array.isArray(value) || value.length !== opValue) return false
          break
        case '$all':
          if (!Array.isArray(value) || !(opValue as unknown[]).every(v => value.some(ve => this.deepEquals(ve, v)))) return false
          break
        case '$elemMatch':
          if (!Array.isArray(value) || !value.some(v => this.matchesFilter(v as Document, opValue as MongoFilter))) return false
          break
      }
    }

    return true
  }

  /**
   * Get field path from expression
   */
  private getFieldPath(expr: unknown): string {
    if (typeof expr === 'string') {
      return expr.startsWith('$') ? expr.slice(1) : expr
    }
    return ''
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }
    return current
  }

  /**
   * Set nested value in object
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }
    current[parts[parts.length - 1]] = value
  }

  /**
   * Compare two values
   */
  private compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === null || a === undefined) return -1
    if (b === null || b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    return String(a).localeCompare(String(b))
  }

  /**
   * Deep equality check
   */
  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a === null || b === null) return a === b
    if (a === undefined || b === undefined) return a === b

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime()
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((v, i) => this.deepEquals(v, b[i]))
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a as object)
      const keysB = Object.keys(b as object)
      if (keysA.length !== keysB.length) return false
      return keysA.every(key =>
        this.deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
      )
    }

    return false
  }
}

// ============================================================================
// Exports
// ============================================================================

export const aggregationPipeline = new AggregationPipeline()

/**
 * MongoDB Aggregation Pipeline using AggPipeline Primitive
 *
 * Leverages the unified AggPipeline to execute MongoDB-style aggregation
 * operations on document collections.
 *
 * @module db/compat/mongodb/aggregation
 */

import {
  createPipeline,
  PipelineBuilder,
  createMatchStage,
  createGroupStage,
  createProjectStage,
  createSortStage,
  createLimitStage,
  createSkipStage,
  type Stage,
  type Pipeline,
  type MatchPredicate,
  type GroupSpec,
  type ProjectSpec,
  type SortSpec,
} from '../../primitives/aggregation-pipeline'
import { evaluateFilterDirect } from './query'
import type {
  Document,
  PipelineStage,
  MatchStage as MongoMatchStage,
  GroupStage as MongoGroupStage,
  ProjectStage as MongoProjectStage,
  SortStage as MongoSortStage,
  LimitStage as MongoLimitStage,
  SkipStage as MongoSkipStage,
  UnwindStage as MongoUnwindStage,
  CountStage as MongoCountStage,
  AddFieldsStage as MongoAddFieldsStage,
  SetStage as MongoSetStage,
  FacetStage as MongoFacetStage,
  BucketStage as MongoBucketStage,
  ReplaceRootStage as MongoReplaceRootStage,
  ReplaceWithStage as MongoReplaceWithStage,
  SampleStage as MongoSampleStage,
  SortDirection,
  WithId,
  Filter,
} from './types'

// ============================================================================
// Pipeline Executor
// ============================================================================

/**
 * MongoDB-compatible aggregation pipeline executor using the unified primitives
 */
export class AggregationExecutor<T extends Document = Document> {
  /**
   * Execute an aggregation pipeline on documents
   */
  execute<R extends Document = Document>(
    pipeline: PipelineStage<T>[],
    documents: WithId<T>[]
  ): R[] {
    let result: Document[] = [...documents]

    for (const stage of pipeline) {
      result = this.executeStage(stage, result)
    }

    return result as R[]
  }

  /**
   * Execute a single pipeline stage
   */
  private executeStage(stage: PipelineStage<T>, documents: Document[]): Document[] {
    // Handle each stage type
    if ('$match' in stage) {
      return this.executeMatch(stage, documents)
    }
    if ('$group' in stage) {
      return this.executeGroup(stage, documents)
    }
    if ('$project' in stage) {
      return this.executeProject(stage, documents)
    }
    if ('$sort' in stage) {
      return this.executeSort(stage, documents)
    }
    if ('$limit' in stage) {
      return this.executeLimit(stage, documents)
    }
    if ('$skip' in stage) {
      return this.executeSkip(stage, documents)
    }
    if ('$unwind' in stage) {
      return this.executeUnwind(stage as MongoUnwindStage, documents)
    }
    if ('$count' in stage) {
      return this.executeCount(stage as MongoCountStage, documents)
    }
    if ('$addFields' in stage) {
      return this.executeAddFields(stage as MongoAddFieldsStage, documents)
    }
    if ('$set' in stage) {
      return this.executeSet(stage as MongoSetStage, documents)
    }
    if ('$facet' in stage) {
      return this.executeFacet(stage as unknown as MongoFacetStage<T>, documents)
    }
    if ('$bucket' in stage) {
      return this.executeBucket(stage as MongoBucketStage, documents)
    }
    if ('$replaceRoot' in stage) {
      return this.executeReplaceRoot(stage as MongoReplaceRootStage, documents)
    }
    if ('$replaceWith' in stage) {
      return this.executeReplaceWith(stage as MongoReplaceWithStage, documents)
    }
    if ('$sample' in stage) {
      return this.executeSample(stage as MongoSampleStage, documents)
    }

    // Unknown stage - pass through
    return documents
  }

  /**
   * Execute $match stage
   */
  private executeMatch(stage: MongoMatchStage<T>, documents: Document[]): Document[] {
    const filter = stage.$match as Filter<Document>
    return documents.filter((doc) => evaluateFilterDirect(filter, doc as WithId<Document>))
  }

  /**
   * Execute $group stage
   */
  private executeGroup(stage: MongoGroupStage, documents: Document[]): Document[] {
    const groupSpec = stage.$group
    const groups = new Map<string, Document[]>()

    // Group documents by _id expression
    for (const doc of documents) {
      const groupKey = this.evaluateGroupKey(groupSpec._id, doc)
      const keyStr = JSON.stringify(groupKey)

      if (!groups.has(keyStr)) {
        groups.set(keyStr, [])
      }
      groups.get(keyStr)!.push(doc)
    }

    // Apply accumulators to each group
    const result: Document[] = []

    for (const [keyStr, groupDocs] of groups) {
      const groupResult: Document = {
        _id: JSON.parse(keyStr),
      }

      // Process each field accumulator
      for (const [field, accumulator] of Object.entries(groupSpec)) {
        if (field === '_id') continue

        groupResult[field] = this.evaluateAccumulator(accumulator, groupDocs)
      }

      result.push(groupResult)
    }

    return result
  }

  /**
   * Evaluate a group key expression
   */
  private evaluateGroupKey(keyExpr: unknown, doc: Document): unknown {
    // Null literal
    if (keyExpr === null) {
      return keyExpr
    }

    // Field reference (string starting with $)
    if (typeof keyExpr === 'string' && keyExpr.startsWith('$')) {
      return this.getFieldValue(doc, keyExpr.slice(1))
    }

    // Non-object literal value (number, boolean, plain string)
    if (typeof keyExpr !== 'object') {
      return keyExpr
    }

    // Object expression (compound key)
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(keyExpr)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        result[key] = this.getFieldValue(doc, value.slice(1))
      } else {
        result[key] = value
      }
    }
    return result
  }

  /**
   * Evaluate an accumulator expression
   */
  private evaluateAccumulator(accumulator: unknown, docs: Document[]): unknown {
    if (typeof accumulator !== 'object' || accumulator === null) {
      return accumulator
    }

    const accObj = accumulator as Record<string, unknown>

    // $sum accumulator
    if ('$sum' in accObj) {
      return this.evaluateSum(accObj.$sum, docs)
    }

    // $avg accumulator
    if ('$avg' in accObj) {
      return this.evaluateAvg(accObj.$avg, docs)
    }

    // $min accumulator
    if ('$min' in accObj) {
      return this.evaluateMin(accObj.$min, docs)
    }

    // $max accumulator
    if ('$max' in accObj) {
      return this.evaluateMax(accObj.$max, docs)
    }

    // $first accumulator
    if ('$first' in accObj) {
      return this.evaluateFirst(accObj.$first, docs)
    }

    // $last accumulator
    if ('$last' in accObj) {
      return this.evaluateLast(accObj.$last, docs)
    }

    // $push accumulator
    if ('$push' in accObj) {
      return this.evaluatePush(accObj.$push, docs)
    }

    // $addToSet accumulator
    if ('$addToSet' in accObj) {
      return this.evaluateAddToSet(accObj.$addToSet, docs)
    }

    // $count accumulator
    if ('$count' in accObj) {
      return docs.length
    }

    return null
  }

  private evaluateSum(expr: unknown, docs: Document[]): number {
    // Constant value
    if (typeof expr === 'number') {
      return expr * docs.length
    }

    // Field reference
    if (typeof expr === 'string' && expr.startsWith('$')) {
      const field = expr.slice(1)
      return docs.reduce((sum, doc) => {
        const value = this.getFieldValue(doc, field)
        return sum + (typeof value === 'number' ? value : 0)
      }, 0)
    }

    // Expression object
    if (typeof expr === 'object' && expr !== null) {
      return docs.reduce((sum, doc) => {
        const value = this.evaluateExpression(expr, doc)
        return sum + (typeof value === 'number' ? value : 0)
      }, 0)
    }

    return 0
  }

  private evaluateAvg(expr: unknown, docs: Document[]): number | null {
    if (docs.length === 0) return null

    const sum = this.evaluateSum(expr, docs)
    return sum / docs.length
  }

  private evaluateMin(expr: unknown, docs: Document[]): unknown {
    if (docs.length === 0) return null

    let min: unknown = undefined

    for (const doc of docs) {
      const value = typeof expr === 'string' && expr.startsWith('$')
        ? this.getFieldValue(doc, expr.slice(1))
        : this.evaluateExpression(expr, doc)

      if (value !== undefined && value !== null) {
        if (min === undefined || this.compareValues(value, min) < 0) {
          min = value
        }
      }
    }

    return min
  }

  private evaluateMax(expr: unknown, docs: Document[]): unknown {
    if (docs.length === 0) return null

    let max: unknown = undefined

    for (const doc of docs) {
      const value = typeof expr === 'string' && expr.startsWith('$')
        ? this.getFieldValue(doc, expr.slice(1))
        : this.evaluateExpression(expr, doc)

      if (value !== undefined && value !== null) {
        if (max === undefined || this.compareValues(value, max) > 0) {
          max = value
        }
      }
    }

    return max
  }

  private evaluateFirst(expr: unknown, docs: Document[]): unknown {
    if (docs.length === 0) return null

    const doc = docs[0]!
    return typeof expr === 'string' && expr.startsWith('$')
      ? this.getFieldValue(doc, expr.slice(1))
      : this.evaluateExpression(expr, doc)
  }

  private evaluateLast(expr: unknown, docs: Document[]): unknown {
    if (docs.length === 0) return null

    const doc = docs[docs.length - 1]!
    return typeof expr === 'string' && expr.startsWith('$')
      ? this.getFieldValue(doc, expr.slice(1))
      : this.evaluateExpression(expr, doc)
  }

  private evaluatePush(expr: unknown, docs: Document[]): unknown[] {
    return docs.map((doc) => {
      if (typeof expr === 'string' && expr.startsWith('$')) {
        return this.getFieldValue(doc, expr.slice(1))
      }
      return this.evaluateExpression(expr, doc)
    })
  }

  private evaluateAddToSet(expr: unknown, docs: Document[]): unknown[] {
    const values = this.evaluatePush(expr, docs)
    const seen = new Set<string>()
    const result: unknown[] = []

    for (const value of values) {
      const key = JSON.stringify(value)
      if (!seen.has(key)) {
        seen.add(key)
        result.push(value)
      }
    }

    return result
  }

  /**
   * Execute $project stage
   */
  private executeProject(stage: MongoProjectStage<T>, documents: Document[]): Document[] {
    const projectSpec = stage.$project

    return documents.map((doc) => {
      const result: Document = {}

      // Determine include/exclude mode
      const hasInclusions = Object.values(projectSpec).some((v) => v === 1 || v === true)
      const hasExclusions = Object.values(projectSpec).some((v) => v === 0 || v === false)

      // Handle _id field
      const idSpec = projectSpec._id as unknown
      if (idSpec === 0 || idSpec === false) {
        // Exclude _id
      } else if (hasInclusions) {
        // In inclusion mode, include _id by default
        if ('_id' in doc) {
          result._id = doc._id
        }
      }

      if (hasInclusions) {
        // Inclusion mode: only include specified fields
        for (const [key, value] of Object.entries(projectSpec)) {
          if (key === '_id') continue

          if (value === 1 || value === true) {
            if (key in doc) {
              result[key] = doc[key]
            }
          } else if (typeof value === 'object' && value !== null) {
            // Computed field
            result[key] = this.evaluateExpression(value, doc)
          }
        }
      } else if (hasExclusions) {
        // Exclusion mode: include all except specified fields
        for (const [key, value] of Object.entries(doc)) {
          if (key === '_id' && (idSpec === 0 || idSpec === false)) continue
          if (key in projectSpec && (projectSpec[key] === 0 || projectSpec[key] === false)) continue
          result[key] = value
        }
      } else {
        // Computed fields only
        for (const [key, value] of Object.entries(projectSpec)) {
          if (typeof value === 'object' && value !== null) {
            result[key] = this.evaluateExpression(value, doc)
          }
        }
      }

      return result
    })
  }

  /**
   * Execute $sort stage
   */
  private executeSort(stage: MongoSortStage<T>, documents: Document[]): Document[] {
    const sortSpec = stage.$sort

    return [...documents].sort((a, b) => {
      for (const [field, direction] of Object.entries(sortSpec)) {
        const dir = this.normalizeSortDirection(direction as SortDirection)
        const aValue = this.getFieldValue(a, field)
        const bValue = this.getFieldValue(b, field)
        const cmp = this.compareValues(aValue, bValue)

        if (cmp !== 0) {
          return cmp * dir
        }
      }
      return 0
    })
  }

  /**
   * Execute $limit stage
   */
  private executeLimit(stage: MongoLimitStage, documents: Document[]): Document[] {
    return documents.slice(0, stage.$limit)
  }

  /**
   * Execute $skip stage
   */
  private executeSkip(stage: MongoSkipStage, documents: Document[]): Document[] {
    return documents.slice(stage.$skip)
  }

  /**
   * Execute $unwind stage
   */
  private executeUnwind(stage: MongoUnwindStage, documents: Document[]): Document[] {
    const unwindSpec = stage.$unwind
    const path = typeof unwindSpec === 'string' ? unwindSpec : unwindSpec.path
    const field = path.startsWith('$') ? path.slice(1) : path
    const preserveNullAndEmpty = typeof unwindSpec === 'object' ? unwindSpec.preserveNullAndEmptyArrays : false
    const includeArrayIndex = typeof unwindSpec === 'object' ? unwindSpec.includeArrayIndex : undefined

    const result: Document[] = []

    for (const doc of documents) {
      const arrayValue = this.getFieldValue(doc, field)

      if (!Array.isArray(arrayValue)) {
        if (preserveNullAndEmpty) {
          const unwound = { ...doc }
          if (arrayValue === null || arrayValue === undefined) {
            this.setFieldValue(unwound, field, null)
          }
          result.push(unwound)
        }
        continue
      }

      if (arrayValue.length === 0) {
        if (preserveNullAndEmpty) {
          const unwound = { ...doc }
          this.setFieldValue(unwound, field, null)
          result.push(unwound)
        }
        continue
      }

      for (let i = 0; i < arrayValue.length; i++) {
        const unwound = { ...doc }
        this.setFieldValue(unwound, field, arrayValue[i])
        if (includeArrayIndex) {
          unwound[includeArrayIndex] = i
        }
        result.push(unwound)
      }
    }

    return result
  }

  /**
   * Execute $count stage
   */
  private executeCount(stage: MongoCountStage, documents: Document[]): Document[] {
    return [{ [stage.$count]: documents.length }]
  }

  /**
   * Execute $addFields stage
   */
  private executeAddFields(stage: MongoAddFieldsStage, documents: Document[]): Document[] {
    return documents.map((doc) => {
      const result = { ...doc }
      for (const [key, expr] of Object.entries(stage.$addFields)) {
        result[key] = this.evaluateExpression(expr, doc)
      }
      return result
    })
  }

  /**
   * Execute $set stage (alias for $addFields)
   */
  private executeSet(stage: MongoSetStage, documents: Document[]): Document[] {
    return this.executeAddFields({ $addFields: stage.$set }, documents)
  }

  /**
   * Evaluate an expression
   */
  private evaluateExpression(expr: unknown, doc: Document): unknown {
    // Field reference
    if (typeof expr === 'string' && expr.startsWith('$')) {
      return this.getFieldValue(doc, expr.slice(1))
    }

    // Literal value
    if (typeof expr !== 'object' || expr === null) {
      return expr
    }

    const exprObj = expr as Record<string, unknown>

    // $multiply
    if ('$multiply' in exprObj && Array.isArray(exprObj.$multiply)) {
      return exprObj.$multiply.reduce<number>((product, operand) => {
        const value = this.evaluateExpression(operand, doc)
        return product * (typeof value === 'number' ? value : 0)
      }, 1)
    }

    // $add
    if ('$add' in exprObj && Array.isArray(exprObj.$add)) {
      return exprObj.$add.reduce<number>((sum, operand) => {
        const value = this.evaluateExpression(operand, doc)
        return sum + (typeof value === 'number' ? value : 0)
      }, 0)
    }

    // $subtract
    if ('$subtract' in exprObj && Array.isArray(exprObj.$subtract) && exprObj.$subtract.length === 2) {
      const left = this.evaluateExpression(exprObj.$subtract[0], doc)
      const right = this.evaluateExpression(exprObj.$subtract[1], doc)
      return (typeof left === 'number' ? left : 0) - (typeof right === 'number' ? right : 0)
    }

    // $divide
    if ('$divide' in exprObj && Array.isArray(exprObj.$divide) && exprObj.$divide.length === 2) {
      const left = this.evaluateExpression(exprObj.$divide[0], doc)
      const right = this.evaluateExpression(exprObj.$divide[1], doc)
      return (typeof left === 'number' ? left : 0) / (typeof right === 'number' ? right : 1)
    }

    // $concat
    if ('$concat' in exprObj && Array.isArray(exprObj.$concat)) {
      return exprObj.$concat.map((operand) => {
        const value = this.evaluateExpression(operand, doc)
        return typeof value === 'string' ? value : ''
      }).join('')
    }

    // $literal
    if ('$literal' in exprObj) {
      return exprObj.$literal
    }

    // $cond
    if ('$cond' in exprObj) {
      const cond = exprObj.$cond
      if (Array.isArray(cond) && cond.length === 3) {
        const condition = this.evaluateExpression(cond[0], doc)
        return condition ? this.evaluateExpression(cond[1], doc) : this.evaluateExpression(cond[2], doc)
      }
      if (typeof cond === 'object' && cond !== null) {
        const condObj = cond as Record<string, unknown>
        const condition = this.evaluateExpression(condObj.if, doc)
        return condition ? this.evaluateExpression(condObj.then, doc) : this.evaluateExpression(condObj.else, doc)
      }
    }

    // $ifNull
    if ('$ifNull' in exprObj && Array.isArray(exprObj.$ifNull) && exprObj.$ifNull.length === 2) {
      const value = this.evaluateExpression(exprObj.$ifNull[0], doc)
      return value === null || value === undefined ? this.evaluateExpression(exprObj.$ifNull[1], doc) : value
    }

    // Unknown expression - return as object
    return expr
  }

  /**
   * Get a field value from a document using dot notation
   */
  private getFieldValue(doc: Document, path: string): unknown {
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
   * Set a field value in a document using dot notation
   */
  private setFieldValue(doc: Document, path: string, value: unknown): void {
    const parts = path.split('.')
    let current: Record<string, unknown> = doc

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!
      if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    const lastPart = parts[parts.length - 1]!
    current[lastPart] = value
  }

  /**
   * Normalize sort direction to 1 or -1
   */
  private normalizeSortDirection(dir: SortDirection): 1 | -1 {
    if (dir === 1 || dir === 'asc' || dir === 'ascending') return 1
    if (dir === -1 || dir === 'desc' || dir === 'descending') return -1
    return 1
  }

  /**
   * Compare two values for sorting
   */
  private compareValues(a: unknown, b: unknown): number {
    // Handle nulls
    if (a === null || a === undefined) {
      if (b === null || b === undefined) return 0
      return -1
    }
    if (b === null || b === undefined) return 1

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
   * Execute $facet stage - run multiple pipelines in parallel
   */
  private executeFacet(stage: MongoFacetStage<T>, documents: Document[]): Document[] {
    const result: Document = {}

    for (const [facetName, pipeline] of Object.entries(stage.$facet)) {
      // Execute each sub-pipeline on a copy of the documents
      let facetResult: Document[] = [...documents]

      for (const subStage of pipeline) {
        facetResult = this.executeStage(subStage as PipelineStage<T>, facetResult)
      }

      result[facetName] = facetResult
    }

    // Facet returns a single document with all facet results
    return [result]
  }

  /**
   * Execute $bucket stage - categorize documents into buckets
   */
  private executeBucket(stage: MongoBucketStage, documents: Document[]): Document[] {
    const { groupBy, boundaries, default: defaultBucket, output } = stage.$bucket
    const buckets = new Map<unknown, Document[]>()

    // Initialize buckets based on boundaries
    for (let i = 0; i < boundaries.length - 1; i++) {
      const key = boundaries[i]
      buckets.set(JSON.stringify({ min: boundaries[i], max: boundaries[i + 1] }), [])
    }

    // Initialize default bucket if specified
    if (defaultBucket !== undefined) {
      buckets.set(JSON.stringify({ default: defaultBucket }), [])
    }

    // Assign documents to buckets
    for (const doc of documents) {
      const value = typeof groupBy === 'string' && groupBy.startsWith('$')
        ? this.getFieldValue(doc, groupBy.slice(1))
        : this.evaluateExpression(groupBy, doc)

      let assigned = false

      // Find matching bucket
      for (let i = 0; i < boundaries.length - 1; i++) {
        const min = boundaries[i]
        const max = boundaries[i + 1]

        if (this.compareValues(value, min) >= 0 && this.compareValues(value, max) < 0) {
          const key = JSON.stringify({ min, max })
          buckets.get(key)!.push(doc)
          assigned = true
          break
        }
      }

      // Assign to default bucket if not matched
      if (!assigned && defaultBucket !== undefined) {
        const key = JSON.stringify({ default: defaultBucket })
        buckets.get(key)!.push(doc)
      }
    }

    // Build result with output accumulators
    const result: Document[] = []

    for (let i = 0; i < boundaries.length - 1; i++) {
      const key = JSON.stringify({ min: boundaries[i], max: boundaries[i + 1] })
      const bucketDocs = buckets.get(key) || []

      const bucketResult: Document = {
        _id: boundaries[i],
        count: bucketDocs.length,
      }

      // Apply output accumulators
      if (output) {
        for (const [field, accumulator] of Object.entries(output)) {
          if (field !== 'count') {
            bucketResult[field] = this.evaluateAccumulator(accumulator, bucketDocs)
          }
        }
      }

      result.push(bucketResult)
    }

    // Add default bucket if it has documents
    if (defaultBucket !== undefined) {
      const key = JSON.stringify({ default: defaultBucket })
      const bucketDocs = buckets.get(key) || []

      if (bucketDocs.length > 0) {
        const bucketResult: Document = {
          _id: defaultBucket,
          count: bucketDocs.length,
        }

        if (output) {
          for (const [field, accumulator] of Object.entries(output)) {
            if (field !== 'count') {
              bucketResult[field] = this.evaluateAccumulator(accumulator, bucketDocs)
            }
          }
        }

        result.push(bucketResult)
      }
    }

    return result
  }

  /**
   * Execute $replaceRoot stage - replace document with embedded document
   */
  private executeReplaceRoot(stage: MongoReplaceRootStage, documents: Document[]): Document[] {
    return documents.map((doc) => {
      const newRoot = this.evaluateExpression(stage.$replaceRoot.newRoot, doc)

      if (typeof newRoot !== 'object' || newRoot === null) {
        throw new Error('$replaceRoot: newRoot must evaluate to an object')
      }

      return newRoot as Document
    }).filter((doc) => doc !== null)
  }

  /**
   * Execute $replaceWith stage - alias for $replaceRoot
   */
  private executeReplaceWith(stage: MongoReplaceWithStage, documents: Document[]): Document[] {
    return this.executeReplaceRoot({ $replaceRoot: { newRoot: stage.$replaceWith } }, documents)
  }

  /**
   * Execute $sample stage - randomly select documents
   */
  private executeSample(stage: MongoSampleStage, documents: Document[]): Document[] {
    const { size } = stage.$sample

    if (size >= documents.length) {
      return [...documents]
    }

    // Fisher-Yates shuffle and take first n
    const shuffled = [...documents]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = shuffled[i]!
      shuffled[i] = shuffled[j]!
      shuffled[j] = temp
    }

    return shuffled.slice(0, size)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an aggregation executor
 */
export function createAggregationExecutor<T extends Document = Document>(): AggregationExecutor<T> {
  return new AggregationExecutor<T>()
}

/**
 * Execute an aggregation pipeline
 */
export function executeAggregation<T extends Document = Document, R extends Document = Document>(
  pipeline: PipelineStage<T>[],
  documents: WithId<T>[]
): R[] {
  const executor = new AggregationExecutor<T>()
  return executor.execute<R>(pipeline, documents)
}

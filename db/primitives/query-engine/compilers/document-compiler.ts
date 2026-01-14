/**
 * Document Query Compiler
 *
 * Translates document queries from MongoDB, Mango (CouchDB), and DynamoDB
 * syntax to primitive operations (TypedColumnStore predicates and TemporalStore ranges).
 *
 * @see dotdo-4kx6k
 */

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  ComparisonOp,
  TemporalNode,
  TemporalQueryType,
} from '../ast'

// =============================================================================
// Types
// =============================================================================

/**
 * MongoDB-style document query
 */
export type DocumentQuery = Record<string, unknown>

/**
 * Mango selector syntax (CouchDB/Cloudant)
 */
export type MangoSelector = Record<string, unknown>

/**
 * DynamoDB query with KeyConditionExpression and FilterExpression
 */
export interface DynamoDBQuery {
  KeyConditionExpression: string
  FilterExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues: Record<string, unknown>
}

/**
 * Indexed field configuration for query planning
 */
export interface IndexedFieldConfig {
  field: string
  type: 'string' | 'number' | 'timestamp' | 'boolean'
  temporal?: boolean
}

/**
 * Compile options
 */
export interface CompileOptions {
  indexedFields?: IndexedFieldConfig[]
  /** Explicit temporal clause (AS OF) to apply */
  temporal?: TemporalNode
  /** Current timestamp for relative time calculations (defaults to Date.now()) */
  currentTimestamp?: number
}

/**
 * Indexed operation in the execution plan
 */
export interface IndexedOperation {
  field: string
  predicate: PredicateNode
}

/**
 * Temporal range for TemporalStore operations.
 *
 * Supports both time-based ranges and version-based ranges for time travel queries.
 */
export interface TemporalRange {
  /** Start timestamp (epoch ms) for range queries */
  start?: number
  /** End timestamp (epoch ms) for range queries */
  end?: number
  /** Snapshot ID for version-based queries */
  snapshotId?: number
  /** Query type (AS_OF, BEFORE, BETWEEN, VERSIONS_BETWEEN) */
  queryType?: TemporalQueryType
  /** Whether this is a materialized AS OF query */
  isMaterialized?: boolean
}

/**
 * Execution plan for the compiled query
 */
export interface ExecutionPlan {
  indexedOperations: IndexedOperation[]
  fullScanPredicates: PredicateNode[]
  temporalRange?: TemporalRange
  combineLogic: 'AND' | 'OR'
  requiresUnion?: boolean
}

/**
 * Regex options for compiled queries
 */
export interface RegexOptions {
  caseInsensitive?: boolean
}

/**
 * TypedColumnStore predicate format
 */
export interface TCSPredicate {
  column: string
  op: string
  value: unknown
}

/**
 * Compiled document query result
 */
export interface CompiledDocumentQuery {
  ast: QueryNode
  matchAll: boolean
  regexOptions?: RegexOptions
  plan: ExecutionPlan
  filterPredicates?: QueryNode[]
  filterLogicalOp?: 'AND' | 'OR'

  toTCSPredicates(): TCSPredicate[]
  toTemporalRange(): TemporalRange | undefined
}

// =============================================================================
// DocumentCompiler Class
// =============================================================================

/**
 * Compiles document queries to primitive operations
 */
export class DocumentCompiler {
  /**
   * Regex options detected during compilation
   */
  private detectedRegexOptions: RegexOptions | undefined

  /**
   * Compile a MongoDB-style document query
   */
  compile(query: DocumentQuery, options?: CompileOptions): CompiledDocumentQuery {
    const indexedFields = options?.indexedFields ?? []

    // Reset detected regex options
    this.detectedRegexOptions = undefined

    // Handle empty query (match all)
    if (Object.keys(query).length === 0) {
      return this.createMatchAllResult(indexedFields, options)
    }

    const ast = this.parseMongoQuery(query)
    const plan = this.createExecutionPlan(ast, indexedFields, options)

    return this.createResult(ast, plan, indexedFields, this.detectedRegexOptions)
  }

  /**
   * Compile a Mango selector (CouchDB/Cloudant syntax)
   */
  compileMango(selector: MangoSelector, options?: CompileOptions): CompiledDocumentQuery {
    // Mango syntax is very similar to MongoDB
    return this.compile(selector as DocumentQuery, options)
  }

  /**
   * Compile a DynamoDB query
   */
  compileDynamoDB(query: DynamoDBQuery): CompiledDocumentQuery {
    const ast = this.parseDynamoDBKeyCondition(query)
    const plan = this.createExecutionPlan(ast, [])

    const result = this.createResult(ast, plan, [])

    // Parse filter expression if present
    if (query.FilterExpression) {
      const filterResult = this.parseDynamoDBFilterExpression(query)
      result.filterPredicates = filterResult.predicates
      result.filterLogicalOp = filterResult.logicalOp
    }

    return result
  }

  // ===========================================================================
  // MongoDB Query Parsing
  // ===========================================================================

  private parseMongoQuery(query: DocumentQuery): QueryNode {
    const predicates: QueryNode[] = []

    for (const [key, value] of Object.entries(query)) {
      if (key.startsWith('$')) {
        predicates.push(this.parseTopLevelOperator(key, value))
      } else {
        predicates.push(this.parseFieldCondition(key, value))
      }
    }

    if (predicates.length === 1) {
      return predicates[0]!
    }

    return {
      type: 'logical',
      op: 'AND',
      children: predicates,
    }
  }

  private parseTopLevelOperator(op: string, value: unknown): QueryNode {
    switch (op) {
      case '$and':
        return this.parseLogicalArray('AND', value)
      case '$or':
        return this.parseLogicalArray('OR', value)
      case '$not':
        return {
          type: 'logical',
          op: 'NOT',
          children: [this.parseMongoQuery(value as DocumentQuery)],
        }
      case '$nor':
        return {
          type: 'logical',
          op: 'NOT',
          children: [{
            type: 'logical',
            op: 'OR',
            children: (value as DocumentQuery[]).map(v => this.parseMongoQuery(v)),
          }],
        }
      default:
        throw new Error(`Unknown operator: ${op}`)
    }
  }

  private parseLogicalArray(op: 'AND' | 'OR', value: unknown): LogicalNode {
    if (!Array.isArray(value)) {
      throw new Error(`${op} operator requires an array`)
    }

    return {
      type: 'logical',
      op,
      children: value.map(item => this.parseMongoQuery(item as DocumentQuery)),
    }
  }

  private parseFieldCondition(field: string, condition: unknown): QueryNode {
    // Handle null value
    if (condition === null) {
      return { type: 'predicate', column: field, op: 'IS NULL', value: null }
    }

    // Handle RegExp
    if (condition instanceof RegExp) {
      return this.regexToPredicate(field, condition)
    }

    // Handle Date
    if (condition instanceof Date) {
      return { type: 'predicate', column: field, op: '=', value: condition.getTime() }
    }

    // Handle primitive values (implicit $eq)
    if (typeof condition !== 'object') {
      return { type: 'predicate', column: field, op: '=', value: condition }
    }

    // Handle operator object
    return this.parseOperatorObject(field, condition as Record<string, unknown>)
  }

  private parseOperatorObject(field: string, operators: Record<string, unknown>): QueryNode {
    const predicates: QueryNode[] = []
    let regexOptions: RegexOptions | undefined

    for (const [op, value] of Object.entries(operators)) {
      switch (op) {
        case '$eq':
          predicates.push({ type: 'predicate', column: field, op: '=', value: this.normalizeValue(value) })
          break

        case '$ne':
          predicates.push({ type: 'predicate', column: field, op: '!=', value: this.normalizeValue(value) })
          break

        case '$gt':
          predicates.push({ type: 'predicate', column: field, op: '>', value: this.normalizeValue(value) })
          break

        case '$gte':
          predicates.push({ type: 'predicate', column: field, op: '>=', value: this.normalizeValue(value) })
          break

        case '$lt':
          predicates.push({ type: 'predicate', column: field, op: '<', value: this.normalizeValue(value) })
          break

        case '$lte':
          predicates.push({ type: 'predicate', column: field, op: '<=', value: this.normalizeValue(value) })
          break

        case '$in':
          if (!Array.isArray(value)) {
            throw new Error('$in requires an array')
          }
          predicates.push({ type: 'predicate', column: field, op: 'IN', value })
          break

        case '$nin':
          if (!Array.isArray(value)) {
            throw new Error('$nin requires an array')
          }
          predicates.push({ type: 'predicate', column: field, op: 'NOT IN', value })
          break

        case '$exists':
          predicates.push({
            type: 'predicate',
            column: field,
            op: value ? 'IS NOT NULL' : 'IS NULL',
            value: null,
          })
          break

        case '$not':
          predicates.push({
            type: 'logical',
            op: 'NOT',
            children: [this.parseOperatorObject(field, value as Record<string, unknown>)],
          })
          break

        case '$regex':
          predicates.push(this.parseRegexOperator(field, value as string, operators.$options as string | undefined))
          break

        case '$options':
          // Handled with $regex - set on instance for result creation
          regexOptions = { caseInsensitive: (value as string).includes('i') }
          this.detectedRegexOptions = regexOptions
          break

        default:
          throw new Error(`Unknown operator: ${op}`)
      }
    }

    if (predicates.length === 1) {
      const result = predicates[0]!
      // Attach regex options if present
      if (regexOptions && result.type === 'predicate') {
        (result as PredicateNode & { regexOptions?: RegexOptions }).regexOptions = regexOptions
      }
      return result
    }

    return {
      type: 'logical',
      op: 'AND',
      children: predicates,
    }
  }

  private parseRegexOperator(field: string, pattern: string, options?: string): PredicateNode {
    const likePattern = this.regexToLikePattern(pattern)

    return {
      type: 'predicate',
      column: field,
      op: 'LIKE',
      value: likePattern,
    }
  }

  private regexToPredicate(field: string, regex: RegExp): PredicateNode {
    const likePattern = this.regexToLikePattern(regex.source)

    // Detect case-insensitive flag from RegExp object
    if (regex.flags.includes('i')) {
      this.detectedRegexOptions = { caseInsensitive: true }
    }

    return {
      type: 'predicate',
      column: field,
      op: 'LIKE',
      value: likePattern,
    }
  }

  private regexToLikePattern(pattern: string): string {
    let result = pattern

    // Handle anchored patterns
    const startsWithCaret = result.startsWith('^')
    const endsWithDollar = result.endsWith('$')

    // Remove anchors
    if (startsWithCaret) result = result.slice(1)
    if (endsWithDollar) result = result.slice(0, -1)

    // Unescape regex escapes (e.g., \. becomes .)
    result = result.replace(/\\([.+*?^${}()|[\]\\])/g, '$1')

    // Add wildcards based on anchors
    if (!startsWithCaret) result = '%' + result
    if (!endsWithDollar) result = result + '%'

    return result
  }

  private normalizeValue(value: unknown): unknown {
    if (value instanceof Date) {
      return value.getTime()
    }
    return value
  }

  // ===========================================================================
  // DynamoDB Query Parsing
  // ===========================================================================

  private parseDynamoDBKeyCondition(query: DynamoDBQuery): QueryNode {
    const expr = query.KeyConditionExpression
    const values = query.ExpressionAttributeValues
    const names = query.ExpressionAttributeNames ?? {}

    return this.parseDynamoDBExpression(expr, values, names)
  }

  private parseDynamoDBExpression(
    expr: string,
    values: Record<string, unknown>,
    names: Record<string, string>
  ): QueryNode {
    // Tokenize and parse the expression
    const tokens = this.tokenizeDynamoDBExpression(expr)
    return this.parseTokens(tokens, values, names)
  }

  private tokenizeDynamoDBExpression(expr: string): string[] {
    // Simple tokenizer for DynamoDB expressions
    const tokens: string[] = []
    let current = ''
    let i = 0

    while (i < expr.length) {
      const char = expr[i]!

      if (char === ' ') {
        if (current) tokens.push(current)
        current = ''
      } else if (char === '(' || char === ')' || char === ',') {
        if (current) tokens.push(current)
        tokens.push(char)
        current = ''
      } else if (char === '=' || char === '>' || char === '<') {
        if (current) tokens.push(current)
        // Check for >= or <=
        if (expr[i + 1] === '=') {
          tokens.push(char + '=')
          i++
        } else {
          tokens.push(char)
        }
        current = ''
      } else {
        current += char
      }
      i++
    }

    if (current) tokens.push(current)

    return tokens
  }

  private parseTokens(
    tokens: string[],
    values: Record<string, unknown>,
    names: Record<string, string>
  ): QueryNode {
    const predicates: QueryNode[] = []
    let i = 0

    while (i < tokens.length) {
      const token = tokens[i]!

      if (token.toUpperCase() === 'AND') {
        i++
        continue
      }

      if (token.toUpperCase() === 'OR') {
        // Handle OR at the top level
        i++
        continue
      }

      if (token === 'begins_with' || token === 'begins_with(') {
        const pred = this.parseBeginsWithFunction(tokens, i, values, names)
        predicates.push(pred.node)
        i = pred.endIndex
        continue
      }

      if (token === 'contains' || token === 'contains(') {
        const pred = this.parseContainsFunction(tokens, i, values, names)
        predicates.push(pred.node)
        i = pred.endIndex
        continue
      }

      if (token === 'attribute_exists' || token === 'attribute_exists(') {
        const pred = this.parseAttributeExistsFunction(tokens, i, names, true)
        predicates.push(pred.node)
        i = pred.endIndex
        continue
      }

      if (token === 'attribute_not_exists' || token === 'attribute_not_exists(') {
        const pred = this.parseAttributeExistsFunction(tokens, i, names, false)
        predicates.push(pred.node)
        i = pred.endIndex
        continue
      }

      if (token === 'size' || token === 'size(') {
        const pred = this.parseSizeFunction(tokens, i, values, names)
        predicates.push(pred.node)
        i = pred.endIndex
        continue
      }

      if (token.toUpperCase() === 'NOT') {
        // Skip NOT for now, handled in filter expression parsing
        i++
        continue
      }

      if (token.toUpperCase() === 'BETWEEN') {
        // Handle BETWEEN expression (already parsed the column)
        const pred = this.parseBetweenExpression(tokens, i - 1, values, names)
        // Replace the last predicate (which would be the column name)
        predicates.pop()
        predicates.push(pred.node)
        i = pred.endIndex
        continue
      }

      // Try to parse as comparison
      const comparison = this.tryParseComparison(tokens, i, values, names)
      if (comparison) {
        predicates.push(comparison.node)
        i = comparison.endIndex
        continue
      }

      // Check for BETWEEN pattern: column BETWEEN :start AND :end
      if (tokens[i + 1]?.toUpperCase() === 'BETWEEN') {
        const pred = this.parseBetweenExpression(tokens, i, values, names)
        predicates.push(pred.node)
        i = pred.endIndex
        continue
      }

      i++
    }

    if (predicates.length === 0) {
      throw new Error(`Cannot parse DynamoDB expression: ${tokens.join(' ')}`)
    }

    if (predicates.length === 1) {
      return predicates[0]!
    }

    return {
      type: 'logical',
      op: 'AND',
      children: predicates,
    }
  }

  private tryParseComparison(
    tokens: string[],
    index: number,
    values: Record<string, unknown>,
    names: Record<string, string>
  ): { node: PredicateNode; endIndex: number } | null {
    const column = this.resolveColumn(tokens[index]!, names)
    const op = tokens[index + 1]
    const valueRef = tokens[index + 2]

    if (!op || !valueRef) return null

    const compOp = this.dynamoDBOpToAST(op)
    if (!compOp) return null

    const value = this.resolveValue(valueRef, values)

    return {
      node: { type: 'predicate', column, op: compOp, value },
      endIndex: index + 3,
    }
  }

  private parseBeginsWithFunction(
    tokens: string[],
    index: number,
    values: Record<string, unknown>,
    names: Record<string, string>
  ): { node: PredicateNode; endIndex: number } {
    // begins_with(column, :value)
    let i = index
    if (tokens[i] === 'begins_with') i++
    if (tokens[i] === '(') i++

    const column = this.resolveColumn(tokens[i]!, names)
    i++ // skip column
    if (tokens[i] === ',') i++
    const valueRef = tokens[i]!
    i++ // skip value
    if (tokens[i] === ')') i++

    const value = this.resolveValue(valueRef, values)

    return {
      node: { type: 'predicate', column, op: 'STARTS_WITH', value },
      endIndex: i,
    }
  }

  private parseContainsFunction(
    tokens: string[],
    index: number,
    values: Record<string, unknown>,
    names: Record<string, string>
  ): { node: PredicateNode; endIndex: number } {
    let i = index
    if (tokens[i] === 'contains') i++
    if (tokens[i] === '(') i++

    const column = this.resolveColumn(tokens[i]!, names)
    i++
    if (tokens[i] === ',') i++
    const valueRef = tokens[i]!
    i++
    if (tokens[i] === ')') i++

    const value = this.resolveValue(valueRef, values)

    return {
      node: { type: 'predicate', column, op: 'CONTAINS', value },
      endIndex: i,
    }
  }

  private parseAttributeExistsFunction(
    tokens: string[],
    index: number,
    names: Record<string, string>,
    exists: boolean
  ): { node: PredicateNode; endIndex: number } {
    let i = index
    if (tokens[i] === 'attribute_exists' || tokens[i] === 'attribute_not_exists') i++
    if (tokens[i] === '(') i++

    const column = this.resolveColumn(tokens[i]!, names)
    i++
    if (tokens[i] === ')') i++

    return {
      node: {
        type: 'predicate',
        column,
        op: exists ? 'IS NOT NULL' : 'IS NULL',
        value: null,
      },
      endIndex: i,
    }
  }

  private parseSizeFunction(
    tokens: string[],
    index: number,
    values: Record<string, unknown>,
    names: Record<string, string>
  ): { node: PredicateNode; endIndex: number } {
    // size(column) > :value
    let i = index
    if (tokens[i] === 'size') i++
    if (tokens[i] === '(') i++

    const column = this.resolveColumn(tokens[i]!, names)
    i++
    if (tokens[i] === ')') i++

    const op = tokens[i]!
    i++
    const valueRef = tokens[i]!
    i++

    const compOp = this.dynamoDBOpToAST(op)
    const value = this.resolveValue(valueRef, values)

    return {
      node: {
        type: 'predicate',
        column: `size(${column})`,
        op: compOp ?? '=',
        value,
      },
      endIndex: i,
    }
  }

  private parseBetweenExpression(
    tokens: string[],
    index: number,
    values: Record<string, unknown>,
    names: Record<string, string>
  ): { node: PredicateNode; endIndex: number } {
    // column BETWEEN :start AND :end
    const column = this.resolveColumn(tokens[index]!, names)
    let i = index + 1
    if (tokens[i]?.toUpperCase() === 'BETWEEN') i++

    const startRef = tokens[i]!
    i++
    if (tokens[i]?.toUpperCase() === 'AND') i++
    const endRef = tokens[i]!
    i++

    const startValue = this.resolveValue(startRef, values)
    const endValue = this.resolveValue(endRef, values)

    return {
      node: {
        type: 'predicate',
        column,
        op: 'BETWEEN',
        value: [startValue, endValue],
      },
      endIndex: i,
    }
  }

  private parseDynamoDBFilterExpression(query: DynamoDBQuery): {
    predicates: QueryNode[]
    logicalOp: 'AND' | 'OR'
  } {
    const expr = query.FilterExpression!
    const values = query.ExpressionAttributeValues
    const names = query.ExpressionAttributeNames ?? {}

    // Detect if there's an OR at the top level
    const hasOr = expr.toUpperCase().includes(' OR ')
    const logicalOp: 'AND' | 'OR' = hasOr ? 'OR' : 'AND'

    const ast = this.parseDynamoDBExpression(expr, values, names)

    // Extract predicates from AST
    const predicates: QueryNode[] = []
    if (ast.type === 'logical') {
      predicates.push(...(ast as LogicalNode).children)
    } else {
      predicates.push(ast)
    }

    return { predicates, logicalOp }
  }

  private resolveColumn(token: string, names: Record<string, string>): string {
    if (token.startsWith('#')) {
      const resolved = names[token]
      if (!resolved) {
        throw new Error(`Missing ExpressionAttributeName: ${token}`)
      }
      return resolved
    }
    return token
  }

  private resolveValue(token: string, values: Record<string, unknown>): unknown {
    if (token.startsWith(':')) {
      const resolved = values[token]
      if (resolved === undefined) {
        throw new Error(`Missing ExpressionAttributeValue: ${token}`)
      }
      return resolved
    }
    return token
  }

  private dynamoDBOpToAST(op: string): ComparisonOp | null {
    switch (op) {
      case '=': return '='
      case '<>': return '!='
      case '>': return '>'
      case '>=': return '>='
      case '<': return '<'
      case '<=': return '<='
      default: return null
    }
  }

  // ===========================================================================
  // Execution Planning
  // ===========================================================================

  private createExecutionPlan(
    ast: QueryNode,
    indexedFields: IndexedFieldConfig[],
    options?: CompileOptions
  ): ExecutionPlan {
    const indexedFieldNames = new Set(indexedFields.map(f => f.field))
    const temporalFields = indexedFields.filter(f => f.temporal).map(f => f.field)

    const indexedOperations: IndexedOperation[] = []
    const fullScanPredicates: PredicateNode[] = []
    let temporalRange: TemporalRange | undefined
    let combineLogic: 'AND' | 'OR' = 'AND'
    let requiresUnion = false

    // First, check for explicit temporal clause from options
    if (options?.temporal) {
      temporalRange = this.materializeTemporalNode(options.temporal, options.currentTimestamp)
    }

    const processNode = (node: QueryNode): void => {
      if (node.type === 'predicate') {
        const pred = node as PredicateNode

        // Check for temporal range from predicates
        if (temporalFields.includes(pred.column)) {
          if (!temporalRange) {
            temporalRange = {}
          }
          // Only override if not already set by explicit temporal clause
          if (pred.op === '>=' || pred.op === '>') {
            if (temporalRange.start === undefined) {
              temporalRange.start = pred.value as number
            }
          } else if (pred.op === '<=' || pred.op === '<') {
            if (temporalRange.end === undefined) {
              temporalRange.end = pred.value as number
            }
          } else if (pred.op === '=') {
            // Exact match on temporal field - use AS_OF semantics
            if (temporalRange.queryType === undefined) {
              temporalRange.queryType = 'AS_OF'
              temporalRange.start = pred.value as number
              temporalRange.end = pred.value as number
              temporalRange.isMaterialized = true
            }
          }
          // Also add to indexed operations
          indexedOperations.push({ field: pred.column, predicate: pred })
        } else if (indexedFieldNames.has(pred.column)) {
          indexedOperations.push({ field: pred.column, predicate: pred })
        } else {
          fullScanPredicates.push(pred)
        }
      } else if (node.type === 'logical') {
        const logical = node as LogicalNode

        if (logical.op === 'OR') {
          combineLogic = 'OR'
          requiresUnion = true
        }

        for (const child of logical.children) {
          processNode(child)
        }
      } else if (node.type === 'temporal') {
        // Handle temporal node found in query AST
        const temporalNode = node as TemporalNode
        if (!temporalRange || !temporalRange.isMaterialized) {
          temporalRange = this.materializeTemporalNode(temporalNode, options?.currentTimestamp)
        }
      }
    }

    processNode(ast)

    return {
      indexedOperations,
      fullScanPredicates,
      temporalRange,
      combineLogic,
      requiresUnion,
    }
  }

  /**
   * Materialize a TemporalNode into a TemporalRange.
   *
   * This converts the abstract temporal query type into concrete timestamp ranges
   * that can be used for efficient filtering.
   */
  private materializeTemporalNode(
    temporal: TemporalNode,
    currentTimestamp?: number
  ): TemporalRange {
    const now = currentTimestamp ?? Date.now()

    switch (temporal.queryType) {
      case 'AS_OF':
        // AS OF queries need a single point in time
        if (temporal.snapshotId !== undefined) {
          return {
            snapshotId: temporal.snapshotId,
            queryType: 'AS_OF',
            isMaterialized: true,
          }
        }
        // For timestamp-based AS OF, we set end = asOfTimestamp
        // meaning "all records valid at or before this timestamp"
        return {
          end: temporal.asOfTimestamp,
          queryType: 'AS_OF',
          isMaterialized: true,
        }

      case 'BEFORE':
        // BEFORE queries exclude the specified timestamp
        return {
          end: temporal.asOfTimestamp !== undefined ? temporal.asOfTimestamp - 1 : undefined,
          queryType: 'BEFORE',
          isMaterialized: true,
        }

      case 'BETWEEN':
        // BETWEEN queries define a range
        return {
          start: temporal.asOfTimestamp,
          end: temporal.toTimestamp,
          queryType: 'BETWEEN',
          isMaterialized: true,
        }

      case 'VERSIONS_BETWEEN':
        // Version-based range queries
        return {
          snapshotId: temporal.fromVersion,  // Store fromVersion in snapshotId
          queryType: 'VERSIONS_BETWEEN',
          isMaterialized: true,
          // Note: toVersion would need to be tracked separately
          // For now, we use start/end to store the versions as numbers
          start: temporal.fromVersion,
          end: temporal.toVersion,
        }

      default:
        return {
          queryType: temporal.queryType,
          isMaterialized: false,
        }
    }
  }

  // ===========================================================================
  // Result Creation
  // ===========================================================================

  private createMatchAllResult(
    indexedFields: IndexedFieldConfig[],
    options?: CompileOptions
  ): CompiledDocumentQuery {
    const emptyAST: PredicateNode = {
      type: 'predicate',
      column: '_',
      op: '=',
      value: { $always: true },
    }

    // Even for match-all queries, we may have temporal constraints
    let temporalRange: TemporalRange | undefined
    if (options?.temporal) {
      temporalRange = this.materializeTemporalNode(options.temporal, options.currentTimestamp)
    }

    return {
      ast: emptyAST,
      matchAll: true,
      plan: {
        indexedOperations: [],
        fullScanPredicates: [],
        combineLogic: 'AND',
        temporalRange,
      },
      toTCSPredicates: () => [],
      toTemporalRange: () => temporalRange,
    }
  }

  private createResult(
    ast: QueryNode,
    plan: ExecutionPlan,
    indexedFields: IndexedFieldConfig[],
    detectedRegexOptions?: RegexOptions
  ): CompiledDocumentQuery {
    // Use detected regex options (from RegExp objects or $options)
    const regexOptions = detectedRegexOptions

    const result: CompiledDocumentQuery = {
      ast,
      matchAll: false,
      regexOptions,
      plan,

      toTCSPredicates(): TCSPredicate[] {
        const predicates: TCSPredicate[] = []

        const extract = (node: QueryNode): void => {
          if (node.type === 'predicate') {
            const pred = node as PredicateNode
            predicates.push({
              column: pred.column,
              op: this.mapOpToTCS(pred.op),
              value: pred.value,
            })
          } else if (node.type === 'logical') {
            for (const child of (node as LogicalNode).children) {
              extract(child)
            }
          }
        }

        extract(ast)
        return predicates
      },

      toTemporalRange(): TemporalRange | undefined {
        return plan.temporalRange
      },
    }

    // Bind helper method
    result.toTCSPredicates = result.toTCSPredicates.bind({
      mapOpToTCS(op: ComparisonOp): string {
        switch (op) {
          case '=': return '='
          case '!=': return '!='
          case '>': return '>'
          case '>=': return '>='
          case '<': return '<'
          case '<=': return '<='
          case 'IN': return 'in'
          case 'NOT IN': return 'not in'
          case 'BETWEEN': return 'between'
          case 'LIKE': return 'like'
          case 'CONTAINS': return 'contains'
          case 'STARTS_WITH': return 'starts_with'
          case 'IS NULL': return 'is_null'
          case 'IS NOT NULL': return 'is_not_null'
          default: return op.toLowerCase()
        }
      },
    })

    return result
  }
}

// =============================================================================
// Exports
// =============================================================================

export type { ComparisonOp } from '../ast'

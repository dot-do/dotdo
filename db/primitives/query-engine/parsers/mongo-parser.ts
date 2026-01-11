/**
 * MongoDB Query Parser
 *
 * Parses MongoDB query syntax into unified AST format.
 * Supports find queries and aggregation pipelines.
 *
 * @see dotdo-z35j6
 */

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  GroupByNode,
  SortNode,
  ProjectionNode,
  AggregationNode,
  JoinNode,
  ComparisonOp,
  AggregateFunction,
  SortDirection,
  ColumnSpec,
  AliasedAggregation,
} from '../ast'

// =============================================================================
// Types
// =============================================================================

/**
 * MongoDB query document type
 */
export type MongoQuery = Record<string, unknown>

/**
 * MongoDB aggregation pipeline stage
 */
export type AggregationPipelineStage = Record<string, unknown>

/**
 * MongoDB aggregation pipeline
 */
export type AggregationPipeline = AggregationPipelineStage[]

/**
 * Parsed pipeline result
 */
export interface ParsedPipeline {
  where?: QueryNode
  groupBy?: GroupByNode
  sort?: SortNode
  projection?: ProjectionNode
  join?: JoinNode
  skip?: number
  limit?: number
}

// =============================================================================
// Operator Mappings
// =============================================================================

const MONGO_TO_AST_OP: Record<string, ComparisonOp> = {
  '$eq': '=',
  '$ne': '!=',
  '$gt': '>',
  '$gte': '>=',
  '$lt': '<',
  '$lte': '<=',
  '$in': 'IN',
  '$nin': 'NOT IN',
}

const MONGO_AGG_TO_AST: Record<string, AggregateFunction> = {
  '$sum': 'sum',
  '$avg': 'avg',
  '$min': 'min',
  '$max': 'max',
  '$first': 'first',
  '$last': 'last',
  '$push': 'push',
  '$addToSet': 'addToSet',
}

// =============================================================================
// MongoQueryParser Class
// =============================================================================

export class MongoQueryParser {
  /**
   * Parse a MongoDB query document to unified AST
   */
  parse(query: MongoQuery): QueryNode {
    return this.parseDocument(query)
  }

  /**
   * Parse a MongoDB aggregation pipeline
   */
  parsePipeline(pipeline: AggregationPipeline): ParsedPipeline {
    const result: ParsedPipeline = {}

    for (const stage of pipeline) {
      this.parseStage(stage, result)
    }

    return result
  }

  private parseDocument(doc: MongoQuery, fieldPath = ''): QueryNode {
    // Handle empty query (matches all)
    if (Object.keys(doc).length === 0) {
      return { type: 'predicate', column: '_', op: '=', value: { $always: true } } as PredicateNode
    }

    const predicates: QueryNode[] = []

    for (const [key, value] of Object.entries(doc)) {
      if (key.startsWith('$')) {
        // Top-level operator
        predicates.push(this.parseTopLevelOperator(key, value))
      } else {
        // Field condition
        predicates.push(this.parseFieldCondition(key, value))
      }
    }

    // Single predicate - return directly
    if (predicates.length === 1) {
      return predicates[0]
    }

    // Multiple predicates - implicit AND
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

      case '$nor':
        // $nor is NOT(OR(...))
        const orNode = this.parseLogicalArray('OR', value)
        return {
          type: 'logical',
          op: 'NOT',
          children: [orNode],
        }

      case '$text':
        return this.parseTextSearch(value as Record<string, unknown>)

      case '$vector':
        return this.parseVectorSearch(value as Record<string, unknown>)

      case '$expr':
        return this.parseExpression(value)

      default:
        throw new Error(`Unknown operator: ${op}`)
    }
  }

  private parseLogicalArray(op: 'AND' | 'OR', value: unknown): LogicalNode {
    if (!Array.isArray(value)) {
      throw new Error(`${op} operator requires an array`)
    }

    const children = value.map(item => this.parseDocument(item as MongoQuery))

    return {
      type: 'logical',
      op,
      children,
    }
  }

  private parseFieldCondition(field: string, condition: unknown): QueryNode {
    // Handle null value
    if (condition === null) {
      return {
        type: 'predicate',
        column: field,
        op: 'IS NULL',
        value: null,
      }
    }

    // Handle RegExp
    if (condition instanceof RegExp) {
      return {
        type: 'predicate',
        column: field,
        op: 'LIKE',
        value: this.regexToLike(condition),
      }
    }

    // Handle Date
    if (condition instanceof Date) {
      return {
        type: 'predicate',
        column: field,
        op: '=',
        value: condition.getTime(),
      }
    }

    // Handle primitive values (implicit $eq)
    if (typeof condition !== 'object') {
      return {
        type: 'predicate',
        column: field,
        op: '=',
        value: condition,
      }
    }

    // Handle operator object
    return this.parseOperatorObject(field, condition as Record<string, unknown>)
  }

  private parseOperatorObject(field: string, operators: Record<string, unknown>): QueryNode {
    const predicates: QueryNode[] = []

    for (const [op, value] of Object.entries(operators)) {
      switch (op) {
        case '$eq':
        case '$ne':
        case '$gt':
        case '$gte':
        case '$lt':
        case '$lte':
          predicates.push({
            type: 'predicate',
            column: field,
            op: MONGO_TO_AST_OP[op],
            value: value instanceof Date ? value.getTime() : value,
          })
          break

        case '$in':
          if (!Array.isArray(value)) {
            throw new Error('$in requires an array')
          }
          predicates.push({
            type: 'predicate',
            column: field,
            op: 'IN',
            value,
          })
          break

        case '$nin':
          if (!Array.isArray(value)) {
            throw new Error('$nin requires an array')
          }
          predicates.push({
            type: 'predicate',
            column: field,
            op: 'NOT IN',
            value,
          })
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
          const innerPred = this.parseOperatorObject(field, value as Record<string, unknown>)
          predicates.push({
            type: 'logical',
            op: 'NOT',
            children: [innerPred],
          })
          break

        case '$regex':
          predicates.push({
            type: 'predicate',
            column: field,
            op: 'LIKE',
            value: typeof value === 'string' ? value : String(value),
          })
          break

        case '$options':
          // Handled with $regex, skip
          break

        case '$type':
          // Type checking predicate
          predicates.push({
            type: 'predicate',
            column: field,
            op: '=',
            value: { $type: value },
          } as PredicateNode)
          break

        case '$mod':
          predicates.push({
            type: 'predicate',
            column: field,
            op: '=',
            value: { $mod: value },
          } as PredicateNode)
          break

        case '$all':
          predicates.push({
            type: 'predicate',
            column: field,
            op: '=',
            value: { $all: value },
          } as PredicateNode)
          break

        case '$elemMatch':
          predicates.push({
            type: 'predicate',
            column: field,
            op: '=',
            value: { $elemMatch: value },
          } as PredicateNode)
          break

        case '$size':
          predicates.push({
            type: 'predicate',
            column: field,
            op: '=',
            value: { $size: value },
          } as PredicateNode)
          break

        default:
          throw new Error(`Unknown operator: ${op} at field ${field}`)
      }
    }

    if (predicates.length === 1) {
      return predicates[0]
    }

    // Multiple operators on same field - implicit AND
    return {
      type: 'logical',
      op: 'AND',
      children: predicates,
    }
  }

  private parseTextSearch(textDoc: Record<string, unknown>): PredicateNode {
    const search = textDoc.$search as string

    return {
      type: 'predicate',
      column: '$text',
      op: 'CONTAINS',
      value: search,
    }
  }

  private parseVectorSearch(vectorDoc: Record<string, unknown>): PredicateNode {
    const near = vectorDoc.$near as number[]
    const k = (vectorDoc.$k as number) || 10
    const minScore = vectorDoc.$minScore as number | undefined

    return {
      type: 'predicate',
      column: '$vector',
      op: 'NEAR',
      value: near,
      metric: 'cosine',
      k,
    }
  }

  private parseExpression(expr: unknown): QueryNode {
    // Simple expression parsing
    if (typeof expr === 'object' && expr !== null) {
      const exprObj = expr as Record<string, unknown>
      const op = Object.keys(exprObj)[0]

      if (op === '$gt' || op === '$lt' || op === '$eq') {
        const operands = exprObj[op] as unknown[]
        if (Array.isArray(operands) && operands.length === 2) {
          const left = operands[0] as string
          const right = operands[1]

          // Field reference starts with $
          const column = typeof left === 'string' && left.startsWith('$')
            ? left.slice(1)
            : String(left)

          return {
            type: 'predicate',
            column,
            op: op === '$gt' ? '>' : op === '$lt' ? '<' : '=',
            value: typeof right === 'string' && right.startsWith('$')
              ? { $ref: right.slice(1) }
              : right,
          }
        }
      }
    }

    return {
      type: 'predicate',
      column: '$expr',
      op: '=',
      value: expr,
    } as PredicateNode
  }

  private parseStage(stage: AggregationPipelineStage, result: ParsedPipeline): void {
    const stageName = Object.keys(stage)[0]
    const stageValue = stage[stageName]

    switch (stageName) {
      case '$match':
        const matchAst = this.parseDocument(stageValue as MongoQuery)
        if (!result.where) {
          result.where = matchAst
        } else {
          // Combine with existing where clause
          result.where = {
            type: 'logical',
            op: 'AND',
            children: [result.where, matchAst],
          }
        }
        break

      case '$group':
        result.groupBy = this.parseGroupStage(stageValue as Record<string, unknown>)
        break

      case '$sort':
        result.sort = this.parseSortStage(stageValue as Record<string, number>)
        break

      case '$project':
        result.projection = this.parseProjectStage(stageValue as Record<string, unknown>)
        break

      case '$limit':
        result.limit = stageValue as number
        break

      case '$skip':
        result.skip = stageValue as number
        break

      case '$unwind':
        // Unwind is represented in the result metadata
        // Actual implementation would need special handling
        break

      case '$lookup':
        result.join = this.parseLookupStage(stageValue as Record<string, unknown>)
        break

      case '$facet':
        // Facet creates multiple sub-pipelines
        // For now, just track that it exists
        break

      case '$bucket':
        // Bucket is a special grouping
        break
    }
  }

  private parseGroupStage(group: Record<string, unknown>): GroupByNode {
    const id = group._id
    const columns: string[] = []

    // Parse _id (grouping key)
    if (typeof id === 'string' && id.startsWith('$')) {
      columns.push(id.slice(1))
    } else if (typeof id === 'object' && id !== null) {
      // Complex grouping key
      for (const [alias, fieldRef] of Object.entries(id)) {
        if (typeof fieldRef === 'string' && fieldRef.startsWith('$')) {
          columns.push(fieldRef.slice(1))
        }
      }
    }

    // Parse aggregations
    const aggregations: AliasedAggregation[] = []

    for (const [alias, aggExpr] of Object.entries(group)) {
      if (alias === '_id') continue

      if (typeof aggExpr === 'object' && aggExpr !== null) {
        const aggObj = aggExpr as Record<string, unknown>
        const aggOp = Object.keys(aggObj)[0]
        const aggValue = aggObj[aggOp]

        const fn = MONGO_AGG_TO_AST[aggOp]
        if (fn) {
          const agg: AggregationNode = {
            type: 'aggregation',
            function: fn,
          }

          // Handle column reference
          if (typeof aggValue === 'string' && aggValue.startsWith('$')) {
            agg.column = aggValue.slice(1)
          } else if (aggOp === '$sum' && aggValue === 1) {
            // $sum: 1 is count
            agg.function = 'count'
          }

          aggregations.push({ alias, aggregation: agg })
        }
      }
    }

    return {
      type: 'groupBy',
      columns,
      aggregations,
    }
  }

  private parseSortStage(sort: Record<string, number>): SortNode {
    const columns = Object.entries(sort).map(([column, direction]) => ({
      column,
      direction: (direction === -1 ? 'DESC' : 'ASC') as SortDirection,
    }))

    return {
      type: 'sort',
      columns,
    }
  }

  private parseProjectStage(project: Record<string, unknown>): ProjectionNode {
    const columns: ColumnSpec[] = []

    for (const [field, value] of Object.entries(project)) {
      if (value === 1 || value === true) {
        columns.push({ source: field, include: true })
      } else if (value === 0 || value === false) {
        columns.push({ source: field, include: false })
      } else if (typeof value === 'object' && value !== null) {
        // Computed field
        columns.push({
          source: { type: 'expression', operator: 'add', operands: [] },
          alias: field,
          include: true,
        })
      }
    }

    return {
      type: 'projection',
      columns,
    }
  }

  private parseLookupStage(lookup: Record<string, unknown>): JoinNode {
    const from = lookup.from as string
    const localField = lookup.localField as string
    const foreignField = lookup.foreignField as string
    const as = lookup.as as string

    return {
      type: 'join',
      joinType: 'LEFT',
      left: '$current',
      right: from,
      on: {
        type: 'predicate',
        column: localField,
        op: '=',
        value: { $ref: `${from}.${foreignField}` },
      },
    }
  }

  private regexToLike(regex: RegExp): string {
    // Simple conversion of regex to LIKE pattern
    let pattern = regex.source

    // Replace ^ with nothing (LIKE starts at beginning by default with no leading %)
    if (pattern.startsWith('^')) {
      pattern = pattern.slice(1)
    } else {
      pattern = '%' + pattern
    }

    // Replace $ with nothing, add trailing % if not present
    if (pattern.endsWith('$')) {
      pattern = pattern.slice(0, -1)
    } else {
      pattern = pattern + '%'
    }

    // Replace .* with %
    pattern = pattern.replace(/\.\*/g, '%')

    // Replace . with _
    pattern = pattern.replace(/\./g, '_')

    return pattern
  }
}

// =============================================================================
// Exports
// =============================================================================

export type { MongoQuery, AggregationPipeline, ParsedPipeline }

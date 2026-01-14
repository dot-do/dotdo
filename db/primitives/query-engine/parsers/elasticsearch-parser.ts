/**
 * Elasticsearch DSL Parser
 *
 * Parses Elasticsearch Query DSL into unified AST format.
 * Supports bool queries (must/should/filter/must_not), term, match, range,
 * exists, and nested queries.
 *
 * @see dotdo-y78ii
 */

import type {
  QueryNode,
  PredicateNode,
  LogicalNode,
  SortNode,
  ProjectionNode,
  SortDirection,
  SortColumn,
  ColumnSpec,
  ComparisonOp,
} from '../ast'

// =============================================================================
// Types
// =============================================================================

/**
 * Elasticsearch query document type
 */
export type ElasticsearchQuery = Record<string, unknown>

/**
 * Parsed Elasticsearch query result
 */
export interface ParsedElasticsearch {
  query?: QueryNode
  sort?: SortNode
  projection?: ProjectionNode
  from?: number
  size?: number
  minimumShouldMatch?: number | string
}

// =============================================================================
// ElasticsearchParser Class
// =============================================================================

export class ElasticsearchParser {
  /**
   * Parse an Elasticsearch query document to unified AST
   */
  parse(query: ElasticsearchQuery): ParsedElasticsearch {
    const result: ParsedElasticsearch = {}

    // Handle top-level query key
    if ('query' in query) {
      result.query = this.parseQueryClause(query.query as Record<string, unknown>)
    }

    // Handle sort
    if ('sort' in query) {
      result.sort = this.parseSortClause(query.sort as unknown[])
    }

    // Handle _source (projection)
    if ('_source' in query) {
      result.projection = this.parseSourceClause(query._source as unknown)
    }

    // Handle from/size (pagination)
    if ('from' in query && typeof query.from === 'number') {
      result.from = query.from
    }
    if ('size' in query && typeof query.size === 'number') {
      result.size = query.size
    }

    return result
  }

  /**
   * Parse just a query clause (without the top-level wrapper)
   */
  parseQuery(queryClause: Record<string, unknown>): QueryNode {
    return this.parseQueryClause(queryClause)
  }

  // ===========================================================================
  // Query Clause Parsing
  // ===========================================================================

  private parseQueryClause(clause: Record<string, unknown>): QueryNode {
    // Handle empty clause
    if (!clause || Object.keys(clause).length === 0) {
      return this.createMatchAll()
    }

    const queryType = Object.keys(clause)[0]!
    const queryValue = clause[queryType!]

    switch (queryType) {
      case 'bool':
        return this.parseBoolQuery(queryValue as Record<string, unknown>)

      case 'term':
        return this.parseTermQuery(queryValue as Record<string, unknown>)

      case 'terms':
        return this.parseTermsQuery(queryValue as Record<string, unknown>)

      case 'match':
        return this.parseMatchQuery(queryValue as Record<string, unknown>)

      case 'match_phrase':
        return this.parseMatchPhraseQuery(queryValue as Record<string, unknown>)

      case 'match_all':
        return this.createMatchAll()

      case 'range':
        return this.parseRangeQuery(queryValue as Record<string, unknown>)

      case 'exists':
        return this.parseExistsQuery(queryValue as Record<string, unknown>)

      case 'prefix':
        return this.parsePrefixQuery(queryValue as Record<string, unknown>)

      case 'wildcard':
        return this.parseWildcardQuery(queryValue as Record<string, unknown>)

      case 'regexp':
        return this.parseRegexpQuery(queryValue as Record<string, unknown>)

      case 'fuzzy':
        return this.parseFuzzyQuery(queryValue as Record<string, unknown>)

      case 'ids':
        return this.parseIdsQuery(queryValue as Record<string, unknown>)

      case 'nested':
        return this.parseNestedQuery(queryValue as Record<string, unknown>)

      case 'query_string':
        return this.parseQueryStringQuery(queryValue as Record<string, unknown>)

      case 'simple_query_string':
        return this.parseSimpleQueryStringQuery(queryValue as Record<string, unknown>)

      default:
        throw new Error(`Unknown Elasticsearch query type: ${queryType}`)
    }
  }

  // ===========================================================================
  // Bool Query
  // ===========================================================================

  private parseBoolQuery(boolClause: Record<string, unknown>): QueryNode {
    const predicates: QueryNode[] = []
    let minimumShouldMatch: number | string | undefined

    // Parse must clauses (AND)
    if ('must' in boolClause) {
      const mustClauses = this.normalizeToArray(boolClause.must)
      for (const clause of mustClauses) {
        predicates.push(this.parseQueryClause(clause as Record<string, unknown>))
      }
    }

    // Parse filter clauses (AND, non-scoring)
    if ('filter' in boolClause) {
      const filterClauses = this.normalizeToArray(boolClause.filter)
      for (const clause of filterClauses) {
        predicates.push(this.parseQueryClause(clause as Record<string, unknown>))
      }
    }

    // Parse must_not clauses (NOT)
    if ('must_not' in boolClause) {
      const mustNotClauses = this.normalizeToArray(boolClause.must_not)
      for (const clause of mustNotClauses) {
        const innerNode = this.parseQueryClause(clause as Record<string, unknown>)
        predicates.push({
          type: 'logical',
          op: 'NOT',
          children: [innerNode],
        })
      }
    }

    // Parse should clauses (OR with minimum_should_match)
    if ('should' in boolClause) {
      const shouldClauses = this.normalizeToArray(boolClause.should)
      minimumShouldMatch = boolClause.minimum_should_match as number | string | undefined

      if (shouldClauses.length > 0) {
        const shouldNodes = shouldClauses.map(clause =>
          this.parseQueryClause(clause as Record<string, unknown>)
        )

        // If minimum_should_match is 1 or "1", treat as OR
        // If minimum_should_match equals the number of should clauses, treat as AND
        // Otherwise, it's a more complex case we'll represent as OR for simplicity
        const orNode: LogicalNode = {
          type: 'logical',
          op: 'OR',
          children: shouldNodes,
        }

        predicates.push(orNode)
      }
    }

    // Combine all predicates with AND
    if (predicates.length === 0) {
      return this.createMatchAll()
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

  // ===========================================================================
  // Term Queries
  // ===========================================================================

  private parseTermQuery(termClause: Record<string, unknown>): PredicateNode {
    const field = Object.keys(termClause)[0]!
    const valueOrObj = termClause[field!]

    let value: unknown
    if (typeof valueOrObj === 'object' && valueOrObj !== null && 'value' in valueOrObj) {
      value = (valueOrObj as Record<string, unknown>).value
    } else {
      value = valueOrObj
    }

    return {
      type: 'predicate',
      column: field,
      op: '=',
      value,
    }
  }

  private parseTermsQuery(termsClause: Record<string, unknown>): PredicateNode {
    const field = Object.keys(termsClause)[0]!
    const values = termsClause[field!]

    if (!Array.isArray(values)) {
      throw new Error('terms query requires an array of values')
    }

    return {
      type: 'predicate',
      column: field,
      op: 'IN',
      value: values,
    }
  }

  // ===========================================================================
  // Match Queries
  // ===========================================================================

  private parseMatchQuery(matchClause: Record<string, unknown>): PredicateNode {
    const field = Object.keys(matchClause)[0]!
    const valueOrObj = matchClause[field!]

    let query: unknown
    if (typeof valueOrObj === 'object' && valueOrObj !== null && 'query' in valueOrObj) {
      query = (valueOrObj as Record<string, unknown>).query
    } else {
      query = valueOrObj
    }

    return {
      type: 'predicate',
      column: field,
      op: 'CONTAINS',
      value: query,
    }
  }

  private parseMatchPhraseQuery(matchClause: Record<string, unknown>): PredicateNode {
    const field = Object.keys(matchClause)[0]!
    const valueOrObj = matchClause[field!]

    let query: unknown
    if (typeof valueOrObj === 'object' && valueOrObj !== null && 'query' in valueOrObj) {
      query = (valueOrObj as Record<string, unknown>).query
    } else {
      query = valueOrObj
    }

    return {
      type: 'predicate',
      column: field,
      op: 'CONTAINS',
      value: query,
    }
  }

  // ===========================================================================
  // Range Query
  // ===========================================================================

  private parseRangeQuery(rangeClause: Record<string, unknown>): QueryNode {
    const field = Object.keys(rangeClause)[0]!
    const conditions = rangeClause[field!] as Record<string, unknown>

    const predicates: QueryNode[] = []

    if ('gt' in conditions) {
      predicates.push({
        type: 'predicate',
        column: field,
        op: '>',
        value: conditions.gt,
      })
    }

    if ('gte' in conditions) {
      predicates.push({
        type: 'predicate',
        column: field,
        op: '>=',
        value: conditions.gte,
      })
    }

    if ('lt' in conditions) {
      predicates.push({
        type: 'predicate',
        column: field,
        op: '<',
        value: conditions.lt,
      })
    }

    if ('lte' in conditions) {
      predicates.push({
        type: 'predicate',
        column: field,
        op: '<=',
        value: conditions.lte,
      })
    }

    if (predicates.length === 0) {
      return this.createMatchAll()
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

  // ===========================================================================
  // Exists Query
  // ===========================================================================

  private parseExistsQuery(existsClause: Record<string, unknown>): PredicateNode {
    const field = existsClause.field as string

    return {
      type: 'predicate',
      column: field,
      op: 'IS NOT NULL',
      value: null,
    }
  }

  // ===========================================================================
  // Pattern Queries
  // ===========================================================================

  private parsePrefixQuery(prefixClause: Record<string, unknown>): PredicateNode {
    const field = Object.keys(prefixClause)[0]!
    const valueOrObj = prefixClause[field!]

    let value: unknown
    if (typeof valueOrObj === 'object' && valueOrObj !== null && 'value' in valueOrObj) {
      value = (valueOrObj as Record<string, unknown>).value
    } else {
      value = valueOrObj
    }

    return {
      type: 'predicate',
      column: field,
      op: 'STARTS_WITH',
      value,
    }
  }

  private parseWildcardQuery(wildcardClause: Record<string, unknown>): PredicateNode {
    const field = Object.keys(wildcardClause)[0]!
    const valueOrObj = wildcardClause[field!]

    let value: unknown
    if (typeof valueOrObj === 'object' && valueOrObj !== null && 'value' in valueOrObj) {
      value = (valueOrObj as Record<string, unknown>).value
    } else {
      value = valueOrObj
    }

    // Convert Elasticsearch wildcards to SQL LIKE pattern
    // * -> % (any characters)
    // ? -> _ (single character)
    const pattern = String(value)
      .replace(/\*/g, '%')
      .replace(/\?/g, '_')

    return {
      type: 'predicate',
      column: field,
      op: 'LIKE',
      value: pattern,
    }
  }

  private parseRegexpQuery(regexpClause: Record<string, unknown>): PredicateNode {
    const field = Object.keys(regexpClause)[0]!
    const valueOrObj = regexpClause[field!]

    let value: unknown
    if (typeof valueOrObj === 'object' && valueOrObj !== null && 'value' in valueOrObj) {
      value = (valueOrObj as Record<string, unknown>).value
    } else {
      value = valueOrObj
    }

    return {
      type: 'predicate',
      column: field,
      op: 'LIKE',
      value, // Note: regex patterns would need special handling in execution
    }
  }

  private parseFuzzyQuery(fuzzyClause: Record<string, unknown>): PredicateNode {
    const field = Object.keys(fuzzyClause)[0]!
    const valueOrObj = fuzzyClause[field!]

    let value: unknown
    if (typeof valueOrObj === 'object' && valueOrObj !== null && 'value' in valueOrObj) {
      value = (valueOrObj as Record<string, unknown>).value
    } else {
      value = valueOrObj
    }

    // Fuzzy matching - represented as LIKE with wildcards
    return {
      type: 'predicate',
      column: field,
      op: 'CONTAINS',
      value,
    }
  }

  // ===========================================================================
  // IDs Query
  // ===========================================================================

  private parseIdsQuery(idsClause: Record<string, unknown>): PredicateNode {
    const values = idsClause.values as unknown[]

    return {
      type: 'predicate',
      column: '_id',
      op: 'IN',
      value: values,
    }
  }

  // ===========================================================================
  // Nested Query
  // ===========================================================================

  private parseNestedQuery(nestedClause: Record<string, unknown>): QueryNode {
    const path = nestedClause.path as string
    const query = nestedClause.query as Record<string, unknown>

    // Parse the inner query
    const innerNode = this.parseQueryClause(query)

    // Prefix all column references with the path
    return this.prefixColumns(innerNode, path)
  }

  private prefixColumns(node: QueryNode, prefix: string): QueryNode {
    if (node.type === 'predicate') {
      return {
        ...node,
        column: `${prefix}.${node.column}`,
      }
    }

    if (node.type === 'logical') {
      return {
        ...node,
        children: node.children.map(child => this.prefixColumns(child, prefix)),
      }
    }

    return node
  }

  // ===========================================================================
  // Query String Queries
  // ===========================================================================

  private parseQueryStringQuery(clause: Record<string, unknown>): PredicateNode {
    const query = clause.query as string
    const defaultField = (clause.default_field as string) || '_all'

    return {
      type: 'predicate',
      column: defaultField,
      op: 'CONTAINS',
      value: query,
    }
  }

  private parseSimpleQueryStringQuery(clause: Record<string, unknown>): PredicateNode {
    const query = clause.query as string
    const fields = clause.fields as string[] | undefined

    return {
      type: 'predicate',
      column: fields ? fields[0]! : '_all',
      op: 'CONTAINS',
      value: query,
    }
  }

  // ===========================================================================
  // Sort Parsing
  // ===========================================================================

  private parseSortClause(sortItems: unknown[]): SortNode {
    const columns: SortColumn[] = []

    for (const item of sortItems) {
      if (typeof item === 'string') {
        // Simple field name, ascending
        columns.push({
          column: item === '_score' ? '$score' : item,
          direction: 'ASC',
        })
      } else if (typeof item === 'object' && item !== null) {
        const sortObj = item as Record<string, unknown>
        const field = Object.keys(sortObj)[0]!
        const config = sortObj[field!]

        let direction: SortDirection = 'ASC'
        if (typeof config === 'string') {
          direction = config.toLowerCase() === 'desc' ? 'DESC' : 'ASC'
        } else if (typeof config === 'object' && config !== null) {
          const configObj = config as Record<string, unknown>
          direction = String(configObj.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC'
        }

        columns.push({
          column: field === '_score' ? '$score' : field,
          direction,
        })
      }
    }

    return {
      type: 'sort',
      columns,
    }
  }

  // ===========================================================================
  // Source (Projection) Parsing
  // ===========================================================================

  private parseSourceClause(source: unknown): ProjectionNode {
    const columns: ColumnSpec[] = []

    if (source === false) {
      // Exclude all source fields
      return {
        type: 'projection',
        columns: [],
      }
    }

    if (source === true || source === undefined) {
      // Include all fields
      return {
        type: 'projection',
        columns: [{ source: '*', include: true }],
      }
    }

    if (Array.isArray(source)) {
      // Include specific fields
      for (const field of source) {
        columns.push({
          source: field as string,
          include: true,
        })
      }
    } else if (typeof source === 'object' && source !== null) {
      const sourceObj = source as Record<string, unknown>

      // Handle includes
      if ('includes' in sourceObj) {
        const includes = sourceObj.includes as string[]
        for (const field of includes) {
          columns.push({
            source: field,
            include: true,
          })
        }
      }

      // Handle excludes
      if ('excludes' in sourceObj) {
        const excludes = sourceObj.excludes as string[]
        for (const field of excludes) {
          columns.push({
            source: field,
            include: false,
          })
        }
      }
    }

    return {
      type: 'projection',
      columns,
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private normalizeToArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value
    }
    return [value]
  }

  private createMatchAll(): PredicateNode {
    return {
      type: 'predicate',
      column: '_',
      op: '=',
      value: { $always: true },
    }
  }
}

// =============================================================================
// Exports
// =============================================================================

// Types already exported at definition

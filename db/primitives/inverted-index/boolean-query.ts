/**
 * Boolean Query Operations
 *
 * Implements boolean query operations (AND/OR/NOT) on posting lists.
 * Supports query building with fluent API and query parsing.
 *
 * @module db/primitives/inverted-index/boolean-query
 */

import { PostingList } from './posting-list'

// ============================================================================
// Types
// ============================================================================

/**
 * Boolean operator types
 */
export enum BooleanOperator {
  /** Required - document MUST contain this term */
  MUST = 'MUST',
  /** Optional - document SHOULD contain this term (for scoring, or as sole clause) */
  SHOULD = 'SHOULD',
  /** Negated - document MUST NOT contain this term */
  MUST_NOT = 'MUST_NOT',
}

/**
 * A clause in a boolean query
 */
export interface BooleanClause {
  /** Term or sub-query identifier */
  term: string
  /** The posting list for this term */
  postings: PostingList
  /** The boolean operator */
  operator: BooleanOperator
}

// ============================================================================
// BooleanQuery
// ============================================================================

/**
 * Boolean query builder for combining posting lists
 *
 * Supports MUST (AND), SHOULD (OR), and MUST_NOT (NOT) operations
 * with a fluent API for query construction.
 */
export class BooleanQuery {
  /** Query clauses */
  private _clauses: BooleanClause[] = []

  /**
   * Get all clauses in the query
   */
  get clauses(): BooleanClause[] {
    return [...this._clauses]
  }

  /**
   * Add a MUST clause (AND)
   *
   * Documents must contain this term to match.
   */
  must(term: string, postings: PostingList): this {
    this._clauses.push({
      term,
      postings,
      operator: BooleanOperator.MUST,
    })
    return this
  }

  /**
   * Add a SHOULD clause (OR)
   *
   * Documents optionally contain this term. Used for OR queries
   * when no MUST clauses are present, or for boosting with MUST clauses.
   */
  should(term: string, postings: PostingList): this {
    this._clauses.push({
      term,
      postings,
      operator: BooleanOperator.SHOULD,
    })
    return this
  }

  /**
   * Add a MUST_NOT clause (NOT)
   *
   * Documents must not contain this term to match.
   */
  mustNot(term: string, postings: PostingList): this {
    this._clauses.push({
      term,
      postings,
      operator: BooleanOperator.MUST_NOT,
    })
    return this
  }

  /**
   * Add a nested subquery
   *
   * @param builder - Function to build the subquery
   * @param operator - How to combine the subquery result
   */
  subquery(builder: (query: BooleanQuery) => BooleanQuery, operator: BooleanOperator): this {
    const subQuery = new BooleanQuery()
    builder(subQuery)
    const result = subQuery.execute()

    // Create a synthetic clause from the subquery result
    this._clauses.push({
      term: `_subquery_${this._clauses.length}`,
      postings: result,
      operator,
    })

    return this
  }

  /**
   * Execute the boolean query
   *
   * @returns PostingList with matching document IDs
   * @throws Error if only MUST_NOT clauses without any MUST clauses
   */
  execute(): PostingList {
    // Separate clauses by type
    const mustClauses = this._clauses.filter((c) => c.operator === BooleanOperator.MUST)
    const shouldClauses = this._clauses.filter((c) => c.operator === BooleanOperator.SHOULD)
    const mustNotClauses = this._clauses.filter((c) => c.operator === BooleanOperator.MUST_NOT)

    // Handle empty query
    if (this._clauses.length === 0) {
      return new PostingList()
    }

    // Handle only MUST_NOT clauses (invalid - need a universe)
    if (mustClauses.length === 0 && shouldClauses.length === 0 && mustNotClauses.length > 0) {
      throw new Error('Boolean query with only must_not clauses requires at least one must clause')
    }

    let result: PostingList

    // Start with MUST clauses (AND)
    if (mustClauses.length > 0) {
      // Sort by cardinality for efficiency (smallest first)
      const sortedMust = mustClauses.slice().sort((a, b) => a.postings.cardinality - b.postings.cardinality)

      result = sortedMust[0]!.postings
      for (let i = 1; i < sortedMust.length; i++) {
        result = result.and(sortedMust[i]!.postings)
      }
    } else {
      // Only SHOULD clauses - combine with OR
      result = shouldClauses[0]!.postings
      for (let i = 1; i < shouldClauses.length; i++) {
        result = result.or(shouldClauses[i]!.postings)
      }
    }

    // Apply MUST_NOT clauses (AND NOT)
    for (const clause of mustNotClauses) {
      result = result.andNot(clause.postings)
    }

    return result
  }

  /**
   * Parse a boolean query string
   *
   * Supports basic syntax:
   * - "a AND b" - both terms required
   * - "a OR b" - either term
   * - "a AND NOT b" - first term, not second
   * - "(a OR b) AND c" - grouping with parentheses
   *
   * @param queryString - Query string to parse
   * @param postings - Map of term to posting list
   * @returns BooleanQuery ready to execute
   */
  static parse(queryString: string, postings: Map<string, PostingList>): BooleanQuery {
    const query = new BooleanQuery()
    const tokens = tokenize(queryString)
    parseExpression(tokens, postings, query)
    return query
  }
}

// ============================================================================
// Query Parser
// ============================================================================

type Token = { type: 'TERM'; value: string } | { type: 'AND' } | { type: 'OR' } | { type: 'NOT' } | { type: 'LPAREN' } | { type: 'RPAREN' }

/**
 * Tokenize a query string
 */
function tokenize(queryString: string): Token[] {
  const tokens: Token[] = []
  const words = queryString.trim().split(/\s+/)

  for (const word of words) {
    const upper = word.toUpperCase()
    if (upper === 'AND') {
      tokens.push({ type: 'AND' })
    } else if (upper === 'OR') {
      tokens.push({ type: 'OR' })
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT' })
    } else if (word === '(') {
      tokens.push({ type: 'LPAREN' })
    } else if (word === ')') {
      tokens.push({ type: 'RPAREN' })
    } else if (word.startsWith('(')) {
      tokens.push({ type: 'LPAREN' })
      const rest = word.slice(1)
      if (rest.endsWith(')')) {
        tokens.push({ type: 'TERM', value: rest.slice(0, -1) })
        tokens.push({ type: 'RPAREN' })
      } else if (rest) {
        tokens.push({ type: 'TERM', value: rest })
      }
    } else if (word.endsWith(')')) {
      const rest = word.slice(0, -1)
      if (rest) {
        tokens.push({ type: 'TERM', value: rest })
      }
      tokens.push({ type: 'RPAREN' })
    } else {
      tokens.push({ type: 'TERM', value: word })
    }
  }

  return tokens
}

/**
 * Parse an expression and build the query
 *
 * Simple recursive descent parser for boolean expressions.
 */
function parseExpression(
  tokens: Token[],
  postings: Map<string, PostingList>,
  query: BooleanQuery,
  parentOperator?: BooleanOperator
): { postingList: PostingList; consumed: number } {
  if (tokens.length === 0) {
    throw new Error('Unexpected end of query')
  }

  // First term or subexpression
  let result: PostingList
  let pos = 0

  // Handle opening parenthesis - subexpression
  if (tokens[0]!.type === 'LPAREN') {
    // Find matching closing paren
    let depth = 1
    let closePos = 1
    while (closePos < tokens.length && depth > 0) {
      if (tokens[closePos]!.type === 'LPAREN') depth++
      if (tokens[closePos]!.type === 'RPAREN') depth--
      closePos++
    }
    if (depth !== 0) {
      throw new Error('Unmatched parenthesis')
    }

    // Parse subexpression
    const subTokens = tokens.slice(1, closePos - 1)
    const subQuery = new BooleanQuery()
    parseExpression(subTokens, postings, subQuery)
    result = subQuery.execute()
    pos = closePos
  } else if (tokens[0]!.type === 'TERM') {
    const term = (tokens[0] as { type: 'TERM'; value: string })!.value
    const list = postings.get(term)
    if (!list) {
      result = new PostingList() // Empty for unknown term
    } else {
      result = list
    }
    pos = 1
  } else {
    throw new Error(`Unexpected token: ${tokens[0]!.type}`)
  }

  // Look for operator
  while (pos < tokens.length) {
    const opToken = tokens[pos]!

    if (opToken!.type === 'RPAREN') {
      break
    }

    if (opToken!.type === 'AND') {
      pos++

      // Check for NOT
      let isNot = false
      if (pos < tokens.length && tokens[pos]!.type === 'NOT') {
        isNot = true
        pos++
      }

      // Get next term/subexpression
      const { postingList: nextList, consumed } = parseExpression(tokens.slice(pos), postings, query, BooleanOperator.MUST)
      pos += consumed

      if (isNot) {
        result = result.andNot(nextList)
      } else {
        result = result.and(nextList)
      }
    } else if (opToken!.type === 'OR') {
      pos++

      const { postingList: nextList, consumed } = parseExpression(tokens.slice(pos), postings, query, BooleanOperator.SHOULD)
      pos += consumed

      result = result.or(nextList)
    } else if (opToken!.type === 'TERM') {
      // Implicit AND
      const term = (opToken as { type: 'TERM'; value: string })!.value
      const list = postings.get(term) || new PostingList()
      result = result.and(list)
      pos++
    } else {
      break
    }
  }

  // Add result to query based on parent operator (for top-level only)
  if (parentOperator === undefined) {
    // This is the root - we need to handle differently
    // The result is already computed, just add a dummy clause with the result
    ;(query as unknown as { _clauses: unknown[] })._clauses = []
    query.must('_result', result)
  }

  return { postingList: result, consumed: pos }
}

/**
 * Predicate Pushdown Rules for Federated Queries
 *
 * Optimization rules that push WHERE clauses down to source systems,
 * minimizing data transfer across sources and leveraging source-specific
 * query capabilities.
 *
 * ## Key Optimizations
 * - Push filters to source systems based on their capabilities
 * - Split conjunctions across multiple sources
 * - Translate predicates to source-specific formats
 * - Handle cross-source predicates appropriately
 *
 * @see dotdo-43oni
 * @module db/primitives/federated-query/predicate-pushdown
 */

import type {
  QueryPredicate,
  PushdownCapabilities,
  TableRef,
  SourceAdapter,
} from './index'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Extended predicate with source information
 */
export interface SourcePredicate extends QueryPredicate {
  /** The source this predicate belongs to */
  sourceTable?: string
  /** Whether this predicate references multiple sources (cross-source) */
  isCrossSource?: boolean
}

/**
 * Source-specific predicate translation
 */
export interface PredicateTranslation {
  /** Original predicate */
  original: QueryPredicate
  /** Translated predicate for the source */
  translated: QueryPredicate
  /** SQL representation if applicable */
  sql?: string
  /** Source-native representation (e.g., MongoDB query, ES DSL) */
  native?: Record<string, unknown>
}

/**
 * Result of predicate analysis for pushdown
 */
export interface PredicateAnalysisResult {
  /** Predicates that can be pushed to each source */
  pushable: Map<string, QueryPredicate[]>
  /** Predicates that must remain at federation layer */
  residual: QueryPredicate[]
  /** Cross-source predicates (for joins) */
  crossSource: QueryPredicate[]
  /** Statistics about the analysis */
  stats: {
    totalPredicates: number
    pushedPredicates: number
    residualPredicates: number
    crossSourcePredicates: number
  }
}

/**
 * Pushdown rule definition
 */
export interface PushdownRule {
  /** Rule name for debugging */
  name: string
  /** Priority (higher = applied first) */
  priority: number
  /** Check if rule applies to a predicate */
  matches: (predicate: QueryPredicate, caps: PushdownCapabilities) => boolean
  /** Transform the predicate for pushdown */
  transform?: (predicate: QueryPredicate) => QueryPredicate
  /** Generate source-specific translation */
  translate?: (predicate: QueryPredicate, sourceType: string) => PredicateTranslation
}

/**
 * Source capability profile for pushdown decisions
 */
export interface SourceProfile {
  name: string
  type: string
  capabilities: PushdownCapabilities
  adapter?: SourceAdapter
  /** Tables this source provides */
  tables: string[]
}

/**
 * Pushdown plan for a single source
 */
export interface SourcePushdownPlan {
  source: string
  predicates: QueryPredicate[]
  translations: PredicateTranslation[]
  estimatedSelectivity: number
}

/**
 * Complete pushdown plan across all sources
 */
export interface FederatedPushdownPlan {
  sources: SourcePushdownPlan[]
  residualPredicates: QueryPredicate[]
  joinPredicates: QueryPredicate[]
  dataTransferEstimate: {
    withPushdown: number
    withoutPushdown: number
    reduction: number
  }
}

// =============================================================================
// PREDICATE ANALYZER
// =============================================================================

/**
 * Analyzes predicates to determine which can be pushed to source systems
 */
export class PredicateAnalyzer {
  private rules: PushdownRule[] = []

  constructor() {
    // Register default rules
    this.registerDefaultRules()
  }

  /**
   * Register a pushdown rule
   */
  registerRule(rule: PushdownRule): void {
    this.rules.push(rule)
    // Sort by priority (descending)
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Clear all rules
   */
  clearRules(): void {
    this.rules = []
  }

  /**
   * Get all registered rules
   */
  getRules(): PushdownRule[] {
    return [...this.rules]
  }

  /**
   * Register default pushdown rules
   */
  private registerDefaultRules(): void {
    // Rule: Simple equality comparisons
    this.registerRule({
      name: 'equality',
      priority: 100,
      matches: (pred, caps) =>
        pred.op === '=' && caps.predicatePushdown,
    })

    // Rule: Inequality comparisons
    this.registerRule({
      name: 'inequality',
      priority: 90,
      matches: (pred, caps) =>
        ['!=', '>', '<', '>=', '<='].includes(pred.op) &&
        caps.predicatePushdown,
    })

    // Rule: IN operator
    this.registerRule({
      name: 'in_operator',
      priority: 80,
      matches: (pred, caps) =>
        (pred.op === 'IN' || pred.op === 'NOT IN') &&
        caps.predicatePushdown &&
        (!caps.supportedOperators || caps.supportedOperators.includes(pred.op)),
    })

    // Rule: LIKE pattern matching
    this.registerRule({
      name: 'like_pattern',
      priority: 70,
      matches: (pred, caps) =>
        pred.op === 'LIKE' &&
        caps.predicatePushdown &&
        (!caps.supportedOperators || caps.supportedOperators.includes('LIKE')),
      translate: (pred, sourceType) => {
        if (sourceType === 'mongodb') {
          // MongoDB uses $regex
          const pattern = String(pred.value)
            .replace(/%/g, '.*')
            .replace(/_/g, '.')
          return {
            original: pred,
            translated: { ...pred, op: '=', value: { $regex: pattern } },
            native: { [pred.column]: { $regex: pattern, $options: 'i' } },
          }
        }
        if (sourceType === 'elasticsearch') {
          // ES uses wildcard query
          const pattern = String(pred.value).replace(/%/g, '*').replace(/_/g, '?')
          return {
            original: pred,
            translated: pred,
            native: { wildcard: { [pred.column]: { value: pattern } } },
          }
        }
        return { original: pred, translated: pred }
      },
    })

    // Rule: Range predicates (BETWEEN equivalent)
    this.registerRule({
      name: 'range',
      priority: 75,
      matches: (pred, caps) => {
        // Match compound range predicates
        if (['>', '<', '>=', '<='].includes(pred.op)) {
          return caps.predicatePushdown
        }
        return false
      },
    })

    // Rule: Null checks
    this.registerRule({
      name: 'null_check',
      priority: 85,
      matches: (pred, caps) =>
        (pred.value === null || pred.value === undefined) &&
        pred.op === '=' &&
        caps.predicatePushdown,
      transform: (pred) => ({
        ...pred,
        op: '=' as const,
        value: null,
      }),
      translate: (pred, sourceType) => {
        if (sourceType === 'mongodb') {
          return {
            original: pred,
            translated: pred,
            native: { [pred.column]: null },
          }
        }
        if (sourceType === 'postgres' || sourceType === 'sqlite') {
          return {
            original: pred,
            translated: pred,
            sql: `${pred.column} IS NULL`,
          }
        }
        return { original: pred, translated: pred }
      },
    })
  }

  /**
   * Analyze predicates for pushdown eligibility
   */
  analyze(
    predicates: QueryPredicate[],
    sources: SourceProfile[],
    tables: TableRef[]
  ): PredicateAnalysisResult {
    const pushable = new Map<string, QueryPredicate[]>()
    const residual: QueryPredicate[] = []
    const crossSource: QueryPredicate[] = []

    // Initialize pushable map
    for (const source of sources) {
      pushable.set(source.name, [])
    }

    for (const pred of predicates) {
      // Check if this is a cross-source predicate
      if (pred.ref) {
        crossSource.push(pred)
        continue
      }

      // Determine which source owns this predicate
      const owningSource = this.findOwningSource(pred, sources, tables)

      if (!owningSource) {
        residual.push(pred)
        continue
      }

      // Check if the source can handle this predicate
      const sourceProfile = sources.find((s) => s.name === owningSource)
      if (!sourceProfile) {
        residual.push(pred)
        continue
      }

      const canPush = this.canPushPredicate(pred, sourceProfile.capabilities)

      if (canPush) {
        const sourcePreds = pushable.get(owningSource) || []
        sourcePreds.push(pred)
        pushable.set(owningSource, sourcePreds)
      } else {
        residual.push(pred)
      }
    }

    return {
      pushable,
      residual,
      crossSource,
      stats: {
        totalPredicates: predicates.length,
        pushedPredicates: Array.from(pushable.values()).reduce(
          (sum, preds) => sum + preds.length,
          0
        ),
        residualPredicates: residual.length,
        crossSourcePredicates: crossSource.length,
      },
    }
  }

  /**
   * Find which source owns a predicate based on column reference
   */
  private findOwningSource(
    pred: QueryPredicate,
    sources: SourceProfile[],
    tables: TableRef[]
  ): string | null {
    const parts = pred.column.split('.')

    if (parts.length === 2) {
      // Qualified column (table.column or source.column)
      const qualifier = parts[0]!

      // Check if it's a table name
      const tableRef = tables.find(
        (t) => t.table === qualifier || t.alias === qualifier
      )
      if (tableRef) {
        return tableRef.source
      }

      // Check if it's a source name
      const source = sources.find((s) => s.name === qualifier)
      if (source) {
        return source.name
      }
    }

    // Unqualified column - find which source has this table
    if (tables.length === 1) {
      return tables[0]!.source
    }

    // Ambiguous - cannot determine source
    return null
  }

  /**
   * Check if a predicate can be pushed to a source
   */
  canPushPredicate(pred: QueryPredicate, caps: PushdownCapabilities): boolean {
    if (!caps.predicatePushdown) {
      return false
    }

    // Check if operator is supported
    if (caps.supportedOperators && !caps.supportedOperators.includes(pred.op)) {
      return false
    }

    // Find matching rule
    for (const rule of this.rules) {
      if (rule.matches(pred, caps)) {
        return true
      }
    }

    // Default: allow basic operators
    return ['=', '!=', '>', '<', '>=', '<='].includes(pred.op)
  }

  /**
   * Translate a predicate for a specific source
   */
  translatePredicate(
    pred: QueryPredicate,
    sourceType: string
  ): PredicateTranslation {
    // Find matching rule with translation
    for (const rule of this.rules) {
      if (rule.translate) {
        const caps: PushdownCapabilities = {
          predicatePushdown: true,
          projectionPushdown: true,
          limitPushdown: true,
          aggregationPushdown: false,
          joinPushdown: false,
        }
        if (rule.matches(pred, caps)) {
          return rule.translate(pred, sourceType)
        }
      }
    }

    // Default translation
    return this.defaultTranslation(pred, sourceType)
  }

  /**
   * Default predicate translation for common source types
   */
  private defaultTranslation(
    pred: QueryPredicate,
    sourceType: string
  ): PredicateTranslation {
    switch (sourceType) {
      case 'mongodb':
        return {
          original: pred,
          translated: pred,
          native: this.toMongoQuery(pred),
        }
      case 'elasticsearch':
        return {
          original: pred,
          translated: pred,
          native: this.toElasticsearchQuery(pred),
        }
      case 'postgres':
      case 'sqlite':
        return {
          original: pred,
          translated: pred,
          sql: this.toSQL(pred),
        }
      default:
        return { original: pred, translated: pred }
    }
  }

  /**
   * Convert predicate to MongoDB query format
   */
  private toMongoQuery(pred: QueryPredicate): Record<string, unknown> {
    const column = pred.column.split('.').pop()!
    const value = pred.value

    switch (pred.op) {
      case '=':
        return { [column]: value }
      case '!=':
        return { [column]: { $ne: value } }
      case '>':
        return { [column]: { $gt: value } }
      case '>=':
        return { [column]: { $gte: value } }
      case '<':
        return { [column]: { $lt: value } }
      case '<=':
        return { [column]: { $lte: value } }
      case 'IN':
        return { [column]: { $in: value } }
      case 'NOT IN':
        return { [column]: { $nin: value } }
      case 'LIKE': {
        const pattern = String(value).replace(/%/g, '.*').replace(/_/g, '.')
        return { [column]: { $regex: pattern, $options: 'i' } }
      }
      default:
        return { [column]: value }
    }
  }

  /**
   * Convert predicate to Elasticsearch DSL
   */
  private toElasticsearchQuery(pred: QueryPredicate): Record<string, unknown> {
    const column = pred.column.split('.').pop()!
    const value = pred.value

    switch (pred.op) {
      case '=':
        return { term: { [column]: value } }
      case '!=':
        return { bool: { must_not: { term: { [column]: value } } } }
      case '>':
        return { range: { [column]: { gt: value } } }
      case '>=':
        return { range: { [column]: { gte: value } } }
      case '<':
        return { range: { [column]: { lt: value } } }
      case '<=':
        return { range: { [column]: { lte: value } } }
      case 'IN':
        return { terms: { [column]: value } }
      case 'LIKE': {
        const pattern = String(value).replace(/%/g, '*').replace(/_/g, '?')
        return { wildcard: { [column]: { value: pattern } } }
      }
      default:
        return { term: { [column]: value } }
    }
  }

  /**
   * Convert predicate to SQL WHERE clause
   */
  private toSQL(pred: QueryPredicate): string {
    const column = pred.column
    const value = pred.value

    const formatValue = (v: unknown): string => {
      if (v === null) return 'NULL'
      if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`
      if (typeof v === 'number') return String(v)
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
      if (Array.isArray(v)) {
        return `(${v.map(formatValue).join(', ')})`
      }
      return String(v)
    }

    switch (pred.op) {
      case '=':
        if (value === null) return `${column} IS NULL`
        return `${column} = ${formatValue(value)}`
      case '!=':
        if (value === null) return `${column} IS NOT NULL`
        return `${column} != ${formatValue(value)}`
      case 'IN':
        return `${column} IN ${formatValue(value)}`
      case 'NOT IN':
        return `${column} NOT IN ${formatValue(value)}`
      default:
        return `${column} ${pred.op} ${formatValue(value)}`
    }
  }
}

// =============================================================================
// CONJUNCTION SPLITTER
// =============================================================================

/**
 * Splits AND conjunctions across sources for maximum pushdown
 */
export class ConjunctionSplitter {
  /**
   * Split predicates connected by AND
   * Returns predicates grouped by their applicable source
   */
  splitConjunction(
    predicates: QueryPredicate[],
    sources: SourceProfile[],
    tables: TableRef[]
  ): Map<string, QueryPredicate[]> {
    const result = new Map<string, QueryPredicate[]>()

    // Initialize with empty arrays for each source
    for (const source of sources) {
      result.set(source.name, [])
    }
    result.set('_residual', [])

    for (const pred of predicates) {
      const targetSource = this.determineTargetSource(pred, sources, tables)

      if (targetSource) {
        const sourcePreds = result.get(targetSource) || []
        sourcePreds.push(pred)
        result.set(targetSource, sourcePreds)
      } else {
        const residual = result.get('_residual') || []
        residual.push(pred)
        result.set('_residual', residual)
      }
    }

    return result
  }

  /**
   * Determine which source a predicate targets
   */
  private determineTargetSource(
    pred: QueryPredicate,
    sources: SourceProfile[],
    tables: TableRef[]
  ): string | null {
    // Cross-source predicates cannot be pushed
    if (pred.ref) {
      return null
    }

    const parts = pred.column.split('.')

    if (parts.length >= 2) {
      const qualifier = parts[0]!

      // Check table references
      const tableRef = tables.find(
        (t) => t.table === qualifier || t.alias === qualifier
      )
      if (tableRef) {
        return tableRef.source
      }

      // Check source names
      const source = sources.find((s) => s.name === qualifier)
      if (source) {
        return source.name
      }
    }

    // Single table query - use first table's source
    if (tables.length === 1) {
      return tables[0]!.source
    }

    return null
  }

  /**
   * Merge predicates for same source into conjunctions
   */
  mergePredicates(predicates: QueryPredicate[]): QueryPredicate[] {
    // Already in conjunction form, just return
    return predicates
  }
}

// =============================================================================
// PUSHDOWN OPTIMIZER
// =============================================================================

/**
 * Main optimizer that coordinates predicate pushdown
 */
export class PredicatePushdownOptimizer {
  private analyzer: PredicateAnalyzer
  private splitter: ConjunctionSplitter

  constructor() {
    this.analyzer = new PredicateAnalyzer()
    this.splitter = new ConjunctionSplitter()
  }

  /**
   * Create a complete pushdown plan
   */
  createPushdownPlan(
    predicates: QueryPredicate[],
    sources: SourceProfile[],
    tables: TableRef[],
    options?: {
      estimateSelectivity?: boolean
      translatePredicates?: boolean
    }
  ): FederatedPushdownPlan {
    // First, split predicates by source
    const splitResult = this.splitter.splitConjunction(predicates, sources, tables)

    // Analyze each source's predicates
    const analysis = this.analyzer.analyze(predicates, sources, tables)

    // Build source pushdown plans
    const sourcePlans: SourcePushdownPlan[] = []

    for (const source of sources) {
      const sourcePreds = analysis.pushable.get(source.name) || []
      const translations: PredicateTranslation[] = []

      if (options?.translatePredicates) {
        for (const pred of sourcePreds) {
          translations.push(
            this.analyzer.translatePredicate(pred, source.type)
          )
        }
      }

      const selectivity = options?.estimateSelectivity
        ? this.estimateSelectivity(sourcePreds)
        : 1.0

      sourcePlans.push({
        source: source.name,
        predicates: sourcePreds,
        translations,
        estimatedSelectivity: selectivity,
      })
    }

    // Estimate data transfer reduction
    const withPushdown = this.estimateDataTransfer(sourcePlans, true)
    const withoutPushdown = this.estimateDataTransfer(sourcePlans, false)

    return {
      sources: sourcePlans,
      residualPredicates: analysis.residual,
      joinPredicates: analysis.crossSource,
      dataTransferEstimate: {
        withPushdown,
        withoutPushdown,
        reduction: withoutPushdown > 0
          ? (withoutPushdown - withPushdown) / withoutPushdown
          : 0,
      },
    }
  }

  /**
   * Estimate predicate selectivity (0-1, lower = more selective)
   */
  private estimateSelectivity(predicates: QueryPredicate[]): number {
    if (predicates.length === 0) return 1.0

    let selectivity = 1.0

    for (const pred of predicates) {
      switch (pred.op) {
        case '=':
          selectivity *= 0.1 // Equality is highly selective
          break
        case '!=':
          selectivity *= 0.9 // Inequality filters little
          break
        case '>':
        case '<':
        case '>=':
        case '<=':
          selectivity *= 0.3 // Range filters moderately
          break
        case 'IN':
          selectivity *= Math.min(0.5, 0.05 * (Array.isArray(pred.value) ? pred.value.length : 1))
          break
        case 'LIKE':
          selectivity *= 0.2 // Pattern matching is moderately selective
          break
        default:
          selectivity *= 0.5
      }
    }

    return Math.max(0.001, selectivity)
  }

  /**
   * Estimate data transfer in arbitrary units
   */
  private estimateDataTransfer(
    plans: SourcePushdownPlan[],
    withPushdown: boolean
  ): number {
    let total = 0

    for (const plan of plans) {
      // Base estimate: 1000 units per source
      const base = 1000

      if (withPushdown) {
        // Apply selectivity reduction
        total += base * plan.estimatedSelectivity
      } else {
        // Full scan
        total += base
      }
    }

    return total
  }

  /**
   * Get the analyzer for direct use
   */
  getAnalyzer(): PredicateAnalyzer {
    return this.analyzer
  }

  /**
   * Register a custom pushdown rule
   */
  registerRule(rule: PushdownRule): void {
    this.analyzer.registerRule(rule)
  }
}

// =============================================================================
// PREDICATE REWRITER
// =============================================================================

/**
 * Rewrites predicates for source-specific optimization
 */
export class PredicateRewriter {
  /**
   * Rewrite BETWEEN as two range predicates
   */
  rewriteBetween(
    column: string,
    min: unknown,
    max: unknown
  ): QueryPredicate[] {
    return [
      { column, op: '>=', value: min },
      { column, op: '<=', value: max },
    ]
  }

  /**
   * Rewrite NOT IN as multiple != predicates (for sources that don't support IN)
   */
  rewriteNotIn(column: string, values: unknown[]): QueryPredicate[] {
    return values.map((value) => ({
      column,
      op: '!=' as const,
      value,
    }))
  }

  /**
   * Rewrite LIKE with prefix as range scan (for index optimization)
   */
  rewriteLikePrefix(column: string, pattern: string): QueryPredicate[] | null {
    // Check if pattern is a simple prefix (e.g., "abc%")
    if (!pattern.endsWith('%') || pattern.includes('%', 0)) {
      return null
    }

    const prefix = pattern.slice(0, -1)
    if (prefix.includes('_')) {
      return null
    }

    // Convert to range scan: prefix <= x < prefix + '\uffff'
    const endPrefix = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)

    return [
      { column, op: '>=', value: prefix },
      { column, op: '<', value: endPrefix },
    ]
  }

  /**
   * Simplify tautologies (always true)
   */
  simplifyTautology(pred: QueryPredicate): QueryPredicate | null {
    // 1 = 1 style predicates
    if (pred.column === pred.value && pred.op === '=') {
      return null // Remove, always true
    }

    return pred
  }

  /**
   * Detect contradictions (always false)
   */
  isContradiction(predicates: QueryPredicate[]): boolean {
    // Check for x = a AND x = b where a != b
    const equalityByColumn = new Map<string, unknown>()

    for (const pred of predicates) {
      if (pred.op === '=') {
        const existing = equalityByColumn.get(pred.column)
        if (existing !== undefined && existing !== pred.value) {
          return true // Contradiction found
        }
        equalityByColumn.set(pred.column, pred.value)
      }
    }

    return false
  }

  /**
   * Merge overlapping range predicates
   */
  mergeRanges(predicates: QueryPredicate[]): QueryPredicate[] {
    const byColumn = new Map<string, QueryPredicate[]>()

    // Group by column
    for (const pred of predicates) {
      const group = byColumn.get(pred.column) || []
      group.push(pred)
      byColumn.set(pred.column, group)
    }

    const result: QueryPredicate[] = []

    for (const [column, preds] of byColumn) {
      let lower: { value: unknown; inclusive: boolean } | null = null
      let upper: { value: unknown; inclusive: boolean } | null = null
      const others: QueryPredicate[] = []

      for (const pred of preds) {
        if (pred.op === '>' || pred.op === '>=') {
          const inclusive = pred.op === '>='
          if (!lower || this.compareValues(pred.value, lower.value) > 0) {
            lower = { value: pred.value, inclusive }
          }
        } else if (pred.op === '<' || pred.op === '<=') {
          const inclusive = pred.op === '<='
          if (!upper || this.compareValues(pred.value, upper.value) < 0) {
            upper = { value: pred.value, inclusive }
          }
        } else {
          others.push(pred)
        }
      }

      // Add merged range predicates
      if (lower) {
        result.push({
          column,
          op: lower.inclusive ? '>=' : '>',
          value: lower.value,
        })
      }
      if (upper) {
        result.push({
          column,
          op: upper.inclusive ? '<=' : '<',
          value: upper.value,
        })
      }

      result.push(...others)
    }

    return result
  }

  private compareValues(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b)
    }
    return 0
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  PredicateAnalyzer,
  ConjunctionSplitter,
  PredicatePushdownOptimizer,
  PredicateRewriter,
}

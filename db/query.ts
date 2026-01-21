// Query Interface - fluent QueryBuilder for Things
// Implements SQL WHERE clause generation to prevent client-side filtering (do-5k2l)
// Implements JOIN support for relationship traversal (do-zt9t)
// Implements bounded queries to prevent unbounded result sets (do-bgr1)

import type { Thing, ThingsStore } from './things'
import type { RelationshipsStore } from './relationships'
import type { JsonValue, StorableData } from './types'
import { ValidationError } from '../rpc/errors'

// ============================================================
// Query Limits Configuration (do-bgr1)
// Configurable defaults with warnings for large result sets
// ============================================================

/**
 * Default limits for query operations
 * These can be overridden via QueryLimitsConfig
 */
export const DEFAULT_QUERY_LIMITS = {
  /** Default limit for main query results */
  DEFAULT_LIMIT: 100,
  /** Default limit for JOIN operations per source entity */
  DEFAULT_JOIN_LIMIT: 50,
  /** Maximum allowed limit (hard cap) */
  MAX_LIMIT: 10000,
  /** Threshold at which to emit a warning */
  WARNING_THRESHOLD: 500,
  /** Default limit for fallback in-memory queries */
  FALLBACK_QUERY_LIMIT: 1000,
} as const

/**
 * Configurable query limits
 */
export interface QueryLimitsConfig {
  defaultLimit?: number
  defaultJoinLimit?: number
  maxLimit?: number
  warningThreshold?: number
  /** Optional callback for warnings */
  onWarning?: (message: string, context: { operation: string; requested: number; actual: number }) => void
}

// Global limits configuration (can be updated via configureQueryLimits)
let queryLimitsConfig: QueryLimitsConfig = {}

/**
 * Configure global query limits
 */
export function configureQueryLimits(config: QueryLimitsConfig): void {
  queryLimitsConfig = { ...queryLimitsConfig, ...config }
}

/**
 * Get current query limits
 */
export function getQueryLimits(): Required<Omit<QueryLimitsConfig, 'onWarning'>> & { onWarning?: QueryLimitsConfig['onWarning'] } {
  return {
    defaultLimit: queryLimitsConfig.defaultLimit ?? DEFAULT_QUERY_LIMITS.DEFAULT_LIMIT,
    defaultJoinLimit: queryLimitsConfig.defaultJoinLimit ?? DEFAULT_QUERY_LIMITS.DEFAULT_JOIN_LIMIT,
    maxLimit: queryLimitsConfig.maxLimit ?? DEFAULT_QUERY_LIMITS.MAX_LIMIT,
    warningThreshold: queryLimitsConfig.warningThreshold ?? DEFAULT_QUERY_LIMITS.WARNING_THRESHOLD,
    onWarning: queryLimitsConfig.onWarning,
  }
}

/**
 * Clamp a limit to the configured max and warn if approaching threshold
 */
function clampAndWarnLimit(requested: number | undefined, operation: string, defaultLimit: number): number {
  const limits = getQueryLimits()
  const effectiveLimit = requested ?? defaultLimit

  // Clamp to max
  const clampedLimit = Math.min(effectiveLimit, limits.maxLimit)

  // Warn if approaching threshold
  if (clampedLimit >= limits.warningThreshold && limits.onWarning) {
    limits.onWarning(
      `Large query detected: ${operation} requesting ${clampedLimit} results (threshold: ${limits.warningThreshold})`,
      { operation, requested: effectiveLimit, actual: clampedLimit }
    )
  }

  return clampedLimit
}

// Supported SQL operators for WHERE clauses
export type WhereOperator =
  | '='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'LIKE'
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL'

// A where condition with operator support
export interface WhereCondition {
  field: string
  operator: WhereOperator
  value: JsonValue | JsonValue[]
}

/**
 * Join type enum
 */
export const JoinType = {
  INNER: 'inner',
  LEFT: 'left',
  RIGHT: 'right',
  FULL: 'full',
} as const

export type JoinTypeValue = (typeof JoinType)[keyof typeof JoinType]

/**
 * Join options for controlling joined entity behavior
 */
export interface JoinOptions {
  limit?: number
  select?: string[]
}

/**
 * Join specification for relationship traversal
 */
export interface JoinSpec<T extends StorableData = StorableData> {
  predicate: string
  targetType: string
  conditions?: Partial<T>
  fromJoin?: string  // For chaining joins from previous join result
  alias?: string
  options?: JoinOptions
  joinType: JoinTypeValue
  direction: 'forward' | 'inverse'  // forward = subject->object, inverse = object->subject
}

export interface QueryOptions<T extends StorableData = StorableData> {
  type?: string
  where?: Partial<T>
  whereConditions?: WhereCondition[]
  orderBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
  select?: string[]
  joins?: JoinSpec[]
}

/**
 * Extended Thing type with joined data
 */
export interface ThingWithJoins extends Thing {
  _joined?: Record<string, Thing[]>
}

/**
 * Paginated query result with cursor-based pagination
 */
export interface PaginatedQueryResult<T extends ThingWithJoins = ThingWithJoins> {
  results: T[]
  cursor?: string
  hasMore: boolean
}

/**
 * Options for paginated execution
 */
export interface PaginatedExecuteOptions {
  limit?: number
  cursor?: string
}

export interface QueryBuilder<T extends StorableData = StorableData> {
  type(type: string): QueryBuilder<T>
  where(field: string, value: JsonValue): QueryBuilder<T>
  where<C extends Partial<T>>(conditions: C): QueryBuilder<T>
  whereOp(field: string, operator: WhereOperator, value: JsonValue | JsonValue[]): QueryBuilder<T>
  orderBy(field: string, order?: 'asc' | 'desc'): QueryBuilder<T>
  limit(n: number): QueryBuilder<T>
  offset(n: number): QueryBuilder<T>
  select(...fields: string[]): QueryBuilder<T>

  // JOIN methods for relationship traversal (forward direction: subject -> object)
  join<C extends StorableData = StorableData>(predicate: string, targetType: string, conditions?: Partial<C>, fromJoin?: string, alias?: string, options?: JoinOptions): QueryBuilder<T>
  leftJoin<C extends StorableData = StorableData>(predicate: string, targetType: string, conditions?: Partial<C>, fromJoin?: string, alias?: string, options?: JoinOptions): QueryBuilder<T>
  rightJoin<C extends StorableData = StorableData>(predicate: string, targetType: string, conditions?: Partial<C>, fromJoin?: string, alias?: string, options?: JoinOptions): QueryBuilder<T>
  fullJoin<C extends StorableData = StorableData>(predicate: string, targetType: string, conditions?: Partial<C>, fromJoin?: string, alias?: string, options?: JoinOptions): QueryBuilder<T>

  // JOIN methods for inverse relationship traversal (object -> subject)
  joinFrom<C extends StorableData = StorableData>(predicate: string, sourceType: string, conditions?: Partial<C>, alias?: string, options?: JoinOptions): QueryBuilder<T>
  leftJoinFrom<C extends StorableData = StorableData>(predicate: string, sourceType: string, conditions?: Partial<C>, alias?: string, options?: JoinOptions): QueryBuilder<T>
  rightJoinFrom<C extends StorableData = StorableData>(predicate: string, sourceType: string, conditions?: Partial<C>, alias?: string, options?: JoinOptions): QueryBuilder<T>
  fullJoinFrom<C extends StorableData = StorableData>(predicate: string, sourceType: string, conditions?: Partial<C>, alias?: string, options?: JoinOptions): QueryBuilder<T>

  // Execute
  execute(): Promise<ThingWithJoins[]>
  executePaginated(options?: PaginatedExecuteOptions): Promise<PaginatedQueryResult>
  first(): Promise<ThingWithJoins | null>
  count(): Promise<number>

  // For SQL stores - get the generated query info
  getQueryInfo(): { options: QueryOptions<T> }
}

// Regex for validating field names (alphanumeric + underscore + $ prefix for system fields)
const VALID_FIELD_NAME = /^[$a-zA-Z_][a-zA-Z0-9_$]*$/

/**
 * Validates a field name to prevent SQL injection
 * Throws a ValidationError if the field name is invalid
 */
function validateFieldName(field: string): void {
  if (!VALID_FIELD_NAME.test(field)) {
    throw ValidationError.forField(
      field,
      'must be alphanumeric (with underscores) and start with a letter, underscore, or $',
      field
    )
  }
}

/**
 * Apply a where condition to filter a thing (client-side evaluation)
 * Used for in-memory stores or when SQL filtering is not available
 */
function matchesCondition(thing: Thing, condition: WhereCondition): boolean {
  const { field, operator, value } = condition
  const thingValue = thing[field]

  switch (operator) {
    case '=':
      return thingValue === value
    case '!=':
      return thingValue !== value
    case '<':
      return (thingValue as number) < (value as number)
    case '>':
      return (thingValue as number) > (value as number)
    case '<=':
      return (thingValue as number) <= (value as number)
    case '>=':
      return (thingValue as number) >= (value as number)
    case 'LIKE':
      if (typeof thingValue !== 'string' || typeof value !== 'string') return false
      // Convert SQL LIKE pattern to regex
      const pattern = value
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except % and _
        .replace(/%/g, '.*')
        .replace(/_/g, '.')
      return new RegExp(`^${pattern}$`, 'i').test(thingValue)
    case 'IN':
      if (!Array.isArray(value)) return false
      if (value.length === 0) return false
      return value.includes(thingValue)
    case 'NOT IN':
      if (!Array.isArray(value)) return true
      if (value.length === 0) return true
      return !value.includes(thingValue)
    case 'IS NULL':
      return thingValue === null || thingValue === undefined
    case 'IS NOT NULL':
      return thingValue !== null && thingValue !== undefined
    default:
      return false
  }
}

/**
 * Create a query builder without JOIN support (backwards compatible)
 */
export function createQuery<T extends StorableData = StorableData>(store: ThingsStore): QueryBuilder<T> {
  return createQueryWithJoins<T>(store, undefined)
}

/**
 * Create a query builder with full JOIN support
 * @param store - The things store to query
 * @param relationshipsStore - Optional relationships store for JOIN operations
 */
export function createQueryWithJoins<T extends StorableData = StorableData>(
  store: ThingsStore,
  relationshipsStore: RelationshipsStore | undefined
): QueryBuilder<T> {
  const options: QueryOptions<T> = {
    whereConditions: [],
    joins: []
  }

  /**
   * Helper to add a join specification
   */
  function addJoin<C extends StorableData = StorableData>(
    predicate: string,
    targetType: string,
    joinType: JoinTypeValue,
    direction: 'forward' | 'inverse',
    conditions?: Partial<C>,
    fromJoin?: string,
    alias?: string,
    joinOptions?: JoinOptions
  ): void {
    options.joins!.push({
      predicate,
      targetType,
      conditions,
      fromJoin,
      alias,
      options: joinOptions,
      joinType,
      direction
    })
  }

  /**
   * Check if a thing matches the given conditions
   */
  function matchesJoinConditions<C extends StorableData>(thing: Thing, conditions?: Partial<C>): boolean {
    if (!conditions) return true
    for (const [field, value] of Object.entries(conditions)) {
      if (thing[field] !== value) return false
    }
    return true
  }

  /**
   * Apply projection to a thing based on select options
   */
  function applyProjection(thing: Thing, selectFields?: string[]): Thing {
    if (!selectFields || selectFields.length === 0) return thing
    const fields = ['$id', '$type', ...selectFields]
    const projected: Record<string, JsonValue> = {}
    for (const field of fields) {
      if (field in thing) {
        projected[field] = thing[field] as JsonValue
      }
    }
    return projected as Thing
  }

  /**
   * Execute joins for a single source thing
   * Enforces bounded limits on joined results (do-bgr1)
   */
  async function executeJoinsForThing(
    sourceThing: ThingWithJoins,
    joins: JoinSpec[],
    processedJoins: Map<string, ThingWithJoins[]>
  ): Promise<void> {
    if (!relationshipsStore) return

    for (const join of joins) {
      const { predicate, targetType, conditions, fromJoin, alias, options: joinOptions, direction } = join
      const joinKey = alias || (direction === 'forward' ? predicate : `${predicate}By`)

      // Calculate effective join limit with bounded default (do-bgr1)
      const effectiveJoinLimit = clampAndWarnLimit(
        joinOptions?.limit,
        `join-${joinKey}`,
        getQueryLimits().defaultJoinLimit
      )

      let sourceIds: string[]

      if (fromJoin) {
        // Chain from a previous join result
        const previousJoinedThings = sourceThing._joined?.[fromJoin] || []
        sourceIds = previousJoinedThings.map(t => t.$id)
      } else {
        sourceIds = [sourceThing.$id]
      }

      const joinedThings: Thing[] = []

      for (const sourceId of sourceIds) {
        let relatedIds: string[]

        if (direction === 'forward') {
          // subject -> object: find things where source is subject
          relatedIds = await relationshipsStore.getRelated(sourceId, predicate)
        } else {
          // object -> subject: find things where source is object
          relatedIds = await relationshipsStore.getRelatedTo(sourceId, predicate)
        }

        // Fetch the related things
        for (const relatedId of relatedIds) {
          const relatedThing = await store.get(relatedId)
          if (!relatedThing) continue

          // Check target type
          if (relatedThing.$type !== targetType) continue

          // Check conditions
          if (!matchesJoinConditions(relatedThing, conditions)) continue

          // Apply projection from join options
          const projected = joinOptions?.select
            ? applyProjection(relatedThing, joinOptions.select)
            : relatedThing

          joinedThings.push(projected)

          // Apply bounded limit (do-bgr1)
          if (joinedThings.length >= effectiveJoinLimit) {
            break
          }
        }

        // Apply bounded limit across all source IDs (do-bgr1)
        if (joinedThings.length >= effectiveJoinLimit) {
          break
        }
      }

      // Initialize _joined if needed
      if (!sourceThing._joined) {
        sourceThing._joined = {}
      }

      sourceThing._joined[joinKey] = joinedThings

      // For chained joins, we need to process nested joins on the joined things
      if (fromJoin) {
        const previousJoinedThings = sourceThing._joined[fromJoin] || []
        for (const prevThing of previousJoinedThings) {
          const prevThingWithJoins = prevThing as ThingWithJoins
          if (!prevThingWithJoins._joined) {
            prevThingWithJoins._joined = {}
          }
          // Find things that belong to this previous thing
          const thingsForPrev = joinedThings.filter(_jt => {
            // For forward joins from previous: the previous thing's ID should be the subject
            // For inverse joins from previous: the previous thing's ID should be the object
            return true // All joined things are associated with the source chain
          })
          prevThingWithJoins._joined[joinKey] = thingsForPrev
        }
      }

      processedJoins.set(joinKey, joinedThings as ThingWithJoins[])
    }
  }

  const builder: QueryBuilder<StorableData> = {
    type(type: string) {
      options.type = type
      return builder
    },

    where(fieldOrConditions: string | StorableData, value?: JsonValue) {
      if (typeof fieldOrConditions === 'string') {
        validateFieldName(fieldOrConditions)
        options.where = { ...options.where, [fieldOrConditions]: value }
        options.whereConditions!.push({
          field: fieldOrConditions,
          operator: '=',
          value: value ?? null
        })
      } else {
        for (const field of Object.keys(fieldOrConditions)) {
          validateFieldName(field)
        }
        options.where = { ...options.where, ...fieldOrConditions }
        for (const [field, val] of Object.entries(fieldOrConditions)) {
          options.whereConditions!.push({
            field,
            operator: '=',
            value: val
          })
        }
      }
      return builder
    },

    whereOp(field: string, operator: WhereOperator, value: JsonValue | JsonValue[]) {
      validateFieldName(field)
      options.whereConditions!.push({ field, operator, value })
      return builder
    },

    orderBy(field: string, order: 'asc' | 'desc' = 'desc') {
      validateFieldName(field)
      options.orderBy = field
      options.order = order
      return builder
    },

    limit(n: number) {
      options.limit = n
      return builder
    },

    offset(n: number) {
      options.offset = n
      return builder
    },

    select(...fields: string[]) {
      for (const field of fields) {
        validateFieldName(field)
      }
      options.select = fields
      return builder
    },

    // Forward JOIN methods (subject -> object)
    join(predicate, targetType, conditions, fromJoin, alias, joinOptions) {
      addJoin(predicate, targetType, JoinType.INNER, 'forward', conditions, fromJoin, alias, joinOptions)
      return builder
    },

    leftJoin(predicate, targetType, conditions, fromJoin, alias, joinOptions) {
      addJoin(predicate, targetType, JoinType.LEFT, 'forward', conditions, fromJoin, alias, joinOptions)
      return builder
    },

    rightJoin(predicate, targetType, conditions, fromJoin, alias, joinOptions) {
      addJoin(predicate, targetType, JoinType.RIGHT, 'forward', conditions, fromJoin, alias, joinOptions)
      return builder
    },

    fullJoin(predicate, targetType, conditions, fromJoin, alias, joinOptions) {
      addJoin(predicate, targetType, JoinType.FULL, 'forward', conditions, fromJoin, alias, joinOptions)
      return builder
    },

    // Inverse JOIN methods (object -> subject)
    joinFrom(predicate, sourceType, conditions, alias, joinOptions) {
      addJoin(predicate, sourceType, JoinType.INNER, 'inverse', conditions, undefined, alias, joinOptions)
      return builder
    },

    leftJoinFrom(predicate, sourceType, conditions, alias, joinOptions) {
      addJoin(predicate, sourceType, JoinType.LEFT, 'inverse', conditions, undefined, alias, joinOptions)
      return builder
    },

    rightJoinFrom(predicate, sourceType, conditions, alias, joinOptions) {
      addJoin(predicate, sourceType, JoinType.RIGHT, 'inverse', conditions, undefined, alias, joinOptions)
      return builder
    },

    fullJoinFrom(predicate, sourceType, conditions, alias, joinOptions) {
      addJoin(predicate, sourceType, JoinType.FULL, 'inverse', conditions, undefined, alias, joinOptions)
      return builder
    },

    getQueryInfo() {
      return { options }
    },

    async execute(): Promise<ThingWithJoins[]> {
      // Check if the store supports SQL-native queries
      const sqlStore = store as ThingsStore & {
        queryWithConditions?: (options: QueryOptions) => Promise<Thing[]>
      }

      let results: Thing[]

      if (sqlStore.queryWithConditions) {
        results = await sqlStore.queryWithConditions(options)
      } else {
        // Fallback: In-memory filtering with bounded limit (do-bgr1)
        const fallbackLimit = clampAndWarnLimit(
          DEFAULT_QUERY_LIMITS.FALLBACK_QUERY_LIMIT,
          'fallback-query',
          DEFAULT_QUERY_LIMITS.FALLBACK_QUERY_LIMIT
        )
        results = await store.list({
          type: options.type,
          limit: fallbackLimit
        })

        // Apply whereConditions
        if (options.whereConditions && options.whereConditions.length > 0) {
          results = results.filter(thing => {
            return options.whereConditions!.every(condition =>
              matchesCondition(thing, condition)
            )
          })
        }

        // Apply ordering
        if (options.orderBy) {
          const field = options.orderBy
          const multiplier = options.order === 'asc' ? 1 : -1
          results.sort((a, b) => {
            const aVal = a[field] as string | number | boolean | null | undefined
            const bVal = b[field] as string | number | boolean | null | undefined
            if (aVal == null && bVal == null) return 0
            if (aVal == null) return 1 * multiplier
            if (bVal == null) return -1 * multiplier
            if (aVal < bVal) return -1 * multiplier
            if (aVal > bVal) return 1 * multiplier
            return 0
          })
        }

        // Apply pagination with bounded limits (do-bgr1)
        const offset = options.offset || 0
        const limit = clampAndWarnLimit(options.limit, 'execute-pagination', getQueryLimits().defaultLimit)
        results = results.slice(offset, offset + limit)

        // Apply projection
        if (options.select && options.select.length > 0) {
          const fields = ['$id', '$type', ...options.select]
          results = results.map(thing => {
            const projected: Record<string, JsonValue> = {}
            for (const field of fields) {
              if (field in thing) {
                projected[field] = thing[field] as JsonValue
              }
            }
            return projected as Thing
          })
        }
      }

      // Handle JOINs if we have a relationships store and joins are specified
      if (relationshipsStore && options.joins && options.joins.length > 0) {
        const resultsWithJoins: ThingWithJoins[] = results.map(r => ({ ...r }))

        // Separate joins by type for different handling
        const innerJoins = options.joins.filter(j => j.joinType === JoinType.INNER)
        const leftJoins = options.joins.filter(j => j.joinType === JoinType.LEFT)
        const rightJoins = options.joins.filter(j => j.joinType === JoinType.RIGHT)
        const fullJoins = options.joins.filter(j => j.joinType === JoinType.FULL)

        // Process LEFT JOINs: include all source entities
        for (const thing of resultsWithJoins) {
          const processedJoins = new Map<string, ThingWithJoins[]>()

          // Execute LEFT joins first (they preserve all source entities)
          await executeJoinsForThing(thing, leftJoins, processedJoins)

          // Execute FULL joins (preserve all on both sides)
          await executeJoinsForThing(thing, fullJoins, processedJoins)

          // Execute INNER joins
          await executeJoinsForThing(thing, innerJoins, processedJoins)

          // Execute RIGHT joins
          await executeJoinsForThing(thing, rightJoins, processedJoins)
        }

        // Filter results based on INNER JOIN requirements
        let finalResults = resultsWithJoins
        if (innerJoins.length > 0) {
          finalResults = resultsWithJoins.filter(thing => {
            // For INNER JOINs, thing must have at least one match for each join
            for (const join of innerJoins) {
              const joinKey = join.alias || (join.direction === 'forward' ? join.predicate : `${join.predicate}By`)
              const joinedThings = thing._joined?.[joinKey] || []
              if (joinedThings.length === 0) {
                return false
              }
            }
            return true
          })
        }

        // Handle RIGHT JOINs: include unmatched target entities
        if (rightJoins.length > 0) {
          for (const rightJoin of rightJoins) {
            // Find all target entities that weren't matched (bounded limit, do-bgr1)
            const rightJoinLimit = clampAndWarnLimit(
              rightJoin.options?.limit,
              'right-join-target-fetch',
              getQueryLimits().defaultJoinLimit
            )
            const targetThings = await store.list({ type: rightJoin.targetType, limit: rightJoinLimit })
            const matchedTargetIds = new Set<string>()

            // Collect all matched target IDs from the current results
            for (const thing of finalResults) {
              const joinKey = rightJoin.alias || (rightJoin.direction === 'forward' ? rightJoin.predicate : `${rightJoin.predicate}By`)
              const joined = thing._joined?.[joinKey] || []
              for (const jt of joined) {
                matchedTargetIds.add(jt.$id)
              }
            }

            // Add unmatched targets with null source
            for (const targetThing of targetThings) {
              if (!matchedTargetIds.has(targetThing.$id)) {
                if (matchesJoinConditions(targetThing, rightJoin.conditions)) {
                  // Create a "null" source entry with the unmatched target
                  const joinKey = rightJoin.alias || (rightJoin.direction === 'forward' ? rightJoin.predicate : `${rightJoin.predicate}By`)
                  const nullEntry: ThingWithJoins = {
                    $id: '',
                    $type: options.type || '',
                    $createdAt: 0,
                    $updatedAt: 0,
                    _joined: {
                      [joinKey]: [targetThing]
                    }
                  }
                  finalResults.push(nullEntry)
                }
              }
            }
          }
        }

        // Handle FULL OUTER JOINs: include unmatched on both sides
        if (fullJoins.length > 0) {
          for (const fullJoin of fullJoins) {
            // Bounded limit for full join target fetch (do-bgr1)
            const fullJoinLimit = clampAndWarnLimit(
              fullJoin.options?.limit,
              'full-join-target-fetch',
              getQueryLimits().defaultJoinLimit
            )
            const targetThings = await store.list({ type: fullJoin.targetType, limit: fullJoinLimit })
            const matchedTargetIds = new Set<string>()

            // Collect all matched target IDs
            for (const thing of finalResults) {
              const joinKey = fullJoin.alias || (fullJoin.direction === 'forward' ? fullJoin.predicate : `${fullJoin.predicate}By`)
              const joined = thing._joined?.[joinKey] || []
              for (const jt of joined) {
                matchedTargetIds.add(jt.$id)
              }
            }

            // Add unmatched targets
            for (const targetThing of targetThings) {
              if (!matchedTargetIds.has(targetThing.$id)) {
                if (matchesJoinConditions(targetThing, fullJoin.conditions)) {
                  const joinKey = fullJoin.alias || (fullJoin.direction === 'forward' ? fullJoin.predicate : `${fullJoin.predicate}By`)
                  const nullEntry: ThingWithJoins = {
                    $id: '',
                    $type: options.type || '',
                    $createdAt: 0,
                    $updatedAt: 0,
                    _joined: {
                      [joinKey]: [targetThing]
                    }
                  }
                  finalResults.push(nullEntry)
                }
              }
            }
          }
        }

        return finalResults
      }

      return results
    },

    async first(): Promise<ThingWithJoins | null> {
      const results = await builder.limit(1).execute()
      return results[0] ?? null
    },

    async executePaginated(paginatedOptions: PaginatedExecuteOptions = {}): Promise<PaginatedQueryResult> {
      const limits = getQueryLimits()
      const requestedLimit = paginatedOptions.limit ?? limits.defaultLimit
      const effectiveLimit = clampAndWarnLimit(requestedLimit, 'executePaginated', limits.defaultLimit)

      // Decode cursor to get offset
      let offset = 0
      if (paginatedOptions.cursor) {
        try {
          const decoded = JSON.parse(atob(paginatedOptions.cursor))
          offset = decoded.offset ?? 0
        } catch {
          // Invalid cursor, start from beginning
          offset = 0
        }
      }

      // Save original options and set pagination
      const originalLimit = options.limit
      const originalOffset = options.offset
      options.limit = effectiveLimit + 1 // Fetch one extra to check for more
      options.offset = offset

      const results = await builder.execute()

      // Restore original options
      options.limit = originalLimit
      options.offset = originalOffset

      // Check if there are more results
      const hasMore = results.length > effectiveLimit
      const finalResults = hasMore ? results.slice(0, effectiveLimit) : results

      // Generate next cursor if there are more results
      let nextCursor: string | undefined
      if (hasMore) {
        nextCursor = btoa(JSON.stringify({ offset: offset + effectiveLimit }))
      }

      return {
        results: finalResults,
        cursor: nextCursor,
        hasMore
      }
    },

    async count(): Promise<number> {
      const sqlStore = store as ThingsStore & {
        countWithConditions?: (options: QueryOptions) => Promise<number>
      }

      if (sqlStore.countWithConditions) {
        return sqlStore.countWithConditions(options)
      }

      // Use bounded max limit for count fallback (do-bgr1)
      const originalLimit = options.limit
      const countLimit = clampAndWarnLimit(
        getQueryLimits().maxLimit,
        'count-fallback',
        getQueryLimits().maxLimit
      )
      options.limit = countLimit
      const results = await builder.execute()
      options.limit = originalLimit
      return results.length
    }
  }

  return builder as QueryBuilder<T>
}

// Convenience function overloads
export function query<T extends StorableData = StorableData>(store: ThingsStore): QueryBuilder<T>
export function query<T extends StorableData = StorableData>(store: ThingsStore, relationships: RelationshipsStore): QueryBuilder<T>
export function query<T extends StorableData = StorableData>(store: ThingsStore, relationships?: RelationshipsStore): QueryBuilder<T> {
  return createQueryWithJoins<T>(store, relationships)
}

// ============================================================
// SQL WHERE clause generation utilities
// Used by SQLite-backed stores for efficient database queries
// ============================================================

/**
 * Builds SQL WHERE clause and parameters from QueryOptions
 * Returns { clause: string, params: JsonValue[] }
 *
 * IMPORTANT: This uses parameterized queries to prevent SQL injection.
 * Field names are validated with VALID_FIELD_NAME regex.
 * Values are bound as parameters, never interpolated into SQL.
 */
export function buildWhereClause<T extends StorableData = StorableData>(options: QueryOptions<T>): {
  clause: string
  params: JsonValue[]
} {
  const clauses: string[] = []
  const params: JsonValue[] = []

  // Handle type filter
  if (options.type) {
    clauses.push('type = ?')
    params.push(options.type)
  }

  // Handle whereConditions
  if (options.whereConditions && options.whereConditions.length > 0) {
    for (const condition of options.whereConditions) {
      const { field, operator, value } = condition

      // Map field names - $type, $id etc. map to columns
      const sqlField = mapFieldToColumn(field)

      switch (operator) {
        case '=':
        case '!=':
        case '<':
        case '>':
        case '<=':
        case '>=':
          // For JSON-stored fields, use json_extract
          if (isJsonField(field)) {
            clauses.push(`json_extract(data, '$.${field}') ${operator} ?`)
          } else {
            clauses.push(`${sqlField} ${operator} ?`)
          }
          params.push(value)
          break

        case 'LIKE':
          if (isJsonField(field)) {
            clauses.push(`json_extract(data, '$.${field}') LIKE ?`)
          } else {
            clauses.push(`${sqlField} LIKE ?`)
          }
          params.push(value)
          break

        case 'IN':
          if (!Array.isArray(value) || value.length === 0) {
            // Empty IN clause - always false
            clauses.push('1 = 0')
          } else {
            const placeholders = value.map(() => '?').join(', ')
            if (isJsonField(field)) {
              clauses.push(`json_extract(data, '$.${field}') IN (${placeholders})`)
            } else {
              clauses.push(`${sqlField} IN (${placeholders})`)
            }
            params.push(...value)
          }
          break

        case 'NOT IN':
          if (!Array.isArray(value) || value.length === 0) {
            // Empty NOT IN clause - always true (no-op)
            // Don't add any clause
          } else {
            const placeholders = value.map(() => '?').join(', ')
            if (isJsonField(field)) {
              clauses.push(`json_extract(data, '$.${field}') NOT IN (${placeholders})`)
            } else {
              clauses.push(`${sqlField} NOT IN (${placeholders})`)
            }
            params.push(...value)
          }
          break

        case 'IS NULL':
          if (isJsonField(field)) {
            clauses.push(`(json_extract(data, '$.${field}') IS NULL OR json_type(data, '$.${field}') = 'null')`)
          } else {
            clauses.push(`${sqlField} IS NULL`)
          }
          break

        case 'IS NOT NULL':
          if (isJsonField(field)) {
            clauses.push(`(json_extract(data, '$.${field}') IS NOT NULL AND json_type(data, '$.${field}') != 'null')`)
          } else {
            clauses.push(`${sqlField} IS NOT NULL`)
          }
          break
      }
    }
  }

  const clause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return { clause, params }
}

/**
 * Maps a Thing field name to the corresponding SQL column name
 */
function mapFieldToColumn(field: string): string {
  switch (field) {
    case '$id':
      return 'id'
    case '$type':
      return 'type'
    case '$createdAt':
      return 'created_at'
    case '$updatedAt':
      return 'updated_at'
    default:
      return field
  }
}

/**
 * Checks if a field is stored in the JSON data column
 * System fields ($id, $type, etc.) are stored as regular columns
 */
function isJsonField(field: string): boolean {
  return !field.startsWith('$')
}

/**
 * Builds the ORDER BY clause
 */
export function buildOrderByClause<T extends StorableData = StorableData>(options: QueryOptions<T>): string {
  if (!options.orderBy) {
    return 'ORDER BY created_at DESC'
  }

  const sqlField = isJsonField(options.orderBy)
    ? `json_extract(data, '$.${options.orderBy}')`
    : mapFieldToColumn(options.orderBy)

  const direction = options.order === 'asc' ? 'ASC' : 'DESC'
  return `ORDER BY ${sqlField} ${direction}`
}

/**
 * Builds pagination clause with bounded limits (do-bgr1)
 */
export function buildPaginationClause<T extends StorableData = StorableData>(options: QueryOptions<T>): {
  clause: string
  params: JsonValue[]
} {
  const limits = getQueryLimits()
  const requestedLimit = options.limit ?? limits.defaultLimit
  // Clamp to max limit to prevent unbounded queries
  const limit = Math.min(requestedLimit, limits.maxLimit)
  const offset = options.offset || 0
  return {
    clause: 'LIMIT ? OFFSET ?',
    params: [limit, offset]
  }
}

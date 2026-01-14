/**
 * Platform Event Store - Unified Event Capture and Query
 *
 * This module provides the implementation of the PlatformEventStore interface
 * for capturing and querying unified platform events. It is designed to be
 * used by DOBase to provide the $.emit() API.
 *
 * Features:
 * - Unified event capture via emit()
 * - Batch event ingestion
 * - Flexible querying with filtering and aggregation
 * - Idempotency support for metering events
 * - Pre-computed aggregations for fast analytics
 *
 * @module db/primitives/platform-event-store
 */

import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { eq, and, gte, lte, inArray, sql, desc, asc } from 'drizzle-orm'
import {
  platformEvents,
  eventAggregationsHourly,
  type PlatformEventRow,
  type PlatformEventInsert,
  type EventAggregationHourlyInsert,
} from '../../platform-events'
import {
  type PlatformEvent,
  type PlatformEventInput,
  type PlatformEventFilter,
  type PlatformEventQueryOptions,
  type PlatformEventQueryResult,
  type PlatformEventStore,
  type AggregationPoint,
  type EventCategory,
  createPlatformEvent,
  generateEventId,
} from '../../../types/platform-event'

// =============================================================================
// STORE IMPLEMENTATION
// =============================================================================

/**
 * Configuration for the platform event store
 */
export interface PlatformEventStoreConfig {
  /** Namespace URL for this DO */
  ns: string
  /** Durable Object ID */
  doId?: string
  /** DO class name */
  doClass?: string
  /** Cloudflare colo code */
  colo?: string
  /** Default organization ID */
  orgId?: string
  /** Enable aggregation rollups */
  enableAggregations?: boolean
}

/**
 * Create a platform event store implementation
 */
export function createPlatformEventStore(
  db: SqliteRemoteDatabase<Record<string, unknown>>,
  config: PlatformEventStoreConfig
): PlatformEventStore {
  const context = {
    ns: config.ns,
    doId: config.doId,
    doClass: config.doClass,
    colo: config.colo,
    orgId: config.orgId,
  }

  /**
   * Convert PlatformEvent to database row
   */
  function eventToRow(event: PlatformEvent): PlatformEventInsert {
    return {
      id: event.id,
      category: event.category,
      type: event.type,
      actor: event.actor,
      actorType: event.actorType,
      orgId: event.orgId,
      customerId: event.customerId,
      object: event.object,
      objectType: event.objectType,
      data: event.data,
      timestamp: event.timestamp,
      recordedAt: event.recordedAt,
      ns: event.ns,
      doId: event.doId,
      doClass: event.doClass,
      location: event.location,
      colo: event.colo,
      reason: event.reason,
      disposition: event.disposition,
      channel: event.channel,
      method: event.method,
      context: event.context,
      sessionId: event.sessionId,
      deviceId: event.deviceId,
      userAgent: event.userAgent,
      ip: event.ip,
      experimentId: event.experimentId,
      variant: event.variant,
      value: event.value,
      unit: event.unit,
      idempotencyKey: event.idempotencyKey,
      subscriptionId: event.subscriptionId,
      planId: event.planId,
      featureId: event.featureId,
      dimensions: event.dimensions,
      apiKeyId: event.apiKeyId,
      rateLimitBucket: event.rateLimitBucket,
      requestPath: event.requestPath,
      httpMethod: event.httpMethod,
      statusCode: event.statusCode,
      duration: event.duration,
      correlationId: event.correlationId,
      parentEventId: event.parentEventId,
      traceId: event.traceId,
      spanId: event.spanId,
      schemaVersion: event.schemaVersion,
      extensions: event.extensions,
    }
  }

  /**
   * Convert database row to PlatformEvent
   */
  function rowToEvent(row: PlatformEventRow): PlatformEvent {
    return {
      id: row.id,
      category: row.category as EventCategory,
      type: row.type,
      actor: row.actor,
      actorType: row.actorType as PlatformEvent['actorType'],
      orgId: row.orgId ?? undefined,
      customerId: row.customerId ?? undefined,
      object: row.object ?? undefined,
      objectType: row.objectType ?? undefined,
      data: row.data ?? {},
      timestamp: row.timestamp,
      recordedAt: row.recordedAt,
      ns: row.ns,
      doId: row.doId ?? undefined,
      doClass: row.doClass ?? undefined,
      location: row.location ?? undefined,
      colo: row.colo ?? undefined,
      reason: row.reason ?? undefined,
      disposition: row.disposition ?? undefined,
      channel: row.channel ?? undefined,
      method: row.method as PlatformEvent['method'],
      context: row.context ?? undefined,
      sessionId: row.sessionId ?? undefined,
      deviceId: row.deviceId ?? undefined,
      userAgent: row.userAgent ?? undefined,
      ip: row.ip ?? undefined,
      experimentId: row.experimentId ?? undefined,
      variant: row.variant ?? undefined,
      value: row.value ?? undefined,
      unit: row.unit ?? undefined,
      idempotencyKey: row.idempotencyKey ?? undefined,
      subscriptionId: row.subscriptionId ?? undefined,
      planId: row.planId ?? undefined,
      featureId: row.featureId ?? undefined,
      dimensions: row.dimensions ?? undefined,
      apiKeyId: row.apiKeyId ?? undefined,
      rateLimitBucket: row.rateLimitBucket ?? undefined,
      requestPath: row.requestPath ?? undefined,
      httpMethod: row.httpMethod ?? undefined,
      statusCode: row.statusCode ?? undefined,
      duration: row.duration ?? undefined,
      correlationId: row.correlationId ?? undefined,
      parentEventId: row.parentEventId ?? undefined,
      traceId: row.traceId ?? undefined,
      spanId: row.spanId ?? undefined,
      schemaVersion: row.schemaVersion,
      extensions: row.extensions ?? undefined,
    }
  }

  /**
   * Check for idempotency key collision
   */
  async function checkIdempotency(idempotencyKey: string): Promise<string | null> {
    const existing = await db
      .select({ id: platformEvents.id })
      .from(platformEvents)
      .where(eq(platformEvents.idempotencyKey, idempotencyKey))
      .limit(1)

    return existing.length > 0 ? existing[0]!.id : null
  }

  /**
   * Update hourly aggregations
   */
  async function updateAggregations(event: PlatformEvent): Promise<void> {
    if (!config.enableAggregations) return

    // Calculate hour bucket
    const hourTimestamp = Math.floor(event.timestamp / (60 * 60 * 1000)) * 60 * 60 * 1000

    // Generate aggregation ID
    const aggId = `agg_${hourTimestamp}_${event.category}_${event.type}_${event.orgId || 'none'}_${event.customerId || 'none'}_${event.featureId || 'none'}`

    // Upsert aggregation
    const now = new Date()
    const aggRow: EventAggregationHourlyInsert = {
      id: aggId,
      hourTimestamp,
      category: event.category,
      type: event.type,
      orgId: event.orgId,
      customerId: event.customerId,
      featureId: event.featureId,
      apiKeyId: event.apiKeyId,
      variant: event.variant,
      count: 1,
      sum: event.value,
      min: event.value,
      max: event.value,
      updatedAt: now,
    }

    // SQLite upsert
    await db
      .insert(eventAggregationsHourly)
      .values(aggRow)
      .onConflictDoUpdate({
        target: eventAggregationsHourly.id,
        set: {
          count: sql`${eventAggregationsHourly.count} + 1`,
          sum: event.value !== undefined
            ? sql`COALESCE(${eventAggregationsHourly.sum}, 0) + ${event.value}`
            : eventAggregationsHourly.sum,
          min: event.value !== undefined
            ? sql`MIN(COALESCE(${eventAggregationsHourly.min}, ${event.value}), ${event.value})`
            : eventAggregationsHourly.min,
          max: event.value !== undefined
            ? sql`MAX(COALESCE(${eventAggregationsHourly.max}, ${event.value}), ${event.value})`
            : eventAggregationsHourly.max,
          updatedAt: now,
        },
      })
  }

  return {
    /**
     * Emit a single event
     */
    async emit(input: PlatformEventInput): Promise<string> {
      const event = createPlatformEvent(input, context)

      // Check idempotency for meter events
      if (event.category === 'meter' && event.idempotencyKey) {
        const existingId = await checkIdempotency(event.idempotencyKey)
        if (existingId) {
          return existingId // Return existing event ID
        }
      }

      // Insert event
      const row = eventToRow(event)
      await db.insert(platformEvents).values(row)

      // Update aggregations
      await updateAggregations(event)

      return event.id
    },

    /**
     * Emit multiple events in a batch
     */
    async emitBatch(inputs: PlatformEventInput[]): Promise<string[]> {
      const events = inputs.map((input) => createPlatformEvent(input, context))
      const ids: string[] = []

      for (const event of events) {
        // Check idempotency for meter events
        if (event.category === 'meter' && event.idempotencyKey) {
          const existingId = await checkIdempotency(event.idempotencyKey)
          if (existingId) {
            ids.push(existingId)
            continue
          }
        }

        // Insert event
        const row = eventToRow(event)
        await db.insert(platformEvents).values(row)
        ids.push(event.id)

        // Update aggregations
        await updateAggregations(event)
      }

      return ids
    },

    /**
     * Query events with filtering and aggregation
     */
    async query(options: PlatformEventQueryOptions): Promise<PlatformEventQueryResult> {
      const { filter, aggregation, limit = 100, offset = 0, orderBy = 'timestamp', orderDirection = 'desc' } = options

      // Build where conditions
      const conditions: ReturnType<typeof eq>[] = []

      if (filter) {
        if (filter.category) {
          if (Array.isArray(filter.category)) {
            conditions.push(inArray(platformEvents.category, filter.category))
          } else {
            conditions.push(eq(platformEvents.category, filter.category))
          }
        }

        if (filter.type) {
          if (Array.isArray(filter.type)) {
            conditions.push(inArray(platformEvents.type, filter.type))
          } else {
            conditions.push(eq(platformEvents.type, filter.type))
          }
        }

        if (filter.actor) {
          if (Array.isArray(filter.actor)) {
            conditions.push(inArray(platformEvents.actor, filter.actor))
          } else {
            conditions.push(eq(platformEvents.actor, filter.actor))
          }
        }

        if (filter.actorType) {
          if (Array.isArray(filter.actorType)) {
            conditions.push(inArray(platformEvents.actorType, filter.actorType))
          } else {
            conditions.push(eq(platformEvents.actorType, filter.actorType))
          }
        }

        if (filter.orgId) {
          conditions.push(eq(platformEvents.orgId, filter.orgId))
        }

        if (filter.customerId) {
          conditions.push(eq(platformEvents.customerId, filter.customerId))
        }

        if (filter.object) {
          conditions.push(eq(platformEvents.object, filter.object))
        }

        if (filter.objectType) {
          conditions.push(eq(platformEvents.objectType, filter.objectType))
        }

        if (filter.timeRange) {
          if (filter.timeRange.from !== undefined) {
            conditions.push(gte(platformEvents.timestamp, filter.timeRange.from))
          }
          if (filter.timeRange.to !== undefined) {
            conditions.push(lte(platformEvents.timestamp, filter.timeRange.to))
          }
        }

        if (filter.doId) {
          conditions.push(eq(platformEvents.doId, filter.doId))
        }

        if (filter.doClass) {
          conditions.push(eq(platformEvents.doClass, filter.doClass))
        }

        if (filter.sessionId) {
          conditions.push(eq(platformEvents.sessionId, filter.sessionId))
        }

        if (filter.experimentId) {
          conditions.push(eq(platformEvents.experimentId, filter.experimentId))
        }

        if (filter.variant) {
          conditions.push(eq(platformEvents.variant, filter.variant))
        }

        if (filter.featureId) {
          conditions.push(eq(platformEvents.featureId, filter.featureId))
        }

        if (filter.planId) {
          conditions.push(eq(platformEvents.planId, filter.planId))
        }

        if (filter.apiKeyId) {
          conditions.push(eq(platformEvents.apiKeyId, filter.apiKeyId))
        }

        if (filter.correlationId) {
          conditions.push(eq(platformEvents.correlationId, filter.correlationId))
        }

        if (filter.parentEventId) {
          conditions.push(eq(platformEvents.parentEventId, filter.parentEventId))
        }

        if (filter.statusCode) {
          if (typeof filter.statusCode === 'number') {
            conditions.push(eq(platformEvents.statusCode, filter.statusCode))
          } else {
            if (filter.statusCode.gte !== undefined) {
              conditions.push(gte(platformEvents.statusCode, filter.statusCode.gte))
            }
            if (filter.statusCode.lte !== undefined) {
              conditions.push(lte(platformEvents.statusCode, filter.statusCode.lte))
            }
          }
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Aggregation query
      if (aggregation) {
        const result = await buildAggregationQuery(db, whereClause, aggregation, filter)
        return {
          aggregation: result,
          total: result.length,
        }
      }

      // Regular query with pagination
      const orderColumn = orderBy === 'recordedAt' ? platformEvents.recordedAt : platformEvents.timestamp
      const order = orderDirection === 'asc' ? asc(orderColumn) : desc(orderColumn)

      const rows = await db
        .select()
        .from(platformEvents)
        .where(whereClause)
        .orderBy(order)
        .limit(limit)
        .offset(offset)

      const events = rows.map(rowToEvent)

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(platformEvents)
        .where(whereClause)

      const total = countResult[0]?.count ?? 0

      return {
        events,
        total,
      }
    },

    /**
     * Get a single event by ID
     */
    async get(id: string): Promise<PlatformEvent | null> {
      const rows = await db
        .select()
        .from(platformEvents)
        .where(eq(platformEvents.id, id))
        .limit(1)

      if (rows.length === 0) return null
      return rowToEvent(rows[0]!)
    },

    /**
     * Count events matching a filter
     */
    async count(filter?: PlatformEventFilter): Promise<number> {
      const conditions: ReturnType<typeof eq>[] = []

      if (filter) {
        // Build conditions (same as query)
        if (filter.category) {
          if (Array.isArray(filter.category)) {
            conditions.push(inArray(platformEvents.category, filter.category))
          } else {
            conditions.push(eq(platformEvents.category, filter.category))
          }
        }

        if (filter.type) {
          if (Array.isArray(filter.type)) {
            conditions.push(inArray(platformEvents.type, filter.type))
          } else {
            conditions.push(eq(platformEvents.type, filter.type))
          }
        }

        if (filter.timeRange) {
          if (filter.timeRange.from !== undefined) {
            conditions.push(gte(platformEvents.timestamp, filter.timeRange.from))
          }
          if (filter.timeRange.to !== undefined) {
            conditions.push(lte(platformEvents.timestamp, filter.timeRange.to))
          }
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(platformEvents)
        .where(whereClause)

      return result[0]?.count ?? 0
    },
  }
}

// =============================================================================
// AGGREGATION QUERY BUILDER
// =============================================================================

import type { AggregationGranularity, AggregationOp, PlatformEventAggregation } from '../../../types/platform-event'

/**
 * Build and execute an aggregation query
 */
async function buildAggregationQuery(
  db: SqliteRemoteDatabase<Record<string, unknown>>,
  whereClause: ReturnType<typeof and> | undefined,
  aggregation: PlatformEventAggregation,
  filter?: PlatformEventFilter
): Promise<AggregationPoint[]> {
  const { field, op, groupBy, granularity } = aggregation

  // Determine the aggregation expression
  let aggExpr: ReturnType<typeof sql>

  if (field === 'count' || op === 'count') {
    aggExpr = sql<number>`count(*)`
  } else {
    switch (op) {
      case 'sum':
        aggExpr = sql<number>`sum(${sql.raw(`"${field}"`)})`
        break
      case 'avg':
        aggExpr = sql<number>`avg(${sql.raw(`"${field}"`)})`
        break
      case 'min':
        aggExpr = sql<number>`min(${sql.raw(`"${field}"`)})`
        break
      case 'max':
        aggExpr = sql<number>`max(${sql.raw(`"${field}"`)})`
        break
      case 'unique':
        aggExpr = sql<number>`count(distinct ${sql.raw(`"${field}"`)})`
        break
      default:
        aggExpr = sql<number>`count(*)`
    }
  }

  // Build time bucket expression if granularity is specified
  let timeBucketExpr: ReturnType<typeof sql> | null = null
  if (granularity) {
    const bucketSize = getGranularityMs(granularity)
    timeBucketExpr = sql<number>`(timestamp / ${bucketSize}) * ${bucketSize}`
  }

  // Build the query
  if (timeBucketExpr) {
    // Time series aggregation
    const results = await db
      .select({
        timestamp: timeBucketExpr,
        value: aggExpr,
      })
      .from(platformEvents)
      .where(whereClause)
      .groupBy(timeBucketExpr)
      .orderBy(asc(timeBucketExpr))

    return results.map((r) => ({
      timestamp: r.timestamp as number,
      value: (r.value as number) ?? 0,
    }))
  } else if (groupBy && groupBy.length > 0) {
    // Group by aggregation
    const groupByExprs = groupBy.map((g) => sql.raw(`"${g}"`))

    const results = await db
      .select({
        value: aggExpr,
        ...Object.fromEntries(groupBy.map((g) => [g, sql.raw(`"${g}"`)])),
      })
      .from(platformEvents)
      .where(whereClause)
      .groupBy(...groupByExprs)

    return results.map((r) => {
      const groupKey: Record<string, string> = {}
      for (const g of groupBy) {
        groupKey[g] = String((r as Record<string, unknown>)[g] ?? '')
      }
      return {
        value: (r as { value: number }).value ?? 0,
        groupKey,
      }
    })
  } else {
    // Simple aggregation
    const results = await db
      .select({ value: aggExpr })
      .from(platformEvents)
      .where(whereClause)

    return [{ value: (results[0]?.value as number) ?? 0 }]
  }
}

/**
 * Get milliseconds for aggregation granularity
 */
function getGranularityMs(granularity: AggregationGranularity): number {
  switch (granularity) {
    case 'minute':
      return 60 * 1000
    case 'hour':
      return 60 * 60 * 1000
    case 'day':
      return 24 * 60 * 60 * 1000
    case 'week':
      return 7 * 24 * 60 * 60 * 1000
    case 'month':
      return 30 * 24 * 60 * 60 * 1000
    default:
      return 60 * 60 * 1000 // default to hour
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a track event input
 */
export function trackEvent(
  type: string,
  actor: string,
  data?: Record<string, unknown>,
  options?: Partial<Omit<PlatformEventInput & { category: 'track' }, 'category' | 'type' | 'actor' | 'data'>>
): PlatformEventInput {
  return {
    category: 'track',
    type,
    actor,
    data,
    ...options,
  }
}

/**
 * Create a meter event input
 */
export function meterEvent(
  type: string,
  customerId: string,
  value: number,
  options?: Partial<Omit<PlatformEventInput & { category: 'meter' }, 'category' | 'type' | 'customerId' | 'value'>>
): PlatformEventInput {
  return {
    category: 'meter',
    type,
    customerId,
    value,
    ...options,
  }
}

/**
 * Create a govern event input
 */
export function governEvent(
  type: string,
  actor: string,
  options?: Partial<Omit<PlatformEventInput & { category: 'govern' }, 'category' | 'type' | 'actor'>>
): PlatformEventInput {
  return {
    category: 'govern',
    type,
    actor,
    ...options,
  }
}

/**
 * Create an audit event input
 */
export function auditEvent(
  type: string,
  actor: string,
  object: string,
  objectType: string,
  options?: Partial<Omit<PlatformEventInput & { category: 'audit' }, 'category' | 'type' | 'actor' | 'object' | 'objectType'>>
): PlatformEventInput {
  return {
    category: 'audit',
    type,
    actor,
    object,
    objectType,
    ...options,
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  PlatformEvent,
  PlatformEventInput,
  PlatformEventFilter,
  PlatformEventQueryOptions,
  PlatformEventQueryResult,
  PlatformEventStore,
  AggregationPoint,
  EventCategory,
  AggregationGranularity,
  AggregationOp,
  PlatformEventAggregation,
} from '../../../types/platform-event'

export {
  createPlatformEvent,
  generateEventId,
  validatePlatformEvent,
  PLATFORM_EVENT_SCHEMA_VERSION,
} from '../../../types/platform-event'

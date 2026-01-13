/**
 * Platform Event Schema - Unified Foundation Event Model
 *
 * This module provides the unified event model that all platform pillars depend on:
 * - Observability: Analytics, funnels, retention tracking
 * - Governance: API keys, rate limiting, webhooks
 * - Monetization: Usage metering, entitlements, quotas
 *
 * The schema extends the EPCIS 5W+H paradigm for digital platform events,
 * adding specific fields for each pillar while maintaining a common base.
 *
 * @module types/platform-event
 */

import { z } from 'zod'

// =============================================================================
// EVENT CATEGORIES
// =============================================================================

/**
 * Event category determines which pillar processes the event
 */
export type EventCategory =
  | 'track'      // Observability: user/product analytics
  | 'meter'      // Monetization: usage metering for billing
  | 'govern'     // Governance: API access, rate limits
  | 'system'     // Internal platform events
  | 'audit'      // Compliance and audit trail

/**
 * Actor types for platform events
 */
export type PlatformActorType = 'human' | 'agent' | 'system' | 'webhook' | 'api_key'

/**
 * Channel types for event source
 */
export type PlatformChannelType =
  | 'web'
  | 'mobile'
  | 'api'
  | 'sdk'
  | 'webhook'
  | 'cron'
  | 'queue'
  | 'rpc'
  | string

// =============================================================================
// BASE PLATFORM EVENT
// =============================================================================

/**
 * PlatformEvent - The unified event model for all platform pillars
 *
 * Core fields follow EPCIS 5W+H:
 * - WHO: actor, actorType, orgId
 * - WHAT: type, object, data
 * - WHEN: timestamp, recordedAt
 * - WHERE: ns, location, doId
 * - WHY: reason, disposition
 * - HOW: channel, method, context
 */
export interface PlatformEvent {
  // ==========================================================================
  // IDENTITY
  // ==========================================================================
  /** Unique event ID (sqid-based) */
  id: string

  /** Event category for routing */
  category: EventCategory

  /** Event type/name (e.g., 'PageView', 'api.request', 'usage.tokens') */
  type: string

  // ==========================================================================
  // WHO - Actor identification
  // ==========================================================================
  /** Actor performing the action (user ID, agent ID, API key ID) */
  actor: string

  /** Type of actor */
  actorType: PlatformActorType

  /** Organization/tenant ID */
  orgId?: string

  /** Customer ID (for monetization) */
  customerId?: string

  // ==========================================================================
  // WHAT - Event subject
  // ==========================================================================
  /** Object/entity being acted upon */
  object?: string

  /** Object type (Noun name) */
  objectType?: string

  /** Event data payload */
  data: Record<string, unknown>

  // ==========================================================================
  // WHEN - Timestamps
  // ==========================================================================
  /** When the event occurred (epoch ms) */
  timestamp: number

  /** When the event was recorded (epoch ms) */
  recordedAt: number

  // ==========================================================================
  // WHERE - Location context
  // ==========================================================================
  /** Namespace URL */
  ns: string

  /** Durable Object ID that captured this event */
  doId?: string

  /** DO class name */
  doClass?: string

  /** Physical/logical location */
  location?: string

  /** Cloudflare colo (edge location code) */
  colo?: string

  // ==========================================================================
  // WHY - Business context
  // ==========================================================================
  /** Business reason for the event */
  reason?: string

  /** Current disposition/status */
  disposition?: string

  // ==========================================================================
  // HOW - Technical context
  // ==========================================================================
  /** Interaction channel */
  channel?: PlatformChannelType

  /** Execution method */
  method?: 'code' | 'generative' | 'agentic' | 'human'

  /** Additional context */
  context?: Record<string, unknown>

  // ==========================================================================
  // OBSERVABILITY EXTENSIONS
  // ==========================================================================
  /** Session ID for user journey tracking */
  sessionId?: string

  /** Device ID */
  deviceId?: string

  /** User agent string */
  userAgent?: string

  /** IP address (anonymized) */
  ip?: string

  /** Experiment ID (for A/B testing) */
  experimentId?: string

  /** Variant assignment */
  variant?: string

  // ==========================================================================
  // MONETIZATION EXTENSIONS
  // ==========================================================================
  /** Numeric value for metering (tokens, requests, bytes, etc.) */
  value?: number

  /** Unit of measurement */
  unit?: string

  /** Idempotency key for deduplication */
  idempotencyKey?: string

  /** Subscription ID */
  subscriptionId?: string

  /** Plan/tier identifier */
  planId?: string

  /** Feature identifier for entitlement checks */
  featureId?: string

  /** Dimension properties for billing aggregation */
  dimensions?: Record<string, string>

  // ==========================================================================
  // GOVERNANCE EXTENSIONS
  // ==========================================================================
  /** API key identifier (hashed) */
  apiKeyId?: string

  /** Rate limit bucket name */
  rateLimitBucket?: string

  /** Request path (for API events) */
  requestPath?: string

  /** HTTP method */
  httpMethod?: string

  /** Response status code */
  statusCode?: number

  /** Request/response duration in ms */
  duration?: number

  // ==========================================================================
  // LINKING
  // ==========================================================================
  /** Correlation ID for distributed tracing */
  correlationId?: string

  /** Parent event ID (for causation chains) */
  parentEventId?: string

  /** Trace ID (for OpenTelemetry) */
  traceId?: string

  /** Span ID */
  spanId?: string

  // ==========================================================================
  // METADATA
  // ==========================================================================
  /** Schema version for evolution */
  schemaVersion: number

  /** Custom extensions */
  extensions?: Record<string, unknown>
}

// =============================================================================
// INPUT TYPES (for event creation)
// =============================================================================

/**
 * Required fields for creating a track event (observability)
 */
export interface TrackEventInput {
  type: string
  actor: string
  data?: Record<string, unknown>
  // Optional overrides
  actorType?: PlatformActorType
  sessionId?: string
  deviceId?: string
  userAgent?: string
  ip?: string
  experimentId?: string
  variant?: string
  context?: Record<string, unknown>
}

/**
 * Required fields for creating a meter event (monetization)
 */
export interface MeterEventInput {
  type: string
  customerId: string
  value: number
  // Optional
  unit?: string
  actor?: string
  dimensions?: Record<string, string>
  featureId?: string
  subscriptionId?: string
  planId?: string
  idempotencyKey?: string
  context?: Record<string, unknown>
}

/**
 * Required fields for creating a govern event (governance)
 */
export interface GovernEventInput {
  type: string
  actor: string
  apiKeyId?: string
  requestPath?: string
  httpMethod?: string
  statusCode?: number
  duration?: number
  rateLimitBucket?: string
  context?: Record<string, unknown>
}

/**
 * Required fields for creating an audit event
 */
export interface AuditEventInput {
  type: string
  actor: string
  object: string
  objectType: string
  reason?: string
  data?: Record<string, unknown>
  context?: Record<string, unknown>
}

/**
 * Union of all event input types
 */
export type PlatformEventInput =
  | ({ category: 'track' } & TrackEventInput)
  | ({ category: 'meter' } & MeterEventInput)
  | ({ category: 'govern' } & GovernEventInput)
  | ({ category: 'audit' } & AuditEventInput)
  | ({ category: 'system' } & Partial<PlatformEvent>)

// =============================================================================
// ZOD SCHEMAS FOR VALIDATION
// =============================================================================

export const EventCategorySchema = z.enum(['track', 'meter', 'govern', 'system', 'audit'])

export const PlatformActorTypeSchema = z.enum(['human', 'agent', 'system', 'webhook', 'api_key'])

export const PlatformEventSchema = z.object({
  id: z.string().min(1),
  category: EventCategorySchema,
  type: z.string().min(1),

  // WHO
  actor: z.string().min(1),
  actorType: PlatformActorTypeSchema,
  orgId: z.string().optional(),
  customerId: z.string().optional(),

  // WHAT
  object: z.string().optional(),
  objectType: z.string().optional(),
  data: z.record(z.string(), z.unknown()),

  // WHEN
  timestamp: z.number().int().positive(),
  recordedAt: z.number().int().positive(),

  // WHERE
  ns: z.string().url(),
  doId: z.string().optional(),
  doClass: z.string().optional(),
  location: z.string().optional(),
  colo: z.string().optional(),

  // WHY
  reason: z.string().optional(),
  disposition: z.string().optional(),

  // HOW
  channel: z.string().optional(),
  method: z.enum(['code', 'generative', 'agentic', 'human']).optional(),
  context: z.record(z.string(), z.unknown()).optional(),

  // Observability
  sessionId: z.string().optional(),
  deviceId: z.string().optional(),
  userAgent: z.string().optional(),
  ip: z.string().optional(),
  experimentId: z.string().optional(),
  variant: z.string().optional(),

  // Monetization
  value: z.number().optional(),
  unit: z.string().optional(),
  idempotencyKey: z.string().optional(),
  subscriptionId: z.string().optional(),
  planId: z.string().optional(),
  featureId: z.string().optional(),
  dimensions: z.record(z.string(), z.string()).optional(),

  // Governance
  apiKeyId: z.string().optional(),
  rateLimitBucket: z.string().optional(),
  requestPath: z.string().optional(),
  httpMethod: z.string().optional(),
  statusCode: z.number().int().optional(),
  duration: z.number().nonnegative().optional(),

  // Linking
  correlationId: z.string().optional(),
  parentEventId: z.string().optional(),
  traceId: z.string().optional(),
  spanId: z.string().optional(),

  // Metadata
  schemaVersion: z.number().int().positive(),
  extensions: z.record(z.string(), z.unknown()).optional(),
})

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

export interface PlatformEventValidationError {
  field: string
  message: string
}

export interface PlatformEventValidationResult {
  success: boolean
  errors: PlatformEventValidationError[]
  event?: PlatformEvent
}

/**
 * Validate a platform event
 */
export function validatePlatformEvent(data: unknown): PlatformEventValidationResult {
  const result = PlatformEventSchema.safeParse(data)

  if (result.success) {
    return {
      success: true,
      errors: [],
      event: result.data as PlatformEvent,
    }
  }

  const errors = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }))

  return {
    success: false,
    errors,
  }
}

// =============================================================================
// EVENT FACTORY
// =============================================================================

let eventIdCounter = 0

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  const timestamp = Date.now().toString(36)
  const counter = (++eventIdCounter).toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `evt_${timestamp}_${counter}_${random}`
}

/**
 * Current schema version
 */
export const PLATFORM_EVENT_SCHEMA_VERSION = 1

/**
 * Create a platform event from input
 */
export function createPlatformEvent(
  input: PlatformEventInput,
  context: {
    ns: string
    doId?: string
    doClass?: string
    colo?: string
    orgId?: string
  }
): PlatformEvent {
  const now = Date.now()

  const baseEvent: PlatformEvent = {
    id: generateEventId(),
    category: input.category,
    type: input.type || 'unknown',
    actor: '',
    actorType: 'system',
    data: {},
    timestamp: now,
    recordedAt: now,
    ns: context.ns,
    doId: context.doId,
    doClass: context.doClass,
    colo: context.colo,
    orgId: context.orgId,
    schemaVersion: PLATFORM_EVENT_SCHEMA_VERSION,
  }

  // Merge category-specific fields
  switch (input.category) {
    case 'track': {
      const trackInput = input as { category: 'track' } & TrackEventInput
      return {
        ...baseEvent,
        actor: trackInput.actor,
        actorType: trackInput.actorType || 'human',
        data: trackInput.data || {},
        sessionId: trackInput.sessionId,
        deviceId: trackInput.deviceId,
        userAgent: trackInput.userAgent,
        ip: trackInput.ip,
        experimentId: trackInput.experimentId,
        variant: trackInput.variant,
        context: trackInput.context,
      }
    }

    case 'meter': {
      const meterInput = input as { category: 'meter' } & MeterEventInput
      return {
        ...baseEvent,
        actor: meterInput.actor || 'system',
        actorType: 'system',
        customerId: meterInput.customerId,
        value: meterInput.value,
        unit: meterInput.unit,
        dimensions: meterInput.dimensions,
        featureId: meterInput.featureId,
        subscriptionId: meterInput.subscriptionId,
        planId: meterInput.planId,
        idempotencyKey: meterInput.idempotencyKey || generateEventId(),
        data: {},
        context: meterInput.context,
      }
    }

    case 'govern': {
      const governInput = input as { category: 'govern' } & GovernEventInput
      return {
        ...baseEvent,
        actor: governInput.actor,
        actorType: governInput.apiKeyId ? 'api_key' : 'human',
        apiKeyId: governInput.apiKeyId,
        requestPath: governInput.requestPath,
        httpMethod: governInput.httpMethod,
        statusCode: governInput.statusCode,
        duration: governInput.duration,
        rateLimitBucket: governInput.rateLimitBucket,
        data: {},
        context: governInput.context,
      }
    }

    case 'audit': {
      const auditInput = input as { category: 'audit' } & AuditEventInput
      return {
        ...baseEvent,
        actor: auditInput.actor,
        actorType: 'human',
        object: auditInput.object,
        objectType: auditInput.objectType,
        reason: auditInput.reason,
        data: auditInput.data || {},
        context: auditInput.context,
      }
    }

    case 'system': {
      const systemInput = input as { category: 'system' } & Partial<PlatformEvent>
      return {
        ...baseEvent,
        ...systemInput,
        category: 'system',
      }
    }

    default:
      return baseEvent
  }
}

// =============================================================================
// QUERY TYPES
// =============================================================================

/**
 * Time range filter
 */
export interface TimeRange {
  from?: number
  to?: number
}

/**
 * Platform event query filter
 */
export interface PlatformEventFilter {
  // Category/Type
  category?: EventCategory | EventCategory[]
  type?: string | string[]

  // WHO
  actor?: string | string[]
  actorType?: PlatformActorType | PlatformActorType[]
  orgId?: string
  customerId?: string

  // WHAT
  object?: string
  objectType?: string

  // WHEN
  timeRange?: TimeRange

  // WHERE
  doId?: string
  doClass?: string

  // Observability
  sessionId?: string
  experimentId?: string
  variant?: string

  // Monetization
  featureId?: string
  planId?: string

  // Governance
  apiKeyId?: string
  statusCode?: number | { gte?: number; lte?: number }

  // Linking
  correlationId?: string
  parentEventId?: string
}

/**
 * Aggregation granularity
 */
export type AggregationGranularity = 'minute' | 'hour' | 'day' | 'week' | 'month'

/**
 * Aggregation operation
 */
export type AggregationOp = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'unique'

/**
 * Aggregation query
 */
export interface PlatformEventAggregation {
  /** Field to aggregate (or 'count' for event count) */
  field: string | 'count'

  /** Aggregation operation */
  op: AggregationOp

  /** Group by fields */
  groupBy?: string[]

  /** Time series granularity */
  granularity?: AggregationGranularity
}

/**
 * Query options
 */
export interface PlatformEventQueryOptions {
  filter?: PlatformEventFilter
  aggregation?: PlatformEventAggregation
  limit?: number
  offset?: number
  orderBy?: 'timestamp' | 'recordedAt'
  orderDirection?: 'asc' | 'desc'
}

/**
 * Aggregation result point
 */
export interface AggregationPoint {
  timestamp?: number
  value: number
  groupKey?: Record<string, string>
}

/**
 * Query result
 */
export interface PlatformEventQueryResult {
  events?: PlatformEvent[]
  aggregation?: AggregationPoint[]
  total: number
}

// =============================================================================
// STORE INTERFACE
// =============================================================================

/**
 * Platform event store interface
 *
 * This is implemented by DOBase to provide event storage and querying.
 */
export interface PlatformEventStore {
  /**
   * Emit an event to the store
   */
  emit(input: PlatformEventInput): Promise<string>

  /**
   * Emit multiple events in a batch
   */
  emitBatch(inputs: PlatformEventInput[]): Promise<string[]>

  /**
   * Query events with filtering and aggregation
   */
  query(options: PlatformEventQueryOptions): Promise<PlatformEventQueryResult>

  /**
   * Get a single event by ID
   */
  get(id: string): Promise<PlatformEvent | null>

  /**
   * Count events matching a filter
   */
  count(filter?: PlatformEventFilter): Promise<number>
}

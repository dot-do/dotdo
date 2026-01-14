/**
 * Platform Events - SQLite Table Schema
 *
 * Provides the database schema for storing unified platform events.
 * This table is used by all three pillars:
 * - Observability: Analytics, funnels, retention
 * - Monetization: Usage metering, quota tracking
 * - Governance: API key usage, rate limit events
 *
 * @module db/platform-events
 */

import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

// =============================================================================
// PLATFORM EVENTS TABLE
// =============================================================================

/**
 * Platform events table - stores all unified platform events
 *
 * Indexing strategy:
 * - Primary key: id (for point lookups)
 * - category + timestamp: for category-specific queries
 * - type + timestamp: for event type analysis
 * - actor + timestamp: for user journey tracking
 * - orgId + customerId + timestamp: for multi-tenant/customer queries
 * - sessionId: for session analysis
 * - correlationId: for distributed tracing
 */
export const platformEvents = sqliteTable(
  'platform_events',
  {
    // Identity
    id: text('id').primaryKey(),
    category: text('category').notNull(), // 'track' | 'meter' | 'govern' | 'system' | 'audit'
    type: text('type').notNull(),

    // WHO
    actor: text('actor').notNull(),
    actorType: text('actor_type').notNull(), // 'human' | 'agent' | 'system' | 'webhook' | 'api_key'
    orgId: text('org_id'),
    customerId: text('customer_id'),

    // WHAT
    object: text('object'),
    objectType: text('object_type'),
    data: text('data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),

    // WHEN
    timestamp: integer('timestamp', { mode: 'number' }).notNull(), // epoch ms
    recordedAt: integer('recorded_at', { mode: 'number' }).notNull(),

    // WHERE
    ns: text('ns').notNull(),
    doId: text('do_id'),
    doClass: text('do_class'),
    location: text('location'),
    colo: text('colo'),

    // WHY
    reason: text('reason'),
    disposition: text('disposition'),

    // HOW
    channel: text('channel'),
    method: text('method'),
    context: text('context', { mode: 'json' }).$type<Record<string, unknown>>(),

    // Observability extensions
    sessionId: text('session_id'),
    deviceId: text('device_id'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    experimentId: text('experiment_id'),
    variant: text('variant'),

    // Monetization extensions
    value: real('value'),
    unit: text('unit'),
    idempotencyKey: text('idempotency_key'),
    subscriptionId: text('subscription_id'),
    planId: text('plan_id'),
    featureId: text('feature_id'),
    dimensions: text('dimensions', { mode: 'json' }).$type<Record<string, string>>(),

    // Governance extensions
    apiKeyId: text('api_key_id'),
    rateLimitBucket: text('rate_limit_bucket'),
    requestPath: text('request_path'),
    httpMethod: text('http_method'),
    statusCode: integer('status_code'),
    duration: real('duration'),

    // Linking
    correlationId: text('correlation_id'),
    parentEventId: text('parent_event_id'),
    traceId: text('trace_id'),
    spanId: text('span_id'),

    // Metadata
    schemaVersion: integer('schema_version').notNull().default(1),
    extensions: text('extensions', { mode: 'json' }).$type<Record<string, unknown>>(),

    // Streaming status
    streamed: integer('streamed', { mode: 'boolean' }).default(false),
    streamedAt: integer('streamed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    // Core indexes
    categoryTimestampIdx: index('pe_category_timestamp_idx').on(table.category, table.timestamp),
    typeTimestampIdx: index('pe_type_timestamp_idx').on(table.type, table.timestamp),
    actorTimestampIdx: index('pe_actor_timestamp_idx').on(table.actor, table.timestamp),

    // Multi-tenant indexes
    orgIdTimestampIdx: index('pe_org_id_timestamp_idx').on(table.orgId, table.timestamp),
    customerIdTimestampIdx: index('pe_customer_id_timestamp_idx').on(table.customerId, table.timestamp),

    // Observability indexes
    sessionIdIdx: index('pe_session_id_idx').on(table.sessionId),
    experimentIdVariantIdx: index('pe_experiment_variant_idx').on(table.experimentId, table.variant),

    // Monetization indexes
    idempotencyKeyIdx: index('pe_idempotency_key_idx').on(table.idempotencyKey),
    featureIdTimestampIdx: index('pe_feature_id_timestamp_idx').on(table.featureId, table.timestamp),
    customerFeatureIdx: index('pe_customer_feature_idx').on(table.customerId, table.featureId, table.timestamp),

    // Governance indexes
    apiKeyIdTimestampIdx: index('pe_api_key_id_timestamp_idx').on(table.apiKeyId, table.timestamp),
    rateLimitBucketIdx: index('pe_rate_limit_bucket_idx').on(table.rateLimitBucket, table.timestamp),

    // Linking indexes
    correlationIdIdx: index('pe_correlation_id_idx').on(table.correlationId),
    parentEventIdIdx: index('pe_parent_event_id_idx').on(table.parentEventId),
    traceIdIdx: index('pe_trace_id_idx').on(table.traceId),

    // Streaming index
    streamedIdx: index('pe_streamed_idx').on(table.streamed),
  })
)

// =============================================================================
// AGGREGATION TABLES (for pre-computed metrics)
// =============================================================================

/**
 * Hourly event aggregations - pre-computed for fast queries
 */
export const eventAggregationsHourly = sqliteTable(
  'event_aggregations_hourly',
  {
    id: text('id').primaryKey(),

    // Time bucket
    hourTimestamp: integer('hour_timestamp', { mode: 'number' }).notNull(), // epoch ms, start of hour

    // Dimensions
    category: text('category').notNull(),
    type: text('type').notNull(),
    orgId: text('org_id'),
    customerId: text('customer_id'),
    featureId: text('feature_id'),
    apiKeyId: text('api_key_id'),
    variant: text('variant'),

    // Aggregations
    count: integer('count').notNull().default(0),
    sum: real('sum'),
    min: real('min'),
    max: real('max'),
    uniqueActors: integer('unique_actors'),
    uniqueSessions: integer('unique_sessions'),

    // Metadata
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    hourCategoryTypeIdx: index('eah_hour_category_type_idx').on(
      table.hourTimestamp,
      table.category,
      table.type
    ),
    hourCustomerIdx: index('eah_hour_customer_idx').on(
      table.hourTimestamp,
      table.customerId,
      table.featureId
    ),
    hourOrgIdx: index('eah_hour_org_idx').on(table.hourTimestamp, table.orgId),
    hourApiKeyIdx: index('eah_hour_api_key_idx').on(table.hourTimestamp, table.apiKeyId),
  })
)

/**
 * Daily event aggregations - for longer-term analytics
 */
export const eventAggregationsDaily = sqliteTable(
  'event_aggregations_daily',
  {
    id: text('id').primaryKey(),

    // Time bucket
    dayTimestamp: integer('day_timestamp', { mode: 'number' }).notNull(), // epoch ms, start of day (UTC)

    // Dimensions
    category: text('category').notNull(),
    type: text('type').notNull(),
    orgId: text('org_id'),
    customerId: text('customer_id'),
    featureId: text('feature_id'),
    apiKeyId: text('api_key_id'),
    variant: text('variant'),
    planId: text('plan_id'),

    // Aggregations
    count: integer('count').notNull().default(0),
    sum: real('sum'),
    min: real('min'),
    max: real('max'),
    avg: real('avg'),
    uniqueActors: integer('unique_actors'),
    uniqueSessions: integer('unique_sessions'),

    // Retention metrics
    activeUsers: integer('active_users'),
    newUsers: integer('new_users'),
    returningUsers: integer('returning_users'),

    // Metadata
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    dayCategoryTypeIdx: index('ead_day_category_type_idx').on(
      table.dayTimestamp,
      table.category,
      table.type
    ),
    dayCustomerIdx: index('ead_day_customer_idx').on(
      table.dayTimestamp,
      table.customerId,
      table.featureId
    ),
    dayOrgIdx: index('ead_day_org_idx').on(table.dayTimestamp, table.orgId),
    dayPlanIdx: index('ead_day_plan_idx').on(table.dayTimestamp, table.planId),
  })
)

// =============================================================================
// FUNNEL STATE TABLE
// =============================================================================

/**
 * Funnel progress tracking - stores user progress through defined funnels
 */
export const funnelProgress = sqliteTable(
  'funnel_progress',
  {
    id: text('id').primaryKey(),

    // Funnel identification
    funnelId: text('funnel_id').notNull(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id'),
    orgId: text('org_id'),

    // Progress
    currentStep: integer('current_step').notNull().default(0),
    completedSteps: text('completed_steps', { mode: 'json' }).notNull().$type<number[]>(),
    stepTimestamps: text('step_timestamps', { mode: 'json' }).notNull().$type<number[]>(),

    // Status
    status: text('status').notNull().default('in_progress'), // 'in_progress' | 'completed' | 'dropped'
    startedAt: integer('started_at', { mode: 'number' }).notNull(),
    completedAt: integer('completed_at', { mode: 'number' }),
    droppedAt: integer('dropped_at', { mode: 'number' }),

    // Experiment tracking
    experimentId: text('experiment_id'),
    variant: text('variant'),

    // Metadata
    context: text('context', { mode: 'json' }).$type<Record<string, unknown>>(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    funnelUserIdx: index('fp_funnel_user_idx').on(table.funnelId, table.userId),
    funnelStatusIdx: index('fp_funnel_status_idx').on(table.funnelId, table.status),
    funnelExperimentIdx: index('fp_funnel_experiment_idx').on(
      table.funnelId,
      table.experimentId,
      table.variant
    ),
    funnelStartedIdx: index('fp_funnel_started_idx').on(table.funnelId, table.startedAt),
  })
)

// =============================================================================
// COHORT TABLE
// =============================================================================

/**
 * User cohorts for retention analysis
 */
export const userCohorts = sqliteTable(
  'user_cohorts',
  {
    id: text('id').primaryKey(),

    // User identification
    userId: text('user_id').notNull(),
    orgId: text('org_id'),

    // Cohort assignment
    cohortId: text('cohort_id').notNull(), // e.g., 'signup_2024_01', 'plan_pro'
    cohortType: text('cohort_type').notNull(), // 'time_based' | 'behavior_based' | 'attribute_based'
    cohortDate: integer('cohort_date', { mode: 'number' }).notNull(), // epoch ms

    // First activity
    firstEventType: text('first_event_type').notNull(),
    firstEventAt: integer('first_event_at', { mode: 'number' }).notNull(),

    // Activity tracking
    lastActiveAt: integer('last_active_at', { mode: 'number' }),
    totalEvents: integer('total_events').notNull().default(0),
    activeDays: integer('active_days').notNull().default(0),

    // Retention periods (days since cohort date with activity)
    retentionDays: text('retention_days', { mode: 'json' }).$type<number[]>(),

    // Metadata
    attributes: text('attributes', { mode: 'json' }).$type<Record<string, unknown>>(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    cohortUserIdx: index('uc_cohort_user_idx').on(table.cohortId, table.userId),
    cohortDateIdx: index('uc_cohort_date_idx').on(table.cohortId, table.cohortDate),
    cohortTypeIdx: index('uc_cohort_type_idx').on(table.cohortType, table.cohortDate),
    userOrgIdx: index('uc_user_org_idx').on(table.userId, table.orgId),
  })
)

// =============================================================================
// USAGE QUOTA TABLE (for monetization)
// =============================================================================

/**
 * Usage quotas for quota enforcement
 */
export const usageQuotas = sqliteTable(
  'usage_quotas',
  {
    id: text('id').primaryKey(),

    // Identification
    customerId: text('customer_id').notNull(),
    featureId: text('feature_id').notNull(),
    planId: text('plan_id'),
    orgId: text('org_id'),

    // Quota configuration
    limitValue: real('limit_value').notNull(),
    limitUnit: text('limit_unit').notNull(), // 'requests' | 'tokens' | 'bytes' | etc.
    periodType: text('period_type').notNull(), // 'hour' | 'day' | 'month' | 'billing_period'
    periodStart: integer('period_start', { mode: 'number' }).notNull(),
    periodEnd: integer('period_end', { mode: 'number' }).notNull(),

    // Current usage
    currentUsage: real('current_usage').notNull().default(0),
    lastUpdated: integer('last_updated', { mode: 'number' }).notNull(),

    // Overage handling
    allowOverage: integer('allow_overage', { mode: 'boolean' }).default(false),
    overageUsage: real('overage_usage').default(0),
    overageRate: real('overage_rate'), // price per unit over limit

    // Status
    status: text('status').notNull().default('active'), // 'active' | 'exceeded' | 'blocked'
    exceededAt: integer('exceeded_at', { mode: 'number' }),

    // Metadata
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (table) => ({
    customerFeatureIdx: index('uq_customer_feature_idx').on(table.customerId, table.featureId),
    customerPeriodIdx: index('uq_customer_period_idx').on(
      table.customerId,
      table.periodStart,
      table.periodEnd
    ),
    statusIdx: index('uq_status_idx').on(table.status),
  })
)

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PlatformEventRow = typeof platformEvents.$inferSelect
export type PlatformEventInsert = typeof platformEvents.$inferInsert

export type EventAggregationHourlyRow = typeof eventAggregationsHourly.$inferSelect
export type EventAggregationHourlyInsert = typeof eventAggregationsHourly.$inferInsert

export type EventAggregationDailyRow = typeof eventAggregationsDaily.$inferSelect
export type EventAggregationDailyInsert = typeof eventAggregationsDaily.$inferInsert

export type FunnelProgressRow = typeof funnelProgress.$inferSelect
export type FunnelProgressInsert = typeof funnelProgress.$inferInsert

export type UserCohortRow = typeof userCohorts.$inferSelect
export type UserCohortInsert = typeof userCohorts.$inferInsert

export type UsageQuotaRow = typeof usageQuotas.$inferSelect
export type UsageQuotaInsert = typeof usageQuotas.$inferInsert

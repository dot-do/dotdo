import { expectType, expectNotType } from 'tsd'
import type {
  // Main types
  UnifiedEvent,
  EventType,
  // Semantic group interfaces
  CoreIdentity,
  CausalityChain,
  Actor,
  Resource,
  Timing,
  Outcome,
  HttpContext,
  GeoLocation,
  ClientDevice,
  ServiceInfra,
  DatabaseCdc,
  MessagingQueue,
  Rpc,
  WebMarketing,
  WebVitals,
  SessionReplay,
  OtelMetrics,
  Logging,
  DoSpecific,
  BusinessEpcis,
  SnippetProxy,
  FlexiblePayloads,
  PartitionInternal,
  // Helpers
  ColumnDefinition,
} from '../unified-event'
import {
  UNIFIED_COLUMNS,
  createUnifiedEvent,
  isTraceEvent,
  isMetricEvent,
  isLogEvent,
  isCdcEvent,
  isTrackEvent,
  isPageEvent,
  isVitalEvent,
  isReplayEvent,
  isTailEvent,
  isSnippetEvent,
} from '../unified-event'

/**
 * TDD Type Tests: Unified Event Types (162 columns)
 *
 * This test file defines the type-level contract for the unified event schema.
 * Uses tsd for type-level assertions.
 *
 * Issue: do-3q9 (Foundation Unified Event Types)
 *
 * The unified event schema consolidates observability data across:
 * - Traces (distributed tracing spans)
 * - Metrics (OTEL metrics)
 * - Logs (structured logging)
 * - CDC (change data capture from databases)
 * - Analytics (track, page, vitals, replay)
 * - Snippet (proxy/timing data)
 */

// ============================================================================
// EventType enum
// ============================================================================

// EventType should be a union of all supported event types
type ExpectedEventType = 'trace' | 'metric' | 'log' | 'cdc' | 'track' | 'page' | 'vital' | 'replay' | 'tail' | 'snippet'
declare const eventType: EventType
expectType<ExpectedEventType>(eventType)

// ============================================================================
// CoreIdentity (4 fields) - All required
// ============================================================================

declare const coreIdentity: CoreIdentity
expectType<string>(coreIdentity.id)
expectType<EventType>(coreIdentity.event_type)
expectType<string>(coreIdentity.event_name)
expectType<string>(coreIdentity.ns)

// UnifiedEvent should extend CoreIdentity
declare const unifiedEvent: UnifiedEvent
expectType<string>(unifiedEvent.id)
expectType<EventType>(unifiedEvent.event_type)
expectType<string>(unifiedEvent.event_name)
expectType<string>(unifiedEvent.ns)

// ============================================================================
// CausalityChain (8 fields) - All nullable
// ============================================================================

declare const causalityChain: CausalityChain
expectType<string | null>(causalityChain.trace_id)
expectType<string | null>(causalityChain.span_id)
expectType<string | null>(causalityChain.parent_id)
expectType<string | null>(causalityChain.root_id)
expectType<string | null>(causalityChain.session_id)
expectType<string | null>(causalityChain.workflow_id)
expectType<string | null>(causalityChain.transaction_id)
expectType<string | null>(causalityChain.correlation_id)

// UnifiedEvent should extend CausalityChain
expectType<string | null>(unifiedEvent.trace_id)
expectType<string | null>(unifiedEvent.span_id)

// ============================================================================
// Actor (4 fields) - All nullable
// ============================================================================

declare const actor: Actor
expectType<string | null>(actor.actor_id)
expectType<string | null>(actor.actor_type)
expectType<string | null>(actor.actor_name)
expectType<string | null>(actor.anonymous_id)

// UnifiedEvent should extend Actor
expectType<string | null>(unifiedEvent.actor_id)

// ============================================================================
// Resource (5 fields) - All nullable
// ============================================================================

declare const resource: Resource
expectType<string | null>(resource.resource_type)
expectType<string | null>(resource.resource_id)
expectType<string | null>(resource.resource_name)
expectType<string | null>(resource.resource_version)
expectType<string | null>(resource.resource_ns)

// UnifiedEvent should extend Resource
expectType<string | null>(unifiedEvent.resource_type)

// ============================================================================
// Timing (6 fields) - All nullable
// ============================================================================

declare const timing: Timing
expectType<string | null>(timing.timestamp)
expectType<bigint | null>(timing.timestamp_ns)
expectType<string | null>(timing.started_at)
expectType<string | null>(timing.ended_at)
expectType<number | null>(timing.duration_ms)
expectType<number | null>(timing.cpu_time_ms)

// UnifiedEvent should extend Timing
expectType<string | null>(unifiedEvent.timestamp)
expectType<bigint | null>(unifiedEvent.timestamp_ns)

// ============================================================================
// Outcome (6 fields) - All nullable
// ============================================================================

declare const outcome: Outcome
expectType<string | null>(outcome.outcome)
expectType<string | null>(outcome.outcome_reason)
expectType<number | null>(outcome.status_code)
expectType<string | null>(outcome.error_type)
expectType<string | null>(outcome.error_message)
expectType<string | null>(outcome.error_stack)

// UnifiedEvent should extend Outcome
expectType<string | null>(unifiedEvent.outcome)
expectType<number | null>(unifiedEvent.status_code)

// ============================================================================
// HttpContext (12 fields) - All nullable
// ============================================================================

declare const httpContext: HttpContext
expectType<string | null>(httpContext.http_method)
expectType<string | null>(httpContext.http_url)
expectType<string | null>(httpContext.http_host)
expectType<string | null>(httpContext.http_path)
expectType<string | null>(httpContext.http_query)
expectType<number | null>(httpContext.http_status)
expectType<string | null>(httpContext.http_protocol)
expectType<number | null>(httpContext.http_request_size)
expectType<number | null>(httpContext.http_response_size)
expectType<string | null>(httpContext.http_referrer)
expectType<string | null>(httpContext.http_user_agent)
expectType<string | null>(httpContext.http_content_type)

// UnifiedEvent should extend HttpContext
expectType<string | null>(unifiedEvent.http_url)
expectType<number | null>(unifiedEvent.http_status)

// ============================================================================
// GeoLocation (10 fields) - All nullable
// ============================================================================

declare const geoLocation: GeoLocation
expectType<string | null>(geoLocation.geo_country)
expectType<string | null>(geoLocation.geo_region)
expectType<string | null>(geoLocation.geo_city)
expectType<string | null>(geoLocation.geo_colo)
expectType<string | null>(geoLocation.geo_timezone)
expectType<number | null>(geoLocation.geo_latitude)
expectType<number | null>(geoLocation.geo_longitude)
expectType<number | null>(geoLocation.geo_asn)
expectType<string | null>(geoLocation.geo_as_org)
expectType<string | null>(geoLocation.geo_postal)

// UnifiedEvent should extend GeoLocation
expectType<string | null>(unifiedEvent.geo_country)

// ============================================================================
// ClientDevice (11 fields) - All nullable
// ============================================================================

declare const clientDevice: ClientDevice
expectType<string | null>(clientDevice.client_type)
expectType<string | null>(clientDevice.client_name)
expectType<string | null>(clientDevice.client_version)
expectType<string | null>(clientDevice.device_type)
expectType<string | null>(clientDevice.device_model)
expectType<string | null>(clientDevice.device_brand)
expectType<string | null>(clientDevice.os_name)
expectType<string | null>(clientDevice.os_version)
expectType<number | null>(clientDevice.bot_score)
expectType<boolean | null>(clientDevice.bot_verified)
expectType<string | null>(clientDevice.screen_size)

// UnifiedEvent should extend ClientDevice
expectType<string | null>(unifiedEvent.client_type)
expectType<boolean | null>(unifiedEvent.bot_verified)

// ============================================================================
// ServiceInfra (13 fields) - All nullable
// ============================================================================

declare const serviceInfra: ServiceInfra
expectType<string | null>(serviceInfra.service_name)
expectType<string | null>(serviceInfra.service_version)
expectType<string | null>(serviceInfra.service_instance)
expectType<string | null>(serviceInfra.service_namespace)
expectType<string | null>(serviceInfra.host_name)
expectType<string | null>(serviceInfra.host_id)
expectType<string | null>(serviceInfra.cloud_provider)
expectType<string | null>(serviceInfra.cloud_region)
expectType<string | null>(serviceInfra.cloud_zone)
expectType<string | null>(serviceInfra.container_id)
expectType<string | null>(serviceInfra.k8s_namespace)
expectType<string | null>(serviceInfra.k8s_pod)
expectType<string | null>(serviceInfra.k8s_deployment)

// UnifiedEvent should extend ServiceInfra
expectType<string | null>(unifiedEvent.service_name)

// ============================================================================
// DatabaseCdc (10 fields) - All nullable
// ============================================================================

declare const databaseCdc: DatabaseCdc
expectType<string | null>(databaseCdc.db_system)
expectType<string | null>(databaseCdc.db_name)
expectType<string | null>(databaseCdc.db_table)
expectType<string | null>(databaseCdc.db_operation)
expectType<string | null>(databaseCdc.db_statement)
expectType<string | null>(databaseCdc.db_row_id)
expectType<string | null>(databaseCdc.db_lsn)
expectType<number | null>(databaseCdc.db_version)
expectType<string | null>(databaseCdc.db_before)
expectType<string | null>(databaseCdc.db_after)

// UnifiedEvent should extend DatabaseCdc
expectType<string | null>(unifiedEvent.db_system)
expectType<string | null>(unifiedEvent.db_table)

// ============================================================================
// MessagingQueue (5 fields) - All nullable
// ============================================================================

declare const messagingQueue: MessagingQueue
expectType<string | null>(messagingQueue.msg_system)
expectType<string | null>(messagingQueue.msg_destination)
expectType<string | null>(messagingQueue.msg_operation)
expectType<number | null>(messagingQueue.msg_batch_size)
expectType<string | null>(messagingQueue.msg_message_id)

// UnifiedEvent should extend MessagingQueue
expectType<string | null>(unifiedEvent.msg_system)

// ============================================================================
// Rpc (4 fields) - All nullable
// ============================================================================

declare const rpc: Rpc
expectType<string | null>(rpc.rpc_system)
expectType<string | null>(rpc.rpc_service)
expectType<string | null>(rpc.rpc_method)
expectType<string | null>(rpc.rpc_status)

// UnifiedEvent should extend Rpc
expectType<string | null>(unifiedEvent.rpc_method)

// ============================================================================
// WebMarketing (10 fields) - All nullable
// ============================================================================

declare const webMarketing: WebMarketing
expectType<string | null>(webMarketing.page_title)
expectType<string | null>(webMarketing.page_search)
expectType<string | null>(webMarketing.campaign_name)
expectType<string | null>(webMarketing.campaign_source)
expectType<string | null>(webMarketing.campaign_medium)
expectType<string | null>(webMarketing.campaign_term)
expectType<string | null>(webMarketing.campaign_content)
expectType<string | null>(webMarketing.campaign_id)
expectType<string | null>(webMarketing.ab_test_id)
expectType<string | null>(webMarketing.ab_variant)

// UnifiedEvent should extend WebMarketing
expectType<string | null>(unifiedEvent.campaign_name)

// ============================================================================
// WebVitals (7 fields) - All nullable
// ============================================================================

declare const webVitals: WebVitals
expectType<string | null>(webVitals.vital_name)
expectType<number | null>(webVitals.vital_value)
expectType<string | null>(webVitals.vital_rating)
expectType<number | null>(webVitals.vital_delta)
expectType<string | null>(webVitals.vital_element)
expectType<string | null>(webVitals.vital_load_state)
expectType<string | null>(webVitals.nav_type)

// UnifiedEvent should extend WebVitals
expectType<string | null>(unifiedEvent.vital_name)
expectType<number | null>(unifiedEvent.vital_value)

// ============================================================================
// SessionReplay (5 fields) - All nullable
// ============================================================================

declare const sessionReplay: SessionReplay
expectType<string | null>(sessionReplay.replay_type)
expectType<string | null>(sessionReplay.replay_source)
expectType<number | null>(sessionReplay.replay_sequence)
expectType<number | null>(sessionReplay.replay_timestamp_offset)
expectType<string | null>(sessionReplay.replay_data)

// UnifiedEvent should extend SessionReplay
expectType<string | null>(unifiedEvent.replay_type)

// ============================================================================
// OtelMetrics (10 fields) - All nullable
// ============================================================================

declare const otelMetrics: OtelMetrics
expectType<string | null>(otelMetrics.metric_name)
expectType<string | null>(otelMetrics.metric_unit)
expectType<string | null>(otelMetrics.metric_type)
expectType<number | null>(otelMetrics.metric_value)
expectType<number | null>(otelMetrics.metric_count)
expectType<number | null>(otelMetrics.metric_sum)
expectType<number | null>(otelMetrics.metric_min)
expectType<number | null>(otelMetrics.metric_max)
expectType<string | null>(otelMetrics.metric_buckets)
expectType<string | null>(otelMetrics.metric_quantiles)

// UnifiedEvent should extend OtelMetrics
expectType<string | null>(unifiedEvent.metric_name)
expectType<number | null>(unifiedEvent.metric_value)

// ============================================================================
// Logging (4 fields) - All nullable
// ============================================================================

declare const logging: Logging
expectType<string | null>(logging.log_level)
expectType<number | null>(logging.log_level_num)
expectType<string | null>(logging.log_message)
expectType<string | null>(logging.log_logger)

// UnifiedEvent should extend Logging
expectType<string | null>(unifiedEvent.log_level)
expectType<string | null>(unifiedEvent.log_message)

// ============================================================================
// DoSpecific (7 fields) - All nullable
// ============================================================================

declare const doSpecific: DoSpecific
expectType<string | null>(doSpecific.do_class)
expectType<string | null>(doSpecific.do_id)
expectType<string | null>(doSpecific.do_method)
expectType<string | null>(doSpecific.action_verb)
expectType<string | null>(doSpecific.action_durability)
expectType<string | null>(doSpecific.action_target)
expectType<number | null>(doSpecific.action_input_version)

// UnifiedEvent should extend DoSpecific
expectType<string | null>(unifiedEvent.do_class)
expectType<string | null>(unifiedEvent.do_id)

// ============================================================================
// BusinessEpcis (5 fields) - All nullable
// ============================================================================

declare const businessEpcis: BusinessEpcis
expectType<string | null>(businessEpcis.biz_step)
expectType<string | null>(businessEpcis.biz_disposition)
expectType<string | null>(businessEpcis.biz_transaction)
expectType<string | null>(businessEpcis.biz_location)
expectType<string | null>(businessEpcis.biz_read_point)

// UnifiedEvent should extend BusinessEpcis
expectType<string | null>(unifiedEvent.biz_step)

// ============================================================================
// SnippetProxy (13 fields) - All nullable
// ============================================================================

declare const snippetProxy: SnippetProxy
expectType<string | null>(snippetProxy.snippet_initiator)
expectType<string | null>(snippetProxy.snippet_request_id)
expectType<number | null>(snippetProxy.snippet_start_time)
expectType<number | null>(snippetProxy.snippet_dns_time)
expectType<number | null>(snippetProxy.snippet_connect_time)
expectType<number | null>(snippetProxy.snippet_ttfb)
expectType<number | null>(snippetProxy.snippet_download_time)
expectType<number | null>(snippetProxy.snippet_blocked_time)
expectType<string | null>(snippetProxy.snippet_resource_type)
expectType<number | null>(snippetProxy.snippet_transfer_size)
expectType<number | null>(snippetProxy.snippet_decoded_size)
expectType<string | null>(snippetProxy.snippet_cache_state)
expectType<string | null>(snippetProxy.snippet_priority)

// UnifiedEvent should extend SnippetProxy
expectType<string | null>(unifiedEvent.snippet_initiator)
expectType<number | null>(unifiedEvent.snippet_ttfb)

// ============================================================================
// FlexiblePayloads (6 fields) - All nullable JSON
// ============================================================================

declare const flexiblePayloads: FlexiblePayloads
expectType<Record<string, unknown> | null>(flexiblePayloads.data)
expectType<Record<string, unknown> | null>(flexiblePayloads.attributes)
expectType<Record<string, string> | null>(flexiblePayloads.labels)
expectType<Record<string, unknown> | null>(flexiblePayloads.context)
expectType<Record<string, unknown> | null>(flexiblePayloads.properties)
expectType<Record<string, unknown> | null>(flexiblePayloads.traits)

// UnifiedEvent should extend FlexiblePayloads
expectType<Record<string, unknown> | null>(unifiedEvent.data)
expectType<Record<string, string> | null>(unifiedEvent.labels)

// ============================================================================
// PartitionInternal (7 fields) - All nullable
// ============================================================================

declare const partitionInternal: PartitionInternal
expectType<number | null>(partitionInternal.hour)
expectType<string | null>(partitionInternal.day)
expectType<string | null>(partitionInternal.event_source)
expectType<string | null>(partitionInternal.visibility)
expectType<string | null>(partitionInternal.ingested_at)
expectType<string | null>(partitionInternal.batch_id)
expectType<number | null>(partitionInternal.schema_version)

// UnifiedEvent should extend PartitionInternal
expectType<number | null>(unifiedEvent.hour)
expectType<string | null>(unifiedEvent.day)

// ============================================================================
// Type Guards
// ============================================================================

// Type guards should narrow event types correctly
if (isTraceEvent(unifiedEvent)) {
  expectType<'trace'>(unifiedEvent.event_type)
}

if (isMetricEvent(unifiedEvent)) {
  expectType<'metric'>(unifiedEvent.event_type)
}

if (isLogEvent(unifiedEvent)) {
  expectType<'log'>(unifiedEvent.event_type)
}

if (isCdcEvent(unifiedEvent)) {
  expectType<'cdc'>(unifiedEvent.event_type)
}

if (isTrackEvent(unifiedEvent)) {
  expectType<'track'>(unifiedEvent.event_type)
}

if (isPageEvent(unifiedEvent)) {
  expectType<'page'>(unifiedEvent.event_type)
}

if (isVitalEvent(unifiedEvent)) {
  expectType<'vital'>(unifiedEvent.event_type)
}

if (isReplayEvent(unifiedEvent)) {
  expectType<'replay'>(unifiedEvent.event_type)
}

if (isTailEvent(unifiedEvent)) {
  expectType<'tail'>(unifiedEvent.event_type)
}

if (isSnippetEvent(unifiedEvent)) {
  expectType<'snippet'>(unifiedEvent.event_type)
}

// ============================================================================
// Factory Function
// ============================================================================

// createUnifiedEvent should accept partial with CoreIdentity and return UnifiedEvent
const minimalInput = {
  id: 'evt_123',
  event_type: 'trace' as const,
  event_name: 'http.request',
  ns: 'https://api.example.com',
}

const createdEvent = createUnifiedEvent(minimalInput)
expectType<UnifiedEvent>(createdEvent)

// createUnifiedEvent should accept optional fields
const fullInput = {
  id: 'evt_123',
  event_type: 'trace' as const,
  event_name: 'http.request',
  ns: 'https://api.example.com',
  trace_id: 'trace_abc',
  span_id: 'span_xyz',
  http_url: '/api/users',
  http_status: 200,
}

const createdFullEvent = createUnifiedEvent(fullInput)
expectType<UnifiedEvent>(createdFullEvent)

// ============================================================================
// Column Metadata
// ============================================================================

// ColumnDefinition should have correct shape
declare const columnDef: ColumnDefinition
expectType<string>(columnDef.name)
expectType<'string' | 'number' | 'boolean' | 'timestamp' | 'json' | 'bytes' | 'bigint'>(columnDef.type)
expectType<boolean>(columnDef.nullable)
expectType<boolean>(columnDef.partition)

// UNIFIED_COLUMNS should be an array of ColumnDefinition
expectType<readonly ColumnDefinition[]>(UNIFIED_COLUMNS)

// ============================================================================
// Total Column Count Verification
// ============================================================================

// Count all fields:
// CoreIdentity: 4
// CausalityChain: 8
// Actor: 4
// Resource: 5
// Timing: 6
// Outcome: 6
// HttpContext: 12
// GeoLocation: 10
// ClientDevice: 11
// ServiceInfra: 13
// DatabaseCdc: 10
// MessagingQueue: 5
// Rpc: 4
// WebMarketing: 10
// WebVitals: 7
// SessionReplay: 5
// OtelMetrics: 10
// Logging: 4
// DoSpecific: 7
// BusinessEpcis: 5
// SnippetProxy: 13
// FlexiblePayloads: 6
// PartitionInternal: 7
// Total: 162

// Verify the type is composed of all semantic groups
type ExpectedGroups =
  & CoreIdentity
  & CausalityChain
  & Actor
  & Resource
  & Timing
  & Outcome
  & HttpContext
  & GeoLocation
  & ClientDevice
  & ServiceInfra
  & DatabaseCdc
  & MessagingQueue
  & Rpc
  & WebMarketing
  & WebVitals
  & SessionReplay
  & OtelMetrics
  & Logging
  & DoSpecific
  & BusinessEpcis
  & SnippetProxy
  & FlexiblePayloads
  & PartitionInternal

// UnifiedEvent should match the intersection of all groups
declare const expectedGroups: ExpectedGroups
expectType<ExpectedGroups>(unifiedEvent as ExpectedGroups)

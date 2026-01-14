/**
 * Zod Validation Schemas for Unified Events
 *
 * Runtime validation for the 162-column unified event schema.
 * Organized into 23 semantic groups matching the TypeScript types.
 *
 * @module types/unified-event-schema
 */

import { z } from 'zod'

// ============================================================================
// Event Type Enum Schema
// ============================================================================

/**
 * Supported event type values.
 */
export const EVENT_TYPES = [
  'trace',
  'metric',
  'log',
  'cdc',
  'track',
  'page',
  'vital',
  'replay',
  'tail',
  'snippet',
] as const

/**
 * Schema for event type classification.
 * Validates against the 10 supported event types.
 */
export const EventTypeSchema = z.enum(EVENT_TYPES, {
  message: `Invalid event_type. Must be one of: ${EVENT_TYPES.join(', ')}`,
})

export type EventTypeSchemaType = z.infer<typeof EventTypeSchema>

// ============================================================================
// Semantic Group 1: CoreIdentity (4 fields)
// ============================================================================

/**
 * Core identity fields - the only required fields in every event.
 * These uniquely identify and classify each event.
 */
export const CoreIdentitySchema = z.object({
  /** Unique event identifier (UUID or ULID) */
  id: z.string({ message: 'id is required and must be a string' }).min(1, 'id cannot be empty'),
  /** Event type classification */
  event_type: EventTypeSchema,
  /** Semantic event name (e.g., 'http.request', 'user.signup') */
  event_name: z.string({ message: 'event_name is required and must be a string' }).min(1, 'event_name cannot be empty'),
  /** Namespace URL identifying the event source */
  ns: z.string({ message: 'ns (namespace) is required and must be a string' }).min(1, 'ns cannot be empty'),
})

export type CoreIdentitySchemaType = z.infer<typeof CoreIdentitySchema>

// ============================================================================
// Semantic Group 2: CausalityChain (8 fields)
// ============================================================================

/**
 * Causality and correlation fields for distributed tracing.
 * All nullable to support events that don't participate in traces.
 */
export const CausalityChainSchema = z.object({
  /** W3C trace ID (32 hex chars) */
  trace_id: z.string().nullable(),
  /** Span ID within the trace (16 hex chars) */
  span_id: z.string().nullable(),
  /** Parent span ID for hierarchical traces */
  parent_id: z.string().nullable(),
  /** Root span ID (first span in trace) */
  root_id: z.string().nullable(),
  /** User session identifier */
  session_id: z.string().nullable(),
  /** Workflow execution ID for durable workflows */
  workflow_id: z.string().nullable(),
  /** Database/business transaction ID */
  transaction_id: z.string().nullable(),
  /** Custom correlation ID for cross-system linking */
  correlation_id: z.string().nullable(),
})

export type CausalityChainSchemaType = z.infer<typeof CausalityChainSchema>

// ============================================================================
// Semantic Group 3: Actor (4 fields)
// ============================================================================

/**
 * Actor identification fields.
 * Tracks who or what triggered the event.
 */
export const ActorSchema = z.object({
  /** Authenticated user/agent identifier */
  actor_id: z.string().nullable(),
  /** Actor type (user, agent, system, webhook, etc.) */
  actor_type: z.string().nullable(),
  /** Human-readable actor name */
  actor_name: z.string().nullable(),
  /** Anonymous/device identifier for unauthenticated actors */
  anonymous_id: z.string().nullable(),
})

export type ActorSchemaType = z.infer<typeof ActorSchema>

// ============================================================================
// Semantic Group 4: Resource (5 fields)
// ============================================================================

/**
 * Resource identification fields.
 * Describes the entity being acted upon.
 */
export const ResourceSchema = z.object({
  /** Resource type (Customer, Order, Thing, etc.) */
  resource_type: z.string().nullable(),
  /** Resource identifier */
  resource_id: z.string().nullable(),
  /** Human-readable resource name */
  resource_name: z.string().nullable(),
  /** Resource version or revision */
  resource_version: z.string().nullable(),
  /** Resource namespace (for multi-tenant) */
  resource_ns: z.string().nullable(),
})

export type ResourceSchemaType = z.infer<typeof ResourceSchema>

// ============================================================================
// Semantic Group 5: Timing (6 fields)
// ============================================================================

/**
 * Timestamp and duration fields.
 * Supports both ISO timestamps and nanosecond precision.
 */
export const TimingSchema = z.object({
  /** ISO 8601 timestamp when event occurred */
  timestamp: z.string().nullable(),
  /** Nanosecond precision timestamp (for high-resolution timing) */
  timestamp_ns: z.bigint().nullable(),
  /** ISO 8601 timestamp when operation started */
  started_at: z.string().nullable(),
  /** ISO 8601 timestamp when operation ended */
  ended_at: z.string().nullable(),
  /** Duration in milliseconds */
  duration_ms: z.number().nullable(),
  /** CPU time consumed in milliseconds */
  cpu_time_ms: z.number().nullable(),
})

export type TimingSchemaType = z.infer<typeof TimingSchema>

// ============================================================================
// Semantic Group 6: Outcome (6 fields)
// ============================================================================

/**
 * Outcome and error information fields.
 * Captures success/failure status and error details.
 */
export const OutcomeSchema = z.object({
  /** Outcome classification (success, failure, error, timeout, etc.) */
  outcome: z.string().nullable(),
  /** Human-readable outcome reason */
  outcome_reason: z.string().nullable(),
  /** HTTP/gRPC status code */
  status_code: z.number().nullable(),
  /** Error type/class name */
  error_type: z.string().nullable(),
  /** Error message */
  error_message: z.string().nullable(),
  /** Error stack trace */
  error_stack: z.string().nullable(),
})

export type OutcomeSchemaType = z.infer<typeof OutcomeSchema>

// ============================================================================
// Semantic Group 7: HttpContext (12 fields)
// ============================================================================

/**
 * HTTP request/response context fields.
 * Captures full HTTP transaction details.
 */
export const HttpContextSchema = z.object({
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  http_method: z.string().nullable(),
  /** Full request URL */
  http_url: z.string().nullable(),
  /** Request host header */
  http_host: z.string().nullable(),
  /** URL path (without query string) */
  http_path: z.string().nullable(),
  /** URL query string */
  http_query: z.string().nullable(),
  /** HTTP response status code */
  http_status: z.number().nullable(),
  /** HTTP protocol version (HTTP/1.1, HTTP/2, etc.) */
  http_protocol: z.string().nullable(),
  /** Request body size in bytes */
  http_request_size: z.number().nullable(),
  /** Response body size in bytes */
  http_response_size: z.number().nullable(),
  /** Referrer URL */
  http_referrer: z.string().nullable(),
  /** User agent string */
  http_user_agent: z.string().nullable(),
  /** Content-Type header */
  http_content_type: z.string().nullable(),
})

export type HttpContextSchemaType = z.infer<typeof HttpContextSchema>

// ============================================================================
// Semantic Group 8: GeoLocation (10 fields)
// ============================================================================

/**
 * Geographic location fields.
 * Derived from IP geolocation or explicit coordinates.
 */
export const GeoLocationSchema = z.object({
  /** ISO 3166-1 alpha-2 country code */
  geo_country: z.string().nullable(),
  /** ISO 3166-2 region/state code */
  geo_region: z.string().nullable(),
  /** City name */
  geo_city: z.string().nullable(),
  /** Cloudflare colo code (3-letter airport code) */
  geo_colo: z.string().nullable(),
  /** IANA timezone identifier */
  geo_timezone: z.string().nullable(),
  /** Latitude coordinate */
  geo_latitude: z.number().nullable(),
  /** Longitude coordinate */
  geo_longitude: z.number().nullable(),
  /** Autonomous System Number */
  geo_asn: z.number().nullable(),
  /** Autonomous System Organization name */
  geo_as_org: z.string().nullable(),
  /** Postal/ZIP code */
  geo_postal: z.string().nullable(),
})

export type GeoLocationSchemaType = z.infer<typeof GeoLocationSchema>

// ============================================================================
// Semantic Group 9: ClientDevice (11 fields)
// ============================================================================

/**
 * Client and device identification fields.
 * Captures browser/app and device information.
 */
export const ClientDeviceSchema = z.object({
  /** Client type (browser, mobile_app, sdk, cli, etc.) */
  client_type: z.string().nullable(),
  /** Client/browser name */
  client_name: z.string().nullable(),
  /** Client/browser version */
  client_version: z.string().nullable(),
  /** Device type (desktop, mobile, tablet, tv, etc.) */
  device_type: z.string().nullable(),
  /** Device model */
  device_model: z.string().nullable(),
  /** Device brand/manufacturer */
  device_brand: z.string().nullable(),
  /** Operating system name */
  os_name: z.string().nullable(),
  /** Operating system version */
  os_version: z.string().nullable(),
  /** Bot detection score (0-100) */
  bot_score: z.number().nullable(),
  /** Whether bot is verified (known good bot) */
  bot_verified: z.boolean().nullable(),
  /** Screen resolution (e.g., '1920x1080') */
  screen_size: z.string().nullable(),
})

export type ClientDeviceSchemaType = z.infer<typeof ClientDeviceSchema>

// ============================================================================
// Semantic Group 10: ServiceInfra (13 fields)
// ============================================================================

/**
 * Service and infrastructure context fields.
 * Identifies the service, host, and deployment context.
 */
export const ServiceInfraSchema = z.object({
  /** Service/application name */
  service_name: z.string().nullable(),
  /** Service version/build */
  service_version: z.string().nullable(),
  /** Service instance identifier */
  service_instance: z.string().nullable(),
  /** Service namespace (environment, stage) */
  service_namespace: z.string().nullable(),
  /** Host name */
  host_name: z.string().nullable(),
  /** Host identifier */
  host_id: z.string().nullable(),
  /** Cloud provider (cloudflare, aws, gcp, azure) */
  cloud_provider: z.string().nullable(),
  /** Cloud region */
  cloud_region: z.string().nullable(),
  /** Cloud availability zone */
  cloud_zone: z.string().nullable(),
  /** Container/worker ID */
  container_id: z.string().nullable(),
  /** Kubernetes namespace */
  k8s_namespace: z.string().nullable(),
  /** Kubernetes pod name */
  k8s_pod: z.string().nullable(),
  /** Kubernetes deployment name */
  k8s_deployment: z.string().nullable(),
})

export type ServiceInfraSchemaType = z.infer<typeof ServiceInfraSchema>

// ============================================================================
// Semantic Group 11: DatabaseCdc (10 fields)
// ============================================================================

/**
 * Database and CDC (Change Data Capture) fields.
 * Captures database operations and change events.
 */
export const DatabaseCdcSchema = z.object({
  /** Database system (postgres, mysql, sqlite, etc.) */
  db_system: z.string().nullable(),
  /** Database name */
  db_name: z.string().nullable(),
  /** Table/collection name */
  db_table: z.string().nullable(),
  /** Operation type (insert, update, delete, select) */
  db_operation: z.string().nullable(),
  /** SQL statement (sanitized) */
  db_statement: z.string().nullable(),
  /** Row/document identifier */
  db_row_id: z.string().nullable(),
  /** Log sequence number (for CDC) */
  db_lsn: z.string().nullable(),
  /** Row version for optimistic concurrency */
  db_version: z.number().nullable(),
  /** JSON snapshot of row before change */
  db_before: z.string().nullable(),
  /** JSON snapshot of row after change */
  db_after: z.string().nullable(),
})

export type DatabaseCdcSchemaType = z.infer<typeof DatabaseCdcSchema>

// ============================================================================
// Semantic Group 12: MessagingQueue (5 fields)
// ============================================================================

/**
 * Messaging and queue fields.
 * Captures message broker operations.
 */
export const MessagingQueueSchema = z.object({
  /** Messaging system (kafka, rabbitmq, sqs, cloudflare_queues) */
  msg_system: z.string().nullable(),
  /** Queue/topic/channel name */
  msg_destination: z.string().nullable(),
  /** Operation (publish, consume, ack, nack) */
  msg_operation: z.string().nullable(),
  /** Batch size for bulk operations */
  msg_batch_size: z.number().nullable(),
  /** Message identifier */
  msg_message_id: z.string().nullable(),
})

export type MessagingQueueSchemaType = z.infer<typeof MessagingQueueSchema>

// ============================================================================
// Semantic Group 13: Rpc (4 fields)
// ============================================================================

/**
 * RPC (Remote Procedure Call) fields.
 * Captures gRPC, Cap'n Proto, and other RPC details.
 */
export const RpcSchema = z.object({
  /** RPC system (grpc, capnproto, thrift) */
  rpc_system: z.string().nullable(),
  /** RPC service name */
  rpc_service: z.string().nullable(),
  /** RPC method name */
  rpc_method: z.string().nullable(),
  /** RPC status (ok, cancelled, deadline_exceeded, etc.) */
  rpc_status: z.string().nullable(),
})

export type RpcSchemaType = z.infer<typeof RpcSchema>

// ============================================================================
// Semantic Group 14: WebMarketing (10 fields)
// ============================================================================

/**
 * Web analytics and marketing attribution fields.
 * UTM parameters and A/B test tracking.
 */
export const WebMarketingSchema = z.object({
  /** Page title */
  page_title: z.string().nullable(),
  /** Search query on page */
  page_search: z.string().nullable(),
  /** UTM campaign name */
  campaign_name: z.string().nullable(),
  /** UTM campaign source */
  campaign_source: z.string().nullable(),
  /** UTM campaign medium */
  campaign_medium: z.string().nullable(),
  /** UTM campaign term */
  campaign_term: z.string().nullable(),
  /** UTM campaign content */
  campaign_content: z.string().nullable(),
  /** Campaign identifier */
  campaign_id: z.string().nullable(),
  /** A/B test identifier */
  ab_test_id: z.string().nullable(),
  /** A/B test variant assignment */
  ab_variant: z.string().nullable(),
})

export type WebMarketingSchemaType = z.infer<typeof WebMarketingSchema>

// ============================================================================
// Semantic Group 15: WebVitals (7 fields)
// ============================================================================

/**
 * Web Vitals performance metrics fields.
 * Core Web Vitals (LCP, FID, CLS) and others.
 */
export const WebVitalsSchema = z.object({
  /** Vital metric name (LCP, FID, CLS, TTFB, FCP, INP) */
  vital_name: z.string().nullable(),
  /** Vital metric value */
  vital_value: z.number().nullable(),
  /** Vital rating (good, needs-improvement, poor) */
  vital_rating: z.string().nullable(),
  /** Delta from previous measurement */
  vital_delta: z.number().nullable(),
  /** DOM element associated with the metric */
  vital_element: z.string().nullable(),
  /** Page load state when metric was captured */
  vital_load_state: z.string().nullable(),
  /** Navigation type (navigate, reload, back_forward, prerender) */
  nav_type: z.string().nullable(),
})

export type WebVitalsSchemaType = z.infer<typeof WebVitalsSchema>

// ============================================================================
// Semantic Group 16: SessionReplay (5 fields)
// ============================================================================

/**
 * Session replay recording fields.
 * Captures DOM mutations, input events, and network activity.
 */
export const SessionReplaySchema = z.object({
  /** Replay event type (mutation, input, scroll, network, etc.) */
  replay_type: z.string().nullable(),
  /** Replay source (rrweb, custom) */
  replay_source: z.string().nullable(),
  /** Sequence number within session */
  replay_sequence: z.number().nullable(),
  /** Milliseconds since session start */
  replay_timestamp_offset: z.number().nullable(),
  /** Encoded replay data (JSON or binary) */
  replay_data: z.string().nullable(),
})

export type SessionReplaySchemaType = z.infer<typeof SessionReplaySchema>

// ============================================================================
// Semantic Group 17: OtelMetrics (10 fields)
// ============================================================================

/**
 * OpenTelemetry metrics fields.
 * Supports gauge, counter, and histogram metric types.
 */
export const OtelMetricsSchema = z.object({
  /** Metric name */
  metric_name: z.string().nullable(),
  /** Metric unit (ms, bytes, requests, etc.) */
  metric_unit: z.string().nullable(),
  /** Metric type (gauge, counter, histogram) */
  metric_type: z.string().nullable(),
  /** Metric value (for gauge/counter) */
  metric_value: z.number().nullable(),
  /** Sample count (for histogram) */
  metric_count: z.number().nullable(),
  /** Sum of samples (for histogram) */
  metric_sum: z.number().nullable(),
  /** Minimum value (for histogram) */
  metric_min: z.number().nullable(),
  /** Maximum value (for histogram) */
  metric_max: z.number().nullable(),
  /** Histogram bucket boundaries and counts (JSON) */
  metric_buckets: z.string().nullable(),
  /** Quantile values (JSON) */
  metric_quantiles: z.string().nullable(),
})

export type OtelMetricsSchemaType = z.infer<typeof OtelMetricsSchema>

// ============================================================================
// Semantic Group 18: Logging (4 fields)
// ============================================================================

/**
 * Structured logging fields.
 * Compatible with common logging frameworks.
 */
export const LoggingSchema = z.object({
  /** Log level name (debug, info, warn, error, fatal) */
  log_level: z.string().nullable(),
  /** Numeric log level (for filtering) */
  log_level_num: z.number().nullable(),
  /** Log message */
  log_message: z.string().nullable(),
  /** Logger name/category */
  log_logger: z.string().nullable(),
})

export type LoggingSchemaType = z.infer<typeof LoggingSchema>

// ============================================================================
// Semantic Group 19: DoSpecific (7 fields)
// ============================================================================

/**
 * Durable Object specific fields.
 * Captures DO class, method, and action context.
 */
export const DoSpecificSchema = z.object({
  /** Durable Object class name */
  do_class: z.string().nullable(),
  /** Durable Object instance ID */
  do_id: z.string().nullable(),
  /** DO method being invoked */
  do_method: z.string().nullable(),
  /** Action verb (create, update, delete, etc.) */
  action_verb: z.string().nullable(),
  /** Action durability level (send, try, do) */
  action_durability: z.string().nullable(),
  /** Action target identifier */
  action_target: z.string().nullable(),
  /** Input version for optimistic concurrency */
  action_input_version: z.number().nullable(),
})

export type DoSpecificSchemaType = z.infer<typeof DoSpecificSchema>

// ============================================================================
// Semantic Group 20: BusinessEpcis (5 fields)
// ============================================================================

/**
 * Business process fields (EPCIS-compatible).
 * Tracks business steps, disposition, and transactions.
 */
export const BusinessEpcisSchema = z.object({
  /** Business step (shipping, receiving, commissioning, etc.) */
  biz_step: z.string().nullable(),
  /** Disposition/status of object */
  biz_disposition: z.string().nullable(),
  /** Business transaction reference */
  biz_transaction: z.string().nullable(),
  /** Business location (URN or identifier) */
  biz_location: z.string().nullable(),
  /** Read point where event was captured */
  biz_read_point: z.string().nullable(),
})

export type BusinessEpcisSchemaType = z.infer<typeof BusinessEpcisSchema>

// ============================================================================
// Semantic Group 21: SnippetProxy (13 fields)
// ============================================================================

/**
 * Browser snippet and resource timing fields.
 * Captures network request timing from the browser.
 */
export const SnippetProxySchema = z.object({
  /** Request initiator (link, script, fetch, etc.) */
  snippet_initiator: z.string().nullable(),
  /** Request identifier */
  snippet_request_id: z.string().nullable(),
  /** Request start time (performance.now()) */
  snippet_start_time: z.number().nullable(),
  /** DNS lookup time in ms */
  snippet_dns_time: z.number().nullable(),
  /** Connection time in ms */
  snippet_connect_time: z.number().nullable(),
  /** Time to first byte in ms */
  snippet_ttfb: z.number().nullable(),
  /** Download time in ms */
  snippet_download_time: z.number().nullable(),
  /** Time blocked waiting for connection */
  snippet_blocked_time: z.number().nullable(),
  /** Resource type (document, script, stylesheet, image, etc.) */
  snippet_resource_type: z.string().nullable(),
  /** Transfer size in bytes */
  snippet_transfer_size: z.number().nullable(),
  /** Decoded/uncompressed size in bytes */
  snippet_decoded_size: z.number().nullable(),
  /** Cache state (hit, miss, conditional) */
  snippet_cache_state: z.string().nullable(),
  /** Resource priority (high, medium, low) */
  snippet_priority: z.string().nullable(),
})

export type SnippetProxySchemaType = z.infer<typeof SnippetProxySchema>

// ============================================================================
// Semantic Group 22: FlexiblePayloads (6 fields)
// ============================================================================

/**
 * Flexible payload fields for custom data.
 * Supports arbitrary JSON data in various structures.
 */
export const FlexiblePayloadsSchema = z.object({
  /** Primary event data payload */
  data: z.record(z.string(), z.unknown()).nullable(),
  /** Resource attributes (OTEL semantic conventions) */
  attributes: z.record(z.string(), z.unknown()).nullable(),
  /** String labels/tags for filtering */
  labels: z.record(z.string(), z.string()).nullable(),
  /** Additional context data */
  context: z.record(z.string(), z.unknown()).nullable(),
  /** Segment-style properties */
  properties: z.record(z.string(), z.unknown()).nullable(),
  /** User traits (Segment-style) */
  traits: z.record(z.string(), z.unknown()).nullable(),
})

export type FlexiblePayloadsSchemaType = z.infer<typeof FlexiblePayloadsSchema>

// ============================================================================
// Semantic Group 23: PartitionInternal (7 fields)
// ============================================================================

/**
 * Internal partition and metadata fields.
 * Used for data management and schema evolution.
 */
export const PartitionInternalSchema = z.object({
  /** Hour of day (0-23) for hourly partitioning */
  hour: z.number().nullable(),
  /** Date string (YYYY-MM-DD) for daily partitioning */
  day: z.string().nullable(),
  /** Event source system identifier */
  event_source: z.string().nullable(),
  /** Visibility level (public, internal, debug) */
  visibility: z.string().nullable(),
  /** ISO timestamp when event was ingested */
  ingested_at: z.string().nullable(),
  /** Batch identifier for bulk ingestion */
  batch_id: z.string().nullable(),
  /** Schema version number */
  schema_version: z.number().nullable(),
})

export type PartitionInternalSchemaType = z.infer<typeof PartitionInternalSchema>

// ============================================================================
// Merged UnifiedEvent Schema
// ============================================================================

/**
 * Complete unified event schema merging all 23 semantic groups.
 * Total: 162 columns
 */
export const UnifiedEventSchema = CoreIdentitySchema
  .merge(CausalityChainSchema)
  .merge(ActorSchema)
  .merge(ResourceSchema)
  .merge(TimingSchema)
  .merge(OutcomeSchema)
  .merge(HttpContextSchema)
  .merge(GeoLocationSchema)
  .merge(ClientDeviceSchema)
  .merge(ServiceInfraSchema)
  .merge(DatabaseCdcSchema)
  .merge(MessagingQueueSchema)
  .merge(RpcSchema)
  .merge(WebMarketingSchema)
  .merge(WebVitalsSchema)
  .merge(SessionReplaySchema)
  .merge(OtelMetricsSchema)
  .merge(LoggingSchema)
  .merge(DoSpecificSchema)
  .merge(BusinessEpcisSchema)
  .merge(SnippetProxySchema)
  .merge(FlexiblePayloadsSchema)
  .merge(PartitionInternalSchema)

/**
 * Strict version of UnifiedEventSchema.
 * Rejects any unknown fields not defined in the schema.
 */
export const UnifiedEventStrictSchema = UnifiedEventSchema.strict()

/**
 * Lazy version of UnifiedEventSchema.
 * Only validates core identity fields, allows any additional fields.
 * Useful for quick validation or forward compatibility.
 */
export const UnifiedEventLazySchema = CoreIdentitySchema.passthrough()

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Validated unified event type inferred from the schema.
 */
export type ValidatedUnifiedEvent = z.infer<typeof UnifiedEventSchema>

/**
 * Lazy validated event type (only core fields guaranteed).
 */
export type ValidatedUnifiedEventLazy = z.infer<typeof UnifiedEventLazySchema>

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates data against the UnifiedEventSchema.
 * Throws ZodError if validation fails.
 *
 * @param data - Unknown data to validate
 * @returns Validated UnifiedEvent
 * @throws ZodError if validation fails
 *
 * @example
 * ```typescript
 * const event = validateUnifiedEvent({
 *   id: 'evt_123',
 *   event_type: 'trace',
 *   event_name: 'http.request',
 *   ns: 'https://api.example.com',
 *   // ... all other fields
 * })
 * ```
 */
export function validateUnifiedEvent(data: unknown): ValidatedUnifiedEvent {
  return UnifiedEventSchema.parse(data)
}

/**
 * Safely validates data against the UnifiedEventSchema.
 * Returns a result object instead of throwing.
 *
 * @param data - Unknown data to validate
 * @returns SafeParseResult with success boolean and data/error
 *
 * @example
 * ```typescript
 * const result = safeValidateUnifiedEvent(eventData)
 * if (result.success) {
 *   console.log('Valid event:', result.data.id)
 * } else {
 *   console.error('Validation errors:', result.error.issues)
 * }
 * ```
 */
export function safeValidateUnifiedEvent(data: unknown) {
  return UnifiedEventSchema.safeParse(data)
}

/**
 * Validates only core identity fields (lazy validation).
 * Useful for quick checks or when full validation is not needed.
 *
 * @param data - Unknown data to validate
 * @returns Validated event with core fields and any additional fields
 */
export function validateUnifiedEventLazy(data: unknown): ValidatedUnifiedEventLazy {
  return UnifiedEventLazySchema.parse(data)
}

/**
 * Safe lazy validation of core identity fields.
 *
 * @param data - Unknown data to validate
 * @returns SafeParseResult with success boolean and data/error
 */
export function safeValidateUnifiedEventLazy(data: unknown) {
  return UnifiedEventLazySchema.safeParse(data)
}

// ============================================================================
// Schema Metadata
// ============================================================================

/**
 * List of all semantic group schemas for iteration.
 */
export const SEMANTIC_GROUP_SCHEMAS = {
  CoreIdentity: CoreIdentitySchema,
  CausalityChain: CausalityChainSchema,
  Actor: ActorSchema,
  Resource: ResourceSchema,
  Timing: TimingSchema,
  Outcome: OutcomeSchema,
  HttpContext: HttpContextSchema,
  GeoLocation: GeoLocationSchema,
  ClientDevice: ClientDeviceSchema,
  ServiceInfra: ServiceInfraSchema,
  DatabaseCdc: DatabaseCdcSchema,
  MessagingQueue: MessagingQueueSchema,
  Rpc: RpcSchema,
  WebMarketing: WebMarketingSchema,
  WebVitals: WebVitalsSchema,
  SessionReplay: SessionReplaySchema,
  OtelMetrics: OtelMetricsSchema,
  Logging: LoggingSchema,
  DoSpecific: DoSpecificSchema,
  BusinessEpcis: BusinessEpcisSchema,
  SnippetProxy: SnippetProxySchema,
  FlexiblePayloads: FlexiblePayloadsSchema,
  PartitionInternal: PartitionInternalSchema,
} as const

/**
 * Total column count across all schemas.
 */
export const TOTAL_COLUMNS = 162

// ============================================================================
// Specialized Event Schemas with Refinements
// ============================================================================

/**
 * Schema for trace events with cross-field validation.
 * Ensures trace_id and span_id are present for trace events.
 */
export const TraceEventSchema = UnifiedEventSchema.refine(
  (data) => {
    if (data.event_type === 'trace') {
      return data.trace_id !== null && data.span_id !== null
    }
    return true
  },
  {
    message: 'Trace events require trace_id and span_id to be set',
    path: ['trace_id'],
  }
)

/**
 * Schema for metric events with cross-field validation.
 * Ensures metric_name and metric_type are present for metric events.
 */
export const MetricEventSchema = UnifiedEventSchema.refine(
  (data) => {
    if (data.event_type === 'metric') {
      return data.metric_name !== null && data.metric_type !== null
    }
    return true
  },
  {
    message: 'Metric events require metric_name and metric_type to be set',
    path: ['metric_name'],
  }
)

/**
 * Schema for log events with cross-field validation.
 * Ensures log_level and log_message are present for log events.
 */
export const LogEventSchema = UnifiedEventSchema.refine(
  (data) => {
    if (data.event_type === 'log') {
      return data.log_level !== null && data.log_message !== null
    }
    return true
  },
  {
    message: 'Log events require log_level and log_message to be set',
    path: ['log_level'],
  }
)

/**
 * Schema for CDC events with cross-field validation.
 * Ensures database fields are present for CDC events.
 */
export const CdcEventSchema = UnifiedEventSchema.refine(
  (data) => {
    if (data.event_type === 'cdc') {
      return data.db_system !== null && data.db_table !== null && data.db_operation !== null
    }
    return true
  },
  {
    message: 'CDC events require db_system, db_table, and db_operation to be set',
    path: ['db_system'],
  }
)

/**
 * Schema for Web Vitals events with cross-field validation.
 * Ensures vital_name and vital_value are present for vital events.
 */
export const VitalEventSchema = UnifiedEventSchema.refine(
  (data) => {
    if (data.event_type === 'vital') {
      return data.vital_name !== null && data.vital_value !== null
    }
    return true
  },
  {
    message: 'Vital events require vital_name and vital_value to be set',
    path: ['vital_name'],
  }
)

// ============================================================================
// Batch Validation Utilities
// ============================================================================

/**
 * Validates an array of events.
 * Returns an object with valid events and validation errors.
 *
 * @param events - Array of unknown data to validate
 * @returns Object with `valid` array and `errors` array
 *
 * @example
 * ```typescript
 * const { valid, errors } = validateEventBatch(rawEvents)
 * console.log(`${valid.length} valid, ${errors.length} errors`)
 * ```
 */
export function validateEventBatch(events: unknown[]): {
  valid: ValidatedUnifiedEvent[]
  errors: Array<{ index: number; error: z.ZodError }>
} {
  const valid: ValidatedUnifiedEvent[] = []
  const errors: Array<{ index: number; error: z.ZodError }> = []

  for (let i = 0; i < events.length; i++) {
    const result = UnifiedEventSchema.safeParse(events[i])
    if (result.success) {
      valid.push(result.data)
    } else {
      errors.push({ index: i, error: result.error })
    }
  }

  return { valid, errors }
}

/**
 * Lazily validates an array of events (only core fields).
 * More performant for high-volume event processing.
 *
 * @param events - Array of unknown data to validate
 * @returns Object with `valid` array and `errors` array
 */
export function validateEventBatchLazy(events: unknown[]): {
  valid: ValidatedUnifiedEventLazy[]
  errors: Array<{ index: number; error: z.ZodError }>
} {
  const valid: ValidatedUnifiedEventLazy[] = []
  const errors: Array<{ index: number; error: z.ZodError }> = []

  for (let i = 0; i < events.length; i++) {
    const result = UnifiedEventLazySchema.safeParse(events[i])
    if (result.success) {
      valid.push(result.data)
    } else {
      errors.push({ index: i, error: result.error })
    }
  }

  return { valid, errors }
}

// ============================================================================
// Error Formatting Utilities
// ============================================================================

/**
 * Formats Zod validation errors into a human-readable string.
 *
 * @param error - ZodError from validation
 * @returns Formatted error message string
 *
 * @example
 * ```typescript
 * const result = safeValidateUnifiedEvent(data)
 * if (!result.success) {
 *   console.error(formatValidationError(result.error))
 * }
 * ```
 */
export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/**
 * Extracts field names that failed validation.
 *
 * @param error - ZodError from validation
 * @returns Array of field paths that failed
 */
export function getInvalidFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.path.join('.')))]
}

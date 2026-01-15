/**
 * Unified Event Schema Types
 *
 * A comprehensive 162-column event schema organized into 23 semantic groups.
 * Designed for unified observability across traces, metrics, logs, CDC,
 * analytics, and browser instrumentation data.
 *
 * @module types/unified-event
 */

// ============================================================================
// Event Type Enum
// ============================================================================

/**
 * Supported event types in the unified schema.
 *
 * - trace: Distributed tracing spans (OpenTelemetry compatible)
 * - metric: OTEL metrics (gauge, counter, histogram)
 * - log: Structured log entries
 * - cdc: Change data capture from databases
 * - track: User action tracking (Segment-style)
 * - page: Page view events
 * - vital: Web Vitals performance metrics
 * - replay: Session replay data
 * - tail: Workers tail/real-time log events
 * - snippet: Browser snippet proxy timing data
 */
export type EventType =
  | 'trace'
  | 'metric'
  | 'log'
  | 'cdc'
  | 'track'
  | 'page'
  | 'vital'
  | 'replay'
  | 'tail'
  | 'snippet'

// ============================================================================
// Semantic Group 1: CoreIdentity (4 fields)
// ============================================================================

/**
 * Core identity fields - the only required fields in every event.
 * These uniquely identify and classify each event.
 */
export interface CoreIdentity {
  /** Unique event identifier (UUID or ULID) */
  id: string
  /** Event type classification */
  event_type: EventType
  /** Semantic event name (e.g., 'http.request', 'user.signup') */
  event_name: string
  /** Namespace URL identifying the event source */
  ns: string
}

// ============================================================================
// Semantic Group 2: CausalityChain (8 fields)
// ============================================================================

/**
 * Causality and correlation fields for distributed tracing.
 * All nullable to support events that don't participate in traces.
 */
export interface CausalityChain {
  /** W3C trace ID (32 hex chars) */
  trace_id: string | null
  /** Span ID within the trace (16 hex chars) */
  span_id: string | null
  /** Parent span ID for hierarchical traces */
  parent_id: string | null
  /** Root span ID (first span in trace) */
  root_id: string | null
  /** User session identifier */
  session_id: string | null
  /** Workflow execution ID for durable workflows */
  workflow_id: string | null
  /** Database/business transaction ID */
  transaction_id: string | null
  /** Custom correlation ID for cross-system linking */
  correlation_id: string | null
  /** Graph depth (0 = root, 1 = direct child, etc.) - computed for fast queries */
  depth: number | null
  /** True if this span has no children - computed for fast leaf queries */
  is_leaf: boolean | null
  /** True if this span has no parent_id - computed for fast root queries */
  is_root: boolean | null
}

// ============================================================================
// Semantic Group 3: Actor (4 fields)
// ============================================================================

/**
 * Actor identification fields.
 * Tracks who or what triggered the event.
 */
export interface Actor {
  /** Authenticated user/agent identifier */
  actor_id: string | null
  /** Actor type (user, agent, system, webhook, etc.) */
  actor_type: string | null
  /** Human-readable actor name */
  actor_name: string | null
  /** Anonymous/device identifier for unauthenticated actors */
  anonymous_id: string | null
}

// ============================================================================
// Semantic Group 4: Resource (5 fields)
// ============================================================================

/**
 * Resource identification fields.
 * Describes the entity being acted upon.
 */
export interface Resource {
  /** Resource type (Customer, Order, Thing, etc.) */
  resource_type: string | null
  /** Resource identifier */
  resource_id: string | null
  /** Human-readable resource name */
  resource_name: string | null
  /** Resource version or revision */
  resource_version: string | null
  /** Resource namespace (for multi-tenant) */
  resource_ns: string | null
}

// ============================================================================
// Semantic Group 5: Timing (6 fields)
// ============================================================================

/**
 * Timestamp and duration fields.
 * Supports both ISO timestamps and nanosecond precision.
 */
export interface Timing {
  /** ISO 8601 timestamp when event occurred */
  timestamp: string | null
  /** Nanosecond precision timestamp (for high-resolution timing) */
  timestamp_ns: bigint | null
  /** ISO 8601 timestamp when operation started */
  started_at: string | null
  /** ISO 8601 timestamp when operation ended */
  ended_at: string | null
  /** Duration in milliseconds */
  duration_ms: number | null
  /** CPU time consumed in milliseconds */
  cpu_time_ms: number | null
}

// ============================================================================
// Semantic Group 6: Outcome (6 fields)
// ============================================================================

/**
 * Outcome and error information fields.
 * Captures success/failure status and error details.
 */
export interface Outcome {
  /** Outcome classification (success, failure, error, timeout, etc.) */
  outcome: string | null
  /** Human-readable outcome reason */
  outcome_reason: string | null
  /** HTTP/gRPC status code */
  status_code: number | null
  /** Error type/class name */
  error_type: string | null
  /** Error message */
  error_message: string | null
  /** Error stack trace */
  error_stack: string | null
}

// ============================================================================
// Semantic Group 7: HttpContext (12 fields)
// ============================================================================

/**
 * HTTP request/response context fields.
 * Captures full HTTP transaction details.
 */
export interface HttpContext {
  /** HTTP method (GET, POST, PUT, DELETE, etc.) */
  http_method: string | null
  /** Full request URL */
  http_url: string | null
  /** Request host header */
  http_host: string | null
  /** URL path (without query string) */
  http_path: string | null
  /** URL query string */
  http_query: string | null
  /** HTTP response status code */
  http_status: number | null
  /** HTTP protocol version (HTTP/1.1, HTTP/2, etc.) */
  http_protocol: string | null
  /** Request body size in bytes */
  http_request_size: number | null
  /** Response body size in bytes */
  http_response_size: number | null
  /** Referrer URL */
  http_referrer: string | null
  /** User agent string */
  http_user_agent: string | null
  /** Content-Type header */
  http_content_type: string | null
}

// ============================================================================
// Semantic Group 8: GeoLocation (10 fields)
// ============================================================================

/**
 * Geographic location fields.
 * Derived from IP geolocation or explicit coordinates.
 */
export interface GeoLocation {
  /** ISO 3166-1 alpha-2 country code */
  geo_country: string | null
  /** ISO 3166-2 region/state code */
  geo_region: string | null
  /** City name */
  geo_city: string | null
  /** Cloudflare colo code (3-letter airport code) */
  geo_colo: string | null
  /** IANA timezone identifier */
  geo_timezone: string | null
  /** Latitude coordinate */
  geo_latitude: number | null
  /** Longitude coordinate */
  geo_longitude: number | null
  /** Autonomous System Number */
  geo_asn: number | null
  /** Autonomous System Organization name */
  geo_as_org: string | null
  /** Postal/ZIP code */
  geo_postal: string | null
}

// ============================================================================
// Semantic Group 9: ClientDevice (11 fields)
// ============================================================================

/**
 * Client and device identification fields.
 * Captures browser/app and device information.
 */
export interface ClientDevice {
  /** Client type (browser, mobile_app, sdk, cli, etc.) */
  client_type: string | null
  /** Client/browser name */
  client_name: string | null
  /** Client/browser version */
  client_version: string | null
  /** Device type (desktop, mobile, tablet, tv, etc.) */
  device_type: string | null
  /** Device model */
  device_model: string | null
  /** Device brand/manufacturer */
  device_brand: string | null
  /** Operating system name */
  os_name: string | null
  /** Operating system version */
  os_version: string | null
  /** Bot detection score (0-100) */
  bot_score: number | null
  /** Whether bot is verified (known good bot) */
  bot_verified: boolean | null
  /** Screen resolution (e.g., '1920x1080') */
  screen_size: string | null
}

// ============================================================================
// Semantic Group 10: ServiceInfra (13 fields)
// ============================================================================

/**
 * Service and infrastructure context fields.
 * Identifies the service, host, and deployment context.
 */
export interface ServiceInfra {
  /** Service/application name */
  service_name: string | null
  /** Service version/build */
  service_version: string | null
  /** Service instance identifier */
  service_instance: string | null
  /** Service namespace (environment, stage) */
  service_namespace: string | null
  /** Host name */
  host_name: string | null
  /** Host identifier */
  host_id: string | null
  /** Cloud provider (cloudflare, aws, gcp, azure) */
  cloud_provider: string | null
  /** Cloud region */
  cloud_region: string | null
  /** Cloud availability zone */
  cloud_zone: string | null
  /** Container/worker ID */
  container_id: string | null
  /** Kubernetes namespace */
  k8s_namespace: string | null
  /** Kubernetes pod name */
  k8s_pod: string | null
  /** Kubernetes deployment name */
  k8s_deployment: string | null
}

// ============================================================================
// Semantic Group 11: DatabaseCdc (10 fields)
// ============================================================================

/**
 * Database and CDC (Change Data Capture) fields.
 * Captures database operations and change events.
 */
export interface DatabaseCdc {
  /** Database system (postgres, mysql, sqlite, etc.) */
  db_system: string | null
  /** Database name */
  db_name: string | null
  /** Table/collection name */
  db_table: string | null
  /** Operation type (insert, update, delete, select) */
  db_operation: string | null
  /** SQL statement (sanitized) */
  db_statement: string | null
  /** Row/document identifier */
  db_row_id: string | null
  /** Log sequence number (for CDC) */
  db_lsn: string | null
  /** Row version for optimistic concurrency */
  db_version: number | null
  /** JSON snapshot of row before change */
  db_before: string | null
  /** JSON snapshot of row after change */
  db_after: string | null
}

// ============================================================================
// Semantic Group 12: MessagingQueue (5 fields)
// ============================================================================

/**
 * Messaging and queue fields.
 * Captures message broker operations.
 */
export interface MessagingQueue {
  /** Messaging system (kafka, rabbitmq, sqs, cloudflare_queues) */
  msg_system: string | null
  /** Queue/topic/channel name */
  msg_destination: string | null
  /** Operation (publish, consume, ack, nack) */
  msg_operation: string | null
  /** Batch size for bulk operations */
  msg_batch_size: number | null
  /** Message identifier */
  msg_message_id: string | null
}

// ============================================================================
// Semantic Group 13: Rpc (4 fields)
// ============================================================================

/**
 * RPC (Remote Procedure Call) fields.
 * Captures gRPC, Cap'n Proto, and other RPC details.
 */
export interface Rpc {
  /** RPC system (grpc, capnproto, thrift) */
  rpc_system: string | null
  /** RPC service name */
  rpc_service: string | null
  /** RPC method name */
  rpc_method: string | null
  /** RPC status (ok, cancelled, deadline_exceeded, etc.) */
  rpc_status: string | null
}

// ============================================================================
// Semantic Group 14: WebMarketing (10 fields)
// ============================================================================

/**
 * Web analytics and marketing attribution fields.
 * UTM parameters and A/B test tracking.
 */
export interface WebMarketing {
  /** Page title */
  page_title: string | null
  /** Search query on page */
  page_search: string | null
  /** UTM campaign name */
  campaign_name: string | null
  /** UTM campaign source */
  campaign_source: string | null
  /** UTM campaign medium */
  campaign_medium: string | null
  /** UTM campaign term */
  campaign_term: string | null
  /** UTM campaign content */
  campaign_content: string | null
  /** Campaign identifier */
  campaign_id: string | null
  /** A/B test identifier */
  ab_test_id: string | null
  /** A/B test variant assignment */
  ab_variant: string | null
}

// ============================================================================
// Semantic Group 15: WebVitals (7 fields)
// ============================================================================

/**
 * Web Vitals performance metrics fields.
 * Core Web Vitals (LCP, FID, CLS) and others.
 */
export interface WebVitals {
  /** Vital metric name (LCP, FID, CLS, TTFB, FCP, INP) */
  vital_name: string | null
  /** Vital metric value */
  vital_value: number | null
  /** Vital rating (good, needs-improvement, poor) */
  vital_rating: string | null
  /** Delta from previous measurement */
  vital_delta: number | null
  /** DOM element associated with the metric */
  vital_element: string | null
  /** Page load state when metric was captured */
  vital_load_state: string | null
  /** Navigation type (navigate, reload, back_forward, prerender) */
  nav_type: string | null
}

// ============================================================================
// Semantic Group 16: SessionReplay (5 fields)
// ============================================================================

/**
 * Session replay recording fields.
 * Captures DOM mutations, input events, and network activity.
 */
export interface SessionReplay {
  /** Replay event type (mutation, input, scroll, network, etc.) */
  replay_type: string | null
  /** Replay source (rrweb, custom) */
  replay_source: string | null
  /** Sequence number within session */
  replay_sequence: number | null
  /** Milliseconds since session start */
  replay_timestamp_offset: number | null
  /** Encoded replay data (JSON or binary) */
  replay_data: string | null
}

// ============================================================================
// Semantic Group 17: OtelMetrics (10 fields)
// ============================================================================

/**
 * OpenTelemetry metrics fields.
 * Supports gauge, counter, and histogram metric types.
 */
export interface OtelMetrics {
  /** Metric name */
  metric_name: string | null
  /** Metric unit (ms, bytes, requests, etc.) */
  metric_unit: string | null
  /** Metric type (gauge, counter, histogram) */
  metric_type: string | null
  /** Metric value (for gauge/counter) */
  metric_value: number | null
  /** Sample count (for histogram) */
  metric_count: number | null
  /** Sum of samples (for histogram) */
  metric_sum: number | null
  /** Minimum value (for histogram) */
  metric_min: number | null
  /** Maximum value (for histogram) */
  metric_max: number | null
  /** Histogram bucket boundaries and counts (JSON) */
  metric_buckets: string | null
  /** Quantile values (JSON) */
  metric_quantiles: string | null
}

// ============================================================================
// Semantic Group 18: Logging (4 fields)
// ============================================================================

/**
 * Structured logging fields.
 * Compatible with common logging frameworks.
 */
export interface Logging {
  /** Log level name (debug, info, warn, error, fatal) */
  log_level: string | null
  /** Numeric log level (for filtering) */
  log_level_num: number | null
  /** Log message */
  log_message: string | null
  /** Logger name/category */
  log_logger: string | null
}

// ============================================================================
// Semantic Group 19: DoSpecific (7 fields)
// ============================================================================

/**
 * Durable Object specific fields.
 * Captures DO class, method, and action context.
 */
export interface DoSpecific {
  /** Durable Object class name */
  do_class: string | null
  /** Durable Object instance ID */
  do_id: string | null
  /** DO method being invoked */
  do_method: string | null
  /** Action verb (create, update, delete, etc.) */
  action_verb: string | null
  /** Action durability level (send, try, do) */
  action_durability: string | null
  /** Action target identifier */
  action_target: string | null
  /** Input version for optimistic concurrency */
  action_input_version: number | null
}

// ============================================================================
// Semantic Group 20: BusinessEpcis (5 fields)
// ============================================================================

/**
 * Business process fields (EPCIS-compatible).
 * Tracks business steps, disposition, and transactions.
 */
export interface BusinessEpcis {
  /** Business step (shipping, receiving, commissioning, etc.) */
  biz_step: string | null
  /** Disposition/status of object */
  biz_disposition: string | null
  /** Business transaction reference */
  biz_transaction: string | null
  /** Business location (URN or identifier) */
  biz_location: string | null
  /** Read point where event was captured */
  biz_read_point: string | null
}

// ============================================================================
// Semantic Group 21: SnippetProxy (13 fields)
// ============================================================================

/**
 * Browser snippet and resource timing fields.
 * Captures network request timing from the browser.
 */
export interface SnippetProxy {
  /** Request initiator (link, script, fetch, etc.) */
  snippet_initiator: string | null
  /** Request identifier */
  snippet_request_id: string | null
  /** Request start time (performance.now()) */
  snippet_start_time: number | null
  /** DNS lookup time in ms */
  snippet_dns_time: number | null
  /** Connection time in ms */
  snippet_connect_time: number | null
  /** Time to first byte in ms */
  snippet_ttfb: number | null
  /** Download time in ms */
  snippet_download_time: number | null
  /** Time blocked waiting for connection */
  snippet_blocked_time: number | null
  /** Resource type (document, script, stylesheet, image, etc.) */
  snippet_resource_type: string | null
  /** Transfer size in bytes */
  snippet_transfer_size: number | null
  /** Decoded/uncompressed size in bytes */
  snippet_decoded_size: number | null
  /** Cache state (hit, miss, conditional) */
  snippet_cache_state: string | null
  /** Resource priority (high, medium, low) */
  snippet_priority: string | null
}

// ============================================================================
// Semantic Group 22: FlexiblePayloads (6 fields)
// ============================================================================

/**
 * Flexible payload fields for custom data.
 * Supports arbitrary JSON data in various structures.
 */
export interface FlexiblePayloads {
  /** Primary event data payload */
  data: Record<string, unknown> | null
  /** Resource attributes (OTEL semantic conventions) */
  attributes: Record<string, unknown> | null
  /** String labels/tags for filtering */
  labels: Record<string, string> | null
  /** Additional context data */
  context: Record<string, unknown> | null
  /** Segment-style properties */
  properties: Record<string, unknown> | null
  /** User traits (Segment-style) */
  traits: Record<string, unknown> | null
}

// ============================================================================
// Semantic Group 23: PartitionInternal (7 fields)
// ============================================================================

/**
 * Internal partition and metadata fields.
 * Used for data management and schema evolution.
 */
export interface PartitionInternal {
  /** Hour of day (0-23) for hourly partitioning */
  hour: number | null
  /** Date string (YYYY-MM-DD) for daily partitioning */
  day: string | null
  /** Event source system identifier */
  event_source: string | null
  /** Visibility level (public, internal, debug) */
  visibility: string | null
  /** ISO timestamp when event was ingested */
  ingested_at: string | null
  /** Batch identifier for bulk ingestion */
  batch_id: string | null
  /** Schema version number */
  schema_version: number | null
}

// ============================================================================
// Unified Event Type
// ============================================================================

/**
 * The complete unified event type combining all 23 semantic groups.
 * Total: 162 columns
 *
 * Column count breakdown:
 * - CoreIdentity: 4
 * - CausalityChain: 8
 * - Actor: 4
 * - Resource: 5
 * - Timing: 6
 * - Outcome: 6
 * - HttpContext: 12
 * - GeoLocation: 10
 * - ClientDevice: 11
 * - ServiceInfra: 13
 * - DatabaseCdc: 10
 * - MessagingQueue: 5
 * - Rpc: 4
 * - WebMarketing: 10
 * - WebVitals: 7
 * - SessionReplay: 5
 * - OtelMetrics: 10
 * - Logging: 4
 * - DoSpecific: 7
 * - BusinessEpcis: 5
 * - SnippetProxy: 13
 * - FlexiblePayloads: 6
 * - PartitionInternal: 7
 */
export type UnifiedEvent =
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

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for trace events (distributed tracing spans)
 */
export function isTraceEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'trace' } {
  return e.event_type === 'trace'
}

/**
 * Type guard for metric events (OTEL metrics)
 */
export function isMetricEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'metric' } {
  return e.event_type === 'metric'
}

/**
 * Type guard for log events (structured logging)
 */
export function isLogEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'log' } {
  return e.event_type === 'log'
}

/**
 * Type guard for CDC events (change data capture)
 */
export function isCdcEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'cdc' } {
  return e.event_type === 'cdc'
}

/**
 * Type guard for track events (user actions)
 */
export function isTrackEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'track' } {
  return e.event_type === 'track'
}

/**
 * Type guard for page events (page views)
 */
export function isPageEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'page' } {
  return e.event_type === 'page'
}

/**
 * Type guard for vital events (Web Vitals)
 */
export function isVitalEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'vital' } {
  return e.event_type === 'vital'
}

/**
 * Type guard for replay events (session replay)
 */
export function isReplayEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'replay' } {
  return e.event_type === 'replay'
}

/**
 * Type guard for tail events (real-time logs)
 */
export function isTailEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'tail' } {
  return e.event_type === 'tail'
}

/**
 * Type guard for snippet events (browser timing)
 */
export function isSnippetEvent(e: UnifiedEvent): e is UnifiedEvent & { event_type: 'snippet' } {
  return e.event_type === 'snippet'
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a UnifiedEvent with all nullable fields set to null.
 * Requires CoreIdentity fields (id, event_type, event_name, ns).
 *
 * @param partial - Partial event with required CoreIdentity fields
 * @returns Complete UnifiedEvent with all fields
 *
 * @example
 * ```typescript
 * const event = createUnifiedEvent({
 *   id: 'evt_123',
 *   event_type: 'trace',
 *   event_name: 'http.request',
 *   ns: 'https://api.example.com',
 *   http_method: 'GET',
 *   http_url: '/api/users',
 * })
 * ```
 */
export function createUnifiedEvent(
  partial: Partial<UnifiedEvent> & CoreIdentity
): UnifiedEvent {
  return {
    // CoreIdentity (required)
    id: partial.id,
    event_type: partial.event_type,
    event_name: partial.event_name,
    ns: partial.ns,

    // CausalityChain
    trace_id: partial.trace_id ?? null,
    span_id: partial.span_id ?? null,
    parent_id: partial.parent_id ?? null,
    root_id: partial.root_id ?? null,
    session_id: partial.session_id ?? null,
    workflow_id: partial.workflow_id ?? null,
    transaction_id: partial.transaction_id ?? null,
    correlation_id: partial.correlation_id ?? null,
    depth: partial.depth ?? null,
    is_leaf: partial.is_leaf ?? null,
    is_root: partial.is_root ?? null,

    // Actor
    actor_id: partial.actor_id ?? null,
    actor_type: partial.actor_type ?? null,
    actor_name: partial.actor_name ?? null,
    anonymous_id: partial.anonymous_id ?? null,

    // Resource
    resource_type: partial.resource_type ?? null,
    resource_id: partial.resource_id ?? null,
    resource_name: partial.resource_name ?? null,
    resource_version: partial.resource_version ?? null,
    resource_ns: partial.resource_ns ?? null,

    // Timing
    timestamp: partial.timestamp ?? null,
    timestamp_ns: partial.timestamp_ns ?? null,
    started_at: partial.started_at ?? null,
    ended_at: partial.ended_at ?? null,
    duration_ms: partial.duration_ms ?? null,
    cpu_time_ms: partial.cpu_time_ms ?? null,

    // Outcome
    outcome: partial.outcome ?? null,
    outcome_reason: partial.outcome_reason ?? null,
    status_code: partial.status_code ?? null,
    error_type: partial.error_type ?? null,
    error_message: partial.error_message ?? null,
    error_stack: partial.error_stack ?? null,

    // HttpContext
    http_method: partial.http_method ?? null,
    http_url: partial.http_url ?? null,
    http_host: partial.http_host ?? null,
    http_path: partial.http_path ?? null,
    http_query: partial.http_query ?? null,
    http_status: partial.http_status ?? null,
    http_protocol: partial.http_protocol ?? null,
    http_request_size: partial.http_request_size ?? null,
    http_response_size: partial.http_response_size ?? null,
    http_referrer: partial.http_referrer ?? null,
    http_user_agent: partial.http_user_agent ?? null,
    http_content_type: partial.http_content_type ?? null,

    // GeoLocation
    geo_country: partial.geo_country ?? null,
    geo_region: partial.geo_region ?? null,
    geo_city: partial.geo_city ?? null,
    geo_colo: partial.geo_colo ?? null,
    geo_timezone: partial.geo_timezone ?? null,
    geo_latitude: partial.geo_latitude ?? null,
    geo_longitude: partial.geo_longitude ?? null,
    geo_asn: partial.geo_asn ?? null,
    geo_as_org: partial.geo_as_org ?? null,
    geo_postal: partial.geo_postal ?? null,

    // ClientDevice
    client_type: partial.client_type ?? null,
    client_name: partial.client_name ?? null,
    client_version: partial.client_version ?? null,
    device_type: partial.device_type ?? null,
    device_model: partial.device_model ?? null,
    device_brand: partial.device_brand ?? null,
    os_name: partial.os_name ?? null,
    os_version: partial.os_version ?? null,
    bot_score: partial.bot_score ?? null,
    bot_verified: partial.bot_verified ?? null,
    screen_size: partial.screen_size ?? null,

    // ServiceInfra
    service_name: partial.service_name ?? null,
    service_version: partial.service_version ?? null,
    service_instance: partial.service_instance ?? null,
    service_namespace: partial.service_namespace ?? null,
    host_name: partial.host_name ?? null,
    host_id: partial.host_id ?? null,
    cloud_provider: partial.cloud_provider ?? null,
    cloud_region: partial.cloud_region ?? null,
    cloud_zone: partial.cloud_zone ?? null,
    container_id: partial.container_id ?? null,
    k8s_namespace: partial.k8s_namespace ?? null,
    k8s_pod: partial.k8s_pod ?? null,
    k8s_deployment: partial.k8s_deployment ?? null,

    // DatabaseCdc
    db_system: partial.db_system ?? null,
    db_name: partial.db_name ?? null,
    db_table: partial.db_table ?? null,
    db_operation: partial.db_operation ?? null,
    db_statement: partial.db_statement ?? null,
    db_row_id: partial.db_row_id ?? null,
    db_lsn: partial.db_lsn ?? null,
    db_version: partial.db_version ?? null,
    db_before: partial.db_before ?? null,
    db_after: partial.db_after ?? null,

    // MessagingQueue
    msg_system: partial.msg_system ?? null,
    msg_destination: partial.msg_destination ?? null,
    msg_operation: partial.msg_operation ?? null,
    msg_batch_size: partial.msg_batch_size ?? null,
    msg_message_id: partial.msg_message_id ?? null,

    // Rpc
    rpc_system: partial.rpc_system ?? null,
    rpc_service: partial.rpc_service ?? null,
    rpc_method: partial.rpc_method ?? null,
    rpc_status: partial.rpc_status ?? null,

    // WebMarketing
    page_title: partial.page_title ?? null,
    page_search: partial.page_search ?? null,
    campaign_name: partial.campaign_name ?? null,
    campaign_source: partial.campaign_source ?? null,
    campaign_medium: partial.campaign_medium ?? null,
    campaign_term: partial.campaign_term ?? null,
    campaign_content: partial.campaign_content ?? null,
    campaign_id: partial.campaign_id ?? null,
    ab_test_id: partial.ab_test_id ?? null,
    ab_variant: partial.ab_variant ?? null,

    // WebVitals
    vital_name: partial.vital_name ?? null,
    vital_value: partial.vital_value ?? null,
    vital_rating: partial.vital_rating ?? null,
    vital_delta: partial.vital_delta ?? null,
    vital_element: partial.vital_element ?? null,
    vital_load_state: partial.vital_load_state ?? null,
    nav_type: partial.nav_type ?? null,

    // SessionReplay
    replay_type: partial.replay_type ?? null,
    replay_source: partial.replay_source ?? null,
    replay_sequence: partial.replay_sequence ?? null,
    replay_timestamp_offset: partial.replay_timestamp_offset ?? null,
    replay_data: partial.replay_data ?? null,

    // OtelMetrics
    metric_name: partial.metric_name ?? null,
    metric_unit: partial.metric_unit ?? null,
    metric_type: partial.metric_type ?? null,
    metric_value: partial.metric_value ?? null,
    metric_count: partial.metric_count ?? null,
    metric_sum: partial.metric_sum ?? null,
    metric_min: partial.metric_min ?? null,
    metric_max: partial.metric_max ?? null,
    metric_buckets: partial.metric_buckets ?? null,
    metric_quantiles: partial.metric_quantiles ?? null,

    // Logging
    log_level: partial.log_level ?? null,
    log_level_num: partial.log_level_num ?? null,
    log_message: partial.log_message ?? null,
    log_logger: partial.log_logger ?? null,

    // DoSpecific
    do_class: partial.do_class ?? null,
    do_id: partial.do_id ?? null,
    do_method: partial.do_method ?? null,
    action_verb: partial.action_verb ?? null,
    action_durability: partial.action_durability ?? null,
    action_target: partial.action_target ?? null,
    action_input_version: partial.action_input_version ?? null,

    // BusinessEpcis
    biz_step: partial.biz_step ?? null,
    biz_disposition: partial.biz_disposition ?? null,
    biz_transaction: partial.biz_transaction ?? null,
    biz_location: partial.biz_location ?? null,
    biz_read_point: partial.biz_read_point ?? null,

    // SnippetProxy
    snippet_initiator: partial.snippet_initiator ?? null,
    snippet_request_id: partial.snippet_request_id ?? null,
    snippet_start_time: partial.snippet_start_time ?? null,
    snippet_dns_time: partial.snippet_dns_time ?? null,
    snippet_connect_time: partial.snippet_connect_time ?? null,
    snippet_ttfb: partial.snippet_ttfb ?? null,
    snippet_download_time: partial.snippet_download_time ?? null,
    snippet_blocked_time: partial.snippet_blocked_time ?? null,
    snippet_resource_type: partial.snippet_resource_type ?? null,
    snippet_transfer_size: partial.snippet_transfer_size ?? null,
    snippet_decoded_size: partial.snippet_decoded_size ?? null,
    snippet_cache_state: partial.snippet_cache_state ?? null,
    snippet_priority: partial.snippet_priority ?? null,

    // FlexiblePayloads
    data: partial.data ?? null,
    attributes: partial.attributes ?? null,
    labels: partial.labels ?? null,
    context: partial.context ?? null,
    properties: partial.properties ?? null,
    traits: partial.traits ?? null,

    // PartitionInternal
    hour: partial.hour ?? null,
    day: partial.day ?? null,
    event_source: partial.event_source ?? null,
    visibility: partial.visibility ?? null,
    ingested_at: partial.ingested_at ?? null,
    batch_id: partial.batch_id ?? null,
    schema_version: partial.schema_version ?? null,
  }
}

// ============================================================================
// Column Metadata
// ============================================================================

/**
 * Column type for schema definition.
 * Maps to SQL/Parquet/Iceberg types.
 */
export type ColumnType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'timestamp'
  | 'json'
  | 'bytes'
  | 'bigint'

/**
 * Column definition metadata.
 * Used for schema generation and validation.
 */
export interface ColumnDefinition {
  /** Column name (snake_case) */
  name: string
  /** Column data type */
  type: ColumnType
  /** Whether the column can be null */
  nullable: boolean
  /** Whether the column is used for partitioning */
  partition: boolean
}

/**
 * Complete column definitions for the unified event schema.
 * All 162 columns with their types and nullability.
 */
export const UNIFIED_COLUMNS: readonly ColumnDefinition[] = [
  // CoreIdentity (4)
  { name: 'id', type: 'string', nullable: false, partition: false },
  { name: 'event_type', type: 'string', nullable: false, partition: true },
  { name: 'event_name', type: 'string', nullable: false, partition: false },
  { name: 'ns', type: 'string', nullable: false, partition: true },

  // CausalityChain (11 - includes 3 graph columns)
  { name: 'trace_id', type: 'string', nullable: true, partition: false },
  { name: 'span_id', type: 'string', nullable: true, partition: false },
  { name: 'parent_id', type: 'string', nullable: true, partition: false },
  { name: 'root_id', type: 'string', nullable: true, partition: false },
  { name: 'session_id', type: 'string', nullable: true, partition: false },
  { name: 'workflow_id', type: 'string', nullable: true, partition: false },
  { name: 'transaction_id', type: 'string', nullable: true, partition: false },
  { name: 'correlation_id', type: 'string', nullable: true, partition: false },
  { name: 'depth', type: 'number', nullable: true, partition: false },
  { name: 'is_leaf', type: 'boolean', nullable: true, partition: false },
  { name: 'is_root', type: 'boolean', nullable: true, partition: false },

  // Actor (4)
  { name: 'actor_id', type: 'string', nullable: true, partition: false },
  { name: 'actor_type', type: 'string', nullable: true, partition: false },
  { name: 'actor_name', type: 'string', nullable: true, partition: false },
  { name: 'anonymous_id', type: 'string', nullable: true, partition: false },

  // Resource (5)
  { name: 'resource_type', type: 'string', nullable: true, partition: false },
  { name: 'resource_id', type: 'string', nullable: true, partition: false },
  { name: 'resource_name', type: 'string', nullable: true, partition: false },
  { name: 'resource_version', type: 'string', nullable: true, partition: false },
  { name: 'resource_ns', type: 'string', nullable: true, partition: false },

  // Timing (6)
  { name: 'timestamp', type: 'timestamp', nullable: true, partition: false },
  { name: 'timestamp_ns', type: 'bigint', nullable: true, partition: false },
  { name: 'started_at', type: 'timestamp', nullable: true, partition: false },
  { name: 'ended_at', type: 'timestamp', nullable: true, partition: false },
  { name: 'duration_ms', type: 'number', nullable: true, partition: false },
  { name: 'cpu_time_ms', type: 'number', nullable: true, partition: false },

  // Outcome (6)
  { name: 'outcome', type: 'string', nullable: true, partition: false },
  { name: 'outcome_reason', type: 'string', nullable: true, partition: false },
  { name: 'status_code', type: 'number', nullable: true, partition: false },
  { name: 'error_type', type: 'string', nullable: true, partition: false },
  { name: 'error_message', type: 'string', nullable: true, partition: false },
  { name: 'error_stack', type: 'string', nullable: true, partition: false },

  // HttpContext (12)
  { name: 'http_method', type: 'string', nullable: true, partition: false },
  { name: 'http_url', type: 'string', nullable: true, partition: false },
  { name: 'http_host', type: 'string', nullable: true, partition: false },
  { name: 'http_path', type: 'string', nullable: true, partition: false },
  { name: 'http_query', type: 'string', nullable: true, partition: false },
  { name: 'http_status', type: 'number', nullable: true, partition: false },
  { name: 'http_protocol', type: 'string', nullable: true, partition: false },
  { name: 'http_request_size', type: 'number', nullable: true, partition: false },
  { name: 'http_response_size', type: 'number', nullable: true, partition: false },
  { name: 'http_referrer', type: 'string', nullable: true, partition: false },
  { name: 'http_user_agent', type: 'string', nullable: true, partition: false },
  { name: 'http_content_type', type: 'string', nullable: true, partition: false },

  // GeoLocation (10)
  { name: 'geo_country', type: 'string', nullable: true, partition: false },
  { name: 'geo_region', type: 'string', nullable: true, partition: false },
  { name: 'geo_city', type: 'string', nullable: true, partition: false },
  { name: 'geo_colo', type: 'string', nullable: true, partition: false },
  { name: 'geo_timezone', type: 'string', nullable: true, partition: false },
  { name: 'geo_latitude', type: 'number', nullable: true, partition: false },
  { name: 'geo_longitude', type: 'number', nullable: true, partition: false },
  { name: 'geo_asn', type: 'number', nullable: true, partition: false },
  { name: 'geo_as_org', type: 'string', nullable: true, partition: false },
  { name: 'geo_postal', type: 'string', nullable: true, partition: false },

  // ClientDevice (11)
  { name: 'client_type', type: 'string', nullable: true, partition: false },
  { name: 'client_name', type: 'string', nullable: true, partition: false },
  { name: 'client_version', type: 'string', nullable: true, partition: false },
  { name: 'device_type', type: 'string', nullable: true, partition: false },
  { name: 'device_model', type: 'string', nullable: true, partition: false },
  { name: 'device_brand', type: 'string', nullable: true, partition: false },
  { name: 'os_name', type: 'string', nullable: true, partition: false },
  { name: 'os_version', type: 'string', nullable: true, partition: false },
  { name: 'bot_score', type: 'number', nullable: true, partition: false },
  { name: 'bot_verified', type: 'boolean', nullable: true, partition: false },
  { name: 'screen_size', type: 'string', nullable: true, partition: false },

  // ServiceInfra (13)
  { name: 'service_name', type: 'string', nullable: true, partition: false },
  { name: 'service_version', type: 'string', nullable: true, partition: false },
  { name: 'service_instance', type: 'string', nullable: true, partition: false },
  { name: 'service_namespace', type: 'string', nullable: true, partition: false },
  { name: 'host_name', type: 'string', nullable: true, partition: false },
  { name: 'host_id', type: 'string', nullable: true, partition: false },
  { name: 'cloud_provider', type: 'string', nullable: true, partition: false },
  { name: 'cloud_region', type: 'string', nullable: true, partition: false },
  { name: 'cloud_zone', type: 'string', nullable: true, partition: false },
  { name: 'container_id', type: 'string', nullable: true, partition: false },
  { name: 'k8s_namespace', type: 'string', nullable: true, partition: false },
  { name: 'k8s_pod', type: 'string', nullable: true, partition: false },
  { name: 'k8s_deployment', type: 'string', nullable: true, partition: false },

  // DatabaseCdc (10)
  { name: 'db_system', type: 'string', nullable: true, partition: false },
  { name: 'db_name', type: 'string', nullable: true, partition: false },
  { name: 'db_table', type: 'string', nullable: true, partition: false },
  { name: 'db_operation', type: 'string', nullable: true, partition: false },
  { name: 'db_statement', type: 'string', nullable: true, partition: false },
  { name: 'db_row_id', type: 'string', nullable: true, partition: false },
  { name: 'db_lsn', type: 'string', nullable: true, partition: false },
  { name: 'db_version', type: 'number', nullable: true, partition: false },
  { name: 'db_before', type: 'json', nullable: true, partition: false },
  { name: 'db_after', type: 'json', nullable: true, partition: false },

  // MessagingQueue (5)
  { name: 'msg_system', type: 'string', nullable: true, partition: false },
  { name: 'msg_destination', type: 'string', nullable: true, partition: false },
  { name: 'msg_operation', type: 'string', nullable: true, partition: false },
  { name: 'msg_batch_size', type: 'number', nullable: true, partition: false },
  { name: 'msg_message_id', type: 'string', nullable: true, partition: false },

  // Rpc (4)
  { name: 'rpc_system', type: 'string', nullable: true, partition: false },
  { name: 'rpc_service', type: 'string', nullable: true, partition: false },
  { name: 'rpc_method', type: 'string', nullable: true, partition: false },
  { name: 'rpc_status', type: 'string', nullable: true, partition: false },

  // WebMarketing (10)
  { name: 'page_title', type: 'string', nullable: true, partition: false },
  { name: 'page_search', type: 'string', nullable: true, partition: false },
  { name: 'campaign_name', type: 'string', nullable: true, partition: false },
  { name: 'campaign_source', type: 'string', nullable: true, partition: false },
  { name: 'campaign_medium', type: 'string', nullable: true, partition: false },
  { name: 'campaign_term', type: 'string', nullable: true, partition: false },
  { name: 'campaign_content', type: 'string', nullable: true, partition: false },
  { name: 'campaign_id', type: 'string', nullable: true, partition: false },
  { name: 'ab_test_id', type: 'string', nullable: true, partition: false },
  { name: 'ab_variant', type: 'string', nullable: true, partition: false },

  // WebVitals (7)
  { name: 'vital_name', type: 'string', nullable: true, partition: false },
  { name: 'vital_value', type: 'number', nullable: true, partition: false },
  { name: 'vital_rating', type: 'string', nullable: true, partition: false },
  { name: 'vital_delta', type: 'number', nullable: true, partition: false },
  { name: 'vital_element', type: 'string', nullable: true, partition: false },
  { name: 'vital_load_state', type: 'string', nullable: true, partition: false },
  { name: 'nav_type', type: 'string', nullable: true, partition: false },

  // SessionReplay (5)
  { name: 'replay_type', type: 'string', nullable: true, partition: false },
  { name: 'replay_source', type: 'string', nullable: true, partition: false },
  { name: 'replay_sequence', type: 'number', nullable: true, partition: false },
  { name: 'replay_timestamp_offset', type: 'number', nullable: true, partition: false },
  { name: 'replay_data', type: 'bytes', nullable: true, partition: false },

  // OtelMetrics (10)
  { name: 'metric_name', type: 'string', nullable: true, partition: false },
  { name: 'metric_unit', type: 'string', nullable: true, partition: false },
  { name: 'metric_type', type: 'string', nullable: true, partition: false },
  { name: 'metric_value', type: 'number', nullable: true, partition: false },
  { name: 'metric_count', type: 'number', nullable: true, partition: false },
  { name: 'metric_sum', type: 'number', nullable: true, partition: false },
  { name: 'metric_min', type: 'number', nullable: true, partition: false },
  { name: 'metric_max', type: 'number', nullable: true, partition: false },
  { name: 'metric_buckets', type: 'json', nullable: true, partition: false },
  { name: 'metric_quantiles', type: 'json', nullable: true, partition: false },

  // Logging (4)
  { name: 'log_level', type: 'string', nullable: true, partition: false },
  { name: 'log_level_num', type: 'number', nullable: true, partition: false },
  { name: 'log_message', type: 'string', nullable: true, partition: false },
  { name: 'log_logger', type: 'string', nullable: true, partition: false },

  // DoSpecific (7)
  { name: 'do_class', type: 'string', nullable: true, partition: false },
  { name: 'do_id', type: 'string', nullable: true, partition: false },
  { name: 'do_method', type: 'string', nullable: true, partition: false },
  { name: 'action_verb', type: 'string', nullable: true, partition: false },
  { name: 'action_durability', type: 'string', nullable: true, partition: false },
  { name: 'action_target', type: 'string', nullable: true, partition: false },
  { name: 'action_input_version', type: 'number', nullable: true, partition: false },

  // BusinessEpcis (5)
  { name: 'biz_step', type: 'string', nullable: true, partition: false },
  { name: 'biz_disposition', type: 'string', nullable: true, partition: false },
  { name: 'biz_transaction', type: 'string', nullable: true, partition: false },
  { name: 'biz_location', type: 'string', nullable: true, partition: false },
  { name: 'biz_read_point', type: 'string', nullable: true, partition: false },

  // SnippetProxy (13)
  { name: 'snippet_initiator', type: 'string', nullable: true, partition: false },
  { name: 'snippet_request_id', type: 'string', nullable: true, partition: false },
  { name: 'snippet_start_time', type: 'number', nullable: true, partition: false },
  { name: 'snippet_dns_time', type: 'number', nullable: true, partition: false },
  { name: 'snippet_connect_time', type: 'number', nullable: true, partition: false },
  { name: 'snippet_ttfb', type: 'number', nullable: true, partition: false },
  { name: 'snippet_download_time', type: 'number', nullable: true, partition: false },
  { name: 'snippet_blocked_time', type: 'number', nullable: true, partition: false },
  { name: 'snippet_resource_type', type: 'string', nullable: true, partition: false },
  { name: 'snippet_transfer_size', type: 'number', nullable: true, partition: false },
  { name: 'snippet_decoded_size', type: 'number', nullable: true, partition: false },
  { name: 'snippet_cache_state', type: 'string', nullable: true, partition: false },
  { name: 'snippet_priority', type: 'string', nullable: true, partition: false },

  // FlexiblePayloads (6)
  { name: 'data', type: 'json', nullable: true, partition: false },
  { name: 'attributes', type: 'json', nullable: true, partition: false },
  { name: 'labels', type: 'json', nullable: true, partition: false },
  { name: 'context', type: 'json', nullable: true, partition: false },
  { name: 'properties', type: 'json', nullable: true, partition: false },
  { name: 'traits', type: 'json', nullable: true, partition: false },

  // PartitionInternal (7)
  { name: 'hour', type: 'number', nullable: true, partition: true },
  { name: 'day', type: 'string', nullable: true, partition: true },
  { name: 'event_source', type: 'string', nullable: true, partition: false },
  { name: 'visibility', type: 'string', nullable: true, partition: false },
  { name: 'ingested_at', type: 'timestamp', nullable: true, partition: false },
  { name: 'batch_id', type: 'string', nullable: true, partition: false },
  { name: 'schema_version', type: 'number', nullable: true, partition: false },
] as const

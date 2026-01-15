# Unified Events Schema Reference

A comprehensive 165-column event schema organized into 23 semantic groups, designed for unified observability across traces, metrics, logs, CDC, analytics, and browser instrumentation data.

## Overview

The Unified Event Schema provides a single, consistent data model for all observability data in dotdo. Rather than maintaining separate schemas for traces, logs, metrics, and analytics events, all data flows through a single wide schema where each event type populates the columns relevant to it.

**Total Columns:** 165
**Semantic Groups:** 23
**Source:** [`types/unified-event.ts`](/types/unified-event.ts)

### Event Types

| Type | Description | Primary Groups Used |
|------|-------------|---------------------|
| `trace` | Distributed tracing spans (OpenTelemetry compatible) | CoreIdentity, CausalityChain, Timing, HttpContext, ServiceInfra |
| `metric` | OTEL metrics (gauge, counter, histogram) | CoreIdentity, Timing, OtelMetrics, ServiceInfra |
| `log` | Structured log entries | CoreIdentity, Timing, Logging, ServiceInfra |
| `cdc` | Change data capture from databases | CoreIdentity, Timing, DatabaseCdc, Resource |
| `track` | User action tracking (Segment-style) | CoreIdentity, Actor, Resource, WebMarketing |
| `page` | Page view events | CoreIdentity, Actor, HttpContext, WebMarketing |
| `vital` | Web Vitals performance metrics | CoreIdentity, WebVitals, ClientDevice |
| `replay` | Session replay data | CoreIdentity, SessionReplay, CausalityChain |
| `tail` | Workers tail/real-time log events | CoreIdentity, Timing, ServiceInfra |
| `snippet` | Browser snippet proxy timing data | CoreIdentity, SnippetProxy, HttpContext |

---

## 1. Core Identity (4 columns)

The only required fields in every event. These uniquely identify and classify each event.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `id` | string | No | Unique event identifier (UUID or ULID) | `"01HX7J9K2M3N4P5Q6R7S8T9U0V"` |
| `event_type` | string | No | Event type classification (partition key) | `"trace"`, `"metric"`, `"log"` |
| `event_name` | string | No | Semantic event name | `"http.request"`, `"user.signup"` |
| `ns` | string | No | Namespace URL identifying the event source (partition key) | `"https://api.example.com"` |

**Usage Notes:**
- `id` should be globally unique; ULIDs are preferred for time-sortable ordering
- `event_type` determines which other column groups are populated
- `event_name` follows the `noun.verb` convention (e.g., `Customer.created`, `http.request`)
- `ns` enables multi-tenant separation and is used as a partition key

---

## 2. Causality Chain (11 columns)

Causality and correlation fields for distributed tracing. All nullable to support events that don't participate in traces.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `trace_id` | string | Yes | W3C trace ID (32 hex chars) | `"4bf92f3577b34da6a3ce929d0e0e4736"` |
| `span_id` | string | Yes | Span ID within the trace (16 hex chars) | `"00f067aa0ba902b7"` |
| `parent_id` | string | Yes | Parent span ID for hierarchical traces | `"00f067aa0ba902b7"` |
| `root_id` | string | Yes | Root span ID (first span in trace) | `"00f067aa0ba902b7"` |
| `session_id` | string | Yes | User session identifier | `"sess_abc123"` |
| `workflow_id` | string | Yes | Workflow execution ID for durable workflows | `"wf_xyz789"` |
| `transaction_id` | string | Yes | Database/business transaction ID | `"txn_456def"` |
| `correlation_id` | string | Yes | Custom correlation ID for cross-system linking | `"req-12345"` |
| `depth` | number | Yes | Graph depth (0 = root, 1 = direct child, etc.) - computed for fast queries | `0`, `1`, `2` |
| `is_leaf` | boolean | Yes | True if this span has no children - computed for fast leaf queries | `true`, `false` |
| `is_root` | boolean | Yes | True if this span has no parent_id - computed for fast root queries | `true`, `false` |

**Usage Notes:**
- `trace_id` and `span_id` follow W3C Trace Context standard
- `depth`, `is_leaf`, and `is_root` are computed fields to optimize trace visualization queries
- `workflow_id` links to dotdo's durable workflow executions
- Multiple correlation IDs can coexist (session, workflow, transaction) for different contexts

---

## 3. Actor (4 columns)

Actor identification fields. Tracks who or what triggered the event.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `actor_id` | string | Yes | Authenticated user/agent identifier | `"usr_12345"`, `"agent_priya"` |
| `actor_type` | string | Yes | Actor type classification | `"user"`, `"agent"`, `"system"`, `"webhook"` |
| `actor_name` | string | Yes | Human-readable actor name | `"Alice Smith"`, `"Priya"` |
| `anonymous_id` | string | Yes | Anonymous/device identifier for unauthenticated actors | `"anon_abc123"` |

**Usage Notes:**
- Either `actor_id` or `anonymous_id` should be present for user-initiated events
- `actor_type` enables filtering by actor category (human users vs. AI agents vs. system processes)
- Segment-style events use both `actor_id` (userId) and `anonymous_id` (anonymousId)

---

## 4. Resource (5 columns)

Resource identification fields. Describes the entity being acted upon.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `resource_type` | string | Yes | Resource type (Thing type in dotdo) | `"Customer"`, `"Order"`, `"Thing"` |
| `resource_id` | string | Yes | Resource identifier | `"cust_12345"`, `"ord_67890"` |
| `resource_name` | string | Yes | Human-readable resource name | `"Alice's Order"` |
| `resource_version` | string | Yes | Resource version or revision | `"v3"`, `"2024-01-15T10:30:00Z"` |
| `resource_ns` | string | Yes | Resource namespace (for multi-tenant) | `"tenant-acme"` |

**Usage Notes:**
- Maps directly to dotdo's Thing model (`$type`, `$id`, `$name`, `$version`)
- `resource_ns` enables cross-tenant resource references
- Version can be semantic version, timestamp, or revision number

---

## 5. Timing (6 columns)

Timestamp and duration fields. Supports both ISO timestamps and nanosecond precision.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `timestamp` | timestamp | Yes | ISO 8601 timestamp when event occurred | `"2024-01-15T10:30:00.000Z"` |
| `timestamp_ns` | bigint | Yes | Nanosecond precision timestamp (for high-resolution timing) | `1705315800000000000n` |
| `started_at` | timestamp | Yes | ISO 8601 timestamp when operation started | `"2024-01-15T10:30:00.000Z"` |
| `ended_at` | timestamp | Yes | ISO 8601 timestamp when operation ended | `"2024-01-15T10:30:00.150Z"` |
| `duration_ms` | number | Yes | Duration in milliseconds | `150.5` |
| `cpu_time_ms` | number | Yes | CPU time consumed in milliseconds | `45.2` |

**Usage Notes:**
- `timestamp_ns` provides nanosecond precision for high-resolution tracing
- For spans, use `started_at`/`ended_at` pair; for point-in-time events, use `timestamp`
- `cpu_time_ms` is particularly relevant for Cloudflare Workers billing analysis

---

## 6. Outcome (6 columns)

Outcome and error information fields. Captures success/failure status and error details.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `outcome` | string | Yes | Outcome classification | `"success"`, `"failure"`, `"error"`, `"timeout"` |
| `outcome_reason` | string | Yes | Human-readable outcome reason | `"Rate limit exceeded"` |
| `status_code` | number | Yes | HTTP/gRPC status code | `200`, `404`, `500` |
| `error_type` | string | Yes | Error type/class name | `"ValidationError"`, `"TimeoutError"` |
| `error_message` | string | Yes | Error message | `"Invalid email format"` |
| `error_stack` | string | Yes | Error stack trace | `"Error: Invalid email\n  at validate..."` |

**Usage Notes:**
- `outcome` provides a normalized success/failure classification
- `status_code` can be HTTP status, gRPC status code, or custom status
- Error fields are populated only when `outcome` indicates failure/error

---

## 7. HTTP Context (12 columns)

HTTP request/response context fields. Captures full HTTP transaction details.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `http_method` | string | Yes | HTTP method | `"GET"`, `"POST"`, `"PUT"`, `"DELETE"` |
| `http_url` | string | Yes | Full request URL | `"https://api.example.com/users?page=1"` |
| `http_host` | string | Yes | Request host header | `"api.example.com"` |
| `http_path` | string | Yes | URL path (without query string) | `"/users"` |
| `http_query` | string | Yes | URL query string | `"page=1&limit=10"` |
| `http_status` | number | Yes | HTTP response status code | `200`, `201`, `404` |
| `http_protocol` | string | Yes | HTTP protocol version | `"HTTP/1.1"`, `"HTTP/2"`, `"HTTP/3"` |
| `http_request_size` | number | Yes | Request body size in bytes | `1024` |
| `http_response_size` | number | Yes | Response body size in bytes | `4096` |
| `http_referrer` | string | Yes | Referrer URL | `"https://example.com/dashboard"` |
| `http_user_agent` | string | Yes | User agent string | `"Mozilla/5.0..."` |
| `http_content_type` | string | Yes | Content-Type header | `"application/json"` |

**Usage Notes:**
- Follows OpenTelemetry HTTP semantic conventions
- `http_url` should be the full URL; use `http_path` for routing analysis
- Size fields are useful for bandwidth analysis and cost optimization

---

## 8. Geo Location (10 columns)

Geographic location fields. Derived from IP geolocation or explicit coordinates.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `geo_country` | string | Yes | ISO 3166-1 alpha-2 country code | `"US"`, `"GB"`, `"JP"` |
| `geo_region` | string | Yes | ISO 3166-2 region/state code | `"CA"`, `"TX"`, `"NY"` |
| `geo_city` | string | Yes | City name | `"San Francisco"`, `"London"` |
| `geo_colo` | string | Yes | Cloudflare colo code (3-letter airport code) | `"SFO"`, `"LHR"`, `"NRT"` |
| `geo_timezone` | string | Yes | IANA timezone identifier | `"America/Los_Angeles"` |
| `geo_latitude` | number | Yes | Latitude coordinate | `37.7749` |
| `geo_longitude` | number | Yes | Longitude coordinate | `-122.4194` |
| `geo_asn` | number | Yes | Autonomous System Number | `13335` |
| `geo_as_org` | string | Yes | Autonomous System Organization name | `"Cloudflare, Inc."` |
| `geo_postal` | string | Yes | Postal/ZIP code | `"94102"`, `"SW1A 1AA"` |

**Usage Notes:**
- `geo_colo` is populated automatically by Cloudflare Workers
- Coordinates enable geo-fencing and distance calculations
- ASN/AS Org help identify ISPs and potential bot traffic

---

## 9. Client Device (11 columns)

Client and device identification fields. Captures browser/app and device information.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `client_type` | string | Yes | Client type classification | `"browser"`, `"mobile_app"`, `"sdk"`, `"cli"` |
| `client_name` | string | Yes | Client/browser name | `"Chrome"`, `"Safari"`, `"Firefox"` |
| `client_version` | string | Yes | Client/browser version | `"120.0.6099.109"` |
| `device_type` | string | Yes | Device type classification | `"desktop"`, `"mobile"`, `"tablet"`, `"tv"` |
| `device_model` | string | Yes | Device model | `"iPhone 15 Pro"`, `"Pixel 8"` |
| `device_brand` | string | Yes | Device brand/manufacturer | `"Apple"`, `"Google"`, `"Samsung"` |
| `os_name` | string | Yes | Operating system name | `"macOS"`, `"Windows"`, `"iOS"`, `"Android"` |
| `os_version` | string | Yes | Operating system version | `"14.2.1"`, `"11"` |
| `bot_score` | number | Yes | Bot detection score (0-100) | `0` (human), `95` (likely bot) |
| `bot_verified` | boolean | Yes | Whether bot is verified (known good bot) | `true` (Googlebot), `false` |
| `screen_size` | string | Yes | Screen resolution | `"1920x1080"`, `"390x844"` |

**Usage Notes:**
- Parsed from User-Agent string or provided by mobile SDKs
- `bot_score` is provided by Cloudflare Bot Management
- `bot_verified` indicates legitimate crawlers like Googlebot

---

## 10. Service Infrastructure (13 columns)

Service and infrastructure context fields. Identifies the service, host, and deployment context.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `service_name` | string | Yes | Service/application name | `"api-gateway"`, `"user-service"` |
| `service_version` | string | Yes | Service version/build | `"1.2.3"`, `"abc123"` |
| `service_instance` | string | Yes | Service instance identifier | `"api-gateway-7f8d9"` |
| `service_namespace` | string | Yes | Service namespace (environment, stage) | `"production"`, `"staging"` |
| `host_name` | string | Yes | Host name | `"worker-1.example.com"` |
| `host_id` | string | Yes | Host identifier | `"i-0abc123def456"` |
| `cloud_provider` | string | Yes | Cloud provider | `"cloudflare"`, `"aws"`, `"gcp"`, `"azure"` |
| `cloud_region` | string | Yes | Cloud region | `"us-west-2"`, `"eu-west-1"` |
| `cloud_zone` | string | Yes | Cloud availability zone | `"us-west-2a"` |
| `container_id` | string | Yes | Container/worker ID | `"container-abc123"` |
| `k8s_namespace` | string | Yes | Kubernetes namespace | `"default"`, `"production"` |
| `k8s_pod` | string | Yes | Kubernetes pod name | `"api-gateway-7f8d9c-abc12"` |
| `k8s_deployment` | string | Yes | Kubernetes deployment name | `"api-gateway"` |

**Usage Notes:**
- Follows OpenTelemetry resource semantic conventions
- For Cloudflare Workers, `container_id` maps to the worker instance
- `service_namespace` is distinct from `resource_ns` (environment vs. tenant)

---

## 11. Database CDC (10 columns)

Database and CDC (Change Data Capture) fields. Captures database operations and change events.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `db_system` | string | Yes | Database system | `"postgres"`, `"mysql"`, `"sqlite"` |
| `db_name` | string | Yes | Database name | `"users_db"`, `"orders"` |
| `db_table` | string | Yes | Table/collection name | `"customers"`, `"orders"` |
| `db_operation` | string | Yes | Operation type | `"insert"`, `"update"`, `"delete"`, `"select"` |
| `db_statement` | string | Yes | SQL statement (sanitized - no sensitive data) | `"SELECT * FROM customers WHERE id = ?"` |
| `db_row_id` | string | Yes | Row/document identifier | `"row_123"`, `"doc_abc"` |
| `db_lsn` | string | Yes | Log sequence number (for CDC ordering) | `"0/16B3748"` |
| `db_version` | number | Yes | Row version for optimistic concurrency | `5` |
| `db_before` | json | Yes | JSON snapshot of row before change | `{"name": "Alice", "status": "pending"}` |
| `db_after` | json | Yes | JSON snapshot of row after change | `{"name": "Alice", "status": "active"}` |

**Usage Notes:**
- `db_before`/`db_after` enable full change replay and audit trails
- `db_lsn` is critical for CDC ordering and exactly-once processing
- `db_statement` should be parameterized (no actual values) for security

---

## 12. Messaging Queue (5 columns)

Messaging and queue fields. Captures message broker operations.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `msg_system` | string | Yes | Messaging system | `"kafka"`, `"rabbitmq"`, `"sqs"`, `"cloudflare_queues"` |
| `msg_destination` | string | Yes | Queue/topic/channel name | `"orders-queue"`, `"user-events"` |
| `msg_operation` | string | Yes | Messaging operation | `"publish"`, `"consume"`, `"ack"`, `"nack"` |
| `msg_batch_size` | number | Yes | Batch size for bulk operations | `100` |
| `msg_message_id` | string | Yes | Message identifier | `"msg_xyz789"` |

**Usage Notes:**
- Follows OpenTelemetry messaging semantic conventions
- `msg_batch_size` is relevant for batch consumers
- Links to trace context via `trace_id`/`span_id` for end-to-end tracing

---

## 13. RPC (4 columns)

RPC (Remote Procedure Call) fields. Captures gRPC, Cap'n Proto, and other RPC details.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `rpc_system` | string | Yes | RPC system | `"grpc"`, `"capnproto"`, `"thrift"` |
| `rpc_service` | string | Yes | RPC service name | `"UserService"`, `"OrderService"` |
| `rpc_method` | string | Yes | RPC method name | `"GetUser"`, `"CreateOrder"` |
| `rpc_status` | string | Yes | RPC status | `"ok"`, `"cancelled"`, `"deadline_exceeded"` |

**Usage Notes:**
- dotdo uses Cap'n Proto RPC for DO-to-DO communication
- `rpc_status` follows gRPC status code naming conventions
- Enables RPC performance analysis across service boundaries

---

## 14. Web Marketing (10 columns)

Web analytics and marketing attribution fields. UTM parameters and A/B test tracking.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `page_title` | string | Yes | Page title | `"Dashboard - MyApp"` |
| `page_search` | string | Yes | Search query on page | `"running shoes"` |
| `campaign_name` | string | Yes | UTM campaign name | `"summer_sale_2024"` |
| `campaign_source` | string | Yes | UTM campaign source | `"google"`, `"facebook"`, `"email"` |
| `campaign_medium` | string | Yes | UTM campaign medium | `"cpc"`, `"social"`, `"email"` |
| `campaign_term` | string | Yes | UTM campaign term | `"running+shoes"` |
| `campaign_content` | string | Yes | UTM campaign content | `"banner_v2"` |
| `campaign_id` | string | Yes | Campaign identifier | `"camp_abc123"` |
| `ab_test_id` | string | Yes | A/B test identifier | `"test_checkout_flow"` |
| `ab_variant` | string | Yes | A/B test variant assignment | `"control"`, `"variant_a"` |

**Usage Notes:**
- UTM parameters are extracted from URL query strings
- Enables full marketing attribution and conversion tracking
- A/B test fields support experiment analysis

---

## 15. Web Vitals (7 columns)

Web Vitals performance metrics fields. Core Web Vitals (LCP, FID, CLS) and others.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `vital_name` | string | Yes | Vital metric name | `"LCP"`, `"FID"`, `"CLS"`, `"TTFB"`, `"FCP"`, `"INP"` |
| `vital_value` | number | Yes | Vital metric value | `2500` (LCP in ms), `0.1` (CLS) |
| `vital_rating` | string | Yes | Vital rating | `"good"`, `"needs-improvement"`, `"poor"` |
| `vital_delta` | number | Yes | Delta from previous measurement | `100` |
| `vital_element` | string | Yes | DOM element associated with the metric | `"img.hero-image"` |
| `vital_load_state` | string | Yes | Page load state when metric was captured | `"loading"`, `"complete"` |
| `nav_type` | string | Yes | Navigation type | `"navigate"`, `"reload"`, `"back_forward"`, `"prerender"` |

**Usage Notes:**
- Follows web-vitals library conventions
- `vital_rating` thresholds follow Google's Core Web Vitals guidelines
- `vital_element` helps identify which DOM elements cause performance issues

---

## 16. Session Replay (5 columns)

Session replay recording fields. Captures DOM mutations, input events, and network activity.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `replay_type` | string | Yes | Replay event type | `"mutation"`, `"input"`, `"scroll"`, `"network"` |
| `replay_source` | string | Yes | Replay source library | `"rrweb"`, `"custom"` |
| `replay_sequence` | number | Yes | Sequence number within session | `1`, `2`, `3` |
| `replay_timestamp_offset` | number | Yes | Milliseconds since session start | `5000` |
| `replay_data` | bytes | Yes | Encoded replay data (JSON or binary) | (binary data) |

**Usage Notes:**
- Compatible with rrweb session replay format
- `replay_sequence` ensures correct event ordering during playback
- `replay_data` is typically compressed for storage efficiency

---

## 17. OTEL Metrics (10 columns)

OpenTelemetry metrics fields. Supports gauge, counter, and histogram metric types.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `metric_name` | string | Yes | Metric name | `"http.server.duration"`, `"process.cpu.usage"` |
| `metric_unit` | string | Yes | Metric unit | `"ms"`, `"bytes"`, `"requests"`, `"1"` |
| `metric_type` | string | Yes | Metric type | `"gauge"`, `"counter"`, `"histogram"` |
| `metric_value` | number | Yes | Metric value (for gauge/counter) | `150.5` |
| `metric_count` | number | Yes | Sample count (for histogram) | `1000` |
| `metric_sum` | number | Yes | Sum of samples (for histogram) | `150000` |
| `metric_min` | number | Yes | Minimum value (for histogram) | `10` |
| `metric_max` | number | Yes | Maximum value (for histogram) | `500` |
| `metric_buckets` | json | Yes | Histogram bucket boundaries and counts | `{"0":10, "100":50, "500":100}` |
| `metric_quantiles` | json | Yes | Quantile values | `{"p50":100, "p95":250, "p99":450}` |

**Usage Notes:**
- Follows OpenTelemetry Metrics specification
- `metric_unit` uses UCUM conventions where applicable
- Histogram data includes both bucket counts and computed quantiles

---

## 18. Logging (4 columns)

Structured logging fields. Compatible with common logging frameworks.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `log_level` | string | Yes | Log level name | `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"` |
| `log_level_num` | number | Yes | Numeric log level (for filtering) | `10` (debug), `20` (info), `40` (error) |
| `log_message` | string | Yes | Log message | `"User login successful"` |
| `log_logger` | string | Yes | Logger name/category | `"auth.login"`, `"db.query"` |

**Usage Notes:**
- `log_level_num` enables numeric comparisons (e.g., "show errors and above")
- Numeric levels follow syslog convention: debug=10, info=20, warn=30, error=40, fatal=50
- Additional structured data goes in the `data` flexible payload field

---

## 19. DO Specific (7 columns)

Durable Object specific fields. Captures DO class, method, and action context.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `do_class` | string | Yes | Durable Object class name | `"DO"`, `"CustomerDO"` |
| `do_id` | string | Yes | Durable Object instance ID | `"do_abc123"` |
| `do_method` | string | Yes | DO method being invoked | `"fetch"`, `"alarm"`, `"things.create"` |
| `action_verb` | string | Yes | Action verb (Noun.verb pattern) | `"create"`, `"update"`, `"delete"` |
| `action_durability` | string | Yes | Action durability level | `"send"`, `"try"`, `"do"` |
| `action_target` | string | Yes | Action target identifier | `"Customer:cust_123"` |
| `action_input_version` | number | Yes | Input version for optimistic concurrency | `5` |

**Usage Notes:**
- Specific to dotdo's Durable Object runtime
- `action_durability` maps to `$.send()`, `$.try()`, `$.do()` APIs
- Enables analysis of DO method invocations and action patterns

---

## 20. Business EPCIS (5 columns)

Business process fields (EPCIS-compatible). Tracks business steps, disposition, and transactions.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `biz_step` | string | Yes | Business step | `"shipping"`, `"receiving"`, `"commissioning"` |
| `biz_disposition` | string | Yes | Disposition/status of object | `"in_transit"`, `"sold"`, `"returned"` |
| `biz_transaction` | string | Yes | Business transaction reference | `"po:12345"`, `"inv:67890"` |
| `biz_location` | string | Yes | Business location (URN or identifier) | `"urn:epc:id:sgln:0614141.00001.0"` |
| `biz_read_point` | string | Yes | Read point where event was captured | `"urn:epc:id:sgln:0614141.00002.0"` |

**Usage Notes:**
- Compatible with GS1 EPCIS standard for supply chain visibility
- Enables tracking of physical goods through business processes
- `biz_step` and `biz_disposition` use CBV (Core Business Vocabulary) values

---

## 21. Snippet Proxy (13 columns)

Browser snippet and resource timing fields. Captures network request timing from the browser.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `snippet_initiator` | string | Yes | Request initiator | `"link"`, `"script"`, `"fetch"`, `"xmlhttprequest"` |
| `snippet_request_id` | string | Yes | Request identifier | `"req_abc123"` |
| `snippet_start_time` | number | Yes | Request start time (performance.now()) | `1500.5` |
| `snippet_dns_time` | number | Yes | DNS lookup time in ms | `5.2` |
| `snippet_connect_time` | number | Yes | Connection time in ms | `15.3` |
| `snippet_ttfb` | number | Yes | Time to first byte in ms | `50.7` |
| `snippet_download_time` | number | Yes | Download time in ms | `100.5` |
| `snippet_blocked_time` | number | Yes | Time blocked waiting for connection | `2.1` |
| `snippet_resource_type` | string | Yes | Resource type | `"document"`, `"script"`, `"stylesheet"`, `"image"` |
| `snippet_transfer_size` | number | Yes | Transfer size in bytes | `15000` |
| `snippet_decoded_size` | number | Yes | Decoded/uncompressed size in bytes | `45000` |
| `snippet_cache_state` | string | Yes | Cache state | `"hit"`, `"miss"`, `"conditional"` |
| `snippet_priority` | string | Yes | Resource priority | `"high"`, `"medium"`, `"low"` |

**Usage Notes:**
- Captured via Performance Resource Timing API
- Enables real-user monitoring (RUM) of resource loading
- `snippet_cache_state` helps analyze CDN and browser cache effectiveness

---

## 22. Flexible Payloads (6 columns)

Flexible payload fields for custom data. Supports arbitrary JSON data in various structures.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `data` | json | Yes | Primary event data payload | `{"orderId": "123", "amount": 99.99}` |
| `attributes` | json | Yes | Resource attributes (OTEL semantic conventions) | `{"http.method": "GET"}` |
| `labels` | json | Yes | String labels/tags for filtering | `{"env": "prod", "team": "platform"}` |
| `context` | json | Yes | Additional context data | `{"feature_flags": {"new_checkout": true}}` |
| `properties` | json | Yes | Segment-style properties | `{"productId": "sku_123"}` |
| `traits` | json | Yes | User traits (Segment-style) | `{"plan": "enterprise", "company": "Acme"}` |

**Usage Notes:**
- Use `data` for event-specific structured data
- Use `attributes` for OpenTelemetry resource/span attributes
- Use `labels` for string-only tags (efficient for filtering)
- Use `properties`/`traits` for Segment-compatible analytics

---

## 23. Partition Internal (7 columns)

Internal partition and metadata fields. Used for data management and schema evolution.

| Column | Type | Nullable | Description | Example |
|--------|------|----------|-------------|---------|
| `hour` | number | Yes | Hour of day (0-23) for hourly partitioning | `14` |
| `day` | string | Yes | Date string (YYYY-MM-DD) for daily partitioning | `"2024-01-15"` |
| `event_source` | string | Yes | Event source system identifier | `"api-gateway"`, `"browser-sdk"` |
| `visibility` | string | Yes | Visibility level | `"public"`, `"internal"`, `"debug"` |
| `ingested_at` | timestamp | Yes | ISO timestamp when event was ingested | `"2024-01-15T10:30:05.000Z"` |
| `batch_id` | string | Yes | Batch identifier for bulk ingestion | `"batch_xyz789"` |
| `schema_version` | number | Yes | Schema version number | `1` |

**Usage Notes:**
- `hour` and `day` are partition keys for time-based partitioning
- `ingested_at` differs from `timestamp` (event time vs. ingestion time)
- `schema_version` enables schema evolution and backwards compatibility
- `visibility` controls data retention and access policies

---

## Column Summary

| Group | Columns | Required | Description |
|-------|---------|----------|-------------|
| 1. Core Identity | 4 | Yes | Unique identification and classification |
| 2. Causality Chain | 11 | No | Distributed tracing and correlation |
| 3. Actor | 4 | No | Who triggered the event |
| 4. Resource | 5 | No | What was acted upon |
| 5. Timing | 6 | No | When it happened and how long |
| 6. Outcome | 6 | No | Success/failure and errors |
| 7. HTTP Context | 12 | No | HTTP request/response details |
| 8. Geo Location | 10 | No | Geographic information |
| 9. Client Device | 11 | No | Browser/device details |
| 10. Service Infra | 13 | No | Service and deployment context |
| 11. Database CDC | 10 | No | Database change capture |
| 12. Messaging Queue | 5 | No | Message broker operations |
| 13. RPC | 4 | No | Remote procedure calls |
| 14. Web Marketing | 10 | No | Analytics and attribution |
| 15. Web Vitals | 7 | No | Performance metrics |
| 16. Session Replay | 5 | No | Session recording data |
| 17. OTEL Metrics | 10 | No | OpenTelemetry metrics |
| 18. Logging | 4 | No | Structured log entries |
| 19. DO Specific | 7 | No | Durable Object context |
| 20. Business EPCIS | 5 | No | Business process tracking |
| 21. Snippet Proxy | 13 | No | Browser resource timing |
| 22. Flexible Payloads | 6 | No | Custom JSON data |
| 23. Partition Internal | 7 | No | Data management metadata |
| **Total** | **165** | | |

---

## Type Reference

| Type | SQL Equivalent | Description |
|------|---------------|-------------|
| `string` | TEXT | Variable-length text |
| `number` | REAL | Floating-point number |
| `boolean` | INTEGER (0/1) | Boolean flag |
| `timestamp` | TEXT (ISO 8601) | ISO 8601 timestamp string |
| `bigint` | INTEGER | 64-bit integer (for nanoseconds) |
| `json` | TEXT (JSON) | JSON-encoded object or array |
| `bytes` | BLOB | Binary data |

---

## Partition Keys

The following columns are used for data partitioning:

| Column | Partition Use |
|--------|---------------|
| `event_type` | Primary partition by event type |
| `ns` | Secondary partition by namespace/tenant |
| `hour` | Hourly time-based partitioning |
| `day` | Daily time-based partitioning |

---

## Related Documentation

- [Unified Event Types](/types/unified-event.ts) - TypeScript type definitions
- [Event Streaming](/docs/streaming/) - Event ingestion and processing
- [Observability](/docs/observability/) - Tracing, metrics, and logging

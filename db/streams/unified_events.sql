-- ============================================================================
-- UNIFIED EVENTS PIPELINE - Cloudflare Pipeline SQL Transform
-- ============================================================================
--
-- Transforms incoming unified events to R2 Iceberg format.
-- Produces 172 columns organized into 23 semantic groups.
--
-- Transformations:
-- 1. resource_id: Qualified with namespace (ns/id) if not already qualified
-- 2. resource_ns: Falls back to ns if null
-- 3. day: Derived from timestamp (YYYY-MM-DD format)
-- 4. hour: Derived from timestamp (0-23 integer)
-- 5. visibility: Defaults to 'user' if null
-- 6. ingested_at: Set to current timestamp
-- 7. schema_version: Set to 1
--
-- Source: unified_events_stream (Cloudflare Pipeline input)
-- Target: unified_events (R2 Iceberg table)
--
-- ============================================================================
-- ICEBERG TABLE CONFIGURATION
-- ============================================================================
--
-- Partition Specification:
--   PARTITIONED BY (
--     day,                    -- Date partition (YYYY-MM-DD)
--     hour,                   -- Hour bucket (0-23)
--     event_type,             -- Event type category
--     ns                      -- Namespace for tenant isolation
--   )
--
-- Sort Order (within partitions):
--   SORTED BY (
--     timestamp DESC,         -- Most recent events first
--     trace_id,               -- Group related spans
--     span_id                 -- Span ordering
--   )
--
-- File Format: Parquet with Zstd compression
-- Write Distribution: HASH(ns, event_type)
--
-- ============================================================================

INSERT INTO unified_events
SELECT
  -- CoreIdentity (4 columns)
  id,
  event_type,
  event_name,
  ns,

  -- CausalityChain (8 columns)
  trace_id,
  span_id,
  parent_id,
  root_id,
  session_id,
  workflow_id,
  transaction_id,
  correlation_id,

  -- Actor (4 columns)
  actor_id,
  actor_type,
  actor_name,
  anonymous_id,

  -- Resource (5 columns)
  resource_type,
  CASE
    WHEN resource_id IS NOT NULL AND resource_id NOT LIKE '%/%'
    THEN CONCAT(ns, '/', resource_id)
    ELSE resource_id
  END AS resource_id,
  resource_name,
  resource_version,
  COALESCE(resource_ns, ns) AS resource_ns,

  -- Timing (6 columns)
  timestamp,
  timestamp_ns,
  started_at,
  ended_at,
  duration_ms,
  cpu_time_ms,

  -- Outcome (6 columns)
  outcome,
  outcome_reason,
  status_code,
  error_type,
  error_message,
  error_stack,

  -- HttpContext (12 columns)
  http_method,
  http_url,
  http_host,
  http_path,
  http_query,
  http_status,
  http_protocol,
  http_request_size,
  http_response_size,
  http_referrer,
  http_user_agent,
  http_content_type,

  -- GeoLocation (10 columns)
  geo_country,
  geo_region,
  geo_city,
  geo_colo,
  geo_timezone,
  geo_latitude,
  geo_longitude,
  geo_asn,
  geo_as_org,
  geo_postal,

  -- ClientDevice (11 columns)
  client_type,
  client_name,
  client_version,
  device_type,
  device_model,
  device_brand,
  os_name,
  os_version,
  bot_score,
  bot_verified,
  screen_size,

  -- ServiceInfra (13 columns)
  service_name,
  service_version,
  service_instance,
  service_namespace,
  host_name,
  host_id,
  cloud_provider,
  cloud_region,
  cloud_zone,
  container_id,
  k8s_namespace,
  k8s_pod,
  k8s_deployment,

  -- DatabaseCdc (10 columns)
  db_system,
  db_name,
  db_table,
  db_operation,
  db_statement,
  db_row_id,
  db_lsn,
  db_version,
  db_before,
  db_after,

  -- MessagingQueue (5 columns)
  msg_system,
  msg_destination,
  msg_operation,
  msg_batch_size,
  msg_message_id,

  -- Rpc (4 columns)
  rpc_system,
  rpc_service,
  rpc_method,
  rpc_status,

  -- WebMarketing (10 columns)
  page_title,
  page_search,
  campaign_name,
  campaign_source,
  campaign_medium,
  campaign_term,
  campaign_content,
  campaign_id,
  ab_test_id,
  ab_variant,

  -- WebVitals (7 columns)
  vital_name,
  vital_value,
  vital_rating,
  vital_delta,
  vital_element,
  vital_load_state,
  nav_type,

  -- SessionReplay (5 columns)
  replay_type,
  replay_source,
  replay_sequence,
  replay_timestamp_offset,
  replay_data,

  -- OtelMetrics (10 columns)
  metric_name,
  metric_unit,
  metric_type,
  metric_value,
  metric_count,
  metric_sum,
  metric_min,
  metric_max,
  metric_buckets,
  metric_quantiles,

  -- Logging (4 columns)
  log_level,
  log_level_num,
  log_message,
  log_logger,

  -- DoSpecific (7 columns)
  do_class,
  do_id,
  do_method,
  action_verb,
  action_durability,
  action_target,
  action_input_version,

  -- BusinessEpcis (5 columns)
  biz_step,
  biz_disposition,
  biz_transaction,
  biz_location,
  biz_read_point,

  -- SnippetProxy (13 columns)
  snippet_initiator,
  snippet_request_id,
  snippet_start_time,
  snippet_dns_time,
  snippet_connect_time,
  snippet_ttfb,
  snippet_download_time,
  snippet_blocked_time,
  snippet_resource_type,
  snippet_transfer_size,
  snippet_decoded_size,
  snippet_cache_state,
  snippet_priority,

  -- FlexiblePayloads (6 columns)
  data,
  attributes,
  labels,
  context,
  properties,
  traits,

  -- PartitionInternal (7 columns)
  EXTRACT(HOUR FROM timestamp) AS hour,
  DATE_FORMAT(timestamp, '%Y-%m-%d') AS day,
  event_source,
  COALESCE(visibility, 'user') AS visibility,
  CURRENT_TIMESTAMP() AS ingested_at,
  batch_id,
  1 AS schema_version

FROM unified_events_stream


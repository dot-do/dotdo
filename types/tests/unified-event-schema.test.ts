/**
 * Tests for Unified Event Zod Schemas
 *
 * RED phase: These tests define the expected behavior for runtime validation
 * of the 162-column unified event schema.
 */

import { describe, it, expect } from 'vitest'
import {
  EventTypeSchema,
  CoreIdentitySchema,
  CausalityChainSchema,
  ActorSchema,
  ResourceSchema,
  TimingSchema,
  OutcomeSchema,
  HttpContextSchema,
  GeoLocationSchema,
  ClientDeviceSchema,
  ServiceInfraSchema,
  DatabaseCdcSchema,
  MessagingQueueSchema,
  RpcSchema,
  WebMarketingSchema,
  WebVitalsSchema,
  SessionReplaySchema,
  OtelMetricsSchema,
  LoggingSchema,
  DoSpecificSchema,
  BusinessEpcisSchema,
  SnippetProxySchema,
  FlexiblePayloadsSchema,
  PartitionInternalSchema,
  UnifiedEventSchema,
  UnifiedEventStrictSchema,
  UnifiedEventLazySchema,
  validateUnifiedEvent,
  safeValidateUnifiedEvent,
} from '../unified-event-schema'

// ============================================================================
// Test Data Helpers
// ============================================================================

const validCoreIdentity = {
  id: 'evt_123',
  event_type: 'trace' as const,
  event_name: 'http.request',
  ns: 'https://api.example.com',
}

const fullValidEvent = {
  // Core Identity (required)
  ...validCoreIdentity,

  // CausalityChain
  trace_id: 'abc123',
  span_id: 'def456',
  parent_id: null,
  root_id: null,
  session_id: null,
  workflow_id: null,
  transaction_id: null,
  correlation_id: null,

  // Actor
  actor_id: 'user_123',
  actor_type: 'user',
  actor_name: 'Alice',
  anonymous_id: null,

  // Resource
  resource_type: 'Customer',
  resource_id: 'cust_123',
  resource_name: 'Alice Corp',
  resource_version: '1',
  resource_ns: 'tenant_abc',

  // Timing
  timestamp: '2024-01-01T00:00:00Z',
  timestamp_ns: null,
  started_at: null,
  ended_at: null,
  duration_ms: 150,
  cpu_time_ms: null,

  // Outcome
  outcome: 'success',
  outcome_reason: null,
  status_code: 200,
  error_type: null,
  error_message: null,
  error_stack: null,

  // HttpContext
  http_method: 'GET',
  http_url: 'https://api.example.com/users',
  http_host: 'api.example.com',
  http_path: '/users',
  http_query: null,
  http_status: 200,
  http_protocol: 'HTTP/2',
  http_request_size: null,
  http_response_size: 1024,
  http_referrer: null,
  http_user_agent: 'Mozilla/5.0',
  http_content_type: 'application/json',

  // GeoLocation
  geo_country: 'US',
  geo_region: 'CA',
  geo_city: 'San Francisco',
  geo_colo: 'SFO',
  geo_timezone: 'America/Los_Angeles',
  geo_latitude: 37.7749,
  geo_longitude: -122.4194,
  geo_asn: 13335,
  geo_as_org: 'Cloudflare Inc',
  geo_postal: '94102',

  // ClientDevice
  client_type: 'browser',
  client_name: 'Chrome',
  client_version: '120.0',
  device_type: 'desktop',
  device_model: null,
  device_brand: null,
  os_name: 'macOS',
  os_version: '14.0',
  bot_score: null,
  bot_verified: null,
  screen_size: '1920x1080',

  // ServiceInfra
  service_name: 'api-gateway',
  service_version: '1.0.0',
  service_instance: 'instance-1',
  service_namespace: 'production',
  host_name: null,
  host_id: null,
  cloud_provider: 'cloudflare',
  cloud_region: 'us-west',
  cloud_zone: null,
  container_id: null,
  k8s_namespace: null,
  k8s_pod: null,
  k8s_deployment: null,

  // DatabaseCdc
  db_system: null,
  db_name: null,
  db_table: null,
  db_operation: null,
  db_statement: null,
  db_row_id: null,
  db_lsn: null,
  db_version: null,
  db_before: null,
  db_after: null,

  // MessagingQueue
  msg_system: null,
  msg_destination: null,
  msg_operation: null,
  msg_batch_size: null,
  msg_message_id: null,

  // Rpc
  rpc_system: null,
  rpc_service: null,
  rpc_method: null,
  rpc_status: null,

  // WebMarketing
  page_title: null,
  page_search: null,
  campaign_name: null,
  campaign_source: null,
  campaign_medium: null,
  campaign_term: null,
  campaign_content: null,
  campaign_id: null,
  ab_test_id: null,
  ab_variant: null,

  // WebVitals
  vital_name: null,
  vital_value: null,
  vital_rating: null,
  vital_delta: null,
  vital_element: null,
  vital_load_state: null,
  nav_type: null,

  // SessionReplay
  replay_type: null,
  replay_source: null,
  replay_sequence: null,
  replay_timestamp_offset: null,
  replay_data: null,

  // OtelMetrics
  metric_name: null,
  metric_unit: null,
  metric_type: null,
  metric_value: null,
  metric_count: null,
  metric_sum: null,
  metric_min: null,
  metric_max: null,
  metric_buckets: null,
  metric_quantiles: null,

  // Logging
  log_level: null,
  log_level_num: null,
  log_message: null,
  log_logger: null,

  // DoSpecific
  do_class: null,
  do_id: null,
  do_method: null,
  action_verb: null,
  action_durability: null,
  action_target: null,
  action_input_version: null,

  // BusinessEpcis
  biz_step: null,
  biz_disposition: null,
  biz_transaction: null,
  biz_location: null,
  biz_read_point: null,

  // SnippetProxy
  snippet_initiator: null,
  snippet_request_id: null,
  snippet_start_time: null,
  snippet_dns_time: null,
  snippet_connect_time: null,
  snippet_ttfb: null,
  snippet_download_time: null,
  snippet_blocked_time: null,
  snippet_resource_type: null,
  snippet_transfer_size: null,
  snippet_decoded_size: null,
  snippet_cache_state: null,
  snippet_priority: null,

  // FlexiblePayloads
  data: { custom: 'value' },
  attributes: { 'http.method': 'GET' },
  labels: { env: 'production' },
  context: null,
  properties: null,
  traits: null,

  // PartitionInternal
  hour: 14,
  day: '2024-01-01',
  event_source: 'api',
  visibility: 'public',
  ingested_at: '2024-01-01T00:00:01Z',
  batch_id: null,
  schema_version: 1,
}

// ============================================================================
// EventType Schema Tests
// ============================================================================

describe('EventTypeSchema', () => {
  it('accepts all valid event types', () => {
    const validTypes = [
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
    ]
    for (const type of validTypes) {
      expect(EventTypeSchema.parse(type)).toBe(type)
    }
  })

  it('rejects invalid event types', () => {
    expect(() => EventTypeSchema.parse('invalid')).toThrow()
    expect(() => EventTypeSchema.parse('TRACE')).toThrow() // case sensitive
    expect(() => EventTypeSchema.parse('')).toThrow()
    expect(() => EventTypeSchema.parse(123)).toThrow()
  })
})

// ============================================================================
// CoreIdentity Schema Tests
// ============================================================================

describe('CoreIdentitySchema', () => {
  it('validates required core fields', () => {
    const result = CoreIdentitySchema.parse(validCoreIdentity)
    expect(result.id).toBe('evt_123')
    expect(result.event_type).toBe('trace')
    expect(result.event_name).toBe('http.request')
    expect(result.ns).toBe('https://api.example.com')
  })

  it('rejects missing id', () => {
    const { id, ...withoutId } = validCoreIdentity
    expect(() => CoreIdentitySchema.parse(withoutId)).toThrow()
  })

  it('rejects missing event_type', () => {
    const { event_type, ...withoutType } = validCoreIdentity
    expect(() => CoreIdentitySchema.parse(withoutType)).toThrow()
  })

  it('rejects missing event_name', () => {
    const { event_name, ...withoutName } = validCoreIdentity
    expect(() => CoreIdentitySchema.parse(withoutName)).toThrow()
  })

  it('rejects missing ns', () => {
    const { ns, ...withoutNs } = validCoreIdentity
    expect(() => CoreIdentitySchema.parse(withoutNs)).toThrow()
  })

  it('rejects invalid event_type', () => {
    expect(() =>
      CoreIdentitySchema.parse({
        ...validCoreIdentity,
        event_type: 'invalid',
      })
    ).toThrow()
  })

  it('rejects null for required fields', () => {
    expect(() =>
      CoreIdentitySchema.parse({ ...validCoreIdentity, id: null })
    ).toThrow()
  })
})

// ============================================================================
// CausalityChain Schema Tests
// ============================================================================

describe('CausalityChainSchema', () => {
  it('accepts all null values', () => {
    const result = CausalityChainSchema.parse({
      trace_id: null,
      span_id: null,
      parent_id: null,
      root_id: null,
      session_id: null,
      workflow_id: null,
      transaction_id: null,
      correlation_id: null,
    })
    expect(result.trace_id).toBeNull()
    expect(result.correlation_id).toBeNull()
  })

  it('accepts string values', () => {
    const result = CausalityChainSchema.parse({
      trace_id: 'abc123def456789012345678901234ab',
      span_id: '1234567890123456',
      parent_id: 'parent_span_id',
      root_id: 'root_span_id',
      session_id: 'sess_123',
      workflow_id: 'wf_456',
      transaction_id: 'txn_789',
      correlation_id: 'corr_abc',
    })
    expect(result.trace_id).toBe('abc123def456789012345678901234ab')
  })

  it('rejects non-string, non-null values', () => {
    expect(() =>
      CausalityChainSchema.parse({
        trace_id: 123,
        span_id: null,
        parent_id: null,
        root_id: null,
        session_id: null,
        workflow_id: null,
        transaction_id: null,
        correlation_id: null,
      })
    ).toThrow()
  })
})

// ============================================================================
// FlexiblePayloads Schema Tests (JSON fields)
// ============================================================================

describe('FlexiblePayloadsSchema', () => {
  it('accepts null for all JSON fields', () => {
    const result = FlexiblePayloadsSchema.parse({
      data: null,
      attributes: null,
      labels: null,
      context: null,
      properties: null,
      traits: null,
    })
    expect(result.data).toBeNull()
    expect(result.attributes).toBeNull()
  })

  it('accepts valid JSON objects for data field', () => {
    const result = FlexiblePayloadsSchema.parse({
      data: { key: 'value', nested: { a: 1 } },
      attributes: null,
      labels: null,
      context: null,
      properties: null,
      traits: null,
    })
    expect(result.data).toEqual({ key: 'value', nested: { a: 1 } })
  })

  it('accepts valid JSON objects for attributes field', () => {
    const result = FlexiblePayloadsSchema.parse({
      data: null,
      attributes: { 'http.method': 'GET', 'http.status_code': 200 },
      labels: null,
      context: null,
      properties: null,
      traits: null,
    })
    expect(result.attributes).toEqual({
      'http.method': 'GET',
      'http.status_code': 200,
    })
  })

  it('accepts string-only map for labels field', () => {
    const result = FlexiblePayloadsSchema.parse({
      data: null,
      attributes: null,
      labels: { env: 'production', region: 'us-west' },
      context: null,
      properties: null,
      traits: null,
    })
    expect(result.labels).toEqual({ env: 'production', region: 'us-west' })
  })

  it('rejects non-object types for JSON fields', () => {
    expect(() =>
      FlexiblePayloadsSchema.parse({
        data: 'not an object',
        attributes: null,
        labels: null,
        context: null,
        properties: null,
        traits: null,
      })
    ).toThrow()
  })
})

// ============================================================================
// Timing Schema Tests
// ============================================================================

describe('TimingSchema', () => {
  it('accepts valid ISO timestamp strings', () => {
    const result = TimingSchema.parse({
      timestamp: '2024-01-01T00:00:00Z',
      timestamp_ns: null,
      started_at: '2024-01-01T00:00:00.000Z',
      ended_at: '2024-01-01T00:00:01.500Z',
      duration_ms: 1500,
      cpu_time_ms: 50,
    })
    expect(result.timestamp).toBe('2024-01-01T00:00:00Z')
    expect(result.duration_ms).toBe(1500)
  })

  it('accepts null for all timing fields', () => {
    const result = TimingSchema.parse({
      timestamp: null,
      timestamp_ns: null,
      started_at: null,
      ended_at: null,
      duration_ms: null,
      cpu_time_ms: null,
    })
    expect(result.timestamp).toBeNull()
    expect(result.duration_ms).toBeNull()
  })

  it('accepts bigint for timestamp_ns', () => {
    const result = TimingSchema.parse({
      timestamp: null,
      timestamp_ns: BigInt('1704067200000000000'),
      started_at: null,
      ended_at: null,
      duration_ms: null,
      cpu_time_ms: null,
    })
    expect(result.timestamp_ns).toBe(BigInt('1704067200000000000'))
  })

  it('rejects non-numeric duration_ms', () => {
    expect(() =>
      TimingSchema.parse({
        timestamp: null,
        timestamp_ns: null,
        started_at: null,
        ended_at: null,
        duration_ms: 'fast',
        cpu_time_ms: null,
      })
    ).toThrow()
  })
})

// ============================================================================
// UnifiedEvent Schema Tests
// ============================================================================

describe('UnifiedEventSchema', () => {
  it('validates a complete valid event', () => {
    const result = UnifiedEventSchema.parse(fullValidEvent)
    expect(result.id).toBe('evt_123')
    expect(result.event_type).toBe('trace')
    expect(result.http_method).toBe('GET')
    expect(result.data).toEqual({ custom: 'value' })
  })

  it('validates event with only core fields and nulls', () => {
    const minimalEvent = {
      ...validCoreIdentity,
      // All other fields null
      trace_id: null,
      span_id: null,
      parent_id: null,
      root_id: null,
      session_id: null,
      workflow_id: null,
      transaction_id: null,
      correlation_id: null,
      actor_id: null,
      actor_type: null,
      actor_name: null,
      anonymous_id: null,
      resource_type: null,
      resource_id: null,
      resource_name: null,
      resource_version: null,
      resource_ns: null,
      timestamp: null,
      timestamp_ns: null,
      started_at: null,
      ended_at: null,
      duration_ms: null,
      cpu_time_ms: null,
      outcome: null,
      outcome_reason: null,
      status_code: null,
      error_type: null,
      error_message: null,
      error_stack: null,
      http_method: null,
      http_url: null,
      http_host: null,
      http_path: null,
      http_query: null,
      http_status: null,
      http_protocol: null,
      http_request_size: null,
      http_response_size: null,
      http_referrer: null,
      http_user_agent: null,
      http_content_type: null,
      geo_country: null,
      geo_region: null,
      geo_city: null,
      geo_colo: null,
      geo_timezone: null,
      geo_latitude: null,
      geo_longitude: null,
      geo_asn: null,
      geo_as_org: null,
      geo_postal: null,
      client_type: null,
      client_name: null,
      client_version: null,
      device_type: null,
      device_model: null,
      device_brand: null,
      os_name: null,
      os_version: null,
      bot_score: null,
      bot_verified: null,
      screen_size: null,
      service_name: null,
      service_version: null,
      service_instance: null,
      service_namespace: null,
      host_name: null,
      host_id: null,
      cloud_provider: null,
      cloud_region: null,
      cloud_zone: null,
      container_id: null,
      k8s_namespace: null,
      k8s_pod: null,
      k8s_deployment: null,
      db_system: null,
      db_name: null,
      db_table: null,
      db_operation: null,
      db_statement: null,
      db_row_id: null,
      db_lsn: null,
      db_version: null,
      db_before: null,
      db_after: null,
      msg_system: null,
      msg_destination: null,
      msg_operation: null,
      msg_batch_size: null,
      msg_message_id: null,
      rpc_system: null,
      rpc_service: null,
      rpc_method: null,
      rpc_status: null,
      page_title: null,
      page_search: null,
      campaign_name: null,
      campaign_source: null,
      campaign_medium: null,
      campaign_term: null,
      campaign_content: null,
      campaign_id: null,
      ab_test_id: null,
      ab_variant: null,
      vital_name: null,
      vital_value: null,
      vital_rating: null,
      vital_delta: null,
      vital_element: null,
      vital_load_state: null,
      nav_type: null,
      replay_type: null,
      replay_source: null,
      replay_sequence: null,
      replay_timestamp_offset: null,
      replay_data: null,
      metric_name: null,
      metric_unit: null,
      metric_type: null,
      metric_value: null,
      metric_count: null,
      metric_sum: null,
      metric_min: null,
      metric_max: null,
      metric_buckets: null,
      metric_quantiles: null,
      log_level: null,
      log_level_num: null,
      log_message: null,
      log_logger: null,
      do_class: null,
      do_id: null,
      do_method: null,
      action_verb: null,
      action_durability: null,
      action_target: null,
      action_input_version: null,
      biz_step: null,
      biz_disposition: null,
      biz_transaction: null,
      biz_location: null,
      biz_read_point: null,
      snippet_initiator: null,
      snippet_request_id: null,
      snippet_start_time: null,
      snippet_dns_time: null,
      snippet_connect_time: null,
      snippet_ttfb: null,
      snippet_download_time: null,
      snippet_blocked_time: null,
      snippet_resource_type: null,
      snippet_transfer_size: null,
      snippet_decoded_size: null,
      snippet_cache_state: null,
      snippet_priority: null,
      data: null,
      attributes: null,
      labels: null,
      context: null,
      properties: null,
      traits: null,
      hour: null,
      day: null,
      event_source: null,
      visibility: null,
      ingested_at: null,
      batch_id: null,
      schema_version: null,
    }
    const result = UnifiedEventSchema.parse(minimalEvent)
    expect(result.id).toBe('evt_123')
    expect(result.trace_id).toBeNull()
  })

  it('rejects missing core identity fields', () => {
    const { id, ...withoutId } = fullValidEvent
    expect(() => UnifiedEventSchema.parse(withoutId)).toThrow()

    const { event_type, ...withoutType } = fullValidEvent
    expect(() => UnifiedEventSchema.parse(withoutType)).toThrow()
  })

  it('rejects invalid event_type', () => {
    expect(() =>
      UnifiedEventSchema.parse({
        ...fullValidEvent,
        event_type: 'unknown',
      })
    ).toThrow()
  })
})

// ============================================================================
// Strict Schema Tests
// ============================================================================

describe('UnifiedEventStrictSchema', () => {
  it('rejects unknown fields', () => {
    expect(() =>
      UnifiedEventStrictSchema.parse({
        ...fullValidEvent,
        unknown_field: 'should fail',
      })
    ).toThrow()
  })

  it('accepts valid events without extra fields', () => {
    const result = UnifiedEventStrictSchema.parse(fullValidEvent)
    expect(result.id).toBe('evt_123')
  })
})

// ============================================================================
// Lazy Schema Tests (Passthrough)
// ============================================================================

describe('UnifiedEventLazySchema', () => {
  it('allows unknown fields', () => {
    const result = UnifiedEventLazySchema.parse({
      ...validCoreIdentity,
      unknown_field: 'should pass',
      another_unknown: 123,
    })
    expect(result.id).toBe('evt_123')
    expect((result as any).unknown_field).toBe('should pass')
  })

  it('only validates core identity fields', () => {
    const result = UnifiedEventLazySchema.parse({
      id: 'evt_456',
      event_type: 'metric',
      event_name: 'cpu.usage',
      ns: 'https://metrics.example.com',
      // No other fields required
    })
    expect(result.id).toBe('evt_456')
    expect(result.event_type).toBe('metric')
  })

  it('still rejects invalid core fields', () => {
    expect(() =>
      UnifiedEventLazySchema.parse({
        event_type: 'trace', // missing id
        event_name: 'test',
        ns: 'https://example.com',
      })
    ).toThrow()
  })
})

// ============================================================================
// Validation Helper Tests
// ============================================================================

describe('validateUnifiedEvent', () => {
  it('returns validated event on success', () => {
    const result = validateUnifiedEvent(fullValidEvent)
    expect(result.id).toBe('evt_123')
  })

  it('throws on invalid input', () => {
    expect(() => validateUnifiedEvent({})).toThrow()
    expect(() => validateUnifiedEvent(null)).toThrow()
  })
})

describe('safeValidateUnifiedEvent', () => {
  it('returns success result with data on valid input', () => {
    const result = safeValidateUnifiedEvent(fullValidEvent)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('evt_123')
    }
  })

  it('returns failure result with error on invalid input', () => {
    const result = safeValidateUnifiedEvent({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeDefined()
    }
  })

  it('does not throw on invalid input', () => {
    expect(() => safeValidateUnifiedEvent(null)).not.toThrow()
    expect(() => safeValidateUnifiedEvent(undefined)).not.toThrow()
    expect(() => safeValidateUnifiedEvent('string')).not.toThrow()
  })
})

// ============================================================================
// Semantic Group Schema Tests
// ============================================================================

describe('ActorSchema', () => {
  it('accepts all null values', () => {
    const result = ActorSchema.parse({
      actor_id: null,
      actor_type: null,
      actor_name: null,
      anonymous_id: null,
    })
    expect(result.actor_id).toBeNull()
  })

  it('accepts valid string values', () => {
    const result = ActorSchema.parse({
      actor_id: 'user_123',
      actor_type: 'user',
      actor_name: 'Alice',
      anonymous_id: 'anon_456',
    })
    expect(result.actor_id).toBe('user_123')
    expect(result.actor_type).toBe('user')
  })
})

describe('ResourceSchema', () => {
  it('accepts all null values', () => {
    const result = ResourceSchema.parse({
      resource_type: null,
      resource_id: null,
      resource_name: null,
      resource_version: null,
      resource_ns: null,
    })
    expect(result.resource_type).toBeNull()
  })
})

describe('OutcomeSchema', () => {
  it('accepts valid outcome with status code', () => {
    const result = OutcomeSchema.parse({
      outcome: 'success',
      outcome_reason: null,
      status_code: 200,
      error_type: null,
      error_message: null,
      error_stack: null,
    })
    expect(result.outcome).toBe('success')
    expect(result.status_code).toBe(200)
  })

  it('accepts error outcome with stack trace', () => {
    const result = OutcomeSchema.parse({
      outcome: 'failure',
      outcome_reason: 'Validation failed',
      status_code: 400,
      error_type: 'ValidationError',
      error_message: 'Invalid input',
      error_stack: 'Error: Invalid input\n  at validate()',
    })
    expect(result.error_type).toBe('ValidationError')
    expect(result.error_stack).toContain('validate')
  })
})

describe('HttpContextSchema', () => {
  it('accepts complete HTTP context', () => {
    const result = HttpContextSchema.parse({
      http_method: 'POST',
      http_url: 'https://api.example.com/users',
      http_host: 'api.example.com',
      http_path: '/users',
      http_query: '?page=1',
      http_status: 201,
      http_protocol: 'HTTP/2',
      http_request_size: 256,
      http_response_size: 512,
      http_referrer: 'https://example.com',
      http_user_agent: 'Mozilla/5.0',
      http_content_type: 'application/json',
    })
    expect(result.http_method).toBe('POST')
    expect(result.http_status).toBe(201)
  })
})

describe('GeoLocationSchema', () => {
  it('accepts valid geo coordinates', () => {
    const result = GeoLocationSchema.parse({
      geo_country: 'US',
      geo_region: 'CA',
      geo_city: 'San Francisco',
      geo_colo: 'SFO',
      geo_timezone: 'America/Los_Angeles',
      geo_latitude: 37.7749,
      geo_longitude: -122.4194,
      geo_asn: 13335,
      geo_as_org: 'Cloudflare',
      geo_postal: '94102',
    })
    expect(result.geo_latitude).toBe(37.7749)
    expect(result.geo_longitude).toBe(-122.4194)
  })
})

describe('ClientDeviceSchema', () => {
  it('accepts valid client device info', () => {
    const result = ClientDeviceSchema.parse({
      client_type: 'browser',
      client_name: 'Chrome',
      client_version: '120.0',
      device_type: 'desktop',
      device_model: null,
      device_brand: null,
      os_name: 'macOS',
      os_version: '14.0',
      bot_score: 0,
      bot_verified: false,
      screen_size: '1920x1080',
    })
    expect(result.client_type).toBe('browser')
    expect(result.bot_verified).toBe(false)
  })
})

describe('ServiceInfraSchema', () => {
  it('accepts valid service infrastructure info', () => {
    const result = ServiceInfraSchema.parse({
      service_name: 'api-gateway',
      service_version: '1.0.0',
      service_instance: 'inst-1',
      service_namespace: 'production',
      host_name: 'host-1',
      host_id: 'host_abc',
      cloud_provider: 'cloudflare',
      cloud_region: 'us-west',
      cloud_zone: 'us-west-1a',
      container_id: 'container_123',
      k8s_namespace: 'default',
      k8s_pod: 'api-gateway-abc123',
      k8s_deployment: 'api-gateway',
    })
    expect(result.service_name).toBe('api-gateway')
    expect(result.k8s_pod).toBe('api-gateway-abc123')
  })
})

describe('DatabaseCdcSchema', () => {
  it('accepts valid CDC event data', () => {
    const result = DatabaseCdcSchema.parse({
      db_system: 'postgres',
      db_name: 'main',
      db_table: 'users',
      db_operation: 'INSERT',
      db_statement: 'INSERT INTO users ...',
      db_row_id: 'row_123',
      db_lsn: '0/1234ABC',
      db_version: 1,
      db_before: null,
      db_after: '{"id": 1, "name": "Alice"}',
    })
    expect(result.db_system).toBe('postgres')
    expect(result.db_operation).toBe('INSERT')
  })
})

describe('MessagingQueueSchema', () => {
  it('accepts valid messaging data', () => {
    const result = MessagingQueueSchema.parse({
      msg_system: 'cloudflare_queues',
      msg_destination: 'events-queue',
      msg_operation: 'publish',
      msg_batch_size: 10,
      msg_message_id: 'msg_123',
    })
    expect(result.msg_system).toBe('cloudflare_queues')
  })
})

describe('RpcSchema', () => {
  it('accepts valid RPC data', () => {
    const result = RpcSchema.parse({
      rpc_system: 'grpc',
      rpc_service: 'UserService',
      rpc_method: 'GetUser',
      rpc_status: 'ok',
    })
    expect(result.rpc_system).toBe('grpc')
  })
})

describe('WebMarketingSchema', () => {
  it('accepts valid marketing attribution', () => {
    const result = WebMarketingSchema.parse({
      page_title: 'Home Page',
      page_search: 'product search',
      campaign_name: 'summer-sale',
      campaign_source: 'google',
      campaign_medium: 'cpc',
      campaign_term: 'buy widgets',
      campaign_content: 'ad-variant-a',
      campaign_id: 'camp_123',
      ab_test_id: 'test_456',
      ab_variant: 'control',
    })
    expect(result.campaign_name).toBe('summer-sale')
  })
})

describe('WebVitalsSchema', () => {
  it('accepts valid web vitals data', () => {
    const result = WebVitalsSchema.parse({
      vital_name: 'LCP',
      vital_value: 2500,
      vital_rating: 'good',
      vital_delta: 100,
      vital_element: 'img.hero',
      vital_load_state: 'complete',
      nav_type: 'navigate',
    })
    expect(result.vital_name).toBe('LCP')
    expect(result.vital_rating).toBe('good')
  })
})

describe('SessionReplaySchema', () => {
  it('accepts valid session replay data', () => {
    const result = SessionReplaySchema.parse({
      replay_type: 'mutation',
      replay_source: 'rrweb',
      replay_sequence: 42,
      replay_timestamp_offset: 5000,
      replay_data: '{"type":"mutation",...}',
    })
    expect(result.replay_type).toBe('mutation')
  })
})

describe('OtelMetricsSchema', () => {
  it('accepts valid OTEL metrics data', () => {
    const result = OtelMetricsSchema.parse({
      metric_name: 'http_requests_total',
      metric_unit: 'requests',
      metric_type: 'counter',
      metric_value: 1000,
      metric_count: null,
      metric_sum: null,
      metric_min: null,
      metric_max: null,
      metric_buckets: null,
      metric_quantiles: null,
    })
    expect(result.metric_name).toBe('http_requests_total')
    expect(result.metric_type).toBe('counter')
  })

  it('accepts histogram metrics with buckets', () => {
    const result = OtelMetricsSchema.parse({
      metric_name: 'http_request_duration',
      metric_unit: 'ms',
      metric_type: 'histogram',
      metric_value: null,
      metric_count: 100,
      metric_sum: 5000,
      metric_min: 10,
      metric_max: 500,
      metric_buckets: '[{"le": 50, "count": 25}, {"le": 100, "count": 75}]',
      metric_quantiles: '{"p50": 45, "p99": 450}',
    })
    expect(result.metric_type).toBe('histogram')
    expect(result.metric_count).toBe(100)
  })
})

describe('LoggingSchema', () => {
  it('accepts valid log data', () => {
    const result = LoggingSchema.parse({
      log_level: 'error',
      log_level_num: 50,
      log_message: 'Connection failed',
      log_logger: 'database.pool',
    })
    expect(result.log_level).toBe('error')
    expect(result.log_level_num).toBe(50)
  })
})

describe('DoSpecificSchema', () => {
  it('accepts valid DO-specific data', () => {
    const result = DoSpecificSchema.parse({
      do_class: 'CustomerDO',
      do_id: 'do_123',
      do_method: 'createThing',
      action_verb: 'create',
      action_durability: 'do',
      action_target: 'Customer',
      action_input_version: 5,
    })
    expect(result.do_class).toBe('CustomerDO')
    expect(result.action_durability).toBe('do')
  })
})

describe('BusinessEpcisSchema', () => {
  it('accepts valid EPCIS business data', () => {
    const result = BusinessEpcisSchema.parse({
      biz_step: 'shipping',
      biz_disposition: 'in_transit',
      biz_transaction: 'PO-12345',
      biz_location: 'urn:epc:id:sgln:0614141.00001.0',
      biz_read_point: 'urn:epc:id:sgln:0614141.00001.1',
    })
    expect(result.biz_step).toBe('shipping')
  })
})

describe('SnippetProxySchema', () => {
  it('accepts valid snippet timing data', () => {
    const result = SnippetProxySchema.parse({
      snippet_initiator: 'fetch',
      snippet_request_id: 'req_123',
      snippet_start_time: 1000,
      snippet_dns_time: 10,
      snippet_connect_time: 20,
      snippet_ttfb: 50,
      snippet_download_time: 30,
      snippet_blocked_time: 5,
      snippet_resource_type: 'script',
      snippet_transfer_size: 1024,
      snippet_decoded_size: 2048,
      snippet_cache_state: 'miss',
      snippet_priority: 'high',
    })
    expect(result.snippet_ttfb).toBe(50)
    expect(result.snippet_resource_type).toBe('script')
  })
})

describe('PartitionInternalSchema', () => {
  it('accepts valid partition metadata', () => {
    const result = PartitionInternalSchema.parse({
      hour: 14,
      day: '2024-01-01',
      event_source: 'api',
      visibility: 'public',
      ingested_at: '2024-01-01T14:30:00Z',
      batch_id: 'batch_123',
      schema_version: 1,
    })
    expect(result.hour).toBe(14)
    expect(result.day).toBe('2024-01-01')
  })

  it('accepts null for all partition fields', () => {
    const result = PartitionInternalSchema.parse({
      hour: null,
      day: null,
      event_source: null,
      visibility: null,
      ingested_at: null,
      batch_id: null,
      schema_version: null,
    })
    expect(result.hour).toBeNull()
  })
})

// ============================================================================
// Specialized Event Schema Tests (Refinements)
// ============================================================================

import {
  TraceEventSchema,
  MetricEventSchema,
  LogEventSchema,
  CdcEventSchema,
  VitalEventSchema,
  validateEventBatch,
  validateEventBatchLazy,
  formatValidationError,
  getInvalidFields,
  EVENT_TYPES,
} from '../unified-event-schema'

describe('EVENT_TYPES constant', () => {
  it('contains all 10 event types', () => {
    expect(EVENT_TYPES).toHaveLength(10)
    expect(EVENT_TYPES).toContain('trace')
    expect(EVENT_TYPES).toContain('metric')
    expect(EVENT_TYPES).toContain('log')
    expect(EVENT_TYPES).toContain('cdc')
    expect(EVENT_TYPES).toContain('track')
    expect(EVENT_TYPES).toContain('page')
    expect(EVENT_TYPES).toContain('vital')
    expect(EVENT_TYPES).toContain('replay')
    expect(EVENT_TYPES).toContain('tail')
    expect(EVENT_TYPES).toContain('snippet')
  })
})

describe('TraceEventSchema', () => {
  it('validates trace events with trace_id and span_id', () => {
    const traceEvent = {
      ...fullValidEvent,
      event_type: 'trace' as const,
      trace_id: 'abc123',
      span_id: 'def456',
    }
    const result = TraceEventSchema.parse(traceEvent)
    expect(result.event_type).toBe('trace')
    expect(result.trace_id).toBe('abc123')
  })

  it('rejects trace events without trace_id', () => {
    const traceEvent = {
      ...fullValidEvent,
      event_type: 'trace' as const,
      trace_id: null,
      span_id: 'def456',
    }
    expect(() => TraceEventSchema.parse(traceEvent)).toThrow()
  })

  it('allows non-trace events without trace_id', () => {
    const logEvent = {
      ...fullValidEvent,
      event_type: 'log' as const,
      trace_id: null,
      span_id: null,
    }
    const result = TraceEventSchema.parse(logEvent)
    expect(result.event_type).toBe('log')
  })
})

describe('MetricEventSchema', () => {
  it('validates metric events with metric_name and metric_type', () => {
    const metricEvent = {
      ...fullValidEvent,
      event_type: 'metric' as const,
      metric_name: 'http_requests_total',
      metric_type: 'counter',
    }
    const result = MetricEventSchema.parse(metricEvent)
    expect(result.event_type).toBe('metric')
    expect(result.metric_name).toBe('http_requests_total')
  })

  it('rejects metric events without metric_name', () => {
    const metricEvent = {
      ...fullValidEvent,
      event_type: 'metric' as const,
      metric_name: null,
      metric_type: 'counter',
    }
    expect(() => MetricEventSchema.parse(metricEvent)).toThrow()
  })
})

describe('LogEventSchema', () => {
  it('validates log events with log_level and log_message', () => {
    const logEvent = {
      ...fullValidEvent,
      event_type: 'log' as const,
      log_level: 'error',
      log_message: 'Something went wrong',
    }
    const result = LogEventSchema.parse(logEvent)
    expect(result.event_type).toBe('log')
    expect(result.log_level).toBe('error')
  })

  it('rejects log events without log_message', () => {
    const logEvent = {
      ...fullValidEvent,
      event_type: 'log' as const,
      log_level: 'error',
      log_message: null,
    }
    expect(() => LogEventSchema.parse(logEvent)).toThrow()
  })
})

describe('CdcEventSchema', () => {
  it('validates CDC events with db fields', () => {
    const cdcEvent = {
      ...fullValidEvent,
      event_type: 'cdc' as const,
      db_system: 'postgres',
      db_table: 'users',
      db_operation: 'INSERT',
    }
    const result = CdcEventSchema.parse(cdcEvent)
    expect(result.event_type).toBe('cdc')
    expect(result.db_system).toBe('postgres')
  })

  it('rejects CDC events without db_system', () => {
    const cdcEvent = {
      ...fullValidEvent,
      event_type: 'cdc' as const,
      db_system: null,
      db_table: 'users',
      db_operation: 'INSERT',
    }
    expect(() => CdcEventSchema.parse(cdcEvent)).toThrow()
  })
})

describe('VitalEventSchema', () => {
  it('validates vital events with vital_name and vital_value', () => {
    const vitalEvent = {
      ...fullValidEvent,
      event_type: 'vital' as const,
      vital_name: 'LCP',
      vital_value: 2500,
    }
    const result = VitalEventSchema.parse(vitalEvent)
    expect(result.event_type).toBe('vital')
    expect(result.vital_name).toBe('LCP')
  })

  it('rejects vital events without vital_value', () => {
    const vitalEvent = {
      ...fullValidEvent,
      event_type: 'vital' as const,
      vital_name: 'LCP',
      vital_value: null,
    }
    expect(() => VitalEventSchema.parse(vitalEvent)).toThrow()
  })
})

// ============================================================================
// Batch Validation Tests
// ============================================================================

describe('validateEventBatch', () => {
  it('returns all valid events when input is valid', () => {
    const events = [fullValidEvent, fullValidEvent]
    const { valid, errors } = validateEventBatch(events)
    expect(valid).toHaveLength(2)
    expect(errors).toHaveLength(0)
  })

  it('separates valid and invalid events', () => {
    const events = [
      fullValidEvent,
      { invalid: 'event' },
      fullValidEvent,
      { also: 'invalid' },
    ]
    const { valid, errors } = validateEventBatch(events)
    expect(valid).toHaveLength(2)
    expect(errors).toHaveLength(2)
    expect(errors[0].index).toBe(1)
    expect(errors[1].index).toBe(3)
  })

  it('returns empty arrays for empty input', () => {
    const { valid, errors } = validateEventBatch([])
    expect(valid).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })
})

describe('validateEventBatchLazy', () => {
  it('returns valid events with only core fields checked', () => {
    const events = [
      validCoreIdentity,
      { ...validCoreIdentity, extra_field: 'allowed' },
    ]
    const { valid, errors } = validateEventBatchLazy(events)
    expect(valid).toHaveLength(2)
    expect(errors).toHaveLength(0)
  })

  it('rejects events missing core fields', () => {
    const events = [validCoreIdentity, { missing: 'core fields' }]
    const { valid, errors } = validateEventBatchLazy(events)
    expect(valid).toHaveLength(1)
    expect(errors).toHaveLength(1)
  })
})

// ============================================================================
// Error Formatting Tests
// ============================================================================

describe('formatValidationError', () => {
  it('formats single field error', () => {
    const result = safeValidateUnifiedEvent({ id: 123 }) // wrong type
    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationError(result.error)
      expect(formatted).toBeTruthy()
      expect(typeof formatted).toBe('string')
    }
  })

  it('formats multiple field errors', () => {
    const result = safeValidateUnifiedEvent({}) // missing all required fields
    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationError(result.error)
      expect(formatted).toContain('id')
    }
  })
})

describe('getInvalidFields', () => {
  it('returns array of invalid field paths', () => {
    const result = safeValidateUnifiedEvent({})
    expect(result.success).toBe(false)
    if (!result.success) {
      const fields = getInvalidFields(result.error)
      expect(Array.isArray(fields)).toBe(true)
      expect(fields.length).toBeGreaterThan(0)
    }
  })

  it('returns unique field paths', () => {
    const result = safeValidateUnifiedEvent({
      id: 123,
      event_type: 'invalid',
      event_name: 456,
      ns: 789,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const fields = getInvalidFields(result.error)
      const uniqueFields = [...new Set(fields)]
      expect(fields.length).toBe(uniqueFields.length)
    }
  })
})

// ============================================================================
// Custom Error Messages Tests
// ============================================================================

describe('Custom error messages', () => {
  it('provides helpful error for invalid event_type', () => {
    const result = safeValidateUnifiedEvent({
      id: 'evt_123',
      event_type: 'invalid_type',
      event_name: 'test',
      ns: 'https://test.com',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationError(result.error)
      expect(formatted).toContain('event_type')
    }
  })

  it('provides helpful error for empty id', () => {
    const result = safeValidateUnifiedEvent({
      id: '',
      event_type: 'trace',
      event_name: 'test',
      ns: 'https://test.com',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const formatted = formatValidationError(result.error)
      expect(formatted).toContain('id')
    }
  })
})

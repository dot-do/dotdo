/**
 * Airbyte Protocol Compatibility Tests
 *
 * TDD RED phase: These tests define the expected behavior for full Airbyte protocol compatibility.
 * Based on Airbyte Protocol v0.5.2 specification.
 *
 * Message types:
 * - RECORD: Data records
 * - STATE: Checkpoint/cursor state
 * - LOG: Debug/info messages
 * - SPEC: Connector specification
 * - CATALOG: Stream catalog
 * - CONNECTION_STATUS: Connection validation
 * - TRACE: Runtime metadata (errors, estimates)
 * - CONTROL: Platform-level signals
 *
 * @module db/primitives/connector-framework/airbyte-protocol
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Message types
  type AirbyteMessage,
  type AirbyteRecordMessage,
  type AirbyteStateMessage,
  type AirbyteLogMessage,
  type AirbyteSpecMessage,
  type AirbyteCatalogMessage,
  type AirbyteConnectionStatusMessage,
  type AirbyteTraceMessage,
  type AirbyteControlMessage,
  // State types
  type AirbyteStreamState,
  type AirbyteGlobalState,
  type StateType,
  // Trace types
  type AirbyteErrorTraceMessage,
  type AirbyteEstimateTraceMessage,
  type TraceType,
  type FailureType,
  // Catalog types
  type AirbyteCatalog,
  type AirbyteStream,
  type ConfiguredAirbyteCatalog,
  type ConfiguredAirbyteStream,
  // Spec types
  type ConnectorSpecification,
  // Protocol utilities
  parseAirbyteMessage,
  serializeAirbyteMessage,
  createAirbyteRecord,
  createAirbyteState,
  createAirbyteLog,
  createAirbyteSpec,
  createAirbyteCatalog,
  createAirbyteConnectionStatus,
  createAirbyteTrace,
  createAirbyteControl,
  // Protocol constants
  AIRBYTE_PROTOCOL_VERSION,
} from './airbyte-protocol'

// =============================================================================
// Message Type Tests
// =============================================================================

describe('Airbyte Protocol Messages', () => {
  describe('RECORD message', () => {
    it('should create a valid record message', () => {
      const record = createAirbyteRecord({
        stream: 'users',
        data: { id: 1, name: 'Alice' },
      })

      expect(record.type).toBe('RECORD')
      expect(record.record.stream).toBe('users')
      expect(record.record.data).toEqual({ id: 1, name: 'Alice' })
      expect(record.record.emitted_at).toBeTypeOf('number')
    })

    it('should include namespace when provided', () => {
      const record = createAirbyteRecord({
        stream: 'users',
        namespace: 'public',
        data: { id: 1 },
      })

      expect(record.record.namespace).toBe('public')
    })

    it('should use custom emitted_at timestamp', () => {
      const timestamp = 1704067200000
      const record = createAirbyteRecord({
        stream: 'users',
        data: { id: 1 },
        emitted_at: timestamp,
      })

      expect(record.record.emitted_at).toBe(timestamp)
    })
  })

  describe('STATE message', () => {
    it('should create a STREAM state message', () => {
      const state = createAirbyteState({
        type: 'STREAM',
        stream: {
          stream_descriptor: { name: 'users' },
          stream_state: { cursor: '2024-01-01' },
        },
      })

      expect(state.type).toBe('STATE')
      expect(state.state.type).toBe('STREAM')
      expect(state.state.stream?.stream_descriptor.name).toBe('users')
      expect(state.state.stream?.stream_state).toEqual({ cursor: '2024-01-01' })
    })

    it('should create a GLOBAL state message', () => {
      const state = createAirbyteState({
        type: 'GLOBAL',
        global: {
          shared_state: { transaction_id: 'abc123' },
          stream_states: [
            { stream_descriptor: { name: 'users' }, stream_state: { cursor: 100 } },
            { stream_descriptor: { name: 'orders' }, stream_state: { cursor: 200 } },
          ],
        },
      })

      expect(state.state.type).toBe('GLOBAL')
      expect(state.state.global?.shared_state).toEqual({ transaction_id: 'abc123' })
      expect(state.state.global?.stream_states).toHaveLength(2)
    })

    it('should support LEGACY state for backward compatibility', () => {
      const state = createAirbyteState({
        type: 'LEGACY',
        data: { cursor: 'legacy-cursor-value' },
      })

      expect(state.state.type).toBe('LEGACY')
      expect(state.state.data).toEqual({ cursor: 'legacy-cursor-value' })
    })
  })

  describe('LOG message', () => {
    it('should create log messages with different levels', () => {
      const levels = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const

      for (const level of levels) {
        const log = createAirbyteLog({
          level,
          message: `Test ${level} message`,
        })

        expect(log.type).toBe('LOG')
        expect(log.log.level).toBe(level)
        expect(log.log.message).toBe(`Test ${level} message`)
      }
    })

    it('should include stack trace when provided', () => {
      const log = createAirbyteLog({
        level: 'ERROR',
        message: 'Connection failed',
        stack_trace: 'Error: Connection refused\n  at connect()',
      })

      expect(log.log.stack_trace).toBe('Error: Connection refused\n  at connect()')
    })
  })

  describe('SPEC message', () => {
    it('should create a spec message with connector specification', () => {
      const spec = createAirbyteSpec({
        connectionSpecification: {
          type: 'object',
          required: ['api_key'],
          properties: {
            api_key: { type: 'string', airbyte_secret: true },
          },
        },
      })

      expect(spec.type).toBe('SPEC')
      expect(spec.spec.connectionSpecification.required).toContain('api_key')
    })

    it('should include protocol version', () => {
      const spec = createAirbyteSpec({
        protocol_version: '0.5.2',
        connectionSpecification: { type: 'object', properties: {} },
      })

      expect(spec.spec.protocol_version).toBe('0.5.2')
    })

    it('should include documentation and changelog URLs', () => {
      const spec = createAirbyteSpec({
        connectionSpecification: { type: 'object', properties: {} },
        documentationUrl: 'https://docs.example.com/connector',
        changelogUrl: 'https://github.com/example/connector/blob/main/CHANGELOG.md',
      })

      expect(spec.spec.documentationUrl).toBe('https://docs.example.com/connector')
      expect(spec.spec.changelogUrl).toBe('https://github.com/example/connector/blob/main/CHANGELOG.md')
    })

    it('should include supported sync modes for destinations', () => {
      const spec = createAirbyteSpec({
        connectionSpecification: { type: 'object', properties: {} },
        supported_destination_sync_modes: ['append', 'overwrite', 'append_dedup'],
      })

      expect(spec.spec.supported_destination_sync_modes).toContain('append_dedup')
    })
  })

  describe('CATALOG message', () => {
    it('should create a catalog message with streams', () => {
      const catalog = createAirbyteCatalog({
        streams: [
          {
            name: 'users',
            json_schema: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                email: { type: 'string' },
              },
            },
            supported_sync_modes: ['full_refresh', 'incremental'],
          },
        ],
      })

      expect(catalog.type).toBe('CATALOG')
      expect(catalog.catalog.streams).toHaveLength(1)
      expect(catalog.catalog.streams[0].name).toBe('users')
    })

    it('should include namespace in streams', () => {
      const catalog = createAirbyteCatalog({
        streams: [
          {
            name: 'users',
            namespace: 'public',
            json_schema: { type: 'object', properties: {} },
            supported_sync_modes: ['full_refresh'],
          },
        ],
      })

      expect(catalog.catalog.streams[0].namespace).toBe('public')
    })

    it('should include cursor and primary key metadata', () => {
      const catalog = createAirbyteCatalog({
        streams: [
          {
            name: 'events',
            json_schema: { type: 'object', properties: {} },
            supported_sync_modes: ['incremental'],
            source_defined_cursor: true,
            default_cursor_field: ['created_at'],
            source_defined_primary_key: [['id']],
          },
        ],
      })

      const stream = catalog.catalog.streams[0]
      expect(stream.source_defined_cursor).toBe(true)
      expect(stream.default_cursor_field).toEqual(['created_at'])
      expect(stream.source_defined_primary_key).toEqual([['id']])
    })
  })

  describe('CONNECTION_STATUS message', () => {
    it('should create a successful connection status', () => {
      const status = createAirbyteConnectionStatus({
        status: 'SUCCEEDED',
      })

      expect(status.type).toBe('CONNECTION_STATUS')
      expect(status.connectionStatus.status).toBe('SUCCEEDED')
    })

    it('should create a failed connection status with message', () => {
      const status = createAirbyteConnectionStatus({
        status: 'FAILED',
        message: 'Invalid credentials: authentication failed',
      })

      expect(status.connectionStatus.status).toBe('FAILED')
      expect(status.connectionStatus.message).toBe('Invalid credentials: authentication failed')
    })
  })

  describe('TRACE message', () => {
    it('should create an ERROR trace message', () => {
      const trace = createAirbyteTrace({
        type: 'ERROR',
        error: {
          message: 'Connection timeout',
          internal_message: 'Socket timeout after 30000ms',
          failure_type: 'system_error',
        },
      })

      expect(trace.type).toBe('TRACE')
      expect(trace.trace.type).toBe('ERROR')
      expect(trace.trace.error?.message).toBe('Connection timeout')
      expect(trace.trace.error?.failure_type).toBe('system_error')
      expect(trace.trace.emitted_at).toBeTypeOf('number')
    })

    it('should create an ERROR trace with config_error failure type', () => {
      const trace = createAirbyteTrace({
        type: 'ERROR',
        error: {
          message: 'Invalid API key format',
          failure_type: 'config_error',
        },
      })

      expect(trace.trace.error?.failure_type).toBe('config_error')
    })

    it('should create an ESTIMATE trace message', () => {
      const trace = createAirbyteTrace({
        type: 'ESTIMATE',
        estimate: {
          name: 'users',
          type: 'STREAM',
          row_estimate: 10000,
          byte_estimate: 5000000,
        },
      })

      expect(trace.trace.type).toBe('ESTIMATE')
      expect(trace.trace.estimate?.name).toBe('users')
      expect(trace.trace.estimate?.row_estimate).toBe(10000)
    })

    it('should create a SYNC-level estimate', () => {
      const trace = createAirbyteTrace({
        type: 'ESTIMATE',
        estimate: {
          name: 'total',
          type: 'SYNC',
          row_estimate: 100000,
        },
      })

      expect(trace.trace.estimate?.type).toBe('SYNC')
    })

    it('should include stack trace in error traces', () => {
      const trace = createAirbyteTrace({
        type: 'ERROR',
        error: {
          message: 'Unexpected error',
          stack_trace: 'Error: Unexpected\n  at process()\n  at main()',
        },
      })

      expect(trace.trace.error?.stack_trace).toContain('at process()')
    })
  })

  describe('CONTROL message', () => {
    it('should create a CONNECTOR_CONFIG control message', () => {
      const control = createAirbyteControl({
        type: 'CONNECTOR_CONFIG',
        connectorConfig: {
          config: {
            api_key: 'new-refreshed-key',
            refresh_token: 'new-token',
          },
        },
      })

      expect(control.type).toBe('CONTROL')
      expect(control.control.type).toBe('CONNECTOR_CONFIG')
      expect(control.control.emitted_at).toBeTypeOf('number')
      expect(control.control.connectorConfig?.config).toEqual({
        api_key: 'new-refreshed-key',
        refresh_token: 'new-token',
      })
    })
  })
})

// =============================================================================
// Message Serialization Tests
// =============================================================================

describe('Message Serialization', () => {
  describe('serializeAirbyteMessage', () => {
    it('should serialize message to single-line JSON', () => {
      const record = createAirbyteRecord({
        stream: 'users',
        data: { id: 1, name: 'Alice' },
        emitted_at: 1704067200000,
      })

      const serialized = serializeAirbyteMessage(record)

      // Should be valid JSON
      expect(() => JSON.parse(serialized)).not.toThrow()

      // Should not contain newlines (single-line JSON)
      expect(serialized).not.toContain('\n')

      // Should have correct structure
      const parsed = JSON.parse(serialized)
      expect(parsed.type).toBe('RECORD')
      expect(parsed.record.stream).toBe('users')
    })

    it('should preserve all message fields', () => {
      const state = createAirbyteState({
        type: 'GLOBAL',
        global: {
          shared_state: { lsn: 12345 },
          stream_states: [
            { stream_descriptor: { name: 'users', namespace: 'public' }, stream_state: { cursor: 100 } },
          ],
        },
      })

      const serialized = serializeAirbyteMessage(state)
      const parsed = JSON.parse(serialized)

      expect(parsed.state.global.shared_state.lsn).toBe(12345)
      expect(parsed.state.global.stream_states[0].stream_descriptor.namespace).toBe('public')
    })

    it('should handle special characters in data', () => {
      const record = createAirbyteRecord({
        stream: 'comments',
        data: {
          text: 'Line 1\nLine 2\tTabbed "quoted"',
          unicode: '\u00e9\u00e8\u00ea',
        },
      })

      const serialized = serializeAirbyteMessage(record)
      const parsed = JSON.parse(serialized)

      expect(parsed.record.data.text).toBe('Line 1\nLine 2\tTabbed "quoted"')
      expect(parsed.record.data.unicode).toBe('\u00e9\u00e8\u00ea')
    })
  })

  describe('parseAirbyteMessage', () => {
    it('should parse RECORD message', () => {
      const json = '{"type":"RECORD","record":{"stream":"users","data":{"id":1},"emitted_at":1704067200000}}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('RECORD')
      if (message.type === 'RECORD') {
        expect(message.record.stream).toBe('users')
        expect(message.record.data).toEqual({ id: 1 })
      }
    })

    it('should parse STATE message', () => {
      const json = '{"type":"STATE","state":{"type":"STREAM","stream":{"stream_descriptor":{"name":"users"},"stream_state":{"cursor":100}}}}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('STATE')
      if (message.type === 'STATE') {
        expect(message.state.type).toBe('STREAM')
        expect(message.state.stream?.stream_state).toEqual({ cursor: 100 })
      }
    })

    it('should parse LOG message', () => {
      const json = '{"type":"LOG","log":{"level":"INFO","message":"Sync started"}}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('LOG')
      if (message.type === 'LOG') {
        expect(message.log.level).toBe('INFO')
        expect(message.log.message).toBe('Sync started')
      }
    })

    it('should parse SPEC message', () => {
      const json = '{"type":"SPEC","spec":{"connectionSpecification":{"type":"object","properties":{}}}}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('SPEC')
      if (message.type === 'SPEC') {
        expect(message.spec.connectionSpecification).toBeDefined()
      }
    })

    it('should parse CATALOG message', () => {
      const json = '{"type":"CATALOG","catalog":{"streams":[{"name":"users","json_schema":{"type":"object"},"supported_sync_modes":["full_refresh"]}]}}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('CATALOG')
      if (message.type === 'CATALOG') {
        expect(message.catalog.streams).toHaveLength(1)
      }
    })

    it('should parse CONNECTION_STATUS message', () => {
      const json = '{"type":"CONNECTION_STATUS","connectionStatus":{"status":"SUCCEEDED"}}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('CONNECTION_STATUS')
      if (message.type === 'CONNECTION_STATUS') {
        expect(message.connectionStatus.status).toBe('SUCCEEDED')
      }
    })

    it('should parse TRACE message', () => {
      const json = '{"type":"TRACE","trace":{"type":"ERROR","emitted_at":1704067200000,"error":{"message":"Failed"}}}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('TRACE')
      if (message.type === 'TRACE') {
        expect(message.trace.type).toBe('ERROR')
        expect(message.trace.error?.message).toBe('Failed')
      }
    })

    it('should parse CONTROL message', () => {
      const json = '{"type":"CONTROL","control":{"type":"CONNECTOR_CONFIG","emitted_at":1704067200000,"connectorConfig":{"config":{"key":"value"}}}}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('CONTROL')
      if (message.type === 'CONTROL') {
        expect(message.control.type).toBe('CONNECTOR_CONFIG')
      }
    })

    it('should throw on invalid JSON', () => {
      expect(() => parseAirbyteMessage('not valid json')).toThrow()
    })

    it('should throw on missing type field', () => {
      expect(() => parseAirbyteMessage('{"record":{"stream":"users"}}')).toThrow(/type/)
    })

    it('should throw on unknown message type', () => {
      expect(() => parseAirbyteMessage('{"type":"UNKNOWN"}')).toThrow(/unknown.*type/i)
    })

    it('should allow additional properties (protocol spec requirement)', () => {
      const json = '{"type":"RECORD","record":{"stream":"users","data":{},"emitted_at":0},"extra_field":"allowed"}'
      const message = parseAirbyteMessage(json)

      expect(message.type).toBe('RECORD')
      // Additional properties should be preserved or at least not cause errors
    })
  })

  describe('round-trip serialization', () => {
    it('should preserve data through serialize/parse cycle', () => {
      const original = createAirbyteRecord({
        stream: 'products',
        namespace: 'inventory',
        data: {
          id: 'prod-123',
          name: 'Widget',
          price: 29.99,
          tags: ['electronics', 'gadget'],
          metadata: { weight: 0.5, dimensions: { x: 10, y: 5, z: 3 } },
        },
        emitted_at: 1704067200000,
      })

      const serialized = serializeAirbyteMessage(original)
      const parsed = parseAirbyteMessage(serialized)

      expect(parsed).toEqual(original)
    })

    it('should preserve complex state through cycle', () => {
      const original = createAirbyteState({
        type: 'GLOBAL',
        global: {
          shared_state: { transaction_id: 'tx-abc', lsn: 98765 },
          stream_states: [
            {
              stream_descriptor: { name: 'users', namespace: 'public' },
              stream_state: { cursor: '2024-01-15T10:30:00Z', offset: 1000 },
            },
            {
              stream_descriptor: { name: 'orders' },
              stream_state: { last_id: 500 },
            },
          ],
        },
      })

      const serialized = serializeAirbyteMessage(original)
      const parsed = parseAirbyteMessage(serialized)

      expect(parsed).toEqual(original)
    })
  })
})

// =============================================================================
// Protocol Stream Tests (STDIN/STDOUT simulation)
// =============================================================================

describe('Protocol Stream Handling', () => {
  it('should parse multiple messages from newline-delimited stream', () => {
    const stream = [
      '{"type":"LOG","log":{"level":"INFO","message":"Starting sync"}}',
      '{"type":"RECORD","record":{"stream":"users","data":{"id":1},"emitted_at":1704067200000}}',
      '{"type":"RECORD","record":{"stream":"users","data":{"id":2},"emitted_at":1704067200001}}',
      '{"type":"STATE","state":{"type":"STREAM","stream":{"stream_descriptor":{"name":"users"},"stream_state":{"cursor":2}}}}',
      '{"type":"LOG","log":{"level":"INFO","message":"Sync completed"}}',
    ].join('\n')

    const messages = stream
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => parseAirbyteMessage(line))

    expect(messages).toHaveLength(5)
    expect(messages[0].type).toBe('LOG')
    expect(messages[1].type).toBe('RECORD')
    expect(messages[2].type).toBe('RECORD')
    expect(messages[3].type).toBe('STATE')
    expect(messages[4].type).toBe('LOG')
  })

  it('should serialize messages for stream output', () => {
    const messages: AirbyteMessage[] = [
      createAirbyteLog({ level: 'INFO', message: 'Starting' }),
      createAirbyteRecord({ stream: 'data', data: { id: 1 } }),
      createAirbyteState({ type: 'STREAM', stream: { stream_descriptor: { name: 'data' }, stream_state: {} } }),
    ]

    const output = messages.map(serializeAirbyteMessage).join('\n')

    // Each line should be valid JSON
    const lines = output.split('\n')
    expect(lines).toHaveLength(3)
    lines.forEach((line) => {
      expect(() => JSON.parse(line)).not.toThrow()
    })
  })
})

// =============================================================================
// ConfiguredCatalog Tests
// =============================================================================

describe('ConfiguredAirbyteCatalog', () => {
  it('should define stream configuration for sync', () => {
    const configuredCatalog: ConfiguredAirbyteCatalog = {
      streams: [
        {
          stream: {
            name: 'users',
            json_schema: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                email: { type: 'string' },
                updated_at: { type: 'string', format: 'date-time' },
              },
            },
            supported_sync_modes: ['full_refresh', 'incremental'],
            source_defined_cursor: true,
            default_cursor_field: ['updated_at'],
            source_defined_primary_key: [['id']],
          },
          sync_mode: 'incremental',
          destination_sync_mode: 'append_dedup',
          cursor_field: ['updated_at'],
          primary_key: [['id']],
        },
      ],
    }

    expect(configuredCatalog.streams[0].sync_mode).toBe('incremental')
    expect(configuredCatalog.streams[0].destination_sync_mode).toBe('append_dedup')
    expect(configuredCatalog.streams[0].cursor_field).toEqual(['updated_at'])
    expect(configuredCatalog.streams[0].primary_key).toEqual([['id']])
  })

  it('should support composite primary keys', () => {
    const configuredCatalog: ConfiguredAirbyteCatalog = {
      streams: [
        {
          stream: {
            name: 'order_items',
            json_schema: { type: 'object', properties: {} },
            supported_sync_modes: ['full_refresh'],
            source_defined_primary_key: [['order_id'], ['product_id']],
          },
          sync_mode: 'full_refresh',
          destination_sync_mode: 'overwrite',
          primary_key: [['order_id'], ['product_id']],
        },
      ],
    }

    expect(configuredCatalog.streams[0].primary_key).toEqual([['order_id'], ['product_id']])
  })

  it('should support nested cursor fields', () => {
    const configuredCatalog: ConfiguredAirbyteCatalog = {
      streams: [
        {
          stream: {
            name: 'events',
            json_schema: { type: 'object', properties: {} },
            supported_sync_modes: ['incremental'],
          },
          sync_mode: 'incremental',
          destination_sync_mode: 'append',
          cursor_field: ['metadata', 'timestamp'],
        },
      ],
    }

    expect(configuredCatalog.streams[0].cursor_field).toEqual(['metadata', 'timestamp'])
  })
})

// =============================================================================
// Protocol Version Tests
// =============================================================================

describe('Protocol Version', () => {
  it('should export protocol version constant', () => {
    expect(AIRBYTE_PROTOCOL_VERSION).toBeDefined()
    expect(typeof AIRBYTE_PROTOCOL_VERSION).toBe('string')
    // Should be in semver format
    expect(AIRBYTE_PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('should include protocol version in spec messages by default', () => {
    const spec = createAirbyteSpec({
      connectionSpecification: { type: 'object', properties: {} },
    })

    // If no explicit version, should use default
    expect(spec.spec.protocol_version).toBeDefined()
  })
})

// =============================================================================
// Type Guard Tests
// =============================================================================

describe('Message Type Guards', () => {
  it('should correctly identify RECORD messages', () => {
    const record = createAirbyteRecord({ stream: 'test', data: {} })
    expect(record.type).toBe('RECORD')
  })

  it('should correctly identify STATE messages', () => {
    const state = createAirbyteState({ type: 'STREAM', stream: { stream_descriptor: { name: 'test' } } })
    expect(state.type).toBe('STATE')
  })

  it('should correctly identify LOG messages', () => {
    const log = createAirbyteLog({ level: 'INFO', message: 'test' })
    expect(log.type).toBe('LOG')
  })

  it('should correctly identify SPEC messages', () => {
    const spec = createAirbyteSpec({ connectionSpecification: { type: 'object', properties: {} } })
    expect(spec.type).toBe('SPEC')
  })

  it('should correctly identify CATALOG messages', () => {
    const catalog = createAirbyteCatalog({ streams: [] })
    expect(catalog.type).toBe('CATALOG')
  })

  it('should correctly identify CONNECTION_STATUS messages', () => {
    const status = createAirbyteConnectionStatus({ status: 'SUCCEEDED' })
    expect(status.type).toBe('CONNECTION_STATUS')
  })

  it('should correctly identify TRACE messages', () => {
    const trace = createAirbyteTrace({ type: 'ERROR', error: { message: 'test' } })
    expect(trace.type).toBe('TRACE')
  })

  it('should correctly identify CONTROL messages', () => {
    const control = createAirbyteControl({ type: 'CONNECTOR_CONFIG', connectorConfig: { config: {} } })
    expect(control.type).toBe('CONTROL')
  })
})

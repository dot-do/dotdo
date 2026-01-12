/**
 * ConnectorFramework - Universal source/destination adapters tests
 *
 * TDD RED phase: These tests define the expected behavior for:
 * - Source connectors: Read from external systems (pull-based)
 * - Destination connectors: Write to external systems (push-based)
 * - Transforms: Data transformations between source/dest schemas
 * - Sync: Full and incremental sync modes
 * - State: Cursor tracking, checkpointing
 *
 * @module db/primitives/connector-framework
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  // Core types
  type ConnectorSpec,
  type ConfigSpec,
  type PropertySpec,
  type ConnectionStatus,
  // Source types
  type SourceConnector,
  type SourceConfig,
  type Stream,
  type StreamSchema,
  type SyncMode,
  type AirbyteMessage,
  type RecordMessage,
  type StateMessage,
  type LogMessage,
  // Destination types
  type DestinationConnector,
  type DestinationConfig,
  type WriteResult,
  // Transform types
  type Transform,
  type FieldMapping,
  type TypeCoercion,
  // Sync types
  type SyncConfig,
  type SyncPipeline,
  type SyncResult,
  type SyncState,
  // Framework
  ConnectorFramework,
  createConnectorFramework,
  // Helpers
  createSourceConnector,
  createDestinationConnector,
  createTransform,
} from './index'

// =============================================================================
// ConnectorSpec Tests
// =============================================================================

describe('ConnectorSpec', () => {
  describe('ConfigSpec validation', () => {
    it('should define required configuration properties', () => {
      const spec: ConfigSpec = {
        type: 'object',
        required: ['host', 'port', 'database'],
        properties: {
          host: { type: 'string', description: 'Database hostname' },
          port: { type: 'integer', description: 'Database port' },
          database: { type: 'string', description: 'Database name' },
          username: { type: 'string', description: 'Username' },
          password: { type: 'string', description: 'Password', secret: true },
        },
      }

      expect(spec.required).toContain('host')
      expect(spec.properties.password?.secret).toBe(true)
    })

    it('should support nested configuration', () => {
      const spec: ConfigSpec = {
        type: 'object',
        required: ['connection'],
        properties: {
          connection: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              ssl: {
                type: 'object',
                properties: {
                  enabled: { type: 'boolean' },
                  ca: { type: 'string', secret: true },
                },
              },
            },
          },
        },
      }

      expect(spec.properties.connection?.type).toBe('object')
    })

    it('should support OAuth configuration', () => {
      const spec: ConfigSpec = {
        type: 'object',
        required: ['credentials'],
        properties: {
          credentials: {
            type: 'object',
            oneOf: [
              {
                type: 'object',
                title: 'API Key',
                properties: {
                  auth_type: { const: 'api_key' },
                  api_key: { type: 'string', secret: true },
                },
              },
              {
                type: 'object',
                title: 'OAuth 2.0',
                properties: {
                  auth_type: { const: 'oauth2' },
                  client_id: { type: 'string' },
                  client_secret: { type: 'string', secret: true },
                  refresh_token: { type: 'string', secret: true },
                },
              },
            ],
          },
        },
      }

      expect(spec.properties.credentials?.oneOf).toHaveLength(2)
    })
  })
})

// =============================================================================
// Source Connector Tests
// =============================================================================

describe('SourceConnector', () => {
  describe('spec()', () => {
    it('should return connector specification', async () => {
      const source = createSourceConnector({
        name: 'test-source',
        spec: async () => ({
          name: 'Test Source',
          version: '1.0.0',
          configSpec: {
            type: 'object',
            required: ['api_key'],
            properties: {
              api_key: { type: 'string', secret: true },
            },
          },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [],
        read: async function* () {},
      })

      const spec = await source.spec()

      expect(spec.name).toBe('Test Source')
      expect(spec.version).toBe('1.0.0')
      expect(spec.configSpec.required).toContain('api_key')
    })
  })

  describe('check()', () => {
    it('should validate connection successfully', async () => {
      const source = createSourceConnector({
        name: 'test-source',
        spec: async () => ({
          name: 'Test Source',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async (config) => {
          if (config.api_key === 'valid-key') {
            return { status: 'SUCCEEDED' }
          }
          return { status: 'FAILED', message: 'Invalid API key' }
        },
        discover: async () => [],
        read: async function* () {},
      })

      const successResult = await source.check({ api_key: 'valid-key' })
      expect(successResult.status).toBe('SUCCEEDED')

      const failResult = await source.check({ api_key: 'invalid' })
      expect(failResult.status).toBe('FAILED')
      expect(failResult.message).toContain('Invalid')
    })
  })

  describe('discover()', () => {
    it('should return available streams', async () => {
      const source = createSourceConnector({
        name: 'postgres-source',
        spec: async () => ({
          name: 'PostgreSQL',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async (config) => {
          return [
            {
              name: 'users',
              namespace: 'public',
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  email: { type: 'string' },
                  created_at: { type: 'string', format: 'date-time' },
                },
              },
              supportedSyncModes: ['full_refresh', 'incremental'],
              sourceDefinedPrimaryKey: [['id']],
              sourceDefinedCursor: true,
              defaultCursorField: ['created_at'],
            },
            {
              name: 'orders',
              namespace: 'public',
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  user_id: { type: 'integer' },
                  total: { type: 'number' },
                  status: { type: 'string' },
                },
              },
              supportedSyncModes: ['full_refresh', 'incremental'],
              sourceDefinedPrimaryKey: [['id']],
            },
          ]
        },
        read: async function* () {},
      })

      const streams = await source.discover({ connection_string: 'postgres://...' })

      expect(streams).toHaveLength(2)
      expect(streams[0].name).toBe('users')
      expect(streams[0].supportedSyncModes).toContain('incremental')
      expect(streams[0].sourceDefinedPrimaryKey).toEqual([['id']])
    })

    it('should include schema with nested objects', async () => {
      const source = createSourceConnector({
        name: 'api-source',
        spec: async () => ({
          name: 'API Source',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          {
            name: 'contacts',
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                address: {
                  type: 'object',
                  properties: {
                    street: { type: 'string' },
                    city: { type: 'string' },
                    country: { type: 'string' },
                  },
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
            supportedSyncModes: ['full_refresh'],
          },
        ],
        read: async function* () {},
      })

      const streams = await source.discover({})
      const contactsStream = streams[0]

      expect(contactsStream.schema.properties.address?.type).toBe('object')
      expect(contactsStream.schema.properties.tags?.type).toBe('array')
    })
  })

  describe('read()', () => {
    it('should emit records from source', async () => {
      const mockData = [
        { id: 1, email: 'alice@example.com' },
        { id: 2, email: 'bob@example.com' },
        { id: 3, email: 'charlie@example.com' },
      ]

      const source = createSourceConnector({
        name: 'test-source',
        spec: async () => ({
          name: 'Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'users', schema: { type: 'object', properties: {} }, supportedSyncModes: ['full_refresh'] },
        ],
        read: async function* (config, catalog, state) {
          for (const record of mockData) {
            yield {
              type: 'RECORD',
              record: {
                stream: 'users',
                data: record,
                emittedAt: Date.now(),
              },
            }
          }
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const message of source.read({}, { streams: [{ name: 'users', syncMode: 'full_refresh' }] })) {
        messages.push(message)
      }

      expect(messages).toHaveLength(3)
      expect(messages[0].type).toBe('RECORD')
      expect((messages[0] as RecordMessage).record.data).toEqual({ id: 1, email: 'alice@example.com' })
    })

    it('should emit state checkpoints', async () => {
      const source = createSourceConnector({
        name: 'test-source',
        spec: async () => ({
          name: 'Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'users', schema: { type: 'object', properties: {} }, supportedSyncModes: ['incremental'] },
        ],
        read: async function* (config, catalog, state) {
          yield { type: 'RECORD', record: { stream: 'users', data: { id: 1 }, emittedAt: Date.now() } }
          yield { type: 'RECORD', record: { stream: 'users', data: { id: 2 }, emittedAt: Date.now() } }
          yield {
            type: 'STATE',
            state: {
              type: 'STREAM',
              stream: { streamDescriptor: { name: 'users' }, streamState: { cursor: 2 } },
            },
          }
          yield { type: 'RECORD', record: { stream: 'users', data: { id: 3 }, emittedAt: Date.now() } }
          yield {
            type: 'STATE',
            state: {
              type: 'STREAM',
              stream: { streamDescriptor: { name: 'users' }, streamState: { cursor: 3 } },
            },
          }
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const message of source.read({}, { streams: [{ name: 'users', syncMode: 'incremental' }] })) {
        messages.push(message)
      }

      const stateMessages = messages.filter((m): m is StateMessage => m.type === 'STATE')
      expect(stateMessages).toHaveLength(2)
      expect(stateMessages[1].state.stream?.streamState.cursor).toBe(3)
    })

    it('should resume from previous state', async () => {
      const allRecords = [
        { id: 1, updated_at: '2024-01-01' },
        { id: 2, updated_at: '2024-01-02' },
        { id: 3, updated_at: '2024-01-03' },
        { id: 4, updated_at: '2024-01-04' },
      ]

      const source = createSourceConnector({
        name: 'test-source',
        spec: async () => ({
          name: 'Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'items', schema: { type: 'object', properties: {} }, supportedSyncModes: ['incremental'] },
        ],
        read: async function* (config, catalog, state) {
          const cursor = state?.streams?.items?.cursor ?? '1970-01-01'
          const filteredRecords = allRecords.filter((r) => r.updated_at > cursor)

          for (const record of filteredRecords) {
            yield {
              type: 'RECORD',
              record: { stream: 'items', data: record, emittedAt: Date.now() },
            }
          }

          if (filteredRecords.length > 0) {
            yield {
              type: 'STATE',
              state: {
                type: 'STREAM',
                stream: {
                  streamDescriptor: { name: 'items' },
                  streamState: { cursor: filteredRecords[filteredRecords.length - 1].updated_at },
                },
              },
            }
          }
        },
      })

      // First sync - gets all records
      const firstSyncMessages: AirbyteMessage[] = []
      for await (const message of source.read({}, { streams: [{ name: 'items', syncMode: 'incremental' }] })) {
        firstSyncMessages.push(message)
      }
      expect(firstSyncMessages.filter((m) => m.type === 'RECORD')).toHaveLength(4)

      // Second sync with state - only new records
      const resumeState = { streams: { items: { cursor: '2024-01-02' } } }
      const secondSyncMessages: AirbyteMessage[] = []
      for await (const message of source.read(
        {},
        { streams: [{ name: 'items', syncMode: 'incremental' }] },
        resumeState,
      )) {
        secondSyncMessages.push(message)
      }
      expect(secondSyncMessages.filter((m) => m.type === 'RECORD')).toHaveLength(2)
    })

    it('should emit log messages', async () => {
      const source = createSourceConnector({
        name: 'test-source',
        spec: async () => ({
          name: 'Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [],
        read: async function* () {
          yield { type: 'LOG', log: { level: 'INFO', message: 'Starting sync' } }
          yield { type: 'LOG', log: { level: 'WARN', message: 'Rate limited, retrying...' } }
          yield { type: 'LOG', log: { level: 'INFO', message: 'Sync completed' } }
        },
      })

      const messages: AirbyteMessage[] = []
      for await (const message of source.read({}, { streams: [] })) {
        messages.push(message)
      }

      expect(messages).toHaveLength(3)
      expect(messages.every((m) => m.type === 'LOG')).toBe(true)
    })
  })
})

// =============================================================================
// Destination Connector Tests
// =============================================================================

describe('DestinationConnector', () => {
  describe('spec()', () => {
    it('should return destination specification', async () => {
      const destination = createDestinationConnector({
        name: 'test-destination',
        spec: async () => ({
          name: 'Test Destination',
          version: '1.0.0',
          configSpec: {
            type: 'object',
            required: ['connection_string'],
            properties: {
              connection_string: { type: 'string', secret: true },
            },
          },
          supportedSyncModes: ['overwrite', 'append', 'append_dedup'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* () {},
      })

      const spec = await destination.spec()
      expect(spec.name).toBe('Test Destination')
      expect(spec.supportedSyncModes).toContain('append_dedup')
    })
  })

  describe('check()', () => {
    it('should validate destination connection', async () => {
      const destination = createDestinationConnector({
        name: 'test-destination',
        spec: async () => ({
          name: 'Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['overwrite'],
        }),
        check: async (config) => {
          if (config.bucket === 'valid-bucket') {
            return { status: 'SUCCEEDED' }
          }
          return { status: 'FAILED', message: 'Bucket not found' }
        },
        write: async function* () {},
      })

      const result = await destination.check({ bucket: 'invalid-bucket' })
      expect(result.status).toBe('FAILED')
    })
  })

  describe('write()', () => {
    it('should write records to destination', async () => {
      const writtenRecords: Array<{ stream: string; data: unknown }> = []

      const destination = createDestinationConnector({
        name: 'test-destination',
        spec: async () => ({
          name: 'Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['append'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* (config, catalog, messages) {
          for await (const message of messages) {
            if (message.type === 'RECORD') {
              writtenRecords.push({
                stream: message.record.stream,
                data: message.record.data,
              })
            }
            if (message.type === 'STATE') {
              yield message
            }
          }
        },
      })

      const inputMessages: AsyncIterable<AirbyteMessage> = (async function* () {
        yield { type: 'RECORD', record: { stream: 'users', data: { id: 1 }, emittedAt: Date.now() } }
        yield { type: 'RECORD', record: { stream: 'users', data: { id: 2 }, emittedAt: Date.now() } }
        yield { type: 'STATE', state: { type: 'GLOBAL', global: { streamStates: [], sharedState: { cursor: 2 } } } }
      })()

      const outputMessages: AirbyteMessage[] = []
      for await (const message of destination.write({}, { streams: [] }, inputMessages)) {
        outputMessages.push(message)
      }

      expect(writtenRecords).toHaveLength(2)
      expect(outputMessages.filter((m) => m.type === 'STATE')).toHaveLength(1)
    })

    it('should handle batched writes', async () => {
      const batchWrites: Array<unknown[]> = []

      const destination = createDestinationConnector({
        name: 'batch-destination',
        spec: async () => ({
          name: 'Batch Destination',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['append'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* (config, catalog, messages) {
          let batch: unknown[] = []
          const batchSize = 2

          for await (const message of messages) {
            if (message.type === 'RECORD') {
              batch.push(message.record.data)
              if (batch.length >= batchSize) {
                batchWrites.push([...batch])
                batch = []
              }
            }
            if (message.type === 'STATE') {
              if (batch.length > 0) {
                batchWrites.push([...batch])
                batch = []
              }
              yield message
            }
          }

          if (batch.length > 0) {
            batchWrites.push(batch)
          }
        },
      })

      const inputMessages: AsyncIterable<AirbyteMessage> = (async function* () {
        yield { type: 'RECORD', record: { stream: 'items', data: { id: 1 }, emittedAt: Date.now() } }
        yield { type: 'RECORD', record: { stream: 'items', data: { id: 2 }, emittedAt: Date.now() } }
        yield { type: 'RECORD', record: { stream: 'items', data: { id: 3 }, emittedAt: Date.now() } }
        yield { type: 'STATE', state: { type: 'GLOBAL', global: { streamStates: [], sharedState: {} } } }
      })()

      const outputMessages: AirbyteMessage[] = []
      for await (const message of destination.write({}, { streams: [] }, inputMessages)) {
        outputMessages.push(message)
      }

      expect(batchWrites).toHaveLength(2) // [id:1, id:2] and [id:3]
      expect(batchWrites[0]).toHaveLength(2)
      expect(batchWrites[1]).toHaveLength(1)
    })
  })
})

// =============================================================================
// Transform Tests
// =============================================================================

describe('Transform', () => {
  describe('field mapping', () => {
    it('should rename fields', () => {
      const transform = createTransform({
        mappings: [
          { source: 'id', destination: 'user_id' },
          { source: 'email', destination: 'email_address' },
        ],
      })

      const input = { id: 1, email: 'test@example.com', name: 'Test' }
      const output = transform.apply(input)

      expect(output).toEqual({
        user_id: 1,
        email_address: 'test@example.com',
        name: 'Test',
      })
    })

    it('should handle nested field paths', () => {
      const transform = createTransform({
        mappings: [
          { source: 'address.street', destination: 'street_address' },
          { source: 'address.city', destination: 'city' },
        ],
      })

      const input = {
        id: 1,
        address: { street: '123 Main St', city: 'NYC', zip: '10001' },
      }
      const output = transform.apply(input)

      expect(output).toEqual({
        id: 1,
        street_address: '123 Main St',
        city: 'NYC',
        address: { street: '123 Main St', city: 'NYC', zip: '10001' },
      })
    })

    it('should flatten nested objects', () => {
      const transform = createTransform({
        flatten: true,
        separator: '_',
      })

      const input = {
        id: 1,
        metadata: {
          created: '2024-01-01',
          updated: '2024-01-02',
        },
      }
      const output = transform.apply(input)

      expect(output).toEqual({
        id: 1,
        metadata_created: '2024-01-01',
        metadata_updated: '2024-01-02',
      })
    })
  })

  describe('type coercion', () => {
    it('should coerce string to number', () => {
      const transform = createTransform({
        coercions: [{ field: 'amount', targetType: 'number' }],
      })

      const input = { id: 1, amount: '99.99' }
      const output = transform.apply(input)

      expect(output.amount).toBe(99.99)
      expect(typeof output.amount).toBe('number')
    })

    it('should coerce number to string', () => {
      const transform = createTransform({
        coercions: [{ field: 'zip_code', targetType: 'string' }],
      })

      const input = { id: 1, zip_code: 10001 }
      const output = transform.apply(input)

      expect(output.zip_code).toBe('10001')
    })

    it('should parse date strings', () => {
      const transform = createTransform({
        coercions: [{ field: 'created_at', targetType: 'date' }],
      })

      const input = { id: 1, created_at: '2024-01-15T10:30:00Z' }
      const output = transform.apply(input)

      expect(output.created_at).toBeInstanceOf(Date)
      expect((output.created_at as Date).toISOString()).toBe('2024-01-15T10:30:00.000Z')
    })

    it('should coerce to boolean', () => {
      const transform = createTransform({
        coercions: [{ field: 'is_active', targetType: 'boolean' }],
      })

      expect(transform.apply({ is_active: 1 }).is_active).toBe(true)
      expect(transform.apply({ is_active: 0 }).is_active).toBe(false)
      expect(transform.apply({ is_active: 'true' }).is_active).toBe(true)
      expect(transform.apply({ is_active: 'false' }).is_active).toBe(false)
      expect(transform.apply({ is_active: '' }).is_active).toBe(false)
    })
  })

  describe('computed fields', () => {
    it('should create computed fields', () => {
      const transform = createTransform({
        computed: [
          {
            name: 'full_name',
            expression: (record) => `${record.first_name} ${record.last_name}`,
          },
        ],
      })

      const input = { first_name: 'John', last_name: 'Doe' }
      const output = transform.apply(input)

      expect(output.full_name).toBe('John Doe')
    })
  })

  describe('field filtering', () => {
    it('should include only specified fields', () => {
      const transform = createTransform({
        include: ['id', 'name'],
      })

      const input = { id: 1, name: 'Test', secret: 'hidden', extra: 'data' }
      const output = transform.apply(input)

      expect(output).toEqual({ id: 1, name: 'Test' })
    })

    it('should exclude specified fields', () => {
      const transform = createTransform({
        exclude: ['password', 'secret'],
      })

      const input = { id: 1, name: 'Test', password: 'abc123', secret: 'xyz' }
      const output = transform.apply(input)

      expect(output).toEqual({ id: 1, name: 'Test' })
    })
  })
})

// =============================================================================
// Sync Pipeline Tests
// =============================================================================

describe('SyncPipeline', () => {
  describe('full refresh sync', () => {
    it('should sync all records in full refresh mode', async () => {
      const sourceRecords = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ]

      const destinationRecords: unknown[] = []

      const framework = createConnectorFramework()

      framework.registerSource('mock-source', {
        spec: async () => ({
          name: 'Mock Source',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'users', schema: { type: 'object', properties: {} }, supportedSyncModes: ['full_refresh'] },
        ],
        read: async function* () {
          for (const record of sourceRecords) {
            yield { type: 'RECORD', record: { stream: 'users', data: record, emittedAt: Date.now() } }
          }
        },
      })

      framework.registerDestination('mock-destination', {
        spec: async () => ({
          name: 'Mock Destination',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['overwrite'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* (config, catalog, messages) {
          for await (const message of messages) {
            if (message.type === 'RECORD') {
              destinationRecords.push(message.record.data)
            }
            if (message.type === 'STATE') {
              yield message
            }
          }
        },
      })

      const sync = framework.createSync({
        source: { type: 'mock-source', config: {} },
        destination: { type: 'mock-destination', config: {} },
        streams: [{ name: 'users', syncMode: 'full_refresh', destinationSyncMode: 'overwrite' }],
      })

      const result = await sync.run()

      expect(result.recordsSynced).toBe(3)
      expect(destinationRecords).toHaveLength(3)
    })
  })

  describe('incremental sync', () => {
    it('should sync only new records with cursor', async () => {
      const allRecords = [
        { id: 1, updated_at: '2024-01-01T00:00:00Z' },
        { id: 2, updated_at: '2024-01-02T00:00:00Z' },
        { id: 3, updated_at: '2024-01-03T00:00:00Z' },
        { id: 4, updated_at: '2024-01-04T00:00:00Z' },
      ]

      const framework = createConnectorFramework()

      framework.registerSource('incremental-source', {
        spec: async () => ({
          name: 'Incremental Source',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          {
            name: 'items',
            schema: { type: 'object', properties: {} },
            supportedSyncModes: ['incremental'],
            defaultCursorField: ['updated_at'],
          },
        ],
        read: async function* (config, catalog, state) {
          const cursor = state?.streams?.items?.cursor ?? '1970-01-01T00:00:00Z'
          const newRecords = allRecords.filter((r) => r.updated_at > cursor)

          for (const record of newRecords) {
            yield { type: 'RECORD', record: { stream: 'items', data: record, emittedAt: Date.now() } }
          }

          if (newRecords.length > 0) {
            const lastRecord = newRecords[newRecords.length - 1]
            yield {
              type: 'STATE',
              state: {
                type: 'STREAM',
                stream: {
                  streamDescriptor: { name: 'items' },
                  streamState: { cursor: lastRecord.updated_at },
                },
              },
            }
          }
        },
      })

      framework.registerDestination('append-destination', {
        spec: async () => ({
          name: 'Append Destination',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['append'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* (config, catalog, messages) {
          for await (const message of messages) {
            if (message.type === 'STATE') {
              yield message
            }
          }
        },
      })

      const sync = framework.createSync({
        source: { type: 'incremental-source', config: {} },
        destination: { type: 'append-destination', config: {} },
        streams: [
          { name: 'items', syncMode: 'incremental', destinationSyncMode: 'append', cursorField: ['updated_at'] },
        ],
      })

      // First sync
      const result1 = await sync.run()
      expect(result1.recordsSynced).toBe(4)

      // Second sync with state from first
      const state = await sync.getState()
      expect(state.streams.items.cursor).toBe('2024-01-04T00:00:00Z')

      // Simulate adding new records
      allRecords.push({ id: 5, updated_at: '2024-01-05T00:00:00Z' })

      const result2 = await sync.run()
      expect(result2.recordsSynced).toBe(1)
    })
  })

  describe('transforms in pipeline', () => {
    it('should apply transforms during sync', async () => {
      const destinationRecords: unknown[] = []

      const framework = createConnectorFramework()

      framework.registerSource('transform-source', {
        spec: async () => ({
          name: 'Transform Source',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'users', schema: { type: 'object', properties: {} }, supportedSyncModes: ['full_refresh'] },
        ],
        read: async function* () {
          yield { type: 'RECORD', record: { stream: 'users', data: { id: 1, email: 'test@example.com' }, emittedAt: Date.now() } }
        },
      })

      framework.registerDestination('transform-destination', {
        spec: async () => ({
          name: 'Transform Destination',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['append'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* (config, catalog, messages) {
          for await (const message of messages) {
            if (message.type === 'RECORD') {
              destinationRecords.push(message.record.data)
            }
          }
        },
      })

      const sync = framework.createSync({
        source: { type: 'transform-source', config: {} },
        destination: { type: 'transform-destination', config: {} },
        streams: [{ name: 'users', syncMode: 'full_refresh', destinationSyncMode: 'append' }],
        transforms: [
          {
            stream: 'users',
            transform: createTransform({
              mappings: [{ source: 'id', destination: 'user_id' }],
            }),
          },
        ],
      })

      await sync.run()

      expect(destinationRecords[0]).toHaveProperty('user_id')
    })
  })

  describe('sync result and state', () => {
    it('should return sync statistics', async () => {
      const framework = createConnectorFramework()

      framework.registerSource('stats-source', {
        spec: async () => ({ name: 'Stats Source', version: '1.0.0', configSpec: { type: 'object', properties: {} } }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'large_table', schema: { type: 'object', properties: {} }, supportedSyncModes: ['full_refresh'] },
        ],
        read: async function* () {
          for (let i = 0; i < 1000; i++) {
            yield { type: 'RECORD', record: { stream: 'large_table', data: { id: i, payload: 'x'.repeat(100) }, emittedAt: Date.now() } }
          }
        },
      })

      framework.registerDestination('stats-destination', {
        spec: async () => ({
          name: 'Stats Destination',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['overwrite'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* (config, catalog, messages) {
          for await (const message of messages) {
            if (message.type === 'STATE') yield message
          }
        },
      })

      const sync = framework.createSync({
        source: { type: 'stats-source', config: {} },
        destination: { type: 'stats-destination', config: {} },
        streams: [{ name: 'large_table', syncMode: 'full_refresh', destinationSyncMode: 'overwrite' }],
      })

      const result = await sync.run()

      expect(result.recordsSynced).toBe(1000)
      expect(result.bytesProcessed).toBeGreaterThan(0)
      expect(result.duration).toBeGreaterThan(0)
      expect(result.status).toBe('completed')
    })

    it('should persist and retrieve state', async () => {
      const framework = createConnectorFramework()

      framework.registerSource('state-source', {
        spec: async () => ({ name: 'State Source', version: '1.0.0', configSpec: { type: 'object', properties: {} } }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'stream1', schema: { type: 'object', properties: {} }, supportedSyncModes: ['incremental'] },
          { name: 'stream2', schema: { type: 'object', properties: {} }, supportedSyncModes: ['incremental'] },
        ],
        read: async function* () {
          yield { type: 'RECORD', record: { stream: 'stream1', data: { id: 1 }, emittedAt: Date.now() } }
          yield {
            type: 'STATE',
            state: {
              type: 'STREAM',
              stream: { streamDescriptor: { name: 'stream1' }, streamState: { cursor: 100 } },
            },
          }
          yield { type: 'RECORD', record: { stream: 'stream2', data: { id: 2 }, emittedAt: Date.now() } }
          yield {
            type: 'STATE',
            state: {
              type: 'STREAM',
              stream: { streamDescriptor: { name: 'stream2' }, streamState: { cursor: 200 } },
            },
          }
        },
      })

      framework.registerDestination('state-destination', {
        spec: async () => ({
          name: 'State Destination',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['append'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* (config, catalog, messages) {
          for await (const message of messages) {
            if (message.type === 'STATE') yield message
          }
        },
      })

      const sync = framework.createSync({
        source: { type: 'state-source', config: {} },
        destination: { type: 'state-destination', config: {} },
        streams: [
          { name: 'stream1', syncMode: 'incremental', destinationSyncMode: 'append' },
          { name: 'stream2', syncMode: 'incremental', destinationSyncMode: 'append' },
        ],
      })

      await sync.run()
      const state = await sync.getState()

      expect(state.streams.stream1.cursor).toBe(100)
      expect(state.streams.stream2.cursor).toBe(200)
    })
  })

  describe('error handling', () => {
    it('should handle source errors gracefully', async () => {
      const framework = createConnectorFramework()

      framework.registerSource('error-source', {
        spec: async () => ({ name: 'Error Source', version: '1.0.0', configSpec: { type: 'object', properties: {} } }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'items', schema: { type: 'object', properties: {} }, supportedSyncModes: ['full_refresh'] },
        ],
        read: async function* () {
          yield { type: 'RECORD', record: { stream: 'items', data: { id: 1 }, emittedAt: Date.now() } }
          throw new Error('Connection lost')
        },
      })

      framework.registerDestination('error-destination', {
        spec: async () => ({
          name: 'Error Destination',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['append'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* (config, catalog, messages) {
          for await (const message of messages) {
            if (message.type === 'STATE') yield message
          }
        },
      })

      const sync = framework.createSync({
        source: { type: 'error-source', config: {} },
        destination: { type: 'error-destination', config: {} },
        streams: [{ name: 'items', syncMode: 'full_refresh', destinationSyncMode: 'append' }],
      })

      const result = await sync.run()

      expect(result.status).toBe('failed')
      expect(result.error).toMatch(/Connection lost/)
      expect(result.recordsSynced).toBe(1) // Should have synced one record before error
    })
  })
})

// =============================================================================
// ConnectorFramework Tests
// =============================================================================

describe('ConnectorFramework', () => {
  let framework: ConnectorFramework

  beforeEach(() => {
    framework = createConnectorFramework()
  })

  describe('connector registration', () => {
    it('should register and retrieve source connectors', () => {
      framework.registerSource('my-source', {
        spec: async () => ({ name: 'My Source', version: '1.0.0', configSpec: { type: 'object', properties: {} } }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [],
        read: async function* () {},
      })

      const source = framework.getSource('my-source')
      expect(source).toBeDefined()
    })

    it('should register and retrieve destination connectors', () => {
      framework.registerDestination('my-destination', {
        spec: async () => ({
          name: 'My Destination',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['append'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* () {},
      })

      const destination = framework.getDestination('my-destination')
      expect(destination).toBeDefined()
    })

    it('should throw for unregistered connectors', () => {
      expect(() => framework.getSource('unknown')).toThrow(/not found/i)
      expect(() => framework.getDestination('unknown')).toThrow(/not found/i)
    })

    it('should list registered connectors', () => {
      framework.registerSource('source-a', {
        spec: async () => ({ name: 'A', version: '1.0.0', configSpec: { type: 'object', properties: {} } }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [],
        read: async function* () {},
      })
      framework.registerSource('source-b', {
        spec: async () => ({ name: 'B', version: '1.0.0', configSpec: { type: 'object', properties: {} } }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [],
        read: async function* () {},
      })

      const sources = framework.listSources()
      expect(sources).toContain('source-a')
      expect(sources).toContain('source-b')
    })
  })

  describe('sync creation', () => {
    beforeEach(() => {
      framework.registerSource('test-source', {
        spec: async () => ({ name: 'Test', version: '1.0.0', configSpec: { type: 'object', properties: {} } }),
        check: async () => ({ status: 'SUCCEEDED' }),
        discover: async () => [
          { name: 'users', schema: { type: 'object', properties: {} }, supportedSyncModes: ['full_refresh'] },
        ],
        read: async function* () {},
      })
      framework.registerDestination('test-destination', {
        spec: async () => ({
          name: 'Test',
          version: '1.0.0',
          configSpec: { type: 'object', properties: {} },
          supportedSyncModes: ['append'],
        }),
        check: async () => ({ status: 'SUCCEEDED' }),
        write: async function* () {},
      })
    })

    it('should create a sync pipeline', () => {
      const sync = framework.createSync({
        source: { type: 'test-source', config: {} },
        destination: { type: 'test-destination', config: {} },
        streams: [{ name: 'users', syncMode: 'full_refresh', destinationSyncMode: 'append' }],
      })

      expect(sync).toBeDefined()
      expect(sync.run).toBeInstanceOf(Function)
      expect(sync.getState).toBeInstanceOf(Function)
    })

    it('should validate sync configuration', () => {
      expect(() =>
        framework.createSync({
          source: { type: 'unknown-source', config: {} },
          destination: { type: 'test-destination', config: {} },
          streams: [],
        }),
      ).toThrow(/source.*not found/i)

      expect(() =>
        framework.createSync({
          source: { type: 'test-source', config: {} },
          destination: { type: 'unknown-destination', config: {} },
          streams: [],
        }),
      ).toThrow(/destination.*not found/i)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('ConnectorFramework Integration', () => {
  it('should run complete ETL pipeline', async () => {
    // Simulate a real-world ETL scenario
    const sourceData = [
      { user_id: '1', first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', created_at: '2024-01-01' },
      { user_id: '2', first_name: 'Bob', last_name: 'Jones', email: 'bob@example.com', created_at: '2024-01-02' },
      { user_id: '3', first_name: 'Charlie', last_name: 'Brown', email: 'charlie@example.com', created_at: '2024-01-03' },
    ]

    const destinationTable: unknown[] = []

    const framework = createConnectorFramework()

    // Register "postgres" source
    framework.registerSource('postgres', {
      spec: async () => ({
        name: 'PostgreSQL',
        version: '1.0.0',
        configSpec: {
          type: 'object',
          required: ['connection_string'],
          properties: {
            connection_string: { type: 'string', secret: true },
          },
        },
      }),
      check: async (config) => {
        if (config.connection_string) {
          return { status: 'SUCCEEDED' }
        }
        return { status: 'FAILED', message: 'Connection string required' }
      },
      discover: async () => [
        {
          name: 'users',
          namespace: 'public',
          schema: {
            type: 'object',
            properties: {
              user_id: { type: 'string' },
              first_name: { type: 'string' },
              last_name: { type: 'string' },
              email: { type: 'string' },
              created_at: { type: 'string' },
            },
          },
          supportedSyncModes: ['full_refresh', 'incremental'],
          sourceDefinedPrimaryKey: [['user_id']],
          defaultCursorField: ['created_at'],
        },
      ],
      read: async function* (config, catalog, state) {
        const cursor = state?.streams?.users?.cursor ?? '1970-01-01'
        const selectedStream = catalog.streams.find((s) => s.name === 'users')

        if (selectedStream?.syncMode === 'incremental') {
          const newRecords = sourceData.filter((r) => r.created_at > cursor)
          for (const record of newRecords) {
            yield { type: 'RECORD', record: { stream: 'users', data: record, emittedAt: Date.now() } }
          }
          if (newRecords.length > 0) {
            yield {
              type: 'STATE',
              state: {
                type: 'STREAM',
                stream: {
                  streamDescriptor: { name: 'users' },
                  streamState: { cursor: newRecords[newRecords.length - 1].created_at },
                },
              },
            }
          }
        } else {
          for (const record of sourceData) {
            yield { type: 'RECORD', record: { stream: 'users', data: record, emittedAt: Date.now() } }
          }
        }
      },
    })

    // Register "bigquery" destination
    framework.registerDestination('bigquery', {
      spec: async () => ({
        name: 'BigQuery',
        version: '1.0.0',
        configSpec: {
          type: 'object',
          required: ['project_id', 'dataset'],
          properties: {
            project_id: { type: 'string' },
            dataset: { type: 'string' },
            credentials: { type: 'string', secret: true },
          },
        },
        supportedSyncModes: ['overwrite', 'append', 'append_dedup'],
      }),
      check: async (config) => {
        if (config.project_id && config.dataset) {
          return { status: 'SUCCEEDED' }
        }
        return { status: 'FAILED', message: 'Project ID and dataset required' }
      },
      write: async function* (config, catalog, messages) {
        for await (const message of messages) {
          if (message.type === 'RECORD') {
            destinationTable.push(message.record.data)
          }
          if (message.type === 'STATE') {
            yield message
          }
        }
      },
    })

    // Create sync with transformation
    const sync = framework.createSync({
      source: {
        type: 'postgres',
        config: { connection_string: 'postgres://localhost:5432/mydb' },
      },
      destination: {
        type: 'bigquery',
        config: { project_id: 'my-project', dataset: 'analytics' },
      },
      streams: [
        {
          name: 'users',
          syncMode: 'full_refresh',
          destinationSyncMode: 'overwrite',
        },
      ],
      transforms: [
        {
          stream: 'users',
          transform: createTransform({
            mappings: [
              { source: 'user_id', destination: 'id' },
              { source: 'email', destination: 'email_address' },
            ],
            computed: [
              {
                name: 'full_name',
                expression: (record) => `${record.first_name} ${record.last_name}`,
              },
            ],
            exclude: ['first_name', 'last_name'],
          }),
        },
      ],
    })

    // Run sync
    const result = await sync.run()

    expect(result.status).toBe('completed')
    expect(result.recordsSynced).toBe(3)
    expect(destinationTable).toHaveLength(3)

    // Verify transformations were applied
    expect(destinationTable[0]).toHaveProperty('id', '1')
    expect(destinationTable[0]).toHaveProperty('email_address', 'alice@example.com')
    expect(destinationTable[0]).toHaveProperty('full_name', 'Alice Smith')
    expect(destinationTable[0]).not.toHaveProperty('first_name')
    expect(destinationTable[0]).not.toHaveProperty('last_name')
  })
})

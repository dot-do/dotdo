/**
 * ConnectorFramework - Universal source/destination adapters
 *
 * Provides standardized interface for data sources and destinations,
 * enabling universal connectivity for ETL/ELT pipelines.
 *
 * Features:
 * - Sources: Read from external systems (pull-based)
 * - Destinations: Write to external systems (push-based)
 * - Transforms: Data transformations between source/dest schemas
 * - Sync: Full and incremental sync modes
 * - State: Cursor tracking, checkpointing
 *
 * @module db/primitives/connector-framework
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Property specification for config schema
 */
export interface PropertySpec {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  secret?: boolean
  format?: string
  const?: string
  title?: string
  properties?: Record<string, PropertySpec>
  items?: PropertySpec
  oneOf?: PropertySpec[]
}

/**
 * Configuration specification (JSON Schema-like)
 */
export interface ConfigSpec {
  type: 'object'
  required?: string[]
  properties: Record<string, PropertySpec>
}

/**
 * Connector specification
 */
export interface ConnectorSpec {
  name: string
  version: string
  configSpec: ConfigSpec
}

/**
 * Source connector specification
 */
export interface SourceConnectorSpec extends ConnectorSpec {}

/**
 * Destination connector specification with supported sync modes
 */
export interface DestinationConnectorSpec extends ConnectorSpec {
  supportedSyncModes: DestinationSyncMode[]
}

/**
 * Connection check result
 */
export interface ConnectionStatus {
  status: 'SUCCEEDED' | 'FAILED'
  message?: string
}

// =============================================================================
// Stream Types
// =============================================================================

/**
 * Sync mode for source streams
 */
export type SyncMode = 'full_refresh' | 'incremental'

/**
 * Destination sync mode
 */
export type DestinationSyncMode = 'overwrite' | 'append' | 'append_dedup'

/**
 * JSON Schema for stream data
 */
export interface StreamSchema {
  type: 'object'
  properties: Record<string, PropertySpec>
}

/**
 * Stream definition from discovery
 */
export interface Stream {
  name: string
  namespace?: string
  schema: StreamSchema
  supportedSyncModes: SyncMode[]
  sourceDefinedPrimaryKey?: string[][]
  sourceDefinedCursor?: boolean
  defaultCursorField?: string[]
}

/**
 * Configured stream in catalog
 */
export interface ConfiguredStream {
  name: string
  syncMode: SyncMode
  destinationSyncMode?: DestinationSyncMode
  cursorField?: string[]
  primaryKey?: string[][]
}

/**
 * Catalog of configured streams
 */
export interface ConfiguredCatalog {
  streams: ConfiguredStream[]
}

// =============================================================================
// Airbyte Message Types
// =============================================================================

/**
 * Record message
 */
export interface RecordMessage {
  type: 'RECORD'
  record: {
    stream: string
    namespace?: string
    data: Record<string, unknown>
    emittedAt: number
  }
}

/**
 * Stream descriptor
 */
export interface StreamDescriptor {
  name: string
  namespace?: string
}

/**
 * Stream state
 */
export interface StreamState {
  streamDescriptor: StreamDescriptor
  streamState: Record<string, unknown>
}

/**
 * Global state
 */
export interface GlobalState {
  sharedState?: Record<string, unknown>
  streamStates: StreamState[]
}

/**
 * State message
 */
export interface StateMessage {
  type: 'STATE'
  state: {
    type: 'STREAM' | 'GLOBAL'
    stream?: StreamState
    global?: GlobalState
  }
}

/**
 * Log levels
 */
export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

/**
 * Log message
 */
export interface LogMessage {
  type: 'LOG'
  log: {
    level: LogLevel
    message: string
  }
}

/**
 * All message types
 */
export type AirbyteMessage = RecordMessage | StateMessage | LogMessage

// =============================================================================
// Source Connector
// =============================================================================

/**
 * Source connector configuration
 */
export type SourceConfig = Record<string, unknown>

/**
 * Sync state
 */
export interface SyncState {
  streams: Record<string, Record<string, unknown>>
}

/**
 * Source connector definition
 */
export interface SourceConnectorDef {
  name?: string
  spec: () => Promise<SourceConnectorSpec>
  check: (config: SourceConfig) => Promise<ConnectionStatus>
  discover: (config: SourceConfig) => Promise<Stream[]>
  read: (
    config: SourceConfig,
    catalog: ConfiguredCatalog,
    state?: SyncState,
  ) => AsyncGenerator<AirbyteMessage, void, unknown>
}

/**
 * Source connector instance
 */
export interface SourceConnector {
  spec: () => Promise<SourceConnectorSpec>
  check: (config: SourceConfig) => Promise<ConnectionStatus>
  discover: (config: SourceConfig) => Promise<Stream[]>
  read: (
    config: SourceConfig,
    catalog: ConfiguredCatalog,
    state?: SyncState,
  ) => AsyncGenerator<AirbyteMessage, void, unknown>
}

/**
 * Create a source connector
 */
export function createSourceConnector(def: SourceConnectorDef): SourceConnector {
  return {
    spec: def.spec,
    check: def.check,
    discover: def.discover,
    read: def.read,
  }
}

// =============================================================================
// Destination Connector
// =============================================================================

/**
 * Destination connector configuration
 */
export type DestinationConfig = Record<string, unknown>

/**
 * Write result
 */
export interface WriteResult {
  recordsWritten: number
}

/**
 * Destination connector definition
 */
export interface DestinationConnectorDef {
  name?: string
  spec: () => Promise<DestinationConnectorSpec>
  check: (config: DestinationConfig) => Promise<ConnectionStatus>
  write: (
    config: DestinationConfig,
    catalog: ConfiguredCatalog,
    messages: AsyncIterable<AirbyteMessage>,
  ) => AsyncGenerator<AirbyteMessage, void, unknown>
}

/**
 * Destination connector instance
 */
export interface DestinationConnector {
  spec: () => Promise<DestinationConnectorSpec>
  check: (config: DestinationConfig) => Promise<ConnectionStatus>
  write: (
    config: DestinationConfig,
    catalog: ConfiguredCatalog,
    messages: AsyncIterable<AirbyteMessage>,
  ) => AsyncGenerator<AirbyteMessage, void, unknown>
}

/**
 * Create a destination connector
 */
export function createDestinationConnector(def: DestinationConnectorDef): DestinationConnector {
  return {
    spec: def.spec,
    check: def.check,
    write: def.write,
  }
}

// =============================================================================
// Transform
// =============================================================================

/**
 * Field mapping from source to destination
 */
export interface FieldMapping {
  source: string
  destination: string
}

/**
 * Type coercion target types
 */
export type CoercionTargetType = 'string' | 'number' | 'boolean' | 'date' | 'integer'

/**
 * Type coercion definition
 */
export interface TypeCoercion {
  field: string
  targetType: CoercionTargetType
}

/**
 * Computed field definition
 */
export interface ComputedField {
  name: string
  expression: (record: Record<string, unknown>) => unknown
}

/**
 * Transform options
 */
export interface TransformOptions {
  mappings?: FieldMapping[]
  flatten?: boolean
  separator?: string
  coercions?: TypeCoercion[]
  computed?: ComputedField[]
  include?: string[]
  exclude?: string[]
}

/**
 * Transform instance
 */
export interface Transform {
  apply: (record: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Get nested value from object by path
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Flatten a nested object
 */
function flattenObject(
  obj: Record<string, unknown>,
  separator: string,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}${separator}${key}` : key

    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, separator, newKey))
    } else {
      result[newKey] = value
    }
  }

  return result
}

/**
 * Coerce a value to target type
 */
function coerceValue(value: unknown, targetType: CoercionTargetType): unknown {
  switch (targetType) {
    case 'string':
      return String(value)
    case 'number':
      return Number(value)
    case 'integer':
      return Math.floor(Number(value))
    case 'boolean':
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true' || (value !== '' && value !== '0' && value !== 'false')
      }
      return Boolean(value)
    case 'date':
      return new Date(value as string | number)
    default:
      return value
  }
}

/**
 * Create a transform
 */
export function createTransform(options: TransformOptions): Transform {
  return {
    apply(record: Record<string, unknown>): Record<string, unknown> {
      let result = { ...record }

      // Apply field mappings
      if (options.mappings) {
        for (const mapping of options.mappings) {
          const value = getNestedValue(record, mapping.source)
          if (value !== undefined) {
            result[mapping.destination] = value
            // Only delete source key if it's a top-level rename (no dots in source)
            if (!mapping.source.includes('.') && mapping.source !== mapping.destination) {
              delete result[mapping.source]
            }
          }
        }
      }

      // Flatten nested objects
      if (options.flatten) {
        result = flattenObject(result, options.separator ?? '_')
      }

      // Apply type coercions
      if (options.coercions) {
        for (const coercion of options.coercions) {
          if (coercion.field in result) {
            result[coercion.field] = coerceValue(result[coercion.field], coercion.targetType)
          }
        }
      }

      // Add computed fields
      if (options.computed) {
        for (const computed of options.computed) {
          result[computed.name] = computed.expression(record)
        }
      }

      // Include only specified fields
      if (options.include) {
        const filtered: Record<string, unknown> = {}
        for (const field of options.include) {
          if (field in result) {
            filtered[field] = result[field]
          }
        }
        result = filtered
      }

      // Exclude specified fields
      if (options.exclude) {
        for (const field of options.exclude) {
          delete result[field]
        }
      }

      return result
    },
  }
}

// =============================================================================
// Sync Pipeline
// =============================================================================

/**
 * Stream sync configuration
 */
export interface StreamSyncConfig {
  name: string
  syncMode: SyncMode
  destinationSyncMode: DestinationSyncMode
  cursorField?: string[]
  primaryKey?: string[][]
}

/**
 * Transform configuration for a stream
 */
export interface StreamTransformConfig {
  stream: string
  transform: Transform
}

/**
 * Sync pipeline configuration
 */
export interface SyncConfig {
  source: {
    type: string
    config: SourceConfig
  }
  destination: {
    type: string
    config: DestinationConfig
  }
  streams: StreamSyncConfig[]
  transforms?: StreamTransformConfig[]
}

/**
 * Sync result
 */
export interface SyncResult {
  status: 'completed' | 'failed'
  recordsSynced: number
  bytesProcessed: number
  duration: number
  error?: string
}

/**
 * Sync pipeline
 */
export interface SyncPipeline {
  run: () => Promise<SyncResult>
  getState: () => Promise<SyncState>
}

// =============================================================================
// Connector Framework
// =============================================================================

/**
 * Connector framework for managing sources and destinations
 */
export interface ConnectorFramework {
  registerSource: (name: string, def: SourceConnectorDef) => void
  registerDestination: (name: string, def: DestinationConnectorDef) => void
  getSource: (name: string) => SourceConnector
  getDestination: (name: string) => DestinationConnector
  listSources: () => string[]
  listDestinations: () => string[]
  createSync: (config: SyncConfig) => SyncPipeline
}

/**
 * Create a sync pipeline implementation
 */
function createSyncPipeline(
  source: SourceConnector,
  destination: DestinationConnector,
  config: SyncConfig,
): SyncPipeline {
  let currentState: SyncState = { streams: {} }

  return {
    async run(): Promise<SyncResult> {
      const startTime = Date.now()
      let recordsSynced = 0
      let bytesProcessed = 0
      let error: string | undefined

      try {
        // Build catalog for source
        const catalog: ConfiguredCatalog = {
          streams: config.streams.map((s) => ({
            name: s.name,
            syncMode: s.syncMode,
            destinationSyncMode: s.destinationSyncMode,
            cursorField: s.cursorField,
            primaryKey: s.primaryKey,
          })),
        }

        // Build transform lookup
        const transformLookup = new Map<string, Transform>()
        if (config.transforms) {
          for (const t of config.transforms) {
            transformLookup.set(t.stream, t.transform)
          }
        }

        // Create message transformer
        async function* transformMessages(
          messages: AsyncGenerator<AirbyteMessage, void, unknown>,
        ): AsyncGenerator<AirbyteMessage, void, unknown> {
          for await (const message of messages) {
            if (message.type === 'RECORD') {
              const transform = transformLookup.get(message.record.stream)
              if (transform) {
                const transformedData = transform.apply(message.record.data)
                yield {
                  type: 'RECORD',
                  record: {
                    ...message.record,
                    data: transformedData,
                  },
                }
              } else {
                yield message
              }
              recordsSynced++
              bytesProcessed += JSON.stringify(message.record.data).length
            } else {
              yield message
            }
          }
        }

        // Read from source
        const sourceMessages = source.read(config.source.config, catalog, currentState)

        // Transform and pipe to destination
        const transformedMessages = transformMessages(sourceMessages)

        // Write to destination and collect state
        const destinationOutput = destination.write(
          config.destination.config,
          catalog,
          transformedMessages,
        )

        // Collect output messages (state updates)
        for await (const message of destinationOutput) {
          if (message.type === 'STATE') {
            // Update state based on message type
            if (message.state.type === 'STREAM' && message.state.stream) {
              const streamName = message.state.stream.streamDescriptor.name
              currentState.streams[streamName] = message.state.stream.streamState
            } else if (message.state.type === 'GLOBAL' && message.state.global) {
              // Handle global state
              for (const streamState of message.state.global.streamStates) {
                currentState.streams[streamState.streamDescriptor.name] = streamState.streamState
              }
            }
          }
        }

        return {
          status: 'completed',
          recordsSynced,
          bytesProcessed,
          duration: Date.now() - startTime,
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        return {
          status: 'failed',
          recordsSynced,
          bytesProcessed,
          duration: Date.now() - startTime,
          error,
        }
      }
    },

    async getState(): Promise<SyncState> {
      return currentState
    },
  }
}

/**
 * Create a connector framework instance
 */
export function createConnectorFramework(): ConnectorFramework {
  const sources = new Map<string, SourceConnector>()
  const destinations = new Map<string, DestinationConnector>()

  return {
    registerSource(name: string, def: SourceConnectorDef): void {
      sources.set(name, createSourceConnector(def))
    },

    registerDestination(name: string, def: DestinationConnectorDef): void {
      destinations.set(name, createDestinationConnector(def))
    },

    getSource(name: string): SourceConnector {
      const source = sources.get(name)
      if (!source) {
        throw new Error(`Source connector '${name}' not found`)
      }
      return source
    },

    getDestination(name: string): DestinationConnector {
      const destination = destinations.get(name)
      if (!destination) {
        throw new Error(`Destination connector '${name}' not found`)
      }
      return destination
    },

    listSources(): string[] {
      return Array.from(sources.keys())
    },

    listDestinations(): string[] {
      return Array.from(destinations.keys())
    },

    createSync(config: SyncConfig): SyncPipeline {
      // Validate source exists
      const source = sources.get(config.source.type)
      if (!source) {
        throw new Error(`Source connector '${config.source.type}' not found`)
      }

      // Validate destination exists
      const destination = destinations.get(config.destination.type)
      if (!destination) {
        throw new Error(`Destination connector '${config.destination.type}' not found`)
      }

      return createSyncPipeline(source, destination, config)
    },
  }
}

// =============================================================================
// Convenience Exports
// =============================================================================
// ConnectorFramework is already exported via the interface declaration above

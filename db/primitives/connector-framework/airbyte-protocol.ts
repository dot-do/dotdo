/**
 * Airbyte Protocol Compatibility Layer
 *
 * Full implementation of the Airbyte Protocol v0.5.2 specification.
 * Provides message types, serialization, and parsing for connector compatibility.
 *
 * Message types supported:
 * - RECORD: Data records from sources
 * - STATE: Checkpoint/cursor state for resumable syncs
 * - LOG: Debug and informational messages
 * - SPEC: Connector specification (configuration schema)
 * - CATALOG: Stream catalog (available streams)
 * - CONNECTION_STATUS: Connection validation results
 * - TRACE: Runtime metadata (errors, estimates)
 * - CONTROL: Platform-level control signals
 *
 * @module db/primitives/connector-framework/airbyte-protocol
 */

// =============================================================================
// Protocol Constants
// =============================================================================

/**
 * Current Airbyte Protocol version supported by this implementation
 */
export const AIRBYTE_PROTOCOL_VERSION = '0.5.2'

/**
 * Default protocol version if not specified
 */
export const AIRBYTE_PROTOCOL_VERSION_DEFAULT = '0.2.0'

// =============================================================================
// Core Types
// =============================================================================

/**
 * All possible Airbyte message types
 */
export type AirbyteMessageType =
  | 'RECORD'
  | 'STATE'
  | 'LOG'
  | 'SPEC'
  | 'CATALOG'
  | 'CONNECTION_STATUS'
  | 'TRACE'
  | 'CONTROL'

/**
 * Log levels for LOG messages
 */
export type LogLevel = 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE'

/**
 * State types for STATE messages
 */
export type StateType = 'LEGACY' | 'STREAM' | 'GLOBAL'

/**
 * Trace message types
 */
export type TraceType = 'ERROR' | 'ESTIMATE'

/**
 * Estimate types for ESTIMATE trace messages
 */
export type EstimateType = 'STREAM' | 'SYNC'

/**
 * Failure types for ERROR trace messages
 */
export type FailureType = 'system_error' | 'config_error' | 'transient_error'

/**
 * Connection status values
 */
export type ConnectionStatusType = 'SUCCEEDED' | 'FAILED'

/**
 * Sync modes for sources
 */
export type SyncMode = 'full_refresh' | 'incremental'

/**
 * Destination sync modes
 */
export type DestinationSyncMode = 'append' | 'overwrite' | 'append_dedup'

/**
 * Control message types
 */
export type ControlType = 'CONNECTOR_CONFIG'

// =============================================================================
// Stream Descriptor
// =============================================================================

/**
 * Uniquely identifies a stream
 */
export interface StreamDescriptor {
  name: string
  namespace?: string
}

// =============================================================================
// RECORD Message Types
// =============================================================================

/**
 * Record payload within a RECORD message
 */
export interface AirbyteRecordPayload {
  stream: string
  namespace?: string
  data: Record<string, unknown>
  emitted_at: number
}

/**
 * RECORD message - contains actual replicated data
 */
export interface AirbyteRecordMessage {
  type: 'RECORD'
  record: AirbyteRecordPayload
}

// =============================================================================
// STATE Message Types
// =============================================================================

/**
 * Per-stream state
 */
export interface AirbyteStreamState {
  stream_descriptor: StreamDescriptor
  stream_state?: Record<string, unknown>
}

/**
 * Global state across all streams
 */
export interface AirbyteGlobalState {
  shared_state?: Record<string, unknown>
  stream_states: AirbyteStreamState[]
}

/**
 * State payload within a STATE message
 */
export interface AirbyteStatePayload {
  type: StateType
  stream?: AirbyteStreamState
  global?: AirbyteGlobalState
  data?: Record<string, unknown> // Legacy state format
}

/**
 * STATE message - enables checkpointing for resumable syncs
 */
export interface AirbyteStateMessage {
  type: 'STATE'
  state: AirbyteStatePayload
}

// =============================================================================
// LOG Message Types
// =============================================================================

/**
 * Log payload within a LOG message
 */
export interface AirbyteLogPayload {
  level: LogLevel
  message: string
  stack_trace?: string
}

/**
 * LOG message - debugging and informational messages
 */
export interface AirbyteLogMessage {
  type: 'LOG'
  log: AirbyteLogPayload
}

// =============================================================================
// SPEC Message Types
// =============================================================================

/**
 * JSON Schema type for connection specification
 */
export interface ConnectionSpecificationSchema {
  type: 'object'
  required?: string[]
  properties: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Connector specification
 */
export interface ConnectorSpecification {
  protocol_version?: string
  connectionSpecification: ConnectionSpecificationSchema
  documentationUrl?: string
  changelogUrl?: string
  supportsIncremental?: boolean // Deprecated
  supportsNormalization?: boolean
  supportsDBT?: boolean
  supported_destination_sync_modes?: DestinationSyncMode[]
}

/**
 * SPEC message - broadcasts connector capabilities
 */
export interface AirbyteSpecMessage {
  type: 'SPEC'
  spec: ConnectorSpecification
}

// =============================================================================
// CATALOG Message Types
// =============================================================================

/**
 * Stream definition in catalog
 */
export interface AirbyteStream {
  name: string
  namespace?: string
  json_schema: Record<string, unknown>
  supported_sync_modes: SyncMode[]
  source_defined_cursor?: boolean
  default_cursor_field?: string[]
  source_defined_primary_key?: string[][]
  is_resumable?: boolean
}

/**
 * Catalog containing available streams
 */
export interface AirbyteCatalog {
  streams: AirbyteStream[]
}

/**
 * CATALOG message - describes available streams
 */
export interface AirbyteCatalogMessage {
  type: 'CATALOG'
  catalog: AirbyteCatalog
}

/**
 * Configured stream for sync
 */
export interface ConfiguredAirbyteStream {
  stream: AirbyteStream
  sync_mode: SyncMode
  destination_sync_mode: DestinationSyncMode
  cursor_field?: string[]
  primary_key?: string[][]
}

/**
 * Configured catalog for sync operation
 */
export interface ConfiguredAirbyteCatalog {
  streams: ConfiguredAirbyteStream[]
}

// =============================================================================
// CONNECTION_STATUS Message Types
// =============================================================================

/**
 * Connection status payload
 */
export interface AirbyteConnectionStatusPayload {
  status: ConnectionStatusType
  message?: string
}

/**
 * CONNECTION_STATUS message - validates connectivity
 */
export interface AirbyteConnectionStatusMessage {
  type: 'CONNECTION_STATUS'
  connectionStatus: AirbyteConnectionStatusPayload
}

// =============================================================================
// TRACE Message Types
// =============================================================================

/**
 * Error trace payload
 */
export interface AirbyteErrorTraceMessage {
  message: string
  internal_message?: string
  stack_trace?: string
  failure_type?: FailureType
}

/**
 * Estimate trace payload
 */
export interface AirbyteEstimateTraceMessage {
  name: string
  type: EstimateType
  namespace?: string
  row_estimate?: number
  byte_estimate?: number
}

/**
 * Trace payload within a TRACE message
 */
export interface AirbyteTracePayload {
  type: TraceType
  emitted_at: number
  error?: AirbyteErrorTraceMessage
  estimate?: AirbyteEstimateTraceMessage
}

/**
 * TRACE message - runtime metadata
 */
export interface AirbyteTraceMessage {
  type: 'TRACE'
  trace: AirbyteTracePayload
}

// =============================================================================
// CONTROL Message Types
// =============================================================================

/**
 * Connector config update payload
 */
export interface AirbyteControlConnectorConfigMessage {
  config: Record<string, unknown>
}

/**
 * Control payload within a CONTROL message
 */
export interface AirbyteControlPayload {
  type: ControlType
  emitted_at: number
  connectorConfig?: AirbyteControlConnectorConfigMessage
}

/**
 * CONTROL message - platform-level signals
 */
export interface AirbyteControlMessage {
  type: 'CONTROL'
  control: AirbyteControlPayload
}

// =============================================================================
// Union Types
// =============================================================================

/**
 * All Airbyte message types union
 */
export type AirbyteMessage =
  | AirbyteRecordMessage
  | AirbyteStateMessage
  | AirbyteLogMessage
  | AirbyteSpecMessage
  | AirbyteCatalogMessage
  | AirbyteConnectionStatusMessage
  | AirbyteTraceMessage
  | AirbyteControlMessage

// =============================================================================
// Message Factory Functions
// =============================================================================

/**
 * Options for creating a RECORD message
 */
export interface CreateRecordOptions {
  stream: string
  namespace?: string
  data: Record<string, unknown>
  emitted_at?: number
}

/**
 * Create an Airbyte RECORD message
 */
export function createAirbyteRecord(options: CreateRecordOptions): AirbyteRecordMessage {
  return {
    type: 'RECORD',
    record: {
      stream: options.stream,
      namespace: options.namespace,
      data: options.data,
      emitted_at: options.emitted_at ?? Date.now(),
    },
  }
}

/**
 * Options for creating a STATE message
 */
export interface CreateStateOptions {
  type: StateType
  stream?: AirbyteStreamState
  global?: AirbyteGlobalState
  data?: Record<string, unknown>
}

/**
 * Create an Airbyte STATE message
 */
export function createAirbyteState(options: CreateStateOptions): AirbyteStateMessage {
  return {
    type: 'STATE',
    state: {
      type: options.type,
      stream: options.stream,
      global: options.global,
      data: options.data,
    },
  }
}

/**
 * Options for creating a LOG message
 */
export interface CreateLogOptions {
  level: LogLevel
  message: string
  stack_trace?: string
}

/**
 * Create an Airbyte LOG message
 */
export function createAirbyteLog(options: CreateLogOptions): AirbyteLogMessage {
  return {
    type: 'LOG',
    log: {
      level: options.level,
      message: options.message,
      stack_trace: options.stack_trace,
    },
  }
}

/**
 * Options for creating a SPEC message
 */
export interface CreateSpecOptions {
  protocol_version?: string
  connectionSpecification: ConnectionSpecificationSchema
  documentationUrl?: string
  changelogUrl?: string
  supportsIncremental?: boolean
  supportsNormalization?: boolean
  supportsDBT?: boolean
  supported_destination_sync_modes?: DestinationSyncMode[]
}

/**
 * Create an Airbyte SPEC message
 */
export function createAirbyteSpec(options: CreateSpecOptions): AirbyteSpecMessage {
  return {
    type: 'SPEC',
    spec: {
      protocol_version: options.protocol_version ?? AIRBYTE_PROTOCOL_VERSION,
      connectionSpecification: options.connectionSpecification,
      documentationUrl: options.documentationUrl,
      changelogUrl: options.changelogUrl,
      supportsIncremental: options.supportsIncremental,
      supportsNormalization: options.supportsNormalization,
      supportsDBT: options.supportsDBT,
      supported_destination_sync_modes: options.supported_destination_sync_modes,
    },
  }
}

/**
 * Options for creating a CATALOG message
 */
export interface CreateCatalogOptions {
  streams: AirbyteStream[]
}

/**
 * Create an Airbyte CATALOG message
 */
export function createAirbyteCatalog(options: CreateCatalogOptions): AirbyteCatalogMessage {
  return {
    type: 'CATALOG',
    catalog: {
      streams: options.streams,
    },
  }
}

/**
 * Options for creating a CONNECTION_STATUS message
 */
export interface CreateConnectionStatusOptions {
  status: ConnectionStatusType
  message?: string
}

/**
 * Create an Airbyte CONNECTION_STATUS message
 */
export function createAirbyteConnectionStatus(options: CreateConnectionStatusOptions): AirbyteConnectionStatusMessage {
  return {
    type: 'CONNECTION_STATUS',
    connectionStatus: {
      status: options.status,
      message: options.message,
    },
  }
}

/**
 * Options for creating an ERROR TRACE message
 */
export interface CreateErrorTraceOptions {
  type: 'ERROR'
  error: AirbyteErrorTraceMessage
  emitted_at?: number
}

/**
 * Options for creating an ESTIMATE TRACE message
 */
export interface CreateEstimateTraceOptions {
  type: 'ESTIMATE'
  estimate: AirbyteEstimateTraceMessage
  emitted_at?: number
}

/**
 * Options for creating a TRACE message
 */
export type CreateTraceOptions = CreateErrorTraceOptions | CreateEstimateTraceOptions

/**
 * Create an Airbyte TRACE message
 */
export function createAirbyteTrace(options: CreateTraceOptions): AirbyteTraceMessage {
  const emitted_at = options.emitted_at ?? Date.now()

  if (options.type === 'ERROR') {
    return {
      type: 'TRACE',
      trace: {
        type: 'ERROR',
        emitted_at,
        error: options.error,
      },
    }
  } else {
    return {
      type: 'TRACE',
      trace: {
        type: 'ESTIMATE',
        emitted_at,
        estimate: options.estimate,
      },
    }
  }
}

/**
 * Options for creating a CONTROL message
 */
export interface CreateControlOptions {
  type: ControlType
  connectorConfig?: AirbyteControlConnectorConfigMessage
  emitted_at?: number
}

/**
 * Create an Airbyte CONTROL message
 */
export function createAirbyteControl(options: CreateControlOptions): AirbyteControlMessage {
  return {
    type: 'CONTROL',
    control: {
      type: options.type,
      emitted_at: options.emitted_at ?? Date.now(),
      connectorConfig: options.connectorConfig,
    },
  }
}

// =============================================================================
// Serialization
// =============================================================================

/**
 * Serialize an Airbyte message to single-line JSON (protocol requirement)
 *
 * The Airbyte protocol requires all messages to be single-line JSON objects.
 * This is critical for STDIN/STDOUT message parsing.
 */
export function serializeAirbyteMessage(message: AirbyteMessage): string {
  return JSON.stringify(message)
}

/**
 * Serialize multiple messages for stream output (newline-delimited JSON)
 */
export function serializeAirbyteMessages(messages: AirbyteMessage[]): string {
  return messages.map(serializeAirbyteMessage).join('\n')
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Valid message types for validation
 */
const VALID_MESSAGE_TYPES: Set<AirbyteMessageType> = new Set([
  'RECORD',
  'STATE',
  'LOG',
  'SPEC',
  'CATALOG',
  'CONNECTION_STATUS',
  'TRACE',
  'CONTROL',
])

/**
 * Parse a JSON string into an Airbyte message
 *
 * @throws Error if JSON is invalid or message type is unknown
 */
export function parseAirbyteMessage(json: string): AirbyteMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid message: expected object')
  }

  const message = parsed as Record<string, unknown>

  if (!('type' in message) || typeof message.type !== 'string') {
    throw new Error('Invalid message: missing or invalid type field')
  }

  const type = message.type as string

  if (!VALID_MESSAGE_TYPES.has(type as AirbyteMessageType)) {
    throw new Error(`Unknown message type: ${type}`)
  }

  // Return the parsed message - additional properties are allowed per protocol spec
  return message as AirbyteMessage
}

/**
 * Parse multiple messages from newline-delimited JSON stream
 */
export function parseAirbyteMessages(stream: string): AirbyteMessage[] {
  return stream
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => parseAirbyteMessage(line))
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if message is a RECORD message
 */
export function isRecordMessage(message: AirbyteMessage): message is AirbyteRecordMessage {
  return message.type === 'RECORD'
}

/**
 * Check if message is a STATE message
 */
export function isStateMessage(message: AirbyteMessage): message is AirbyteStateMessage {
  return message.type === 'STATE'
}

/**
 * Check if message is a LOG message
 */
export function isLogMessage(message: AirbyteMessage): message is AirbyteLogMessage {
  return message.type === 'LOG'
}

/**
 * Check if message is a SPEC message
 */
export function isSpecMessage(message: AirbyteMessage): message is AirbyteSpecMessage {
  return message.type === 'SPEC'
}

/**
 * Check if message is a CATALOG message
 */
export function isCatalogMessage(message: AirbyteMessage): message is AirbyteCatalogMessage {
  return message.type === 'CATALOG'
}

/**
 * Check if message is a CONNECTION_STATUS message
 */
export function isConnectionStatusMessage(message: AirbyteMessage): message is AirbyteConnectionStatusMessage {
  return message.type === 'CONNECTION_STATUS'
}

/**
 * Check if message is a TRACE message
 */
export function isTraceMessage(message: AirbyteMessage): message is AirbyteTraceMessage {
  return message.type === 'TRACE'
}

/**
 * Check if message is a CONTROL message
 */
export function isControlMessage(message: AirbyteMessage): message is AirbyteControlMessage {
  return message.type === 'CONTROL'
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extract stream name from various message types
 */
export function getStreamName(message: AirbyteMessage): string | undefined {
  switch (message.type) {
    case 'RECORD':
      return message.record.stream
    case 'STATE':
      if (message.state.stream) {
        return message.state.stream.stream_descriptor.name
      }
      return undefined
    case 'TRACE':
      if (message.trace.estimate) {
        return message.trace.estimate.name
      }
      return undefined
    default:
      return undefined
  }
}

/**
 * Create a stream descriptor
 */
export function createStreamDescriptor(name: string, namespace?: string): StreamDescriptor {
  const descriptor: StreamDescriptor = { name }
  if (namespace !== undefined) {
    descriptor.namespace = namespace
  }
  return descriptor
}

/**
 * Create a configured stream from a stream definition
 */
export function createConfiguredStream(
  stream: AirbyteStream,
  options: {
    sync_mode: SyncMode
    destination_sync_mode: DestinationSyncMode
    cursor_field?: string[]
    primary_key?: string[][]
  },
): ConfiguredAirbyteStream {
  return {
    stream,
    sync_mode: options.sync_mode,
    destination_sync_mode: options.destination_sync_mode,
    cursor_field: options.cursor_field,
    primary_key: options.primary_key,
  }
}

/**
 * Convert legacy connector framework message to Airbyte protocol message
 */
export function fromLegacyMessage(message: {
  type: 'RECORD' | 'STATE' | 'LOG'
  record?: { stream: string; namespace?: string; data: Record<string, unknown>; emittedAt: number }
  state?: { type: 'STREAM' | 'GLOBAL'; stream?: unknown; global?: unknown }
  log?: { level: string; message: string }
}): AirbyteMessage {
  switch (message.type) {
    case 'RECORD':
      if (!message.record) throw new Error('Missing record field')
      return createAirbyteRecord({
        stream: message.record.stream,
        namespace: message.record.namespace,
        data: message.record.data,
        emitted_at: message.record.emittedAt,
      })
    case 'STATE':
      if (!message.state) throw new Error('Missing state field')
      return {
        type: 'STATE',
        state: {
          type: message.state.type,
          stream: message.state.stream as AirbyteStreamState | undefined,
          global: message.state.global as AirbyteGlobalState | undefined,
        },
      }
    case 'LOG':
      if (!message.log) throw new Error('Missing log field')
      return createAirbyteLog({
        level: message.log.level as LogLevel,
        message: message.log.message,
      })
    default:
      throw new Error(`Unknown legacy message type: ${message.type}`)
  }
}

/**
 * Convert Airbyte protocol message to legacy connector framework message format
 */
export function toLegacyMessage(message: AirbyteMessage): {
  type: 'RECORD' | 'STATE' | 'LOG'
  record?: { stream: string; namespace?: string; data: Record<string, unknown>; emittedAt: number }
  state?: { type: string; stream?: unknown; global?: unknown }
  log?: { level: string; message: string }
} | null {
  switch (message.type) {
    case 'RECORD':
      return {
        type: 'RECORD',
        record: {
          stream: message.record.stream,
          namespace: message.record.namespace,
          data: message.record.data,
          emittedAt: message.record.emitted_at,
        },
      }
    case 'STATE':
      return {
        type: 'STATE',
        state: {
          type: message.state.type,
          stream: message.state.stream,
          global: message.state.global,
        },
      }
    case 'LOG':
      return {
        type: 'LOG',
        log: {
          level: message.log.level,
          message: message.log.message,
        },
      }
    default:
      // Other message types don't have legacy equivalents
      return null
  }
}

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
 * - Lifecycle: Proper open/close resource management
 * - Config validation: JSON Schema-based with secret masking and OAuth support
 *
 * @module db/primitives/connector-framework
 */

// =============================================================================
// Lifecycle Types
// =============================================================================

/**
 * Connector lifecycle state
 */
export type ConnectorState = 'uninitialized' | 'opening' | 'open' | 'closing' | 'closed' | 'error'

/**
 * Lifecycle event for state transitions
 */
export interface LifecycleEvent {
  from: ConnectorState
  to: ConnectorState
  timestamp: number
  error?: Error
}

/**
 * Resource cleanup function
 */
export type CleanupFn = () => void | Promise<void>

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
  default?: unknown
  enum?: unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  properties?: Record<string, PropertySpec>
  items?: PropertySpec
  oneOf?: PropertySpec[]
  required?: string[]
  // OAuth-specific properties
  airbyte_secret?: boolean
  order?: number
  examples?: unknown[]
}

/**
 * OAuth2 flow configuration
 */
export interface OAuth2FlowConfig {
  type: 'oauth2'
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  refreshUrl?: string
  pkceRequired?: boolean
}

/**
 * Authentication method configuration
 */
export interface AuthMethodConfig {
  type: 'api_key' | 'oauth2' | 'basic' | 'bearer'
  oauth2?: OAuth2FlowConfig
}

/**
 * Configuration specification (JSON Schema-like)
 */
export interface ConfigSpec {
  type: 'object'
  required?: string[]
  properties: Record<string, PropertySpec>
  // OAuth and advanced auth support
  authMethods?: AuthMethodConfig[]
  // Additional metadata for UI generation
  groups?: Array<{
    id: string
    title: string
    fields: string[]
  }>
}

/**
 * Config validation error
 */
export interface ConfigValidationError {
  path: string
  message: string
  code: 'required' | 'type' | 'format' | 'pattern' | 'enum' | 'range' | 'custom'
}

/**
 * Config validation result
 */
export interface ConfigValidationResult {
  valid: boolean
  errors: ConfigValidationError[]
}

/**
 * Connector specification
 */
export interface ConnectorSpec {
  name: string
  version: string
  configSpec: ConfigSpec
  // Connector metadata
  documentationUrl?: string
  icon?: string
  releaseStage?: 'alpha' | 'beta' | 'generally_available'
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
 * Connector lifecycle hooks
 */
export interface ConnectorLifecycleHooks<TConfig = Record<string, unknown>> {
  /** Called when connector is being opened */
  open?: (config: TConfig) => Promise<void>
  /** Called when connector is being closed */
  close?: () => Promise<void>
  /** Register a cleanup function to be called on close */
  onCleanup?: (fn: CleanupFn) => void
}

/**
 * Lifecycle-aware connector context
 */
export interface ConnectorContext {
  state: ConnectorState
  history: LifecycleEvent[]
  cleanupFns: CleanupFn[]
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
  // Lifecycle hooks
  open?: (config: SourceConfig) => Promise<void>
  close?: () => Promise<void>
}

/**
 * Source connector instance with lifecycle management
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
  // Lifecycle methods
  open: (config: SourceConfig) => Promise<void>
  close: () => Promise<void>
  getState: () => ConnectorState
  getLifecycleHistory: () => LifecycleEvent[]
  onCleanup: (fn: CleanupFn) => void
}

/**
 * Create a source connector with lifecycle management
 */
export function createSourceConnector(def: SourceConnectorDef): SourceConnector {
  const context: ConnectorContext = {
    state: 'uninitialized',
    history: [],
    cleanupFns: [],
  }

  function transitionTo(newState: ConnectorState, error?: Error): void {
    const event: LifecycleEvent = {
      from: context.state,
      to: newState,
      timestamp: Date.now(),
      error,
    }
    context.history.push(event)
    context.state = newState
  }

  return {
    spec: def.spec,
    check: def.check,
    discover: def.discover,
    read: def.read,

    async open(config: SourceConfig): Promise<void> {
      if (context.state !== 'uninitialized' && context.state !== 'closed') {
        throw new Error(`Cannot open connector in state: ${context.state}`)
      }
      transitionTo('opening')
      try {
        if (def.open) {
          await def.open(config)
        }
        transitionTo('open')
      } catch (err) {
        transitionTo('error', err instanceof Error ? err : new Error(String(err)))
        throw err
      }
    },

    async close(): Promise<void> {
      if (context.state !== 'open' && context.state !== 'error') {
        throw new Error(`Cannot close connector in state: ${context.state}`)
      }
      transitionTo('closing')
      try {
        // Run cleanup functions in reverse order
        for (const cleanup of context.cleanupFns.reverse()) {
          await cleanup()
        }
        context.cleanupFns = []
        if (def.close) {
          await def.close()
        }
        transitionTo('closed')
      } catch (err) {
        transitionTo('error', err instanceof Error ? err : new Error(String(err)))
        throw err
      }
    },

    getState(): ConnectorState {
      return context.state
    },

    getLifecycleHistory(): LifecycleEvent[] {
      return [...context.history]
    },

    onCleanup(fn: CleanupFn): void {
      context.cleanupFns.push(fn)
    },
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
  // Lifecycle hooks
  open?: (config: DestinationConfig) => Promise<void>
  close?: () => Promise<void>
}

/**
 * Destination connector instance with lifecycle management
 */
export interface DestinationConnector {
  spec: () => Promise<DestinationConnectorSpec>
  check: (config: DestinationConfig) => Promise<ConnectionStatus>
  write: (
    config: DestinationConfig,
    catalog: ConfiguredCatalog,
    messages: AsyncIterable<AirbyteMessage>,
  ) => AsyncGenerator<AirbyteMessage, void, unknown>
  // Lifecycle methods
  open: (config: DestinationConfig) => Promise<void>
  close: () => Promise<void>
  getState: () => ConnectorState
  getLifecycleHistory: () => LifecycleEvent[]
  onCleanup: (fn: CleanupFn) => void
}

/**
 * Create a destination connector with lifecycle management
 */
export function createDestinationConnector(def: DestinationConnectorDef): DestinationConnector {
  const context: ConnectorContext = {
    state: 'uninitialized',
    history: [],
    cleanupFns: [],
  }

  function transitionTo(newState: ConnectorState, error?: Error): void {
    const event: LifecycleEvent = {
      from: context.state,
      to: newState,
      timestamp: Date.now(),
      error,
    }
    context.history.push(event)
    context.state = newState
  }

  return {
    spec: def.spec,
    check: def.check,
    write: def.write,

    async open(config: DestinationConfig): Promise<void> {
      if (context.state !== 'uninitialized' && context.state !== 'closed') {
        throw new Error(`Cannot open connector in state: ${context.state}`)
      }
      transitionTo('opening')
      try {
        if (def.open) {
          await def.open(config)
        }
        transitionTo('open')
      } catch (err) {
        transitionTo('error', err instanceof Error ? err : new Error(String(err)))
        throw err
      }
    },

    async close(): Promise<void> {
      if (context.state !== 'open' && context.state !== 'error') {
        throw new Error(`Cannot close connector in state: ${context.state}`)
      }
      transitionTo('closing')
      try {
        // Run cleanup functions in reverse order
        for (const cleanup of context.cleanupFns.reverse()) {
          await cleanup()
        }
        context.cleanupFns = []
        if (def.close) {
          await def.close()
        }
        transitionTo('closed')
      } catch (err) {
        transitionTo('error', err instanceof Error ? err : new Error(String(err)))
        throw err
      }
    },

    getState(): ConnectorState {
      return context.state
    },

    getLifecycleHistory(): LifecycleEvent[] {
      return [...context.history]
    },

    onCleanup(fn: CleanupFn): void {
      context.cleanupFns.push(fn)
    },
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
// Config Validation
// =============================================================================

/**
 * Validate a configuration value against a property spec
 */
function validateProperty(
  value: unknown,
  spec: PropertySpec,
  path: string,
): ConfigValidationError[] {
  const errors: ConfigValidationError[] = []

  // Type validation
  if (value !== undefined && value !== null) {
    const actualType = Array.isArray(value) ? 'array' : typeof value
    const expectedType = spec.type === 'integer' ? 'number' : spec.type

    if (actualType !== expectedType) {
      errors.push({
        path,
        message: `Expected type '${spec.type}', got '${actualType}'`,
        code: 'type',
      })
      return errors // Skip further validation if type is wrong
    }

    // Integer check
    if (spec.type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) {
      errors.push({
        path,
        message: `Expected integer, got float`,
        code: 'type',
      })
    }

    // String validations
    if (spec.type === 'string' && typeof value === 'string') {
      if (spec.minLength !== undefined && value.length < spec.minLength) {
        errors.push({
          path,
          message: `String length ${value.length} is less than minimum ${spec.minLength}`,
          code: 'range',
        })
      }
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        errors.push({
          path,
          message: `String length ${value.length} exceeds maximum ${spec.maxLength}`,
          code: 'range',
        })
      }
      if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
        errors.push({
          path,
          message: `String does not match pattern '${spec.pattern}'`,
          code: 'pattern',
        })
      }
      if (spec.format) {
        const formatValidators: Record<string, (v: string) => boolean> = {
          email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
          uri: (v) => { try { new URL(v); return true } catch { return false } },
          'date-time': (v) => !isNaN(Date.parse(v)),
          date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
        }
        const validator = formatValidators[spec.format]
        if (validator && !validator(value)) {
          errors.push({
            path,
            message: `String does not match format '${spec.format}'`,
            code: 'format',
          })
        }
      }
    }

    // Number validations
    if ((spec.type === 'number' || spec.type === 'integer') && typeof value === 'number') {
      if (spec.minimum !== undefined && value < spec.minimum) {
        errors.push({
          path,
          message: `Value ${value} is less than minimum ${spec.minimum}`,
          code: 'range',
        })
      }
      if (spec.maximum !== undefined && value > spec.maximum) {
        errors.push({
          path,
          message: `Value ${value} exceeds maximum ${spec.maximum}`,
          code: 'range',
        })
      }
    }

    // Enum validation
    if (spec.enum && !spec.enum.includes(value)) {
      errors.push({
        path,
        message: `Value must be one of: ${spec.enum.join(', ')}`,
        code: 'enum',
      })
    }

    // Const validation
    if (spec.const !== undefined && value !== spec.const) {
      errors.push({
        path,
        message: `Value must be '${spec.const}'`,
        code: 'enum',
      })
    }

    // Object validation
    if (spec.type === 'object' && spec.properties && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>

      // Check required fields
      if (spec.required) {
        for (const field of spec.required) {
          if (!(field in obj) || obj[field] === undefined) {
            errors.push({
              path: path ? `${path}.${field}` : field,
              message: `Missing required field '${field}'`,
              code: 'required',
            })
          }
        }
      }

      // Validate nested properties
      for (const [key, propSpec] of Object.entries(spec.properties)) {
        if (key in obj) {
          errors.push(...validateProperty(obj[key], propSpec, path ? `${path}.${key}` : key))
        }
      }
    }

    // Array validation
    if (spec.type === 'array' && spec.items && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateProperty(value[i], spec.items, `${path}[${i}]`))
      }
    }
  }

  return errors
}

/**
 * Validate a configuration against a config spec
 */
export function validateConfig(
  config: Record<string, unknown>,
  spec: ConfigSpec,
): ConfigValidationResult {
  const errors: ConfigValidationError[] = []

  // Check required fields at root level
  if (spec.required) {
    for (const field of spec.required) {
      if (!(field in config) || config[field] === undefined) {
        errors.push({
          path: field,
          message: `Missing required field '${field}'`,
          code: 'required',
        })
      }
    }
  }

  // Validate each property
  for (const [key, propSpec] of Object.entries(spec.properties)) {
    if (key in config) {
      errors.push(...validateProperty(config[key], propSpec, key))
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Mask secret values in a configuration
 */
export function maskSecrets(
  config: Record<string, unknown>,
  spec: ConfigSpec,
  mask: string = '******',
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(config)) {
    const propSpec = spec.properties[key]

    if (!propSpec) {
      result[key] = value
      continue
    }

    if (propSpec.secret || propSpec.airbyte_secret) {
      result[key] = mask
    } else if (propSpec.type === 'object' && propSpec.properties && typeof value === 'object' && value !== null) {
      result[key] = maskSecrets(value as Record<string, unknown>, {
        type: 'object',
        properties: propSpec.properties,
        required: propSpec.required,
      }, mask)
    } else {
      result[key] = value
    }
  }

  return result
}

// =============================================================================
// Catalog Discovery Utilities
// =============================================================================

/**
 * Infer JSON Schema property type from a JavaScript value
 */
export function inferPropertyType(value: unknown): PropertySpec {
  if (value === null || value === undefined) {
    return { type: 'string' }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: 'array', items: { type: 'string' } }
    }
    return { type: 'array', items: inferPropertyType(value[0]) }
  }

  if (typeof value === 'object') {
    const properties: Record<string, PropertySpec> = {}
    for (const [k, v] of Object.entries(value)) {
      properties[k] = inferPropertyType(v)
    }
    return { type: 'object', properties }
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' }
  }

  if (typeof value === 'boolean') {
    return { type: 'boolean' }
  }

  // String with format detection
  if (typeof value === 'string') {
    // ISO date-time
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return { type: 'string', format: 'date-time' }
    }
    // ISO date
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { type: 'string', format: 'date' }
    }
    // Email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { type: 'string', format: 'email' }
    }
    // URI
    if (/^https?:\/\//.test(value)) {
      return { type: 'string', format: 'uri' }
    }
    return { type: 'string' }
  }

  return { type: 'string' }
}

/**
 * Infer a stream schema from sample records
 */
export function inferStreamSchema(records: Record<string, unknown>[]): StreamSchema {
  if (records.length === 0) {
    return { type: 'object', properties: {} }
  }

  // Merge schemas from all records
  const properties: Record<string, PropertySpec> = {}

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!(key in properties)) {
        properties[key] = inferPropertyType(value)
      } else {
        // Merge: prefer non-null types
        const existing = properties[key]
        const inferred = inferPropertyType(value)

        // If existing is less specific, upgrade it
        if (existing.type === 'string' && !existing.format && inferred.format) {
          properties[key] = inferred
        }
        // Merge nested object properties
        if (existing.type === 'object' && inferred.type === 'object') {
          properties[key] = {
            type: 'object',
            properties: {
              ...existing.properties,
              ...inferred.properties,
            },
          }
        }
      }
    }
  }

  return { type: 'object', properties }
}

/**
 * Create a catalog from discovered streams
 */
export interface CatalogBuilder {
  addStream: (stream: Omit<Stream, 'supportedSyncModes'> & { supportedSyncModes?: SyncMode[] }) => CatalogBuilder
  build: () => Stream[]
}

/**
 * Create a catalog builder for easier stream construction
 */
export function createCatalogBuilder(): CatalogBuilder {
  const streams: Stream[] = []

  return {
    addStream(stream) {
      streams.push({
        ...stream,
        supportedSyncModes: stream.supportedSyncModes ?? ['full_refresh'],
      })
      return this
    },
    build() {
      return streams
    },
  }
}

/**
 * Detect potential primary keys from records
 */
export function detectPrimaryKey(records: Record<string, unknown>[]): string[][] | undefined {
  if (records.length < 2) return undefined

  const candidates = ['id', '_id', 'uuid', 'pk', 'key']

  for (const candidate of candidates) {
    if (records.every((r) => candidate in r)) {
      const values = records.map((r) => r[candidate])
      const uniqueValues = new Set(values)
      if (uniqueValues.size === records.length) {
        return [[candidate]]
      }
    }
  }

  return undefined
}

/**
 * Detect potential cursor fields for incremental sync
 */
export function detectCursorField(schema: StreamSchema): string[] | undefined {
  const cursorCandidates = ['updated_at', 'modified_at', 'created_at', 'timestamp', 'date']

  for (const candidate of cursorCandidates) {
    const prop = schema.properties[candidate]
    if (prop && (prop.format === 'date-time' || prop.format === 'date')) {
      return [candidate]
    }
  }

  // Check for any date-time field
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.format === 'date-time' || prop.format === 'date') {
      return [key]
    }
  }

  return undefined
}

/**
 * Build an AirbyteCatalog from discovered streams (Airbyte protocol compatible)
 */
export interface AirbyteCatalog {
  streams: Array<{
    stream: Stream
    config?: {
      syncMode: SyncMode
      destinationSyncMode?: DestinationSyncMode
      cursorField?: string[]
      primaryKey?: string[][]
    }
  }>
}

/**
 * Convert streams to AirbyteCatalog format
 */
export function toAirbyteCatalog(streams: Stream[]): AirbyteCatalog {
  return {
    streams: streams.map((stream) => ({
      stream,
      config: {
        syncMode: stream.supportedSyncModes.includes('incremental') ? 'incremental' : 'full_refresh',
        cursorField: stream.defaultCursorField,
        primaryKey: stream.sourceDefinedPrimaryKey,
      },
    })),
  }
}

// =============================================================================
// Convenience Discovery Functions
// =============================================================================

/**
 * Options for discovering a stream from sample records
 */
export interface DiscoverStreamOptions {
  /** Optional namespace for the stream */
  namespace?: string
  /** Override supported sync modes (defaults to auto-detection) */
  supportedSyncModes?: SyncMode[]
  /** Override primary key (defaults to auto-detection) */
  primaryKey?: string[][]
  /** Override cursor field (defaults to auto-detection) */
  cursorField?: string[]
}

/**
 * Discover a stream definition from sample records
 *
 * This convenience function combines schema inference, primary key detection,
 * and cursor field detection into a single operation to create a complete
 * Stream definition suitable for catalog discovery.
 *
 * @param name - The stream/table name
 * @param records - Sample records to infer schema from
 * @param options - Optional overrides for namespace, sync modes, etc.
 * @returns A complete Stream definition
 */
export function discoverStreamFromRecords(
  name: string,
  records: Record<string, unknown>[],
  options: DiscoverStreamOptions = {},
): Stream {
  // Infer schema from records
  const schema = inferStreamSchema(records)

  // Detect primary key unless explicitly provided
  const detectedPrimaryKey = options.primaryKey ?? detectPrimaryKey(records)

  // Detect cursor field unless explicitly provided
  const detectedCursorField = options.cursorField ?? detectCursorField(schema)

  // Determine if cursor was detected/specified
  const hasCursor = detectedCursorField !== undefined

  // Determine supported sync modes
  let supportedSyncModes: SyncMode[]
  if (options.supportedSyncModes) {
    supportedSyncModes = options.supportedSyncModes
  } else if (hasCursor) {
    // If we have a cursor, support both modes
    supportedSyncModes = ['full_refresh', 'incremental']
  } else {
    // No cursor, only full refresh
    supportedSyncModes = ['full_refresh']
  }

  return {
    name,
    namespace: options.namespace,
    schema,
    supportedSyncModes,
    sourceDefinedPrimaryKey: detectedPrimaryKey,
    sourceDefinedCursor: hasCursor,
    defaultCursorField: detectedCursorField,
  }
}

/**
 * Options for discovering multiple streams from data object
 */
export interface DiscoverCatalogOptions {
  /** Namespace to apply to all discovered streams */
  namespace?: string
}

/**
 * Discover multiple streams from a data object
 *
 * This convenience function takes an object where keys are stream names
 * and values are arrays of sample records, returning an array of Stream
 * definitions with auto-inferred schemas, primary keys, and cursors.
 *
 * @param data - Object mapping stream names to sample records
 * @param options - Optional namespace to apply to all streams
 * @returns Array of Stream definitions
 *
 * @example
 * ```ts
 * const streams = discoverCatalogFromData({
 *   users: [{ id: 1, name: 'Alice' }],
 *   orders: [{ id: 101, total: 99.99 }]
 * })
 * ```
 */
export function discoverCatalogFromData(
  data: Record<string, Record<string, unknown>[]>,
  options: DiscoverCatalogOptions = {},
): Stream[] {
  const streams: Stream[] = []

  for (const [name, records] of Object.entries(data)) {
    streams.push(
      discoverStreamFromRecords(name, records, {
        namespace: options.namespace,
      }),
    )
  }

  return streams
}

// =============================================================================
// Sync Modes Re-exports
// =============================================================================
export {
  // Full refresh
  FullRefreshSync,
  createFullRefreshSync,
  type FullRefreshConfig,
  // Incremental
  IncrementalSync,
  createIncrementalSync,
  type IncrementalConfig,
  // CDC
  CDCSyncMode,
  createCDCSync,
  type CDCConfig,
  type CDCChange,
  type CDCRecordType,
  type InitialSnapshotConfig,
  type RetryConfig,
  // Common types
  type SyncModeConfig,
  type SyncProgress,
  type SyncCheckpoint,
} from './sync-modes'

// =============================================================================
// Config Spec Re-exports
// =============================================================================
export {
  // Factory functions
  createConfigSpec,
  // Validation functions
  validateConfig as validateConfigSpec,
  validateOAuthConfig,
  // Secret masking
  maskSecrets as maskConfigSecrets,
  getSecretFields,
  // Defaults and coercion
  applyDefaults,
  coerceConfigTypes,
  mergeConfigs,
  // Error formatting
  formatValidationErrors,
  // Types
  type ConfigSpec as ConfigSpecType,
  type PropertySpec as ConfigPropertySpec,
  type OAuth2FlowConfig,
  type AuthMethodConfig,
  type ConfigValidationError,
  type ConfigValidationResult,
} from './config-spec'

// =============================================================================
// Schema Mapper Re-exports
// =============================================================================
export {
  // Schema mapper factory
  createSchemaMapper,
  type SchemaMapper,
  // Types
  type SchemaMapping,
  type FieldAlias,
  type ComputedFieldDef,
  type SchemaMapperConfig,
  // Coercion
  coerceValue,
  registerCoercionRule,
  getCoercionRules,
  type CoercionRule,
  type CoercionTargetType,
  // Flattening
  flattenRecord,
  unflattenRecord,
  type FlattenOptions,
  type UnflattenOptions,
  // Schema evolution
  createSchemaEvolution,
  migrateRecord,
  detectSchemaChanges,
  type SchemaVersion,
  type SchemaEvolution,
  type SchemaChange,
  type SchemaChangeType,
} from './schema-mapper'

// =============================================================================
// DiffEngine Re-exports
// =============================================================================
export {
  // Factory function
  createDiffEngine,
  // Types
  type DiffEngine,
  type DiffResult,
  type DiffOptions,
  type DiffRecord,
  type DiffStats,
} from './diff-engine'

// =============================================================================
// Conflict Resolver Re-exports
// =============================================================================
export {
  // Factory function
  createConflictResolver,
  // Types
  type ConflictResolver,
  type Conflict,
  type ResolvedRecord,
  type RecordState,
  type ResolutionStrategy,
  type Winner,
  type CustomResolver,
  type MergeOptions,
  type ConflictResolverConfig,
  type ResolutionStats,
  type ResolutionMetadata,
} from './conflict-resolver'

// =============================================================================
// Convenience Exports
// =============================================================================
// ConnectorFramework is already exported via the interface declaration above

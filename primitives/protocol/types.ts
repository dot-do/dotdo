/**
 * Protocol Types - Universal Data Operation Interface
 *
 * Type definitions for the Protocol abstraction that composes
 * Pipe, Resource, Channel, and Machine into a single interface.
 */

// =============================================================================
// Config Schema Types
// =============================================================================

/** Supported config value types */
export type ConfigType = 'string' | 'number' | 'boolean' | 'object' | 'array'

/** Schema for a single config field */
export interface ConfigFieldSchema {
  type: ConfigType
  required?: boolean
  default?: unknown
  validate?: (value: unknown) => boolean
}

/** Config schema definition */
export type ConfigSchema = Record<string, ConfigFieldSchema>

/** Extract config type from schema */
export type ConfigFromSchema<T extends ConfigSchema> = {
  [K in keyof T]: T[K]['required'] extends true
    ? ConfigTypeMap[T[K]['type']]
    : ConfigTypeMap[T[K]['type']] | undefined
}

/** Map from type string to TypeScript type */
interface ConfigTypeMap {
  string: string
  number: number
  boolean: boolean
  object: Record<string, unknown>
  array: unknown[]
}

// =============================================================================
// Connection Types
// =============================================================================

/** Connection state and context */
export interface Connection {
  isConnected: boolean
  context: Record<string, unknown>
}

/** Connect handler type */
export type OnConnectHandler<TConfig> = (config: TConfig) => Promise<Record<string, unknown>>

/** Disconnect handler type */
export type OnDisconnectHandler = () => Promise<void>

// =============================================================================
// Operation Types
// =============================================================================

/** Base operation type identifier */
export type OperationType = 'pipe' | 'resource' | 'channel' | 'machine'

/** Pipe operation definition */
export interface PipeOperationDef<TIn = unknown, TOut = unknown> {
  type: 'pipe'
  handler: (input: TIn) => Promise<TOut>
  input?: Record<string, ConfigFieldSchema>
  output?: Record<string, ConfigFieldSchema>
  description?: string
  deprecated?: boolean
  deprecationMessage?: string
  tags?: string[]
}

/** Resource operation definition */
export interface ResourceOperationDef<T = unknown> {
  type: 'resource'
  schema: Record<string, ConfigFieldSchema>
  description?: string
  deprecated?: boolean
  deprecationMessage?: string
  tags?: string[]
}

/** Channel operation definition */
export interface ChannelOperationDef {
  type: 'channel'
  channelType?: 'public' | 'private' | 'presence'
  description?: string
  deprecated?: boolean
  deprecationMessage?: string
  tags?: string[]
}

/** Machine operation definition */
export interface MachineOperationDef<
  TState extends string = string,
  TEvent extends { type: string } = { type: string },
  TContext = unknown,
> {
  type: 'machine'
  config: {
    id: string
    initial: TState
    context?: TContext
    states: Record<TState, unknown>
  }
  description?: string
  deprecated?: boolean
  deprecationMessage?: string
  tags?: string[]
}

/** Union of all operation definitions */
export type OperationDef = PipeOperationDef | ResourceOperationDef | ChannelOperationDef | MachineOperationDef

/** Operations map */
export type OperationsMap = Record<string, OperationDef>

// =============================================================================
// Middleware Types
// =============================================================================

/** Middleware context */
export interface MiddlewareContext<TConfig = unknown> {
  operation: string
  protocol: string
  config: TConfig
  input: unknown
  connection: Connection
}

/** Middleware function */
export type Middleware<TConfig = unknown> = (
  ctx: MiddlewareContext<TConfig>,
  next: () => Promise<unknown>
) => Promise<unknown>

// =============================================================================
// Capability and Schema Types
// =============================================================================

/** Capability descriptor */
export interface Capability {
  name: string
  type: OperationType
}

/** Operation schema */
export interface OperationSchema {
  type: OperationType
  schema?: Record<string, ConfigFieldSchema>
  input?: Record<string, ConfigFieldSchema>
  output?: Record<string, ConfigFieldSchema>
  description?: string
  deprecated?: boolean
  deprecationMessage?: string
  tags?: string[]
}

/** Protocol schema */
export interface ProtocolSchema {
  name: string
  version: string
  config: ConfigSchema
  operations: Record<string, OperationSchema>
}

// =============================================================================
// Protocol Config Types
// =============================================================================

/** Protocol definition config */
export interface ProtocolDefinition<
  TConfig extends ConfigSchema = ConfigSchema,
  TOps extends OperationsMap = OperationsMap,
> {
  name: string
  version: string
  config?: TConfig
  operations?: TOps
  onConnect?: OnConnectHandler<ConfigFromSchema<TConfig>>
  onDisconnect?: OnDisconnectHandler
}

// =============================================================================
// Protocol Instance Types
// =============================================================================

/** Configured protocol instance */
export interface ConfiguredProtocol<
  TConfig extends ConfigSchema = ConfigSchema,
  TOps extends OperationsMap = OperationsMap,
> {
  config: ConfigFromSchema<TConfig>
  operations: ResolvedOperations<TOps>
  use(middleware: Middleware<ConfigFromSchema<TConfig>>): this
  connect(): Promise<Connection>
  disconnect(): Promise<void>
}

/** Protocol instance (before configure) */
export interface ProtocolInstance<
  TConfig extends ConfigSchema = ConfigSchema,
  TOps extends OperationsMap = OperationsMap,
> {
  name: string
  version: string
  configure(config: Partial<ConfigFromSchema<TConfig>>): ConfiguredProtocol<TConfig, TOps>
  capabilities(): Capability[]
  schema(): ProtocolSchema
}

// =============================================================================
// Resolved Operation Types
// =============================================================================

/** Resource interface (from primitives/resource) */
interface ResolvedResource<T = unknown> {
  create(data: Omit<T, 'id'>): Promise<T & { id: string }>
  get(id: string): Promise<T | null>
  update(id: string, patch: Partial<T>): Promise<T>
  delete(id: string): Promise<void>
  find(query?: unknown): AsyncIterable<T>
  findOne(query?: unknown): Promise<T | null>
  count(query?: unknown): Promise<number>
}

/** Channel interface (from primitives/channel) */
interface ResolvedChannel<T = unknown> {
  publish(event: string, data: T): Promise<void>
  subscribe(event: string, handler: (data: T) => void): { id: string; unsubscribe: () => void }
  unsubscribe(subscription: { id: string }): void
}

/** Machine factory interface */
interface ResolvedMachineFactory<
  TState extends string = string,
  TEvent extends { type: string } = { type: string },
  TContext = unknown,
> {
  create(initialContext?: Partial<TContext>): {
    state: TState
    context: TContext
    send(event: TEvent): Promise<TState>
    can(event: TEvent): boolean
  }
}

/** Resolve operation def to runtime type */
export type ResolveOperation<T extends OperationDef> = T extends PipeOperationDef<infer TIn, infer TOut>
  ? (input: TIn) => Promise<TOut>
  : T extends ResourceOperationDef
    ? ResolvedResource
    : T extends ChannelOperationDef
      ? ResolvedChannel
      : T extends MachineOperationDef<infer TState, infer TEvent, infer TContext>
        ? ResolvedMachineFactory<TState, TEvent, TContext>
        : never

/** Resolved operations map */
export type ResolvedOperations<T extends OperationsMap> = {
  [K in keyof T]: ResolveOperation<T[K]>
}

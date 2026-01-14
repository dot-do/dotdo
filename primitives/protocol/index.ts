/**
 * Protocol - Universal Data Operation Interface
 *
 * Composes Pipe, Resource, Channel, and Machine into a single
 * configurable interface. Every compat layer becomes a Protocol implementation.
 */

import { Pipe, type PipeInstance } from '../pipe/index'
import { InMemoryResource, type Resource } from '../resource/index'
import { createChannel, type Channel } from '../channel/index'
import { Machine, type Machine as MachineInstance, type MachineConfig, type MachineFactory } from '../machine/index'

import type {
  ConfigSchema,
  ConfigFieldSchema,
  ConfigFromSchema,
  Connection,
  OperationsMap,
  OperationDef,
  PipeOperationDef,
  ResourceOperationDef,
  ChannelOperationDef,
  MachineOperationDef,
  Middleware,
  MiddlewareContext,
  Capability,
  ProtocolSchema,
  OperationSchema,
  OnConnectHandler,
  OnDisconnectHandler,
} from './types'

export type {
  ProtocolInstance,
  ConfiguredProtocol,
  ProtocolDefinition,
  Connection,
  Middleware,
  MiddlewareContext,
  Capability,
  ProtocolSchema,
  ConfigSchema,
  ConfigFieldSchema,
  OperationDef,
  OperationsMap,
} from './types'

// Re-export as shorthand
export type ProtocolConfig = import('./types').ProtocolDefinition

// =============================================================================
// Config Validation
// =============================================================================

/**
 * Validate a config value against its schema
 */
function validateConfigValue(key: string, value: unknown, schema: ConfigFieldSchema): void {
  // Check required
  if (schema.required && (value === undefined || value === null)) {
    throw new Error(`Config field '${key}' is required`)
  }

  // Skip type check if value is undefined and not required
  if (value === undefined || value === null) {
    return
  }

  // Type check
  const actualType = Array.isArray(value) ? 'array' : typeof value
  if (actualType !== schema.type) {
    throw new Error(`Config field '${key}' must be of type ${schema.type}, got ${actualType}`)
  }

  // Custom validator
  if (schema.validate && !schema.validate(value)) {
    throw new Error(`Config field '${key}' is invalid`)
  }
}

/**
 * Validate and apply defaults to config
 */
function validateConfig<T extends ConfigSchema>(
  config: Partial<ConfigFromSchema<T>>,
  schema: T | undefined
): ConfigFromSchema<T> {
  if (!schema) {
    return config as ConfigFromSchema<T>
  }

  const result: Record<string, unknown> = { ...config }

  for (const [key, fieldSchema] of Object.entries(schema)) {
    const value = result[key]

    // Apply default if not provided
    if ((value === undefined || value === null) && fieldSchema.default !== undefined) {
      result[key] = fieldSchema.default
    }

    validateConfigValue(key, result[key], fieldSchema)
  }

  return result as ConfigFromSchema<T>
}

// =============================================================================
// Operation Resolution
// =============================================================================

/**
 * Create a pipe operation
 */
function createPipeOperation<TIn, TOut>(
  def: PipeOperationDef<TIn, TOut>,
  middlewares: Middleware[],
  getContext: () => { protocol: string; config: unknown; connection: Connection }
): (input: TIn) => Promise<TOut> {
  return async (input: TIn): Promise<TOut> => {
    const { protocol, config, connection } = getContext()

    if (!connection.isConnected) {
      throw new Error('Protocol is not connected')
    }

    const ctx: MiddlewareContext = {
      operation: 'pipe',
      protocol,
      config,
      input,
      connection,
    }

    // Compose middleware
    let index = 0
    const next = async (): Promise<unknown> => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++]
        return middleware(ctx, next)
      }
      return def.handler(ctx.input as TIn)
    }

    return next() as Promise<TOut>
  }
}

/**
 * Create a resource operation
 */
function createResourceOperation<T>(
  def: ResourceOperationDef<T>,
  middlewares: Middleware[],
  getContext: () => { protocol: string; config: unknown; connection: Connection }
): Resource<T & { id: string }> {
  const resource = new InMemoryResource<T & { id: string }>()
  return resource
}

/**
 * Create a channel operation
 */
function createChannelOperation(
  def: ChannelOperationDef,
  middlewares: Middleware[],
  getContext: () => { protocol: string; config: unknown; connection: Connection },
  name: string
): Channel {
  return createChannel(name, { type: def.channelType ?? 'public' })
}

/**
 * Create a machine factory operation
 */
function createMachineOperation<
  TState extends string,
  TEvent extends { type: string },
  TContext,
>(
  def: MachineOperationDef<TState, TEvent, TContext>,
  middlewares: Middleware[],
  getContext: () => { protocol: string; config: unknown; connection: Connection }
): MachineFactory<TState, TEvent, TContext> {
  return Machine.define(def.config as MachineConfig<TState, TEvent, TContext>)
}

// =============================================================================
// Protocol Implementation
// =============================================================================

/**
 * Internal protocol state
 */
interface ProtocolState<TConfig extends ConfigSchema, TOps extends OperationsMap> {
  name: string
  version: string
  configSchema?: TConfig
  operationDefs?: TOps
  onConnect?: OnConnectHandler<ConfigFromSchema<TConfig>>
  onDisconnect?: OnDisconnectHandler
}

/**
 * Configured protocol state
 */
interface ConfiguredState<TConfig extends ConfigSchema, TOps extends OperationsMap> {
  protocol: ProtocolState<TConfig, TOps>
  config: ConfigFromSchema<TConfig>
  middlewares: Middleware<ConfigFromSchema<TConfig>>[]
  connection: Connection
  resolvedOperations?: Record<string, unknown>
}

/**
 * Create a configured protocol instance
 */
function createConfiguredProtocol<TConfig extends ConfigSchema, TOps extends OperationsMap>(
  state: ConfiguredState<TConfig, TOps>
): ConfiguredProtocolImpl<TConfig, TOps> {
  return {
    get config() {
      return state.config
    },

    get operations() {
      if (!state.resolvedOperations) {
        // Lazy create operations
        state.resolvedOperations = {}

        const getContext = () => ({
          protocol: state.protocol.name,
          config: state.config,
          connection: state.connection,
        })

        if (state.protocol.operationDefs) {
          for (const [name, def] of Object.entries(state.protocol.operationDefs)) {
            switch (def.type) {
              case 'pipe':
                state.resolvedOperations[name] = createPipeOperation(
                  def as PipeOperationDef,
                  state.middlewares as Middleware[],
                  getContext
                )
                break
              case 'resource':
                state.resolvedOperations[name] = createResourceOperation(
                  def as ResourceOperationDef,
                  state.middlewares as Middleware[],
                  getContext
                )
                break
              case 'channel':
                state.resolvedOperations[name] = createChannelOperation(
                  def as ChannelOperationDef,
                  state.middlewares as Middleware[],
                  getContext,
                  name
                )
                break
              case 'machine':
                state.resolvedOperations[name] = createMachineOperation(
                  def as MachineOperationDef,
                  state.middlewares as Middleware[],
                  getContext
                )
                break
            }
          }
        }
      }

      // Wrap operations to check connection and apply middleware
      return new Proxy(state.resolvedOperations as Record<string, unknown>, {
        get(target, prop: string) {
          const operation = target[prop]
          if (!operation) return undefined

          const def = state.protocol.operationDefs?.[prop]
          if (!def) return operation

          // For pipe operations, wrap to check connection and apply middleware
          if (def.type === 'pipe') {
            return async (input: unknown) => {
              if (!state.connection.isConnected) {
                throw new Error('Protocol is not connected')
              }

              const ctx: MiddlewareContext<ConfigFromSchema<TConfig>> = {
                operation: prop,
                protocol: state.protocol.name,
                config: state.config,
                input,
                connection: state.connection,
              }

              let index = 0
              const next = async (): Promise<unknown> => {
                if (index < state.middlewares.length) {
                  const middleware = state.middlewares[index++]
                  return middleware(ctx, next)
                }
                return (def as PipeOperationDef).handler(ctx.input)
              }

              return next()
            }
          }

          return operation
        },
      }) as any
    },

    use(middleware: Middleware<ConfigFromSchema<TConfig>>) {
      state.middlewares.push(middleware)
      return this
    },

    async connect(): Promise<Connection> {
      if (state.protocol.onConnect) {
        const context = await state.protocol.onConnect(state.config)
        state.connection.context = context
      }
      state.connection.isConnected = true
      return state.connection
    },

    async disconnect(): Promise<void> {
      if (state.protocol.onDisconnect) {
        await state.protocol.onDisconnect()
      }
      state.connection.isConnected = false
    },
  }
}

interface ConfiguredProtocolImpl<TConfig extends ConfigSchema, TOps extends OperationsMap> {
  readonly config: ConfigFromSchema<TConfig>
  readonly operations: any
  use(middleware: Middleware<ConfigFromSchema<TConfig>>): this
  connect(): Promise<Connection>
  disconnect(): Promise<void>
}

/**
 * Create a protocol instance
 */
function createProtocolInstance<TConfig extends ConfigSchema, TOps extends OperationsMap>(
  state: ProtocolState<TConfig, TOps>
): ProtocolInstanceImpl<TConfig, TOps> {
  return {
    get name() {
      return state.name
    },

    get version() {
      return state.version
    },

    configure(config: Partial<ConfigFromSchema<TConfig>>) {
      const validatedConfig = validateConfig(config, state.configSchema)

      return createConfiguredProtocol<TConfig, TOps>({
        protocol: state,
        config: validatedConfig,
        middlewares: [],
        connection: {
          isConnected: false,
          context: {},
        },
      })
    },

    capabilities(): Capability[] {
      if (!state.operationDefs) return []

      return Object.entries(state.operationDefs).map(([name, def]) => ({
        name,
        type: def.type,
      }))
    },

    schema(): ProtocolSchema {
      const operations: Record<string, OperationSchema> = {}

      if (state.operationDefs) {
        for (const [name, def] of Object.entries(state.operationDefs)) {
          const opSchema: OperationSchema = {
            type: def.type,
            description: def.description,
            deprecated: def.deprecated,
            deprecationMessage: def.deprecationMessage,
            tags: def.tags,
          }

          if (def.type === 'pipe') {
            const pipeDef = def as PipeOperationDef
            opSchema.input = pipeDef.input
            opSchema.output = pipeDef.output
          } else if (def.type === 'resource') {
            const resourceDef = def as ResourceOperationDef
            opSchema.schema = resourceDef.schema
          }

          operations[name] = opSchema
        }
      }

      return {
        name: state.name,
        version: state.version,
        config: state.configSchema ?? {},
        operations,
      }
    },
  }
}

interface ProtocolInstanceImpl<TConfig extends ConfigSchema, TOps extends OperationsMap> {
  readonly name: string
  readonly version: string
  configure(config: Partial<ConfigFromSchema<TConfig>>): ConfiguredProtocolImpl<TConfig, TOps>
  capabilities(): Capability[]
  schema(): ProtocolSchema
}

// =============================================================================
// Protocol Factory
// =============================================================================

export interface ProtocolDefinitionInput<
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

/**
 * Protocol factory with static methods
 */
export const Protocol = {
  /**
   * Define a new protocol
   */
  define<TConfig extends ConfigSchema = ConfigSchema, TOps extends OperationsMap = OperationsMap>(
    definition: ProtocolDefinitionInput<TConfig, TOps>
  ): ProtocolInstanceImpl<TConfig, TOps> {
    return createProtocolInstance({
      name: definition.name,
      version: definition.version,
      configSchema: definition.config,
      operationDefs: definition.operations,
      onConnect: definition.onConnect,
      onDisconnect: definition.onDisconnect,
    })
  },

  /**
   * Extend an existing protocol with additional config and operations
   */
  extend<
    TBaseConfig extends ConfigSchema,
    TBaseOps extends OperationsMap,
    TExtConfig extends ConfigSchema,
    TExtOps extends OperationsMap,
  >(
    base: ProtocolInstanceImpl<TBaseConfig, TBaseOps>,
    extension: {
      name?: string
      version?: string
      config?: TExtConfig
      operations?: TExtOps
    }
  ): ProtocolInstanceImpl<TBaseConfig & TExtConfig, TBaseOps & TExtOps> {
    const baseSchema = base.schema()

    const mergedConfig = {
      ...baseSchema.config,
      ...(extension.config ?? {}),
    } as TBaseConfig & TExtConfig

    // Reconstruct operation defs from schema + new operations
    const mergedOperations: OperationsMap = {}

    // Add base operations (reconstruct from schema)
    for (const [name, opSchema] of Object.entries(baseSchema.operations)) {
      if (opSchema.type === 'pipe') {
        mergedOperations[name] = {
          type: 'pipe',
          handler: async () => ({}), // Placeholder - real impl would need handler
          ...opSchema,
        } as PipeOperationDef
      } else if (opSchema.type === 'resource') {
        mergedOperations[name] = {
          type: 'resource',
          schema: opSchema.schema ?? {},
          ...opSchema,
        } as ResourceOperationDef
      } else if (opSchema.type === 'channel') {
        mergedOperations[name] = {
          type: 'channel',
          ...opSchema,
        } as ChannelOperationDef
      } else if (opSchema.type === 'machine') {
        mergedOperations[name] = {
          type: 'machine',
          config: { id: name, initial: 'initial', states: {} },
          ...opSchema,
        } as MachineOperationDef
      }
    }

    // Add extension operations
    if (extension.operations) {
      for (const [name, def] of Object.entries(extension.operations)) {
        mergedOperations[name] = def
      }
    }

    return createProtocolInstance({
      name: extension.name ?? baseSchema.name,
      version: extension.version ?? baseSchema.version,
      configSchema: mergedConfig,
      operationDefs: mergedOperations as TBaseOps & TExtOps,
    })
  },

  /**
   * Compose multiple protocols into one
   */
  compose<TProtocols extends ProtocolInstanceImpl<any, any>[]>(
    protocols: TProtocols,
    options: { name: string; version: string }
  ): ProtocolInstanceImpl<ConfigSchema, OperationsMap> {
    const mergedConfig: ConfigSchema = {}
    const mergedOperations: OperationsMap = {}

    for (const protocol of protocols) {
      const schema = protocol.schema()

      // Merge config
      Object.assign(mergedConfig, schema.config)

      // Get capabilities and merge operations
      const capabilities = protocol.capabilities()
      for (const cap of capabilities) {
        const opSchema = schema.operations[cap.name]
        if (opSchema) {
          if (cap.type === 'pipe') {
            // For composed protocols, we need to preserve the original handler
            // This is a simplified version - full impl would need to track handlers
            mergedOperations[cap.name] = {
              type: 'pipe',
              handler: async (input: unknown) => {
                // This is a placeholder - real impl would delegate to original protocol
                return input
              },
              ...opSchema,
            } as PipeOperationDef
          } else if (cap.type === 'resource') {
            mergedOperations[cap.name] = {
              type: 'resource',
              schema: opSchema.schema ?? {},
              ...opSchema,
            } as ResourceOperationDef
          } else if (cap.type === 'channel') {
            mergedOperations[cap.name] = {
              type: 'channel',
              ...opSchema,
            } as ChannelOperationDef
          } else if (cap.type === 'machine') {
            mergedOperations[cap.name] = {
              type: 'machine',
              config: { id: cap.name, initial: 'initial', states: {} },
              ...opSchema,
            } as MachineOperationDef
          }
        }
      }
    }

    return createProtocolInstance({
      name: options.name,
      version: options.version,
      configSchema: mergedConfig,
      operationDefs: mergedOperations,
    })
  },
}

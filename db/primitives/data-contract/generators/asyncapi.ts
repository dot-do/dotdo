/**
 * AsyncAPI 2.6 Generator for DataContract
 *
 * Generates AsyncAPI specifications for event-driven architectures.
 * Supports:
 * - Message generation from DataContract
 * - Channel definitions for pub/sub patterns
 * - Example generation from schema defaults
 * - Deprecation notices from version metadata
 */

import type { DataContract, JSONSchema, SchemaMetadata } from '../index'
import { generateExample, generateOpenAPIDocument } from './openapi'

// ============================================================================
// TYPES
// ============================================================================

/**
 * AsyncAPI 2.6 Document
 */
export interface AsyncAPIDocument {
  asyncapi: '2.6.0'
  info: AsyncAPIInfo
  servers?: Record<string, AsyncAPIServer>
  channels: Record<string, AsyncAPIChannel>
  components?: AsyncAPIComponents
  tags?: AsyncAPITag[]
  defaultContentType?: string
}

/**
 * AsyncAPI Info object
 */
export interface AsyncAPIInfo {
  title: string
  version: string
  description?: string
  termsOfService?: string
  contact?: {
    name?: string
    url?: string
    email?: string
  }
  license?: {
    name: string
    url?: string
  }
}

/**
 * AsyncAPI Server object
 */
export interface AsyncAPIServer {
  url: string
  protocol: string
  protocolVersion?: string
  description?: string
  variables?: Record<
    string,
    {
      default?: string
      description?: string
      enum?: string[]
    }
  >
  security?: Array<Record<string, string[]>>
  bindings?: Record<string, unknown>
}

/**
 * AsyncAPI Tag object
 */
export interface AsyncAPITag {
  name: string
  description?: string
  externalDocs?: {
    url: string
    description?: string
  }
}

/**
 * AsyncAPI Channel object
 */
export interface AsyncAPIChannel {
  description?: string
  subscribe?: AsyncAPIOperation
  publish?: AsyncAPIOperation
  parameters?: Record<string, AsyncAPIParameter>
  bindings?: Record<string, unknown>
  servers?: string[]
}

/**
 * AsyncAPI Operation object
 */
export interface AsyncAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: AsyncAPITag[]
  externalDocs?: { url: string; description?: string }
  bindings?: Record<string, unknown>
  traits?: Array<Record<string, unknown>>
  message?: AsyncAPIMessage | { oneOf: AsyncAPIMessage[] }
  security?: Array<Record<string, string[]>>
}

/**
 * AsyncAPI Parameter object
 */
export interface AsyncAPIParameter {
  description?: string
  schema?: AsyncAPISchema
  location?: string
}

/**
 * AsyncAPI Message object
 */
export interface AsyncAPIMessage {
  messageId?: string
  headers?: AsyncAPISchema
  payload?: AsyncAPISchema
  correlationId?: { location: string; description?: string }
  schemaFormat?: string
  contentType?: string
  name?: string
  title?: string
  summary?: string
  description?: string
  tags?: AsyncAPITag[]
  externalDocs?: { url: string; description?: string }
  bindings?: Record<string, unknown>
  examples?: Array<{
    headers?: Record<string, unknown>
    payload?: unknown
    name?: string
    summary?: string
  }>
  traits?: Array<Record<string, unknown>>
  deprecated?: boolean
}

/**
 * AsyncAPI Schema object (JSON Schema compatible)
 */
export interface AsyncAPISchema {
  type?: string | string[]
  properties?: Record<string, AsyncAPISchema>
  required?: string[]
  items?: AsyncAPISchema
  additionalProperties?: boolean | AsyncAPISchema
  enum?: (string | number | boolean | null)[]
  format?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: boolean | number
  exclusiveMaximum?: boolean | number
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  description?: string
  default?: unknown
  example?: unknown
  deprecated?: boolean
  $ref?: string
  allOf?: AsyncAPISchema[]
  oneOf?: AsyncAPISchema[]
  anyOf?: AsyncAPISchema[]
}

/**
 * AsyncAPI Components object
 */
export interface AsyncAPIComponents {
  schemas?: Record<string, AsyncAPISchema>
  messages?: Record<string, AsyncAPIMessage>
  securitySchemes?: Record<string, AsyncAPISecurityScheme>
  parameters?: Record<string, AsyncAPIParameter>
  correlationIds?: Record<string, { location: string; description?: string }>
  operationTraits?: Record<string, unknown>
  messageTraits?: Record<string, unknown>
  serverBindings?: Record<string, unknown>
  channelBindings?: Record<string, unknown>
  operationBindings?: Record<string, unknown>
  messageBindings?: Record<string, unknown>
}

/**
 * AsyncAPI Security Scheme object
 */
export interface AsyncAPISecurityScheme {
  type: 'userPassword' | 'apiKey' | 'X509' | 'symmetricEncryption' | 'asymmetricEncryption' | 'httpApiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'plain' | 'scramSha256' | 'scramSha512' | 'gssapi'
  description?: string
  name?: string
  in?: 'user' | 'password' | 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
  flows?: Record<string, unknown>
  openIdConnectUrl?: string
}

/**
 * Event types to generate channels for
 */
export interface EventOperations {
  created?: boolean
  updated?: boolean
  deleted?: boolean
  custom?: string[]
}

/**
 * Channel configuration
 */
export interface ChannelConfig {
  pattern?: 'pubsub' | 'request-reply'
  protocol?: string
  bindings?: Record<string, unknown>
}

/**
 * Options for AsyncAPI document generation
 */
export interface AsyncAPIGeneratorOptions {
  title?: string
  version?: string
  description?: string
  servers?: Record<string, AsyncAPIServer>
  defaultContentType?: string
  channelPrefix?: string
  events?: EventOperations
  channelConfig?: ChannelConfig
  includeExamples?: boolean
  securitySchemes?: Record<string, AsyncAPISecurityScheme>
}

// ============================================================================
// SCHEMA CONVERSION
// ============================================================================

/**
 * Convert a DataContract's JSON Schema to AsyncAPI Schema format
 */
export function toAsyncAPISchema(contract: DataContract): AsyncAPISchema {
  return convertJSONSchemaToAsyncAPI(contract.schema, contract.metadata)
}

/**
 * Convert JSON Schema to AsyncAPI Schema with examples and deprecation
 */
function convertJSONSchemaToAsyncAPI(schema: JSONSchema, metadata?: SchemaMetadata): AsyncAPISchema {
  const asyncAPISchema: AsyncAPISchema = {}

  // Copy basic properties
  if (schema.type !== undefined) {
    asyncAPISchema.type = schema.type as string | string[]
  }

  if (schema.description !== undefined) {
    asyncAPISchema.description = schema.description
  }

  if (schema.default !== undefined) {
    asyncAPISchema.default = schema.default
    asyncAPISchema.example = schema.default
  }

  if (schema.enum !== undefined) {
    asyncAPISchema.enum = schema.enum
  }

  if (schema.format !== undefined) {
    asyncAPISchema.format = schema.format
  }

  // Numeric constraints
  if (schema.minimum !== undefined) {
    asyncAPISchema.minimum = schema.minimum
  }
  if (schema.maximum !== undefined) {
    asyncAPISchema.maximum = schema.maximum
  }
  if (schema.exclusiveMinimum !== undefined) {
    asyncAPISchema.exclusiveMinimum = schema.exclusiveMinimum
  }
  if (schema.exclusiveMaximum !== undefined) {
    asyncAPISchema.exclusiveMaximum = schema.exclusiveMaximum
  }

  // String constraints
  if (schema.minLength !== undefined) {
    asyncAPISchema.minLength = schema.minLength
  }
  if (schema.maxLength !== undefined) {
    asyncAPISchema.maxLength = schema.maxLength
  }
  if (schema.pattern !== undefined) {
    asyncAPISchema.pattern = schema.pattern
  }

  // Array constraints
  if (schema.minItems !== undefined) {
    asyncAPISchema.minItems = schema.minItems
  }
  if (schema.maxItems !== undefined) {
    asyncAPISchema.maxItems = schema.maxItems
  }

  // Handle nested properties
  if (schema.properties !== undefined) {
    asyncAPISchema.properties = {}
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      asyncAPISchema.properties[key] = convertJSONSchemaToAsyncAPI(propSchema)
    }
  }

  if (schema.required !== undefined) {
    asyncAPISchema.required = schema.required
  }

  // Handle array items
  if (schema.items !== undefined) {
    asyncAPISchema.items = convertJSONSchemaToAsyncAPI(schema.items)
  }

  // Handle additional properties
  if (schema.additionalProperties !== undefined) {
    if (typeof schema.additionalProperties === 'boolean') {
      asyncAPISchema.additionalProperties = schema.additionalProperties
    } else {
      asyncAPISchema.additionalProperties = convertJSONSchemaToAsyncAPI(schema.additionalProperties)
    }
  }

  // Add deprecation notice from metadata
  if (metadata?.deprecated) {
    asyncAPISchema.deprecated = true
    if (metadata.deprecationMessage && asyncAPISchema.description) {
      asyncAPISchema.description = `DEPRECATED: ${metadata.deprecationMessage}\n\n${asyncAPISchema.description}`
    } else if (metadata.deprecationMessage) {
      asyncAPISchema.description = `DEPRECATED: ${metadata.deprecationMessage}`
    }
  }

  return asyncAPISchema
}

// ============================================================================
// MESSAGE GENERATION
// ============================================================================

/**
 * Generate an AsyncAPI message from a DataContract
 */
export function toAsyncAPIMessage(contract: DataContract, eventType?: string): AsyncAPIMessage {
  const schema = toAsyncAPISchema(contract)
  const example = generateExample(contract.schema)
  const isDeprecated = contract.metadata?.deprecated ?? false

  const eventName = eventType ? `${contract.name}.${eventType}` : contract.name
  const title = eventType ? `${toPascalCase(contract.name)} ${toPascalCase(eventType)} Event` : `${toPascalCase(contract.name)} Event`

  const message: AsyncAPIMessage = {
    messageId: toKebabCase(eventName),
    name: eventName,
    title,
    summary: contract.metadata?.description ? `${title}: ${contract.metadata.description}` : title,
    contentType: 'application/json',
    payload: {
      type: 'object',
      properties: {
        eventId: { type: 'string', format: 'uuid', description: 'Unique event identifier' },
        eventType: { type: 'string', enum: [eventType || 'event'], description: 'Type of event' },
        timestamp: { type: 'string', format: 'date-time', description: 'Event timestamp' },
        version: { type: 'string', description: 'Schema version' },
        data: schema,
      },
      required: ['eventId', 'eventType', 'timestamp', 'data'],
    },
    headers: {
      type: 'object',
      properties: {
        correlationId: { type: 'string', format: 'uuid', description: 'Correlation ID for tracing' },
        contentType: { type: 'string', default: 'application/json' },
      },
    },
    correlationId: {
      location: '$message.header#/correlationId',
      description: 'Correlation ID for distributed tracing',
    },
    examples: [
      {
        name: `${eventName}-example`,
        summary: `Example ${eventName} event`,
        headers: {
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
          contentType: 'application/json',
        },
        payload: {
          eventId: '550e8400-e29b-41d4-a716-446655440001',
          eventType: eventType || 'event',
          timestamp: new Date().toISOString(),
          version: contract.version,
          data: example,
        },
      },
    ],
    deprecated: isDeprecated,
  }

  if (isDeprecated && contract.metadata?.deprecationMessage) {
    message.description = `DEPRECATED: ${contract.metadata.deprecationMessage}`
  }

  return message
}

// ============================================================================
// CHANNEL GENERATION
// ============================================================================

/**
 * Generate an AsyncAPI channel from a DataContract
 */
export function toAsyncAPIChannel(contract: DataContract, config: ChannelConfig = {}): AsyncAPIChannel {
  const { pattern = 'pubsub', bindings } = config
  const isDeprecated = contract.metadata?.deprecated ?? false

  const message = toAsyncAPIMessage(contract)

  const channel: AsyncAPIChannel = {
    description: contract.metadata?.description ? `Channel for ${contract.metadata.description}` : `Channel for ${contract.name} events`,
    bindings,
  }

  if (pattern === 'pubsub') {
    // Publishers send messages, subscribers receive them
    channel.publish = {
      operationId: `publish${toPascalCase(contract.name)}Event`,
      summary: `Publish ${contract.name} events`,
      description: isDeprecated ? `DEPRECATED: This channel is deprecated. ${contract.metadata?.deprecationMessage || ''}` : undefined,
      message,
    }
    channel.subscribe = {
      operationId: `subscribe${toPascalCase(contract.name)}Event`,
      summary: `Subscribe to ${contract.name} events`,
      description: isDeprecated ? `DEPRECATED: This channel is deprecated. ${contract.metadata?.deprecationMessage || ''}` : undefined,
      message,
    }
  } else if (pattern === 'request-reply') {
    // Request-reply pattern
    channel.publish = {
      operationId: `request${toPascalCase(contract.name)}`,
      summary: `Request ${contract.name}`,
      message,
    }
  }

  return channel
}

/**
 * Generate event-specific channels for a DataContract
 */
export function toAsyncAPIEventChannels(
  contract: DataContract,
  events: EventOperations = { created: true, updated: true, deleted: true },
  config: ChannelConfig = {}
): Record<string, AsyncAPIChannel> {
  const channels: Record<string, AsyncAPIChannel> = {}
  const { bindings } = config
  const isDeprecated = contract.metadata?.deprecated ?? false
  const channelName = toKebabCase(contract.name)

  const eventTypes: string[] = []
  if (events.created) eventTypes.push('created')
  if (events.updated) eventTypes.push('updated')
  if (events.deleted) eventTypes.push('deleted')
  if (events.custom) eventTypes.push(...events.custom)

  for (const eventType of eventTypes) {
    const message = toAsyncAPIMessage(contract, eventType)
    const channelKey = `${channelName}/${eventType}`

    channels[channelKey] = {
      description: `Channel for ${contract.name} ${eventType} events`,
      bindings,
      subscribe: {
        operationId: `on${toPascalCase(contract.name)}${toPascalCase(eventType)}`,
        summary: `Subscribe to ${contract.name} ${eventType} events`,
        description: isDeprecated ? `DEPRECATED: ${contract.metadata?.deprecationMessage || 'This event is deprecated.'}` : undefined,
        message,
      },
      publish: {
        operationId: `emit${toPascalCase(contract.name)}${toPascalCase(eventType)}`,
        summary: `Emit ${contract.name} ${eventType} event`,
        description: isDeprecated ? `DEPRECATED: ${contract.metadata?.deprecationMessage || 'This event is deprecated.'}` : undefined,
        message,
      },
    }
  }

  return channels
}

// ============================================================================
// DOCUMENT GENERATION
// ============================================================================

/**
 * Generate a complete AsyncAPI document from DataContracts
 */
export function generateAsyncAPIDocument(contracts: DataContract[], options: AsyncAPIGeneratorOptions = {}): AsyncAPIDocument {
  const {
    title = 'Event API',
    version = '1.0.0',
    description,
    servers,
    defaultContentType = 'application/json',
    channelPrefix = '',
    events = { created: true, updated: true, deleted: true },
    channelConfig = {},
    securitySchemes,
  } = options

  const document: AsyncAPIDocument = {
    asyncapi: '2.6.0',
    info: {
      title,
      version,
      description,
    },
    channels: {},
    components: {
      schemas: {},
      messages: {},
    },
    tags: [],
    defaultContentType,
  }

  if (servers) {
    document.servers = servers
  }

  if (securitySchemes) {
    document.components!.securitySchemes = securitySchemes
  }

  // Process each contract
  for (const contract of contracts) {
    const schemaName = toPascalCase(contract.name)

    // Add schema to components
    document.components!.schemas![schemaName] = toAsyncAPISchema(contract)

    // Generate event channels
    const eventChannels = toAsyncAPIEventChannels(contract, events, channelConfig)

    // Add channels with prefix
    for (const [channelKey, channel] of Object.entries(eventChannels)) {
      const fullChannelKey = channelPrefix ? `${channelPrefix}/${channelKey}` : channelKey
      document.channels[fullChannelKey] = channel

      // Add messages to components
      if (channel.subscribe?.message && 'messageId' in channel.subscribe.message) {
        const messageId = (channel.subscribe.message as AsyncAPIMessage).messageId!
        document.components!.messages![messageId] = channel.subscribe.message as AsyncAPIMessage
      }
    }

    // Add tag
    document.tags!.push({
      name: contract.name,
      description: contract.metadata?.description,
    })
  }

  return document
}

// ============================================================================
// COMBINED DOCUMENT GENERATION
// ============================================================================

/**
 * Options for combined OpenAPI and AsyncAPI generation
 */
export interface DocGeneratorOptions {
  openapi?: {
    title?: string
    version?: string
    description?: string
    servers?: Array<{ url: string; description?: string }>
    basePath?: string
  }
  asyncapi?: {
    title?: string
    version?: string
    description?: string
    servers?: Record<string, AsyncAPIServer>
    channelPrefix?: string
    events?: EventOperations
  }
}

/**
 * Generate both OpenAPI and AsyncAPI documents from DataContracts
 */
export function generateDocs(
  contracts: DataContract[],
  options: DocGeneratorOptions = {}
): {
  openapi: ReturnType<typeof generateOpenAPIDocument>
  asyncapi: AsyncAPIDocument
} {
  const openapi = generateOpenAPIDocument(contracts, options.openapi)
  const asyncapi = generateAsyncAPIDocument(contracts, options.asyncapi)

  return { openapi, asyncapi }
}

// ============================================================================
// UTILITIES
// ============================================================================

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

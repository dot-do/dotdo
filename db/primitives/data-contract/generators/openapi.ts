/**
 * OpenAPI 3.1 Generator for DataContract
 *
 * Generates OpenAPI specifications from DataContract definitions.
 * Supports:
 * - Schema generation from DataContract
 * - Path generation for CRUD operations
 * - Example generation from schema defaults
 * - Deprecation notices from version metadata
 */

import type { DataContract, JSONSchema, SchemaMetadata } from '../index'

// ============================================================================
// TYPES
// ============================================================================

/**
 * OpenAPI 3.1 Document
 */
export interface OpenAPIDocument {
  openapi: '3.1.0'
  info: OpenAPIInfo
  servers?: OpenAPIServer[]
  paths: Record<string, OpenAPIPathItem>
  components?: OpenAPIComponents
  tags?: OpenAPITag[]
}

/**
 * OpenAPI Info object
 */
export interface OpenAPIInfo {
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
 * OpenAPI Server object
 */
export interface OpenAPIServer {
  url: string
  description?: string
  variables?: Record<
    string,
    {
      default: string
      description?: string
      enum?: string[]
    }
  >
}

/**
 * OpenAPI Tag object
 */
export interface OpenAPITag {
  name: string
  description?: string
  externalDocs?: {
    url: string
    description?: string
  }
}

/**
 * OpenAPI Path Item object
 */
export interface OpenAPIPathItem {
  summary?: string
  description?: string
  get?: OpenAPIOperation
  put?: OpenAPIOperation
  post?: OpenAPIOperation
  delete?: OpenAPIOperation
  patch?: OpenAPIOperation
  options?: OpenAPIOperation
  head?: OpenAPIOperation
  trace?: OpenAPIOperation
}

/**
 * OpenAPI Operation object
 */
export interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  parameters?: OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  responses: Record<string, OpenAPIResponse>
  security?: Array<Record<string, string[]>>
}

/**
 * OpenAPI Parameter object
 */
export interface OpenAPIParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  description?: string
  required?: boolean
  deprecated?: boolean
  schema?: OpenAPISchema
}

/**
 * OpenAPI Request Body object
 */
export interface OpenAPIRequestBody {
  description?: string
  required?: boolean
  content: Record<string, OpenAPIMediaType>
}

/**
 * OpenAPI Response object
 */
export interface OpenAPIResponse {
  description: string
  headers?: Record<string, { description?: string; schema?: OpenAPISchema }>
  content?: Record<string, OpenAPIMediaType>
}

/**
 * OpenAPI Media Type object
 */
export interface OpenAPIMediaType {
  schema?: OpenAPISchema
  example?: unknown
  examples?: Record<string, { summary?: string; value: unknown }>
}

/**
 * OpenAPI Schema object (JSON Schema compatible)
 */
export interface OpenAPISchema {
  type?: string | string[]
  properties?: Record<string, OpenAPISchema>
  required?: string[]
  items?: OpenAPISchema
  additionalProperties?: boolean | OpenAPISchema
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
  allOf?: OpenAPISchema[]
  oneOf?: OpenAPISchema[]
  anyOf?: OpenAPISchema[]
}

/**
 * OpenAPI Components object
 */
export interface OpenAPIComponents {
  schemas?: Record<string, OpenAPISchema>
  responses?: Record<string, OpenAPIResponse>
  parameters?: Record<string, OpenAPIParameter>
  requestBodies?: Record<string, OpenAPIRequestBody>
  headers?: Record<string, { description?: string; schema?: OpenAPISchema }>
  securitySchemes?: Record<string, OpenAPISecurityScheme>
}

/**
 * OpenAPI Security Scheme object
 */
export interface OpenAPISecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  description?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
  flows?: Record<string, unknown>
  openIdConnectUrl?: string
}

/**
 * CRUD operations to generate paths for
 */
export interface CRUDOperations {
  list?: boolean
  get?: boolean
  create?: boolean
  update?: boolean
  delete?: boolean
}

/**
 * Options for OpenAPI document generation
 */
export interface OpenAPIGeneratorOptions {
  title?: string
  version?: string
  description?: string
  servers?: OpenAPIServer[]
  basePath?: string
  operations?: CRUDOperations
  includeExamples?: boolean
  securitySchemes?: Record<string, OpenAPISecurityScheme>
  defaultSecurity?: Array<Record<string, string[]>>
}

// ============================================================================
// SCHEMA CONVERSION
// ============================================================================

/**
 * Convert a DataContract's JSON Schema to OpenAPI Schema format
 */
export function toOpenAPISchema(contract: DataContract): OpenAPISchema {
  return convertJSONSchemaToOpenAPI(contract.schema, contract.metadata)
}

/**
 * Convert JSON Schema to OpenAPI Schema with examples and deprecation
 */
function convertJSONSchemaToOpenAPI(schema: JSONSchema, metadata?: SchemaMetadata): OpenAPISchema {
  const openAPISchema: OpenAPISchema = {}

  // Copy basic properties
  if (schema.type !== undefined) {
    openAPISchema.type = schema.type as string | string[]
  }

  if (schema.description !== undefined) {
    openAPISchema.description = schema.description
  }

  if (schema.default !== undefined) {
    openAPISchema.default = schema.default
    // Use default as example if available
    openAPISchema.example = schema.default
  }

  if (schema.enum !== undefined) {
    openAPISchema.enum = schema.enum
  }

  if (schema.format !== undefined) {
    openAPISchema.format = schema.format
  }

  // Numeric constraints
  if (schema.minimum !== undefined) {
    openAPISchema.minimum = schema.minimum
  }
  if (schema.maximum !== undefined) {
    openAPISchema.maximum = schema.maximum
  }
  if (schema.exclusiveMinimum !== undefined) {
    openAPISchema.exclusiveMinimum = schema.exclusiveMinimum
  }
  if (schema.exclusiveMaximum !== undefined) {
    openAPISchema.exclusiveMaximum = schema.exclusiveMaximum
  }

  // String constraints
  if (schema.minLength !== undefined) {
    openAPISchema.minLength = schema.minLength
  }
  if (schema.maxLength !== undefined) {
    openAPISchema.maxLength = schema.maxLength
  }
  if (schema.pattern !== undefined) {
    openAPISchema.pattern = schema.pattern
  }

  // Array constraints
  if (schema.minItems !== undefined) {
    openAPISchema.minItems = schema.minItems
  }
  if (schema.maxItems !== undefined) {
    openAPISchema.maxItems = schema.maxItems
  }

  // Handle nested properties
  if (schema.properties !== undefined) {
    openAPISchema.properties = {}
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      openAPISchema.properties[key] = convertJSONSchemaToOpenAPI(propSchema)
    }
  }

  if (schema.required !== undefined) {
    openAPISchema.required = schema.required
  }

  // Handle array items
  if (schema.items !== undefined) {
    openAPISchema.items = convertJSONSchemaToOpenAPI(schema.items)
  }

  // Handle additional properties
  if (schema.additionalProperties !== undefined) {
    if (typeof schema.additionalProperties === 'boolean') {
      openAPISchema.additionalProperties = schema.additionalProperties
    } else {
      openAPISchema.additionalProperties = convertJSONSchemaToOpenAPI(schema.additionalProperties)
    }
  }

  // Add deprecation notice from metadata
  if (metadata?.deprecated) {
    openAPISchema.deprecated = true
    if (metadata.deprecationMessage && openAPISchema.description) {
      openAPISchema.description = `DEPRECATED: ${metadata.deprecationMessage}\n\n${openAPISchema.description}`
    } else if (metadata.deprecationMessage) {
      openAPISchema.description = `DEPRECATED: ${metadata.deprecationMessage}`
    }
  }

  return openAPISchema
}

/**
 * Generate an example value from a schema
 */
export function generateExample(schema: JSONSchema): unknown {
  // Use default if available
  if (schema.default !== undefined) {
    return schema.default
  }

  // Use enum's first value if available
  if (schema.enum !== undefined && schema.enum.length > 0) {
    return schema.enum[0]
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type

  switch (type) {
    case 'string':
      return generateStringExample(schema)
    case 'number':
      return generateNumberExample(schema)
    case 'integer':
      return generateIntegerExample(schema)
    case 'boolean':
      return true
    case 'array':
      return schema.items ? [generateExample(schema.items)] : []
    case 'object':
      return generateObjectExample(schema)
    case 'null':
      return null
    default:
      return null
  }
}

function generateStringExample(schema: JSONSchema): string {
  // Format-specific examples
  switch (schema.format) {
    case 'email':
      return 'user@example.com'
    case 'uri':
      return 'https://example.com'
    case 'uuid':
      return '550e8400-e29b-41d4-a716-446655440000'
    case 'date':
      return '2024-01-15'
    case 'date-time':
      return '2024-01-15T10:30:00Z'
    case 'time':
      return '10:30:00'
  }

  // Pattern-based example
  if (schema.pattern) {
    // Return a simple placeholder for pattern
    return 'example'
  }

  // Length-based example
  const minLen = schema.minLength || 0
  const maxLen = schema.maxLength || 20
  const targetLen = Math.min(Math.max(minLen, 7), maxLen)
  return 'example'.padEnd(targetLen, '_').slice(0, targetLen)
}

function generateNumberExample(schema: JSONSchema): number {
  const min = schema.minimum ?? 0
  const max = schema.maximum ?? 100
  const exclusiveMin = schema.exclusiveMinimum === true
  const exclusiveMax = schema.exclusiveMaximum === true

  let value = (min + max) / 2
  if (exclusiveMin && value === min) value += 0.1
  if (exclusiveMax && value === max) value -= 0.1

  return Math.round(value * 100) / 100
}

function generateIntegerExample(schema: JSONSchema): number {
  const min = schema.minimum ?? 0
  const max = schema.maximum ?? 100
  const exclusiveMin = schema.exclusiveMinimum === true
  const exclusiveMax = schema.exclusiveMaximum === true

  let value = Math.floor((min + max) / 2)
  if (exclusiveMin && value === min) value += 1
  if (exclusiveMax && value === max) value -= 1

  return value
}

function generateObjectExample(schema: JSONSchema): Record<string, unknown> {
  const example: Record<string, unknown> = {}

  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      example[key] = generateExample(propSchema)
    }
  }

  return example
}

// ============================================================================
// PATH GENERATION
// ============================================================================

/**
 * Generate OpenAPI path item for a DataContract
 */
export function toOpenAPIPath(
  contract: DataContract,
  operations: CRUDOperations = { list: true, get: true, create: true, update: true, delete: true }
): { collection: OpenAPIPathItem; item: OpenAPIPathItem } {
  const schemaRef = `#/components/schemas/${toPascalCase(contract.name)}`
  const tag = contract.name
  const isDeprecated = contract.metadata?.deprecated ?? false
  const example = generateExample(contract.schema)

  const collectionPath: OpenAPIPathItem = {}
  const itemPath: OpenAPIPathItem = {}

  // List operation (GET /resources)
  if (operations.list) {
    collectionPath.get = {
      operationId: `list${toPascalCase(contract.name)}`,
      summary: `List all ${contract.name} resources`,
      description: contract.metadata?.description ? `List ${contract.metadata.description}` : undefined,
      tags: [tag],
      deprecated: isDeprecated,
      parameters: [
        {
          name: 'limit',
          in: 'query',
          description: 'Maximum number of items to return',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        {
          name: 'offset',
          in: 'query',
          description: 'Number of items to skip',
          schema: { type: 'integer', minimum: 0, default: 0 },
        },
      ],
      responses: {
        '200': {
          description: `List of ${contract.name} resources`,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: { $ref: schemaRef },
                  },
                  total: { type: 'integer' },
                  limit: { type: 'integer' },
                  offset: { type: 'integer' },
                },
              },
              example: {
                data: [example],
                total: 1,
                limit: 20,
                offset: 0,
              },
            },
          },
        },
      },
    }
  }

  // Create operation (POST /resources)
  if (operations.create) {
    collectionPath.post = {
      operationId: `create${toPascalCase(contract.name)}`,
      summary: `Create a new ${contract.name}`,
      description: contract.metadata?.description ? `Create ${contract.metadata.description}` : undefined,
      tags: [tag],
      deprecated: isDeprecated,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: schemaRef },
            example,
          },
        },
      },
      responses: {
        '201': {
          description: `${toPascalCase(contract.name)} created successfully`,
          content: {
            'application/json': {
              schema: { $ref: schemaRef },
              example,
            },
          },
        },
        '400': {
          description: 'Invalid request body',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                  details: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        path: { type: 'string' },
                        message: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
  }

  // Get operation (GET /resources/{id})
  if (operations.get) {
    itemPath.get = {
      operationId: `get${toPascalCase(contract.name)}`,
      summary: `Get a ${contract.name} by ID`,
      description: contract.metadata?.description,
      tags: [tag],
      deprecated: isDeprecated,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: `The ${contract.name} ID`,
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description: `The ${contract.name} resource`,
          content: {
            'application/json': {
              schema: { $ref: schemaRef },
              example,
            },
          },
        },
        '404': {
          description: `${toPascalCase(contract.name)} not found`,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' },
                },
              },
              example: { error: `${toPascalCase(contract.name)} not found` },
            },
          },
        },
      },
    }
  }

  // Update operation (PUT /resources/{id})
  if (operations.update) {
    itemPath.put = {
      operationId: `update${toPascalCase(contract.name)}`,
      summary: `Update a ${contract.name}`,
      description: contract.metadata?.description ? `Update ${contract.metadata.description}` : undefined,
      tags: [tag],
      deprecated: isDeprecated,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: `The ${contract.name} ID`,
          schema: { type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: schemaRef },
            example,
          },
        },
      },
      responses: {
        '200': {
          description: `${toPascalCase(contract.name)} updated successfully`,
          content: {
            'application/json': {
              schema: { $ref: schemaRef },
              example,
            },
          },
        },
        '400': {
          description: 'Invalid request body',
        },
        '404': {
          description: `${toPascalCase(contract.name)} not found`,
        },
      },
    }
  }

  // Delete operation (DELETE /resources/{id})
  if (operations.delete) {
    itemPath.delete = {
      operationId: `delete${toPascalCase(contract.name)}`,
      summary: `Delete a ${contract.name}`,
      description: contract.metadata?.description ? `Delete ${contract.metadata.description}` : undefined,
      tags: [tag],
      deprecated: isDeprecated,
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          description: `The ${contract.name} ID`,
          schema: { type: 'string' },
        },
      ],
      responses: {
        '204': {
          description: `${toPascalCase(contract.name)} deleted successfully`,
        },
        '404': {
          description: `${toPascalCase(contract.name)} not found`,
        },
      },
    }
  }

  return { collection: collectionPath, item: itemPath }
}

// ============================================================================
// DOCUMENT GENERATION
// ============================================================================

/**
 * Generate a complete OpenAPI document from DataContracts
 */
export function generateOpenAPIDocument(contracts: DataContract[], options: OpenAPIGeneratorOptions = {}): OpenAPIDocument {
  const {
    title = 'API',
    version = '1.0.0',
    description,
    servers,
    basePath = '',
    operations = { list: true, get: true, create: true, update: true, delete: true },
    securitySchemes,
    defaultSecurity,
  } = options

  const document: OpenAPIDocument = {
    openapi: '3.1.0',
    info: {
      title,
      version,
      description,
    },
    paths: {},
    components: {
      schemas: {},
    },
    tags: [],
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
    const resourcePath = toKebabCase(contract.name)

    // Add schema to components
    document.components!.schemas![schemaName] = toOpenAPISchema(contract)

    // Generate paths
    const { collection, item } = toOpenAPIPath(contract, operations)

    // Add collection path
    const collectionPathKey = `${basePath}/${resourcePath}`
    document.paths[collectionPathKey] = collection

    // Add security to operations if configured
    if (defaultSecurity) {
      if (collection.get) collection.get.security = defaultSecurity
      if (collection.post) collection.post.security = defaultSecurity
    }

    // Add item path
    const itemPathKey = `${basePath}/${resourcePath}/{id}`
    document.paths[itemPathKey] = item

    if (defaultSecurity) {
      if (item.get) item.get.security = defaultSecurity
      if (item.put) item.put.security = defaultSecurity
      if (item.delete) item.delete.security = defaultSecurity
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

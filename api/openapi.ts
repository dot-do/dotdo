// OpenAPI 3.0 spec generation from Hono routes and Zod schemas
import type { Hono } from 'hono'
import type { ZodTypeAny } from 'zod'
import type { ResourceDefinition } from './resource'
import type { StorableData } from '@dotdo/db'

// Hono internal route type for extracting routes from Hono apps
interface HonoRoute {
  method?: string
  path?: string
}

// Type for Hono app with routes (internal structure)
interface HonoAppWithRoutes {
  routes?: HonoRoute[]
}

// OpenAPI 3.0 types
export interface OpenAPISpec {
  openapi: string
  info: InfoObject
  servers?: ServerObject[]
  paths: PathsObject
  components: ComponentsObject
  security?: SecurityRequirementObject[]
  tags?: TagObject[]
}

export interface InfoObject {
  title: string
  version: string
  description?: string | undefined
  termsOfService?: string | undefined
  contact?: ContactObject | undefined
  license?: LicenseObject | undefined
}

export interface ContactObject {
  name?: string
  url?: string
  email?: string
}

export interface LicenseObject {
  name: string
  url?: string
}

export interface ServerObject {
  url: string
  description?: string
}

export interface PathsObject {
  [path: string]: PathItemObject
}

export interface PathItemObject {
  get?: OperationObject
  post?: OperationObject
  put?: OperationObject
  patch?: OperationObject
  delete?: OperationObject
  options?: OperationObject
  head?: OperationObject
  trace?: OperationObject
}

export interface OperationObject {
  summary?: string | undefined
  description?: string | undefined
  tags?: string[] | undefined
  operationId?: string | undefined
  parameters?: ParameterObject[] | undefined
  requestBody?: RequestBodyObject | undefined
  responses: ResponsesObject
  security?: SecurityRequirementObject[] | undefined
}

export interface ParameterObject {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  description?: string
  required?: boolean
  schema: SchemaObject
}

export interface RequestBodyObject {
  description?: string
  content: {
    [mediaType: string]: MediaTypeObject
  }
  required?: boolean
}

export interface MediaTypeObject {
  schema: SchemaObject | ReferenceObject
}

export interface ResponsesObject {
  [statusCode: string]: ResponseObject
}

export interface ResponseObject {
  description?: string
  content?: {
    [mediaType: string]: MediaTypeObject
  }
}

export interface ComponentsObject {
  schemas?: { [name: string]: SchemaObject }
  securitySchemes?: { [name: string]: SecuritySchemeObject }
}

export interface SchemaObject {
  type?: string
  format?: string
  properties?: { [name: string]: SchemaObject }
  items?: SchemaObject
  required?: string[]
  enum?: unknown[]
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  description?: string
  $ref?: string
}

export interface ReferenceObject {
  $ref: string
}

export interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  description?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
}

export interface SecurityRequirementObject {
  [name: string]: string[]
}

export interface TagObject {
  name: string
  description?: string
}

// Simplified operation configuration for user-facing API
// Uses { schema: string } shorthand for requestBody instead of full RequestBodyObject
type OperationConfig = Omit<Partial<OperationObject>, 'requestBody' | 'responses'> & {
  requestBody?: { schema: string }
  responses?: Record<string, { schema?: string; description?: string }>
}

// Generator configuration
export interface GenerateOpenAPIOptions {
  app: Hono
  info?: Partial<InfoObject>
  servers?: ServerObject[]
  schemas?: Record<string, ZodTypeAny>
  resources?: ResourceDefinition<StorableData>[]
  operations?: Record<string, OperationConfig>
  security?: Record<string, Omit<SecuritySchemeObject, 'type'> & { type: SecuritySchemeObject['type'] }>
  tags?: TagObject[]
}

/**
 * Generator class for converting Zod schemas and Hono routes to OpenAPI 3.0 specifications.
 *
 * This class provides utilities for:
 * - Converting Zod schemas to OpenAPI schema objects
 * - Transforming Hono route paths to OpenAPI path format
 * - Extracting path parameters from route definitions
 * - Managing schema registrations
 *
 * @example
 * ```typescript
 * import { OpenAPIGenerator } from '@dotdo/api'
 * import { z } from 'zod'
 *
 * const generator = new OpenAPIGenerator()
 *
 * // Convert a Zod schema
 * const userSchema = generator.zodToOpenAPI(z.object({
 *   id: z.string(),
 *   name: z.string(),
 *   email: z.string().email()
 * }))
 *
 * // Convert Hono path to OpenAPI format
 * const openAPIPath = generator.honoPathToOpenAPI('/users/:id')
 * // Returns: '/users/{id}'
 * ```
 */
export class OpenAPIGenerator {
  private schemas: Record<string, SchemaObject> = {}

  /**
   * Converts a Zod schema to an OpenAPI 3.0 schema object.
   *
   * Supports the following Zod types:
   * - `ZodString` - with email, url, uuid, min, max, regex validations
   * - `ZodNumber` - with min, max validations
   * - `ZodBoolean`
   * - `ZodObject` - with nested properties and required fields
   * - `ZodArray` - with typed items
   * - `ZodOptional` - marks fields as not required
   * - `ZodDefault` - includes default values
   * - `ZodEnum` - maps to string enum
   * - `ZodLiteral` - maps to const/enum
   *
   * @param zodSchema - The Zod schema to convert
   * @returns An OpenAPI SchemaObject representation
   *
   * @example
   * ```typescript
   * const generator = new OpenAPIGenerator()
   *
   * // String with email validation
   * generator.zodToOpenAPI(z.string().email())
   * // Returns: { type: 'string', format: 'email' }
   *
   * // Object with required and optional fields
   * generator.zodToOpenAPI(z.object({
   *   name: z.string(),
   *   age: z.number().optional()
   * }))
   * // Returns: { type: 'object', properties: {...}, required: ['name'] }
   * ```
   */
  zodToOpenAPI(zodSchema: ZodTypeAny): SchemaObject {
    const def = zodSchema._def

    // Handle ZodString
    if (def.typeName === 'ZodString') {
      const schema: SchemaObject = { type: 'string' }

      // Check for format validators
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'email') {
            schema.format = 'email'
          } else if (check.kind === 'url') {
            schema.format = 'uri'
          } else if (check.kind === 'uuid') {
            schema.format = 'uuid'
          } else if (check.kind === 'min') {
            schema.minLength = check.value
          } else if (check.kind === 'max') {
            schema.maxLength = check.value
          } else if (check.kind === 'regex') {
            schema.pattern = check.regex.source
          }
        }
      }

      return schema
    }

    // Handle ZodNumber
    if (def.typeName === 'ZodNumber') {
      const schema: SchemaObject = { type: 'number' }

      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') {
            schema.minimum = check.value
          } else if (check.kind === 'max') {
            schema.maximum = check.value
          }
        }
      }

      return schema
    }

    // Handle ZodBoolean
    if (def.typeName === 'ZodBoolean') {
      return { type: 'boolean' }
    }

    // Handle ZodObject
    if (def.typeName === 'ZodObject') {
      const properties: Record<string, SchemaObject> = {}
      const required: string[] = []
      const shape = def.shape()

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodToOpenAPI(value as ZodTypeAny)

        // Check if field is required (not optional)
        const fieldDef = (value as ZodTypeAny)._def
        if (fieldDef.typeName !== 'ZodOptional') {
          required.push(key)
        }
      }

      return {
        type: 'object',
        properties,
        ...(required.length > 0 && { required })
      }
    }

    // Handle ZodArray
    if (def.typeName === 'ZodArray') {
      return {
        type: 'array',
        items: this.zodToOpenAPI(def.type)
      }
    }

    // Handle ZodOptional
    if (def.typeName === 'ZodOptional') {
      return this.zodToOpenAPI(def.innerType)
    }

    // Handle ZodDefault
    if (def.typeName === 'ZodDefault') {
      const schema = this.zodToOpenAPI(def.innerType)
      schema.default = def.defaultValue()
      return schema
    }

    // Handle ZodEnum
    if (def.typeName === 'ZodEnum') {
      return {
        type: 'string',
        enum: def.values
      }
    }

    // Handle ZodLiteral
    if (def.typeName === 'ZodLiteral') {
      return {
        type: typeof def.value as string,
        enum: [def.value]
      }
    }

    // Fallback
    return { type: 'object' }
  }

  /**
   * Converts a Hono route path to OpenAPI path format.
   *
   * Transforms Hono's colon-prefixed parameters (`:param`) to
   * OpenAPI's curly-brace format (`{param}`).
   *
   * @param honoPath - The Hono route path with `:param` syntax
   * @returns The OpenAPI-formatted path with `{param}` syntax
   *
   * @example
   * ```typescript
   * const generator = new OpenAPIGenerator()
   *
   * generator.honoPathToOpenAPI('/users/:id')
   * // Returns: '/users/{id}'
   *
   * generator.honoPathToOpenAPI('/users/:userId/orders/:orderId')
   * // Returns: '/users/{userId}/orders/{orderId}'
   * ```
   */
  honoPathToOpenAPI(honoPath: string): string {
    return honoPath.replace(/:([^/]+)/g, '{$1}')
  }

  /**
   * Extracts path parameters from a Hono route definition.
   *
   * Parses the route path and creates OpenAPI ParameterObject entries
   * for each path parameter found. All path parameters are marked as
   * required with string type.
   *
   * @param honoPath - The Hono route path to extract parameters from
   * @returns An array of OpenAPI ParameterObject definitions
   *
   * @example
   * ```typescript
   * const generator = new OpenAPIGenerator()
   *
   * generator.extractPathParams('/users/:userId/orders/:orderId')
   * // Returns: [
   * //   { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
   * //   { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }
   * // ]
   * ```
   */
  extractPathParams(honoPath: string): ParameterObject[] {
    const params: ParameterObject[] = []
    const matches = honoPath.matchAll(/:([^/]+)/g)

    for (const match of matches) {
      const paramName = match[1]
      if (paramName !== undefined) {
        params.push({
          name: paramName,
          in: 'path',
          required: true,
          schema: { type: 'string' }
        })
      }
    }

    return params
  }

  /**
   * Registers a Zod schema with a name for use in OpenAPI $ref references.
   *
   * The schema is converted to OpenAPI format and stored for later retrieval
   * via `getSchemas()`. Registered schemas can be referenced in the spec
   * using `#/components/schemas/{name}`.
   *
   * @param name - The unique name for the schema (used in $ref)
   * @param zodSchema - The Zod schema to register
   *
   * @example
   * ```typescript
   * const generator = new OpenAPIGenerator()
   *
   * generator.registerSchema('User', z.object({
   *   id: z.string(),
   *   name: z.string()
   * }))
   *
   * // Later used as: { $ref: '#/components/schemas/User' }
   * ```
   */
  registerSchema(name: string, zodSchema: ZodTypeAny): void {
    this.schemas[name] = this.zodToOpenAPI(zodSchema)
  }

  /**
   * Returns all registered schemas as an OpenAPI schemas object.
   *
   * The returned object is suitable for use in the `components.schemas`
   * section of an OpenAPI specification.
   *
   * @returns A record mapping schema names to their OpenAPI schema objects
   *
   * @example
   * ```typescript
   * const generator = new OpenAPIGenerator()
   * generator.registerSchema('User', userSchema)
   * generator.registerSchema('Order', orderSchema)
   *
   * const schemas = generator.getSchemas()
   * // Returns: { User: {...}, Order: {...} }
   * ```
   */
  getSchemas(): Record<string, SchemaObject> {
    return this.schemas
  }
}

/**
 * Generates an OpenAPI 3.0 specification from a Hono app and configuration.
 *
 * This function analyzes Hono routes, converts Zod schemas, and builds
 * a complete OpenAPI specification. It supports:
 * - Automatic route extraction from Hono apps
 * - Zod schema conversion to OpenAPI schemas
 * - Resource definitions with CRUD operations
 * - Custom operation metadata (summaries, descriptions, tags)
 * - Security schemes (Bearer, API Key, OAuth2)
 * - Server configurations
 *
 * @param options - Configuration options for spec generation
 * @param options.app - The Hono app to extract routes from
 * @param options.info - API metadata (title, version, description)
 * @param options.servers - Server URLs and descriptions
 * @param options.schemas - Zod schemas to include in components
 * @param options.resources - Resource definitions for CRUD routes
 * @param options.operations - Custom operation configurations
 * @param options.security - Security scheme definitions
 * @param options.tags - Tag definitions for grouping operations
 * @returns A complete OpenAPI 3.0 specification object
 *
 * @example
 * ```typescript
 * import { generateOpenAPI } from '@dotdo/api'
 * import { Hono } from 'hono'
 * import { z } from 'zod'
 *
 * const app = new Hono()
 * app.get('/users', (c) => c.json({ users: [] }))
 * app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
 *
 * const spec = generateOpenAPI({
 *   app,
 *   info: {
 *     title: 'My API',
 *     version: '1.0.0',
 *     description: 'API documentation'
 *   },
 *   schemas: {
 *     User: z.object({
 *       id: z.string(),
 *       name: z.string()
 *     })
 *   },
 *   operations: {
 *     'GET /users': {
 *       summary: 'List all users',
 *       tags: ['Users']
 *     }
 *   }
 * })
 * ```
 */
export function generateOpenAPI(options: GenerateOpenAPIOptions): OpenAPISpec {
  const {
    app,
    info = {},
    servers,
    schemas = {},
    resources = [],
    operations = {},
    security = {},
    tags
  } = options

  const generator = new OpenAPIGenerator()

  // Register schemas from Zod types
  for (const [name, zodSchema] of Object.entries(schemas)) {
    generator.registerSchema(name, zodSchema)
  }

  // Register schemas from resource definitions
  for (const resource of resources) {
    generator.registerSchema(resource.name, resource.schema)
  }

  // Extract routes from Hono app
  const paths: PathsObject = {}
  const routes = (app as HonoAppWithRoutes).routes || []

  // Process routes from Hono
  for (const route of routes) {
    const method = route.method?.toLowerCase()
    const path = route.path

    if (!method || !path) continue

    const openAPIPath = generator.honoPathToOpenAPI(path)

    if (!paths[openAPIPath]) {
      paths[openAPIPath] = {}
    }

    // Build operation object
    const operationKey = `${route.method} ${path}`
    const operationConfig = operations[operationKey] || {}

    const operation: OperationObject = {
      summary: operationConfig.summary,
      description: operationConfig.description,
      tags: operationConfig.tags,
      parameters: [
        ...generator.extractPathParams(path),
        ...(operationConfig.parameters || [])
      ],
      responses: {}
    }

    // Add request body if specified
    if (operationConfig.requestBody) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              $ref: `#/components/schemas/${operationConfig.requestBody.schema}`
            }
          }
        }
      }
    }

    // Add responses
    if (operationConfig.responses) {
      for (const [status, response] of Object.entries(operationConfig.responses)) {
        operation.responses[status] = {
          description: response.description || `${status} response`,
          ...(response.schema && {
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${response.schema}`
                }
              }
            }
          })
        }
      }
    } else {
      // Default response
      operation.responses['200'] = {
        description: 'Successful response'
      }
    }

    // Add security if specified
    if (operationConfig.security) {
      operation.security = operationConfig.security
    }

    paths[openAPIPath][method as keyof PathItemObject] = operation
  }

  // Also generate paths from operation configs that might not be in routes yet
  for (const [operationKey, config] of Object.entries(operations)) {
    const parts = operationKey.split(' ')
    const method = parts[0]
    const path = parts[1]
    if (!method || !path) continue
    const openAPIPath = generator.honoPathToOpenAPI(path)
    const methodLower = method.toLowerCase() as keyof PathItemObject

    if (!paths[openAPIPath]) {
      paths[openAPIPath] = {}
    }

    if (!paths[openAPIPath][methodLower]) {
      const operation: OperationObject = {
        summary: config.summary,
        description: config.description,
        tags: config.tags,
        parameters: [
          ...generator.extractPathParams(path),
          ...(config.parameters || [])
        ],
        responses: {}
      }

      if (config.requestBody) {
        operation.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/${config.requestBody.schema}`
              }
            }
          }
        }
      }

      if (config.responses) {
        for (const [status, response] of Object.entries(config.responses)) {
          operation.responses[status] = {
            description: response.description || `${status} response`,
            ...(response.schema && {
              content: {
                'application/json': {
                  schema: {
                    $ref: `#/components/schemas/${response.schema}`
                  }
                }
              }
            })
          }
        }
      } else {
        operation.responses['200'] = {
          description: 'Successful response'
        }
      }

      if (config.security) {
        operation.security = config.security
      }

      paths[openAPIPath][methodLower] = operation
    }
  }

  // Build security schemes
  const securitySchemes: Record<string, SecuritySchemeObject> = {}
  for (const [name, scheme] of Object.entries(security)) {
    securitySchemes[name] = scheme as SecuritySchemeObject
  }

  // Build the complete spec
  const spec: OpenAPISpec = {
    openapi: '3.0.3',
    info: {
      title: info.title || 'API',
      version: info.version || '1.0.0',
      description: info.description,
      termsOfService: info.termsOfService,
      contact: info.contact,
      license: info.license
    },
    paths,
    components: {
      schemas: generator.getSchemas(),
      ...(Object.keys(securitySchemes).length > 0 && { securitySchemes })
    }
  }

  if (servers) {
    spec.servers = servers
  }

  if (tags) {
    spec.tags = tags
  }

  return spec
}

/**
 * Converts an OpenAPI specification object to YAML format.
 *
 * This function serializes the OpenAPI spec to YAML without external
 * dependencies. It handles:
 * - Nested objects and arrays
 * - Proper indentation
 * - String quoting for special characters (colons, hashes, newlines)
 * - Null and undefined values
 *
 * @param spec - The OpenAPI specification object to convert
 * @returns The YAML-formatted string representation
 *
 * @example
 * ```typescript
 * import { generateOpenAPI, specToYAML } from '@dotdo/api'
 *
 * const spec = generateOpenAPI({ app, info: { title: 'API', version: '1.0.0' } })
 * const yaml = specToYAML(spec)
 *
 * // Output:
 * // openapi: 3.0.3
 * // info:
 * //   title: API
 * //   version: 1.0.0
 * // paths: {}
 * // components:
 * //   schemas: {}
 * ```
 */
export function specToYAML(spec: OpenAPISpec): string {
  // Input validation
  if (spec === null || spec === undefined) {
    throw new Error('Invalid OpenAPI spec: spec cannot be null or undefined')
  }

  if (typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('Invalid OpenAPI spec: spec must be an object')
  }

  // Validate required OpenAPI fields
  if (!('openapi' in spec) || typeof spec.openapi !== 'string') {
    throw new Error('Missing required field: openapi')
  }

  if (!('info' in spec) || typeof spec.info !== 'object' || spec.info === null) {
    throw new Error('Missing required field: info')
  }

  if (!('paths' in spec) || typeof spec.paths !== 'object' || spec.paths === null) {
    throw new Error('Missing required field: paths')
  }

  if (!('components' in spec) || typeof spec.components !== 'object' || spec.components === null) {
    throw new Error('Missing required field: components')
  }

  function indent(level: number): string {
    return '  '.repeat(level)
  }

  function valueToYAML(value: unknown, level = 0): string {
    if (value === null || value === undefined) {
      return 'null'
    }

    if (typeof value === 'string') {
      // Quote strings that contain special characters
      if (value.includes('\n') || value.includes(':') || value.includes('#')) {
        return `"${value.replace(/"/g, '\\"')}"`
      }
      return value
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      return '\n' + value.map(item =>
        `${indent(level + 1)}- ${valueToYAML(item, level + 1).trim()}`
      ).join('\n')
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value).filter(([_, v]) => v !== undefined)
      if (entries.length === 0) return '{}'

      return '\n' + entries.map(([key, val]) => {
        const yamlValue = valueToYAML(val, level + 1)
        if (yamlValue.startsWith('\n')) {
          return `${indent(level + 1)}${key}:${yamlValue}`
        }
        return `${indent(level + 1)}${key}: ${yamlValue}`
      }).join('\n')
    }

    return String(value)
  }

  return valueToYAML(spec).trim()
}

/**
 * Generates an HTML page with Swagger UI for API documentation.
 *
 * The generated page loads Swagger UI from unpkg CDN and configures
 * it to fetch the OpenAPI spec from the provided URL. The UI includes:
 * - Interactive API exploration
 * - Try-it-out functionality
 * - Deep linking support
 * - Download spec option
 *
 * @param specUrl - URL to the OpenAPI JSON specification (default: '/openapi.json')
 * @returns Complete HTML string for the Swagger UI page
 *
 * @example
 * ```typescript
 * import { createSwaggerUI } from '@dotdo/api'
 * import { Hono } from 'hono'
 *
 * const app = new Hono()
 *
 * app.get('/docs', (c) => {
 *   const html = createSwaggerUI('/api/openapi.json')
 *   return c.html(html)
 * })
 * ```
 */
export function createSwaggerUI(specUrl = '/openapi.json'): string {
  // Escape the specUrl to prevent XSS attacks
  // This escapes characters that could break out of the JavaScript string literal
  // or inject HTML/script content
  const escapedUrl = specUrl
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/'/g, "\\'")    // Escape single quotes
    .replace(/"/g, '\\"')    // Escape double quotes
    .replace(/</g, '\\x3c')  // Escape < to prevent </script> injection
    .replace(/>/g, '\\x3e')  // Escape >
    .replace(/&/g, '&amp;')  // Escape ampersands for HTML context
    .replace(/\n/g, '\\n')   // Escape newlines
    .replace(/\r/g, '\\r')   // Escape carriage returns

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Documentation - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${escapedUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: 'StandaloneLayout'
      });
    };
  </script>
</body>
</html>`
}

/**
 * Adds OpenAPI documentation endpoints to a Hono app.
 *
 * This convenience function adds three endpoints:
 * - `/docs` (or custom) - Swagger UI HTML page
 * - `/openapi.json` (or custom) - JSON specification
 * - `/openapi.yaml` (or custom) - YAML specification
 *
 * The spec is generated once when this function is called and cached
 * for all subsequent requests.
 *
 * @param app - The Hono app to add endpoints to
 * @param options - Generation options plus custom endpoint paths
 * @param options.docsPath - Path for Swagger UI (default: '/docs')
 * @param options.jsonPath - Path for JSON spec (default: '/openapi.json')
 * @param options.yamlPath - Path for YAML spec (default: '/openapi.yaml')
 * @returns The Hono app (for chaining)
 *
 * @example
 * ```typescript
 * import { addOpenAPIEndpoints } from '@dotdo/api'
 * import { Hono } from 'hono'
 *
 * const app = new Hono()
 * app.get('/users', (c) => c.json({ users: [] }))
 *
 * addOpenAPIEndpoints(app, {
 *   info: { title: 'My API', version: '1.0.0' },
 *   docsPath: '/api-docs',
 *   jsonPath: '/api/spec.json',
 *   yamlPath: '/api/spec.yaml'
 * })
 *
 * // Now accessible at:
 * // GET /api-docs - Swagger UI
 * // GET /api/spec.json - JSON spec
 * // GET /api/spec.yaml - YAML spec
 * ```
 */
export function addOpenAPIEndpoints(
  app: Hono,
  options: Omit<GenerateOpenAPIOptions, 'app'> & {
    docsPath?: string
    jsonPath?: string
    yamlPath?: string
  }
) {
  const {
    docsPath = '/docs',
    jsonPath = '/openapi.json',
    yamlPath = '/openapi.yaml',
    ...generateOptions
  } = options

  // Generate the spec once (could be cached in production)
  const spec = generateOpenAPI({ app, ...generateOptions })

  // JSON endpoint
  app.get(jsonPath, (c) => {
    return c.json(spec)
  })

  // YAML endpoint
  app.get(yamlPath, (c) => {
    const yaml = specToYAML(spec)
    return c.text(yaml, 200, {
      'Content-Type': 'application/x-yaml'
    })
  })

  // Swagger UI endpoint
  app.get(docsPath, (c) => {
    const html = createSwaggerUI(jsonPath)
    return c.html(html)
  })

  return app
}

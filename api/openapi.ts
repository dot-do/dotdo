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

// OpenAPI Generator class
export class OpenAPIGenerator {
  private schemas: Record<string, SchemaObject> = {}

  // Convert Zod schema to OpenAPI schema
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

  // Convert Hono path format (/users/:id) to OpenAPI format (/users/{id})
  honoPathToOpenAPI(honoPath: string): string {
    return honoPath.replace(/:([^/]+)/g, '{$1}')
  }

  // Extract path parameters from Hono route
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

  // Register a schema
  registerSchema(name: string, zodSchema: ZodTypeAny): void {
    this.schemas[name] = this.zodToOpenAPI(zodSchema)
  }

  // Get all registered schemas
  getSchemas(): Record<string, SchemaObject> {
    return this.schemas
  }
}

// Main generation function
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

// Convert OpenAPI spec to YAML format
export function specToYAML(spec: OpenAPISpec): string {
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

// Create Swagger UI HTML page
export function createSwaggerUI(specUrl = '/openapi.json'): string {
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
        url: '${specUrl}',
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

// Add OpenAPI endpoints to a Hono app
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

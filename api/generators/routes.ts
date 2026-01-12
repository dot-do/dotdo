/**
 * REST Route Generator
 *
 * Auto-generates Hono REST API routes from Durable Object class methods.
 * Scans DO classes for public methods and creates corresponding HTTP endpoints
 * with automatic request validation via Zod schemas.
 *
 * Features:
 * - Automatic HTTP method mapping based on naming conventions
 * - Zod schema validation for request parameters
 * - OpenAPI documentation generation
 * - Support for path, query, and body parameters
 *
 * @example
 * ```typescript
 * import { generateRoutes } from './routes'
 * import { MyDO } from '../objects/MyDO'
 *
 * const routes = generateRoutes(MyDO)
 * app.route('/api/mydo', routes)
 * ```
 */

import { Hono } from 'hono'
import type { Context as HonoContext } from 'hono'
import { z, ZodSchema, ZodObject, ZodString, ZodNumber, ZodBoolean, ZodArray, ZodOptional, ZodType } from 'zod'
import {
  getExposedMethods,
  getMethodSignature,
  getMethodMetadata,
  type ParameterInfo,
  type MethodSignature,
} from '../../lib/auto-wiring'

// ============================================================================
// TYPES
// ============================================================================

/**
 * HTTP method types supported by the generator
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/**
 * Route configuration for a single endpoint
 */
export interface RouteConfig {
  /** The HTTP method for this route */
  method: HttpMethod
  /** The URL path pattern (e.g., '/:id' or '/') */
  path: string
  /** The DO method name to invoke */
  methodName: string
  /** Human-readable description for documentation */
  description: string
  /** Zod schema for validating request parameters */
  schema: ZodSchema
  /** OpenAPI documentation object */
  openapi: OpenAPIOperation
}

/**
 * OpenAPI operation object for documentation
 */
export interface OpenAPIOperation {
  summary: string
  description?: string
  operationId: string
  tags?: string[]
  parameters?: OpenAPIParameter[]
  requestBody?: OpenAPIRequestBody
  responses: Record<string, OpenAPIResponse>
}

/**
 * OpenAPI parameter object
 */
export interface OpenAPIParameter {
  name: string
  in: 'path' | 'query' | 'header'
  description?: string
  required: boolean
  schema: { type: string; format?: string }
}

/**
 * OpenAPI request body object
 */
export interface OpenAPIRequestBody {
  description?: string
  required: boolean
  content: {
    'application/json': {
      schema: Record<string, unknown>
    }
  }
}

/**
 * OpenAPI response object
 */
export interface OpenAPIResponse {
  description: string
  content?: {
    'application/json': {
      schema: Record<string, unknown>
    }
  }
}

/**
 * Generator options
 */
export interface GeneratorOptions {
  /** Base path prefix for all routes */
  basePath?: string
  /** Tags for OpenAPI documentation */
  tags?: string[]
  /** Custom HTTP method mapping overrides */
  methodMapping?: Record<string, HttpMethod>
  /** Custom schema overrides per method */
  schemas?: Record<string, ZodSchema>
}

/**
 * Route generation result
 */
export interface GeneratedRoutes {
  /** The Hono router with all generated routes */
  router: Hono<any>
  /** Array of route configurations for documentation */
  routes: RouteConfig[]
  /** OpenAPI paths object */
  openapi: Record<string, Record<string, OpenAPIOperation>>
}

// ============================================================================
// HTTP METHOD MAPPING
// ============================================================================

/**
 * Default prefixes that map to HTTP methods
 */
const METHOD_PREFIX_MAP: Record<string, HttpMethod> = {
  // GET methods - read operations
  get: 'GET',
  find: 'GET',
  list: 'GET',
  search: 'GET',
  fetch: 'GET',
  load: 'GET',
  read: 'GET',
  query: 'GET',
  count: 'GET',
  exists: 'GET',
  check: 'GET',
  is: 'GET',
  has: 'GET',
  can: 'GET',

  // POST methods - create operations
  create: 'POST',
  add: 'POST',
  insert: 'POST',
  register: 'POST',
  submit: 'POST',
  send: 'POST',
  start: 'POST',
  begin: 'POST',
  trigger: 'POST',
  execute: 'POST',
  run: 'POST',
  process: 'POST',
  generate: 'POST',
  upload: 'POST',
  import: 'POST',

  // PUT methods - update operations
  update: 'PUT',
  set: 'PUT',
  replace: 'PUT',
  modify: 'PUT',
  edit: 'PUT',
  save: 'PUT',
  sync: 'PUT',
  merge: 'PUT',

  // PATCH methods - partial update operations
  patch: 'PATCH',
  partial: 'PATCH',

  // DELETE methods - remove operations
  delete: 'DELETE',
  remove: 'DELETE',
  destroy: 'DELETE',
  clear: 'DELETE',
  reset: 'DELETE',
  cancel: 'DELETE',
  revoke: 'DELETE',
  unregister: 'DELETE',
}

/**
 * Infer HTTP method from method name based on prefix conventions
 *
 * @param methodName - The method name to analyze
 * @returns The inferred HTTP method, defaults to POST
 */
export function inferHttpMethod(methodName: string): HttpMethod {
  const lowerName = methodName.toLowerCase()

  // Check for exact match or prefix match
  for (const [prefix, method] of Object.entries(METHOD_PREFIX_MAP)) {
    if (lowerName === prefix || lowerName.startsWith(prefix)) {
      return method
    }
  }

  // Default to POST for unknown methods (action-like)
  return 'POST'
}

// ============================================================================
// PATH GENERATION
// ============================================================================

/**
 * Generate URL path from method name and parameters
 *
 * @param methodName - The method name
 * @param signature - The method signature with parameters
 * @param httpMethod - The HTTP method being used
 * @returns The URL path pattern
 */
export function generatePath(
  methodName: string,
  signature: MethodSignature | undefined,
  httpMethod: HttpMethod
): string {
  // Convert camelCase to kebab-case for URL
  const basePath = methodNameToPath(methodName)

  // For methods that operate on a specific resource by ID
  if (signature && signature.parameters.length > 0) {
    const firstParam = signature.parameters[0]

    // If first param is 'id' or ends with 'Id', use path parameter
    if (
      firstParam!.name === 'id' ||
      firstParam!.name.endsWith('Id') ||
      firstParam!.name === 'key' ||
      firstParam!.name === 'slug'
    ) {
      return `${basePath}/:${firstParam!.name}`
    }
  }

  return basePath
}

/**
 * Convert camelCase method name to kebab-case URL path
 *
 * @param methodName - The method name in camelCase
 * @returns The URL path segment in kebab-case
 */
export function methodNameToPath(methodName: string): string {
  // Remove common prefixes that map to HTTP methods
  let path = methodName
  for (const prefix of Object.keys(METHOD_PREFIX_MAP)) {
    if (methodName.toLowerCase().startsWith(prefix)) {
      // Only remove prefix if there's more after it
      const remainder = methodName.slice(prefix.length)
      if (remainder.length > 0 && /^[A-Z]/.test(remainder)) {
        path = remainder
        break
      }
    }
  }

  // Convert to kebab-case
  const kebab = path
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()

  return `/${kebab}`
}

// ============================================================================
// ZOD SCHEMA GENERATION
// ============================================================================

/**
 * Generate Zod schema from method parameters
 *
 * @param parameters - Array of parameter info from auto-wiring
 * @returns Zod object schema for validation
 */
export function generateZodSchema(parameters: ParameterInfo[]): ZodObject<Record<string, ZodType>> {
  const shape: Record<string, ZodType> = {}

  for (const param of parameters) {
    // Default to string type - we can't infer types at runtime
    // In a more advanced implementation, we could use decorators or JSDoc
    let schema: ZodType = z.string()

    // Apply naming heuristics for better type inference
    const lowerName = param.name.toLowerCase()

    if (lowerName === 'id' || lowerName.endsWith('id')) {
      schema = z.string().min(1)
    } else if (lowerName.includes('count') || lowerName.includes('limit') || lowerName.includes('offset') || lowerName.includes('page')) {
      schema = z.coerce.number().int().min(0)
    } else if (lowerName.includes('enabled') || lowerName.includes('active') || lowerName.startsWith('is') || lowerName.startsWith('has')) {
      schema = z.coerce.boolean()
    } else if (lowerName === 'data' || lowerName === 'body' || lowerName === 'payload') {
      schema = z.record(z.string(), z.unknown())
    } else if (lowerName.includes('items') || lowerName.includes('list') || lowerName.endsWith('s') && lowerName !== 'status') {
      schema = z.array(z.unknown())
    } else if (lowerName === 'options' || lowerName === 'config' || lowerName === 'settings') {
      schema = z.record(z.string(), z.unknown()).optional()
    }

    // Make optional if marked as such
    if (param.optional) {
      schema = schema.optional()
    }

    shape[param.name] = schema
  }

  return z.object(shape)
}

// ============================================================================
// OPENAPI GENERATION
// ============================================================================

/**
 * Generate OpenAPI parameter from ParameterInfo
 */
function generateOpenAPIParameter(
  param: ParameterInfo,
  location: 'path' | 'query'
): OpenAPIParameter {
  return {
    name: param.name,
    in: location,
    description: `The ${param.name} parameter`,
    required: !param.optional,
    schema: { type: 'string' },
  }
}

/**
 * Generate OpenAPI operation from route config
 */
export function generateOpenAPIOperation(
  methodName: string,
  httpMethod: HttpMethod,
  signature: MethodSignature | undefined,
  description: string
): OpenAPIOperation {
  const parameters: OpenAPIParameter[] = []
  let requestBody: OpenAPIRequestBody | undefined

  if (signature && signature.parameters.length > 0) {
    const firstParam = signature.parameters[0]!
    const isPathParam =
      firstParam.name === 'id' ||
      firstParam.name.endsWith('Id') ||
      firstParam.name === 'key' ||
      firstParam.name === 'slug'

    for (let i = 0; i < signature.parameters.length; i++) {
      const param = signature.parameters[i]!

      if (i === 0 && isPathParam) {
        // First param as path parameter
        parameters.push(generateOpenAPIParameter(param, 'path'))
      } else if (httpMethod === 'GET' || httpMethod === 'DELETE') {
        // Other params as query for GET/DELETE
        parameters.push(generateOpenAPIParameter(param, 'query'))
      }
    }

    // For POST/PUT/PATCH, use request body for non-path params
    if (httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH') {
      const bodyParams = isPathParam ? signature.parameters.slice(1) : signature.parameters

      if (bodyParams.length > 0) {
        const properties: Record<string, { type: string; description?: string }> = {}
        const required: string[] = []

        for (const param of bodyParams) {
          properties[param.name] = { type: 'string', description: `The ${param.name} parameter` }
          if (!param.optional) {
            required.push(param.name)
          }
        }

        requestBody = {
          description: 'Request body',
          required: required.length > 0,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties,
                required: required.length > 0 ? required : undefined,
              },
            },
          },
        }
      }
    }
  }

  return {
    summary: description,
    operationId: methodName,
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody,
    responses: {
      '200': {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },
      '400': {
        description: 'Bad request - validation error',
      },
      '404': {
        description: 'Not found',
      },
      '500': {
        description: 'Internal server error',
      },
    },
  }
}

// ============================================================================
// ROUTE GENERATION
// ============================================================================

/**
 * Generate a single route configuration from a method
 */
export function generateRouteConfig(
  DOClass: Function,
  methodName: string,
  options?: GeneratorOptions
): RouteConfig {
  const signature = getMethodSignature(DOClass, methodName)
  const metadata = getMethodMetadata(DOClass, methodName)

  // Determine HTTP method
  const httpMethod = options?.methodMapping?.[methodName] ?? inferHttpMethod(methodName)

  // Generate path
  const path = generatePath(methodName, signature, httpMethod)

  // Generate Zod schema
  const schema = options?.schemas?.[methodName] ?? generateZodSchema(signature?.parameters ?? [])

  // Generate description
  const description = metadata?.description ?? `${methodName} operation`

  // Generate OpenAPI docs
  const openapi = generateOpenAPIOperation(methodName, httpMethod, signature, description)
  if (options?.tags) {
    openapi.tags = options.tags
  }

  return {
    method: httpMethod,
    path,
    methodName,
    description,
    schema,
    openapi,
  }
}

/**
 * Generate all route configurations for a DO class
 */
export function generateRouteConfigs(
  DOClass: Function,
  options?: GeneratorOptions
): RouteConfig[] {
  const methods = getExposedMethods(DOClass)
  return methods.map((methodName) => generateRouteConfig(DOClass, methodName, options))
}

// ============================================================================
// HONO ROUTER GENERATION
// ============================================================================

/**
 * Create a Hono route handler for a DO method
 *
 * @param routeConfig - The route configuration
 * @param getInstance - Function to get the DO instance
 * @returns Hono route handler function
 */
export function createRouteHandler(
  routeConfig: RouteConfig,
  getInstance: (c: HonoContext) => unknown
): (c: HonoContext) => Promise<Response> {
  return async (c: HonoContext): Promise<Response> => {
    try {
      // Get the DO instance
      const instance = getInstance(c)

      // Collect parameters from path, query, and body
      const params: Record<string, unknown> = {}

      // Path parameters
      for (const [key, value] of Object.entries(c.req.param())) {
        params[key] = value
      }

      // Query parameters (for GET/DELETE)
      if (routeConfig.method === 'GET' || routeConfig.method === 'DELETE') {
        for (const [key, value] of Object.entries(c.req.query())) {
          if (!(key in params)) {
            params[key] = value
          }
        }
      }

      // Body parameters (for POST/PUT/PATCH)
      if (routeConfig.method === 'POST' || routeConfig.method === 'PUT' || routeConfig.method === 'PATCH') {
        try {
          const body = await c.req.json()
          if (typeof body === 'object' && body !== null) {
            for (const [key, value] of Object.entries(body)) {
              if (!(key in params)) {
                params[key] = value
              }
            }
          }
        } catch {
          // Body parsing failed - may be empty or invalid JSON
        }
      }

      // Validate with Zod schema
      const parseResult = routeConfig.schema.safeParse(params)
      if (!parseResult.success) {
        return c.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              details: parseResult.error.flatten().fieldErrors,
            },
          },
          400
        )
      }

      // Get the method from instance
      const method = (instance as Record<string, unknown>)[routeConfig.methodName]
      if (typeof method !== 'function') {
        return c.json(
          {
            error: {
              code: 'METHOD_NOT_FOUND',
              message: `Method ${routeConfig.methodName} not found`,
            },
          },
          500
        )
      }

      // Call the method with validated data
      // Convert object to positional args based on parameter order
      const signature = routeConfig.schema._def
      const validatedData = parseResult.data as Record<string, unknown>

      // For simplicity, pass the whole object as first arg if there are multiple params
      // or extract individual params in order
      let result: unknown
      const paramKeys = Object.keys(validatedData)
      if (paramKeys.length === 0) {
        result = await method.call(instance)
      } else if (paramKeys.length === 1) {
        result = await method.call(instance, validatedData[paramKeys[0]!])
      } else {
        // Pass all params as individual arguments
        result = await method.call(instance, ...Object.values(validatedData))
      }

      // Return result
      if (result === undefined || result === null) {
        return c.json({ success: true })
      }

      return c.json(result)
    } catch (error) {
      // Handle errors
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message,
          },
        },
        500
      )
    }
  }
}

/**
 * Generate a Hono router from a DO class
 *
 * @param DOClass - The DO class constructor to generate routes from
 * @param getInstance - Function to get a DO instance from the Hono context
 * @param options - Generator options
 * @returns Generated routes object with router, configs, and OpenAPI docs
 *
 * @example
 * ```typescript
 * const { router, routes, openapi } = generateRoutes(
 *   MyDO,
 *   (c) => c.get('doInstance'),
 *   { tags: ['MyDO'] }
 * )
 *
 * app.route('/api/mydo', router)
 * ```
 */
export function generateRoutes<E extends object = object>(
  DOClass: Function,
  getInstance: (c: HonoContext) => unknown,
  options?: GeneratorOptions
): GeneratedRoutes {
  const router = new Hono<{ Bindings: E }>()
  const routes = generateRouteConfigs(DOClass, options)
  const openapi: Record<string, Record<string, OpenAPIOperation>> = {}

  for (const route of routes) {
    // Create route handler
    const handler = createRouteHandler(route, getInstance)

    // Build full path with base path
    const fullPath = options?.basePath ? `${options.basePath}${route.path}` : route.path

    // Register route with appropriate HTTP method
    switch (route.method) {
      case 'GET':
        router.get(fullPath, handler)
        break
      case 'POST':
        router.post(fullPath, handler)
        break
      case 'PUT':
        router.put(fullPath, handler)
        break
      case 'DELETE':
        router.delete(fullPath, handler)
        break
      case 'PATCH':
        router.patch(fullPath, handler)
        break
    }

    // Build OpenAPI paths
    const openapiPath = fullPath.replace(/:(\w+)/g, '{$1}')
    if (!openapi[openapiPath]) {
      openapi[openapiPath] = {}
    }
    openapi[openapiPath][route.method.toLowerCase()] = route.openapi
  }

  return { router, routes, openapi }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

/**
 * Generate routes without a custom instance getter
 * Uses a placeholder that should be replaced with actual DO stub logic
 */
export function generateRoutesSimple<E extends object = object>(
  DOClass: Function,
  options?: GeneratorOptions
): GeneratedRoutes {
  // Default getInstance that expects DO instance in context
  const getInstance = (c: HonoContext) => {
    const instance = c.get('doInstance')
    if (!instance) {
      throw new Error('DO instance not found in context. Set it with c.set("doInstance", instance)')
    }
    return instance
  }

  return generateRoutes<E>(DOClass, getInstance, options)
}

export default generateRoutes

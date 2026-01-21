/**
 * @dotdo/api - Self-Describing Hono API
 *
 * Provides a HATEOAS-compliant API layer with automatic OpenAPI generation,
 * resource definitions, and self-describing endpoints. Define your API once
 * and get SDK, CLI, API documentation, and MCP tools automatically generated.
 *
 * ## Key Features
 *
 * - **HATEOAS**: Hypermedia links for API discoverability
 * - **Resource DSL**: Fluent API for defining REST resources
 * - **OpenAPI**: Automatic OpenAPI 3.0 specification generation
 * - **Code Generation**: SDK, MCP tools, and CLI from definitions
 * - **Rate Limiting**: Built-in distributed rate limiting
 *
 * @module @dotdo/api
 *
 * @example
 * ```typescript
 * import { createAPI, defineResource, generateOpenAPI, getAllResources } from '@dotdo/api'
 *
 * // Define a resource
 * const CustomerResource = defineResource('Customer')
 *   .fields({
 *     name: { type: 'string', required: true },
 *     email: { type: 'string', format: 'email' }
 *   })
 *   .build()
 *
 * // Create API with HATEOAS support
 * const api = createAPI({ baseUrl: 'https://api.example.com' })
 *
 * // Generate OpenAPI spec
 * const spec = generateOpenAPI(getAllResources(), {
 *   title: 'My API',
 *   version: '1.0.0'
 * })
 * ```
 */

export { createAPI } from './app'

// Resource definition
export {
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
  type ResourceDefinition,
  type ResourceFields,
  type FieldDef,
  type RelationDef,
  type ActionDef,
  type HookDef,
  type ComputedFieldDef,
  type RouteDefinitions,
} from './resource'

// HATEOAS link generation
export {
  generateLinks,
  generateCollectionLinks,
  withLinks,
  withCollectionLinks,
  type Link,
  type HATEOASResponse,
  type ResourceConfig,
} from './hateoas'
export {
  generateOpenAPI,
  OpenAPIGenerator,
  specToYAML,
  createSwaggerUI,
  addOpenAPIEndpoints,
  type OpenAPISpec,
  type InfoObject,
  type ServerObject,
  type PathsObject,
  type PathItemObject,
  type OperationObject,
  type ParameterObject,
  type RequestBodyObject,
  type ResponsesObject,
  type ResponseObject,
  type ComponentsObject,
  type SchemaObject,
  type SecuritySchemeObject,
  type SecurityRequirementObject,
  type TagObject,
  type GenerateOpenAPIOptions
} from './openapi'
export { generateSDK } from './sdk'
export {
  generateMCPTools,
  generateMCPServerConfig,
  MCPGenerator,
  type MCPTool,
  type JSONSchema,
  type JSONSchemaProperty,
  type MCPServerConfig
} from './codegen/mcp'

// Rate limiting middleware
export {
  RateLimiter,
  rateLimitMiddleware,
  createRateLimiter,
  DEFAULT_TIERS,
  type RateLimitConfig,
  type RateLimitTier,
  type RateLimitResult,
} from './middleware/rate-limit'

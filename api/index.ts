// @dotdo/api - Self-Describing Hono API
// HATEOAS with clickable links, auto OpenAPI
// Define once → SDK, CLI, API, MCP all auto-generated

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

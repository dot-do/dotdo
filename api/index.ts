// @dotdo/api - Self-Describing Hono API
// HATEOAS with clickable links, auto OpenAPI
// Define once → SDK, CLI, API, MCP all auto-generated

export { createAPI } from './app'

// Service layer - business logic separated from transport
// Clean architecture: services handle the "what", route handlers handle the "how"
export {
  // Health service
  HealthService,
  getHealthService,
  resetHealthService,
  type HealthResponse,
  type ReadinessResponse,
  type HealthDependency,
  type HealthServiceConfig,
  // Discovery service
  DiscoveryService,
  getDiscoveryService,
  resetDiscoveryService,
  type APIRootResponse,
  type ErrorWithLinks,
  type DiscoveryServiceConfig
} from './services'

// Resource definition
export {
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
  clearGlobalRegistry,
  // Request-scoped context for tenant isolation
  createResourceContext,
  runWithResourceContext,
  getCurrentResourceContext,
  getOrCreateResourceContext,
  type ResourceContext,
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
  // HAL-compliant responses with embedded resources
  createCollectionResponse,
  withEmbedded,
  generateRelatedLinks,
  // API root and discoverability
  generateAPIRootLinks,
  generateAPIRoot,
  // Error responses with links
  generateErrorLinks,
  createErrorResponse,
  // Types
  type Link,
  type LinkRelation,
  type HATEOASResponse,
  type HALResponse,
  type CollectionResponse,
  type PaginationMeta,
  type ResourceConfig,
  type CollectionLinksOptions,
  type APIRootConfig,
  type ErrorResponse,
} from './hateoas'
export {
  generateOpenAPI,
  OpenAPIGenerator,
  specToYAML,
  createSwaggerUI,
  addOpenAPIEndpoints,
  type OpenAPISpec,
  type InfoObject,
  type ContactObject,
  type LicenseObject,
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
  type MediaTypeObject,
  type ReferenceObject,
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

// Middleware layer - cross-cutting concerns
// See api/middleware/index.ts for architecture documentation
export {
  // Rate limiting
  RateLimiter,
  rateLimitMiddleware,
  createRateLimiter,
  DEFAULT_TIERS,
  type RateLimitConfig,
  type RateLimitTier,
  type RateLimitResult,
  type RateLimitSqlStorage,
  // Rate limiter DO for distributed state
  RateLimiterDO,
  type RateLimitCheckParams,
  type RateLimitCheckResult,
} from './middleware'

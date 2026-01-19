// @dotdo/api - Self-Describing Hono API
// HATEOAS with clickable links, auto OpenAPI
// Define once → SDK, CLI, API, MCP all auto-generated

export { createAPI } from './app'
export {
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
  type ResourceDefinition,
  type FieldDef,
  type RelationDef,
  type ActionDef,
  type HookDef,
  type ComputedFieldDef,
  type RouteDefinitions,
} from './resource'
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

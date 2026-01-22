// @dotdo/mcp - MCP Server with Tools
// Required by ChatGPT/DeepResearch: search, fetch
// Plus: do (basic sandbox), sandbox (full $ context sandbox)

// Server exports
export { createMCPServer } from './server'
export type { MCPServerOptions, MCPServer, MCPTool } from './server'

// Tool exports
export { searchTool, createSearchTool } from './search'
export { fetchTool, createFetchTool } from './fetch'
// TODO: Re-enable when ai-evaluate is properly integrated as npm package
// export { doTool } from './do'
// export { createSandboxTool, sandboxToolMetadata } from './tools/sandbox'

// Sandbox exports - temporarily disabled due to ai-evaluate dependency
// TODO: Re-enable when ai-evaluate is properly integrated as npm package
// export {
//   createSandbox,
//   DEFAULT_RESOURCE_LIMITS,
//   DEFAULT_RATE_LIMIT,
//   DEFAULT_CONCURRENCY_LIMIT,
//   RateLimiter,
//   ConcurrencyLimiter,
//   SandboxResourceEnforcer,
//   // RECOMMENDED: Use this for multi-tenant isolation
//   createScopedResourceEnforcer,
//   // DEPRECATED: These throw errors in production (do-5sc9b)
//   // Only use for legacy compatibility or testing with DOTDO_ALLOW_DEPRECATED_GLOBALS=true
//   getGlobalResourceEnforcer,
//   setGlobalResourceEnforcer,
//   // Internal helper for tests
//   _resetDeprecationWarnings
// } from './sandbox'
// export type {
//   Sandbox,
//   SandboxOptions,
//   SandboxResult,
//   SandboxPermissions,
//   AuditLog,
//   ResourceLimits,
//   ResourceUsage,
//   RateLimitConfig,
//   ConcurrencyLimitConfig
// } from './sandbox'

// Discovery exports
export { ToolRegistry, ToolCategory, createDefaultRegistry } from './discovery'
export type { ToolMetadata } from './discovery'

// Type exports and store abstractions (local definitions to avoid @dotdo/do dependency)
// See types.ts for the store adapter pattern documentation (do-7jse)
export type {
  WorkflowContext,
  DoOptions,
  // Store interface types for dependency injection
  ThingsStore,
  RelationshipsStore,
  EventsStore,
  StoreAdapter,
  // Data types
  Thing,
  Relationship,
  Event,
  JsonPrimitive,
  JsonValue,
  StorableData,
  // Query builder types
  QueryBuilder,
  QueryFactory
} from './types'

// Mock store factories for testing (do-7jse)
export {
  createMockContext,
  createMockThingsStore,
  createMockRelationshipsStore,
  createMockEventsStore
} from './types'

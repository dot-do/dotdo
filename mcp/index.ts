// @dotdo/mcp - MCP Server with Tools
// Required by ChatGPT/DeepResearch: search, fetch
// Plus: do (basic sandbox), sandbox (full $ context sandbox)

// Server exports
export { createMCPServer } from './server'
export type { MCPServerOptions, MCPServer, MCPTool } from './server'

// Tool exports
export { searchTool, createSearchTool } from './search'
export { fetchTool, createFetchTool } from './fetch'
export { doTool } from './do'
export { createSandboxTool, sandboxToolMetadata } from './tools/sandbox'

// Sandbox exports
export {
  createSandbox,
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_CONCURRENCY_LIMIT,
  RateLimiter,
  ConcurrencyLimiter,
  SandboxResourceEnforcer,
  getGlobalResourceEnforcer,
  setGlobalResourceEnforcer,
  createScopedResourceEnforcer
} from './sandbox'
export type {
  Sandbox,
  SandboxOptions,
  SandboxResult,
  SandboxPermissions,
  AuditLog,
  ResourceLimits,
  ResourceUsage,
  RateLimitConfig,
  ConcurrencyLimitConfig
} from './sandbox'

// Discovery exports
export { ToolRegistry, ToolCategory, createDefaultRegistry } from './discovery'
export type { ToolMetadata } from './discovery'

// Type exports (local definitions to avoid @dotdo/do dependency)
export type { WorkflowContext, DoOptions } from './types'

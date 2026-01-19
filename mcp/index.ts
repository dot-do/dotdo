// @dotdo/mcp - MCP Server with 3 Tools
// Required by ChatGPT/DeepResearch: search, fetch
// Plus: do (ai-evaluate sandbox with $ context)

export { createMCPServer } from './server'
export { searchTool, createSearchTool } from './search'
export { fetchTool, createFetchTool } from './fetch'
export { doTool } from './do'
export { createSandbox, type Sandbox, type SandboxOptions, type SandboxResult, type SandboxPermissions, type AuditLog } from './sandbox'
export { ToolRegistry, ToolCategory, createDefaultRegistry, type ToolMetadata } from './discovery'

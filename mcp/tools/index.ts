/**
 * MCP Tools
 *
 * Tool implementations for the Model Context Protocol server.
 * Includes a tool registry for dynamic tool management.
 *
 * @module mcp/tools
 */

import type { McpTool, McpToolResult, McpAgentProps, McpEnv } from '../types'

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Tool handler function type
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  props: McpAgentProps,
  env: McpEnv
) => Promise<McpToolResult>

/**
 * Registered tool with handler
 */
interface RegisteredTool {
  tool: McpTool
  handler: ToolHandler
}

/**
 * Central registry for MCP tools
 */
class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()

  /**
   * Register a new tool
   */
  register(tool: McpTool, handler: ToolHandler): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool '${tool.name}' is being overwritten`)
    }
    this.tools.set(tool.name, { tool, handler })
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * Get a tool by name
   */
  get(name: string): McpTool | undefined {
    return this.tools.get(name)?.tool
  }

  /**
   * Get a tool's handler
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name)?.handler
  }

  /**
   * Get all registered tools
   */
  getAll(): McpTool[] {
    return Array.from(this.tools.values()).map((r) => r.tool)
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.tools.size
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear()
  }
}

/**
 * Global tool registry instance
 */
export const toolRegistry = new ToolRegistry()

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a text result
 */
export function textResult(text: string, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  }
}

/**
 * Create a JSON result
 */
export function jsonResult(data: unknown, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  }
}

/**
 * Create an error result
 */
export function errorResult(message: string): McpToolResult {
  return textResult(message, true)
}

// ============================================================================
// Built-in Tools
// ============================================================================

// Register echo tool for testing
toolRegistry.register(
  {
    name: 'echo',
    description: 'Echo back the provided message (for testing)',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to echo back',
        },
      },
      required: ['message'],
    },
    requiredPermissions: ['tools:read'],
  },
  async (args) => {
    const message = args.message as string
    return textResult(`Echo: ${message}`)
  }
)

// Register ping tool
toolRegistry.register(
  {
    name: 'ping',
    description: 'Check if the MCP server is responsive',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    requiredPermissions: [],
  },
  async () => {
    return textResult('pong')
  }
)

// ============================================================================
// Tool Exports
// ============================================================================

// Fetch tool
export {
  fetchTool,
  fetchToolSchema,
  fetchToolMeta,
  registerFetchTool,
  parseUrl,
  generateCacheKey,
  transformResponse,
  type FetchParams,
  type FetchResult,
  type FetchContext,
  type FetchEnv,
  type CacheConfig,
} from './fetch'

// Search tool
export {
  searchTool,
  searchToolSchema,
  searchToolDefinition,
  indexDocument,
  removeFromIndex,
  type SearchParams,
  type SearchFilters,
  type SearchResult,
  type SearchResponse,
  type SearchEnv,
  type SearchToolProps,
} from './search'

// Re-export types
export type { McpTool, McpToolResult, McpAgentProps }

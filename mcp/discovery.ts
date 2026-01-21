// Tool discovery and listing for @dotdo/mcp
// Implements do-7rf.2.6

import type { MCPTool } from './server'

/**
 * Tool categories for organization and filtering
 */
export enum ToolCategory {
  DATA = 'data',           // Search, fetch, query tools
  COMPUTE = 'compute',     // Execute, evaluate, process tools
  GENERAL = 'general'      // Uncategorized tools
}

/**
 * Tool metadata (without execute function)
 */
export interface ToolMetadata {
  name: string
  description: string
  inputSchema: object
}

/**
 * Internal tool entry with metadata
 */
interface ToolEntry {
  tool: MCPTool
  category: ToolCategory
  capabilities: string[]
}

/**
 * Event handler type
 */
type EventHandler = (toolName: string) => void

/**
 * Tool Registry - manages tool registration, discovery, and metadata
 */
export class ToolRegistry {
  private tools: Map<string, ToolEntry> = new Map()
  private eventHandlers: Map<string, EventHandler[]> = new Map()

  /**
   * Register a tool with optional category and capabilities
   */
  register(
    tool: MCPTool,
    category: ToolCategory = ToolCategory.GENERAL,
    capabilities: string[] = []
  ): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`)
    }

    this.tools.set(tool.name, {
      tool,
      category,
      capabilities
    })

    this.emit('tool:registered', tool.name)
  }

  /**
   * Unregister a tool by name
   */
  unregister(name: string): void {
    this.tools.delete(name)
    this.emit('tool:unregistered', name)
  }

  /**
   * Get a tool by name
   */
  get(name: string): MCPTool | undefined {
    return this.tools.get(name)?.tool
  }

  /**
   * List all registered tools
   */
  list(): MCPTool[] {
    return Array.from(this.tools.values()).map(entry => entry.tool)
  }

  /**
   * Get tool metadata (name, description, inputSchema only)
   */
  getMetadata(name: string): ToolMetadata | undefined {
    const entry = this.tools.get(name)
    if (!entry) return undefined

    const { tool } = entry
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }
  }

  /**
   * List all tools metadata (for MCP protocol)
   */
  listMetadata(): ToolMetadata[] {
    return Array.from(this.tools.values()).map(entry => ({
      name: entry.tool.name,
      description: entry.tool.description,
      inputSchema: entry.tool.inputSchema
    }))
  }

  /**
   * Get tool category
   */
  getCategory(name: string): ToolCategory | undefined {
    return this.tools.get(name)?.category
  }

  /**
   * List tools by category
   */
  listByCategory(category: ToolCategory): MCPTool[] {
    return Array.from(this.tools.values())
      .filter(entry => entry.category === category)
      .map(entry => entry.tool)
  }

  /**
   * Get tool capabilities
   */
  getCapabilities(name: string): string[] | undefined {
    return this.tools.get(name)?.capabilities
  }

  /**
   * Check if tool has a specific capability
   */
  hasCapability(name: string, capability: string): boolean {
    const capabilities = this.tools.get(name)?.capabilities || []
    return capabilities.includes(capability)
  }

  /**
   * List tools by capability
   */
  listByCapability(capability: string): MCPTool[] {
    return Array.from(this.tools.values())
      .filter(entry => entry.capabilities.includes(capability))
      .map(entry => entry.tool)
  }

  /**
   * Export tool definitions to JSON (for persistence/sharing)
   */
  export(): Array<{
    name: string
    description: string
    inputSchema: object
    category: ToolCategory
    capabilities: string[]
  }> {
    return Array.from(this.tools.values()).map(entry => ({
      name: entry.tool.name,
      description: entry.tool.description,
      inputSchema: entry.tool.inputSchema,
      category: entry.category,
      capabilities: entry.capabilities
    }))
  }

  /**
   * Register event handler
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler)
  }

  /**
   * Emit event
   */
  private emit(event: string, toolName: string): void {
    const handlers = this.eventHandlers.get(event) || []
    for (const handler of handlers) {
      handler(toolName)
    }
  }
}


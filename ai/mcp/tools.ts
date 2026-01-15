/**
 * MCP Tool Registry and Utilities
 *
 * Provides utilities for registering, converting, and managing MCP tools
 * with integration to AI module functions.
 *
 * @example
 * ```typescript
 * // Create a tool registry
 * const registry = createToolRegistry()
 *
 * // Register a tool with a handler
 * registry.register({
 *   tool: {
 *     name: 'search',
 *     description: 'Search for items',
 *     inputSchema: {
 *       type: 'object',
 *       properties: {
 *         query: { type: 'string' },
 *       },
 *       required: ['query'],
 *     },
 *   },
 *   handler: async (params) => {
 *     // Implementation
 *     return { content: [{ type: 'text', text: 'Results...' }] }
 *   },
 * })
 *
 * // Convert AI function to MCP tool
 * const tool = aiFunction`
 *   Summarize the following text: ${text}
 * `.toMcpTool('summarize', 'Summarize text using AI')
 * ```
 *
 * @module ai/mcp/tools
 */

import type {
  McpTool,
  McpToolResult,
  ToolRegistration,
  ToolHandler,
  ToolContext,
  JsonSchemaProperty,
  AiFunctionToToolOptions,
} from './types'
import { textContent, toolResult, toolError } from '../../types/mcp'

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Tool Registry for managing MCP tools
 */
export class ToolRegistry {
  private tools: Map<string, ToolRegistration> = new Map()
  private aliases: Map<string, string> = new Map()

  /**
   * Register a tool
   */
  register(registration: ToolRegistration): void {
    this.tools.set(registration.tool.name, registration)
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    // Also remove any aliases pointing to this tool
    for (const [alias, target] of this.aliases) {
      if (target === name) {
        this.aliases.delete(alias)
      }
    }
    return this.tools.delete(name)
  }

  /**
   * Get a tool registration
   */
  get(name: string): ToolRegistration | undefined {
    // Check aliases first
    const aliasedName = this.aliases.get(name) ?? name
    return this.tools.get(aliasedName)
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    const aliasedName = this.aliases.get(name) ?? name
    return this.tools.has(aliasedName)
  }

  /**
   * Get all tools
   */
  getAll(): McpTool[] {
    return Array.from(this.tools.values())
      .filter((r) => r.enabled !== false)
      .map((r) => r.tool)
  }

  /**
   * Get all registrations
   */
  getAllRegistrations(): ToolRegistration[] {
    return Array.from(this.tools.values())
  }

  /**
   * Add an alias for a tool
   */
  addAlias(alias: string, toolName: string): void {
    if (!this.tools.has(toolName)) {
      throw new Error(`Tool not found: ${toolName}`)
    }
    this.aliases.set(alias, toolName)
  }

  /**
   * Remove an alias
   */
  removeAlias(alias: string): boolean {
    return this.aliases.delete(alias)
  }

  /**
   * Enable or disable a tool
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const registration = this.get(name)
    if (registration) {
      registration.enabled = enabled
      return true
    }
    return false
  }

  /**
   * Call a tool
   */
  async call(
    name: string,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<McpToolResult> {
    const registration = this.get(name)

    if (!registration) {
      return toolError(`Tool not found: ${name}`)
    }

    if (registration.enabled === false) {
      return toolError(`Tool is disabled: ${name}`)
    }

    try {
      return await registration.handler(params, context)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return toolError(message)
    }
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear()
    this.aliases.clear()
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.tools.size
  }
}

/**
 * Create a new tool registry
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry()
}

// ============================================================================
// Tool Definition Helpers
// ============================================================================

/**
 * Define a tool with type-safe schema
 */
export function defineTool<T extends Record<string, unknown>>(
  name: string,
  description: string,
  schema: {
    properties: Record<keyof T, JsonSchemaProperty>
    required?: (keyof T)[]
  },
  handler: ToolHandler<T>
): ToolRegistration {
  return {
    tool: {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: schema.properties as Record<string, JsonSchemaProperty>,
        required: schema.required as string[] | undefined,
      },
    },
    handler: handler as ToolHandler,
  }
}

/**
 * Create a simple tool with minimal configuration
 */
export function simpleTool(
  name: string,
  description: string,
  handler: (params: Record<string, unknown>) => Promise<string> | string
): ToolRegistration {
  return {
    tool: {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    handler: async (params, _context) => {
      const result = await handler(params)
      return toolResult([textContent(result)])
    },
  }
}

/**
 * Create a tool that wraps an async function
 */
export function wrapFunction<T extends Record<string, unknown>, R>(
  name: string,
  description: string,
  schema: {
    properties: Record<keyof T, JsonSchemaProperty>
    required?: (keyof T)[]
  },
  fn: (params: T) => Promise<R> | R,
  options?: {
    formatResult?: (result: R) => string
  }
): ToolRegistration {
  return {
    tool: {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: schema.properties as Record<string, JsonSchemaProperty>,
        required: schema.required as string[] | undefined,
      },
    },
    handler: async (params, _context) => {
      const result = await fn(params as T)
      const text = options?.formatResult
        ? options.formatResult(result)
        : typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2)
      return toolResult([textContent(text)])
    },
  }
}

// ============================================================================
// AI Function Integration
// ============================================================================

/**
 * Convert an AI template literal function to an MCP tool
 *
 * @example
 * ```typescript
 * import { summarize } from 'dotdo/ai'
 *
 * const tool = aiToMcpTool(
 *   summarize,
 *   'summarize',
 *   'Summarize text using AI',
 *   {
 *     properties: {
 *       text: { type: 'string', description: 'Text to summarize' },
 *     },
 *     required: ['text'],
 *   }
 * )
 * ```
 */
export function aiToMcpTool<T extends Record<string, unknown>>(
  aiFn: (input: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>,
  name: string,
  description: string,
  schema: {
    properties: Record<keyof T, JsonSchemaProperty>
    required?: (keyof T)[]
    template: (params: T) => string
  }
): ToolRegistration {
  return {
    tool: {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties: schema.properties as Record<string, JsonSchemaProperty>,
        required: schema.required as string[] | undefined,
      },
    },
    handler: async (params, _context) => {
      try {
        // Build the template string from params
        const templateString = schema.template(params as T)

        // Call the AI function with the template
        // We use a tagged template literal approach
        const result = await aiFn`${templateString}`

        const text = typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2)

        return toolResult([textContent(text)])
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error))
      }
    },
  }
}

/**
 * Create pre-defined AI tools for common operations
 */
export function createAiTools(options?: {
  summarize?: (input: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>
  write?: (input: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>
  extract?: (input: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>
}): ToolRegistration[] {
  const tools: ToolRegistration[] = []

  if (options?.summarize) {
    tools.push(
      aiToMcpTool(options.summarize, 'ai_summarize', 'Summarize text using AI', {
        properties: {
          text: { type: 'string', description: 'Text to summarize' },
          style: { type: 'string', description: 'Summary style (brief, detailed, bullet)' },
        },
        required: ['text'],
        template: (params: { text: string; style?: string }) =>
          params.style
            ? `Summarize in ${params.style} style: ${params.text}`
            : params.text,
      })
    )
  }

  if (options?.write) {
    tools.push(
      aiToMcpTool(options.write, 'ai_write', 'Generate text using AI', {
        properties: {
          prompt: { type: 'string', description: 'Writing prompt' },
          style: { type: 'string', description: 'Writing style' },
          length: { type: 'string', description: 'Desired length (short, medium, long)' },
        },
        required: ['prompt'],
        template: (params: { prompt: string; style?: string; length?: string }) => {
          let instruction = params.prompt
          if (params.style) instruction = `Write in ${params.style} style: ${instruction}`
          if (params.length) instruction = `(${params.length}) ${instruction}`
          return instruction
        },
      })
    )
  }

  if (options?.extract) {
    tools.push(
      aiToMcpTool(options.extract, 'ai_extract', 'Extract structured data using AI', {
        properties: {
          text: { type: 'string', description: 'Text to extract from' },
          fields: { type: 'string', description: 'Comma-separated list of fields to extract' },
        },
        required: ['text', 'fields'],
        template: (params: { text: string; fields: string }) =>
          `Extract ${params.fields} from: ${params.text}`,
      })
    )
  }

  return tools
}

// ============================================================================
// Tool Composition
// ============================================================================

/**
 * Compose multiple tools into a single tool
 */
export function composeTool(
  name: string,
  description: string,
  tools: ToolRegistration[],
  composer: (
    results: Array<{ name: string; result: McpToolResult }>
  ) => McpToolResult
): ToolRegistration {
  // Merge all input schemas
  const properties: Record<string, JsonSchemaProperty> = {}
  const required: string[] = []

  for (const { tool } of tools) {
    const schema = tool.inputSchema as { properties?: Record<string, JsonSchemaProperty>; required?: string[] }
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        // Prefix with tool name to avoid conflicts
        properties[`${tool.name}_${key}`] = {
          ...prop,
          description: `[${tool.name}] ${prop.description ?? key}`,
        }
      }
    }
    if (schema.required) {
      for (const key of schema.required) {
        required.push(`${tool.name}_${key}`)
      }
    }
  }

  return {
    tool: {
      name,
      description,
      inputSchema: {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      },
    },
    handler: async (params, context) => {
      const results: Array<{ name: string; result: McpToolResult }> = []

      for (const { tool, handler } of tools) {
        // Extract params for this tool
        const toolParams: Record<string, unknown> = {}
        for (const key of Object.keys(params)) {
          if (key.startsWith(`${tool.name}_`)) {
            const actualKey = key.slice(tool.name.length + 1)
            toolParams[actualKey] = params[key]
          }
        }

        // Call handler
        const result = await handler(toolParams, context)
        results.push({ name: tool.name, result })
      }

      return composer(results)
    },
  }
}

/**
 * Create a tool chain that runs tools sequentially
 */
export function chainTools(
  name: string,
  description: string,
  tools: ToolRegistration[],
  options?: {
    stopOnError?: boolean
  }
): ToolRegistration {
  return composeTool(name, description, tools, (results) => {
    const contents: Array<{ type: 'text'; text: string }> = []
    let hasError = false

    for (const { name: toolName, result } of results) {
      if (result.isError) {
        hasError = true
        if (options?.stopOnError) {
          return result
        }
      }

      for (const content of result.content) {
        if (content.type === 'text' && content.text) {
          contents.push({
            type: 'text',
            text: `[${toolName}] ${content.text}`,
          })
        }
      }
    }

    return {
      content: contents,
      isError: hasError,
    }
  })
}

// ============================================================================
// Tool Utilities
// ============================================================================

/**
 * Validate tool arguments against schema
 */
export function validateToolArgs(
  tool: McpTool,
  args: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const schema = tool.inputSchema as {
    properties?: Record<string, JsonSchemaProperty>
    required?: string[]
  }

  // Check required fields
  for (const field of schema.required ?? []) {
    if (!(field in args) || args[field] === undefined) {
      errors.push(`Missing required field: ${field}`)
    }
  }

  // Type checking for provided fields
  for (const [key, value] of Object.entries(args)) {
    const propSchema = schema.properties?.[key]
    if (propSchema) {
      const expectedType = propSchema.type
      const actualType = Array.isArray(value) ? 'array' : typeof value

      if (expectedType === 'integer' || expectedType === 'number') {
        if (typeof value !== 'number') {
          errors.push(`Field "${key}" should be ${expectedType}, got ${actualType}`)
        }
      } else if (expectedType !== actualType) {
        errors.push(`Field "${key}" should be ${expectedType}, got ${actualType}`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Format tool result as text
 */
export function formatToolResult(result: McpToolResult): string {
  const parts: string[] = []

  for (const content of result.content) {
    if (content.type === 'text' && content.text) {
      parts.push(content.text)
    }
  }

  return parts.join('\n')
}

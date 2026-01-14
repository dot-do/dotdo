/**
 * Tool Execution Utilities
 *
 * Provides helper functions for executing tools and converting tool definitions
 * to provider-specific formats (OpenAI, Anthropic/Claude, Vercel).
 *
 * Features:
 * - Provider format conversion (OpenAI, Claude, Vercel)
 * - Tool execution with validation
 * - Permission checking
 * - Error handling
 *
 * @see dotdo-6t9m4 - [GREEN] Tool calling implementation
 * @module agents/tool-execution
 */

import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
  JsonSchema,
} from './types'
import { zodToJsonSchema, isZodSchema, validateInput } from './schema'

// ============================================================================
// OpenAI Format Conversion
// ============================================================================

/**
 * OpenAI function format
 */
export interface OpenAIFunction {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: JsonSchema
    strict?: boolean
  }
}

/**
 * Convert a tool definition to OpenAI function format
 *
 * @param tool - Tool definition
 * @param options - Conversion options
 * @returns OpenAI function format
 *
 * @example
 * ```typescript
 * const openAIFormat = convertToOpenAIFormat(weatherTool)
 * // { type: 'function', function: { name, description, parameters } }
 * ```
 */
export function convertToOpenAIFormat(
  tool: ToolDefinition,
  options?: { strict?: boolean }
): OpenAIFunction {
  let parameters: JsonSchema

  if (isZodSchema(tool.inputSchema)) {
    parameters = zodToJsonSchema(tool.inputSchema)
  } else {
    parameters = tool.inputSchema as JsonSchema
  }

  // For strict mode, add additionalProperties: false
  if (options?.strict && parameters.type === 'object') {
    parameters = { ...parameters, additionalProperties: false }
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
      ...(options?.strict ? { strict: true } : {}),
    },
  }
}

// ============================================================================
// Anthropic/Claude Format Conversion
// ============================================================================

/**
 * Claude/Anthropic tool format
 */
export interface ClaudeTool {
  name: string
  description: string
  input_schema: JsonSchema
  cache_control?: { type: string }
}

/**
 * Convert a tool definition to Claude/Anthropic format
 *
 * @param tool - Tool definition
 * @param options - Conversion options
 * @returns Claude tool format
 *
 * @example
 * ```typescript
 * const claudeFormat = convertToClaudeFormat(searchTool)
 * // { name, description, input_schema }
 * ```
 */
export function convertToClaudeFormat(
  tool: ToolDefinition,
  options?: { cacheControl?: { type: string } }
): ClaudeTool {
  let inputSchema: JsonSchema

  if (isZodSchema(tool.inputSchema)) {
    inputSchema = zodToJsonSchema(tool.inputSchema)
  } else {
    inputSchema = tool.inputSchema as JsonSchema
  }

  const result: ClaudeTool = {
    name: tool.name,
    description: tool.description,
    input_schema: inputSchema,
  }

  if (options?.cacheControl) {
    result.cache_control = options.cacheControl
  }

  return result
}

// ============================================================================
// Vercel Format Conversion
// ============================================================================

/**
 * Vercel AI SDK tool format
 */
export interface VercelTool {
  name: string
  description: string
  parameters: JsonSchema
}

/**
 * Convert a tool definition to Vercel AI SDK format
 *
 * @param tool - Tool definition
 * @returns Vercel tool format
 */
export function convertToVercelFormat(tool: ToolDefinition): VercelTool {
  let parameters: JsonSchema

  if (isZodSchema(tool.inputSchema)) {
    parameters = zodToJsonSchema(tool.inputSchema)
  } else {
    parameters = tool.inputSchema as JsonSchema
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters,
  }
}

// ============================================================================
// Provider-Agnostic Conversion
// ============================================================================

export type ProviderName = 'openai' | 'claude' | 'vercel'

/**
 * Convert a tool definition to provider-specific format
 *
 * @param tool - Tool definition
 * @param provider - Provider name
 * @returns Provider-specific tool format
 *
 * @example
 * ```typescript
 * const openAI = convertToolForProvider(tool, 'openai')
 * const claude = convertToolForProvider(tool, 'claude')
 * const vercel = convertToolForProvider(tool, 'vercel')
 * ```
 */
export function convertToolForProvider(
  tool: ToolDefinition,
  provider: ProviderName
): OpenAIFunction | ClaudeTool | VercelTool {
  switch (provider) {
    case 'openai':
      return convertToOpenAIFormat(tool)
    case 'claude':
      return convertToClaudeFormat(tool)
    case 'vercel':
      return convertToVercelFormat(tool)
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Execute a single tool call
 *
 * @param tool - Tool definition
 * @param toolCall - Tool call from model
 * @param context - Execution context
 * @returns Tool result
 *
 * @example
 * ```typescript
 * const result = await executeToolCall(calculatorTool, {
 *   id: 'call_123',
 *   name: 'add',
 *   arguments: { a: 5, b: 3 }
 * })
 * ```
 */
export async function executeToolCall(
  tool: ToolDefinition,
  toolCall: ToolCall,
  context?: ToolContext
): Promise<ToolResult> {
  const baseResult: Omit<ToolResult, 'result' | 'error'> = {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  }

  const ctx: ToolContext = context ?? { agentId: 'unknown' }

  try {
    // Validate input if Zod schema
    let validatedInput = toolCall.arguments

    if (isZodSchema(tool.inputSchema)) {
      const validation = validateInput(tool.inputSchema, toolCall.arguments)
      if (!validation.success) {
        return {
          ...baseResult,
          result: null,
          error: validation.error.message,
        }
      }
      validatedInput = validation.data as Record<string, unknown>
    }

    // Check abort signal before execution
    if (ctx.abortSignal?.aborted) {
      return {
        ...baseResult,
        result: null,
        error: 'Operation aborted',
      }
    }

    // Execute the tool
    const result = await tool.execute(validatedInput, ctx)

    return {
      ...baseResult,
      result,
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error)
    return {
      ...baseResult,
      result: null,
      error: errorMessage,
    }
  }
}

/**
 * Execute a tool call from a list of available tools
 *
 * @param tools - Available tool definitions
 * @param toolCall - Tool call from model
 * @param context - Execution context
 * @returns Tool result
 *
 * @example
 * ```typescript
 * const result = await executeToolCallFromList(
 *   [addTool, subtractTool],
 *   { id: 'call_1', name: 'add', arguments: { a: 1, b: 2 } }
 * )
 * ```
 */
export async function executeToolCallFromList(
  tools: ToolDefinition[],
  toolCall: ToolCall,
  context?: ToolContext
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === toolCall.name)

  if (!tool) {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: null,
      error: `Unknown tool: ${toolCall.name}`,
    }
  }

  return executeToolCall(tool, toolCall, context)
}

// ============================================================================
// Permission Handling
// ============================================================================

export interface PermissionCheckOptions {
  /** Callback for confirmation permission */
  onConfirm?: () => Promise<boolean>
}

/**
 * Execute a tool with permission checking
 *
 * @param tool - Tool definition with permission setting
 * @param toolCall - Tool call from model
 * @param options - Permission check options
 * @returns Tool result
 *
 * @example
 * ```typescript
 * const result = await executeToolWithPermissionCheck(
 *   dangerousTool,
 *   toolCall,
 *   { onConfirm: async () => confirm('Allow?') }
 * )
 * ```
 */
export async function executeToolWithPermissionCheck(
  tool: ToolDefinition,
  toolCall: ToolCall,
  options?: PermissionCheckOptions
): Promise<ToolResult> {
  const permission = tool.permission ?? 'auto'

  // Handle deny permission
  if (permission === 'deny') {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: null,
      error: `Permission denied: Tool "${toolCall.name}" has permission set to deny`,
    }
  }

  // Handle confirm permission
  if (permission === 'confirm') {
    if (!options?.onConfirm) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: `Permission denied: Tool "${toolCall.name}" requires confirmation but no handler provided`,
      }
    }

    const confirmed = await options.onConfirm()
    if (!confirmed) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: `Permission denied: User denied confirmation for tool "${toolCall.name}"`,
      }
    }
  }

  // Auto permission or confirmed - execute the tool
  return executeToolCall(tool, toolCall)
}

// ============================================================================
// Batch Execution
// ============================================================================

/**
 * Execute multiple tool calls in parallel
 *
 * @param tools - Available tool definitions
 * @param toolCalls - Tool calls to execute
 * @param context - Execution context
 * @returns Array of tool results
 */
export async function executeToolCallsParallel(
  tools: ToolDefinition[],
  toolCalls: ToolCall[],
  context?: ToolContext
): Promise<ToolResult[]> {
  return Promise.all(
    toolCalls.map((call) => executeToolCallFromList(tools, call, context))
  )
}

/**
 * Execute multiple tool calls sequentially
 *
 * @param tools - Available tool definitions
 * @param toolCalls - Tool calls to execute
 * @param context - Execution context
 * @returns Array of tool results
 */
export async function executeToolCallsSequential(
  tools: ToolDefinition[],
  toolCalls: ToolCall[],
  context?: ToolContext
): Promise<ToolResult[]> {
  const results: ToolResult[] = []
  for (const call of toolCalls) {
    results.push(await executeToolCallFromList(tools, call, context))
  }
  return results
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a tools map for quick lookup by name
 */
export function createToolsMap(
  tools: ToolDefinition[]
): Map<string, ToolDefinition> {
  return new Map(tools.map((t) => [t.name, t]))
}

/**
 * Convert all tools in an array to a specific provider format
 */
export function convertToolsForProvider(
  tools: ToolDefinition[],
  provider: ProviderName
): (OpenAIFunction | ClaudeTool | VercelTool)[] {
  return tools.map((t) => convertToolForProvider(t, provider))
}

/**
 * Export tools as JSON Schema array (for MCP or documentation)
 */
export function toolsToJsonSchemas(
  tools: ToolDefinition[]
): Array<{ name: string; description: string; inputSchema: JsonSchema }> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: isZodSchema(tool.inputSchema)
      ? zodToJsonSchema(tool.inputSchema)
      : (tool.inputSchema as JsonSchema),
  }))
}

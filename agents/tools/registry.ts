/**
 * Agent Tool Registry
 *
 * Central registry for agent tools with schema validation and sandboxed execution.
 * Features:
 * - Tool registration with definition schemas (Zod or JSON Schema)
 * - Schema validation on execute
 * - Sandboxed execution with timeout/permission controls
 * - Result handling with timing information
 * - Hooks for pre/post tool use
 *
 * @see dotdo-apow1 - [GREEN] Tool registry with execution
 * @module agents/tools/registry
 */

import { z } from 'zod'
import type { AgentTool } from './types'
import type { ToolContext, ToolDefinition, Schema, JsonSchema, PermissionRequest } from '../types'
import { isZodSchema, validateInput, zodToJsonSchema, ValidationError } from '../schema'

// Re-export AgentTool type
export type { AgentTool } from './types'

// ============================================================================
// Import Tools from Category Modules
// ============================================================================

// File operation tools
import { writeFileTool, readFileTool, editFileTool, FILE_TOOLS } from './file-tools'

// Shell execution and code search tools
import { bashTool, globTool, grepTool, SHELL_TOOLS } from './shell-tools'

// Git operation tools
import { gitAddTool, gitCommitTool, GIT_TOOLS } from './git-tools'

// Re-export individual tools for direct access
export { writeFileTool, readFileTool, editFileTool } from './file-tools'
export { bashTool, globTool, grepTool } from './shell-tools'
export { gitAddTool, gitCommitTool } from './git-tools'

// Legacy exports for backwards compatibility
export const AGENT_TOOLS: AgentTool[] = [...FILE_TOOLS, ...SHELL_TOOLS, ...GIT_TOOLS]

export function getTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name)
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = getTool(name)
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return tool.execute(input)
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error for registry execution failures
 */
export class RegistryExecutionError extends Error {
  readonly toolName: string
  readonly cause?: Error

  constructor(toolName: string, message: string, cause?: Error) {
    super(message)
    this.name = 'RegistryExecutionError'
    this.toolName = toolName
    this.cause = cause
  }
}

/**
 * Error thrown when a tool is not found in the registry
 */
export class ToolNotFoundError extends RegistryExecutionError {
  constructor(toolName: string) {
    super(toolName, `Tool not found: ${toolName}`)
    this.name = 'ToolNotFoundError'
  }
}

/**
 * Error thrown when input validation fails
 */
export class ToolValidationError extends RegistryExecutionError {
  readonly path: string[]
  readonly received: unknown
  readonly expected: string

  constructor(
    toolName: string,
    message: string,
    path: (string | number)[] = [],
    received?: unknown,
    expected?: string
  ) {
    super(toolName, message)
    this.name = 'ToolValidationError'
    this.path = path.map(String)
    this.received = received
    this.expected = expected ?? 'valid input'
  }
}

/**
 * Error thrown when tool execution times out
 */
export class ToolTimeoutError extends RegistryExecutionError {
  readonly timeoutMs: number

  constructor(toolName: string, timeoutMs: number) {
    super(toolName, `Tool execution timed out after ${timeoutMs}ms`)
    this.name = 'ToolTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Error thrown when permission is denied
 */
export class ToolPermissionError extends RegistryExecutionError {
  readonly reason: string

  constructor(toolName: string, reason: string) {
    super(toolName, `Permission denied for tool ${toolName}: ${reason}`)
    this.name = 'ToolPermissionError'
    this.reason = reason
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Extended tool definition for registry
 */
export interface RegistryTool<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: Schema<TInput> | AgentTool['inputSchema']
  outputSchema?: Schema<TOutput>
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>
  permission?: 'auto' | 'confirm' | 'deny'
  interruptible?: boolean
}

/**
 * Pre-tool use hook result
 */
export type PreToolUseResult =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'modify'; input: unknown }

/**
 * Pre-tool use hook context
 */
export interface PreToolUseContext {
  toolName: string
  input: unknown
  context: ToolContext
}

/**
 * Post-tool use hook context
 */
export interface PostToolUseContext {
  toolName: string
  input: unknown
  result: ExecutionResult
  context: ToolContext
}

/**
 * Registry configuration options
 */
export interface ToolRegistryOptions {
  /** Initial tools to register */
  tools?: RegistryTool[]
  /** Default timeout in milliseconds (default: 120000) */
  defaultTimeout?: number
  /** Maximum allowed timeout in milliseconds (default: 600000) */
  maxTimeout?: number
  /** Enable sandboxed execution mode */
  sandboxed?: boolean
  /** Permission request handler */
  onPermissionRequest?: (request: PermissionRequest) => Promise<boolean>
  /** Pre-tool use hook */
  onPreToolUse?: (ctx: PreToolUseContext) => Promise<PreToolUseResult | void>
  /** Post-tool use hook */
  onPostToolUse?: (ctx: PostToolUseContext) => Promise<void>
}

/**
 * Execution options for a single tool call
 */
export interface ExecutionOptions {
  /** Timeout in milliseconds */
  timeout?: number
  /** Skip input validation */
  validate?: boolean
  /** Skip permission check */
  skipPermission?: boolean
}

/**
 * Execution result
 */
export interface ExecutionResult<T = unknown> {
  success: boolean
  toolName: string
  input: unknown
  data: T
  durationMs: number
  error?: Error
}

/**
 * Batch execution item
 */
export interface BatchExecutionItem {
  tool: string
  input: unknown
}

/**
 * Batch execution options
 */
export interface BatchExecutionOptions extends ExecutionOptions {
  /** Stop execution on first error */
  stopOnError?: boolean
}

/**
 * JSON Schema export format
 */
export interface JsonSchemaExport {
  name: string
  description: string
  inputSchema: JsonSchema
}

// ============================================================================
// ToolRegistry Class
// ============================================================================

/**
 * Central registry for agent tools with schema validation and sandboxed execution.
 *
 * @example
 * ```typescript
 * const registry = createToolRegistry()
 *
 * registry.register({
 *   name: 'echo',
 *   description: 'Echo input',
 *   inputSchema: z.object({ message: z.string() }),
 *   execute: async ({ message }) => ({ echoed: message }),
 * })
 *
 * const result = await registry.execute(
 *   'echo',
 *   { message: 'hello' },
 *   { agentId: 'test' }
 * )
 * // result.data === { echoed: 'hello' }
 * ```
 */
export class ToolRegistry {
  private tools: Map<string, RegistryTool> = new Map()
  readonly options: Required<Omit<ToolRegistryOptions, 'tools' | 'onPermissionRequest' | 'onPreToolUse' | 'onPostToolUse'>> & {
    onPermissionRequest?: ToolRegistryOptions['onPermissionRequest']
    onPreToolUse?: ToolRegistryOptions['onPreToolUse']
    onPostToolUse?: ToolRegistryOptions['onPostToolUse']
  }

  constructor(options: ToolRegistryOptions = {}) {
    this.options = {
      defaultTimeout: options.defaultTimeout ?? 120000,
      maxTimeout: options.maxTimeout ?? 600000,
      sandboxed: options.sandboxed ?? false,
      onPermissionRequest: options.onPermissionRequest,
      onPreToolUse: options.onPreToolUse,
      onPostToolUse: options.onPostToolUse,
    }

    // Register initial tools
    if (options.tools) {
      for (const tool of options.tools) {
        this.register(tool)
      }
    }
  }

  /**
   * Register a tool in the registry
   */
  register(tool: RegistryTool, options?: { force?: boolean }): void {
    if (this.tools.has(tool.name) && !options?.force) {
      throw new Error(`Tool ${tool.name} is already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  /**
   * Get a tool by name
   */
  get(name: string): RegistryTool | undefined {
    return this.tools.get(name)
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * List all registered tools
   */
  list(): RegistryTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear()
  }

  /**
   * Execute a tool with validation and sandboxing
   */
  async execute<T = unknown>(
    toolName: string,
    input: unknown,
    context: ToolContext,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult<T>> {
    const startTime = performance.now()

    // Find tool
    const tool = this.tools.get(toolName)
    if (!tool) {
      throw new ToolNotFoundError(toolName)
    }

    // Check permission
    if (!options.skipPermission) {
      await this.checkPermission(tool, context)
    }

    // Run pre-tool hook
    let processedInput = input
    if (this.options.onPreToolUse) {
      const hookResult = await this.options.onPreToolUse({
        toolName,
        input,
        context,
      })

      if (hookResult) {
        if (hookResult.action === 'deny') {
          throw new ToolPermissionError(toolName, hookResult.reason)
        }
        if (hookResult.action === 'modify') {
          processedInput = hookResult.input
        }
      }
    }

    // Validate input (unless explicitly skipped)
    if (options.validate !== false) {
      processedInput = this.validateToolInput(tool, processedInput)
    }

    // Calculate timeout
    const timeout = this.calculateTimeout(options.timeout)

    // Execute with timeout
    let data: T
    try {
      data = await this.executeWithTimeout(
        () => tool.execute(processedInput as any, context),
        timeout,
        toolName
      )
    } catch (error) {
      if (error instanceof ToolTimeoutError || error instanceof ToolPermissionError) {
        throw error
      }
      throw new RegistryExecutionError(
        toolName,
        `Tool execution failed: ${(error as Error).message}`,
        error as Error
      )
    }

    const result: ExecutionResult<T> = {
      success: true,
      toolName,
      input: processedInput,
      data,
      durationMs: performance.now() - startTime,
    }

    // Run post-tool hook
    if (this.options.onPostToolUse) {
      await this.options.onPostToolUse({
        toolName,
        input: processedInput,
        result,
        context,
      })
    }

    return result
  }

  /**
   * Execute multiple tools in sequence
   */
  async executeBatch(
    items: BatchExecutionItem[],
    context: ToolContext,
    options: BatchExecutionOptions = {}
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = []

    for (const item of items) {
      try {
        const result = await this.execute(item.tool, item.input, context, options)
        results.push(result)
      } catch (error) {
        const errorResult: ExecutionResult = {
          success: false,
          toolName: item.tool,
          input: item.input,
          data: null,
          durationMs: 0,
          error: error as Error,
        }
        results.push(errorResult)

        if (options.stopOnError) {
          break
        }
      }
    }

    return results
  }

  /**
   * Export all tools as JSON Schema format
   */
  toJsonSchema(): JsonSchemaExport[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: this.convertToJsonSchema(tool.inputSchema),
    }))
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Check tool permission
   */
  private async checkPermission(tool: RegistryTool, context: ToolContext): Promise<void> {
    const permission = tool.permission ?? 'auto'

    if (permission === 'deny') {
      throw new ToolPermissionError(tool.name, 'Tool permission is set to deny')
    }

    if (permission === 'confirm') {
      if (!this.options.onPermissionRequest) {
        throw new ToolPermissionError(
          tool.name,
          'Tool requires confirmation but no permission handler is configured'
        )
      }

      const allowed = await this.options.onPermissionRequest({
        type: 'tool_use',
        resource: tool.name,
        action: 'execute',
        metadata: {
          toolName: tool.name,
          description: tool.description,
        },
      })

      if (!allowed) {
        throw new ToolPermissionError(tool.name, 'Permission denied by handler')
      }
    }
  }

  /**
   * Validate tool input against schema
   */
  private validateToolInput(tool: RegistryTool, input: unknown): unknown {
    const schema = tool.inputSchema

    // Check if it's a Zod schema
    if (isZodSchema(schema)) {
      const result = validateInput(schema, input)
      if (!result.success) {
        throw new ToolValidationError(
          tool.name,
          result.error.message,
          result.error.path,
          result.error.received,
          result.error.expected
        )
      }
      return result.data
    }

    // For JSON Schema or AgentTool schema, pass through (basic validation)
    // In production, would use ajv for full JSON Schema validation
    return input
  }

  /**
   * Calculate effective timeout
   */
  private calculateTimeout(requestedTimeout?: number): number {
    const timeout = requestedTimeout ?? this.options.defaultTimeout
    return Math.min(timeout, this.options.maxTimeout)
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    toolName: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ToolTimeoutError(toolName, timeoutMs))
      }, timeoutMs)

      fn()
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  /**
   * Convert schema to JSON Schema format
   */
  private convertToJsonSchema(schema: Schema<unknown> | AgentTool['inputSchema']): JsonSchema {
    if (isZodSchema(schema)) {
      return zodToJsonSchema(schema)
    }

    // Already JSON Schema format
    if ('type' in schema) {
      return schema as JsonSchema
    }

    // Fallback
    return { type: 'object' }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new ToolRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createToolRegistry({
 *   defaultTimeout: 30000,
 *   onPreToolUse: async ({ toolName, input }) => {
 *     console.log(`Executing ${toolName}`, input)
 *     return { action: 'allow' }
 *   },
 * })
 * ```
 */
export function createToolRegistry(options: ToolRegistryOptions = {}): ToolRegistry {
  return new ToolRegistry(options)
}

export default AGENT_TOOLS

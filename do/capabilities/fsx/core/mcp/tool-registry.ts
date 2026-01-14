/**
 * MCP Tool Registry - Tool Infrastructure
 *
 * Provides a central registry for MCP tools with:
 * - Tool registration and unregistration
 * - Tool invocation via dispatcher
 * - Built-in filesystem tools (fs_*)
 * - Parameter validation
 * - Middleware support for cross-cutting concerns
 *
 * @module core/mcp/tool-registry
 */

import type { McpToolResult, StorageBackend } from './shared'

// Import existing tool implementations and schemas
import { invokeFsSearch, fsSearchToolSchema } from './fs-search'
import { invokeFsList, fsListToolSchema } from './fs-list'
import { invokeFsMkdir, fsMkdirToolSchema } from './fs-mkdir'
import { invokeFsStat, fsStatToolSchema } from './fs-stat'
import { invokeFsTree, fsTreeToolSchema } from './fs-tree'

// =============================================================================
// Types
// =============================================================================

/**
 * Property schema for tool parameters.
 */
export interface PropertySchema {
  type?: string
  description?: string
  enum?: readonly unknown[]
  default?: unknown
  items?: PropertySchema
  properties?: Record<string, PropertySchema>
  required?: readonly string[]
}

/**
 * Input schema for MCP tools - strongly typed.
 */
export interface InputSchema<P extends Record<string, PropertySchema> = Record<string, PropertySchema>> {
  type: 'object'
  properties: P
  required?: readonly string[] | string[]
}

/**
 * MCP tool schema definition with improved type safety.
 *
 * @typeParam P - Property definitions for the input schema
 */
export interface McpToolSchema<P extends Record<string, PropertySchema> = Record<string, PropertySchema>> {
  /** Unique tool name (lowercase, underscores/hyphens allowed) */
  name: string
  /** Human-readable description */
  description: string
  /** JSON Schema for input parameters */
  inputSchema: InputSchema<P>
}

/**
 * Context passed to tool handlers and middleware.
 */
export interface ToolContext {
  /** The tool being invoked */
  toolName: string
  /** Invocation timestamp */
  timestamp: number
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Tool handler function type with improved type safety.
 *
 * @typeParam TParams - Parameter type (inferred from schema)
 * @typeParam TStorage - Storage backend type
 */
export type McpToolHandler<
  TParams extends Record<string, unknown> = Record<string, unknown>,
  TStorage = unknown
> = (
  params: TParams,
  storage?: TStorage,
  context?: ToolContext
) => Promise<McpToolResult>

/**
 * Middleware function type for tool invocations.
 *
 * Middleware can:
 * - Modify parameters before handler execution
 * - Modify results after handler execution
 * - Short-circuit execution by returning early
 * - Add logging, metrics, or other cross-cutting concerns
 */
export type ToolMiddleware = (
  context: ToolContext,
  params: Record<string, unknown>,
  next: () => Promise<McpToolResult>
) => Promise<McpToolResult>

/**
 * Registered MCP tool with handler.
 */
export interface McpTool<
  P extends Record<string, PropertySchema> = Record<string, PropertySchema>
> {
  /** Tool schema defining name, description, and parameters */
  schema: McpToolSchema<P>
  /** Async handler function */
  handler: McpToolHandler
}

/**
 * Tool registry interface for querying registered tools.
 */
export interface ToolRegistry {
  /** Check if tool exists by name */
  get(name: string): McpTool | undefined
  /** Get tool by name (case-insensitive) */
  has(name: string): boolean
  /** List all registered tool names */
  list(): string[]
  /** Get all tool schemas */
  schemas(): McpToolSchema[]
  /** Get count of registered tools */
  count(): number
  /** Find tools matching a predicate */
  filter(predicate: (tool: McpTool) => boolean): McpTool[]
}

/**
 * Options for invokeTool.
 */
export interface InvokeToolOptions {
  /** Enable strict parameter type validation */
  strictValidation?: boolean
  /** Additional context metadata */
  metadata?: Record<string, unknown>
}

// =============================================================================
// Registry Storage
// =============================================================================

/** Internal tool registry map - normalized name to tool */
const toolRegistry = new Map<string, McpTool>()

/** Set of custom (non-builtin) tool names for cleanup */
const customTools = new Set<string>()

/** Registered middleware stack */
const middlewareStack: ToolMiddleware[] = []

/** Set of builtin tool names - never removed on clear */
const builtinToolNames = new Set<string>()

// =============================================================================
// Tool Name Utilities
// =============================================================================

/**
 * Normalize a tool name for registry lookup.
 *
 * Applies consistent transformations:
 * - Converts to lowercase
 * - Trims whitespace
 *
 * @param name - Tool name to normalize
 * @returns Normalized name
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim()
}

/**
 * Validate a tool name.
 *
 * Rules:
 * - Must not be empty
 * - Must not contain spaces
 * - Must not start with a number
 * - May contain letters, numbers, underscores, and hyphens
 * - Must not contain dots or slashes
 *
 * @param name - Tool name to validate
 * @throws Error if name is invalid
 */
function validateToolName(name: string): void {
  if (!name || name.trim() === '') {
    throw new Error('Tool name cannot be empty')
  }

  if (name.includes(' ')) {
    throw new Error('Tool name cannot contain spaces')
  }

  if (/^\d/.test(name)) {
    throw new Error('Tool name cannot start with a number')
  }

  if (name.includes('.')) {
    throw new Error('Tool name cannot contain dots')
  }

  if (name.includes('/')) {
    throw new Error('Tool name cannot contain slashes')
  }
}

/**
 * Validate a tool schema.
 *
 * @param schema - Schema to validate
 * @throws Error if schema is invalid
 */
function validateSchema(schema: McpToolSchema): void {
  if (!schema.inputSchema) {
    throw new Error('Tool schema must have inputSchema')
  }

  if (schema.inputSchema.type !== 'object') {
    throw new Error('Tool inputSchema type must be "object"')
  }

  if (schema.inputSchema.properties === undefined) {
    throw new Error('Tool inputSchema must have properties')
  }
}

// =============================================================================
// Registry Operations
// =============================================================================

/**
 * Register a custom tool.
 *
 * @param schema - Tool schema with name, description, and inputSchema
 * @param handler - Async function to handle tool invocations
 * @throws Error if tool name is invalid, schema is invalid, or tool already exists
 *
 * @example
 * ```typescript
 * registerTool(
 *   {
 *     name: 'my_tool',
 *     description: 'My custom tool',
 *     inputSchema: {
 *       type: 'object',
 *       properties: { input: { type: 'string' } },
 *       required: ['input'],
 *     },
 *   },
 *   async (params) => ({
 *     content: [{ type: 'text', text: `Result: ${params.input}` }],
 *   })
 * )
 * ```
 */
export function registerTool(schema: McpToolSchema, handler: McpToolHandler): void {
  validateToolName(schema.name)
  validateSchema(schema)

  const normalizedName = normalizeName(schema.name)

  if (toolRegistry.has(normalizedName)) {
    throw new Error(`Tool "${schema.name}" is already registered`)
  }

  toolRegistry.set(normalizedName, { schema, handler })
  customTools.add(normalizedName)
}

/**
 * Unregister a tool.
 *
 * @param name - Name of tool to unregister
 * @throws Error if tool is not found
 *
 * @example
 * ```typescript
 * unregisterTool('my_tool')
 * ```
 */
export function unregisterTool(name: string): void {
  const normalizedName = normalizeName(name)

  if (!toolRegistry.has(normalizedName)) {
    throw new Error(`Tool "${name}" is not registered`)
  }

  toolRegistry.delete(normalizedName)
  customTools.delete(normalizedName)
}

/**
 * Register middleware that runs on all tool invocations.
 *
 * Middleware is executed in order of registration (FIFO).
 * Each middleware receives the context, params, and a `next` function
 * to continue the chain.
 *
 * @param middleware - Middleware function
 *
 * @example
 * ```typescript
 * // Logging middleware
 * useMiddleware(async (ctx, params, next) => {
 *   console.log(`Invoking ${ctx.toolName}`)
 *   const result = await next()
 *   console.log(`${ctx.toolName} completed`)
 *   return result
 * })
 *
 * // Timing middleware
 * useMiddleware(async (ctx, params, next) => {
 *   const start = Date.now()
 *   const result = await next()
 *   ctx.metadata = { ...ctx.metadata, duration: Date.now() - start }
 *   return result
 * })
 * ```
 */
export function useMiddleware(middleware: ToolMiddleware): void {
  middlewareStack.push(middleware)
}

/**
 * Clear all registered middleware.
 */
export function clearMiddleware(): void {
  middlewareStack.length = 0
}

/**
 * Get the tool registry interface.
 *
 * Provides read-only access to the registry with query methods.
 *
 * @returns Registry interface with query methods
 */
export function getToolRegistry(): ToolRegistry {
  return {
    has(name: string): boolean {
      return toolRegistry.has(normalizeName(name))
    },

    get(name: string): McpTool | undefined {
      return toolRegistry.get(normalizeName(name))
    },

    list(): string[] {
      return Array.from(toolRegistry.keys())
    },

    schemas(): McpToolSchema[] {
      return Array.from(toolRegistry.values()).map((tool) => tool.schema)
    },

    count(): number {
      return toolRegistry.size
    },

    filter(predicate: (tool: McpTool) => boolean): McpTool[] {
      return Array.from(toolRegistry.values()).filter(predicate)
    },
  }
}

/**
 * Clear all custom tools from the registry.
 *
 * Built-in fs_* tools are preserved. Middleware is also cleared.
 */
export function clearToolRegistry(): void {
  // Remove only custom tools
  for (const name of customTools) {
    toolRegistry.delete(name)
  }
  customTools.clear()

  // Clear middleware stack
  clearMiddleware()

  // Re-register builtin tools
  registerBuiltinTools()
}

// =============================================================================
// Parameter Validation
// =============================================================================

/**
 * Validate required parameters.
 *
 * @param params - Parameters to validate
 * @param schema - Tool schema with required array
 * @returns Error message or null if valid
 */
function validateRequiredParams(
  params: Record<string, unknown>,
  schema: McpToolSchema
): string | null {
  const required = schema.inputSchema.required ?? []

  for (const paramName of required) {
    if (params[paramName] === undefined || params[paramName] === null) {
      return `Missing required parameter: ${paramName}`
    }
  }

  return null
}

/**
 * Validate parameter types (strict mode).
 *
 * @param params - Parameters to validate
 * @param schema - Tool schema with property definitions
 * @returns Error message or null if valid
 */
function validateParamTypes(
  params: Record<string, unknown>,
  schema: McpToolSchema
): string | null {
  const properties = schema.inputSchema.properties

  for (const [paramName, value] of Object.entries(params)) {
    const propSchema = properties[paramName] as { type?: string } | undefined
    if (!propSchema?.type) continue

    const expectedType = propSchema.type
    const actualType = typeof value

    // Type mapping for validation
    if (expectedType === 'number' && actualType !== 'number') {
      return `Parameter "${paramName}" must be a number, got ${actualType}`
    }
    if (expectedType === 'string' && actualType !== 'string') {
      return `Parameter "${paramName}" must be a string, got ${actualType}`
    }
    if (expectedType === 'boolean' && actualType !== 'boolean') {
      return `Parameter "${paramName}" must be a boolean, got ${actualType}`
    }
    if (expectedType === 'array' && !Array.isArray(value)) {
      return `Parameter "${paramName}" must be an array, got ${actualType}`
    }
  }

  return null
}

// =============================================================================
// Tool Invocation
// =============================================================================

/**
 * Create error result helper for invocation.
 */
function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

/**
 * Execute middleware chain with final handler.
 *
 * Creates a chain of middleware functions that execute in order,
 * with each calling `next()` to continue to the next middleware
 * or the final handler.
 */
function executeWithMiddleware(
  context: ToolContext,
  params: Record<string, unknown>,
  handler: () => Promise<McpToolResult>
): Promise<McpToolResult> {
  // No middleware - execute handler directly
  if (middlewareStack.length === 0) {
    return handler()
  }

  // Build middleware chain from end to start
  let index = middlewareStack.length - 1

  const executeNext = (): Promise<McpToolResult> => {
    if (index < 0) {
      return handler()
    }
    const middleware = middlewareStack[index]
    index--
    // This should never happen since we check index >= 0, but TypeScript needs it
    if (!middleware) {
      return handler()
    }
    return middleware(context, params, executeNext)
  }

  // Reset index and start chain
  index = middlewareStack.length - 1
  return executeNext()
}

/**
 * Invoke a tool by name.
 *
 * Dispatches to the correct handler based on tool name with:
 * - Case-insensitive name matching
 * - Whitespace trimming
 * - Required parameter validation
 * - Optional strict type validation
 * - Middleware execution
 * - Exception handling and wrapping
 *
 * @param name - Tool name to invoke
 * @param params - Parameters to pass to handler
 * @param storage - Optional storage backend
 * @param options - Optional invocation options
 * @returns MCP tool result
 *
 * @example
 * ```typescript
 * const result = await invokeTool('fs_list', { path: '/home' }, storage)
 * if (!result.isError) {
 *   console.log(result.content[0].text)
 * }
 * ```
 */
export async function invokeTool(
  name: string,
  params: Record<string, unknown>,
  storage?: unknown,
  options?: InvokeToolOptions
): Promise<McpToolResult> {
  // Handle null/undefined params
  const safeParams = params ?? {}

  // Normalize tool name
  const normalizedName = normalizeName(name)

  // Look up tool
  const tool = toolRegistry.get(normalizedName)

  if (!tool) {
    return errorResult(`Unknown tool: ${name}`)
  }

  // Validate required parameters
  const requiredError = validateRequiredParams(safeParams, tool.schema)
  if (requiredError) {
    return errorResult(requiredError)
  }

  // Validate parameter types (strict mode only)
  if (options?.strictValidation) {
    const typeError = validateParamTypes(safeParams, tool.schema)
    if (typeError) {
      return errorResult(typeError)
    }
  }

  // Create invocation context
  const context: ToolContext = {
    toolName: normalizedName,
    timestamp: Date.now(),
    metadata: options?.metadata,
  }

  // Handler function that wraps the tool execution
  const executeHandler = async (): Promise<McpToolResult> => {
    try {
      return await tool.handler(safeParams, storage, context)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return errorResult(message)
    }
  }

  // Execute with middleware chain
  return executeWithMiddleware(context, safeParams, executeHandler)
}

// =============================================================================
// Builtin Tool Schemas
// =============================================================================

/**
 * Schema for fs_read tool.
 */
export const fsReadToolSchema: McpToolSchema = {
  name: 'fs_read',
  description: 'Read file contents',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to read',
      },
      encoding: {
        type: 'string',
        description: 'Text encoding (default: utf-8)',
      },
    },
    required: ['path'],
  },
}

/**
 * Schema for fs_write tool.
 */
export const fsWriteToolSchema: McpToolSchema = {
  name: 'fs_write',
  description: 'Write content to a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to write',
      },
      content: {
        type: 'string',
        description: 'Content to write',
      },
      encoding: {
        type: 'string',
        description: 'Text encoding (default: utf-8)',
      },
    },
    required: ['path', 'content'],
  },
}

/**
 * Schema for fs_append tool.
 */
export const fsAppendToolSchema: McpToolSchema = {
  name: 'fs_append',
  description: 'Append content to a file',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to append to',
      },
      content: {
        type: 'string',
        description: 'Content to append',
      },
    },
    required: ['path', 'content'],
  },
}

/**
 * Schema for fs_delete tool.
 */
export const fsDeleteToolSchema: McpToolSchema = {
  name: 'fs_delete',
  description: 'Delete a file or directory',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to delete',
      },
      recursive: {
        type: 'boolean',
        description: 'Delete directories recursively',
      },
    },
    required: ['path'],
  },
}

/**
 * Schema for fs_move tool.
 */
export const fsMoveToolSchema: McpToolSchema = {
  name: 'fs_move',
  description: 'Move/rename a file or directory',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source path',
      },
      destination: {
        type: 'string',
        description: 'Destination path',
      },
    },
    required: ['source', 'destination'],
  },
}

/**
 * Schema for fs_copy tool.
 */
export const fsCopyToolSchema: McpToolSchema = {
  name: 'fs_copy',
  description: 'Copy a file',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source file path',
      },
      destination: {
        type: 'string',
        description: 'Destination file path',
      },
    },
    required: ['source', 'destination'],
  },
}

/**
 * Schema for fs_exists tool.
 */
export const fsExistsToolSchema: McpToolSchema = {
  name: 'fs_exists',
  description: 'Check if a file or directory exists',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to check',
      },
    },
    required: ['path'],
  },
}

// =============================================================================
// Builtin Tool Handlers
// =============================================================================

/**
 * Handler for fs_read tool.
 */
async function invokeFsRead(
  params: Record<string, unknown>,
  storage?: unknown
): Promise<McpToolResult> {
  const path = params.path as string
  const st = storage as StorageBackend

  if (!st?.has(path)) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file: ${path}` }],
      isError: true,
    }
  }

  const entry = st.get(path)
  if (!entry) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file: ${path}` }],
      isError: true,
    }
  }

  if (entry.type === 'directory') {
    return {
      content: [{ type: 'text', text: `EISDIR: is a directory: ${path}` }],
      isError: true,
    }
  }

  const content = new TextDecoder().decode(entry.content)
  return {
    content: [{ type: 'text', text: content }],
    isError: false,
  }
}

/**
 * Handler for fs_write tool.
 */
async function invokeFsWrite(
  params: Record<string, unknown>,
  storage?: unknown
): Promise<McpToolResult> {
  const path = params.path as string
  const content = params.content as string
  const st = storage as StorageBackend & {
    addFile(path: string, content: string | Uint8Array): void
    getParentPath?(path: string): string
    parentExists?(path: string): boolean
  }

  // Check parent exists
  if (st.parentExists && !st.parentExists(path)) {
    return {
      content: [{ type: 'text', text: `ENOENT: parent directory does not exist` }],
      isError: true,
    }
  }

  st.addFile(path, content)
  return {
    content: [{ type: 'text', text: `Successfully wrote to ${path}` }],
    isError: false,
  }
}

/**
 * Handler for fs_append tool.
 */
async function invokeFsAppend(
  params: Record<string, unknown>,
  storage?: unknown
): Promise<McpToolResult> {
  const path = params.path as string
  const content = params.content as string
  const st = storage as StorageBackend & {
    addFile(path: string, content: string | Uint8Array): void
    updateContent?(path: string, content: string | Uint8Array): void
  }

  const entry = st.get(path)
  if (entry) {
    const existingContent = new TextDecoder().decode(entry.content)
    const newContent = existingContent + content

    if (st.updateContent) {
      st.updateContent(path, newContent)
    } else {
      st.addFile(path, newContent)
    }
  } else {
    st.addFile(path, content)
  }

  return {
    content: [{ type: 'text', text: `Successfully appended to ${path}` }],
    isError: false,
  }
}

/**
 * Handler for fs_delete tool.
 */
async function invokeFsDelete(
  params: Record<string, unknown>,
  storage?: unknown
): Promise<McpToolResult> {
  const path = params.path as string
  const recursive = params.recursive as boolean
  const st = storage as StorageBackend & {
    remove(path: string): boolean
    getAllPaths?(): string[]
  }

  if (!st.has(path)) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file or directory: ${path}` }],
      isError: true,
    }
  }

  const entry = st.get(path)
  if (entry?.type === 'directory') {
    const children = st.getChildren(path)
    if (children.length > 0 && !recursive) {
      return {
        content: [{ type: 'text', text: `ENOTEMPTY: directory not empty: ${path}` }],
        isError: true,
      }
    }

    if (recursive && st.getAllPaths) {
      const allPaths = st.getAllPaths()
      const toRemove = allPaths.filter((p) => p.startsWith(path + '/') || p === path)
      toRemove.sort((a, b) => b.length - a.length)
      for (const p of toRemove) {
        st.remove(p)
      }
    } else {
      st.remove(path)
    }
  } else {
    st.remove(path)
  }

  return {
    content: [{ type: 'text', text: `Successfully deleted ${path}` }],
    isError: false,
  }
}

/**
 * Handler for fs_move tool.
 */
async function invokeFsMove(
  params: Record<string, unknown>,
  storage?: unknown
): Promise<McpToolResult> {
  const source = params.source as string
  const destination = params.destination as string
  const st = storage as StorageBackend & {
    addFile(path: string, content: string | Uint8Array, options?: { mode?: number }): void
    addDirectory(path: string, options?: { mode?: number }): void
    remove(path: string): boolean
  }

  if (!st.has(source)) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file or directory: ${source}` }],
      isError: true,
    }
  }

  const entry = st.get(source)
  if (!entry) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file or directory: ${source}` }],
      isError: true,
    }
  }

  if (entry.type === 'file') {
    st.addFile(destination, entry.content)
  } else if (entry.type === 'directory') {
    st.addDirectory(destination)
  }

  st.remove(source)

  return {
    content: [{ type: 'text', text: `Successfully moved ${source} to ${destination}` }],
    isError: false,
  }
}

/**
 * Handler for fs_copy tool.
 */
async function invokeFsCopy(
  params: Record<string, unknown>,
  storage?: unknown
): Promise<McpToolResult> {
  const source = params.source as string
  const destination = params.destination as string
  const st = storage as StorageBackend & {
    addFile(path: string, content: string | Uint8Array): void
  }

  if (!st.has(source)) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file: ${source}` }],
      isError: true,
    }
  }

  const entry = st.get(source)
  if (!entry) {
    return {
      content: [{ type: 'text', text: `ENOENT: no such file: ${source}` }],
      isError: true,
    }
  }

  if (entry.type === 'directory') {
    return {
      content: [{ type: 'text', text: `EISDIR: cannot copy directory: ${source}` }],
      isError: true,
    }
  }

  st.addFile(destination, entry.content)

  return {
    content: [{ type: 'text', text: `Successfully copied ${source} to ${destination}` }],
    isError: false,
  }
}

/**
 * Handler for fs_exists tool.
 */
async function invokeFsExists(
  params: Record<string, unknown>,
  storage?: unknown
): Promise<McpToolResult> {
  const path = params.path as string
  const st = storage as StorageBackend

  const exists = st.has(path)

  return {
    content: [{ type: 'text', text: exists ? 'true' : 'false' }],
    isError: false,
  }
}

// =============================================================================
// fsTools Array
// =============================================================================

/**
 * Array of all built-in filesystem MCP tools.
 *
 * Each tool has a schema and handler that can be used for
 * direct invocation or MCP registration.
 */
export const fsTools: McpTool[] = [
  { schema: fsSearchToolSchema as McpToolSchema, handler: invokeFsSearch as McpToolHandler },
  { schema: fsListToolSchema as McpToolSchema, handler: invokeFsList as McpToolHandler },
  { schema: fsTreeToolSchema as McpToolSchema, handler: invokeFsTree as McpToolHandler },
  { schema: fsStatToolSchema as McpToolSchema, handler: invokeFsStat as McpToolHandler },
  { schema: fsMkdirToolSchema as McpToolSchema, handler: invokeFsMkdir as McpToolHandler },
  { schema: fsReadToolSchema, handler: invokeFsRead },
  { schema: fsWriteToolSchema, handler: invokeFsWrite },
  { schema: fsAppendToolSchema, handler: invokeFsAppend },
  { schema: fsDeleteToolSchema, handler: invokeFsDelete },
  { schema: fsMoveToolSchema, handler: invokeFsMove },
  { schema: fsCopyToolSchema, handler: invokeFsCopy },
  { schema: fsExistsToolSchema, handler: invokeFsExists },
]

// =============================================================================
// Builtin Tool Registration
// =============================================================================

/**
 * Register all builtin filesystem tools.
 *
 * Called on module initialization and after clearToolRegistry().
 * Builtin tools are tracked separately and preserved across registry clears.
 */
function registerBuiltinTools(): void {
  for (const tool of fsTools) {
    const normalizedName = normalizeName(tool.schema.name)
    // Track as builtin and register
    builtinToolNames.add(normalizedName)
    if (!toolRegistry.has(normalizedName)) {
      toolRegistry.set(normalizedName, tool)
    }
  }
}

/**
 * Check if a tool is a builtin tool.
 *
 * @param name - Tool name to check
 * @returns True if tool is builtin
 */
export function isBuiltinTool(name: string): boolean {
  return builtinToolNames.has(normalizeName(name))
}

// Initialize builtin tools on module load
registerBuiltinTools()

// =============================================================================
// Re-exports
// =============================================================================

// Re-export existing schemas for backward compatibility
export {
  fsSearchToolSchema,
  fsListToolSchema,
  fsTreeToolSchema,
  fsStatToolSchema,
  fsMkdirToolSchema,
}

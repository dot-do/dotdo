/**
 * Tool-Thing Integration
 *
 * This module unifies the agents/Tool.ts helper with the db/graph Things system.
 * It provides bidirectional conversion between ToolDefinition (in-memory tool)
 * and GraphThing (persistent graph node).
 *
 * Design Goals:
 * - Backward compatible: existing tool() usage works unchanged
 * - Optional persistence: tools can optionally be stored in the graph
 * - Handler registry: execute functions are stored in memory (not serialized)
 * - Type-safe: full TypeScript type inference preserved
 *
 * @see dotdo-vxnoy - [REFACTOR] Unify agents/Tool.ts with Tool Things
 * @module agents/tool-thing
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext, Schema, JsonSchema } from './types'
import type { GraphThing, GraphStore } from '../../db/graph/types'
import { zodToJsonSchema, isZodSchema } from './schema'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type name for Tool Things in the graph */
export const TOOL_TYPE_NAME = 'Tool'

/** Type ID for Tool Things (reserved for Tools in the graph schema) */
export const TOOL_TYPE_ID = 100

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

/**
 * In-memory registry for tool execute handlers.
 *
 * Since functions cannot be serialized to JSON for storage in the graph,
 * we store handlers in memory and reference them by ID. This allows
 * tools to be persisted while keeping their execute functions functional.
 */
const handlerRegistry = new Map<string, (input: unknown, context: ToolContext) => Promise<unknown>>()

/**
 * Generate a unique handler ID for registry storage.
 */
function generateHandlerId(toolName: string): string {
  return `handler:${toolName}:${Date.now().toString(36)}`
}

/**
 * Register a handler function and return its ID.
 *
 * @param toolName - Name of the tool (used for ID generation)
 * @param handler - The execute function to register
 * @returns The handler ID for later retrieval
 */
export function registerHandler<TInput, TOutput>(
  toolName: string,
  handler: (input: TInput, context: ToolContext) => Promise<TOutput>
): string {
  const id = generateHandlerId(toolName)
  handlerRegistry.set(id, handler as (input: unknown, context: ToolContext) => Promise<unknown>)
  return id
}

/**
 * Get a handler function by ID.
 *
 * @param id - The handler ID from registerHandler
 * @returns The handler function or undefined if not found
 */
export function getHandler(id: string): ((input: unknown, context: ToolContext) => Promise<unknown>) | undefined {
  return handlerRegistry.get(id)
}

/**
 * Remove a handler from the registry.
 *
 * @param id - The handler ID to remove
 * @returns true if removed, false if not found
 */
export function unregisterHandler(id: string): boolean {
  return handlerRegistry.delete(id)
}

/**
 * Clear all handlers from the registry.
 * Useful for testing or cleanup.
 */
export function clearHandlerRegistry(): void {
  handlerRegistry.clear()
}

/**
 * Get the count of registered handlers.
 */
export function getHandlerCount(): number {
  return handlerRegistry.size
}

// ============================================================================
// TOOL THING DATA INTERFACE
// ============================================================================

/**
 * Data structure for a Tool Thing stored in the graph.
 *
 * This represents the JSON data payload of a GraphThing with typeName='Tool'.
 * The execute function is stored separately in the handler registry.
 */
export interface ToolThingData {
  /** Tool name (unique identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Input schema in JSON Schema format */
  inputSchema: JsonSchema
  /** Output schema in JSON Schema format (optional) */
  outputSchema?: JsonSchema
  /** Handler ID for retrieving the execute function */
  handlerId: string
  /** Whether this tool can be interrupted (voice agents) */
  interruptible?: boolean
  /** Permission level: auto, confirm, or deny */
  permission?: 'auto' | 'confirm' | 'deny'
  /** Additional metadata */
  metadata?: Record<string, unknown>
  /** Index signature for compatibility with Record<string, unknown> */
  [key: string]: unknown
}

// ============================================================================
// CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert a ToolDefinition to a GraphThing.
 *
 * This registers the execute handler and creates a Thing data structure
 * that can be stored in the graph. The actual storage is done by the caller.
 *
 * @param tool - The ToolDefinition to convert
 * @returns Object containing the Thing input and handler ID
 *
 * @example
 * ```typescript
 * import { tool } from './Tool'
 * import { toolToThing } from './tool-thing'
 *
 * const weatherTool = tool({
 *   name: 'getWeather',
 *   description: 'Get weather for a location',
 *   inputSchema: z.object({ location: z.string() }),
 *   execute: async ({ location }) => ({ temp: 22 }),
 * })
 *
 * const { thingInput, handlerId } = toolToThing(weatherTool)
 * // Store thingInput in graph...
 * ```
 */
export function toolToThing<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>
): {
  thingInput: {
    id: string
    typeId: number
    typeName: string
    data: ToolThingData
  }
  handlerId: string
} {
  // Register the handler
  const handlerId = registerHandler(tool.name, tool.execute)

  // Convert schemas to JSON Schema format
  const inputSchema = isZodSchema(tool.inputSchema)
    ? zodToJsonSchema(tool.inputSchema as z.ZodType<unknown>)
    : (tool.inputSchema as JsonSchema)

  const outputSchema = tool.outputSchema
    ? isZodSchema(tool.outputSchema)
      ? zodToJsonSchema(tool.outputSchema as z.ZodType<unknown>)
      : (tool.outputSchema as JsonSchema)
    : undefined

  // Build the Thing data
  const data: ToolThingData = {
    name: tool.name,
    description: tool.description,
    inputSchema,
    outputSchema,
    handlerId,
    interruptible: tool.interruptible,
    permission: tool.permission,
  }

  return {
    thingInput: {
      id: `tool:${tool.name}`,
      typeId: TOOL_TYPE_ID,
      typeName: TOOL_TYPE_NAME,
      data,
    },
    handlerId,
  }
}

/**
 * Convert a GraphThing back to a ToolDefinition.
 *
 * This retrieves the handler from the registry and reconstructs
 * the ToolDefinition. Returns null if the handler is not found.
 *
 * @param thing - The GraphThing to convert (must be a Tool Thing)
 * @returns The ToolDefinition or null if handler not found
 *
 * @example
 * ```typescript
 * const thing = await graphStore.getThing('tool:getWeather')
 * const tool = thingToTool(thing)
 * if (tool) {
 *   const result = await tool.execute({ location: 'SF' }, ctx)
 * }
 * ```
 */
export function thingToTool(thing: GraphThing): ToolDefinition | null {
  if (thing.typeName !== TOOL_TYPE_NAME) {
    return null
  }

  const data = thing.data as ToolThingData | null
  if (!data) {
    return null
  }

  // Get the handler from registry
  const handler = getHandler(data.handlerId)
  if (!handler) {
    return null
  }

  return {
    name: data.name,
    description: data.description,
    inputSchema: data.inputSchema,
    outputSchema: data.outputSchema,
    execute: handler as (input: unknown, context: ToolContext) => Promise<unknown>,
    interruptible: data.interruptible,
    permission: data.permission,
  }
}

// ============================================================================
// GRAPH STORE INTEGRATION
// ============================================================================

/**
 * Options for creating a persistent tool.
 */
export interface PersistentToolOptions<TInput, TOutput> {
  /** Tool name (unique identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Input schema (Zod or JSON Schema) */
  inputSchema: z.ZodType<TInput> | JsonSchema
  /** Output schema (optional) */
  outputSchema?: z.ZodType<TOutput> | JsonSchema
  /** Execute function */
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>
  /** Whether this tool can be interrupted */
  interruptible?: boolean
  /** Permission level */
  permission?: 'auto' | 'confirm' | 'deny'
  /** Graph store for persistence (optional) */
  store?: GraphStore
}

/**
 * Create a tool definition and optionally persist it to a graph store.
 *
 * This is the unified entry point that combines the agents/Tool.ts
 * functionality with graph persistence. If a store is provided,
 * the tool will be persisted as a Thing in the graph.
 *
 * @param options - Tool options including optional graph store
 * @returns The ToolDefinition (ready for immediate use)
 *
 * @example
 * ```typescript
 * // Without persistence (same as existing tool() helper)
 * const weatherTool = persistentTool({
 *   name: 'getWeather',
 *   description: 'Get weather',
 *   inputSchema: z.object({ location: z.string() }),
 *   execute: async ({ location }) => ({ temp: 22 }),
 * })
 *
 * // With persistence to graph
 * const weatherTool = await persistentTool({
 *   name: 'getWeather',
 *   description: 'Get weather',
 *   inputSchema: z.object({ location: z.string() }),
 *   execute: async ({ location }) => ({ temp: 22 }),
 *   store: graphStore,
 * })
 * ```
 */
export async function persistentTool<TInput, TOutput>(
  options: PersistentToolOptions<TInput, TOutput>
): Promise<ToolDefinition<TInput, TOutput>> {
  // Create the tool definition
  const toolDef: ToolDefinition<TInput, TOutput> = {
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema as Schema<TInput>,
    outputSchema: options.outputSchema as Schema<TOutput> | undefined,
    execute: options.execute,
    interruptible: options.interruptible,
    permission: options.permission,
  }

  // If store provided, persist to graph
  if (options.store) {
    const { thingInput } = toolToThing(toolDef)

    // Check if tool already exists
    const existing = await options.store.getThing(thingInput.id)
    if (existing) {
      // Update existing tool
      await options.store.updateThing(thingInput.id, { data: thingInput.data })
    } else {
      // Create new tool
      await options.store.createThing(thingInput)
    }
  }

  return toolDef
}

/**
 * Load a tool from the graph store.
 *
 * Retrieves a Tool Thing from the graph and converts it back to
 * a ToolDefinition. The execute handler must have been previously
 * registered (e.g., by calling persistentTool with the same tool).
 *
 * @param store - The graph store to load from
 * @param name - The tool name
 * @returns The ToolDefinition or null if not found
 *
 * @example
 * ```typescript
 * const tool = await loadToolFromGraph(graphStore, 'getWeather')
 * if (tool) {
 *   const result = await tool.execute({ location: 'SF' }, ctx)
 * }
 * ```
 */
export async function loadToolFromGraph(
  store: GraphStore,
  name: string
): Promise<ToolDefinition | null> {
  const thing = await store.getThing(`tool:${name}`)
  if (!thing) {
    return null
  }

  return thingToTool(thing)
}

/**
 * List all tools from the graph store.
 *
 * Retrieves all Tool Things from the graph and converts them to
 * ToolDefinitions. Tools without registered handlers are skipped.
 *
 * @param store - The graph store to list from
 * @param options - Optional pagination and filtering options
 * @returns Array of ToolDefinitions
 *
 * @example
 * ```typescript
 * const tools = await listToolsFromGraph(graphStore)
 * console.log(`Found ${tools.length} tools`)
 * ```
 */
export async function listToolsFromGraph(
  store: GraphStore,
  options?: { limit?: number; offset?: number }
): Promise<ToolDefinition[]> {
  const things = await store.getThingsByType({
    typeName: TOOL_TYPE_NAME,
    limit: options?.limit,
    offset: options?.offset,
  })

  const tools: ToolDefinition[] = []
  for (const thing of things) {
    const tool = thingToTool(thing)
    if (tool) {
      tools.push(tool)
    }
  }

  return tools
}

/**
 * Delete a tool from the graph store.
 *
 * Removes the Tool Thing from the graph and unregisters its handler.
 *
 * @param store - The graph store
 * @param name - The tool name to delete
 * @returns true if deleted, false if not found
 */
export async function deleteToolFromGraph(
  store: GraphStore,
  name: string
): Promise<boolean> {
  const thing = await store.getThing(`tool:${name}`)
  if (!thing) {
    return false
  }

  // Unregister handler
  const data = thing.data as ToolThingData | null
  if (data?.handlerId) {
    unregisterHandler(data.handlerId)
  }

  // Delete from graph
  const deleted = await store.deleteThing(`tool:${name}`)
  return deleted !== null
}

// ============================================================================
// TOOL REGISTRY (IN-MEMORY + GRAPH HYBRID)
// ============================================================================

/**
 * A hybrid tool registry that combines in-memory tools with graph-backed tools.
 *
 * This provides a unified interface for managing tools regardless of
 * whether they are purely in-memory or persisted to the graph.
 */
export class ToolThingRegistry {
  private inMemoryTools: Map<string, ToolDefinition> = new Map()
  private store?: GraphStore

  /**
   * Create a new ToolThingRegistry.
   *
   * @param store - Optional graph store for persistence
   */
  constructor(store?: GraphStore) {
    this.store = store
  }

  /**
   * Register a tool in the registry.
   *
   * If a graph store is configured, the tool will also be persisted.
   *
   * @param tool - The tool to register
   * @param options - Registration options
   */
  async register(
    tool: ToolDefinition,
    options?: { persist?: boolean }
  ): Promise<void> {
    // Always add to in-memory registry
    this.inMemoryTools.set(tool.name, tool)

    // Persist if requested and store available
    if (options?.persist !== false && this.store) {
      const { thingInput } = toolToThing(tool)
      const existing = await this.store.getThing(thingInput.id)
      if (existing) {
        await this.store.updateThing(thingInput.id, { data: thingInput.data })
      } else {
        await this.store.createThing(thingInput)
      }
    }
  }

  /**
   * Get a tool by name.
   *
   * First checks in-memory registry, then graph store if available.
   *
   * @param name - The tool name
   * @returns The tool or null if not found
   */
  async get(name: string): Promise<ToolDefinition | null> {
    // Check in-memory first
    const inMemory = this.inMemoryTools.get(name)
    if (inMemory) {
      return inMemory
    }

    // Check graph store
    if (this.store) {
      const tool = await loadToolFromGraph(this.store, name)
      if (tool) {
        // Cache in memory for future lookups
        this.inMemoryTools.set(name, tool)
        return tool
      }
    }

    return null
  }

  /**
   * Check if a tool exists.
   *
   * @param name - The tool name
   * @returns true if exists
   */
  async has(name: string): Promise<boolean> {
    if (this.inMemoryTools.has(name)) {
      return true
    }

    if (this.store) {
      const thing = await this.store.getThing(`tool:${name}`)
      return thing !== null
    }

    return false
  }

  /**
   * List all tools.
   *
   * Returns tools from both in-memory registry and graph store.
   *
   * @returns Array of all tools
   */
  async list(): Promise<ToolDefinition[]> {
    const toolMap = new Map<string, ToolDefinition>()

    // Add in-memory tools
    for (const [name, tool] of this.inMemoryTools) {
      toolMap.set(name, tool)
    }

    // Add graph tools (in-memory takes precedence)
    if (this.store) {
      const graphTools = await listToolsFromGraph(this.store)
      for (const tool of graphTools) {
        if (!toolMap.has(tool.name)) {
          toolMap.set(tool.name, tool)
        }
      }
    }

    return Array.from(toolMap.values())
  }

  /**
   * Unregister a tool.
   *
   * Removes from both in-memory registry and graph store.
   *
   * @param name - The tool name
   * @returns true if removed
   */
  async unregister(name: string): Promise<boolean> {
    const inMemoryRemoved = this.inMemoryTools.delete(name)

    let graphRemoved = false
    if (this.store) {
      graphRemoved = await deleteToolFromGraph(this.store, name)
    }

    return inMemoryRemoved || graphRemoved
  }

  /**
   * Clear all tools from the registry.
   */
  async clear(): Promise<void> {
    // Clear in-memory
    this.inMemoryTools.clear()

    // Note: We don't clear the graph store here as that would be destructive
    // If needed, caller should explicitly delete graph tools
  }

  /**
   * Get count of registered tools.
   */
  get size(): number {
    return this.inMemoryTools.size
  }
}

/**
 * Create a ToolThingRegistry instance.
 *
 * @param store - Optional graph store for persistence
 * @returns A new ToolThingRegistry
 *
 * @example
 * ```typescript
 * // In-memory only
 * const registry = createToolRegistry()
 *
 * // With graph persistence
 * const registry = createToolRegistry(graphStore)
 *
 * // Register tools
 * await registry.register(myTool)
 *
 * // Get a tool
 * const tool = await registry.get('myTool')
 * ```
 */
export function createToolThingRegistry(store?: GraphStore): ToolThingRegistry {
  return new ToolThingRegistry(store)
}

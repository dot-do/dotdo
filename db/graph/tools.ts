/**
 * Tool Graph Store
 *
 * CRUD operations for Tool Things in the graph model. Tools represent
 * callable capabilities that can be invoked by agents.
 *
 * @module db/graph/tools
 * @see dotdo-2hiae - Digital Tools Graph Integration
 *
 * Tools are stored as Things with:
 * - typeName: 'Tool'
 * - name: Unique tool identifier
 * - description: Human-readable description
 * - parameters: Array of input parameters
 * - category: Tool category for filtering
 * - securityLevel: 'public' | 'internal' | 'restricted' | 'critical'
 *
 * Invocation lifecycle verbs:
 * - invoke: Tool invocation requested
 * - invoking: Tool invocation in progress
 * - invoked: Tool invocation completed
 *
 * Provider relationships:
 * - Tool -[providedBy]-> Provider
 *
 * @example
 * ```typescript
 * import { ToolStore } from 'db/graph'
 *
 * const store = new ToolStore(db)
 *
 * // Create a tool
 * const tool = await store.createTool({
 *   name: 'searchNodes',
 *   description: 'Search for nodes in the graph',
 *   parameters: [
 *     { name: 'query', type: 'string', required: true },
 *     { name: 'limit', type: 'number', required: false },
 *   ],
 *   category: 'graph',
 *   securityLevel: 'internal',
 * })
 *
 * // Find tools by category
 * const graphTools = await store.findTools({ category: 'graph' })
 * ```
 */

import type { McpTool, McpToolInputSchema, ToolParameter, ToolThingData } from '../../types/mcp'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for Tool things (reserved for Tools in the graph schema) */
export const TOOL_TYPE_ID = 100

/** Type name for Tool things */
export const TOOL_TYPE_NAME = 'Tool'

/** Valid security levels */
const VALID_SECURITY_LEVELS = ['public', 'internal', 'restricted', 'critical'] as const

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Security level for tools - determines access restrictions
 */
export type ToolSecurityLevel = 'public' | 'internal' | 'restricted' | 'critical'

/**
 * Tool parameter definition stored in graph
 */
export interface ToolGraphParameter {
  name: string
  type: string
  description?: string
  required?: boolean
  schema?: Record<string, unknown>
}

/**
 * Tool data schema stored in Thing.data
 */
export interface ToolData {
  /** Tool name (unique identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Input parameters */
  parameters: ToolGraphParameter[]
  /** Tool category for filtering */
  category?: string
  /** Semantic version */
  version?: string
  /** Whether tool is destructive */
  destructive?: boolean
  /** Security level */
  securityLevel: ToolSecurityLevel
  /** Provider ID (foreign key to Provider Thing) */
  providerId?: string
  /** Handler reference for execution */
  handlerRef?: string
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Tool Thing - A Thing with Tool-specific data
 */
export interface ToolThing {
  id: string
  typeId: number
  typeName: 'Tool'
  data: ToolData
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

/**
 * Input for creating a new Tool
 */
export interface CreateToolInput {
  id?: string
  name: string
  description: string
  parameters?: ToolGraphParameter[]
  category?: string
  version?: string
  destructive?: boolean
  securityLevel?: ToolSecurityLevel
  providerId?: string
  handlerRef?: string
  metadata?: Record<string, unknown>
}

/**
 * Input for updating a Tool
 */
export interface UpdateToolInput {
  description?: string
  parameters?: ToolGraphParameter[]
  category?: string
  version?: string
  destructive?: boolean
  securityLevel?: ToolSecurityLevel
  handlerRef?: string
  metadata?: Record<string, unknown>
}

/**
 * Query options for finding tools
 */
export interface ToolQueryOptions {
  category?: string
  securityLevel?: ToolSecurityLevel
  providerId?: string
  namePrefix?: string
  limit?: number
  offset?: number
}

/**
 * Agent context for permission checking
 */
export interface AgentContext {
  type: 'internal' | 'external' | 'system'
  roles?: string[]
  permissions?: string[]
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
}

// ============================================================================
// IN-MEMORY STORE
// ============================================================================

/**
 * Per-instance stores for ToolStore instances.
 * Uses WeakMap to allow garbage collection of unused stores.
 */
const instanceStores = new WeakMap<object, Map<string, ToolThing>>()

/**
 * Check if an object is a plain empty object (used as mockDb in tests).
 */
function isEmptyPlainObject(obj: object): boolean {
  return Object.keys(obj).length === 0 && Object.getPrototypeOf(obj) === Object.prototype
}

/**
 * Get or create the in-memory store for a database object.
 */
function getStore(db: object): Map<string, ToolThing> {
  // For empty plain objects (mockDb = {}), use a fresh store per instance
  // to isolate test cases
  if (isEmptyPlainObject(db)) {
    let store = instanceStores.get(db)
    if (!store) {
      store = new Map()
      instanceStores.set(db, store)
    }
    return store
  }

  // For real database instances, use per-instance stores
  let store = instanceStores.get(db)
  if (!store) {
    store = new Map()
    instanceStores.set(db, store)
  }
  return store
}

// ============================================================================
// TOOLSTORE CLASS
// ============================================================================

/**
 * ToolStore provides CRUD operations for Tool Things.
 *
 * Tools are stored as graph Things with:
 * - typeName: 'Tool'
 * - data containing name, description, parameters, etc.
 *
 * @example
 * ```typescript
 * const store = new ToolStore(db)
 *
 * const tool = await store.createTool({
 *   name: 'file_write',
 *   description: 'Write content to a file',
 *   parameters: [{ name: 'path', type: 'string', required: true }],
 *   securityLevel: 'internal',
 * })
 * ```
 */
export class ToolStore {
  private db: object
  private store: Map<string, ToolThing>

  constructor(db: object) {
    this.db = db
    this.store = getStore(db)
  }

  // --------------------------------------------------------------------------
  // CREATE
  // --------------------------------------------------------------------------

  /**
   * Create a new Tool Thing.
   *
   * @param input - Tool creation input
   * @returns The created ToolThing
   * @throws Error if validation fails or name already exists
   */
  async createTool(input: CreateToolInput): Promise<ToolThing> {
    // Validate security level if provided
    if (input.securityLevel && !VALID_SECURITY_LEVELS.includes(input.securityLevel)) {
      throw new Error(
        `Invalid security level: ${input.securityLevel}. Must be one of: ${VALID_SECURITY_LEVELS.join(', ')}`
      )
    }

    // Generate ID from name if not provided
    const id = input.id ?? `tool:${input.name}`

    // Check for duplicate name
    const existingByName = await this.getToolByName(input.name)
    if (existingByName) {
      throw new Error(`Tool with name '${input.name}' already exists`)
    }

    // Check for duplicate ID
    if (this.store.has(id)) {
      throw new Error(`Tool with ID '${id}' already exists`)
    }

    const now = Date.now()

    const tool: ToolThing = {
      id,
      typeId: TOOL_TYPE_ID,
      typeName: 'Tool',
      data: {
        name: input.name,
        description: input.description,
        parameters: input.parameters ?? [],
        category: input.category,
        version: input.version,
        destructive: input.destructive ?? false,
        securityLevel: input.securityLevel ?? 'public',
        providerId: input.providerId,
        handlerRef: input.handlerRef,
        metadata: input.metadata,
      },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    this.store.set(id, tool)

    return tool
  }

  // --------------------------------------------------------------------------
  // READ
  // --------------------------------------------------------------------------

  /**
   * Get a Tool by ID.
   *
   * @param id - Tool ID to retrieve
   * @returns The ToolThing or null if not found
   */
  async getTool(id: string): Promise<ToolThing | null> {
    const tool = this.store.get(id)
    return tool ?? null
  }

  /**
   * Get a Tool by name.
   *
   * @param name - Tool name to retrieve
   * @returns The ToolThing or null if not found
   */
  async getToolByName(name: string): Promise<ToolThing | null> {
    for (const tool of this.store.values()) {
      if (tool.data.name === name && tool.deletedAt === null) {
        return tool
      }
    }
    return null
  }

  // --------------------------------------------------------------------------
  // UPDATE
  // --------------------------------------------------------------------------

  /**
   * Update a Tool's data.
   *
   * @param id - Tool ID to update
   * @param updates - Fields to update
   * @returns The updated ToolThing or null if not found
   */
  async updateTool(id: string, updates: UpdateToolInput): Promise<ToolThing | null> {
    const existing = this.store.get(id)
    if (!existing) {
      return null
    }

    // Validate security level if provided
    if (updates.securityLevel && !VALID_SECURITY_LEVELS.includes(updates.securityLevel)) {
      throw new Error(
        `Invalid security level: ${updates.securityLevel}. Must be one of: ${VALID_SECURITY_LEVELS.join(', ')}`
      )
    }

    const updatedTool: ToolThing = {
      ...existing,
      data: {
        ...existing.data,
        // Only update fields that are explicitly provided
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.parameters !== undefined && { parameters: updates.parameters }),
        ...(updates.category !== undefined && { category: updates.category }),
        ...(updates.version !== undefined && { version: updates.version }),
        ...(updates.destructive !== undefined && { destructive: updates.destructive }),
        ...(updates.securityLevel !== undefined && { securityLevel: updates.securityLevel }),
        ...(updates.handlerRef !== undefined && { handlerRef: updates.handlerRef }),
        ...(updates.metadata !== undefined && { metadata: updates.metadata }),
        // name is immutable - always preserve the original
        name: existing.data.name,
      },
      updatedAt: Date.now(),
    }

    this.store.set(id, updatedTool)

    return updatedTool
  }

  // --------------------------------------------------------------------------
  // DELETE
  // --------------------------------------------------------------------------

  /**
   * Soft delete a Tool by setting deletedAt timestamp.
   *
   * @param id - Tool ID to delete
   * @returns The deleted ToolThing or null if not found
   */
  async deleteTool(id: string): Promise<ToolThing | null> {
    const existing = this.store.get(id)
    if (!existing) {
      return null
    }

    const deletedTool: ToolThing = {
      ...existing,
      deletedAt: Date.now(),
    }

    this.store.set(id, deletedTool)

    return deletedTool
  }

  // --------------------------------------------------------------------------
  // QUERY
  // --------------------------------------------------------------------------

  /**
   * Find tools matching query criteria.
   *
   * @param options - Query options (category, securityLevel, providerId, namePrefix, limit, offset)
   * @returns Array of matching ToolThings
   */
  async findTools(options: ToolQueryOptions = {}): Promise<ToolThing[]> {
    let results = Array.from(this.store.values())

    // Exclude soft-deleted tools by default
    results = results.filter((t) => t.deletedAt === null)

    // Filter by category
    if (options.category) {
      results = results.filter((t) => t.data.category === options.category)
    }

    // Filter by security level
    if (options.securityLevel) {
      results = results.filter((t) => t.data.securityLevel === options.securityLevel)
    }

    // Filter by provider ID
    if (options.providerId) {
      results = results.filter((t) => t.data.providerId === options.providerId)
    }

    // Filter by name prefix
    if (options.namePrefix) {
      results = results.filter((t) => t.data.name.startsWith(options.namePrefix!))
    }

    // Apply offset
    if (options.offset !== undefined && options.offset > 0) {
      results = results.slice(options.offset)
    }

    // Apply limit
    if (options.limit !== undefined) {
      results = results.slice(0, options.limit)
    }

    return results
  }

  /**
   * List all tools (convenience method).
   *
   * @param options - Pagination options
   * @returns Array of ToolThings
   */
  async listTools(options?: { limit?: number; offset?: number }): Promise<ToolThing[]> {
    return this.findTools(options)
  }
}

// ============================================================================
// MCP FORMAT CONVERSION
// ============================================================================

/**
 * Convert a ToolThing to MCP tool format.
 *
 * @param toolThing - The ToolThing to convert
 * @returns MCP tool definition
 *
 * @example
 * ```typescript
 * const mcpTool = toolThingToMcp(toolThing)
 * // Returns: { name, description, inputSchema, annotations }
 * ```
 */
export function toolThingToMcp(toolThing: ToolThing): McpTool & { annotations?: Record<string, unknown> } {
  const { data } = toolThing

  // Build properties from parameters
  const properties: Record<string, { type: string; description?: string }> = {}
  const required: string[] = []

  for (const param of data.parameters) {
    properties[param.name] = {
      type: param.type,
      ...(param.description && { description: param.description }),
    }

    if (param.required) {
      required.push(param.name)
    }
  }

  // Build input schema
  const inputSchema: McpToolInputSchema = {
    type: 'object',
    properties,
    ...(required.length > 0 && { required }),
  }

  // Build annotations from metadata
  const annotations: Record<string, unknown> = {}
  if (data.category) annotations.category = data.category
  if (data.version) annotations.version = data.version
  if (data.destructive !== undefined) annotations.destructive = data.destructive
  if (data.securityLevel) annotations.securityLevel = data.securityLevel

  return {
    name: data.name,
    description: data.description,
    inputSchema,
    ...(Object.keys(annotations).length > 0 && { annotations }),
  }
}

/**
 * Convert an MCP tool to ToolThing data format.
 *
 * Useful for storing MCP tools in the graph.
 *
 * @param mcpTool - The MCP tool definition
 * @returns ToolData suitable for graph storage
 *
 * @example
 * ```typescript
 * const toolData = mcpToToolThing(mcpTool)
 * await store.createTool(toolData)
 * ```
 */
export function mcpToToolThing(
  mcpTool: McpTool & { annotations?: Record<string, unknown> }
): CreateToolInput {
  const inputSchema = mcpTool.inputSchema as McpToolInputSchema | undefined
  const properties = inputSchema?.properties || {}
  const requiredSet = new Set(inputSchema?.required || [])

  // Convert properties to parameters
  const parameters: ToolGraphParameter[] = Object.entries(properties).map(([name, prop]) => ({
    name,
    type: prop.type,
    ...(prop.description && { description: prop.description }),
    required: requiredSet.has(name),
  }))

  // Extract annotations
  const annotations = (mcpTool as { annotations?: Record<string, unknown> }).annotations || {}

  return {
    name: mcpTool.name,
    description: mcpTool.description,
    parameters,
    category: annotations.category as string | undefined,
    version: annotations.version as string | undefined,
    destructive: annotations.destructive as boolean | undefined,
    securityLevel: annotations.securityLevel as ToolSecurityLevel | undefined,
  }
}

// ============================================================================
// PERMISSION CHECKING
// ============================================================================

/**
 * Check if an agent can use a tool based on security level.
 *
 * Security policy:
 * - public: All agents can use
 * - internal: Internal and system agents can use
 * - restricted: Internal and system agents can use (external blocked)
 * - critical: Only system agents can use
 *
 * @param agent - Agent context with type
 * @param toolId - Tool ID to check
 * @param store - ToolStore instance
 * @returns Permission check result
 *
 * @example
 * ```typescript
 * const result = await canAgentUseTool(
 *   { type: 'internal' },
 *   'tool:shell_execute',
 *   store
 * )
 * if (!result.allowed) {
 *   console.log('Denied:', result.reason)
 * }
 * ```
 */
export async function canAgentUseTool(
  agent: AgentContext,
  toolId: string,
  store: ToolStore
): Promise<PermissionCheckResult> {
  const tool = await store.getTool(toolId)

  if (!tool) {
    return {
      allowed: false,
      reason: `Tool not found: ${toolId}`,
    }
  }

  const securityLevel = tool.data.securityLevel

  // Public tools are accessible to all
  if (securityLevel === 'public') {
    return { allowed: true }
  }

  // Internal tools: block external agents
  if (securityLevel === 'internal') {
    if (agent.type === 'external') {
      return {
        allowed: false,
        reason: `External agents cannot use internal tools`,
      }
    }
    return { allowed: true }
  }

  // Restricted tools: block external agents
  if (securityLevel === 'restricted') {
    if (agent.type === 'external') {
      return {
        allowed: false,
        reason: `External agents cannot use restricted tools`,
      }
    }
    return { allowed: true }
  }

  // Critical tools: only system agents
  if (securityLevel === 'critical') {
    if (agent.type !== 'system') {
      return {
        allowed: false,
        reason: `Only system agents can use critical tools`,
      }
    }
    return { allowed: true }
  }

  return { allowed: true }
}

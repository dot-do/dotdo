/**
 * MCP Tool Discovery Service
 *
 * Provides MCP-compatible tool discovery, registration, and invocation tracking.
 * Tools are stored as Things in the graph with MCP metadata.
 *
 * @module db/graph/mcp-tool-discovery
 * @see dotdo-2hiae - Digital Tools Graph Integration
 *
 * MCP Protocol:
 * - tools/list: List available tools (MCPTool[])
 * - tools/call: Execute a tool call (MCPToolCall -> MCPToolResult)
 *
 * Integration:
 * - Wraps GraphStore for graph persistence
 * - Provides MCPTool format conversion
 * - Tracks invocations as Relationships
 */

import type { GraphStore, GraphThing, GraphRelationship } from './types'
import type { GraphEngine, Node, Edge } from './graph-engine'

// ============================================================================
// MCP TYPES
// ============================================================================

/**
 * MCP Tool definition as per the Model Context Protocol
 */
export interface MCPTool {
  name: string
  description: string
  inputSchema: MCPInputSchema
  annotations?: MCPToolAnnotations
}

/**
 * JSON Schema for tool input
 */
export interface MCPInputSchema {
  type: 'object'
  properties: Record<string, MCPSchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

/**
 * JSON Schema property
 */
export interface MCPSchemaProperty {
  type: string
  description?: string
  enum?: unknown[]
  items?: MCPSchemaProperty
  properties?: Record<string, MCPSchemaProperty>
  required?: string[]
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

/**
 * MCP Tool annotations for categorization
 */
export interface MCPToolAnnotations {
  category?: string
  destructive?: boolean
  version?: string
  permissions?: string[]
  deprecated?: boolean | string
  [key: string]: unknown
}

/**
 * MCP Tool call request
 */
export interface MCPToolCall {
  name: string
  arguments: Record<string, unknown>
}

/**
 * MCP Tool call result
 */
export interface MCPToolResult {
  content: MCPContent[]
  isError?: boolean
}

/**
 * MCP Content block
 */
export interface MCPContent {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  mimeType?: string
  uri?: string
}

// ============================================================================
// DISCOVERY TYPES
// ============================================================================

/**
 * Tool discovery query options
 */
export interface ToolDiscoveryOptions {
  category?: string
  prefix?: string
  includeDeprecated?: boolean
  cursor?: string
  limit?: number
}

/**
 * Tool discovery result with pagination
 */
export interface ToolDiscoveryResult {
  tools: MCPTool[]
  nextCursor?: string
  totalCount?: number
}

/**
 * Tool registry interface
 */
export interface ToolRegistry {
  register(tool: MCPTool): Promise<void>
  unregister(name: string): Promise<boolean>
  list(options?: ToolDiscoveryOptions): Promise<ToolDiscoveryResult>
  get(name: string): Promise<MCPTool | null>
  has(name: string): Promise<boolean>
  clear(): Promise<void>
}

/**
 * Tool discovery service interface
 */
export interface ToolDiscoveryService {
  discoverTools(options?: ToolDiscoveryOptions): Promise<ToolDiscoveryResult>
  getToolSchema(name: string): Promise<MCPTool | null>
  validateInput(toolName: string, input: unknown): Promise<{ valid: boolean; errors?: string[] }>
  getToolMetadata(name: string): Promise<MCPToolAnnotations | null>
  listCategories(): Promise<string[]>
  refresh(): Promise<void>
}

// ============================================================================
// INVOCATION TRACKING TYPES
// ============================================================================

/**
 * Tool invocation record stored in relationship data
 */
export interface ToolInvocation {
  id: string
  agentId: string
  toolId: string
  input: Record<string, unknown>
  output?: unknown
  error?: string
  duration?: number
  cost?: number
  startedAt: number
  completedAt?: number
  status: 'pending' | 'running' | 'completed' | 'failed'
}

/**
 * Options for listing invocations
 */
export interface InvocationQueryOptions {
  agentId?: string
  toolId?: string
  status?: ToolInvocation['status']
  limit?: number
  offset?: number
  since?: number
  until?: number
}

// ============================================================================
// GRAPHTHING TO MCPTOOL CONVERSION
// ============================================================================

/**
 * Convert a GraphThing to MCP tool format.
 *
 * @param thing - GraphThing with tool data
 * @returns MCPTool format
 */
export function graphThingToMcpTool(thing: GraphThing): MCPTool {
  const data = thing.data ?? {}
  const parameters = (data.parameters as Array<{
    name: string
    type: string
    description?: string
    required?: boolean
    enum?: unknown[]
    properties?: Record<string, unknown>
    items?: unknown
  }>) ?? []

  // Build input schema from parameters
  const properties: Record<string, MCPSchemaProperty> = {}
  const required: string[] = []

  for (const param of parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
      enum: param.enum,
      properties: param.properties as Record<string, MCPSchemaProperty> | undefined,
      items: param.items as MCPSchemaProperty | undefined,
    }

    if (param.required) {
      required.push(param.name)
    }
  }

  // Build annotations from metadata
  const annotations: MCPToolAnnotations = {}
  if (data.category) annotations.category = data.category as string
  if (data.version) annotations.version = data.version as string
  if (data.destructive !== undefined) annotations.destructive = data.destructive as boolean
  if (data.deprecated !== undefined) annotations.deprecated = data.deprecated as boolean | string
  if (data.permissions) annotations.permissions = data.permissions as string[]
  if (data.requiredCapabilities) annotations.requiredCapabilities = data.requiredCapabilities as string[]

  return {
    name: (data.name as string) ?? thing.id,
    description: (data.description as string) ?? '',
    inputSchema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    },
    annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
  }
}

// ============================================================================
// MCP TOOL DISCOVERY SERVICE IMPLEMENTATION
// ============================================================================

/**
 * MCPToolDiscoveryService provides MCP-compatible tool discovery and management.
 *
 * Features:
 * - Discover tools from GraphStore
 * - Filter by category, prefix, deprecation status
 * - Validate tool inputs against schema
 * - Cache for performance
 *
 * @example
 * ```typescript
 * const discovery = createToolDiscoveryService(graphStore)
 *
 * // List all tools as MCP format
 * const result = await discovery.discoverTools()
 *
 * // Search by category
 * const comms = await discovery.discoverTools({ category: 'communication' })
 * ```
 */
export class MCPToolDiscoveryServiceImpl implements ToolDiscoveryService {
  private graphStore: GraphStore
  private cache: Map<string, MCPTool> = new Map()
  private cacheValid: boolean = false

  constructor(graphStore: GraphStore) {
    this.graphStore = graphStore
  }

  /**
   * Discover all available tools with optional filtering.
   */
  async discoverTools(options?: ToolDiscoveryOptions): Promise<ToolDiscoveryResult> {
    try {
      // Ensure cache is populated
      if (!this.cacheValid) {
        await this.refresh()
      }

      let tools = Array.from(this.cache.values())

      // Filter by category
      if (options?.category) {
        tools = tools.filter((t) => t.annotations?.category === options.category)
      }

      // Filter by prefix
      if (options?.prefix) {
        tools = tools.filter((t) =>
          t.name.toLowerCase().startsWith(options.prefix!.toLowerCase())
        )
      }

      // Exclude deprecated by default
      if (!options?.includeDeprecated) {
        tools = tools.filter((t) => !t.annotations?.deprecated)
      }

      const totalCount = tools.length

      // Apply pagination
      const limit = options?.limit ?? 100
      let startIndex = 0

      if (options?.cursor) {
        startIndex = parseInt(options.cursor, 10) || 0
      }

      const paginated = tools.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < tools.length
      const nextCursor = hasMore ? String(startIndex + limit) : undefined

      return {
        tools: paginated,
        totalCount,
        nextCursor,
      }
    } catch (error) {
      // Return empty on error
      return { tools: [], totalCount: 0 }
    }
  }

  /**
   * Get tool schema by name.
   */
  async getToolSchema(name: string): Promise<MCPTool | null> {
    if (!this.cacheValid) {
      await this.refresh()
    }

    // Find tool by name, returning latest version if multiple exist
    let latestTool: MCPTool | null = null
    let latestVersion = ''

    for (const tool of this.cache.values()) {
      if (tool.name === name) {
        const version = tool.annotations?.version ?? '0.0.0'
        if (!latestTool || version > latestVersion) {
          latestTool = tool
          latestVersion = version
        }
      }
    }

    return latestTool
  }

  /**
   * Validate tool input against schema.
   */
  async validateInput(
    toolName: string,
    input: unknown
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const tool = await this.getToolSchema(toolName)

    if (!tool) {
      return { valid: false, errors: [`Tool '${toolName}' not found`] }
    }

    const errors: string[] = []
    const inputObj = input as Record<string, unknown>

    // Check required fields
    if (tool.inputSchema.required) {
      for (const field of tool.inputSchema.required) {
        if (inputObj[field] === undefined) {
          errors.push(`Missing required field: ${field}`)
        }
      }
    }

    // Check field types
    for (const [field, value] of Object.entries(inputObj)) {
      const prop = tool.inputSchema.properties[field]
      if (prop) {
        const expectedType = prop.type
        const actualType = typeof value

        // Type validation
        if (expectedType === 'number' && actualType !== 'number') {
          errors.push(`Field '${field}' should be number, got ${actualType}`)
        } else if (expectedType === 'string' && actualType !== 'string') {
          errors.push(`Field '${field}' should be string, got ${actualType}`)
        } else if (expectedType === 'boolean' && actualType !== 'boolean') {
          errors.push(`Field '${field}' should be boolean, got ${actualType}`)
        } else if (expectedType === 'object' && (actualType !== 'object' || value === null)) {
          errors.push(`Field '${field}' should be object, got ${actualType}`)
        } else if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push(`Field '${field}' should be array, got ${actualType}`)
        }

        // Nested object validation
        if (expectedType === 'object' && prop.properties && value && typeof value === 'object') {
          const nestedRequired = prop.required ?? []
          for (const req of nestedRequired) {
            if ((value as Record<string, unknown>)[req] === undefined) {
              errors.push(`Missing required nested field: ${field}.${req}`)
            }
          }

          // Check nested types
          for (const [nestedField, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            const nestedProp = prop.properties[nestedField]
            if (nestedProp) {
              const nestedExpectedType = nestedProp.type
              const nestedActualType = typeof nestedValue
              if (nestedExpectedType === 'boolean' && nestedActualType !== 'boolean') {
                errors.push(`Field '${field}.${nestedField}' should be boolean, got ${nestedActualType}`)
              }
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Get tool metadata (annotations).
   */
  async getToolMetadata(name: string): Promise<MCPToolAnnotations | null> {
    const tool = await this.getToolSchema(name)
    return tool?.annotations ?? null
  }

  /**
   * List all available tool categories.
   */
  async listCategories(): Promise<string[]> {
    if (!this.cacheValid) {
      await this.refresh()
    }

    const categories = new Set<string>()
    for (const tool of this.cache.values()) {
      if (tool.annotations?.category) {
        categories.add(tool.annotations.category)
      }
    }

    return Array.from(categories)
  }

  /**
   * Refresh tool cache from graph store.
   */
  async refresh(): Promise<void> {
    this.cache.clear()

    try {
      const things = await this.graphStore.getThingsByType({ typeName: 'Tool' })

      for (const thing of things) {
        // Skip deleted things
        if (thing.deletedAt !== null) continue

        // Skip malformed things
        if (!thing.data) continue

        const data = thing.data
        if (!data.name) continue

        try {
          const mcpTool = graphThingToMcpTool(thing)
          // Store by ID to handle versioning
          this.cache.set(thing.id, mcpTool)
        } catch {
          // Skip malformed tools
        }
      }
    } catch {
      // Silently fail on store errors
    }

    this.cacheValid = true
  }
}

/**
 * Create a new MCPToolDiscoveryService instance.
 *
 * @param graphStore - The GraphStore to use for storage
 * @returns ToolDiscoveryService instance
 */
export function createToolDiscoveryService(graphStore: GraphStore): ToolDiscoveryService {
  return new MCPToolDiscoveryServiceImpl(graphStore)
}

// ============================================================================
// TOOL REGISTRY IMPLEMENTATION
// ============================================================================

/**
 * In-memory tool registry for dynamic tool registration.
 */
export class ToolRegistryImpl implements ToolRegistry {
  private tools: Map<string, MCPTool> = new Map()

  async register(tool: MCPTool): Promise<void> {
    // Validate tool has required fields
    if (!tool.name) {
      throw new Error('Tool name is required')
    }
    if (!tool.inputSchema) {
      throw new Error('Tool inputSchema is required')
    }
    if (tool.inputSchema.type !== 'object') {
      throw new Error('Tool inputSchema.type must be "object"')
    }

    this.tools.set(tool.name, tool)
  }

  async unregister(name: string): Promise<boolean> {
    return this.tools.delete(name)
  }

  async list(options?: ToolDiscoveryOptions): Promise<ToolDiscoveryResult> {
    let tools = Array.from(this.tools.values())

    // Filter by category
    if (options?.category) {
      tools = tools.filter((t) => t.annotations?.category === options.category)
    }

    // Filter by prefix
    if (options?.prefix) {
      tools = tools.filter((t) =>
        t.name.toLowerCase().startsWith(options.prefix!.toLowerCase())
      )
    }

    // Exclude deprecated by default
    if (!options?.includeDeprecated) {
      tools = tools.filter((t) => !t.annotations?.deprecated)
    }

    const totalCount = tools.length

    // Apply pagination
    const limit = options?.limit ?? 100
    let startIndex = 0

    if (options?.cursor) {
      startIndex = parseInt(options.cursor, 10) || 0
    }

    const paginated = tools.slice(startIndex, startIndex + limit)
    const hasMore = startIndex + limit < tools.length
    const nextCursor = hasMore ? String(startIndex + limit) : undefined

    return {
      tools: paginated,
      totalCount,
      nextCursor,
    }
  }

  async get(name: string): Promise<MCPTool | null> {
    return this.tools.get(name) ?? null
  }

  async has(name: string): Promise<boolean> {
    return this.tools.has(name)
  }

  async clear(): Promise<void> {
    this.tools.clear()
  }
}

/**
 * Create a new ToolRegistry instance.
 *
 * @returns ToolRegistry instance
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistryImpl()
}

// ============================================================================
// VERSION HELPERS
// ============================================================================

/**
 * Get tool schema by specific version.
 *
 * @param graphStore - GraphStore to query
 * @param name - Tool name
 * @param version - Specific version
 * @returns MCPTool for that version or null
 */
export async function getToolSchemaByVersion(
  graphStore: GraphStore,
  name: string,
  version: string
): Promise<MCPTool | null> {
  try {
    const things = await graphStore.getThingsByType({ typeName: 'Tool' })

    for (const thing of things) {
      if (thing.deletedAt !== null) continue
      if (!thing.data) continue

      const data = thing.data
      if (data.name === name && data.version === version) {
        return graphThingToMcpTool(thing)
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * List all versions of a tool.
 *
 * @param graphStore - GraphStore to query
 * @param name - Tool name
 * @returns Array of version strings
 */
export async function listToolVersions(
  graphStore: GraphStore,
  name: string
): Promise<string[]> {
  try {
    const things = await graphStore.getThingsByType({ typeName: 'Tool' })
    const versions: string[] = []

    for (const thing of things) {
      if (thing.deletedAt !== null) continue
      if (!thing.data) continue

      const data = thing.data
      if (data.name === name && data.version) {
        versions.push(data.version as string)
      }
    }

    return versions
  } catch {
    return []
  }
}

// ============================================================================
// CAPABILITY HELPERS
// ============================================================================

/**
 * Filter tools by client capabilities.
 *
 * @param tools - Array of MCPTool
 * @param capabilities - Client capabilities
 * @returns Filtered array of tools client can use
 */
export async function filterByCapabilities(
  tools: MCPTool[],
  capabilities: string[]
): Promise<MCPTool[]> {
  const capSet = new Set(capabilities)

  return tools.filter((tool) => {
    // Check for requiredCapabilities in the tool data
    // The test stores this in the Thing.data, which becomes annotations in MCPTool
    const annotations = tool.annotations as Record<string, unknown> | undefined

    // Look for requiredCapabilities which may be stored in annotations
    // or elsewhere in the tool metadata from the GraphThing conversion
    const required = annotations?.requiredCapabilities as string[] | undefined

    // If no capabilities required, tool is available to all
    if (!required || required.length === 0) {
      return true
    }

    // Check if client has all required capabilities
    return required.every((cap) => capSet.has(cap))
  })
}

// ============================================================================
// GRAPHENGINE-BASED SERVICE (for other usage)
// ============================================================================

/**
 * MCPToolDiscoveryService using GraphEngine (in-memory graph).
 * Alternative implementation for use with GraphEngine instead of GraphStore.
 */
export class GraphEngineMCPToolDiscoveryService {
  private graph: GraphEngine
  private invocationCounter: number = 0

  constructor(graph: GraphEngine) {
    this.graph = graph
  }

  async listTools(
    options?: { category?: string; subcategory?: string; audience?: 'agent' | 'human' | 'both' },
    limit: number = 100,
    offset: number = 0
  ): Promise<{ tools: MCPTool[]; totalCount: number; hasMore: boolean }> {
    const toolNodes = await this.graph.queryNodes({ label: 'Tool' })

    let filtered = toolNodes

    if (options) {
      filtered = toolNodes.filter((node) => {
        const props = node.properties

        if (options.category && props.category !== options.category) {
          return false
        }

        if (options.subcategory && props.subcategory !== options.subcategory) {
          return false
        }

        if (options.audience && props.audience !== 'both' && props.audience !== options.audience) {
          return false
        }

        return true
      })
    }

    const totalCount = filtered.length
    const paginated = filtered.slice(offset, offset + limit)

    const tools = paginated.map((node) => this.nodeToMcp(node))

    return {
      tools,
      totalCount,
      hasMore: offset + limit < totalCount,
    }
  }

  async getTool(toolId: string): Promise<MCPTool | null> {
    const node = await this.graph.getNode(toolId)
    if (!node || node.label !== 'Tool') {
      return null
    }
    return this.nodeToMcp(node)
  }

  async startInvocation(
    agentId: string,
    toolId: string,
    input: Record<string, unknown>
  ): Promise<ToolInvocation> {
    const invocationId = `inv-${++this.invocationCounter}-${Date.now().toString(36)}`
    const now = Date.now()

    const invocation: ToolInvocation = {
      id: invocationId,
      agentId,
      toolId,
      input,
      startedAt: now,
      status: 'running',
    }

    await this.graph.createEdge(agentId, 'invoking', toolId, {
      invocationId,
      input,
      startedAt: now,
      status: 'running',
    })

    return invocation
  }

  async completeInvocation(
    invocationId: string,
    result: { output?: unknown; error?: string; cost?: number }
  ): Promise<ToolInvocation | null> {
    const now = Date.now()
    const edges = await this.graph.queryEdges({ type: 'invoking' })
    const edge = edges.find((e) => e.properties?.invocationId === invocationId)

    if (!edge) {
      return null
    }

    const startedAt = edge.properties?.startedAt as number
    const duration = now - startedAt

    await this.graph.updateEdge(edge.id, {
      ...edge.properties,
      output: result.output,
      error: result.error,
      cost: result.cost,
      duration,
      completedAt: now,
      status: result.error ? 'failed' : 'completed',
    })

    return {
      id: invocationId,
      agentId: edge.from,
      toolId: edge.to,
      input: edge.properties?.input as Record<string, unknown>,
      output: result.output,
      error: result.error,
      duration,
      cost: result.cost,
      startedAt,
      completedAt: now,
      status: result.error ? 'failed' : 'completed',
    }
  }

  private nodeToMcp(node: Node): MCPTool {
    const props = node.properties

    return {
      name: (props.id as string) ?? node.id,
      description: (props.description as string) ?? '',
      inputSchema: {
        type: 'object',
        properties: this.parametersToSchema(props.parameters as Array<{
          name: string
          type: string
          description?: string
          required?: boolean
        }> ?? []),
        required: props.required as string[] ?? [],
      },
    }
  }

  private parametersToSchema(
    parameters: Array<{ name: string; type: string; description?: string }>
  ): Record<string, MCPSchemaProperty> {
    const properties: Record<string, MCPSchemaProperty> = {}

    for (const param of parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
      }
    }

    return properties
  }
}

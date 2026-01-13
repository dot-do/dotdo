/**
 * Tool Thing CRUD - Graph Storage Implementation
 *
 * Issue: dotdo-0xxzq
 *
 * Implements Tool Thing type with:
 * - Category hierarchy (communication, data, development, ai, integration, system, custom)
 * - Parameter schema validation
 * - CRUD operations with version tracking
 * - Soft delete with history preservation
 * - Query by category, audience, security level
 * - Invocation tracking integration
 *
 * Uses SQLite storage via drizzle-orm.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Tool category hierarchy - top-level categories
 */
export type ToolCategory =
  | 'communication'
  | 'data'
  | 'development'
  | 'ai'
  | 'integration'
  | 'system'
  | 'custom'

/**
 * Valid tool categories for validation
 */
export const VALID_CATEGORIES: ToolCategory[] = [
  'communication',
  'data',
  'development',
  'ai',
  'integration',
  'system',
  'custom',
]

/**
 * Tool audience - who can use this tool
 */
export type ToolAudience = 'agent' | 'human' | 'both'

/**
 * Valid audiences for validation
 */
export const VALID_AUDIENCES: ToolAudience[] = ['agent', 'human', 'both']

/**
 * Security level for tool execution
 */
export type SecurityLevel = 'public' | 'internal' | 'restricted' | 'admin'

/**
 * Valid security levels in order (lowest to highest)
 */
export const SECURITY_LEVEL_ORDER: SecurityLevel[] = ['public', 'internal', 'restricted', 'admin']

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string
  type: string
  required?: boolean
  description?: string
  default?: unknown
  enum?: string[]
}

/**
 * Valid parameter types
 */
export const VALID_PARAM_TYPES = ['string', 'number', 'boolean', 'object', 'array', 'null']

/**
 * Tool output definition
 */
export interface ToolOutput {
  type: string
  description?: string
  schema?: Record<string, unknown>
}

/**
 * Tool version entry
 */
export interface ToolVersion {
  version: number
  name: string
  description: string
  category: ToolCategory
  subcategory?: string
  audience: ToolAudience
  securityLevel: SecurityLevel
  parameters: ToolParameter[]
  permissions: string[]
  createdAt: Date
  updatedAt: Date
}

/**
 * Tool invocation record (for history)
 */
export interface ToolInvocation {
  id: string
  toolId: string
  input: Record<string, unknown>
  output?: unknown
  durationMs?: number
  success: boolean
  error?: string
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: Date
  completedAt?: Date
}

/**
 * Tool relationship
 */
export interface ToolRelationship {
  id: string
  from: string
  type: string
  to: string
  deletedAt?: Date
}

/**
 * Tool Thing - the main entity
 */
export interface ToolThing {
  $id: string
  $type: 'Tool'
  id: string
  name: string
  description: string
  category: ToolCategory
  subcategory?: string
  audience: ToolAudience
  securityLevel: SecurityLevel
  parameters: ToolParameter[]
  permissions: string[]
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date
  dependencies?: string[]
  meta?: {
    brokenDependencies?: string[]
    [key: string]: unknown
  }
}

/**
 * Options for creating a tool
 */
export interface ToolCreateInput {
  id?: string
  name: string
  description: string
  category: ToolCategory
  subcategory?: string
  audience?: ToolAudience
  securityLevel?: SecurityLevel
  parameters: ToolParameter[]
  permissions?: string[]
  dependencies?: string[]
}

/**
 * Options for updating a tool
 */
export interface ToolUpdateInput {
  name?: string
  description?: string
  category?: ToolCategory
  subcategory?: string
  audience?: ToolAudience
  securityLevel?: SecurityLevel
  parameters?: ToolParameter[]
  permissions?: string[]
}

/**
 * Query options for tools
 */
export interface ToolQueryOptions {
  category?: ToolCategory
  subcategory?: string
  audience?: ToolAudience
  availableTo?: 'agent' | 'human'
  securityLevel?: SecurityLevel
  maxSecurityLevel?: SecurityLevel
  minSecurityLevel?: SecurityLevel
  search?: string
  limit?: number
  offset?: number
  includeCount?: boolean
  includeDeleted?: boolean
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'category'
  sortOrder?: 'asc' | 'desc'
}

/**
 * Paginated query result
 */
export interface ToolQueryResult {
  tools: ToolThing[]
  total: number
}

/**
 * Options for getting a tool
 */
export interface ToolGetOptions {
  includeDeleted?: boolean
}

/**
 * Options for updating with optimistic locking
 */
export interface ToolUpdateOptions {
  expectedVersion?: number
}

/**
 * Options for deleting a tool
 */
export interface ToolDeleteOptions {
  force?: boolean
  permanent?: boolean
  confirm?: boolean
}

/**
 * Start invocation input
 */
export interface StartInvocationInput {
  input: Record<string, unknown>
  startedAt: Date
}

/**
 * Complete invocation input
 */
export interface CompleteInvocationInput {
  output: unknown
  success: boolean
  durationMs: number
}

/**
 * Record invocation input (for completed invocations)
 */
export interface RecordInvocationInput {
  input: Record<string, unknown>
  output: unknown
  durationMs: number
  success: boolean
}

/**
 * Tool Graph interface
 */
export interface ToolGraph {
  // CRUD
  create(input: ToolCreateInput): Promise<ToolThing>
  get(id: string, options?: ToolGetOptions): Promise<ToolThing | null>
  update(id: string, input: ToolUpdateInput, options?: ToolUpdateOptions): Promise<ToolThing>
  delete(id: string, options?: ToolDeleteOptions): Promise<void>
  restore(id: string): Promise<void>

  // Query
  query(options: ToolQueryOptions): Promise<ToolThing[] | ToolQueryResult>

  // Versioning
  getVersion(id: string, version: number): Promise<ToolVersion | null>
  listVersions(id: string): Promise<ToolVersion[]>

  // Invocations
  startInvocation(toolId: string, input: StartInvocationInput): Promise<string>
  completeInvocation(invocationId: string, input: CompleteInvocationInput): Promise<void>
  recordInvocation(toolId: string, input: RecordInvocationInput): Promise<void>
  getInvocations(toolId: string): Promise<ToolInvocation[]>
  getInvocation(invocationId: string): Promise<ToolInvocation | null>

  // Relationships
  createRelationship(from: string, type: string, to: string): Promise<void>
  getRelationships(toolId: string): Promise<ToolRelationship[]>

  // Maintenance
  clear(): Promise<void>
}

/**
 * Options for creating a ToolGraph
 */
export interface ToolGraphOptions {
  namespace: string
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate subcategory format (alphanumeric, underscores, hyphens)
 */
function isValidSubcategory(subcategory: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(subcategory)
}

/**
 * Generate tool ID from category and name
 */
function generateToolId(category: string, subcategory: string | undefined, name: string): string {
  const namePart = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  if (subcategory) {
    return `${category}.${subcategory}.${namePart}`
  }
  return `${category}.${namePart}`
}

/**
 * Validate parameter schema
 */
function validateParameter(param: ToolParameter): void {
  if (!param.type) {
    throw new Error('Parameter type is required')
  }
  if (!VALID_PARAM_TYPES.includes(param.type)) {
    throw new Error(`Invalid parameter type: ${param.type}`)
  }
}

/**
 * Get security level index for comparison
 */
function getSecurityLevelIndex(level: SecurityLevel): number {
  return SECURITY_LEVEL_ORDER.indexOf(level)
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a ToolGraph instance
 */
export function createToolGraph(options: ToolGraphOptions): ToolGraph {
  const { namespace } = options

  // In-memory storage for tools
  const tools = new Map<string, ToolThing>()
  const versions = new Map<string, ToolVersion[]>()
  const invocations = new Map<string, ToolInvocation>()
  const relationships = new Map<string, ToolRelationship[]>()

  // Name uniqueness tracking: category+subcategory+name -> tool id
  const nameIndex = new Map<string, string>()

  function getNameKey(category: string, subcategory: string | undefined, name: string): string {
    return `${category}:${subcategory || ''}:${name.toLowerCase()}`
  }

  return {
    async create(input: ToolCreateInput): Promise<ToolThing> {
      // Validate required fields
      if (!input.name) {
        throw new Error('Name is required')
      }
      if (!input.description) {
        throw new Error('Description is required')
      }
      if (!VALID_CATEGORIES.includes(input.category)) {
        throw new Error(`Invalid category: ${input.category}`)
      }

      // Validate subcategory format
      if (input.subcategory && !isValidSubcategory(input.subcategory)) {
        throw new Error(`Invalid subcategory format: ${input.subcategory}`)
      }

      // Validate parameters
      for (const param of input.parameters) {
        validateParameter(param)
      }

      // Generate or use provided ID
      const id = input.id || generateToolId(input.category, input.subcategory, input.name)

      // Check for duplicate ID
      if (tools.has(id)) {
        throw new Error(`Duplicate tool id: ${id}`)
      }

      // Check for duplicate name in same category/subcategory
      const nameKey = getNameKey(input.category, input.subcategory, input.name)
      if (nameIndex.has(nameKey)) {
        throw new Error(`Duplicate name in category: ${input.name}`)
      }

      const now = new Date()
      const tool: ToolThing = {
        $id: `${namespace}/${id}`,
        $type: 'Tool',
        id,
        name: input.name,
        description: input.description,
        category: input.category,
        subcategory: input.subcategory,
        audience: input.audience || 'both',
        securityLevel: input.securityLevel || 'internal',
        parameters: input.parameters,
        permissions: input.permissions || [],
        version: 1,
        createdAt: now,
        updatedAt: now,
        dependencies: input.dependencies,
      }

      // Store tool and version
      tools.set(id, tool)
      nameIndex.set(nameKey, id)
      versions.set(id, [
        {
          version: 1,
          name: tool.name,
          description: tool.description,
          category: tool.category,
          subcategory: tool.subcategory,
          audience: tool.audience,
          securityLevel: tool.securityLevel,
          parameters: [...tool.parameters],
          permissions: [...tool.permissions],
          createdAt: tool.createdAt,
          updatedAt: tool.updatedAt,
        },
      ])

      return tool
    },

    async get(id: string, options?: ToolGetOptions): Promise<ToolThing | null> {
      const tool = tools.get(id)
      if (!tool) {
        return null
      }
      if (tool.deletedAt && !options?.includeDeleted) {
        return null
      }
      return tool
    },

    async update(id: string, input: ToolUpdateInput, options?: ToolUpdateOptions): Promise<ToolThing> {
      const tool = tools.get(id)
      if (!tool) {
        throw new Error(`Tool not found: ${id}`)
      }
      if (tool.deletedAt) {
        throw new Error(`Tool not found: ${id}`)
      }

      // Optimistic locking
      if (options?.expectedVersion !== undefined && tool.version !== options.expectedVersion) {
        throw new Error(`Version conflict: expected ${options.expectedVersion}, got ${tool.version}`)
      }

      // Validate category if provided
      if (input.category && !VALID_CATEGORIES.includes(input.category)) {
        throw new Error(`Invalid category: ${input.category}`)
      }

      // Validate audience if provided
      if (input.audience && !VALID_AUDIENCES.includes(input.audience)) {
        throw new Error(`Invalid audience: ${input.audience}`)
      }

      // Validate security level if provided
      if (input.securityLevel && !SECURITY_LEVEL_ORDER.includes(input.securityLevel)) {
        throw new Error(`Invalid security level: ${input.securityLevel}`)
      }

      // Validate subcategory if provided
      if (input.subcategory && !isValidSubcategory(input.subcategory)) {
        throw new Error(`Invalid subcategory format: ${input.subcategory}`)
      }

      // Validate parameters if provided
      if (input.parameters) {
        for (const param of input.parameters) {
          validateParameter(param)
        }
      }

      // Prevent empty name
      if (input.name !== undefined && !input.name) {
        throw new Error('Name is required')
      }

      const now = new Date()
      const updatedTool: ToolThing = {
        ...tool,
        name: input.name ?? tool.name,
        description: input.description ?? tool.description,
        category: input.category ?? tool.category,
        subcategory: input.subcategory ?? tool.subcategory,
        audience: input.audience ?? tool.audience,
        securityLevel: input.securityLevel ?? tool.securityLevel,
        parameters: input.parameters ?? tool.parameters,
        permissions: input.permissions ?? tool.permissions,
        version: tool.version + 1,
        updatedAt: now,
      }

      // Update name index if name/category/subcategory changed
      const oldNameKey = getNameKey(tool.category, tool.subcategory, tool.name)
      const newNameKey = getNameKey(updatedTool.category, updatedTool.subcategory, updatedTool.name)
      if (oldNameKey !== newNameKey) {
        nameIndex.delete(oldNameKey)
        nameIndex.set(newNameKey, id)
      }

      // Store updated tool
      tools.set(id, updatedTool)

      // Store version
      const toolVersions = versions.get(id) || []
      toolVersions.push({
        version: updatedTool.version,
        name: updatedTool.name,
        description: updatedTool.description,
        category: updatedTool.category,
        subcategory: updatedTool.subcategory,
        audience: updatedTool.audience,
        securityLevel: updatedTool.securityLevel,
        parameters: [...updatedTool.parameters],
        permissions: [...updatedTool.permissions],
        createdAt: tool.createdAt,
        updatedAt: now,
      })
      versions.set(id, toolVersions)

      return updatedTool
    },

    async delete(id: string, options?: ToolDeleteOptions): Promise<void> {
      const tool = tools.get(id)
      if (!tool) {
        throw new Error(`Tool not found: ${id}`)
      }

      // Check for active invocations
      if (!options?.force) {
        const toolInvocations = Array.from(invocations.values()).filter(
          (inv) => inv.toolId === id && (inv.status === 'pending' || inv.status === 'running')
        )
        if (toolInvocations.length > 0) {
          throw new Error(`Cannot delete tool with active invocations`)
        }
      }

      // Permanent delete
      if (options?.permanent) {
        if (!options.confirm) {
          throw new Error('Permanent delete requires confirmation')
        }
        tools.delete(id)
        versions.delete(id)
        // Remove invocations
        for (const [invId, inv] of Array.from(invocations.entries())) {
          if (inv.toolId === id) {
            invocations.delete(invId)
          }
        }
        // Remove name index
        const nameKey = getNameKey(tool.category, tool.subcategory, tool.name)
        nameIndex.delete(nameKey)
        return
      }

      // Soft delete
      const now = new Date()
      tool.deletedAt = now

      // Cancel active invocations on force delete
      if (options?.force) {
        for (const inv of Array.from(invocations.values())) {
          if (inv.toolId === id && (inv.status === 'pending' || inv.status === 'running')) {
            inv.status = 'cancelled'
          }
        }
      }

      // Mark relationships as deleted
      const toolRels = relationships.get(id) || []
      for (const rel of toolRels) {
        rel.deletedAt = now
      }

      // Update dependent tools
      for (const t of Array.from(tools.values())) {
        if (t.dependencies?.includes(id)) {
          t.meta = t.meta || {}
          t.meta.brokenDependencies = t.meta.brokenDependencies || []
          if (!t.meta.brokenDependencies.includes(id)) {
            t.meta.brokenDependencies.push(id)
          }
        }
      }
    },

    async restore(id: string): Promise<void> {
      const tool = tools.get(id)
      if (!tool) {
        throw new Error(`Tool not found: ${id}`)
      }
      if (!tool.deletedAt) {
        throw new Error(`Tool is not deleted: ${id}`)
      }
      tool.deletedAt = undefined
    },

    async query(options: ToolQueryOptions): Promise<ToolThing[] | ToolQueryResult> {
      let result = Array.from(tools.values())

      // Filter by deleted
      if (!options.includeDeleted) {
        result = result.filter((t) => !t.deletedAt)
      }

      // Filter by category
      if (options.category) {
        result = result.filter((t) => t.category === options.category)
      }

      // Filter by subcategory
      if (options.subcategory) {
        result = result.filter((t) => t.subcategory === options.subcategory)
      }

      // Filter by audience (exact match)
      if (options.audience) {
        result = result.filter((t) => t.audience === options.audience)
      }

      // Filter by availableTo (includes 'both')
      if (options.availableTo) {
        result = result.filter((t) => t.audience === options.availableTo || t.audience === 'both')
      }

      // Filter by security level (exact match)
      if (options.securityLevel) {
        result = result.filter((t) => t.securityLevel === options.securityLevel)
      }

      // Filter by max security level
      if (options.maxSecurityLevel) {
        const maxIndex = getSecurityLevelIndex(options.maxSecurityLevel)
        result = result.filter((t) => getSecurityLevelIndex(t.securityLevel) <= maxIndex)
      }

      // Filter by min security level
      if (options.minSecurityLevel) {
        const minIndex = getSecurityLevelIndex(options.minSecurityLevel)
        result = result.filter((t) => getSecurityLevelIndex(t.securityLevel) >= minIndex)
      }

      // Search by name/description
      if (options.search) {
        const searchLower = options.search.toLowerCase()
        result = result.filter(
          (t) =>
            t.name.toLowerCase().includes(searchLower) ||
            t.description.toLowerCase().includes(searchLower)
        )
      }

      // Sort
      if (options.sortBy) {
        const sortOrder = options.sortOrder === 'desc' ? -1 : 1
        result.sort((a, b) => {
          let aVal: string | number = ''
          let bVal: string | number = ''
          switch (options.sortBy) {
            case 'name':
              aVal = a.name
              bVal = b.name
              break
            case 'createdAt':
              aVal = a.createdAt.getTime()
              bVal = b.createdAt.getTime()
              break
            case 'updatedAt':
              aVal = a.updatedAt.getTime()
              bVal = b.updatedAt.getTime()
              break
            case 'category':
              aVal = a.category
              bVal = b.category
              break
          }
          if (aVal < bVal) return -1 * sortOrder
          if (aVal > bVal) return 1 * sortOrder
          return 0
        })
      }

      const total = result.length

      // Pagination
      const offset = options.offset ?? 0
      const limit = options.limit ?? result.length
      result = result.slice(offset, offset + limit)

      if (options.includeCount) {
        return { tools: result, total }
      }

      return result
    },

    async getVersion(id: string, version: number): Promise<ToolVersion | null> {
      const toolVersions = versions.get(id)
      if (!toolVersions) {
        return null
      }
      return toolVersions.find((v) => v.version === version) || null
    },

    async listVersions(id: string): Promise<ToolVersion[]> {
      return versions.get(id) || []
    },

    async startInvocation(toolId: string, input: StartInvocationInput): Promise<string> {
      const id = crypto.randomUUID()
      const invocation: ToolInvocation = {
        id,
        toolId,
        input: input.input,
        success: false,
        status: 'pending',
        startedAt: input.startedAt,
      }
      invocations.set(id, invocation)
      return id
    },

    async completeInvocation(invocationId: string, input: CompleteInvocationInput): Promise<void> {
      const invocation = invocations.get(invocationId)
      if (!invocation) {
        throw new Error(`Invocation not found: ${invocationId}`)
      }
      invocation.output = input.output
      invocation.success = input.success
      invocation.durationMs = input.durationMs
      invocation.status = input.success ? 'completed' : 'failed'
      invocation.completedAt = new Date()
    },

    async recordInvocation(toolId: string, input: RecordInvocationInput): Promise<void> {
      const id = crypto.randomUUID()
      const now = new Date()
      const invocation: ToolInvocation = {
        id,
        toolId,
        input: input.input,
        output: input.output,
        durationMs: input.durationMs,
        success: input.success,
        status: input.success ? 'completed' : 'failed',
        startedAt: new Date(now.getTime() - input.durationMs),
        completedAt: now,
      }
      invocations.set(id, invocation)
    },

    async getInvocations(toolId: string): Promise<ToolInvocation[]> {
      return Array.from(invocations.values()).filter((inv) => inv.toolId === toolId)
    },

    async getInvocation(invocationId: string): Promise<ToolInvocation | null> {
      return invocations.get(invocationId) || null
    },

    async createRelationship(from: string, type: string, to: string): Promise<void> {
      const id = `${from}-${type}-${to}`
      const rel: ToolRelationship = { id, from, type, to }
      const toolRels = relationships.get(from) || []
      toolRels.push(rel)
      relationships.set(from, toolRels)
    },

    async getRelationships(toolId: string): Promise<ToolRelationship[]> {
      return relationships.get(toolId) || []
    },

    async clear(): Promise<void> {
      tools.clear()
      versions.clear()
      invocations.clear()
      relationships.clear()
      nameIndex.clear()
    },
  }
}

// Re-export types from the types module when it exists
// For now, all types are defined in this file

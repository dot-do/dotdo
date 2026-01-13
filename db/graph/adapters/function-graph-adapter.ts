/**
 * FunctionGraphAdapter - Functions as Graph Things with cascade chain resolution
 *
 * GREEN PHASE: Implements cascade chain resolution using graph relationships
 *
 * @see dotdo-mvzvj - [GREEN] Cascade Chain Graph Resolution
 * @see dotdo-8pjkw - [GREEN] FunctionGraphAdapter - Core Implementation
 *
 * Design:
 * - Functions are Things with type='Function' and data containing handler, type, etc.
 * - Cascade chains use 'cascadesTo' relationships with priority and optional conditions
 * - Chain resolution traverses the graph, handling cycles via visited set
 * - Priority ordering determines fallback order when multiple cascades exist
 * - Versioning via FunctionVersion Things with parent relationships
 * - Ownership via 'ownedBy' and 'implements' relationships
 *
 * Thing Types:
 * - CodeFunction (typeId: 100)
 * - GenerativeFunction (typeId: 101)
 * - AgenticFunction (typeId: 102)
 * - HumanFunction (typeId: 103)
 * - FunctionVersion (typeId: 110)
 * - FunctionRef (typeId: 111)
 * - FunctionBlob (typeId: 112)
 *
 * Relationships:
 * - Function `cascadesTo` Function (fallback chain with priority)
 * - FunctionVersion `versionOf` Function (versioning relationships)
 * - FunctionVersion `parent` FunctionVersion (version history chain)
 * - FunctionVersion `hasContent` FunctionBlob (code content reference)
 * - Function `ownedBy` Org (ownership)
 * - Function `implements` Interface (interface implementation)
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../types'
import { createHash } from 'crypto'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Function types matching CascadeExecutor
 */
export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

/**
 * Function Thing data structure
 */
export interface FunctionData {
  name: string
  type: FunctionType
  description?: string
  handler?: string
  config?: Record<string, unknown>
  version?: string
  enabled?: boolean
}

/**
 * Cascade relationship data
 */
export interface CascadeRelationshipData {
  /** Priority for ordering (lower = higher priority, executed first) */
  priority: number
  /** Optional condition for when to follow this cascade */
  condition?: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for creating a cascade relationship
 */
export interface CreateCascadeOptions {
  priority?: number
  condition?: string
  metadata?: Record<string, unknown>
}

/**
 * Cascade chain entry with relationship data
 */
export interface CascadeChainEntry {
  /** The function Thing */
  function: GraphThing
  /** The relationship that led to this function (null for first entry) */
  relationship: GraphRelationship | null
  /** Depth in the chain (0-indexed) */
  depth: number
}

/**
 * Options for cascade chain resolution
 */
export interface GetCascadeChainOptions {
  /** Maximum chain depth to traverse */
  maxDepth?: number
  /** Only follow cascades matching this condition */
  condition?: string
  /** Include disabled functions in the chain */
  includeDisabled?: boolean
}

/**
 * FunctionVersion Thing data structure (like a git commit)
 */
export interface FunctionVersionData {
  /** Content-addressable hash */
  sha: string
  /** Version message (like commit message) */
  message: string
  /** Author information */
  author: {
    name: string
    email: string
    timestamp: number
  }
  /** Reference to parent Function ID */
  functionId: string
  /** Previous version SHA (null for initial version) */
  parentSha?: string
}

/**
 * FunctionBlob Thing data structure (like a git blob)
 */
export interface FunctionBlobData {
  /** Size of content in bytes */
  size: number
  /** External storage reference (e.g., 'r2:functions/sha256-abc') */
  contentRef: string
  /** MIME type ('text/typescript', 'application/javascript', etc.) */
  contentType: string
  /** SHA-256 hash of content */
  hash: string
}

/**
 * Options for creating a function version
 */
export interface CreateVersionOptions {
  /** Function ID to create version for */
  functionId: string
  /** Code content (string or binary) */
  content: string | Uint8Array
  /** Version message */
  message: string
  /** Optional author (defaults to 'system') */
  author?: { name: string; email: string }
  /** Parent version SHA (for version chain) */
  parentSha?: string
}

/**
 * Configuration for cascade relationships
 */
export interface CascadeConfig {
  /** Priority for ordering (lower = higher priority) */
  priority?: number
  /** Optional condition expression */
  condition?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

// ============================================================================
// TYPE IDS (constants for graph things)
// ============================================================================

/**
 * Type IDs for Function-related graph things
 *
 * Convention:
 * - CodeFunction: 100
 * - GenerativeFunction: 101
 * - AgenticFunction: 102
 * - HumanFunction: 103
 * - FunctionVersion: 110
 * - FunctionRef: 111
 * - FunctionBlob: 112
 */
export const TYPE_IDS = {
  // Function types by kind
  CodeFunction: 100,
  GenerativeFunction: 101,
  AgenticFunction: 102,
  HumanFunction: 103,
  // Legacy: generic Function type (uses kind-specific ID at runtime)
  Function: 100,
  // Versioning types
  FunctionVersion: 110,
  FunctionRef: 111,
  FunctionBlob: 112,
} as const

/**
 * Map function type string to typeId
 */
function getTypeIdForFunctionType(type: FunctionType): number {
  switch (type) {
    case 'code':
      return TYPE_IDS.CodeFunction
    case 'generative':
      return TYPE_IDS.GenerativeFunction
    case 'agentic':
      return TYPE_IDS.AgenticFunction
    case 'human':
      return TYPE_IDS.HumanFunction
    default:
      return TYPE_IDS.CodeFunction
  }
}

/**
 * Map typeId to function type name
 */
function getTypeNameForTypeId(typeId: number): string {
  switch (typeId) {
    case TYPE_IDS.CodeFunction:
      return 'CodeFunction'
    case TYPE_IDS.GenerativeFunction:
      return 'GenerativeFunction'
    case TYPE_IDS.AgenticFunction:
      return 'AgenticFunction'
    case TYPE_IDS.HumanFunction:
      return 'HumanFunction'
    default:
      return 'Function'
  }
}

// ============================================================================
// URL BUILDERS
// ============================================================================

function functionUrl(id: string): string {
  return `do://functions/${id}`
}

function versionUrl(sha: string): string {
  return `do://functions/versions/${sha}`
}

function blobUrl(hash: string): string {
  return `do://functions/blobs/${hash}`
}

function orgUrl(id: string): string {
  return `do://orgs/${id}`
}

function interfaceUrl(id: string): string {
  return `do://interfaces/${id}`
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique ID for functions
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `fn-${timestamp}-${random}`
}

/**
 * Extract the ID from a function URL (do://functions/abc -> abc)
 */
function extractIdFromUrl(url: string): string | null {
  const match = url.match(/do:\/\/functions\/(.+)$/)
  return match?.[1] ?? null
}

/**
 * Valid function type names for type checking
 */
const FUNCTION_TYPE_NAMES = [
  'Function',
  'CodeFunction',
  'GenerativeFunction',
  'AgenticFunction',
  'HumanFunction',
] as const

/**
 * Check if a typeName represents a function type
 */
function isFunctionTypeName(typeName: string): boolean {
  return FUNCTION_TYPE_NAMES.includes(typeName as typeof FUNCTION_TYPE_NAMES[number])
}

/**
 * Extract SHA from a version URL (do://functions/versions/abc -> abc)
 */
function extractShaFromVersionUrl(url: string): string | null {
  const match = url.match(/do:\/\/functions\/versions\/(.+)$/)
  return match?.[1] ?? null
}

/**
 * Generate a content-addressable hash from content
 */
function hashContent(content: Uint8Array | string): string {
  const data = typeof content === 'string' ? Buffer.from(content) : content
  return createHash('sha256').update(data).digest('hex').substring(0, 40)
}

/**
 * Get content size in bytes
 */
function getContentSize(content: Uint8Array | string): number {
  if (typeof content === 'string') {
    return Buffer.byteLength(content, 'utf8')
  }
  return content.length
}

/**
 * Default author identity
 */
function defaultAuthor(): { name: string; email: string; timestamp: number } {
  return {
    name: 'system',
    email: 'system@dotdo.dev',
    timestamp: Date.now(),
  }
}

// ============================================================================
// FUNCTIONGRAPHADAPTER CLASS
// ============================================================================

/**
 * FunctionGraphAdapter bridges Functions with GraphStore and provides
 * cascade chain resolution.
 *
 * @example
 * ```typescript
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 *
 * const adapter = new FunctionGraphAdapter(store)
 *
 * // Create functions
 * const codeHandler = await adapter.createFunction({
 *   name: 'calculate',
 *   type: 'code',
 *   handler: 'handlers/calculate.ts'
 * })
 *
 * const aiHandler = await adapter.createFunction({
 *   name: 'calculate-ai',
 *   type: 'generative',
 *   handler: 'ai/calculate'
 * })
 *
 * // Create cascade relationship
 * await adapter.addCascade(codeHandler.id, aiHandler.id, { priority: 0 })
 *
 * // Resolve cascade chain
 * const chain = await adapter.getCascadeChain(codeHandler.id)
 * // Returns: [codeHandler, aiHandler]
 * ```
 */
export class FunctionGraphAdapter {
  private store: GraphStore

  constructor(store: GraphStore) {
    this.store = store
  }

  // ==========================================================================
  // FUNCTION OPERATIONS
  // ==========================================================================

  /**
   * Create a Function Thing
   *
   * Creates a function with the appropriate type ID based on function type:
   * - code: CodeFunction (100)
   * - generative: GenerativeFunction (101)
   * - agentic: AgenticFunction (102)
   * - human: HumanFunction (103)
   */
  async createFunction(data: FunctionData, options?: { id?: string }): Promise<GraphThing> {
    const id = options?.id ?? generateId()
    const typeId = getTypeIdForFunctionType(data.type)
    const typeName = getTypeNameForTypeId(typeId)

    const functionData: FunctionData = {
      name: data.name,
      type: data.type,
      description: data.description,
      handler: data.handler,
      config: data.config,
      version: data.version ?? '1.0.0',
      enabled: data.enabled ?? true,
    }

    const fn = await this.store.createThing({
      id,
      typeId,
      typeName,
      data: functionData as unknown as Record<string, unknown>,
    })

    return fn
  }

  /**
   * Get a Function Thing by ID
   */
  async getFunction(id: string): Promise<GraphThing | null> {
    const fn = await this.store.getThing(id)
    if (!fn) {
      return null
    }
    // Check if it's any of the function type names
    if (!isFunctionTypeName(fn.typeName)) {
      return null
    }
    // Exclude soft-deleted functions
    if (fn.deletedAt !== null) {
      return null
    }
    return fn
  }

  /**
   * Get all functions of a specific type (code, generative, agentic, human)
   */
  async getFunctionsByType(type: FunctionType): Promise<GraphThing[]> {
    const typeId = getTypeIdForFunctionType(type)
    const typeName = getTypeNameForTypeId(typeId)
    return this.store.getThingsByType({ typeName })
  }

  /**
   * Get all functions regardless of type
   */
  async getAllFunctions(): Promise<GraphThing[]> {
    const results: GraphThing[] = []

    // Query all function type names
    const typeNames = ['CodeFunction', 'GenerativeFunction', 'AgenticFunction', 'HumanFunction', 'Function']

    for (const typeName of typeNames) {
      const functions = await this.store.getThingsByType({ typeName })
      results.push(...functions)
    }

    // Dedupe by ID (in case some are stored with legacy 'Function' type)
    const seen = new Set<string>()
    return results.filter((fn) => {
      if (seen.has(fn.id)) return false
      seen.add(fn.id)
      return true
    })
  }

  /**
   * Update a Function Thing
   */
  async updateFunction(
    id: string,
    updates: Partial<FunctionData>
  ): Promise<GraphThing | null> {
    const existing = await this.getFunction(id)
    if (!existing) {
      return null
    }

    const existingData = existing.data as FunctionData
    const newData: FunctionData = {
      ...existingData,
      ...updates,
    }

    return this.store.updateThing(id, { data: newData as unknown as Record<string, unknown> })
  }

  /**
   * Delete a Function Thing (soft delete)
   * Returns the deleted function or null if not found
   */
  async deleteFunction(id: string): Promise<GraphThing | null> {
    const fn = await this.getFunction(id)
    if (!fn) {
      return null
    }

    return this.store.deleteThing(id)
  }

  // ==========================================================================
  // CASCADE OPERATIONS
  // ==========================================================================

  /**
   * Add a cascade relationship between two functions.
   *
   * When the source function fails, execution cascades to the target function.
   * Priority determines ordering when multiple cascades exist (lower = higher priority).
   *
   * @param fromId - Source function ID
   * @param toId - Target (fallback) function ID
   * @param options - Cascade options including priority and condition
   */
  async addCascade(
    fromId: string,
    toId: string,
    options?: CreateCascadeOptions
  ): Promise<GraphRelationship> {
    const priority = options?.priority ?? 0

    const relationshipData: CascadeRelationshipData = {
      priority,
      condition: options?.condition,
      metadata: options?.metadata,
    }

    const relId = `cascade-${fromId}-${toId}-${Date.now()}`

    return this.store.createRelationship({
      id: relId,
      verb: 'cascadesTo',
      from: functionUrl(fromId),
      to: functionUrl(toId),
      data: relationshipData,
    })
  }

  /**
   * Remove a cascade relationship
   */
  async removeCascade(fromId: string, toId: string): Promise<boolean> {
    const rels = await this.store.queryRelationshipsFrom(functionUrl(fromId), {
      verb: 'cascadesTo',
    })

    const matchingRel = rels.find((rel) => {
      const targetId = extractIdFromUrl(rel.to)
      return targetId === toId
    })

    if (!matchingRel) {
      return false
    }

    return this.store.deleteRelationship(matchingRel.id)
  }

  /**
   * Get all cascade targets for a function, sorted by priority
   */
  async getCascadeTargets(functionId: string): Promise<
    Array<{
      function: GraphThing
      relationship: GraphRelationship
    }>
  > {
    const rels = await this.store.queryRelationshipsFrom(functionUrl(functionId), {
      verb: 'cascadesTo',
    })

    // Sort by priority (lower = higher priority)
    rels.sort((a, b) => {
      const priorityA = (a.data as CascadeRelationshipData | null)?.priority ?? 0
      const priorityB = (b.data as CascadeRelationshipData | null)?.priority ?? 0
      return priorityA - priorityB
    })

    const results: Array<{
      function: GraphThing
      relationship: GraphRelationship
    }> = []

    for (const rel of rels) {
      const targetId = extractIdFromUrl(rel.to)
      if (targetId) {
        const fn = await this.getFunction(targetId)
        if (fn) {
          results.push({ function: fn, relationship: rel })
        }
      }
    }

    return results
  }

  // ==========================================================================
  // CASCADE CHAIN RESOLUTION
  // ==========================================================================

  /**
   * Resolve the complete cascade chain starting from a function.
   *
   * Traverses 'cascadesTo' relationships in priority order, building
   * the full chain of fallback functions. Handles cycles by tracking
   * visited nodes.
   *
   * Algorithm:
   * 1. Start with the given function
   * 2. Query all cascadesTo relationships from current function
   * 3. Sort by priority (lowest first)
   * 4. Follow the highest priority cascade to next function
   * 5. Repeat until no more cascades or cycle detected
   *
   * @param functionId - Starting function ID
   * @param options - Resolution options
   * @returns Array of Functions in cascade order
   *
   * @example
   * ```typescript
   * // Given chain: code -> generative -> agentic -> human
   * const chain = await adapter.getCascadeChain('code-fn-id')
   * // Returns: [code, generative, agentic, human]
   * ```
   */
  async getCascadeChain(
    functionId: string,
    options?: GetCascadeChainOptions
  ): Promise<GraphThing[]> {
    const maxDepth = options?.maxDepth ?? 100
    const chain: GraphThing[] = []
    let currentId: string | null = functionId
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      // Mark as visited to prevent cycles
      visited.add(currentId)

      // Get the function
      const fn = await this.store.getThing(currentId)
      if (!fn || !isFunctionTypeName(fn.typeName)) {
        break
      }

      // Check if function is enabled (unless includeDisabled is true)
      if (!options?.includeDisabled) {
        const data = fn.data as FunctionData
        if (data.enabled === false) {
          break
        }
      }

      // Add to chain
      chain.push(fn)

      // Check max depth
      if (chain.length >= maxDepth) {
        break
      }

      // Get cascade relationships
      const url = functionUrl(currentId)
      const rels = await this.store.queryRelationshipsFrom(url, { verb: 'cascadesTo' })

      if (rels.length === 0) {
        break
      }

      // Filter by condition if specified
      let filteredRels = rels
      if (options?.condition) {
        filteredRels = rels.filter((rel) => {
          const data = rel.data as CascadeRelationshipData | null
          return !data?.condition || data.condition === options.condition
        })
      }

      if (filteredRels.length === 0) {
        break
      }

      // Sort by priority (lower = higher priority, executed first)
      filteredRels.sort((a, b) => {
        const priorityA = (a.data as CascadeRelationshipData | null)?.priority ?? 0
        const priorityB = (b.data as CascadeRelationshipData | null)?.priority ?? 0
        return priorityA - priorityB
      })

      // Follow the highest priority cascade (lowest number)
      const nextRel = filteredRels[0]!
      currentId = extractIdFromUrl(nextRel.to)
    }

    return chain
  }

  /**
   * Get detailed cascade chain with relationship information.
   *
   * Similar to getCascadeChain but includes the relationship data
   * that connects each function in the chain.
   *
   * @param functionId - Starting function ID
   * @param options - Resolution options
   * @returns Array of chain entries with function and relationship data
   */
  async getCascadeChainDetailed(
    functionId: string,
    options?: GetCascadeChainOptions
  ): Promise<CascadeChainEntry[]> {
    const maxDepth = options?.maxDepth ?? 100
    const chain: CascadeChainEntry[] = []
    let currentId: string | null = functionId
    let previousRel: GraphRelationship | null = null
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)

      const fn = await this.store.getThing(currentId)
      if (!fn || !isFunctionTypeName(fn.typeName)) {
        break
      }

      // Check if function is enabled
      if (!options?.includeDisabled) {
        const data = fn.data as FunctionData
        if (data.enabled === false) {
          break
        }
      }

      chain.push({
        function: fn,
        relationship: previousRel,
        depth: chain.length,
      })

      if (chain.length >= maxDepth) {
        break
      }

      const url = functionUrl(currentId)
      const rels = await this.store.queryRelationshipsFrom(url, { verb: 'cascadesTo' })

      if (rels.length === 0) {
        break
      }

      let filteredRels = rels
      if (options?.condition) {
        filteredRels = rels.filter((rel) => {
          const data = rel.data as CascadeRelationshipData | null
          return !data?.condition || data.condition === options.condition
        })
      }

      if (filteredRels.length === 0) {
        break
      }

      filteredRels.sort((a, b) => {
        const priorityA = (a.data as CascadeRelationshipData | null)?.priority ?? 0
        const priorityB = (b.data as CascadeRelationshipData | null)?.priority ?? 0
        return priorityA - priorityB
      })

      previousRel = filteredRels[0]!
      currentId = extractIdFromUrl(previousRel.to)
    }

    return chain
  }

  /**
   * Check if a cascade chain has any cycles.
   *
   * @param functionId - Starting function ID
   * @returns true if cycles exist, false otherwise
   */
  async hasCascadeCycle(functionId: string): Promise<boolean> {
    const visited = new Set<string>()
    let currentId: string | null = functionId

    while (currentId) {
      if (visited.has(currentId)) {
        return true
      }
      visited.add(currentId)

      const url = functionUrl(currentId)
      const rels = await this.store.queryRelationshipsFrom(url, { verb: 'cascadesTo' })

      if (rels.length === 0) {
        break
      }

      // Sort by priority and take first
      rels.sort((a, b) => {
        const priorityA = (a.data as CascadeRelationshipData | null)?.priority ?? 0
        const priorityB = (b.data as CascadeRelationshipData | null)?.priority ?? 0
        return priorityA - priorityB
      })

      currentId = extractIdFromUrl(rels[0]!.to)
    }

    return false
  }

  /**
   * Get all functions that cascade to a given function (reverse lookup).
   *
   * @param functionId - Target function ID
   * @returns Array of functions that cascade to this function
   */
  async getCascadeSources(functionId: string): Promise<GraphThing[]> {
    const rels = await this.store.queryRelationshipsTo(functionUrl(functionId), {
      verb: 'cascadesTo',
    })

    const sources: GraphThing[] = []

    for (const rel of rels) {
      const sourceId = extractIdFromUrl(rel.from)
      if (sourceId) {
        const fn = await this.getFunction(sourceId)
        if (fn) {
          sources.push(fn)
        }
      }
    }

    return sources
  }

  // ==========================================================================
  // VERSIONING
  // ==========================================================================

  /**
   * Create a new version of a function (like git commit).
   *
   * @param functionId - ID of the function to version
   * @param content - Code content (string or binary)
   * @param message - Version message
   * @param options - Optional author and parent SHA
   * @returns The created FunctionVersion Thing
   */
  async createVersion(
    functionId: string,
    content: string | Uint8Array,
    message: string,
    options?: { author?: { name: string; email: string }; parentSha?: string }
  ): Promise<GraphThing> {
    // Verify function exists
    const fn = await this.getFunction(functionId)
    if (!fn) {
      throw new Error(`Function '${functionId}' not found`)
    }

    // Generate content hash (SHA)
    const sha = hashContent(content)
    const size = getContentSize(content)
    const author = options?.author ?? { name: 'system', email: 'system@dotdo.dev' }

    // Check if version with this SHA already exists (content-addressable)
    const existingVersion = await this.store.getThing(sha)
    if (existingVersion) {
      return existingVersion
    }

    // Create FunctionBlob if it doesn't exist
    const blobId = `blob-${sha}`
    const existingBlob = await this.store.getThing(blobId)
    if (!existingBlob) {
      const blobData: FunctionBlobData = {
        size,
        contentRef: `internal:${sha}`,
        contentType: 'application/javascript',
        hash: sha,
      }

      await this.store.createThing({
        id: blobId,
        typeId: TYPE_IDS.FunctionBlob,
        typeName: 'FunctionBlob',
        data: blobData as unknown as Record<string, unknown>,
      })
    }

    // Create FunctionVersion
    const versionData: FunctionVersionData = {
      sha,
      message,
      author: {
        ...author,
        timestamp: Date.now(),
      },
      functionId,
      parentSha: options?.parentSha,
    }

    const version = await this.store.createThing({
      id: sha,
      typeId: TYPE_IDS.FunctionVersion,
      typeName: 'FunctionVersion',
      data: versionData as unknown as Record<string, unknown>,
    })

    // Create versionOf relationship (version -> function)
    await this.store.createRelationship({
      id: `rel-versionOf-${sha}-${functionId}`,
      verb: 'versionOf',
      from: versionUrl(sha),
      to: functionUrl(functionId),
    })

    // Create hasContent relationship (version -> blob)
    await this.store.createRelationship({
      id: `rel-hasContent-${sha}-${blobId}`,
      verb: 'hasContent',
      from: versionUrl(sha),
      to: blobUrl(blobId),
    })

    // Create parent relationship if specified
    if (options?.parentSha) {
      await this.store.createRelationship({
        id: `rel-parent-${sha}-${options.parentSha}`,
        verb: 'parent',
        from: versionUrl(sha),
        to: versionUrl(options.parentSha),
      })
    }

    return version
  }

  /**
   * Get version history for a function.
   *
   * @param functionId - Function ID to get history for
   * @param limit - Maximum number of versions to return
   * @returns Array of FunctionVersion Things in order (most recent first)
   */
  async getVersionHistory(functionId: string, limit?: number): Promise<GraphThing[]> {
    const maxLimit = limit ?? 100
    const versions = await this.store.getThingsByType({ typeName: 'FunctionVersion' })

    const functionVersions = versions.filter((v) => {
      const data = v.data as FunctionVersionData
      return data.functionId === functionId
    })

    // Sort by timestamp (most recent first)
    functionVersions.sort((a, b) => {
      const aData = a.data as FunctionVersionData
      const bData = b.data as FunctionVersionData
      return bData.author.timestamp - aData.author.timestamp
    })

    return functionVersions.slice(0, maxLimit)
  }

  /**
   * Resolve a version reference (SHA or ref name like 'latest') to the actual version.
   *
   * @param functionId - Function ID
   * @param ref - Version reference (SHA or ref name)
   * @returns The resolved FunctionVersion Thing or null
   */
  async resolveVersion(functionId: string, ref: string): Promise<GraphThing | null> {
    // Try as direct SHA first
    if (/^[a-f0-9]{40}$/.test(ref)) {
      const version = await this.store.getThing(ref)
      if (version && version.typeName === 'FunctionVersion') {
        const data = version.data as FunctionVersionData
        if (data.functionId === functionId) {
          return version
        }
      }
    }

    // Try as ref name (look up FunctionRef)
    const refs = await this.store.getThingsByType({ typeName: 'FunctionRef' })
    for (const refThing of refs) {
      const refData = refThing.data as { name: string; functionId: string; targetSha: string }
      if (refData.functionId === functionId && refData.name === ref) {
        return this.store.getThing(refData.targetSha)
      }
    }

    // Special case: 'latest' returns most recent version
    if (ref === 'latest') {
      const history = await this.getVersionHistory(functionId, 1)
      return history.length > 0 ? history[0]! : null
    }

    return null
  }

  // ==========================================================================
  // CASCADE CHAIN (Additional methods per issue spec)
  // ==========================================================================

  /**
   * Set up a cascade relationship (alias for addCascade with CascadeConfig).
   *
   * @param fromId - Source function ID
   * @param toId - Target function ID
   * @param config - Cascade configuration
   */
  async setCascade(
    fromId: string,
    toId: string,
    config?: CascadeConfig
  ): Promise<GraphRelationship> {
    return this.addCascade(fromId, toId, {
      priority: config?.priority ?? 0,
      condition: config?.condition,
      metadata: config?.metadata,
    })
  }

  /**
   * Resolve the next function in the cascade chain (single step).
   *
   * @param functionId - Current function ID
   * @returns The next function in the cascade chain, or null if end of chain
   */
  async resolveNextInCascade(functionId: string): Promise<GraphThing | null> {
    const rels = await this.store.queryRelationshipsFrom(functionUrl(functionId), {
      verb: 'cascadesTo',
    })

    if (rels.length === 0) {
      return null
    }

    // Sort by priority and get first
    rels.sort((a, b) => {
      const priorityA = (a.data as CascadeRelationshipData | null)?.priority ?? 0
      const priorityB = (b.data as CascadeRelationshipData | null)?.priority ?? 0
      return priorityA - priorityB
    })

    const nextUrl = rels[0]!.to
    const nextId = extractIdFromUrl(nextUrl)

    if (!nextId) {
      return null
    }

    return this.getFunction(nextId)
  }

  // ==========================================================================
  // OWNERSHIP
  // ==========================================================================

  /**
   * Set the owner organization of a function.
   *
   * @param functionId - Function ID
   * @param orgId - Organization ID
   * @returns The created ownership relationship
   */
  async setOwner(functionId: string, orgId: string): Promise<GraphRelationship> {
    const fn = await this.getFunction(functionId)
    if (!fn) {
      throw new Error(`Function '${functionId}' not found`)
    }

    // Remove existing ownership relationships
    const existingRels = await this.store.queryRelationshipsFrom(functionUrl(functionId), {
      verb: 'ownedBy',
    })
    for (const rel of existingRels) {
      await this.store.deleteRelationship(rel.id)
    }

    // Create new ownership relationship
    return this.store.createRelationship({
      id: `rel-ownedBy-${functionId}-${orgId}`,
      verb: 'ownedBy',
      from: functionUrl(functionId),
      to: orgUrl(orgId),
    })
  }

  /**
   * Get the owner organization of a function.
   *
   * @param functionId - Function ID
   * @returns The owner organization ID, or null if not set
   */
  async getOwner(functionId: string): Promise<string | null> {
    const rels = await this.store.queryRelationshipsFrom(functionUrl(functionId), {
      verb: 'ownedBy',
    })

    if (rels.length === 0) {
      return null
    }

    const ownerUrl = rels[0]!.to
    const match = ownerUrl.match(/do:\/\/orgs\/(.+)$/)
    return match?.[1] ?? null
  }

  /**
   * Set the interface a function implements.
   *
   * @param functionId - Function ID
   * @param interfaceIdParam - Interface ID
   * @returns The created implements relationship
   */
  async setInterface(functionId: string, interfaceIdParam: string): Promise<GraphRelationship> {
    const fn = await this.getFunction(functionId)
    if (!fn) {
      throw new Error(`Function '${functionId}' not found`)
    }

    // Check if relationship already exists
    const existingRels = await this.store.queryRelationshipsFrom(functionUrl(functionId), {
      verb: 'implements',
    })
    const existing = existingRels.find(
      (r) => r.to === interfaceUrl(interfaceIdParam)
    )
    if (existing) {
      return existing
    }

    // Create new implements relationship
    return this.store.createRelationship({
      id: `rel-implements-${functionId}-${interfaceIdParam}`,
      verb: 'implements',
      from: functionUrl(functionId),
      to: interfaceUrl(interfaceIdParam),
    })
  }

  /**
   * Get interfaces implemented by a function.
   *
   * @param functionId - Function ID
   * @returns Array of interface IDs
   */
  async getInterfaces(functionId: string): Promise<string[]> {
    const rels = await this.store.queryRelationshipsFrom(functionUrl(functionId), {
      verb: 'implements',
    })

    return rels.map((r) => {
      const match = r.to.match(/do:\/\/interfaces\/(.+)$/)
      return match?.[1] ?? null
    }).filter((id): id is string => id !== null)
  }

  // ==========================================================================
  // UTILITY
  // ==========================================================================

  /**
   * Get the underlying GraphStore
   */
  getStore(): GraphStore {
    return this.store
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new FunctionGraphAdapter.
 *
 * @param store - GraphStore instance to use
 * @returns A FunctionGraphAdapter instance
 */
export function createFunctionGraphAdapter(store: GraphStore): FunctionGraphAdapter {
  return new FunctionGraphAdapter(store)
}

// Export types for external use
export type { GraphThing, GraphRelationship }

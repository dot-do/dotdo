/**
 * FunctionGraphAdapter - Functions as Graph Things with cascade chain resolution
 *
 * GREEN PHASE: Implements cascade chain resolution using graph relationships
 *
 * @see dotdo-mvzvj - [GREEN] Cascade Chain Graph Resolution
 *
 * Design:
 * - Functions are Things with type='Function' and data containing handler, type, etc.
 * - Cascade chains use 'cascadesTo' relationships with priority and optional conditions
 * - Chain resolution traverses the graph, handling cycles via visited set
 * - Priority ordering determines fallback order when multiple cascades exist
 *
 * Thing Types:
 * - Function: { name, type, handler, config }
 *
 * Relationships:
 * - Function `cascadesTo` Function (fallback chain with priority)
 * - Function `version` Function (versioning relationships)
 * - Function `dependsOn` Function (dependency relationships)
 */

import type { GraphStore, GraphThing, GraphRelationship } from '../types'

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

// ============================================================================
// TYPE IDS (constants for graph things)
// ============================================================================

const TYPE_IDS = {
  Function: 200,
} as const

// ============================================================================
// URL BUILDERS
// ============================================================================

function functionUrl(id: string): string {
  return `do://functions/${id}`
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
   */
  async createFunction(data: FunctionData, options?: { id?: string }): Promise<GraphThing> {
    const id = options?.id ?? generateId()

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
      typeId: TYPE_IDS.Function,
      typeName: 'Function',
      data: functionData as unknown as Record<string, unknown>,
    })

    return fn
  }

  /**
   * Get a Function Thing by ID
   */
  async getFunction(id: string): Promise<GraphThing | null> {
    const fn = await this.store.getThing(id)
    if (!fn || fn.typeName !== 'Function') {
      return null
    }
    return fn
  }

  /**
   * Get all functions of a specific type
   */
  async getFunctionsByType(type: FunctionType): Promise<GraphThing[]> {
    const functions = await this.store.getThingsByType({ typeName: 'Function' })
    return functions.filter((fn) => {
      const data = fn.data as FunctionData
      return data.type === type
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
   */
  async deleteFunction(id: string): Promise<boolean> {
    const fn = await this.getFunction(id)
    if (!fn) {
      return false
    }

    const result = await this.store.deleteThing(id)
    return result !== null
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
      if (!fn || fn.typeName !== 'Function') {
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
      if (!fn || fn.typeName !== 'Function') {
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

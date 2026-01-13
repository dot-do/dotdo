/**
 * Cascade Chain Resolver
 *
 * Resolves function cascade chains (Code -> Generative -> Agentic -> Human)
 * via graph relationships using the SQLiteGraphStore.
 *
 * @see dotdo-0da43 - [GREEN] Cascade Chain Graph Resolution
 *
 * The cascade chain represents fallback execution order:
 * 1. Code (fastest, cheapest, deterministic)
 * 2. Generative (AI inference, single call)
 * 3. Agentic (AI + tools, multi-step)
 * 4. Human (slowest, most expensive, guaranteed judgment)
 *
 * Functions are linked via 'cascadesTo' relationships with priority and condition data.
 */

import type { SQLiteGraphStore } from './stores'
import type { GraphThing, GraphRelationship } from './types'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Valid function types in the cascade model */
export type FunctionType = 'code' | 'generative' | 'agentic' | 'human'

/** Type ordering for validation (lower = earlier in cascade) */
const TYPE_ORDER: Record<FunctionType, number> = {
  code: 0,
  generative: 1,
  agentic: 2,
  human: 3,
}

/**
 * Options for building cascade paths
 */
export interface CascadePathOptions {
  /** Maximum depth to traverse (default: 100) */
  maxDepth?: number
  /** Only follow cascades matching this condition */
  condition?: string
  /** Include disabled functions in path */
  includeDisabled?: boolean
  /** Include relationship data in path entries */
  includeRelationships?: boolean
  /** Filter by function types */
  types?: FunctionType[]
}

/**
 * Entry in a cascade path
 */
export interface CascadePathEntry {
  /** The function at this position in the chain */
  function: GraphThing
  /** The relationship that led to this function (null for first entry) */
  relationship: GraphRelationship | null
  /** Depth in the cascade chain (0-indexed) */
  depth: number
  /** Function type (code, generative, agentic, human) */
  type: FunctionType
}

/**
 * Cascade target with priority
 */
export interface CascadeTarget {
  /** Target function */
  function: GraphThing
  /** The cascade relationship */
  relationship: GraphRelationship
  /** Priority (lower = higher priority, executed first) */
  priority: number
  /** Optional condition for when to use this cascade */
  condition?: string
}

/**
 * Statistics about a cascade chain
 */
export interface CascadeChainStats {
  /** Total length of the cascade chain */
  chainLength: number
  /** Function types in order */
  typeSequence: FunctionType[]
  /** Whether chain has cycles */
  hasCycle: boolean
  /** Total branching factor (count of all cascadesTo relationships) */
  branchingFactor: number
  /** Maximum depth reached */
  maxDepth: number
  /** IDs of all functions in the chain */
  functionIds: string[]
  /** Disabled functions in chain */
  disabledCount: number
}

/**
 * A path from source to target
 */
export interface CascadePath {
  /** Path entries from start to target */
  entries: CascadePathEntry[]
  /** Total priority sum along path */
  totalPriority: number
  /** Whether path passes through disabled functions */
  hasDisabled: boolean
}

/**
 * Validation result for cascade chain
 */
export interface CascadeValidationResult {
  /** Overall validation passed */
  valid: boolean
  /** List of validation errors */
  errors: CascadeValidationError[]
  /** List of validation warnings */
  warnings: CascadeValidationWarning[]
}

/**
 * Validation error
 */
export interface CascadeValidationError {
  code: 'CYCLE_DETECTED' | 'ORPHAN_FUNCTION' | 'MISSING_TARGET' | 'DUPLICATE_PRIORITY' | 'INVALID_TYPE_ORDER'
  message: string
  functionId?: string
  relationshipId?: string
}

/**
 * Validation warning
 */
export interface CascadeValidationWarning {
  code: 'DISABLED_IN_PATH' | 'DEEP_CHAIN' | 'HIGH_BRANCHING' | 'NO_TERMINAL'
  message: string
  functionId?: string
}

// ============================================================================
// CASCADE CHAIN RESOLVER CLASS
// ============================================================================

/**
 * CascadeChainResolver resolves function cascade chains via graph relationships.
 *
 * @example
 * ```typescript
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 *
 * const resolver = new CascadeChainResolver(store)
 *
 * // Get next function in cascade
 * const next = await resolver.resolveNext('code-function-id')
 *
 * // Build full cascade path
 * const path = await resolver.buildCascadePath('code-function-id')
 *
 * // Get cascade chain statistics
 * const stats = await resolver.getCascadeStats('code-function-id')
 * ```
 */
export class CascadeChainResolver {
  constructor(private store: SQLiteGraphStore) {}

  // =========================================================================
  // PUBLIC API
  // =========================================================================

  /**
   * Resolve the next function in the cascade chain.
   * Returns null when no cascadesTo relationship exists.
   */
  async resolveNext(functionId: string): Promise<GraphThing | null> {
    const rels = await this.store.queryRelationshipsFrom(`do://functions/${functionId}`, {
      verb: 'cascadesTo',
    })

    if (rels.length === 0) {
      return null
    }

    // Sort by priority (lowest = highest priority)
    rels.sort((a, b) => {
      const pA = (a.data as { priority?: number } | null)?.priority ?? 0
      const pB = (b.data as { priority?: number } | null)?.priority ?? 0
      return pA - pB
    })

    const nextUrl = rels[0]!.to
    const nextId = nextUrl.replace('do://functions/', '')

    return this.store.getThing(nextId)
  }

  /**
   * Build the full cascade path starting from a function.
   * Returns all functions in order from start to end of chain.
   */
  async buildCascadePath(functionId: string, options?: CascadePathOptions): Promise<CascadePathEntry[]> {
    const maxDepth = options?.maxDepth ?? 100
    const condition = options?.condition
    const includeDisabled = options?.includeDisabled ?? true
    const types = options?.types

    const path: CascadePathEntry[] = []
    let currentId = functionId
    let prevRel: GraphRelationship | null = null
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId) && path.length < maxDepth) {
      visited.add(currentId)

      const fn = await this.store.getThing(currentId)
      if (!fn) break

      const fnData = fn.data as { type?: FunctionType; enabled?: boolean } | null
      const fnType = fnData?.type ?? 'code'
      const isEnabled = fnData?.enabled !== false

      // Skip disabled functions if includeDisabled is false
      if (!includeDisabled && !isEnabled) {
        break
      }

      // Filter by types if specified
      const shouldInclude = !types || types.includes(fnType)

      if (shouldInclude) {
        path.push({
          function: fn,
          relationship: prevRel,
          depth: path.length,
          type: fnType,
        })
      }

      // Get next function
      const rels = await this.store.queryRelationshipsFrom(`do://functions/${currentId}`, {
        verb: 'cascadesTo',
      })

      if (rels.length === 0) break

      // Filter by condition if specified
      let filteredRels = rels
      if (condition) {
        filteredRels = rels.filter((r) => {
          const relData = r.data as { condition?: string } | null
          return relData?.condition === condition
        })
        if (filteredRels.length === 0) break
      }

      // Sort by priority
      filteredRels.sort((a, b) => {
        const pA = (a.data as { priority?: number } | null)?.priority ?? 0
        const pB = (b.data as { priority?: number } | null)?.priority ?? 0
        return pA - pB
      })

      prevRel = filteredRels[0]!
      currentId = filteredRels[0]!.to.replace('do://functions/', '')
    }

    return path
  }

  /**
   * Check if cascade chain has cycles (circular references).
   */
  async detectCycle(functionId: string): Promise<boolean> {
    const visited = new Set<string>()
    let currentId: string | null = functionId

    while (currentId) {
      if (visited.has(currentId)) {
        return true // Cycle detected
      }
      visited.add(currentId)

      const rels = await this.store.queryRelationshipsFrom(`do://functions/${currentId}`, {
        verb: 'cascadesTo',
      })

      if (rels.length === 0) break

      currentId = rels[0]!.to.replace('do://functions/', '')
    }

    return false
  }

  /**
   * Get all possible cascade targets with priorities (for branching cascades).
   */
  async getCascadeTargets(functionId: string): Promise<CascadeTarget[]> {
    const rels = await this.store.queryRelationshipsFrom(`do://functions/${functionId}`, {
      verb: 'cascadesTo',
    })

    const targets: CascadeTarget[] = []

    for (const rel of rels) {
      const targetId = rel.to.replace('do://functions/', '')
      const fn = await this.store.getThing(targetId)
      if (!fn) continue

      const relData = rel.data as { priority?: number; condition?: string } | null

      targets.push({
        function: fn,
        relationship: rel,
        priority: relData?.priority ?? 0,
        condition: relData?.condition,
      })
    }

    // Sort by priority
    targets.sort((a, b) => a.priority - b.priority)

    return targets
  }

  /**
   * Find the terminal function in the cascade chain (typically Human).
   */
  async findTerminal(functionId: string, maxDepth?: number): Promise<GraphThing | null> {
    const limit = maxDepth ?? 100
    let currentId = functionId
    let lastFn: GraphThing | null = null
    const visited = new Set<string>()
    let depth = 0

    while (currentId && !visited.has(currentId) && depth < limit) {
      visited.add(currentId)
      depth++

      const fn = await this.store.getThing(currentId)
      if (!fn) break

      lastFn = fn

      const rels = await this.store.queryRelationshipsFrom(`do://functions/${currentId}`, {
        verb: 'cascadesTo',
      })

      if (rels.length === 0) break

      // Sort by priority
      rels.sort((a, b) => {
        const pA = (a.data as { priority?: number } | null)?.priority ?? 0
        const pB = (b.data as { priority?: number } | null)?.priority ?? 0
        return pA - pB
      })

      currentId = rels[0]!.to.replace('do://functions/', '')
    }

    return lastFn
  }

  /**
   * Get cascade chain statistics for observability.
   */
  async getCascadeStats(functionId: string): Promise<CascadeChainStats> {
    const functionIds: string[] = []
    const typeSequence: FunctionType[] = []
    let disabledCount = 0
    let branchingFactor = 0

    const visited = new Set<string>()
    let currentId = functionId
    let hasCycle = false

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)

      const fn = await this.store.getThing(currentId)
      if (!fn) break

      functionIds.push(fn.id)
      const fnData = fn.data as { type?: FunctionType; enabled?: boolean } | null
      typeSequence.push(fnData?.type ?? 'code')

      if (fnData?.enabled === false) {
        disabledCount++
      }

      const rels = await this.store.queryRelationshipsFrom(`do://functions/${currentId}`, {
        verb: 'cascadesTo',
      })

      branchingFactor += rels.length

      if (rels.length === 0) break

      // Sort by priority
      rels.sort((a, b) => {
        const pA = (a.data as { priority?: number } | null)?.priority ?? 0
        const pB = (b.data as { priority?: number } | null)?.priority ?? 0
        return pA - pB
      })

      const nextId = rels[0]!.to.replace('do://functions/', '')

      // Check for cycle
      if (visited.has(nextId)) {
        hasCycle = true
        break
      }

      currentId = nextId
    }

    return {
      chainLength: functionIds.length,
      typeSequence,
      hasCycle,
      branchingFactor,
      maxDepth: functionIds.length - 1,
      functionIds,
      disabledCount,
    }
  }

  /**
   * Get all paths from start to a specific target function.
   */
  async findPathsTo(startId: string, targetId: string): Promise<CascadePath[]> {
    const paths: CascadePath[] = []

    const dfs = async (
      currentId: string,
      path: CascadePathEntry[],
      totalPriority: number,
      hasDisabled: boolean,
      visited: Set<string>
    ): Promise<void> => {
      if (visited.has(currentId)) return

      const fn = await this.store.getThing(currentId)
      if (!fn) return

      const fnData = fn.data as { type?: FunctionType; enabled?: boolean } | null
      const fnType = fnData?.type ?? 'code'
      const isDisabled = fnData?.enabled === false

      const newHasDisabled = hasDisabled || isDisabled

      const entry: CascadePathEntry = {
        function: fn,
        relationship: path.length > 0 ? path[path.length - 1]!.relationship : null,
        depth: path.length,
        type: fnType,
      }

      const newPath = [...path, entry]
      const newVisited = new Set(visited)
      newVisited.add(currentId)

      // Found target
      if (currentId === targetId) {
        paths.push({
          entries: newPath,
          totalPriority,
          hasDisabled: newHasDisabled,
        })
        return
      }

      // Get all cascade targets
      const rels = await this.store.queryRelationshipsFrom(`do://functions/${currentId}`, {
        verb: 'cascadesTo',
      })

      for (const rel of rels) {
        const nextId = rel.to.replace('do://functions/', '')
        const relData = rel.data as { priority?: number } | null
        const priority = relData?.priority ?? 0

        // Update entry's outgoing relationship for child nodes
        const updatedPath = [...newPath.slice(0, -1), { ...entry, relationship: rel }]

        await dfs(nextId, updatedPath, totalPriority + priority, newHasDisabled, newVisited)
      }
    }

    await dfs(startId, [], 0, false, new Set())

    return paths
  }

  /**
   * Validate cascade chain structure (no orphans, valid priorities, etc.)
   */
  async validateChain(functionId: string): Promise<CascadeValidationResult> {
    const errors: CascadeValidationError[] = []
    const warnings: CascadeValidationWarning[] = []

    // Track visited functions
    const visited = new Set<string>()
    const functionStack: string[] = [functionId]
    const typeSequence: FunctionType[] = []
    let chainLength = 0
    let hasTerminal = false

    while (functionStack.length > 0) {
      const currentId = functionStack.pop()!

      if (visited.has(currentId)) {
        errors.push({
          code: 'CYCLE_DETECTED',
          message: `Cycle detected at function ${currentId}`,
          functionId: currentId,
        })
        continue
      }

      visited.add(currentId)
      chainLength++

      const fn = await this.store.getThing(currentId)
      if (!fn) {
        errors.push({
          code: 'MISSING_TARGET',
          message: `Function ${currentId} not found`,
          functionId: currentId,
        })
        continue
      }

      const fnData = fn.data as { type?: FunctionType; enabled?: boolean } | null
      const fnType = fnData?.type ?? 'code'
      typeSequence.push(fnType)

      // Check if disabled
      if (fnData?.enabled === false) {
        warnings.push({
          code: 'DISABLED_IN_PATH',
          message: `Function ${currentId} is disabled`,
          functionId: currentId,
        })
      }

      // Check if human terminal
      if (fnType === 'human') {
        hasTerminal = true
      }

      // Get cascade relationships
      const rels = await this.store.queryRelationshipsFrom(`do://functions/${currentId}`, {
        verb: 'cascadesTo',
      })

      // Check for duplicate priorities
      const priorities = new Map<number, string[]>()
      for (const rel of rels) {
        const relData = rel.data as { priority?: number } | null
        const priority = relData?.priority ?? 0
        if (!priorities.has(priority)) {
          priorities.set(priority, [])
        }
        priorities.get(priority)!.push(rel.id)
      }

      for (const [priority, relIds] of priorities) {
        if (relIds.length > 1) {
          errors.push({
            code: 'DUPLICATE_PRIORITY',
            message: `Duplicate priority ${priority} found for function ${currentId}`,
            functionId: currentId,
          })
        }
      }

      // Check for type order violations
      for (const rel of rels) {
        const targetId = rel.to.replace('do://functions/', '')
        const targetFn = await this.store.getThing(targetId)

        if (!targetFn) {
          errors.push({
            code: 'MISSING_TARGET',
            message: `Target function ${targetId} not found`,
            functionId: currentId,
            relationshipId: rel.id,
          })
          continue
        }

        const targetData = targetFn.data as { type?: FunctionType } | null
        const targetType = targetData?.type ?? 'code'

        // Check type order
        if (TYPE_ORDER[targetType] < TYPE_ORDER[fnType]) {
          errors.push({
            code: 'INVALID_TYPE_ORDER',
            message: `Invalid type order: ${fnType} -> ${targetType}. Expected cascade from less capable to more capable.`,
            functionId: currentId,
            relationshipId: rel.id,
          })
        }

        // Add to stack for traversal or detect cycle
        if (visited.has(targetId)) {
          // Back-edge to an already visited node = cycle
          errors.push({
            code: 'CYCLE_DETECTED',
            message: `Cycle detected: ${currentId} -> ${targetId}`,
            functionId: currentId,
            relationshipId: rel.id,
          })
        } else {
          functionStack.push(targetId)
        }
      }

      // Check branching factor
      if (rels.length >= 5) {
        warnings.push({
          code: 'HIGH_BRANCHING',
          message: `Function ${currentId} has ${rels.length} cascade targets`,
          functionId: currentId,
        })
      }
    }

    // Check for deep chain
    if (chainLength > 10) {
      warnings.push({
        code: 'DEEP_CHAIN',
        message: `Chain length ${chainLength} exceeds recommended depth of 10`,
      })
    }

    // Check for terminal
    if (!hasTerminal && chainLength > 1) {
      warnings.push({
        code: 'NO_TERMINAL',
        message: 'Chain does not end with a Human function',
      })
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }
}

/**
 * EventLinker - Graph-based event relationship management
 *
 * Provides causality and relationship tracking for business events:
 * - Link types: caused-by (causation), parent-child (hierarchy), relates-to (association)
 * - Graph storage with efficient adjacency lists
 * - Traversal APIs for ancestors, descendants, and related events
 * - Cycle detection and prevention for causation chains
 * - Lazy loading for deep graph traversals
 *
 * @module db/primitives/business-event-store/event-linker
 */

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Event link types for different relationship semantics
 *
 * - caused_by: Causal relationship (event A caused event B) - directed, acyclic
 * - parent_child: Hierarchical grouping (batch contains items) - directed, tree structure
 * - related: Loose association (events related by context) - bidirectional
 */
export type LinkType = 'caused_by' | 'parent_child' | 'related'

/**
 * Direction for link traversal
 */
export type TraversalDirection = 'forward' | 'backward' | 'both'

/**
 * A single link between two events
 */
export interface EventLink {
  /** Source event ID (from) */
  sourceId: string
  /** Target event ID (to) */
  targetId: string
  /** Type of relationship */
  type: LinkType
  /** When the link was created */
  createdAt: Date
  /** Optional metadata about the link */
  metadata?: Record<string, unknown>
}

/**
 * Options for traversal operations
 */
export interface TraversalOptions {
  /** Maximum depth to traverse (default: unlimited) */
  maxDepth?: number
  /** Maximum number of events to return (default: unlimited) */
  limit?: number
  /** Whether to use lazy loading (default: false) */
  lazy?: boolean
  /** Filter by link types (default: all) */
  linkTypes?: LinkType[]
  /** Direction of traversal (default depends on method) */
  direction?: TraversalDirection
}

/**
 * Result of a traversal operation
 */
export interface TraversalResult {
  /** IDs of traversed events in order */
  eventIds: string[]
  /** Total depth reached */
  depth: number
  /** Whether more results exist beyond the limit/depth */
  hasMore: boolean
  /** Links traversed */
  links: EventLink[]
}

/**
 * Lazy iterator for deep traversals
 */
export interface LazyTraversalIterator {
  /** Get next batch of event IDs */
  next(batchSize?: number): Promise<{ eventIds: string[]; done: boolean }>
  /** Get current depth */
  currentDepth(): number
  /** Get total events visited so far */
  visitedCount(): number
  /** Check if traversal is complete */
  isDone(): boolean
}

/**
 * Graph statistics
 */
export interface GraphStats {
  /** Total number of events in graph */
  totalEvents: number
  /** Total number of links */
  totalLinks: number
  /** Links by type */
  linksByType: Record<LinkType, number>
  /** Number of root events (no incoming causal links) */
  rootEvents: number
  /** Number of leaf events (no outgoing causal links) */
  leafEvents: number
  /** Maximum causation chain depth */
  maxCausalDepth: number
}

/**
 * Cycle detection result
 */
export interface CycleCheckResult {
  /** Whether a cycle would be created */
  wouldCreateCycle: boolean
  /** Path that would create the cycle (if any) */
  cyclePath?: string[]
}

// =============================================================================
// EventLinker Class
// =============================================================================

/**
 * EventLinker - Manages graph relationships between events
 *
 * Uses adjacency lists for efficient graph operations:
 * - Forward links: source -> targets (children/effects)
 * - Backward links: target -> sources (parents/causes)
 */
export class EventLinker {
  // Graph storage using adjacency lists
  private forwardLinks: Map<string, Map<LinkType, Set<string>>> = new Map()
  private backwardLinks: Map<string, Map<LinkType, Set<string>>> = new Map()

  // Link metadata storage
  private linkMetadata: Map<string, EventLink> = new Map()

  // Set of all events in the graph
  private events: Set<string> = new Set()

  /**
   * Generate a unique key for a link
   */
  private getLinkKey(sourceId: string, targetId: string, type: LinkType): string {
    return `${sourceId}:${type}:${targetId}`
  }

  /**
   * Parse a link key back to components
   */
  private parseLinkKey(key: string): { sourceId: string; targetId: string; type: LinkType } {
    const parts = key.split(':')
    const type = parts[1] as LinkType
    const sourceId = parts[0]
    const targetId = parts.slice(2).join(':') // Handle IDs that contain colons
    return { sourceId, targetId, type }
  }

  /**
   * Add an event to the graph (implicit when linking)
   */
  addEvent(eventId: string): void {
    this.events.add(eventId)
  }

  /**
   * Check if an event exists in the graph
   */
  hasEvent(eventId: string): boolean {
    return this.events.has(eventId)
  }

  /**
   * Create a link between two events
   *
   * @throws Error if link would create a cycle (for caused_by links)
   */
  async link(
    sourceId: string,
    targetId: string,
    type: LinkType,
    metadata?: Record<string, unknown>,
  ): Promise<EventLink> {
    // Add events to the graph if not present
    this.events.add(sourceId)
    this.events.add(targetId)

    // Check for cycles in causal relationships
    if (type === 'caused_by') {
      const cycleCheck = await this.wouldCreateCycle(sourceId, targetId)
      if (cycleCheck.wouldCreateCycle) {
        throw new Error(
          `Cannot create link: would create cycle. Path: ${cycleCheck.cyclePath?.join(' -> ')}`,
        )
      }
    }

    // Check for duplicate links
    const linkKey = this.getLinkKey(sourceId, targetId, type)
    if (this.linkMetadata.has(linkKey)) {
      return this.linkMetadata.get(linkKey)!
    }

    // Create the link
    const link: EventLink = {
      sourceId,
      targetId,
      type,
      createdAt: new Date(),
      metadata,
    }

    // Store metadata
    this.linkMetadata.set(linkKey, link)

    // Add to forward adjacency list
    if (!this.forwardLinks.has(sourceId)) {
      this.forwardLinks.set(sourceId, new Map())
    }
    const sourceForward = this.forwardLinks.get(sourceId)!
    if (!sourceForward.has(type)) {
      sourceForward.set(type, new Set())
    }
    sourceForward.get(type)!.add(targetId)

    // Add to backward adjacency list
    if (!this.backwardLinks.has(targetId)) {
      this.backwardLinks.set(targetId, new Map())
    }
    const targetBackward = this.backwardLinks.get(targetId)!
    if (!targetBackward.has(type)) {
      targetBackward.set(type, new Set())
    }
    targetBackward.get(type)!.add(sourceId)

    // For 'related' links, also add the reverse direction (bidirectional)
    if (type === 'related') {
      const reverseKey = this.getLinkKey(targetId, sourceId, type)
      if (!this.linkMetadata.has(reverseKey)) {
        const reverseLink: EventLink = {
          sourceId: targetId,
          targetId: sourceId,
          type,
          createdAt: link.createdAt,
          metadata,
        }
        this.linkMetadata.set(reverseKey, reverseLink)

        // Add reverse to forward adjacency
        if (!this.forwardLinks.has(targetId)) {
          this.forwardLinks.set(targetId, new Map())
        }
        const targetForward = this.forwardLinks.get(targetId)!
        if (!targetForward.has(type)) {
          targetForward.set(type, new Set())
        }
        targetForward.get(type)!.add(sourceId)

        // Add reverse to backward adjacency
        if (!this.backwardLinks.has(sourceId)) {
          this.backwardLinks.set(sourceId, new Map())
        }
        const sourceBackward = this.backwardLinks.get(sourceId)!
        if (!sourceBackward.has(type)) {
          sourceBackward.set(type, new Set())
        }
        sourceBackward.get(type)!.add(targetId)
      }
    }

    return link
  }

  /**
   * Remove a link between two events
   */
  unlink(sourceId: string, targetId: string, type: LinkType): boolean {
    const linkKey = this.getLinkKey(sourceId, targetId, type)

    if (!this.linkMetadata.has(linkKey)) {
      return false
    }

    // Remove metadata
    this.linkMetadata.delete(linkKey)

    // Remove from forward adjacency
    const sourceForward = this.forwardLinks.get(sourceId)
    if (sourceForward) {
      const typeSet = sourceForward.get(type)
      if (typeSet) {
        typeSet.delete(targetId)
        if (typeSet.size === 0) {
          sourceForward.delete(type)
        }
      }
      if (sourceForward.size === 0) {
        this.forwardLinks.delete(sourceId)
      }
    }

    // Remove from backward adjacency
    const targetBackward = this.backwardLinks.get(targetId)
    if (targetBackward) {
      const typeSet = targetBackward.get(type)
      if (typeSet) {
        typeSet.delete(sourceId)
        if (typeSet.size === 0) {
          targetBackward.delete(type)
        }
      }
      if (targetBackward.size === 0) {
        this.backwardLinks.delete(targetId)
      }
    }

    // For 'related' links, also remove the reverse direction
    if (type === 'related') {
      const reverseKey = this.getLinkKey(targetId, sourceId, type)
      this.linkMetadata.delete(reverseKey)

      const targetForward = this.forwardLinks.get(targetId)
      if (targetForward) {
        const typeSet = targetForward.get(type)
        if (typeSet) {
          typeSet.delete(sourceId)
          if (typeSet.size === 0) {
            targetForward.delete(type)
          }
        }
        if (targetForward.size === 0) {
          this.forwardLinks.delete(targetId)
        }
      }

      const sourceBackward = this.backwardLinks.get(sourceId)
      if (sourceBackward) {
        const typeSet = sourceBackward.get(type)
        if (typeSet) {
          typeSet.delete(targetId)
          if (typeSet.size === 0) {
            sourceBackward.delete(type)
          }
        }
        if (sourceBackward.size === 0) {
          this.backwardLinks.delete(sourceId)
        }
      }
    }

    return true
  }

  /**
   * Get all links for an event
   */
  getLinks(eventId: string, direction: TraversalDirection = 'both'): EventLink[] {
    const links: EventLink[] = []

    if (direction === 'forward' || direction === 'both') {
      const forward = this.forwardLinks.get(eventId)
      if (forward) {
        for (const [type, targets] of forward) {
          for (const targetId of targets) {
            const key = this.getLinkKey(eventId, targetId, type)
            const link = this.linkMetadata.get(key)
            if (link) {
              links.push(link)
            }
          }
        }
      }
    }

    if (direction === 'backward' || direction === 'both') {
      const backward = this.backwardLinks.get(eventId)
      if (backward) {
        for (const [type, sources] of backward) {
          for (const sourceId of sources) {
            const key = this.getLinkKey(sourceId, eventId, type)
            const link = this.linkMetadata.get(key)
            if (link) {
              // Avoid duplicates for bidirectional related links
              if (!links.some((l) => l.sourceId === link.sourceId && l.targetId === link.targetId && l.type === link.type)) {
                links.push(link)
              }
            }
          }
        }
      }
    }

    return links
  }

  /**
   * Get links of a specific type for an event
   */
  getLinksByType(eventId: string, type: LinkType, direction: TraversalDirection = 'both'): EventLink[] {
    return this.getLinks(eventId, direction).filter((link) => link.type === type)
  }

  /**
   * Check if adding a link would create a cycle (for causation chains)
   */
  async wouldCreateCycle(sourceId: string, targetId: string): Promise<CycleCheckResult> {
    // A link from sourceId to targetId creates a cycle if there's already
    // a path from targetId to sourceId in the causation graph
    const visited = new Set<string>()
    const path: string[] = [targetId]

    const dfs = (current: string): string[] | null => {
      if (current === sourceId) {
        return [...path, sourceId]
      }

      if (visited.has(current)) {
        return null
      }

      visited.add(current)

      const forward = this.forwardLinks.get(current)
      if (forward) {
        const causalTargets = forward.get('caused_by')
        if (causalTargets) {
          for (const next of causalTargets) {
            path.push(next)
            const cyclePath = dfs(next)
            if (cyclePath) {
              return cyclePath
            }
            path.pop()
          }
        }
      }

      return null
    }

    const cyclePath = dfs(targetId)

    return {
      wouldCreateCycle: cyclePath !== null,
      cyclePath: cyclePath ?? undefined,
    }
  }

  /**
   * Get ancestors of an event (events that caused this event)
   */
  async getAncestors(eventId: string, options: TraversalOptions = {}): Promise<TraversalResult> {
    const { maxDepth = Infinity, limit = Infinity, linkTypes = ['caused_by'] } = options

    const result: string[] = []
    const links: EventLink[] = []
    const visited = new Set<string>()
    let currentDepth = 0
    let hasMore = false

    // BFS traversal backward through the graph
    let currentLevel = [eventId]
    visited.add(eventId)

    while (currentLevel.length > 0 && currentDepth < maxDepth) {
      const nextLevel: string[] = []

      for (const current of currentLevel) {
        const backward = this.backwardLinks.get(current)
        if (backward) {
          for (const type of linkTypes) {
            const sources = backward.get(type)
            if (sources) {
              for (const sourceId of sources) {
                if (!visited.has(sourceId)) {
                  if (result.length >= limit) {
                    hasMore = true
                    break
                  }
                  visited.add(sourceId)
                  result.push(sourceId)
                  nextLevel.push(sourceId)

                  const linkKey = this.getLinkKey(sourceId, current, type)
                  const link = this.linkMetadata.get(linkKey)
                  if (link) {
                    links.push(link)
                  }
                }
              }
            }
          }
        }
        if (hasMore) break
      }

      if (hasMore) break
      currentLevel = nextLevel
      if (nextLevel.length > 0) {
        currentDepth++
      }
    }

    return {
      eventIds: result,
      depth: currentDepth,
      hasMore,
      links,
    }
  }

  /**
   * Get descendants of an event (events caused by this event)
   */
  async getDescendants(eventId: string, options: TraversalOptions = {}): Promise<TraversalResult> {
    const { maxDepth = Infinity, limit = Infinity, linkTypes = ['caused_by'] } = options

    const result: string[] = []
    const links: EventLink[] = []
    const visited = new Set<string>()
    let currentDepth = 0
    let hasMore = false

    // BFS traversal forward through the graph
    let currentLevel = [eventId]
    visited.add(eventId)

    while (currentLevel.length > 0 && currentDepth < maxDepth) {
      const nextLevel: string[] = []

      for (const current of currentLevel) {
        const forward = this.forwardLinks.get(current)
        if (forward) {
          for (const type of linkTypes) {
            const targets = forward.get(type)
            if (targets) {
              for (const targetId of targets) {
                if (!visited.has(targetId)) {
                  if (result.length >= limit) {
                    hasMore = true
                    break
                  }
                  visited.add(targetId)
                  result.push(targetId)
                  nextLevel.push(targetId)

                  const linkKey = this.getLinkKey(current, targetId, type)
                  const link = this.linkMetadata.get(linkKey)
                  if (link) {
                    links.push(link)
                  }
                }
              }
            }
          }
        }
        if (hasMore) break
      }

      if (hasMore) break
      currentLevel = nextLevel
      if (nextLevel.length > 0) {
        currentDepth++
      }
    }

    return {
      eventIds: result,
      depth: currentDepth,
      hasMore,
      links,
    }
  }

  /**
   * Get related events (bidirectional traversal through 'related' links)
   */
  async getRelated(eventId: string, options: TraversalOptions = {}): Promise<TraversalResult> {
    const { maxDepth = Infinity, limit = Infinity } = options

    const result: string[] = []
    const links: EventLink[] = []
    const visited = new Set<string>()
    let currentDepth = 0
    let hasMore = false

    // BFS traversal through related links (bidirectional)
    let currentLevel = [eventId]
    visited.add(eventId)

    while (currentLevel.length > 0 && currentDepth < maxDepth) {
      const nextLevel: string[] = []

      for (const current of currentLevel) {
        // Get related links (already bidirectional in storage)
        const forward = this.forwardLinks.get(current)
        if (forward) {
          const relatedTargets = forward.get('related')
          if (relatedTargets) {
            for (const targetId of relatedTargets) {
              if (!visited.has(targetId)) {
                if (result.length >= limit) {
                  hasMore = true
                  break
                }
                visited.add(targetId)
                result.push(targetId)
                nextLevel.push(targetId)

                const linkKey = this.getLinkKey(current, targetId, 'related')
                const link = this.linkMetadata.get(linkKey)
                if (link) {
                  links.push(link)
                }
              }
            }
          }
        }
        if (hasMore) break
      }

      if (hasMore) break
      currentLevel = nextLevel
      if (nextLevel.length > 0) {
        currentDepth++
      }
    }

    return {
      eventIds: result,
      depth: currentDepth,
      hasMore,
      links,
    }
  }

  /**
   * Get the causation chain from root to the specified event
   */
  async getCausationChain(eventId: string): Promise<{ root: string; path: string[]; depth: number }> {
    const path: string[] = []
    let current = eventId

    while (current) {
      path.unshift(current)

      const backward = this.backwardLinks.get(current)
      if (!backward) break

      const causes = backward.get('caused_by')
      if (!causes || causes.size === 0) break

      // Follow the first cause (for a chain, there should only be one)
      current = causes.values().next().value!
    }

    return {
      root: path[0],
      path,
      depth: path.length,
    }
  }

  /**
   * Get parent events (for parent_child relationships)
   */
  async getParents(eventId: string): Promise<string[]> {
    const backward = this.backwardLinks.get(eventId)
    if (!backward) return []

    const parents = backward.get('parent_child')
    return parents ? Array.from(parents) : []
  }

  /**
   * Get child events (for parent_child relationships)
   */
  async getChildren(eventId: string): Promise<string[]> {
    const forward = this.forwardLinks.get(eventId)
    if (!forward) return []

    const children = forward.get('parent_child')
    return children ? Array.from(children) : []
  }

  /**
   * Get all root events (no incoming causal links)
   */
  getRootEvents(): string[] {
    const roots: string[] = []

    for (const eventId of this.events) {
      const backward = this.backwardLinks.get(eventId)
      if (!backward) {
        roots.push(eventId)
        continue
      }

      const causes = backward.get('caused_by')
      if (!causes || causes.size === 0) {
        roots.push(eventId)
      }
    }

    return roots
  }

  /**
   * Get all leaf events (no outgoing causal links)
   */
  getLeafEvents(): string[] {
    const leaves: string[] = []

    for (const eventId of this.events) {
      const forward = this.forwardLinks.get(eventId)
      if (!forward) {
        leaves.push(eventId)
        continue
      }

      const effects = forward.get('caused_by')
      if (!effects || effects.size === 0) {
        leaves.push(eventId)
      }
    }

    return leaves
  }

  /**
   * Create a lazy iterator for deep traversals
   */
  createLazyIterator(
    eventId: string,
    direction: 'ancestors' | 'descendants' | 'related',
    options: TraversalOptions = {},
  ): LazyTraversalIterator {
    const { maxDepth = Infinity, linkTypes = direction === 'related' ? ['related'] : ['caused_by'] } = options
    const linker = this

    // State for lazy traversal
    let currentLevel: string[] = [eventId]
    const visited = new Set<string>([eventId])
    let depth = 0
    let done = false
    let totalVisited = 0

    return {
      async next(batchSize = 10): Promise<{ eventIds: string[]; done: boolean }> {
        if (done) {
          return { eventIds: [], done: true }
        }

        const batch: string[] = []

        while (batch.length < batchSize && currentLevel.length > 0 && depth < maxDepth) {
          const nextLevel: string[] = []

          for (const current of currentLevel) {
            let adjacencies: Map<LinkType, Set<string>> | undefined

            if (direction === 'ancestors') {
              adjacencies = linker.backwardLinks.get(current)
            } else {
              adjacencies = linker.forwardLinks.get(current)
            }

            if (adjacencies) {
              for (const type of linkTypes as LinkType[]) {
                const neighbors = adjacencies.get(type)
                if (neighbors) {
                  for (const neighborId of neighbors) {
                    if (!visited.has(neighborId)) {
                      visited.add(neighborId)
                      totalVisited++
                      batch.push(neighborId)
                      nextLevel.push(neighborId)

                      if (batch.length >= batchSize) {
                        // Save remaining items for next batch
                        currentLevel = nextLevel
                        return { eventIds: batch, done: false }
                      }
                    }
                  }
                }
              }
            }
          }

          currentLevel = nextLevel
          if (nextLevel.length > 0) {
            depth++
          }
        }

        done = currentLevel.length === 0 || depth >= maxDepth
        return { eventIds: batch, done }
      },

      currentDepth(): number {
        return depth
      },

      visitedCount(): number {
        return totalVisited
      },

      isDone(): boolean {
        return done
      },
    }
  }

  /**
   * Get graph statistics
   */
  getStats(): GraphStats {
    const linksByType: Record<LinkType, number> = {
      caused_by: 0,
      parent_child: 0,
      related: 0,
    }

    // Count links (avoiding double-counting bidirectional related links)
    const countedLinks = new Set<string>()
    for (const [key, link] of this.linkMetadata) {
      if (link.type === 'related') {
        // For related links, only count once (use sorted key)
        const normalizedKey = [link.sourceId, link.targetId].sort().join(':')
        if (!countedLinks.has(normalizedKey)) {
          countedLinks.add(normalizedKey)
          linksByType.related++
        }
      } else {
        linksByType[link.type]++
      }
    }

    // Calculate max causal depth
    let maxCausalDepth = 0
    const roots = this.getRootEvents()
    for (const root of roots) {
      const descendants = this.forwardLinks.get(root)
      if (descendants?.has('caused_by')) {
        const depth = this.calculateMaxDepth(root, 'caused_by')
        maxCausalDepth = Math.max(maxCausalDepth, depth)
      }
    }

    return {
      totalEvents: this.events.size,
      totalLinks: linksByType.caused_by + linksByType.parent_child + linksByType.related,
      linksByType,
      rootEvents: roots.length,
      leafEvents: this.getLeafEvents().length,
      maxCausalDepth,
    }
  }

  /**
   * Calculate maximum depth from an event following a specific link type
   */
  private calculateMaxDepth(eventId: string, type: LinkType): number {
    const visited = new Set<string>()
    let maxDepth = 0

    const dfs = (current: string, depth: number): void => {
      if (visited.has(current)) return
      visited.add(current)
      maxDepth = Math.max(maxDepth, depth)

      const forward = this.forwardLinks.get(current)
      if (forward) {
        const targets = forward.get(type)
        if (targets) {
          for (const target of targets) {
            dfs(target, depth + 1)
          }
        }
      }
    }

    dfs(eventId, 0)
    return maxDepth
  }

  /**
   * Clear all data from the linker
   */
  clear(): void {
    this.forwardLinks.clear()
    this.backwardLinks.clear()
    this.linkMetadata.clear()
    this.events.clear()
  }

  /**
   * Remove an event and all its links from the graph
   */
  removeEvent(eventId: string): boolean {
    if (!this.events.has(eventId)) {
      return false
    }

    // Remove all forward links from this event
    const forward = this.forwardLinks.get(eventId)
    if (forward) {
      for (const [type, targets] of forward) {
        for (const targetId of targets) {
          const linkKey = this.getLinkKey(eventId, targetId, type)
          this.linkMetadata.delete(linkKey)

          // Remove from target's backward links
          const targetBackward = this.backwardLinks.get(targetId)
          if (targetBackward) {
            const typeSet = targetBackward.get(type)
            if (typeSet) {
              typeSet.delete(eventId)
              if (typeSet.size === 0) {
                targetBackward.delete(type)
              }
            }
            if (targetBackward.size === 0) {
              this.backwardLinks.delete(targetId)
            }
          }
        }
      }
      this.forwardLinks.delete(eventId)
    }

    // Remove all backward links to this event
    const backward = this.backwardLinks.get(eventId)
    if (backward) {
      for (const [type, sources] of backward) {
        for (const sourceId of sources) {
          const linkKey = this.getLinkKey(sourceId, eventId, type)
          this.linkMetadata.delete(linkKey)

          // Remove from source's forward links
          const sourceForward = this.forwardLinks.get(sourceId)
          if (sourceForward) {
            const typeSet = sourceForward.get(type)
            if (typeSet) {
              typeSet.delete(eventId)
              if (typeSet.size === 0) {
                sourceForward.delete(type)
              }
            }
            if (sourceForward.size === 0) {
              this.forwardLinks.delete(sourceId)
            }
          }
        }
      }
      this.backwardLinks.delete(eventId)
    }

    this.events.delete(eventId)
    return true
  }

  /**
   * Export the graph as a serializable object
   */
  export(): { events: string[]; links: EventLink[] } {
    const links: EventLink[] = []
    const seen = new Set<string>()

    for (const link of this.linkMetadata.values()) {
      // For related links, avoid exporting both directions
      if (link.type === 'related') {
        const normalizedKey = [link.sourceId, link.targetId].sort().join(':')
        if (seen.has(normalizedKey)) continue
        seen.add(normalizedKey)
      }
      links.push(link)
    }

    return {
      events: Array.from(this.events),
      links,
    }
  }

  /**
   * Import a graph from a serialized object
   */
  async import(data: { events: string[]; links: EventLink[] }): Promise<void> {
    // Add all events first
    for (const eventId of data.events) {
      this.addEvent(eventId)
    }

    // Then add all links
    for (const link of data.links) {
      await this.link(link.sourceId, link.targetId, link.type, link.metadata)
    }
  }
}

/**
 * Factory function to create an EventLinker instance
 */
export function createEventLinker(): EventLinker {
  return new EventLinker()
}

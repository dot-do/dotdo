/**
 * SDK-5: Traversal Builder - Production Implementation
 *
 * A fluent builder for graph traversal queries.
 * Immutable: each method returns a new instance.
 */

// ============================================================================
// Types
// ============================================================================

export type Direction = 'out' | 'in' | 'both'

export type RelationType = string | string[] | undefined

export type Predicate = Record<string, unknown> | ((node: unknown) => boolean)

export interface TraverseStep {
  type: 'traverse'
  direction: Direction
  relationType: RelationType
}

export interface FilterStep {
  type: 'filter'
  predicate: Predicate
}

export interface LimitStep {
  type: 'limit'
  count: number
}

export interface SkipStep {
  type: 'skip'
  count: number
}

export interface DepthStep {
  type: 'depth'
  min: number
  max: number | undefined
}

export type TraversalStep = TraverseStep | FilterStep | LimitStep | SkipStep | DepthStep

// ============================================================================
// TraversalBuilder
// ============================================================================

export class TraversalBuilder {
  private readonly startNodes: string[]
  private readonly steps: TraversalStep[]

  constructor(startNodes: string[], steps: TraversalStep[] = []) {
    this.startNodes = [...startNodes]
    this.steps = [...steps]
  }

  // ==========================================================================
  // Direction Methods
  // ==========================================================================

  /**
   * Traverse outgoing edges
   */
  out(relType?: string | string[]): TraversalBuilder {
    return this.addStep({
      type: 'traverse',
      direction: 'out',
      relationType: relType,
    })
  }

  /**
   * Traverse incoming edges
   */
  in(relType?: string | string[]): TraversalBuilder {
    return this.addStep({
      type: 'traverse',
      direction: 'in',
      relationType: relType,
    })
  }

  /**
   * Traverse edges in both directions
   */
  both(relType?: string | string[]): TraversalBuilder {
    return this.addStep({
      type: 'traverse',
      direction: 'both',
      relationType: relType,
    })
  }

  // ==========================================================================
  // Filtering
  // ==========================================================================

  /**
   * Filter nodes by predicate
   */
  where(predicate: Predicate): TraversalBuilder {
    return this.addStep({
      type: 'filter',
      predicate,
    })
  }

  /**
   * Alias for where()
   */
  filter(predicate: Predicate): TraversalBuilder {
    return this.where(predicate)
  }

  // ==========================================================================
  // Pagination
  // ==========================================================================

  /**
   * Limit number of results
   */
  limit(count: number): TraversalBuilder {
    if (count < 0) {
      throw new Error('Limit cannot be negative')
    }
    return this.addStep({
      type: 'limit',
      count,
    })
  }

  /**
   * Skip results (for pagination)
   */
  skip(count: number): TraversalBuilder {
    if (count < 0) {
      throw new Error('Skip cannot be negative')
    }
    return this.addStep({
      type: 'skip',
      count,
    })
  }

  // ==========================================================================
  // Depth Control
  // ==========================================================================

  /**
   * Set traversal depth
   * @param d - Exact depth (number) or range ({ min, max })
   */
  depth(d: number | { min?: number; max?: number }): TraversalBuilder {
    let min: number
    let max: number | undefined

    if (typeof d === 'number') {
      if (d < 0) {
        throw new Error('Depth cannot be negative')
      }
      min = d
      max = d
    } else {
      // Range object
      if (d.min !== undefined && d.min < 0) {
        throw new Error('Depth min cannot be negative')
      }
      if (d.max !== undefined && d.max < 0) {
        throw new Error('Depth max cannot be negative')
      }
      if (d.min !== undefined && d.max !== undefined && d.min > d.max) {
        throw new Error('Depth min cannot be greater than max')
      }

      // Default min to 1 if only max is specified
      min = d.min ?? 1
      max = d.max
    }

    return this.addStep({
      type: 'depth',
      min,
      max,
    })
  }

  // ==========================================================================
  // State Access
  // ==========================================================================

  /**
   * Get all traversal steps
   * Returns a copy to maintain immutability
   */
  getSteps(): TraversalStep[] {
    return [...this.steps]
  }

  /**
   * Get start node IDs
   * Returns a copy to maintain immutability
   */
  getStartNodes(): string[] {
    return [...this.startNodes]
  }

  /**
   * Create an independent copy of this traversal
   */
  clone(): TraversalBuilder {
    return new TraversalBuilder(this.startNodes, this.steps)
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Add a step and return a new TraversalBuilder (immutable)
   */
  private addStep(step: TraversalStep): TraversalBuilder {
    return new TraversalBuilder(this.startNodes, [...this.steps, step])
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new TraversalBuilder starting from the given node IDs
 */
export function createTraversal(startNodeIds: string[]): TraversalBuilder {
  return new TraversalBuilder(startNodeIds)
}

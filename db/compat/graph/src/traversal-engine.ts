/**
 * Graph Traversal Engine - STUB FILE (RED Phase)
 *
 * This file contains only type definitions and stub exports.
 * The actual implementation is NOT done yet - this is the RED phase of TDD.
 *
 * All functions throw NotImplementedError to ensure tests fail properly.
 *
 * @see /db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts for reference
 */

// ============================================================================
// Types
// ============================================================================

export interface Thing {
  id: string
  type: string
  ns: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface Relationship {
  id: string
  type: string
  from: string
  to: string
  data?: Record<string, unknown>
  createdAt: number
}

export interface GraphNode<T extends Thing = Thing> {
  readonly $id: string
  readonly $type: string | string[]
  readonly data: Record<string, unknown>
}

export interface TraversalOptions {
  depth?: number | { min?: number; max?: number }
  direction?: 'out' | 'in' | 'both'
  edgeTypes?: string[]
  where?: Record<string, unknown> | ((node: Thing) => boolean)
  limit?: number
  skip?: number
  visitedMode?: VisitedSetMode
  returnDepths?: boolean
  returnPaths?: boolean
  returnStats?: boolean
}

export interface ChainStep {
  relType: string
  direction: 'out' | 'in'
  depth?: number | { min?: number; max?: number }
}

export interface ChainOptions {
  carryVisitedSet?: boolean
}

export interface TraversalResult {
  ids: string[]
  depths?: Map<string, number>
  paths?: Map<string, string[]>
  stats?: TraversalStats
}

export interface TraversalStats {
  nodesVisited: number
  edgesTraversed: number
  executionTimeMs: number
}

/**
 * Controls how the visited set is handled during traversal
 */
export enum VisitedSetMode {
  /** Source nodes are marked as visited from start (default) */
  SOURCE_EXCLUDED = 'source_excluded',
  /** Source nodes can be included in results if depth includes 0 */
  SOURCE_INCLUDED = 'source_included',
  /** Visited set only tracks within current depth level */
  TARGET_ONLY = 'target_only',
  /** No visited tracking (use with caution - may infinite loop without depth limit) */
  NONE = 'none',
}

// ============================================================================
// AdjacencyIndex - STUB
// ============================================================================

export class AdjacencyIndex {
  addEdge(_rel: Relationship): void {
    throw new Error('NOT IMPLEMENTED: AdjacencyIndex.addEdge')
  }

  getOutgoing(_vertexId: string, _edgeTypes?: string[]): Array<{ to: string; type: string }> {
    throw new Error('NOT IMPLEMENTED: AdjacencyIndex.getOutgoing')
  }

  getIncoming(_vertexId: string, _edgeTypes?: string[]): Array<{ from: string; type: string }> {
    throw new Error('NOT IMPLEMENTED: AdjacencyIndex.getIncoming')
  }

  getNeighbors(_vertexId: string, _direction: 'out' | 'in' | 'both', _edgeTypes?: string[]): string[] {
    throw new Error('NOT IMPLEMENTED: AdjacencyIndex.getNeighbors')
  }
}

// ============================================================================
// TraversalEngine - STUB
// ============================================================================

export class TraversalEngine {
  constructor(_index: AdjacencyIndex) {
    // STUB
  }

  /**
   * Breadth-first search with depth range support
   */
  async bfs(_startVertices: string[], _options: TraversalOptions): Promise<TraversalResult> {
    throw new Error('NOT IMPLEMENTED: TraversalEngine.bfs')
  }

  /**
   * Multi-step chaining traversal
   */
  async chain(
    _startVertices: string[],
    _steps: ChainStep[],
    _options?: ChainOptions
  ): Promise<TraversalResult> {
    throw new Error('NOT IMPLEMENTED: TraversalEngine.chain')
  }

  /**
   * Any outgoing relationship traversal
   */
  async $out(
    _startVertices: string[],
    _depth: number | { min?: number; max?: number },
    _options?: Omit<TraversalOptions, 'depth' | 'direction'>
  ): Promise<TraversalResult> {
    throw new Error('NOT IMPLEMENTED: TraversalEngine.$out')
  }

  /**
   * Any incoming relationship traversal
   */
  async $in(
    _startVertices: string[],
    _depth: number | { min?: number; max?: number },
    _options?: Omit<TraversalOptions, 'depth' | 'direction'>
  ): Promise<TraversalResult> {
    throw new Error('NOT IMPLEMENTED: TraversalEngine.$in')
  }

  /**
   * Any relationship, any direction (expand neighborhood)
   */
  async $expand(
    _startVertices: string[],
    _depth: number | { min?: number; max?: number },
    _options?: Omit<TraversalOptions, 'depth' | 'direction'>
  ): Promise<TraversalResult> {
    throw new Error('NOT IMPLEMENTED: TraversalEngine.$expand')
  }
}

// ============================================================================
// Factory Function - STUB
// ============================================================================

export function createTraversalEngine(index: AdjacencyIndex): TraversalEngine {
  return new TraversalEngine(index)
}

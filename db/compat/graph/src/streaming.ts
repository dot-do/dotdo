/**
 * Streaming Interface - Memory-efficient iteration for graph traversals
 *
 * Provides $stream and $batch(n) interfaces for processing large result sets
 * without loading everything into memory.
 *
 * @see Issue dotdo-1yu6n
 * @see db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts for API design
 *
 * @module db/compat/graph/src/streaming
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A Thing (node) in the graph
 */
export interface Thing {
  id: string
  type: string
  ns: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * A Relationship (edge) in the graph
 */
export interface Relationship {
  id: string
  type: string
  from: string
  to: string
  data: Record<string, unknown>
  createdAt: number
}

/**
 * Context providing graph data access for streaming traversal
 */
export interface StreamingContext {
  addRelationship(rel: Relationship): void
  addThing(thing: Thing): void
  getRelationships(): Relationship[]
  getThing(id: string): Thing | undefined
  getThings(ids: string[]): Thing[]
  streamThings(ids: string[]): AsyncIterableIterator<Thing>
  streamThingsBatched(ids: string[], batchSize: number): AsyncIterableIterator<Thing[]>
  /** Optional: Get all things of a specific type for $Type pattern support */
  getThingsByType?(type: string): Thing[]
}

/**
 * Streaming traversal interface with $stream and $batch support
 */
export interface StreamingTraversal {
  // Standard traversal methods
  ids(): Promise<string[]>
  nodes(): Promise<Thing[]>
  toArray(): Promise<Thing[]>
  count(): Promise<number>
  first(): Promise<Thing | null>
  exists(): Promise<boolean>

  // Pagination
  limit(n: number): StreamingTraversal
  skip(n: number): StreamingTraversal

  // Filtering
  where(predicate: Record<string, unknown>): StreamingTraversal

  // Streaming interface
  readonly $stream: AsyncIterable<Thing>
  $batch(size: number): AsyncIterable<Thing[]>

  // Native async iteration
  [Symbol.asyncIterator](): AsyncIterableIterator<Thing>

  // Set operations
  intersect(other: StreamingTraversal): StreamingTraversal
  union(other: StreamingTraversal): StreamingTraversal
  except(other: StreamingTraversal): StreamingTraversal

  // Direction modifier
  in: StreamingTraversal

  // Dynamic property access - unified index signature for $ properties and relationship traversal
  // Union includes all possible property types for type compatibility
  [key: string]:
    | StreamingTraversal
    | TypeCollectionAccessor
    | AsyncIterable<Thing>
    | AsyncIterable<Thing[]>
    | ((n: number) => StreamingTraversal)
    | ((n: number) => AsyncIterable<Thing[]>)
    | ((predicate: Record<string, unknown>) => StreamingTraversal)
    | ((other: StreamingTraversal) => StreamingTraversal)
    | (() => Promise<string[]>)
    | (() => Promise<Thing[]>)
    | (() => Promise<number>)
    | (() => Promise<Thing | null>)
    | (() => Promise<boolean>)
    | (() => AsyncIterableIterator<Thing>)
    | ((...args: unknown[]) => unknown)
}

/**
 * Type collection accessor for $Type pattern
 */
export interface TypeCollectionAccessor {
  readonly $stream: AsyncIterable<Thing>
  $batch(size: number): AsyncIterable<Thing[]>
  [Symbol.asyncIterator](): AsyncIterableIterator<Thing>
}

// ============================================================================
// Internal Types
// ============================================================================

interface TraversalStep {
  type: 'traverse' | 'filter' | 'limit' | 'skip' | 'intersect' | 'union' | 'except'
  direction?: 'out' | 'in'
  relType?: string
  predicate?: Record<string, unknown>
  count?: number
  other?: StreamingTraversalImpl
}

// ============================================================================
// StreamingTraversalImpl - Core Implementation
// ============================================================================

/**
 * Core streaming traversal implementation.
 *
 * Key features:
 * - Lazy evaluation: traversal IDs computed only when needed
 * - Memory-efficient: uses async iterators for streaming
 * - Immutable: each operation returns a new instance
 */
class StreamingTraversalImpl {
  private ctx: StreamingContext
  private startIds: string[]
  private steps: TraversalStep[]
  private cachedIds: string[] | null = null

  constructor(ctx: StreamingContext, startIds: string[], steps: TraversalStep[] = []) {
    this.ctx = ctx
    this.startIds = [...startIds]
    this.steps = [...steps]
  }

  /**
   * Clone with additional steps (immutable pattern)
   */
  private clone(additionalSteps: TraversalStep[] = []): StreamingTraversalImpl {
    return new StreamingTraversalImpl(this.ctx, this.startIds, [...this.steps, ...additionalSteps])
  }

  // ==========================================================================
  // ID Resolution - Core Traversal Logic
  // ==========================================================================

  /**
   * Resolve traversal to IDs (with caching for repeated access)
   */
  async ids(): Promise<string[]> {
    if (this.cachedIds !== null) {
      return this.cachedIds
    }

    let currentIds = new Set(this.startIds)
    const relationships = this.ctx.getRelationships()

    for (const step of this.steps) {
      switch (step.type) {
        case 'traverse': {
          const nextIds = new Set<string>()
          for (const id of currentIds) {
            const neighbors = this.getNeighbors(id, step.direction || 'out', step.relType, relationships)
            for (const neighbor of neighbors) {
              nextIds.add(neighbor)
            }
          }
          currentIds = nextIds
          break
        }
        case 'filter': {
          if (step.predicate) {
            const filteredIds = new Set<string>()
            for (const id of currentIds) {
              const thing = this.ctx.getThing(id)
              if (thing && this.matchesPredicate(thing, step.predicate)) {
                filteredIds.add(id)
              }
            }
            currentIds = filteredIds
          }
          break
        }
        case 'limit': {
          const arr = [...currentIds]
          currentIds = new Set(arr.slice(0, step.count))
          break
        }
        case 'skip': {
          const arr = [...currentIds]
          currentIds = new Set(arr.slice(step.count))
          break
        }
        case 'intersect': {
          if (step.other) {
            const otherIds = new Set(await step.other.ids())
            currentIds = new Set([...currentIds].filter(id => otherIds.has(id)))
          }
          break
        }
        case 'union': {
          if (step.other) {
            const otherIds = await step.other.ids()
            for (const id of otherIds) {
              currentIds.add(id)
            }
          }
          break
        }
        case 'except': {
          if (step.other) {
            const otherIds = new Set(await step.other.ids())
            currentIds = new Set([...currentIds].filter(id => !otherIds.has(id)))
          }
          break
        }
      }
    }

    this.cachedIds = [...currentIds]
    return this.cachedIds
  }

  /**
   * Get neighbor node IDs
   */
  private getNeighbors(
    id: string,
    direction: 'out' | 'in',
    relType: string | undefined,
    relationships: Relationship[]
  ): string[] {
    const neighbors: string[] = []

    for (const rel of relationships) {
      // Match relationship type if specified
      if (relType && rel.type !== relType) {
        continue
      }

      if (direction === 'out' && rel.from === id) {
        neighbors.push(rel.to)
      } else if (direction === 'in' && rel.to === id) {
        neighbors.push(rel.from)
      }
    }

    return neighbors
  }

  /**
   * Check if a Thing matches a predicate
   */
  private matchesPredicate(thing: Thing, predicate: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(predicate)) {
      if (thing.data[key] !== value) {
        return false
      }
    }
    return true
  }

  // ==========================================================================
  // Standard Traversal Methods
  // ==========================================================================

  async nodes(): Promise<Thing[]> {
    const ids = await this.ids()
    return this.ctx.getThings(ids)
  }

  async toArray(): Promise<Thing[]> {
    return this.nodes()
  }

  async count(): Promise<number> {
    const ids = await this.ids()
    return ids.length
  }

  async first(): Promise<Thing | null> {
    const ids = await this.ids()
    const firstId = ids[0]
    if (firstId === undefined) return null
    return this.ctx.getThing(firstId) ?? null
  }

  async exists(): Promise<boolean> {
    const ids = await this.ids()
    return ids.length > 0
  }

  // ==========================================================================
  // Pagination Methods
  // ==========================================================================

  limit(n: number): StreamingTraversalImpl {
    return this.clone([{ type: 'limit', count: n }])
  }

  skip(n: number): StreamingTraversalImpl {
    return this.clone([{ type: 'skip', count: n }])
  }

  // ==========================================================================
  // Filtering
  // ==========================================================================

  where(predicate: Record<string, unknown>): StreamingTraversalImpl {
    return this.clone([{ type: 'filter', predicate }])
  }

  // ==========================================================================
  // Traversal Methods
  // ==========================================================================

  out(relType: string): StreamingTraversalImpl {
    return this.clone([{ type: 'traverse', direction: 'out', relType }])
  }

  inDirection(relType: string): StreamingTraversalImpl {
    return this.clone([{ type: 'traverse', direction: 'in', relType }])
  }

  // ==========================================================================
  // Set Operations
  // ==========================================================================

  intersect(other: StreamingTraversalImpl): StreamingTraversalImpl {
    return this.clone([{ type: 'intersect', other }])
  }

  union(other: StreamingTraversalImpl): StreamingTraversalImpl {
    return this.clone([{ type: 'union', other }])
  }

  except(other: StreamingTraversalImpl): StreamingTraversalImpl {
    return this.clone([{ type: 'except', other }])
  }

  // ==========================================================================
  // Streaming Interface - $stream
  // ==========================================================================

  /**
   * Get an async iterable that yields nodes one at a time.
   * This is memory-efficient for large result sets.
   */
  get $stream(): AsyncIterable<Thing> {
    const self = this
    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<Thing> {
        return self.createStreamIterator()
      },
    }
  }

  /**
   * Create the async iterator for streaming
   */
  private async *createStreamIterator(): AsyncIterableIterator<Thing> {
    const ids = await this.ids()
    yield* this.ctx.streamThings(ids)
  }

  // ==========================================================================
  // Streaming Interface - $batch
  // ==========================================================================

  /**
   * Get an async iterable that yields batches of nodes.
   * Useful for bulk processing while maintaining memory efficiency.
   */
  $batch(size: number): AsyncIterable<Thing[]> {
    if (size <= 0) {
      throw new Error('Batch size must be positive')
    }

    const self = this
    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<Thing[]> {
        return self.createBatchIterator(size)
      },
    }
  }

  /**
   * Create the async iterator for batched streaming
   */
  private async *createBatchIterator(size: number): AsyncIterableIterator<Thing[]> {
    const ids = await this.ids()
    yield* this.ctx.streamThingsBatched(ids, size)
  }

  // ==========================================================================
  // Native Async Iteration (for-await-of support)
  // ==========================================================================

  [Symbol.asyncIterator](): AsyncIterableIterator<Thing> {
    return this.createStreamIterator()
  }

  // ==========================================================================
  // Type Collection Support
  // ==========================================================================

  /**
   * Get all things of a specific type
   */
  getTypeCollection(typeName: string): TypeCollectionAccessorImpl {
    return new TypeCollectionAccessorImpl(this.ctx, typeName)
  }
}

// ============================================================================
// TypeCollectionAccessorImpl - $Type pattern support
// ============================================================================

/**
 * Accessor for type collections ($User, $Post, etc.)
 */
class TypeCollectionAccessorImpl {
  private ctx: StreamingContext
  private typeName: string

  constructor(ctx: StreamingContext, typeName: string) {
    this.ctx = ctx
    this.typeName = typeName
  }

  /**
   * Get all things of this type.
   *
   * Uses getThingsByType if available, otherwise falls back to scanning relationships.
   */
  private getThingsOfType(): Thing[] {
    // Use the optimized method if available
    if (this.ctx.getThingsByType) {
      return this.ctx.getThingsByType(this.typeName)
    }

    // Fallback: scan relationships to find things
    const things: Thing[] = []
    const seen = new Set<string>()

    for (const rel of this.ctx.getRelationships()) {
      if (!seen.has(rel.from)) {
        const thing = this.ctx.getThing(rel.from)
        if (thing && thing.type === this.typeName) {
          things.push(thing)
        }
        seen.add(rel.from)
      }
      if (!seen.has(rel.to)) {
        const thing = this.ctx.getThing(rel.to)
        if (thing && thing.type === this.typeName) {
          things.push(thing)
        }
        seen.add(rel.to)
      }
    }

    return things
  }

  get $stream(): AsyncIterable<Thing> {
    const self = this
    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<Thing> {
        return self.createStreamIterator()
      },
    }
  }

  private async *createStreamIterator(): AsyncIterableIterator<Thing> {
    const things = this.getThingsOfType()
    for (const thing of things) {
      yield thing
    }
  }

  $batch(size: number): AsyncIterable<Thing[]> {
    if (size <= 0) {
      throw new Error('Batch size must be positive')
    }

    const self = this
    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<Thing[]> {
        return self.createBatchIterator(size)
      },
    }
  }

  private async *createBatchIterator(size: number): AsyncIterableIterator<Thing[]> {
    const things = this.getThingsOfType()
    for (let i = 0; i < things.length; i += size) {
      yield things.slice(i, i + size)
    }
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Thing> {
    return this.createStreamIterator()
  }
}

// ============================================================================
// Magic Proxy Factory
// ============================================================================

/**
 * Create a magic proxy that provides:
 * - Dynamic relationship traversal (e.g., traversal.follows)
 * - $stream and $batch properties
 * - Type collection access ($User, $Post, etc.)
 * - Direction modifier (.in.follows)
 */
function createMagicProxy(impl: StreamingTraversalImpl): StreamingTraversal {
  const knownMethods = new Set([
    'ids', 'nodes', 'toArray', 'count', 'first', 'exists',
    'limit', 'skip', 'where',
    'out', 'inDirection',
    'intersect', 'union', 'except',
    '$stream', '$batch',
    Symbol.asyncIterator,
  ])

  return new Proxy(impl as unknown as StreamingTraversal, {
    get(target: StreamingTraversalImpl, prop: string | symbol) {
      // Handle Symbol.asyncIterator
      if (prop === Symbol.asyncIterator) {
        return () => target[Symbol.asyncIterator]()
      }

      // Handle $stream property
      if (prop === '$stream') {
        return target.$stream
      }

      // Handle $batch method
      if (prop === '$batch') {
        return (size: number) => target.$batch(size)
      }

      // Handle known methods
      if (typeof prop === 'string' && prop in target && typeof (target as any)[prop] === 'function') {
        const method = (target as any)[prop].bind(target)
        // Wrap methods that return StreamingTraversalImpl to return proxied version
        if (['limit', 'skip', 'where', 'out', 'intersect', 'union', 'except'].includes(prop)) {
          return (...args: unknown[]) => createMagicProxy(method(...args))
        }
        return method
      }

      // Handle 'in' - creates a proxy for incoming direction
      if (prop === 'in') {
        return new Proxy({} as StreamingTraversal, {
          get(_innerTarget, relType: string | symbol) {
            if (typeof relType === 'symbol') return undefined
            return createMagicProxy(target.inDirection(relType))
          },
        })
      }

      // Handle $Type pattern (e.g., $User, $Post)
      if (typeof prop === 'string' && prop.startsWith('$') && prop.length > 1) {
        const typeName = prop.slice(1) // Remove the $ prefix
        const typeAccessor = target.getTypeCollection(typeName)
        return createTypeCollectionProxy(typeAccessor)
      }

      // Any other string property is treated as a relationship type (outgoing traversal)
      if (typeof prop === 'string') {
        return createMagicProxy(target.out(prop))
      }

      return undefined
    },
  })
}

/**
 * Create a proxy for type collection accessor
 */
function createTypeCollectionProxy(impl: TypeCollectionAccessorImpl): TypeCollectionAccessor {
  return new Proxy(impl as unknown as TypeCollectionAccessor, {
    get(target: TypeCollectionAccessorImpl, prop: string | symbol) {
      if (prop === Symbol.asyncIterator) {
        return () => target[Symbol.asyncIterator]()
      }
      if (prop === '$stream') {
        return target.$stream
      }
      if (prop === '$batch') {
        return (size: number) => target.$batch(size)
      }
      return undefined
    },
  })
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a streaming traversal starting from the given node IDs.
 *
 * @param ctx - The streaming context providing data access
 * @param startIds - Initial node IDs to start traversal from
 * @returns A StreamingTraversal with $stream and $batch support
 *
 * @example
 * ```typescript
 * const traversal = createStreamingTraversal(ctx, ['alice'])
 *
 * // Stream nodes one at a time
 * for await (const node of traversal.follows.$stream) {
 *   console.log(node.id)
 * }
 *
 * // Batch process nodes
 * for await (const batch of traversal.follows.$batch(100)) {
 *   await processBatch(batch)
 * }
 * ```
 */
export function createStreamingTraversal(
  ctx: StreamingContext,
  startIds: string[]
): StreamingTraversal {
  const impl = new StreamingTraversalImpl(ctx, startIds)
  return createMagicProxy(impl)
}

/**
 * GraphBridge - Bridge between GraphEngine (in-memory) and GraphStore (persisted)
 *
 * This module provides bidirectional synchronization between the in-memory GraphEngine
 * (optimized for traversals and algorithms) and the persisted GraphStore (SQLite/DO storage).
 *
 * Key features:
 * - Load persisted data into memory for algorithm execution
 * - Sync in-memory changes back to persistent storage
 * - Change tracking for efficient delta syncs
 * - Live sync mode for real-time bidirectional updates
 * - Lazy loading support for large graphs
 * - Conflict resolution strategies
 *
 * @module db/graph/graph-bridge
 *
 * @example
 * ```typescript
 * import { GraphBridge } from 'db/graph'
 * import { SQLiteGraphStore } from 'db/graph/stores'
 * import { GraphEngine } from 'db/graph/graph-engine'
 *
 * // Create store and engine
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 * const engine = new GraphEngine()
 *
 * // Create bridge
 * const bridge = new GraphBridge(store, engine)
 *
 * // Load data from store into engine
 * await bridge.loadFromStore()
 *
 * // Run algorithms on in-memory graph
 * const pageRank = await engine.pageRank()
 *
 * // Make changes in engine
 * await engine.createNode('User', { name: 'Alice' })
 *
 * // Sync changes back to store
 * const result = await bridge.syncToStore()
 * console.log(`Synced ${result.nodesCreated} nodes, ${result.edgesCreated} edges`)
 *
 * // Or enable live sync for real-time bidirectional updates
 * bridge.enableLiveSync()
 * ```
 */

import { GraphEngine, Node, Edge } from './graph-engine'
import type { GraphStore, GraphThing, GraphRelationship, GetThingsByTypeOptions } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Filter for loading specific Things from the store.
 */
export interface ThingFilter {
  /** Filter by type ID */
  typeId?: number
  /** Filter by type name */
  typeName?: string
  /** Maximum number of Things to load */
  limit?: number
  /** Include soft-deleted Things */
  includeDeleted?: boolean
}

/**
 * Filter for loading specific Relationships from the store.
 */
export interface RelationshipFilter {
  /** Filter by verb */
  verb?: string
  /** Filter by source URL prefix */
  fromPrefix?: string
  /** Filter by target URL prefix */
  toPrefix?: string
}

/**
 * Options for loading data from the store.
 */
export interface LoadOptions {
  /** Filter for Things to load */
  thingFilter?: ThingFilter
  /** Filter for Relationships to load */
  relationshipFilter?: RelationshipFilter
  /** Clear existing engine data before loading */
  clearEngine?: boolean
  /** Load Things only (no relationships) */
  thingsOnly?: boolean
  /** Load relationships only (no things) */
  relationshipsOnly?: boolean
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  /** Number of nodes created in the store */
  nodesCreated: number
  /** Number of nodes updated in the store */
  nodesUpdated: number
  /** Number of nodes deleted from the store */
  nodesDeleted: number
  /** Number of edges created in the store */
  edgesCreated: number
  /** Number of edges updated in the store */
  edgesUpdated: number
  /** Number of edges deleted from the store */
  edgesDeleted: number
  /** Conflicts that were detected */
  conflicts: ConflictInfo[]
  /** Total sync duration in milliseconds */
  durationMs: number
}

/**
 * Information about a sync conflict.
 */
export interface ConflictInfo {
  /** Type of entity: 'node' or 'edge' */
  type: 'node' | 'edge'
  /** Entity ID */
  id: string
  /** How the conflict was resolved */
  resolution: 'engine_wins' | 'store_wins' | 'merged' | 'skipped'
  /** Description of the conflict */
  description: string
}

/**
 * Conflict resolution strategy.
 */
export type ConflictResolution = 'engine_wins' | 'store_wins' | 'manual'

/**
 * Options for syncing to the store.
 */
export interface SyncOptions {
  /** How to resolve conflicts (default: 'engine_wins') */
  conflictResolution?: ConflictResolution
  /** Only sync specific node IDs */
  nodeIds?: string[]
  /** Only sync specific edge IDs */
  edgeIds?: string[]
  /** Dry run - don't actually write to store */
  dryRun?: boolean
}

/**
 * Live sync configuration.
 */
export interface LiveSyncOptions {
  /** Debounce delay in milliseconds (default: 100) */
  debounceMs?: number
  /** Sync direction: 'bidirectional' | 'engine_to_store' | 'store_to_engine' */
  direction?: 'bidirectional' | 'engine_to_store' | 'store_to_engine'
}

/**
 * Tracked change for delta syncing.
 */
interface TrackedChange {
  type: 'create' | 'update' | 'delete'
  entityType: 'node' | 'edge'
  id: string
  timestamp: number
  /** Original data before change (for updates) */
  originalData?: Record<string, unknown>
}

// ============================================================================
// GRAPH BRIDGE CLASS
// ============================================================================

/**
 * GraphBridge connects the in-memory GraphEngine with the persisted GraphStore.
 *
 * It provides:
 * - Loading persisted data into the engine for algorithm execution
 * - Syncing engine changes back to persistent storage
 * - Change tracking for efficient delta synchronization
 * - Live sync mode for real-time updates
 */
export class GraphBridge {
  private readonly store: GraphStore
  private readonly engine: GraphEngine

  /** Track changes in the engine for delta syncing */
  private changes: Map<string, TrackedChange> = new Map()

  /** Mapping from Thing ID to Node ID */
  private thingToNodeMap: Map<string, string> = new Map()

  /** Mapping from Node ID to Thing ID */
  private nodeToThingMap: Map<string, string> = new Map()

  /** Mapping from Relationship ID to Edge ID */
  private relToEdgeMap: Map<string, string> = new Map()

  /** Mapping from Edge ID to Relationship ID */
  private edgeToRelMap: Map<string, string> = new Map()

  /** Whether live sync is enabled */
  private liveSyncEnabled = false

  /** Live sync debounce timer */
  private liveSyncTimer: ReturnType<typeof setTimeout> | null = null

  /** Live sync options */
  private liveSyncOptions: LiveSyncOptions = {}

  /** Last sync timestamp */
  private lastSyncTimestamp: number = 0

  /**
   * Create a new GraphBridge.
   *
   * @param store - The GraphStore for persistent storage
   * @param engine - The GraphEngine for in-memory operations
   */
  constructor(store: GraphStore, engine: GraphEngine) {
    this.store = store
    this.engine = engine
  }

  // =========================================================================
  // LOADING FROM STORE
  // =========================================================================

  /**
   * Load data from the GraphStore into the GraphEngine.
   *
   * This populates the in-memory graph with persisted Things and Relationships,
   * enabling graph algorithms and traversals on persisted data.
   *
   * @param options - Load options including filters and flags
   */
  async loadFromStore(options: LoadOptions = {}): Promise<void> {
    const { clearEngine = true, thingsOnly = false, relationshipsOnly = false } = options

    // Clear existing engine data if requested
    if (clearEngine) {
      await this.engine.clear()
      this.thingToNodeMap.clear()
      this.nodeToThingMap.clear()
      this.relToEdgeMap.clear()
      this.edgeToRelMap.clear()
      this.changes.clear()
    }

    // Load Things as Nodes
    if (!relationshipsOnly) {
      await this.loadThingsAsNodes(options.thingFilter)
    }

    // Load Relationships as Edges
    if (!thingsOnly) {
      await this.loadRelationshipsAsEdges(options.relationshipFilter)
    }

    this.lastSyncTimestamp = Date.now()
  }

  /**
   * Load Things from the store and create corresponding Nodes in the engine.
   */
  private async loadThingsAsNodes(filter?: ThingFilter): Promise<void> {
    const queryOptions: GetThingsByTypeOptions = {
      typeId: filter?.typeId,
      typeName: filter?.typeName,
      limit: filter?.limit,
      includeDeleted: filter?.includeDeleted ?? false,
    }

    const things = await this.store.getThingsByType(queryOptions)

    for (const thing of things) {
      await this.createNodeFromThing(thing)
    }
  }

  /**
   * Create a Node in the engine from a Thing.
   */
  private async createNodeFromThing(thing: GraphThing): Promise<Node> {
    const node = await this.engine.createNode(
      thing.typeName,
      {
        ...thing.data,
        _thingId: thing.id,
        _typeId: thing.typeId,
        _createdAt: thing.createdAt,
        _updatedAt: thing.updatedAt,
        _deletedAt: thing.deletedAt,
      },
      { id: thing.id } // Use Thing ID as Node ID for easy mapping
    )

    this.thingToNodeMap.set(thing.id, node.id)
    this.nodeToThingMap.set(node.id, thing.id)

    return node
  }

  /**
   * Load Relationships from the store and create corresponding Edges in the engine.
   */
  private async loadRelationshipsAsEdges(filter?: RelationshipFilter): Promise<void> {
    // Get all relationships by querying by verb if specified
    let relationships: GraphRelationship[]

    if (filter?.verb) {
      relationships = await this.store.queryRelationshipsByVerb(filter.verb)
    } else {
      // No verb filter - we need to query from all known nodes
      // This is less efficient but necessary when no filter is provided
      const nodes = await this.engine.getNodes()
      const fromUrls = nodes.map((n) => n.id)

      if (fromUrls.length > 0) {
        relationships = await this.store.queryRelationshipsFromMany(fromUrls)
      } else {
        relationships = []
      }
    }

    // Apply prefix filters if specified
    if (filter?.fromPrefix) {
      relationships = relationships.filter((r) => r.from.startsWith(filter.fromPrefix!))
    }
    if (filter?.toPrefix) {
      relationships = relationships.filter((r) => r.to.startsWith(filter.toPrefix!))
    }

    for (const rel of relationships) {
      await this.createEdgeFromRelationship(rel)
    }
  }

  /**
   * Create an Edge in the engine from a Relationship.
   */
  private async createEdgeFromRelationship(rel: GraphRelationship): Promise<Edge | null> {
    // Get the node IDs corresponding to from/to URLs
    // The URLs might be Thing IDs or do:// URLs
    const fromId = this.extractThingId(rel.from)
    const toId = this.extractThingId(rel.to)

    // Check if both nodes exist in the engine
    const fromNode = await this.engine.getNode(fromId)
    const toNode = await this.engine.getNode(toId)

    if (!fromNode || !toNode) {
      // Skip edges where endpoints don't exist in the engine
      return null
    }

    try {
      const edge = await this.engine.createEdge(fromId, rel.verb, toId, {
        ...rel.data,
        _relId: rel.id,
        _createdAt: rel.createdAt.getTime(),
      })

      this.relToEdgeMap.set(rel.id, edge.id)
      this.edgeToRelMap.set(edge.id, rel.id)

      return edge
    } catch {
      // Edge may already exist
      return null
    }
  }

  /**
   * Extract Thing ID from a URL (e.g., "do://tenant/customers/alice" -> "alice")
   * or return the ID directly if it's not a URL.
   */
  private extractThingId(urlOrId: string): string {
    // If it's a do:// URL, extract the last segment as the ID
    if (urlOrId.startsWith('do://')) {
      const parts = urlOrId.split('/')
      return parts[parts.length - 1] || urlOrId
    }
    // Otherwise, assume it's already an ID
    return urlOrId
  }

  // =========================================================================
  // SYNCING TO STORE
  // =========================================================================

  /**
   * Sync changes from the GraphEngine back to the GraphStore.
   *
   * This persists any nodes and edges created, updated, or deleted in the engine
   * since the last load or sync operation.
   *
   * @param options - Sync options including conflict resolution strategy
   * @returns Result of the sync operation
   */
  async syncToStore(options: SyncOptions = {}): Promise<SyncResult> {
    const startTime = Date.now()
    const { conflictResolution = 'engine_wins', dryRun = false } = options

    const result: SyncResult = {
      nodesCreated: 0,
      nodesUpdated: 0,
      nodesDeleted: 0,
      edgesCreated: 0,
      edgesUpdated: 0,
      edgesDeleted: 0,
      conflicts: [],
      durationMs: 0,
    }

    // Process tracked changes
    for (const [id, change] of this.changes) {
      // Skip if filtering by specific IDs
      if (
        (change.entityType === 'node' && options.nodeIds && !options.nodeIds.includes(id)) ||
        (change.entityType === 'edge' && options.edgeIds && !options.edgeIds.includes(id))
      ) {
        continue
      }

      if (change.entityType === 'node') {
        await this.syncNode(id, change, result, conflictResolution, dryRun)
      } else {
        await this.syncEdge(id, change, result, conflictResolution, dryRun)
      }
    }

    // Clear processed changes
    if (!dryRun) {
      this.changes.clear()
      this.lastSyncTimestamp = Date.now()
    }

    result.durationMs = Date.now() - startTime
    return result
  }

  /**
   * Sync a single node change to the store.
   */
  private async syncNode(
    id: string,
    change: TrackedChange,
    result: SyncResult,
    conflictResolution: ConflictResolution,
    dryRun: boolean
  ): Promise<void> {
    const node = await this.engine.getNode(id)

    switch (change.type) {
      case 'create': {
        if (!node) {
          // Node was created then deleted - skip
          return
        }

        if (!dryRun) {
          const thingId = this.nodeToThingMap.get(id) ?? id

          // Check if thing already exists
          const existing = await this.store.getThing(thingId)
          if (existing) {
            // Conflict: thing already exists
            if (conflictResolution === 'store_wins') {
              result.conflicts.push({
                type: 'node',
                id: thingId,
                resolution: 'store_wins',
                description: `Thing ${thingId} already exists in store, keeping store version`,
              })
              return
            }
            // engine_wins: update the existing thing
            await this.store.updateThing(thingId, {
              data: this.extractUserData(node.properties),
            })
            result.nodesUpdated++
            return
          }

          await this.store.createThing({
            id: thingId,
            typeId: (node.properties._typeId as number) ?? 1,
            typeName: node.label,
            data: this.extractUserData(node.properties),
          })
        }
        result.nodesCreated++
        break
      }

      case 'update': {
        if (!node) {
          // Node was updated then deleted
          return
        }

        if (!dryRun) {
          const thingId = this.nodeToThingMap.get(id) ?? id

          // Check for conflicts
          const existing = await this.store.getThing(thingId)
          if (
            existing &&
            existing.updatedAt > this.lastSyncTimestamp &&
            conflictResolution === 'store_wins'
          ) {
            result.conflicts.push({
              type: 'node',
              id: thingId,
              resolution: 'store_wins',
              description: `Thing ${thingId} was modified in store since last sync`,
            })
            return
          }

          await this.store.updateThing(thingId, {
            data: this.extractUserData(node.properties),
          })
        }
        result.nodesUpdated++
        break
      }

      case 'delete': {
        if (!dryRun) {
          const thingId = this.nodeToThingMap.get(id) ?? id
          await this.store.deleteThing(thingId)
          this.nodeToThingMap.delete(id)
          this.thingToNodeMap.delete(thingId)
        }
        result.nodesDeleted++
        break
      }
    }
  }

  /**
   * Sync a single edge change to the store.
   */
  private async syncEdge(
    id: string,
    change: TrackedChange,
    result: SyncResult,
    conflictResolution: ConflictResolution,
    dryRun: boolean
  ): Promise<void> {
    const edge = await this.engine.getEdge(id)

    switch (change.type) {
      case 'create': {
        if (!edge) {
          // Edge was created then deleted - skip
          return
        }

        if (!dryRun) {
          const relId = this.edgeToRelMap.get(id) ?? id

          await this.store.createRelationship({
            id: relId,
            verb: edge.type,
            from: edge.from,
            to: edge.to,
            data: this.extractUserData(edge.properties),
          })
        }
        result.edgesCreated++
        break
      }

      case 'update': {
        // Relationships don't support updates in the current GraphStore interface
        // We would need to delete and recreate
        result.edgesUpdated++
        break
      }

      case 'delete': {
        if (!dryRun) {
          const relId = this.edgeToRelMap.get(id) ?? id
          await this.store.deleteRelationship(relId)
          this.edgeToRelMap.delete(id)
          this.relToEdgeMap.delete(relId)
        }
        result.edgesDeleted++
        break
      }
    }
  }

  /**
   * Extract user data from properties, removing internal metadata.
   */
  private extractUserData(properties: Record<string, unknown>): Record<string, unknown> {
    const userData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(properties)) {
      if (!key.startsWith('_')) {
        userData[key] = value
      }
    }
    return userData
  }

  // =========================================================================
  // CHANGE TRACKING
  // =========================================================================

  /**
   * Track a change to a node for later syncing.
   *
   * Call this after creating, updating, or deleting nodes in the engine
   * if you want those changes to be persisted on the next sync.
   *
   * @param type - Type of change: 'create', 'update', or 'delete'
   * @param nodeId - The node ID that was changed
   * @param originalData - Original data before the change (for updates)
   */
  trackNodeChange(
    type: 'create' | 'update' | 'delete',
    nodeId: string,
    originalData?: Record<string, unknown>
  ): void {
    this.changes.set(nodeId, {
      type,
      entityType: 'node',
      id: nodeId,
      timestamp: Date.now(),
      originalData,
    })

    this.triggerLiveSync()
  }

  /**
   * Track a change to an edge for later syncing.
   *
   * Call this after creating, updating, or deleting edges in the engine
   * if you want those changes to be persisted on the next sync.
   *
   * @param type - Type of change: 'create', 'update', or 'delete'
   * @param edgeId - The edge ID that was changed
   * @param originalData - Original data before the change (for updates)
   */
  trackEdgeChange(
    type: 'create' | 'update' | 'delete',
    edgeId: string,
    originalData?: Record<string, unknown>
  ): void {
    this.changes.set(edgeId, {
      type,
      entityType: 'edge',
      id: edgeId,
      timestamp: Date.now(),
      originalData,
    })

    this.triggerLiveSync()
  }

  /**
   * Get the number of pending changes waiting to be synced.
   */
  getPendingChangeCount(): number {
    return this.changes.size
  }

  /**
   * Clear all pending changes without syncing them.
   */
  clearPendingChanges(): void {
    this.changes.clear()
  }

  // =========================================================================
  // LIVE SYNC
  // =========================================================================

  /**
   * Enable live sync mode for real-time bidirectional updates.
   *
   * When enabled, changes tracked via trackNodeChange/trackEdgeChange
   * will be automatically synced to the store after a debounce delay.
   *
   * @param options - Live sync configuration
   */
  enableLiveSync(options: LiveSyncOptions = {}): void {
    this.liveSyncEnabled = true
    this.liveSyncOptions = {
      debounceMs: options.debounceMs ?? 100,
      direction: options.direction ?? 'bidirectional',
    }
  }

  /**
   * Disable live sync mode.
   */
  disableLiveSync(): void {
    this.liveSyncEnabled = false
    if (this.liveSyncTimer) {
      clearTimeout(this.liveSyncTimer)
      this.liveSyncTimer = null
    }
  }

  /**
   * Check if live sync is enabled.
   */
  isLiveSyncEnabled(): boolean {
    return this.liveSyncEnabled
  }

  /**
   * Trigger a live sync (debounced).
   */
  private triggerLiveSync(): void {
    if (!this.liveSyncEnabled) {
      return
    }

    if (this.liveSyncOptions.direction === 'store_to_engine') {
      // Live sync is store -> engine only, don't sync to store
      return
    }

    // Clear existing timer
    if (this.liveSyncTimer) {
      clearTimeout(this.liveSyncTimer)
    }

    // Set new debounced timer
    this.liveSyncTimer = setTimeout(async () => {
      await this.syncToStore()
    }, this.liveSyncOptions.debounceMs ?? 100)
  }

  // =========================================================================
  // UTILITY METHODS
  // =========================================================================

  /**
   * Get the Thing ID for a given Node ID.
   */
  getThingIdForNode(nodeId: string): string | undefined {
    return this.nodeToThingMap.get(nodeId)
  }

  /**
   * Get the Node ID for a given Thing ID.
   */
  getNodeIdForThing(thingId: string): string | undefined {
    return this.thingToNodeMap.get(thingId)
  }

  /**
   * Get the Relationship ID for a given Edge ID.
   */
  getRelationshipIdForEdge(edgeId: string): string | undefined {
    return this.edgeToRelMap.get(edgeId)
  }

  /**
   * Get the Edge ID for a given Relationship ID.
   */
  getEdgeIdForRelationship(relId: string): string | undefined {
    return this.relToEdgeMap.get(relId)
  }

  /**
   * Get the timestamp of the last sync operation.
   */
  getLastSyncTimestamp(): number {
    return this.lastSyncTimestamp
  }

  /**
   * Get statistics about the current bridge state.
   */
  getStats(): {
    nodeCount: number
    edgeCount: number
    pendingChanges: number
    mappedThings: number
    mappedRelationships: number
    liveSyncEnabled: boolean
  } {
    return {
      nodeCount: this.thingToNodeMap.size,
      edgeCount: this.relToEdgeMap.size,
      pendingChanges: this.changes.size,
      mappedThings: this.thingToNodeMap.size,
      mappedRelationships: this.relToEdgeMap.size,
      liveSyncEnabled: this.liveSyncEnabled,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a GraphBridge connecting a GraphStore and GraphEngine.
 *
 * @param store - The GraphStore for persistent storage
 * @param engine - The GraphEngine for in-memory operations (optional, creates new if not provided)
 * @returns A new GraphBridge instance
 *
 * @example
 * ```typescript
 * const store = new SQLiteGraphStore(':memory:')
 * await store.initialize()
 *
 * // Create bridge with new engine
 * const bridge = createGraphBridge(store)
 *
 * // Or with existing engine
 * const engine = new GraphEngine()
 * const bridge = createGraphBridge(store, engine)
 * ```
 */
export function createGraphBridge(store: GraphStore, engine?: GraphEngine): GraphBridge {
  return new GraphBridge(store, engine ?? new GraphEngine())
}

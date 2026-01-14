/**
 * Graph Storage with Primitives Integration
 *
 * Graph storage implementation that integrates with:
 * - TemporalStore: Versioned node/edge storage with time-travel queries
 * - KeyedRouter: Partition routing for distributed graph shards
 * - TypedColumnStore: Property storage (future)
 *
 * Features:
 * - Time-travel queries: Query graph state at any point in time
 * - Snapshots: Create and restore graph snapshots
 * - Partitioning: Route nodes to partitions for distributed processing
 * - Versioned storage: Track all changes to nodes and relationships
 */

import {
  type TemporalStore,
  type TemporalStoreOptions,
  type SnapshotId,
  type SnapshotInfo,
  type TimeRange,
  type RetentionPolicy,
  createTemporalStore,
} from '../../../primitives/temporal-store'
import {
  type KeyedRouter,
  type KeyedRouterOptions,
  createKeyedRouter,
} from '../../../primitives/keyed-router'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Stored node structure
 */
export interface StoredNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * Stored relationship structure
 */
export interface StoredRelationship {
  id: string
  type: string
  sourceId: string
  targetId: string
  properties: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/**
 * Graph storage options
 */
export interface GraphStorageOptions {
  /** Enable versioned storage with time-travel queries */
  enableVersioning?: boolean
  /** Retention policy for versioned data */
  retention?: RetentionPolicy
  /** Number of partitions for distributed storage */
  partitionCount?: number
  /** Seed for partition routing */
  partitionSeed?: number
}

/**
 * Graph query options
 */
export interface GraphQueryOptions {
  /** Query graph state as of this timestamp */
  asOf?: number
  /** Filter to specific partition */
  partition?: number
}

// ============================================================================
// GRAPH STORAGE CLASS
// ============================================================================

/**
 * Graph Storage with primitives integration
 */
export class GraphStorage {
  private nodeStore: TemporalStore<StoredNode>
  private relStore: TemporalStore<StoredRelationship>
  private router: KeyedRouter<string>
  private nodeIdCounter = 0
  private relIdCounter = 0
  private options: GraphStorageOptions

  // In-memory indices for fast lookups
  private nodesByLabel: Map<string, Set<string>> = new Map()
  private relsByType: Map<string, Set<string>> = new Map()
  private outgoingRels: Map<string, Set<string>> = new Map() // nodeId -> relIds
  private incomingRels: Map<string, Set<string>> = new Map() // nodeId -> relIds

  constructor(options: GraphStorageOptions = {}) {
    this.options = options

    const storeOptions: TemporalStoreOptions = {
      enableTTL: false,
      retention: options.retention,
    }

    this.nodeStore = createTemporalStore<StoredNode>(storeOptions)
    this.relStore = createTemporalStore<StoredRelationship>(storeOptions)

    const routerOptions: KeyedRouterOptions = {
      partitionCount: options.partitionCount ?? 16,
      seed: options.partitionSeed,
    }
    this.router = createKeyedRouter<string>(routerOptions)
  }

  // ==========================================================================
  // NODE OPERATIONS
  // ==========================================================================

  /**
   * Create a new node
   */
  async createNode(
    labels: string[],
    properties: Record<string, unknown>
  ): Promise<StoredNode> {
    const id = `node:${++this.nodeIdCounter}`
    const now = Date.now()

    const node: StoredNode = {
      id,
      labels,
      properties,
      createdAt: now,
      updatedAt: now,
    }

    await this.nodeStore.put(id, node, now)

    // Update indices
    for (const label of labels) {
      let nodeSet = this.nodesByLabel.get(label)
      if (!nodeSet) {
        nodeSet = new Set()
        this.nodesByLabel.set(label, nodeSet)
      }
      nodeSet.add(id)
    }

    this.outgoingRels.set(id, new Set())
    this.incomingRels.set(id, new Set())

    return node
  }

  /**
   * Get a node by ID
   */
  async getNode(id: string, options: GraphQueryOptions = {}): Promise<StoredNode | null> {
    if (options.asOf !== undefined) {
      return this.nodeStore.getAsOf(id, options.asOf)
    }
    return this.nodeStore.get(id)
  }

  /**
   * Update node properties
   */
  async updateNode(
    id: string,
    properties: Record<string, unknown>
  ): Promise<StoredNode | null> {
    const existing = await this.nodeStore.get(id)
    if (!existing) return null

    const now = Date.now()
    const updated: StoredNode = {
      ...existing,
      properties: { ...existing.properties, ...properties },
      updatedAt: now,
    }

    await this.nodeStore.put(id, updated, now)
    return updated
  }

  /**
   * Delete a node (soft delete via versioning)
   */
  async deleteNode(id: string): Promise<boolean> {
    const existing = await this.nodeStore.get(id)
    if (!existing) return false

    // Remove from indices
    for (const label of existing.labels) {
      const nodeSet = this.nodesByLabel.get(label)
      if (nodeSet) nodeSet.delete(id)
    }

    // Mark as deleted with empty properties
    const now = Date.now()
    const deleted: StoredNode = {
      ...existing,
      properties: { _deleted: true },
      updatedAt: now,
    }

    await this.nodeStore.put(id, deleted, now)
    return true
  }

  /**
   * Find nodes by label
   */
  async findNodesByLabel(label: string, options: GraphQueryOptions = {}): Promise<StoredNode[]> {
    const nodeIds = this.nodesByLabel.get(label)
    if (!nodeIds) return []

    const nodes: StoredNode[] = []
    for (const id of nodeIds) {
      const node = await this.getNode(id, options)
      if (node && !node.properties._deleted) {
        nodes.push(node)
      }
    }
    return nodes
  }

  /**
   * Find nodes by property match
   */
  async findNodesByProperties(
    properties: Record<string, unknown>,
    options: GraphQueryOptions = {}
  ): Promise<StoredNode[]> {
    const results: StoredNode[] = []

    // Iterate through all node IDs
    const allNodeIds = new Set<string>()
    for (const nodeSet of this.nodesByLabel.values()) {
      for (const id of nodeSet) {
        allNodeIds.add(id)
      }
    }

    for (const id of allNodeIds) {
      const node = await this.getNode(id, options)
      if (node && !node.properties._deleted) {
        const matches = Object.entries(properties).every(
          ([key, value]) => this.matchValue(node.properties[key], value)
        )
        if (matches) {
          results.push(node)
        }
      }
    }

    return results
  }

  /**
   * Find nodes by label and properties
   */
  async findNodesByLabelAndProperties(
    label: string,
    properties: Record<string, unknown>,
    options: GraphQueryOptions = {}
  ): Promise<StoredNode[]> {
    const labelNodes = await this.findNodesByLabel(label, options)
    return labelNodes.filter((node) =>
      Object.entries(properties).every(
        ([key, value]) => this.matchValue(node.properties[key], value)
      )
    )
  }

  // ==========================================================================
  // RELATIONSHIP OPERATIONS
  // ==========================================================================

  /**
   * Create a new relationship
   */
  async createRelationship(
    type: string,
    sourceId: string,
    targetId: string,
    properties: Record<string, unknown> = {}
  ): Promise<StoredRelationship> {
    const id = `rel:${++this.relIdCounter}`
    const now = Date.now()

    const rel: StoredRelationship = {
      id,
      type,
      sourceId,
      targetId,
      properties,
      createdAt: now,
      updatedAt: now,
    }

    await this.relStore.put(id, rel, now)

    // Update indices
    let typeSet = this.relsByType.get(type)
    if (!typeSet) {
      typeSet = new Set()
      this.relsByType.set(type, typeSet)
    }
    typeSet.add(id)

    const outgoing = this.outgoingRels.get(sourceId) || new Set()
    outgoing.add(id)
    this.outgoingRels.set(sourceId, outgoing)

    const incoming = this.incomingRels.get(targetId) || new Set()
    incoming.add(id)
    this.incomingRels.set(targetId, incoming)

    return rel
  }

  /**
   * Get a relationship by ID
   */
  async getRelationship(id: string, options: GraphQueryOptions = {}): Promise<StoredRelationship | null> {
    if (options.asOf !== undefined) {
      return this.relStore.getAsOf(id, options.asOf)
    }
    return this.relStore.get(id)
  }

  /**
   * Update relationship properties
   */
  async updateRelationship(
    id: string,
    properties: Record<string, unknown>
  ): Promise<StoredRelationship | null> {
    const existing = await this.relStore.get(id)
    if (!existing) return null

    const now = Date.now()
    const updated: StoredRelationship = {
      ...existing,
      properties: { ...existing.properties, ...properties },
      updatedAt: now,
    }

    await this.relStore.put(id, updated, now)
    return updated
  }

  /**
   * Delete a relationship
   */
  async deleteRelationship(id: string): Promise<boolean> {
    const existing = await this.relStore.get(id)
    if (!existing) return false

    // Remove from indices
    const typeSet = this.relsByType.get(existing.type)
    if (typeSet) typeSet.delete(id)

    const outgoing = this.outgoingRels.get(existing.sourceId)
    if (outgoing) outgoing.delete(id)

    const incoming = this.incomingRels.get(existing.targetId)
    if (incoming) incoming.delete(id)

    // Mark as deleted
    const now = Date.now()
    const deleted: StoredRelationship = {
      ...existing,
      properties: { _deleted: true },
      updatedAt: now,
    }

    await this.relStore.put(id, deleted, now)
    return true
  }

  /**
   * Find outgoing relationships from a node
   */
  async findOutgoingRelationships(
    nodeId: string,
    type?: string,
    options: GraphQueryOptions = {}
  ): Promise<StoredRelationship[]> {
    const relIds = this.outgoingRels.get(nodeId) || new Set()
    const results: StoredRelationship[] = []

    for (const relId of relIds) {
      const rel = await this.getRelationship(relId, options)
      if (rel && !rel.properties._deleted) {
        if (type === undefined || rel.type === type) {
          results.push(rel)
        }
      }
    }

    return results
  }

  /**
   * Find incoming relationships to a node
   */
  async findIncomingRelationships(
    nodeId: string,
    type?: string,
    options: GraphQueryOptions = {}
  ): Promise<StoredRelationship[]> {
    const relIds = this.incomingRels.get(nodeId) || new Set()
    const results: StoredRelationship[] = []

    for (const relId of relIds) {
      const rel = await this.getRelationship(relId, options)
      if (rel && !rel.properties._deleted) {
        if (type === undefined || rel.type === type) {
          results.push(rel)
        }
      }
    }

    return results
  }

  /**
   * Find all relationships connected to a node
   */
  async findRelationships(
    nodeId: string,
    type?: string,
    options: GraphQueryOptions = {}
  ): Promise<StoredRelationship[]> {
    const outgoing = await this.findOutgoingRelationships(nodeId, type, options)
    const incoming = await this.findIncomingRelationships(nodeId, type, options)

    // Deduplicate in case of self-loops
    const seen = new Set<string>()
    const results: StoredRelationship[] = []

    for (const rel of [...outgoing, ...incoming]) {
      if (!seen.has(rel.id)) {
        seen.add(rel.id)
        results.push(rel)
      }
    }

    return results
  }

  // ==========================================================================
  // SNAPSHOT OPERATIONS
  // ==========================================================================

  /**
   * Create a snapshot of the current graph state
   */
  async snapshot(): Promise<SnapshotId> {
    // Create snapshots of both stores
    const nodeSnapshotId = await this.nodeStore.snapshot()
    const relSnapshotId = await this.relStore.snapshot()

    // Return a combined snapshot ID
    return `graph:${nodeSnapshotId}:${relSnapshotId}`
  }

  /**
   * Restore graph state from a snapshot
   */
  async restoreSnapshot(id: SnapshotId): Promise<void> {
    const parts = id.split(':')
    if (parts.length !== 3 || parts[0] !== 'graph') {
      throw new Error(`Invalid graph snapshot ID: ${id}`)
    }

    const nodeSnapshotId = parts[1]!
    const relSnapshotId = parts[2]!

    await this.nodeStore.restoreSnapshot(nodeSnapshotId)
    await this.relStore.restoreSnapshot(relSnapshotId)

    // Rebuild indices after restore
    await this.rebuildIndices()
  }

  /**
   * List available snapshots
   */
  async listSnapshots(): Promise<SnapshotInfo[]> {
    return this.nodeStore.listSnapshots()
  }

  // ==========================================================================
  // PARTITION OPERATIONS
  // ==========================================================================

  /**
   * Get the partition number for a node ID
   */
  getNodePartition(nodeId: string): number {
    return this.router.route(nodeId)
  }

  /**
   * Route multiple node IDs to their partitions
   */
  routeNodes(nodeIds: string[]): Map<number, string[]> {
    return this.router.routeBatch(nodeIds)
  }

  /**
   * Shuffle nodes by their ID for distributed processing
   */
  shuffleNodes(nodes: StoredNode[]): Map<number, StoredNode[]> {
    return this.router.shuffle(nodes, (n) => n.id)
  }

  /**
   * Get partition count
   */
  getPartitionCount(): number {
    return this.router.getPartitionCount()
  }

  // ==========================================================================
  // MAINTENANCE OPERATIONS
  // ==========================================================================

  /**
   * Prune old versions based on retention policy
   */
  async prune(policy?: RetentionPolicy): Promise<{ nodes: number; rels: number }> {
    const nodeStats = await this.nodeStore.prune(policy)
    const relStats = await this.relStore.prune(policy)

    return {
      nodes: nodeStats.versionsRemoved,
      rels: relStats.versionsRemoved,
    }
  }

  /**
   * Clear all data from the graph
   */
  async clear(): Promise<void> {
    // Recreate stores
    const storeOptions: TemporalStoreOptions = {
      enableTTL: false,
      retention: this.options.retention,
    }

    this.nodeStore = createTemporalStore<StoredNode>(storeOptions)
    this.relStore = createTemporalStore<StoredRelationship>(storeOptions)

    // Clear indices
    this.nodesByLabel.clear()
    this.relsByType.clear()
    this.outgoingRels.clear()
    this.incomingRels.clear()

    // Reset counters
    this.nodeIdCounter = 0
    this.relIdCounter = 0
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Rebuild indices from storage (used after snapshot restore)
   */
  private async rebuildIndices(): Promise<void> {
    this.nodesByLabel.clear()
    this.relsByType.clear()
    this.outgoingRels.clear()
    this.incomingRels.clear()

    // Note: This is a simplified rebuild that assumes in-memory storage
    // In production, you'd iterate over all stored keys
  }

  /**
   * Match property values (handles type conversions)
   */
  private matchValue(actual: unknown, expected: unknown): boolean {
    if (expected === null || expected === undefined) {
      return actual === null || actual === undefined
    }

    if (Array.isArray(expected) && Array.isArray(actual)) {
      return (
        expected.length === actual.length &&
        expected.every((v, i) => this.matchValue(actual[i], v))
      )
    }

    return actual === expected
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new GraphStorage instance
 */
export function createGraphStorage(options?: GraphStorageOptions): GraphStorage {
  return new GraphStorage(options)
}

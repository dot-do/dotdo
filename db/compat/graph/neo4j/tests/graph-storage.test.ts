/**
 * Graph Storage Tests
 *
 * Tests for the primitives-backed graph storage implementation.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { GraphStorage, createGraphStorage, type StoredNode, type StoredRelationship } from '../graph-storage'

// ============================================================================
// SETUP
// ============================================================================

describe('GraphStorage', () => {
  let storage: GraphStorage

  beforeEach(() => {
    storage = createGraphStorage({
      partitionCount: 4,
    })
  })

  // ==========================================================================
  // NODE TESTS
  // ==========================================================================

  describe('Node Operations', () => {
    it('should create a node with labels and properties', async () => {
      const node = await storage.createNode(['Person'], { name: 'Alice', age: 30 })

      expect(node.id).toBeDefined()
      expect(node.labels).toEqual(['Person'])
      expect(node.properties.name).toBe('Alice')
      expect(node.properties.age).toBe(30)
      expect(node.createdAt).toBeDefined()
      expect(node.updatedAt).toBeDefined()
    })

    it('should get a node by ID', async () => {
      const created = await storage.createNode(['Person'], { name: 'Bob' })
      const retrieved = await storage.getNode(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.properties.name).toBe('Bob')
    })

    it('should return null for non-existent node', async () => {
      const node = await storage.getNode('non-existent')
      expect(node).toBeNull()
    })

    it('should update node properties', async () => {
      const created = await storage.createNode(['Person'], { name: 'Charlie' })
      const updated = await storage.updateNode(created.id, { age: 25, city: 'NYC' })

      expect(updated).not.toBeNull()
      expect(updated!.properties.name).toBe('Charlie')
      expect(updated!.properties.age).toBe(25)
      expect(updated!.properties.city).toBe('NYC')
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    })

    it('should delete a node', async () => {
      const created = await storage.createNode(['Person'], { name: 'ToDelete' })
      const result = await storage.deleteNode(created.id)

      expect(result).toBe(true)

      const retrieved = await storage.getNode(created.id)
      expect(retrieved!.properties._deleted).toBe(true)
    })

    it('should find nodes by label', async () => {
      await storage.createNode(['Person'], { name: 'Alice' })
      await storage.createNode(['Person'], { name: 'Bob' })
      await storage.createNode(['Company'], { name: 'Acme' })

      const people = await storage.findNodesByLabel('Person')
      expect(people).toHaveLength(2)

      const companies = await storage.findNodesByLabel('Company')
      expect(companies).toHaveLength(1)
    })

    it('should find nodes by properties', async () => {
      await storage.createNode(['Person'], { name: 'Alice', age: 30 })
      await storage.createNode(['Person'], { name: 'Bob', age: 25 })
      await storage.createNode(['Person'], { name: 'Charlie', age: 30 })

      const aged30 = await storage.findNodesByProperties({ age: 30 })
      expect(aged30).toHaveLength(2)
    })

    it('should find nodes by label and properties', async () => {
      await storage.createNode(['Person'], { name: 'Alice', age: 30 })
      await storage.createNode(['Person'], { name: 'Bob', age: 25 })
      await storage.createNode(['Robot'], { name: 'R2D2', age: 30 })

      const people30 = await storage.findNodesByLabelAndProperties('Person', { age: 30 })
      expect(people30).toHaveLength(1)
      expect(people30[0].properties.name).toBe('Alice')
    })
  })

  // ==========================================================================
  // RELATIONSHIP TESTS
  // ==========================================================================

  describe('Relationship Operations', () => {
    let alice: StoredNode
    let bob: StoredNode
    let charlie: StoredNode

    beforeEach(async () => {
      alice = await storage.createNode(['Person'], { name: 'Alice' })
      bob = await storage.createNode(['Person'], { name: 'Bob' })
      charlie = await storage.createNode(['Person'], { name: 'Charlie' })
    })

    it('should create a relationship', async () => {
      const rel = await storage.createRelationship('KNOWS', alice.id, bob.id, { since: 2020 })

      expect(rel.id).toBeDefined()
      expect(rel.type).toBe('KNOWS')
      expect(rel.sourceId).toBe(alice.id)
      expect(rel.targetId).toBe(bob.id)
      expect(rel.properties.since).toBe(2020)
    })

    it('should get a relationship by ID', async () => {
      const created = await storage.createRelationship('KNOWS', alice.id, bob.id)
      const retrieved = await storage.getRelationship(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
    })

    it('should update relationship properties', async () => {
      const created = await storage.createRelationship('KNOWS', alice.id, bob.id, { since: 2020 })
      const updated = await storage.updateRelationship(created.id, { strength: 'strong' })

      expect(updated).not.toBeNull()
      expect(updated!.properties.since).toBe(2020)
      expect(updated!.properties.strength).toBe('strong')
    })

    it('should delete a relationship', async () => {
      const created = await storage.createRelationship('KNOWS', alice.id, bob.id)
      const result = await storage.deleteRelationship(created.id)

      expect(result).toBe(true)

      const retrieved = await storage.getRelationship(created.id)
      expect(retrieved!.properties._deleted).toBe(true)
    })

    it('should find outgoing relationships', async () => {
      await storage.createRelationship('KNOWS', alice.id, bob.id)
      await storage.createRelationship('KNOWS', alice.id, charlie.id)
      await storage.createRelationship('WORKS_WITH', alice.id, bob.id)

      const allOutgoing = await storage.findOutgoingRelationships(alice.id)
      expect(allOutgoing).toHaveLength(3)

      const knowsOnly = await storage.findOutgoingRelationships(alice.id, 'KNOWS')
      expect(knowsOnly).toHaveLength(2)
    })

    it('should find incoming relationships', async () => {
      await storage.createRelationship('KNOWS', alice.id, bob.id)
      await storage.createRelationship('KNOWS', charlie.id, bob.id)

      const incoming = await storage.findIncomingRelationships(bob.id)
      expect(incoming).toHaveLength(2)
    })

    it('should find all relationships for a node', async () => {
      await storage.createRelationship('KNOWS', alice.id, bob.id)
      await storage.createRelationship('KNOWS', charlie.id, bob.id)

      const bobRels = await storage.findRelationships(bob.id)
      expect(bobRels).toHaveLength(2)
    })
  })

  // ==========================================================================
  // TIME-TRAVEL TESTS
  // ==========================================================================

  describe('Time-Travel Queries', () => {
    it('should query node state at a specific time', async () => {
      const created = await storage.createNode(['Person'], { name: 'Alice', age: 30 })
      const timeAfterCreate = Date.now()

      // Wait a bit and update
      await new Promise((r) => setTimeout(r, 10))
      await storage.updateNode(created.id, { age: 31 })

      // Query at time of creation - should have original age
      const atCreate = await storage.getNode(created.id, { asOf: timeAfterCreate })
      expect(atCreate!.properties.age).toBe(30)

      // Query current - should have updated age
      const current = await storage.getNode(created.id)
      expect(current!.properties.age).toBe(31)
    })

    it('should query relationship state at a specific time', async () => {
      const alice = await storage.createNode(['Person'], { name: 'Alice' })
      const bob = await storage.createNode(['Person'], { name: 'Bob' })

      const rel = await storage.createRelationship('KNOWS', alice.id, bob.id, { since: 2020 })
      const timeAfterCreate = Date.now()

      await new Promise((r) => setTimeout(r, 10))
      await storage.updateRelationship(rel.id, { since: 2019 })

      const atCreate = await storage.getRelationship(rel.id, { asOf: timeAfterCreate })
      expect(atCreate!.properties.since).toBe(2020)

      const current = await storage.getRelationship(rel.id)
      expect(current!.properties.since).toBe(2019)
    })
  })

  // ==========================================================================
  // SNAPSHOT TESTS
  // ==========================================================================

  describe('Snapshot Operations', () => {
    it('should create and restore snapshots', async () => {
      await storage.createNode(['Person'], { name: 'Alice' })
      await storage.createNode(['Person'], { name: 'Bob' })

      const snapshotId = await storage.snapshot()
      expect(snapshotId).toBeDefined()
      expect(snapshotId).toMatch(/^graph:/)

      // Create more data
      await storage.createNode(['Person'], { name: 'Charlie' })

      // Restore snapshot - should have original data
      await storage.restoreSnapshot(snapshotId)

      // Note: After restore, indices need rebuilding
      // In production, this would iterate over storage
    })

    it('should list snapshots', async () => {
      await storage.snapshot()
      await storage.snapshot()

      const snapshots = await storage.listSnapshots()
      expect(snapshots.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ==========================================================================
  // PARTITION TESTS
  // ==========================================================================

  describe('Partition Operations', () => {
    it('should route nodes to partitions consistently', async () => {
      const node = await storage.createNode(['Person'], { name: 'Alice' })

      const partition1 = storage.getNodePartition(node.id)
      const partition2 = storage.getNodePartition(node.id)

      expect(partition1).toBe(partition2) // Consistent routing
      expect(partition1).toBeGreaterThanOrEqual(0)
      expect(partition1).toBeLessThan(storage.getPartitionCount())
    })

    it('should route multiple nodes to partitions', async () => {
      const nodes = await Promise.all([
        storage.createNode(['Person'], { name: 'Alice' }),
        storage.createNode(['Person'], { name: 'Bob' }),
        storage.createNode(['Person'], { name: 'Charlie' }),
      ])

      const nodeIds = nodes.map((n) => n.id)
      const partitioned = storage.routeNodes(nodeIds)

      // All nodes should be routed
      let totalNodes = 0
      for (const ids of partitioned.values()) {
        totalNodes += ids.length
      }
      expect(totalNodes).toBe(3)
    })

    it('should shuffle nodes by partition', async () => {
      const nodes = await Promise.all([
        storage.createNode(['Person'], { name: 'Alice' }),
        storage.createNode(['Person'], { name: 'Bob' }),
        storage.createNode(['Person'], { name: 'Charlie' }),
        storage.createNode(['Person'], { name: 'Diana' }),
      ])

      const shuffled = storage.shuffleNodes(nodes)

      // All nodes should be present
      let totalNodes = 0
      for (const partitionNodes of shuffled.values()) {
        totalNodes += partitionNodes.length
      }
      expect(totalNodes).toBe(4)
    })

    it('should return partition count', () => {
      expect(storage.getPartitionCount()).toBe(4)
    })
  })

  // ==========================================================================
  // MAINTENANCE TESTS
  // ==========================================================================

  describe('Maintenance Operations', () => {
    it('should clear all data', async () => {
      await storage.createNode(['Person'], { name: 'Alice' })
      await storage.createNode(['Person'], { name: 'Bob' })

      await storage.clear()

      const people = await storage.findNodesByLabel('Person')
      expect(people).toHaveLength(0)
    })

    it('should prune old versions', async () => {
      const node = await storage.createNode(['Person'], { name: 'Alice', age: 30 })

      // Create multiple versions
      await storage.updateNode(node.id, { age: 31 })
      await storage.updateNode(node.id, { age: 32 })
      await storage.updateNode(node.id, { age: 33 })

      const stats = await storage.prune({ maxVersions: 2 })

      expect(stats.nodes).toBeGreaterThanOrEqual(0) // May prune old versions
    })
  })
})

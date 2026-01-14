/**
 * EventLinker tests
 *
 * Tests for graph-based event relationship management:
 * - Link types: caused_by, parent_child, related
 * - Graph storage with adjacency lists
 * - Traversal APIs (ancestors, descendants, related)
 * - Cycle detection and prevention
 * - Lazy loading for deep traversals
 *
 * @module db/primitives/business-event-store/event-linker.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  EventLinker,
  createEventLinker,
  type LinkType,
  type EventLink,
  type TraversalOptions,
  type TraversalResult,
  type LazyTraversalIterator,
  type GraphStats,
  type CycleCheckResult,
} from './event-linker'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestLinker(): EventLinker {
  return createEventLinker()
}

// Sample event IDs
const EVENT_1 = 'evt_001'
const EVENT_2 = 'evt_002'
const EVENT_3 = 'evt_003'
const EVENT_4 = 'evt_004'
const EVENT_5 = 'evt_005'
const EVENT_6 = 'evt_006'
const EVENT_7 = 'evt_007'
const EVENT_8 = 'evt_008'

// ============================================================================
// BASIC LINK OPERATIONS
// ============================================================================

describe('EventLinker', () => {
  describe('Basic Link Operations', () => {
    it('should create a linker instance', () => {
      const linker = createTestLinker()
      expect(linker).toBeInstanceOf(EventLinker)
    })

    it('should add events to the graph', () => {
      const linker = createTestLinker()

      linker.addEvent(EVENT_1)
      linker.addEvent(EVENT_2)

      expect(linker.hasEvent(EVENT_1)).toBe(true)
      expect(linker.hasEvent(EVENT_2)).toBe(true)
      expect(linker.hasEvent(EVENT_3)).toBe(false)
    })

    it('should create a caused_by link between events', async () => {
      const linker = createTestLinker()

      const link = await linker.link(EVENT_1, EVENT_2, 'caused_by')

      expect(link.sourceId).toBe(EVENT_1)
      expect(link.targetId).toBe(EVENT_2)
      expect(link.type).toBe('caused_by')
      expect(link.createdAt).toBeInstanceOf(Date)
    })

    it('should create a parent_child link between events', async () => {
      const linker = createTestLinker()

      const link = await linker.link(EVENT_1, EVENT_2, 'parent_child')

      expect(link.sourceId).toBe(EVENT_1)
      expect(link.targetId).toBe(EVENT_2)
      expect(link.type).toBe('parent_child')
    })

    it('should create bidirectional related links', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'related')

      const links1 = linker.getLinks(EVENT_1, 'forward')
      const links2 = linker.getLinks(EVENT_2, 'forward')

      expect(links1.some((l) => l.targetId === EVENT_2 && l.type === 'related')).toBe(true)
      expect(links2.some((l) => l.targetId === EVENT_1 && l.type === 'related')).toBe(true)
    })

    it('should store link metadata', async () => {
      const linker = createTestLinker()

      const metadata = { reason: 'order processing', confidence: 0.95 }
      const link = await linker.link(EVENT_1, EVENT_2, 'caused_by', metadata)

      expect(link.metadata).toEqual(metadata)
    })

    it('should prevent duplicate links', async () => {
      const linker = createTestLinker()

      const link1 = await linker.link(EVENT_1, EVENT_2, 'caused_by')
      const link2 = await linker.link(EVENT_1, EVENT_2, 'caused_by')

      expect(link1).toEqual(link2)

      const links = linker.getLinks(EVENT_1, 'forward')
      const causalLinks = links.filter((l) => l.type === 'caused_by')
      expect(causalLinks).toHaveLength(1)
    })

    it('should unlink events', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      const removed = linker.unlink(EVENT_1, EVENT_2, 'caused_by')

      expect(removed).toBe(true)

      const links = linker.getLinks(EVENT_1, 'forward')
      expect(links.filter((l) => l.type === 'caused_by')).toHaveLength(0)
    })

    it('should return false when unlinking non-existent link', () => {
      const linker = createTestLinker()

      const removed = linker.unlink(EVENT_1, EVENT_2, 'caused_by')

      expect(removed).toBe(false)
    })

    it('should unlink bidirectional related links', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'related')
      linker.unlink(EVENT_1, EVENT_2, 'related')

      const links1 = linker.getLinks(EVENT_1)
      const links2 = linker.getLinks(EVENT_2)

      expect(links1.filter((l) => l.type === 'related')).toHaveLength(0)
      expect(links2.filter((l) => l.type === 'related')).toHaveLength(0)
    })

    it('should implicitly add events when linking', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')

      expect(linker.hasEvent(EVENT_1)).toBe(true)
      expect(linker.hasEvent(EVENT_2)).toBe(true)
    })
  })

  // ============================================================================
  // LINK RETRIEVAL
  // ============================================================================

  describe('Link Retrieval', () => {
    it('should get all links for an event', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_3, 'parent_child')
      await linker.link(EVENT_1, EVENT_4, 'related')

      const links = linker.getLinks(EVENT_1, 'both')

      expect(links.length).toBeGreaterThanOrEqual(3)
    })

    it('should get forward links only', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_3, EVENT_1, 'caused_by')

      const forwardLinks = linker.getLinks(EVENT_1, 'forward')
      const backwardLinks = linker.getLinks(EVENT_1, 'backward')

      expect(forwardLinks.some((l) => l.targetId === EVENT_2)).toBe(true)
      expect(forwardLinks.every((l) => l.sourceId === EVENT_1 || l.targetId === EVENT_1)).toBe(true)
      expect(backwardLinks.some((l) => l.sourceId === EVENT_3)).toBe(true)
    })

    it('should get links by type', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_3, 'parent_child')
      await linker.link(EVENT_1, EVENT_4, 'related')

      const causalLinks = linker.getLinksByType(EVENT_1, 'caused_by', 'forward')
      const parentChildLinks = linker.getLinksByType(EVENT_1, 'parent_child', 'forward')

      expect(causalLinks).toHaveLength(1)
      expect(causalLinks[0].targetId).toBe(EVENT_2)

      expect(parentChildLinks).toHaveLength(1)
      expect(parentChildLinks[0].targetId).toBe(EVENT_3)
    })

    it('should return empty array for event with no links', () => {
      const linker = createTestLinker()

      linker.addEvent(EVENT_1)

      const links = linker.getLinks(EVENT_1)

      expect(links).toHaveLength(0)
    })
  })

  // ============================================================================
  // CYCLE DETECTION
  // ============================================================================

  describe('Cycle Detection', () => {
    it('should detect simple cycle', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')

      const cycleCheck = await linker.wouldCreateCycle(EVENT_3, EVENT_1)

      expect(cycleCheck.wouldCreateCycle).toBe(true)
      expect(cycleCheck.cyclePath).toBeDefined()
      expect(cycleCheck.cyclePath).toContain(EVENT_1)
      expect(cycleCheck.cyclePath).toContain(EVENT_2)
      expect(cycleCheck.cyclePath).toContain(EVENT_3)
    })

    it('should not detect cycle for valid link', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')

      const cycleCheck = await linker.wouldCreateCycle(EVENT_2, EVENT_3)

      expect(cycleCheck.wouldCreateCycle).toBe(false)
      expect(cycleCheck.cyclePath).toBeUndefined()
    })

    it('should prevent creating cyclic caused_by links', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')

      await expect(linker.link(EVENT_3, EVENT_1, 'caused_by')).rejects.toThrow(
        /would create cycle/,
      )
    })

    it('should allow non-cyclic parallel links', async () => {
      const linker = createTestLinker()

      // Create a diamond shape: 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_3, 'caused_by')
      await linker.link(EVENT_2, EVENT_4, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')

      // This should work - no cycle
      const stats = linker.getStats()
      expect(stats.linksByType.caused_by).toBe(4)
    })

    it('should detect cycle in longer chain', async () => {
      const linker = createTestLinker()

      // Create chain: 1 -> 2 -> 3 -> 4 -> 5
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')
      await linker.link(EVENT_4, EVENT_5, 'caused_by')

      // Trying to link 5 -> 1 should fail
      await expect(linker.link(EVENT_5, EVENT_1, 'caused_by')).rejects.toThrow(
        /would create cycle/,
      )
    })

    it('should not prevent cycles in non-causal relationships', async () => {
      const linker = createTestLinker()

      // Related links can be "circular" (they're bidirectional anyway)
      await linker.link(EVENT_1, EVENT_2, 'related')
      await linker.link(EVENT_2, EVENT_3, 'related')
      await linker.link(EVENT_3, EVENT_1, 'related') // This should be allowed

      const stats = linker.getStats()
      expect(stats.linksByType.related).toBe(3)
    })
  })

  // ============================================================================
  // ANCESTOR TRAVERSAL
  // ============================================================================

  describe('Ancestor Traversal', () => {
    it('should get immediate ancestors', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')

      const result = await linker.getAncestors(EVENT_2, { maxDepth: 1 })

      expect(result.eventIds).toContain(EVENT_1)
      expect(result.eventIds).not.toContain(EVENT_3)
      expect(result.depth).toBe(1)
    })

    it('should get all ancestors recursively', async () => {
      const linker = createTestLinker()

      // Create chain: 1 -> 2 -> 3 -> 4
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')

      const result = await linker.getAncestors(EVENT_4)

      expect(result.eventIds).toHaveLength(3)
      expect(result.eventIds).toContain(EVENT_1)
      expect(result.eventIds).toContain(EVENT_2)
      expect(result.eventIds).toContain(EVENT_3)
    })

    it('should respect maxDepth option', async () => {
      const linker = createTestLinker()

      // Create chain: 1 -> 2 -> 3 -> 4
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')

      const result = await linker.getAncestors(EVENT_4, { maxDepth: 2 })

      expect(result.eventIds).toContain(EVENT_3)
      expect(result.eventIds).toContain(EVENT_2)
      expect(result.eventIds).not.toContain(EVENT_1)
      expect(result.depth).toBe(2)
    })

    it('should respect limit option', async () => {
      const linker = createTestLinker()

      // Create many ancestors
      await linker.link(EVENT_1, EVENT_5, 'caused_by')
      await linker.link(EVENT_2, EVENT_5, 'caused_by')
      await linker.link(EVENT_3, EVENT_5, 'caused_by')
      await linker.link(EVENT_4, EVENT_5, 'caused_by')

      const result = await linker.getAncestors(EVENT_5, { limit: 2 })

      expect(result.eventIds).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })

    it('should return empty for root event', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')

      const result = await linker.getAncestors(EVENT_1)

      expect(result.eventIds).toHaveLength(0)
      expect(result.depth).toBe(0)
    })

    it('should include traversed links in result', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')

      const result = await linker.getAncestors(EVENT_3)

      expect(result.links).toHaveLength(2)
      expect(result.links.some((l) => l.sourceId === EVENT_1 && l.targetId === EVENT_2)).toBe(
        true,
      )
      expect(result.links.some((l) => l.sourceId === EVENT_2 && l.targetId === EVENT_3)).toBe(
        true,
      )
    })
  })

  // ============================================================================
  // DESCENDANT TRAVERSAL
  // ============================================================================

  describe('Descendant Traversal', () => {
    it('should get immediate descendants', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')

      const result = await linker.getDescendants(EVENT_2, { maxDepth: 1 })

      expect(result.eventIds).toContain(EVENT_3)
      expect(result.eventIds).not.toContain(EVENT_1)
      expect(result.depth).toBe(1)
    })

    it('should get all descendants recursively', async () => {
      const linker = createTestLinker()

      // Create tree: 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 5
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_3, 'caused_by')
      await linker.link(EVENT_2, EVENT_4, 'caused_by')
      await linker.link(EVENT_3, EVENT_5, 'caused_by')

      const result = await linker.getDescendants(EVENT_1)

      expect(result.eventIds).toHaveLength(4)
      expect(result.eventIds).toContain(EVENT_2)
      expect(result.eventIds).toContain(EVENT_3)
      expect(result.eventIds).toContain(EVENT_4)
      expect(result.eventIds).toContain(EVENT_5)
    })

    it('should handle diamond-shaped graphs', async () => {
      const linker = createTestLinker()

      // Diamond: 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_3, 'caused_by')
      await linker.link(EVENT_2, EVENT_4, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')

      const result = await linker.getDescendants(EVENT_1)

      // EVENT_4 should only appear once
      expect(result.eventIds).toHaveLength(3)
      expect(result.eventIds.filter((id) => id === EVENT_4)).toHaveLength(1)
    })

    it('should return empty for leaf event', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')

      const result = await linker.getDescendants(EVENT_2)

      expect(result.eventIds).toHaveLength(0)
      expect(result.depth).toBe(0)
    })
  })

  // ============================================================================
  // RELATED TRAVERSAL
  // ============================================================================

  describe('Related Traversal', () => {
    it('should get directly related events', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'related')
      await linker.link(EVENT_1, EVENT_3, 'related')

      const result = await linker.getRelated(EVENT_1, { maxDepth: 1 })

      expect(result.eventIds).toContain(EVENT_2)
      expect(result.eventIds).toContain(EVENT_3)
    })

    it('should traverse related events transitively', async () => {
      const linker = createTestLinker()

      // Create chain of related: 1 - 2 - 3 - 4
      await linker.link(EVENT_1, EVENT_2, 'related')
      await linker.link(EVENT_2, EVENT_3, 'related')
      await linker.link(EVENT_3, EVENT_4, 'related')

      const result = await linker.getRelated(EVENT_1)

      expect(result.eventIds).toHaveLength(3)
      expect(result.eventIds).toContain(EVENT_2)
      expect(result.eventIds).toContain(EVENT_3)
      expect(result.eventIds).toContain(EVENT_4)
    })

    it('should handle bidirectional traversal correctly', async () => {
      const linker = createTestLinker()

      // Related links are bidirectional
      await linker.link(EVENT_1, EVENT_2, 'related')

      const fromEvent1 = await linker.getRelated(EVENT_1)
      const fromEvent2 = await linker.getRelated(EVENT_2)

      expect(fromEvent1.eventIds).toContain(EVENT_2)
      expect(fromEvent2.eventIds).toContain(EVENT_1)
    })

    it('should not visit same event twice in cluster', async () => {
      const linker = createTestLinker()

      // Create a triangle of related events
      await linker.link(EVENT_1, EVENT_2, 'related')
      await linker.link(EVENT_2, EVENT_3, 'related')
      await linker.link(EVENT_3, EVENT_1, 'related')

      const result = await linker.getRelated(EVENT_1)

      // Each event should appear only once
      const uniqueIds = new Set(result.eventIds)
      expect(uniqueIds.size).toBe(result.eventIds.length)
    })
  })

  // ============================================================================
  // CAUSATION CHAIN
  // ============================================================================

  describe('Causation Chain', () => {
    it('should get causation chain from root to event', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')

      const chain = await linker.getCausationChain(EVENT_4)

      expect(chain.root).toBe(EVENT_1)
      expect(chain.path).toEqual([EVENT_1, EVENT_2, EVENT_3, EVENT_4])
      expect(chain.depth).toBe(4)
    })

    it('should return single event for root', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')

      const chain = await linker.getCausationChain(EVENT_1)

      expect(chain.root).toBe(EVENT_1)
      expect(chain.path).toEqual([EVENT_1])
      expect(chain.depth).toBe(1)
    })
  })

  // ============================================================================
  // PARENT-CHILD RELATIONSHIPS
  // ============================================================================

  describe('Parent-Child Relationships', () => {
    it('should get parent events', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'parent_child')
      await linker.link(EVENT_1, EVENT_3, 'parent_child')

      const parents2 = await linker.getParents(EVENT_2)
      const parents3 = await linker.getParents(EVENT_3)

      expect(parents2).toContain(EVENT_1)
      expect(parents3).toContain(EVENT_1)
    })

    it('should get child events', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'parent_child')
      await linker.link(EVENT_1, EVENT_3, 'parent_child')
      await linker.link(EVENT_1, EVENT_4, 'parent_child')

      const children = await linker.getChildren(EVENT_1)

      expect(children).toHaveLength(3)
      expect(children).toContain(EVENT_2)
      expect(children).toContain(EVENT_3)
      expect(children).toContain(EVENT_4)
    })

    it('should return empty for event with no children', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'parent_child')

      const children = await linker.getChildren(EVENT_2)

      expect(children).toHaveLength(0)
    })

    it('should return empty for event with no parents', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'parent_child')

      const parents = await linker.getParents(EVENT_1)

      expect(parents).toHaveLength(0)
    })
  })

  // ============================================================================
  // ROOT AND LEAF EVENTS
  // ============================================================================

  describe('Root and Leaf Events', () => {
    it('should identify root events', async () => {
      const linker = createTestLinker()

      // Create forest: 1 -> 2 -> 4, 3 -> 5
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_4, 'caused_by')
      await linker.link(EVENT_3, EVENT_5, 'caused_by')

      const roots = linker.getRootEvents()

      expect(roots).toHaveLength(2)
      expect(roots).toContain(EVENT_1)
      expect(roots).toContain(EVENT_3)
    })

    it('should identify leaf events', async () => {
      const linker = createTestLinker()

      // Create: 1 -> 2, 1 -> 3, 2 -> 4
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_3, 'caused_by')
      await linker.link(EVENT_2, EVENT_4, 'caused_by')

      const leaves = linker.getLeafEvents()

      expect(leaves).toHaveLength(2)
      expect(leaves).toContain(EVENT_3)
      expect(leaves).toContain(EVENT_4)
    })

    it('should handle isolated events as both root and leaf', () => {
      const linker = createTestLinker()

      linker.addEvent(EVENT_1)

      const roots = linker.getRootEvents()
      const leaves = linker.getLeafEvents()

      expect(roots).toContain(EVENT_1)
      expect(leaves).toContain(EVENT_1)
    })
  })

  // ============================================================================
  // LAZY TRAVERSAL
  // ============================================================================

  describe('Lazy Traversal', () => {
    it('should create lazy iterator for descendants', async () => {
      const linker = createTestLinker()

      // Create chain: 1 -> 2 -> 3 -> 4 -> 5
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')
      await linker.link(EVENT_4, EVENT_5, 'caused_by')

      const iterator = linker.createLazyIterator(EVENT_1, 'descendants')

      expect(iterator.isDone()).toBe(false)
      expect(iterator.currentDepth()).toBe(0)
      expect(iterator.visitedCount()).toBe(0)
    })

    it('should iterate through descendants in batches', async () => {
      const linker = createTestLinker()

      // Create chain
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')
      await linker.link(EVENT_4, EVENT_5, 'caused_by')

      const iterator = linker.createLazyIterator(EVENT_1, 'descendants')

      // Collect all events through batches
      const allEvents: string[] = []
      while (!iterator.isDone()) {
        const batch = await iterator.next(2)
        allEvents.push(...batch.eventIds)
        if (batch.done) break
      }

      // Should have visited all 4 descendants
      expect(allEvents).toHaveLength(4)
      expect(allEvents).toContain(EVENT_2)
      expect(allEvents).toContain(EVENT_3)
      expect(allEvents).toContain(EVENT_4)
      expect(allEvents).toContain(EVENT_5)
    })

    it('should create lazy iterator for ancestors', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')

      const iterator = linker.createLazyIterator(EVENT_4, 'ancestors')

      const allEvents: string[] = []
      while (!iterator.isDone()) {
        const batch = await iterator.next(10)
        allEvents.push(...batch.eventIds)
        if (batch.done) break
      }

      expect(allEvents).toHaveLength(3)
      expect(allEvents).toContain(EVENT_1)
      expect(allEvents).toContain(EVENT_2)
      expect(allEvents).toContain(EVENT_3)
    })

    it('should create lazy iterator for related events', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'related')
      await linker.link(EVENT_2, EVENT_3, 'related')
      await linker.link(EVENT_3, EVENT_4, 'related')

      const iterator = linker.createLazyIterator(EVENT_1, 'related')

      const batch = await iterator.next(10)

      expect(batch.eventIds).toContain(EVENT_2)
    })

    it('should track visited count', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_3, 'caused_by')
      await linker.link(EVENT_1, EVENT_4, 'caused_by')

      const iterator = linker.createLazyIterator(EVENT_1, 'descendants')

      // First batch - get 2 events
      const batch1 = await iterator.next(2)
      expect(batch1.eventIds).toHaveLength(2)
      expect(iterator.visitedCount()).toBe(2)

      // Second batch - get remaining 1 event
      const batch2 = await iterator.next(2)
      expect(batch2.eventIds).toHaveLength(1)
      expect(iterator.visitedCount()).toBe(3)
    })

    it('should handle empty results', async () => {
      const linker = createTestLinker()

      linker.addEvent(EVENT_1)

      const iterator = linker.createLazyIterator(EVENT_1, 'descendants')

      const batch = await iterator.next()
      expect(batch.eventIds).toHaveLength(0)
      expect(batch.done).toBe(true)
      expect(iterator.isDone()).toBe(true)
    })
  })

  // ============================================================================
  // GRAPH STATISTICS
  // ============================================================================

  describe('Graph Statistics', () => {
    it('should calculate total events and links', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_1, EVENT_4, 'parent_child')

      const stats = linker.getStats()

      expect(stats.totalEvents).toBe(4)
      expect(stats.totalLinks).toBe(3)
    })

    it('should count links by type', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_1, EVENT_4, 'parent_child')
      await linker.link(EVENT_3, EVENT_5, 'related')

      const stats = linker.getStats()

      expect(stats.linksByType.caused_by).toBe(2)
      expect(stats.linksByType.parent_child).toBe(1)
      expect(stats.linksByType.related).toBe(1)
    })

    it('should count root and leaf events', async () => {
      const linker = createTestLinker()

      // Tree: 1 -> 2, 1 -> 3, 2 -> 4, 2 -> 5
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_3, 'caused_by')
      await linker.link(EVENT_2, EVENT_4, 'caused_by')
      await linker.link(EVENT_2, EVENT_5, 'caused_by')

      const stats = linker.getStats()

      expect(stats.rootEvents).toBe(1)
      expect(stats.leafEvents).toBe(3) // 3, 4, 5
    })

    it('should calculate max causal depth', async () => {
      const linker = createTestLinker()

      // Chain: 1 -> 2 -> 3 -> 4
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_3, EVENT_4, 'caused_by')

      const stats = linker.getStats()

      expect(stats.maxCausalDepth).toBe(3)
    })

    it('should not double-count bidirectional related links', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'related')
      await linker.link(EVENT_2, EVENT_3, 'related')

      const stats = linker.getStats()

      expect(stats.linksByType.related).toBe(2)
      expect(stats.totalLinks).toBe(2)
    })
  })

  // ============================================================================
  // EVENT REMOVAL
  // ============================================================================

  describe('Event Removal', () => {
    it('should remove event and all its links', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_2, EVENT_4, 'parent_child')

      const removed = linker.removeEvent(EVENT_2)

      expect(removed).toBe(true)
      expect(linker.hasEvent(EVENT_2)).toBe(false)

      // Links should be cleaned up
      const links1 = linker.getLinks(EVENT_1)
      const links3 = linker.getLinks(EVENT_3)

      expect(links1.some((l) => l.targetId === EVENT_2)).toBe(false)
      expect(links3.some((l) => l.sourceId === EVENT_2)).toBe(false)
    })

    it('should return false for non-existent event', () => {
      const linker = createTestLinker()

      const removed = linker.removeEvent(EVENT_1)

      expect(removed).toBe(false)
    })

    it('should clear all data', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')

      linker.clear()

      expect(linker.hasEvent(EVENT_1)).toBe(false)
      expect(linker.hasEvent(EVENT_2)).toBe(false)
      expect(linker.hasEvent(EVENT_3)).toBe(false)

      const stats = linker.getStats()
      expect(stats.totalEvents).toBe(0)
      expect(stats.totalLinks).toBe(0)
    })
  })

  // ============================================================================
  // EXPORT/IMPORT
  // ============================================================================

  describe('Export/Import', () => {
    it('should export graph as serializable object', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_2, EVENT_3, 'caused_by')
      await linker.link(EVENT_1, EVENT_4, 'related')

      const exported = linker.export()

      expect(exported.events).toHaveLength(4)
      expect(exported.events).toContain(EVENT_1)
      expect(exported.events).toContain(EVENT_2)
      expect(exported.events).toContain(EVENT_3)
      expect(exported.events).toContain(EVENT_4)

      expect(exported.links).toHaveLength(3)
    })

    it('should import graph from serialized object', async () => {
      const linker1 = createTestLinker()

      await linker1.link(EVENT_1, EVENT_2, 'caused_by')
      await linker1.link(EVENT_2, EVENT_3, 'caused_by')

      const exported = linker1.export()

      const linker2 = createTestLinker()
      await linker2.import(exported)

      expect(linker2.hasEvent(EVENT_1)).toBe(true)
      expect(linker2.hasEvent(EVENT_2)).toBe(true)
      expect(linker2.hasEvent(EVENT_3)).toBe(true)

      const descendants = await linker2.getDescendants(EVENT_1)
      expect(descendants.eventIds).toContain(EVENT_2)
      expect(descendants.eventIds).toContain(EVENT_3)
    })

    it('should not export duplicate related links', async () => {
      const linker = createTestLinker()

      await linker.link(EVENT_1, EVENT_2, 'related')

      const exported = linker.export()

      // Only one related link should be exported (not both directions)
      const relatedLinks = exported.links.filter((l) => l.type === 'related')
      expect(relatedLinks).toHaveLength(1)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle self-referential link attempt', async () => {
      const linker = createTestLinker()

      // Self-link would create a trivial cycle
      await expect(linker.link(EVENT_1, EVENT_1, 'caused_by')).rejects.toThrow(
        /would create cycle/,
      )
    })

    it('should handle event IDs with special characters', async () => {
      const linker = createTestLinker()

      const specialId1 = 'evt:with:colons:123'
      const specialId2 = 'evt_with_underscores_456'

      await linker.link(specialId1, specialId2, 'caused_by')

      expect(linker.hasEvent(specialId1)).toBe(true)
      expect(linker.hasEvent(specialId2)).toBe(true)

      const links = linker.getLinks(specialId1)
      expect(links.some((l) => l.targetId === specialId2)).toBe(true)
    })

    it('should handle large graph traversal', async () => {
      const linker = createTestLinker()

      // Create a wide tree with many children
      const rootId = 'root'
      const childCount = 100

      for (let i = 0; i < childCount; i++) {
        await linker.link(rootId, `child_${i}`, 'caused_by')
      }

      const descendants = await linker.getDescendants(rootId)

      expect(descendants.eventIds).toHaveLength(childCount)
    })

    it('should handle deep chain traversal', async () => {
      const linker = createTestLinker()

      // Create a long chain
      const chainLength = 50
      for (let i = 0; i < chainLength - 1; i++) {
        await linker.link(`node_${i}`, `node_${i + 1}`, 'caused_by')
      }

      const lastNode = `node_${chainLength - 1}`
      const chain = await linker.getCausationChain(lastNode)

      expect(chain.depth).toBe(chainLength)
      expect(chain.root).toBe('node_0')
    })

    it('should handle mixed link types on same events', async () => {
      const linker = createTestLinker()

      // Same events can have multiple relationship types
      await linker.link(EVENT_1, EVENT_2, 'caused_by')
      await linker.link(EVENT_1, EVENT_2, 'parent_child')
      await linker.link(EVENT_1, EVENT_2, 'related')

      const links = linker.getLinks(EVENT_1, 'forward')

      expect(links.filter((l) => l.type === 'caused_by')).toHaveLength(1)
      expect(links.filter((l) => l.type === 'parent_child')).toHaveLength(1)
      expect(links.filter((l) => l.type === 'related')).toHaveLength(1)
    })
  })
})

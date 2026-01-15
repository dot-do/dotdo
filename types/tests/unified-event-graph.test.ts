/**
 * Graph Columns Tests
 *
 * Tests for the lean graph columns (depth, is_leaf, is_root) added to UnifiedEvent
 * for 10x faster depth/leaf queries without recursive CTEs.
 *
 * TDD RED PHASE: These tests are written first and should FAIL until implementation.
 */

import { describe, it, expect } from 'vitest'
import type { UnifiedEvent, CausalityChain } from '../unified-event'
import { createUnifiedEvent, UNIFIED_COLUMNS } from '../unified-event'
import { CausalityChainSchema } from '../unified-event-schema'
import { computeGraphColumns, computeIsLeaf } from '../../db/streams/transformers/shared/graph'

// ============================================================================
// TYPE TESTS - Verify columns exist on types
// ============================================================================

describe('Graph Columns Type Tests', () => {
  it('UnifiedEvent accepts depth, is_leaf, is_root', () => {
    // This test verifies the types accept these new optional columns
    const event: Partial<UnifiedEvent> = {
      depth: 0,
      is_leaf: true,
      is_root: true,
    }
    expect(event.depth).toBe(0)
    expect(event.is_leaf).toBe(true)
    expect(event.is_root).toBe(true)
  })

  it('CausalityChain interface includes graph columns', () => {
    const causality: Partial<CausalityChain> = {
      trace_id: 'trace-123',
      span_id: 'span-456',
      parent_id: null,
      depth: 0,
      is_leaf: false,
      is_root: true,
    }
    expect(causality.depth).toBe(0)
    expect(causality.is_leaf).toBe(false)
    expect(causality.is_root).toBe(true)
  })
})

// ============================================================================
// SCHEMA TESTS - Verify Zod schema includes columns
// ============================================================================

describe('Graph Columns Schema Tests', () => {
  it('CausalityChainSchema accepts graph columns', () => {
    const result = CausalityChainSchema.safeParse({
      trace_id: 'trace-123',
      span_id: 'span-456',
      parent_id: null,
      root_id: 'span-456',
      session_id: null,
      workflow_id: null,
      transaction_id: null,
      correlation_id: null,
      depth: 0,
      is_leaf: true,
      is_root: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.depth).toBe(0)
      expect(result.data.is_leaf).toBe(true)
      expect(result.data.is_root).toBe(true)
    }
  })

  it('CausalityChainSchema allows null for graph columns', () => {
    const result = CausalityChainSchema.safeParse({
      trace_id: null,
      span_id: null,
      parent_id: null,
      root_id: null,
      session_id: null,
      workflow_id: null,
      transaction_id: null,
      correlation_id: null,
      depth: null,
      is_leaf: null,
      is_root: null,
    })
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// UNIFIED_COLUMNS METADATA TESTS
// ============================================================================

describe('Graph Columns Metadata Tests', () => {
  it('UNIFIED_COLUMNS includes depth column', () => {
    const depthCol = UNIFIED_COLUMNS.find((c) => c.name === 'depth')
    expect(depthCol).toBeDefined()
    expect(depthCol?.type).toBe('number')
    expect(depthCol?.nullable).toBe(true)
  })

  it('UNIFIED_COLUMNS includes is_leaf column', () => {
    const isLeafCol = UNIFIED_COLUMNS.find((c) => c.name === 'is_leaf')
    expect(isLeafCol).toBeDefined()
    expect(isLeafCol?.type).toBe('boolean')
    expect(isLeafCol?.nullable).toBe(true)
  })

  it('UNIFIED_COLUMNS includes is_root column', () => {
    const isRootCol = UNIFIED_COLUMNS.find((c) => c.name === 'is_root')
    expect(isRootCol).toBeDefined()
    expect(isRootCol?.type).toBe('boolean')
    expect(isRootCol?.nullable).toBe(true)
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createUnifiedEvent Graph Columns', () => {
  it('createUnifiedEvent includes graph columns with defaults', () => {
    const event = createUnifiedEvent({
      id: 'evt-123',
      event_type: 'trace',
      event_name: 'http.request',
      ns: 'https://api.example.com',
    })
    expect(event).toHaveProperty('depth')
    expect(event).toHaveProperty('is_leaf')
    expect(event).toHaveProperty('is_root')
    expect(event.depth).toBeNull()
    expect(event.is_leaf).toBeNull()
    expect(event.is_root).toBeNull()
  })

  it('createUnifiedEvent preserves provided graph columns', () => {
    const event = createUnifiedEvent({
      id: 'evt-123',
      event_type: 'trace',
      event_name: 'http.request',
      ns: 'https://api.example.com',
      depth: 2,
      is_leaf: true,
      is_root: false,
    })
    expect(event.depth).toBe(2)
    expect(event.is_leaf).toBe(true)
    expect(event.is_root).toBe(false)
  })
})

// ============================================================================
// computeGraphColumns FUNCTION TESTS
// ============================================================================

describe('computeGraphColumns', () => {
  it('sets depth=0, is_root=true for root spans (no parent_id)', () => {
    const result = computeGraphColumns({ parent_id: null })
    expect(result.depth).toBe(0)
    expect(result.is_root).toBe(true)
  })

  it('sets depth=0, is_root=true for root spans (undefined parent_id)', () => {
    const result = computeGraphColumns({})
    expect(result.depth).toBe(0)
    expect(result.is_root).toBe(true)
  })

  it('sets depth=parent.depth+1 for child spans', () => {
    const parentLookup = (parentId: string) => {
      if (parentId === 'parent-span') {
        return { depth: 2 }
      }
      return undefined
    }

    const result = computeGraphColumns({ parent_id: 'parent-span' }, parentLookup)
    expect(result.depth).toBe(3) // 2 + 1
    expect(result.is_root).toBe(false)
  })

  it('handles missing parent gracefully by defaulting to depth 1', () => {
    const parentLookup = () => undefined

    const result = computeGraphColumns({ parent_id: 'unknown-parent' }, parentLookup)
    expect(result.depth).toBe(1) // Default when parent not found
    expect(result.is_root).toBe(false)
  })

  it('works without parent lookup function', () => {
    const result = computeGraphColumns({ parent_id: 'some-parent' })
    expect(result.depth).toBe(1) // Default when no lookup provided
    expect(result.is_root).toBe(false)
  })
})

// ============================================================================
// computeIsLeaf FUNCTION TESTS
// ============================================================================

describe('computeIsLeaf', () => {
  it('returns true when no children exist', () => {
    const hasChildren = () => false
    const result = computeIsLeaf('span-123', hasChildren)
    expect(result).toBe(true)
  })

  it('returns false when children exist', () => {
    const hasChildren = (spanId: string) => spanId === 'span-with-children'
    expect(computeIsLeaf('span-with-children', hasChildren)).toBe(false)
    expect(computeIsLeaf('span-without-children', hasChildren)).toBe(true)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Graph Columns Integration', () => {
  it('can build a trace tree with computed depths', () => {
    // Simulate a trace tree:
    // root (depth=0)
    //   ├── child1 (depth=1)
    //   │   └── grandchild1 (depth=2)
    //   └── child2 (depth=1)

    const spans: Array<{ id: string; parent_id: string | null; depth: number }> = []

    // Build spans in order
    const root = { id: 'root', parent_id: null, depth: 0 }
    spans.push(root)

    const parentLookup = (parentId: string) => {
      const parent = spans.find((s) => s.id === parentId)
      return parent ? { depth: parent.depth } : undefined
    }

    // Add child1
    const child1Result = computeGraphColumns({ parent_id: 'root' }, parentLookup)
    spans.push({ id: 'child1', parent_id: 'root', depth: child1Result.depth })

    // Add child2
    const child2Result = computeGraphColumns({ parent_id: 'root' }, parentLookup)
    spans.push({ id: 'child2', parent_id: 'root', depth: child2Result.depth })

    // Add grandchild1
    const grandchild1Result = computeGraphColumns({ parent_id: 'child1' }, parentLookup)
    spans.push({ id: 'grandchild1', parent_id: 'child1', depth: grandchild1Result.depth })

    // Verify depths
    expect(spans.find((s) => s.id === 'root')?.depth).toBe(0)
    expect(spans.find((s) => s.id === 'child1')?.depth).toBe(1)
    expect(spans.find((s) => s.id === 'child2')?.depth).toBe(1)
    expect(spans.find((s) => s.id === 'grandchild1')?.depth).toBe(2)
  })

  it('can identify leaf nodes in a trace tree', () => {
    const spans = [
      { id: 'root', parent_id: null },
      { id: 'child1', parent_id: 'root' },
      { id: 'child2', parent_id: 'root' },
      { id: 'grandchild1', parent_id: 'child1' },
    ]

    const hasChildren = (spanId: string) => {
      return spans.some((s) => s.parent_id === spanId)
    }

    // root has children -> not a leaf
    expect(computeIsLeaf('root', hasChildren)).toBe(false)
    // child1 has grandchild1 -> not a leaf
    expect(computeIsLeaf('child1', hasChildren)).toBe(false)
    // child2 has no children -> is a leaf
    expect(computeIsLeaf('child2', hasChildren)).toBe(true)
    // grandchild1 has no children -> is a leaf
    expect(computeIsLeaf('grandchild1', hasChildren)).toBe(true)
  })
})

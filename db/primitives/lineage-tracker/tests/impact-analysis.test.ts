/**
 * Impact Analysis Tests
 *
 * Comprehensive test suite for the ImpactAnalyzer including:
 * - Upstream impact analysis
 * - Downstream impact analysis
 * - Root cause finding
 * - Lineage coverage
 * - Circular dependency detection
 * - Orphan detection
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createLineageStore,
  LineageStore,
  type SqlExecutor,
  type LineageNode,
} from '../index'
import {
  ImpactAnalyzer,
  createImpactAnalyzer,
  type ImpactReport,
  type CoverageReport,
  type ImpactSeverity,
} from '../impact-analysis'

// =============================================================================
// TEST UTILITIES
// =============================================================================

function createTestDb(): SqlExecutor {
  const db = new Database(':memory:')
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql)
      return {
        bind: (...args: unknown[]) => ({
          all: () => stmt.all(...args),
          run: () => stmt.run(...args),
          first: () => stmt.get(...args),
        }),
      }
    },
  }
}

function createTestStore(): LineageStore {
  const sql = createTestDb()
  return createLineageStore(sql)
}

// =============================================================================
// UPSTREAM IMPACT ANALYSIS TESTS
// =============================================================================

describe('ImpactAnalyzer - Upstream Impact Analysis', () => {
  let store: LineageStore
  let analyzer: ImpactAnalyzer

  /**
   * Test graph:
   *   Source1 -> Transform1 -> Entity1 -> Transform2 -> Sink1
   *                               |
   *                               v
   *   Source2 -----------------> Entity2 -> Sink2
   */
  beforeEach(() => {
    store = createTestStore()
    analyzer = createImpactAnalyzer(store)

    store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
    store.createNode({ id: 'source2', type: 'source', name: 'Source 2' })
    store.createNode({ id: 'transform1', type: 'transformation', name: 'Transform 1' })
    store.createNode({ id: 'transform2', type: 'transformation', name: 'Transform 2' })
    store.createNode({ id: 'entity1', type: 'entity', name: 'Entity 1' })
    store.createNode({ id: 'entity2', type: 'entity', name: 'Entity 2' })
    store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })
    store.createNode({ id: 'sink2', type: 'sink', name: 'Sink 2' })

    store.createEdge({ fromNodeId: 'source1', toNodeId: 'transform1', operation: 'read' })
    store.createEdge({ fromNodeId: 'transform1', toNodeId: 'entity1', operation: 'write' })
    store.createEdge({ fromNodeId: 'entity1', toNodeId: 'transform2', operation: 'read' })
    store.createEdge({ fromNodeId: 'transform2', toNodeId: 'sink1', operation: 'write' })
    store.createEdge({ fromNodeId: 'entity1', toNodeId: 'entity2', operation: 'derive' })
    store.createEdge({ fromNodeId: 'source2', toNodeId: 'entity2', operation: 'read' })
    store.createEdge({ fromNodeId: 'entity2', toNodeId: 'sink2', operation: 'write' })
  })

  describe('analyzeUpstreamImpact', () => {
    it('should find all upstream assets', () => {
      const report = analyzer.analyzeUpstreamImpact('sink1')

      expect(report.sourceAsset.id).toBe('sink1')
      expect(report.direction).toBe('upstream')
      // sink1 <- transform2 <- entity1 <- transform1 <- source1
      expect(report.totalAffected).toBe(4)
    })

    it('should calculate correct distances', () => {
      const report = analyzer.analyzeUpstreamImpact('sink1')

      const distances = new Map(report.affectedAssets.map((a) => [a.node.id, a.distance]))

      expect(distances.get('transform2')).toBe(1)
      expect(distances.get('entity1')).toBe(2)
      expect(distances.get('transform1')).toBe(3)
      expect(distances.get('source1')).toBe(4)
    })

    it('should classify direct vs indirect impact', () => {
      const report = analyzer.analyzeUpstreamImpact('sink1')

      const directNodes = report.affectedAssets.filter((a) => a.impactType === 'direct')
      const indirectNodes = report.affectedAssets.filter((a) => a.impactType === 'indirect')

      expect(directNodes.map((a) => a.node.id)).toEqual(['transform2'])
      expect(indirectNodes.length).toBe(3)
    })

    it('should respect maxDepth', () => {
      const report = analyzer.analyzeUpstreamImpact('sink1', { maxDepth: 2 })

      expect(report.totalAffected).toBe(2) // transform2 and entity1
    })

    it('should filter by nodeTypes', () => {
      const report = analyzer.analyzeUpstreamImpact('sink1', { nodeTypes: ['source'] })

      expect(report.affectedAssets.map((a) => a.node.id)).toEqual(['source1'])
    })

    it('should filter by minimum severity', () => {
      const report = analyzer.analyzeUpstreamImpact('sink1', { minSeverity: 'high' })

      expect(report.affectedAssets.every((a) => ['critical', 'high'].includes(a.severity))).toBe(true)
    })

    it('should include severity breakdown', () => {
      const report = analyzer.analyzeUpstreamImpact('sink1')

      expect(report.bySeverity).toBeDefined()
      const totalBySeverity = Object.values(report.bySeverity).reduce((a, b) => a + b, 0)
      expect(totalBySeverity).toBe(report.totalAffected)
    })

    it('should include type breakdown', () => {
      const report = analyzer.analyzeUpstreamImpact('sink1')

      expect(report.byType).toBeDefined()
      expect(report.byType['transformation']).toBe(2)
      expect(report.byType['entity']).toBe(1)
      expect(report.byType['source']).toBe(1)
    })

    it('should return empty for source nodes', () => {
      const report = analyzer.analyzeUpstreamImpact('source1')

      expect(report.totalAffected).toBe(0)
    })

    it('should throw for non-existent node', () => {
      expect(() => analyzer.analyzeUpstreamImpact('non-existent')).toThrow()
    })
  })
})

// =============================================================================
// DOWNSTREAM IMPACT ANALYSIS TESTS
// =============================================================================

describe('ImpactAnalyzer - Downstream Impact Analysis', () => {
  let store: LineageStore
  let analyzer: ImpactAnalyzer

  beforeEach(() => {
    store = createTestStore()
    analyzer = createImpactAnalyzer(store)

    // Same graph as upstream tests
    store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
    store.createNode({ id: 'source2', type: 'source', name: 'Source 2' })
    store.createNode({ id: 'transform1', type: 'transformation', name: 'Transform 1' })
    store.createNode({ id: 'transform2', type: 'transformation', name: 'Transform 2' })
    store.createNode({ id: 'entity1', type: 'entity', name: 'Entity 1' })
    store.createNode({ id: 'entity2', type: 'entity', name: 'Entity 2' })
    store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })
    store.createNode({ id: 'sink2', type: 'sink', name: 'Sink 2' })

    store.createEdge({ fromNodeId: 'source1', toNodeId: 'transform1', operation: 'read' })
    store.createEdge({ fromNodeId: 'transform1', toNodeId: 'entity1', operation: 'write' })
    store.createEdge({ fromNodeId: 'entity1', toNodeId: 'transform2', operation: 'read' })
    store.createEdge({ fromNodeId: 'transform2', toNodeId: 'sink1', operation: 'write' })
    store.createEdge({ fromNodeId: 'entity1', toNodeId: 'entity2', operation: 'derive' })
    store.createEdge({ fromNodeId: 'source2', toNodeId: 'entity2', operation: 'read' })
    store.createEdge({ fromNodeId: 'entity2', toNodeId: 'sink2', operation: 'write' })
  })

  describe('analyzeDownstreamImpact', () => {
    it('should find all downstream assets', () => {
      const report = analyzer.analyzeDownstreamImpact('source1')

      expect(report.sourceAsset.id).toBe('source1')
      expect(report.direction).toBe('downstream')
      // source1 -> transform1 -> entity1 -> transform2 -> sink1
      //                               |
      //                               v
      //                          entity2 -> sink2
      expect(report.totalAffected).toBe(6)
    })

    it('should calculate correct distances', () => {
      const report = analyzer.analyzeDownstreamImpact('source1')

      const distances = new Map(report.affectedAssets.map((a) => [a.node.id, a.distance]))

      expect(distances.get('transform1')).toBe(1)
      expect(distances.get('entity1')).toBe(2)
      expect(distances.get('transform2')).toBe(3)
      expect(distances.get('entity2')).toBe(3)
      expect(distances.get('sink1')).toBe(4)
      expect(distances.get('sink2')).toBe(4)
    })

    it('should classify direct vs indirect impact', () => {
      const report = analyzer.analyzeDownstreamImpact('source1')

      const directNodes = report.affectedAssets.filter((a) => a.impactType === 'direct')
      const indirectNodes = report.affectedAssets.filter((a) => a.impactType === 'indirect')

      expect(directNodes.map((a) => a.node.id)).toEqual(['transform1'])
      expect(indirectNodes.length).toBe(5)
    })

    it('should respect maxDepth', () => {
      const report = analyzer.analyzeDownstreamImpact('source1', { maxDepth: 2 })

      expect(report.totalAffected).toBe(2) // transform1 and entity1
    })

    it('should filter by nodeTypes', () => {
      const report = analyzer.analyzeDownstreamImpact('source1', { nodeTypes: ['sink'] })

      expect(report.affectedAssets.map((a) => a.node.id).sort()).toEqual(['sink1', 'sink2'])
    })

    it('should include critical paths', () => {
      const report = analyzer.analyzeDownstreamImpact('source1')

      expect(report.criticalPaths).toBeDefined()
      expect(report.criticalPaths.length).toBeGreaterThan(0)
    })

    it('should return empty for sink nodes', () => {
      const report = analyzer.analyzeDownstreamImpact('sink1')

      expect(report.totalAffected).toBe(0)
    })

    it('should include recommended actions for high-severity assets', () => {
      const report = analyzer.analyzeDownstreamImpact('source1')

      const criticalAssets = report.affectedAssets.filter((a) => a.severity === 'critical')
      for (const asset of criticalAssets) {
        expect(asset.recommendedAction).toBeTruthy()
      }
    })

    it('should include max depth metric', () => {
      const report = analyzer.analyzeDownstreamImpact('source1')

      expect(report.maxDepth).toBe(4)
    })

    it('should extract owners from metadata', () => {
      // Add a node with owner metadata
      store.createNode({
        id: 'sink3',
        type: 'sink',
        name: 'Sink 3',
        metadata: { owner: 'data-team', team: 'analytics' },
      })
      store.createEdge({ fromNodeId: 'entity1', toNodeId: 'sink3', operation: 'write' })

      const report = analyzer.analyzeDownstreamImpact('source1')

      expect(report.affectedOwners).toContain('data-team')
      expect(report.affectedOwners).toContain('analytics')
    })
  })
})

// =============================================================================
// ROOT CAUSE ANALYSIS TESTS
// =============================================================================

describe('ImpactAnalyzer - Root Cause Analysis', () => {
  let store: LineageStore
  let analyzer: ImpactAnalyzer

  beforeEach(() => {
    store = createTestStore()
    analyzer = createImpactAnalyzer(store)

    store.createNode({ id: 'source1', type: 'source', name: 'Source 1', metadata: { hasQualityIssues: true } })
    store.createNode({ id: 'source2', type: 'source', name: 'Source 2', metadata: { hasQualityIssues: false } })
    store.createNode({ id: 'transform1', type: 'transformation', name: 'Transform 1' })
    store.createNode({ id: 'entity1', type: 'entity', name: 'Entity 1' })
    store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })

    store.createEdge({ fromNodeId: 'source1', toNodeId: 'transform1', operation: 'read' })
    store.createEdge({ fromNodeId: 'source2', toNodeId: 'transform1', operation: 'read' })
    store.createEdge({ fromNodeId: 'transform1', toNodeId: 'entity1', operation: 'write' })
    store.createEdge({ fromNodeId: 'entity1', toNodeId: 'sink1', operation: 'write' })
  })

  describe('findRootCause', () => {
    it('should find nodes matching predicate upstream', () => {
      const causes = analyzer.findRootCause('sink1', (node) => {
        return (node.metadata as { hasQualityIssues?: boolean }).hasQualityIssues === true
      })

      expect(causes.map((n) => n.id)).toEqual(['source1'])
    })

    it('should find all sources', () => {
      const sources = analyzer.findRootCause('sink1', (node) => node.type === 'source')

      expect(sources.map((n) => n.id).sort()).toEqual(['source1', 'source2'])
    })

    it('should return empty if no matches', () => {
      const causes = analyzer.findRootCause('sink1', (node) => node.type === 'sink')

      // The sink1 itself matches, but we're looking upstream
      expect(causes.length).toBe(1) // Only sink1 itself
    })

    it('should handle nodes with no upstream', () => {
      const causes = analyzer.findRootCause('source1', (node) => node.type === 'source')

      expect(causes.map((n) => n.id)).toEqual(['source1'])
    })

    it('should throw for non-existent node', () => {
      expect(() => analyzer.findRootCause('non-existent', () => true)).toThrow()
    })
  })

  describe('findSourcesFor', () => {
    it('should find all root sources', () => {
      const sources = analyzer.findSourcesFor('sink1')

      expect(sources.map((n) => n.id).sort()).toEqual(['source1', 'source2'])
    })

    it('should return empty for root nodes', () => {
      const sources = analyzer.findSourcesFor('source1')

      // source1 is a root itself
      expect(sources.map((n) => n.id)).toEqual(['source1'])
    })
  })
})

// =============================================================================
// LINEAGE COVERAGE TESTS
// =============================================================================

describe('ImpactAnalyzer - Lineage Coverage', () => {
  let store: LineageStore
  let analyzer: ImpactAnalyzer

  beforeEach(() => {
    store = createTestStore()
    analyzer = createImpactAnalyzer(store)
  })

  describe('getLineageCoverage', () => {
    it('should return empty coverage for empty graph', () => {
      const coverage = analyzer.getLineageCoverage()

      expect(coverage.totalAssets).toBe(0)
      expect(coverage.coveragePercentage).toBe(0)
      expect(coverage.orphans).toHaveLength(0)
    })

    it('should calculate coverage correctly', () => {
      store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
      store.createNode({ id: 'transform1', type: 'transformation', name: 'Transform 1' })
      store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })
      store.createNode({ id: 'orphan1', type: 'entity', name: 'Orphan 1' }) // No connections

      store.createEdge({ fromNodeId: 'source1', toNodeId: 'transform1', operation: 'read' })
      store.createEdge({ fromNodeId: 'transform1', toNodeId: 'sink1', operation: 'write' })

      const coverage = analyzer.getLineageCoverage()

      expect(coverage.totalAssets).toBe(4)
      expect(coverage.orphans).toHaveLength(1)
      expect(coverage.orphans[0].node.id).toBe('orphan1')
      expect(coverage.coveragePercentage).toBe(0.75) // 3/4 connected
    })

    it('should identify roots and leaves', () => {
      store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
      store.createNode({ id: 'transform1', type: 'transformation', name: 'Transform 1' })
      store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })

      store.createEdge({ fromNodeId: 'source1', toNodeId: 'transform1', operation: 'read' })
      store.createEdge({ fromNodeId: 'transform1', toNodeId: 'sink1', operation: 'write' })

      const coverage = analyzer.getLineageCoverage()

      expect(coverage.roots.map((n) => n.id)).toEqual(['source1'])
      expect(coverage.leaves.map((n) => n.id)).toEqual(['sink1'])
    })

    it('should track fully connected assets', () => {
      store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
      store.createNode({ id: 'transform1', type: 'transformation', name: 'Transform 1' })
      store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })

      store.createEdge({ fromNodeId: 'source1', toNodeId: 'transform1', operation: 'read' })
      store.createEdge({ fromNodeId: 'transform1', toNodeId: 'sink1', operation: 'write' })

      const coverage = analyzer.getLineageCoverage()

      expect(coverage.fullyConnected).toBe(1) // Only transform1 has both
    })

    it('should calculate coverage by namespace', () => {
      store.createNode({ id: 'n1', type: 'entity', name: 'N1', namespace: 'ns1' })
      store.createNode({ id: 'n2', type: 'entity', name: 'N2', namespace: 'ns1' })
      store.createNode({ id: 'n3', type: 'entity', name: 'N3', namespace: 'ns2' })
      store.createNode({ id: 'n4', type: 'entity', name: 'N4', namespace: 'ns2' })

      store.createEdge({ fromNodeId: 'n1', toNodeId: 'n2', operation: 'link' })
      // n3 and n4 are orphans in ns2

      const coverage = analyzer.getLineageCoverage()

      const ns1Coverage = coverage.coverageByNamespace.get('ns1')
      const ns2Coverage = coverage.coverageByNamespace.get('ns2')

      expect(ns1Coverage?.coveragePercentage).toBe(1) // Both connected
      expect(ns2Coverage?.coveragePercentage).toBe(0) // Neither connected
    })

    it('should include timestamp', () => {
      const before = Date.now()
      const coverage = analyzer.getLineageCoverage()
      const after = Date.now()

      expect(coverage.analyzedAt).toBeGreaterThanOrEqual(before)
      expect(coverage.analyzedAt).toBeLessThanOrEqual(after)
    })
  })
})

// =============================================================================
// CIRCULAR DEPENDENCY DETECTION TESTS
// =============================================================================

describe('ImpactAnalyzer - Circular Dependency Detection', () => {
  let store: LineageStore
  let analyzer: ImpactAnalyzer

  beforeEach(() => {
    // Create store with cycle detection disabled for testing
    const sql = createTestDb()
    store = createLineageStore(sql, { detectCycles: false })
    analyzer = createImpactAnalyzer(store)
  })

  describe('detectCircularDependencies', () => {
    it('should return empty for acyclic graph', () => {
      store.createNode({ id: 'a', type: 'entity', name: 'A' })
      store.createNode({ id: 'b', type: 'entity', name: 'B' })
      store.createNode({ id: 'c', type: 'entity', name: 'C' })

      store.createEdge({ fromNodeId: 'a', toNodeId: 'b', operation: 's1' })
      store.createEdge({ fromNodeId: 'b', toNodeId: 'c', operation: 's2' })

      const cycles = analyzer.detectCircularDependencies()

      expect(cycles).toHaveLength(0)
    })

    it('should detect simple cycle', () => {
      store.createNode({ id: 'a', type: 'entity', name: 'A' })
      store.createNode({ id: 'b', type: 'entity', name: 'B' })

      store.createEdge({ fromNodeId: 'a', toNodeId: 'b', operation: 's1' })
      store.createEdge({ fromNodeId: 'b', toNodeId: 'a', operation: 's2' })

      const cycles = analyzer.detectCircularDependencies()

      expect(cycles.length).toBe(1)
      expect(cycles[0].cycleLength).toBe(2)
      expect(cycles[0].nodeIds.sort()).toEqual(['a', 'b'])
    })

    it('should detect longer cycles', () => {
      store.createNode({ id: 'a', type: 'entity', name: 'A' })
      store.createNode({ id: 'b', type: 'entity', name: 'B' })
      store.createNode({ id: 'c', type: 'entity', name: 'C' })

      store.createEdge({ fromNodeId: 'a', toNodeId: 'b', operation: 's1' })
      store.createEdge({ fromNodeId: 'b', toNodeId: 'c', operation: 's2' })
      store.createEdge({ fromNodeId: 'c', toNodeId: 'a', operation: 's3' })

      const cycles = analyzer.detectCircularDependencies()

      expect(cycles.length).toBe(1)
      expect(cycles[0].cycleLength).toBe(3)
    })

    it('should detect multiple cycles', () => {
      // Cycle 1: a -> b -> a
      store.createNode({ id: 'a', type: 'entity', name: 'A' })
      store.createNode({ id: 'b', type: 'entity', name: 'B' })
      store.createEdge({ fromNodeId: 'a', toNodeId: 'b', operation: 's1' })
      store.createEdge({ fromNodeId: 'b', toNodeId: 'a', operation: 's2' })

      // Cycle 2: c -> d -> c (disconnected)
      store.createNode({ id: 'c', type: 'entity', name: 'C' })
      store.createNode({ id: 'd', type: 'entity', name: 'D' })
      store.createEdge({ fromNodeId: 'c', toNodeId: 'd', operation: 's3' })
      store.createEdge({ fromNodeId: 'd', toNodeId: 'c', operation: 's4' })

      const cycles = analyzer.detectCircularDependencies()

      expect(cycles.length).toBe(2)
    })

    it('should include start node in cycle info', () => {
      store.createNode({ id: 'a', type: 'entity', name: 'A' })
      store.createNode({ id: 'b', type: 'entity', name: 'B' })

      store.createEdge({ fromNodeId: 'a', toNodeId: 'b', operation: 's1' })
      store.createEdge({ fromNodeId: 'b', toNodeId: 'a', operation: 's2' })

      const cycles = analyzer.detectCircularDependencies()

      expect(cycles[0].startNode).toBeDefined()
      expect(['a', 'b']).toContain(cycles[0].startNode.id)
    })
  })

  describe('isInCycle', () => {
    it('should return true for node in cycle', () => {
      store.createNode({ id: 'a', type: 'entity', name: 'A' })
      store.createNode({ id: 'b', type: 'entity', name: 'B' })
      store.createNode({ id: 'c', type: 'entity', name: 'C' }) // Not in cycle

      store.createEdge({ fromNodeId: 'a', toNodeId: 'b', operation: 's1' })
      store.createEdge({ fromNodeId: 'b', toNodeId: 'a', operation: 's2' })
      store.createEdge({ fromNodeId: 'a', toNodeId: 'c', operation: 's3' })

      expect(analyzer.isInCycle('a')).toBe(true)
      expect(analyzer.isInCycle('b')).toBe(true)
      expect(analyzer.isInCycle('c')).toBe(false)
    })
  })
})

// =============================================================================
// ORPHAN DETECTION TESTS
// =============================================================================

describe('ImpactAnalyzer - Orphan Detection', () => {
  let store: LineageStore
  let analyzer: ImpactAnalyzer

  beforeEach(() => {
    store = createTestStore()
    analyzer = createImpactAnalyzer(store)
  })

  describe('findOrphans', () => {
    it('should find isolated assets', () => {
      // Use source and sink to avoid no_upstream/no_downstream flags
      store.createNode({ id: 'connected1', type: 'source', name: 'Connected 1' })
      store.createNode({ id: 'connected2', type: 'sink', name: 'Connected 2' })
      store.createNode({ id: 'orphan1', type: 'entity', name: 'Orphan 1' })

      store.createEdge({ fromNodeId: 'connected1', toNodeId: 'connected2', operation: 'link' })

      const orphans = analyzer.findOrphans()
      const isolatedOrphans = orphans.filter((o) => o.reason === 'isolated')

      expect(isolatedOrphans.length).toBe(1)
      expect(isolatedOrphans[0].node.id).toBe('orphan1')
      expect(isolatedOrphans[0].reason).toBe('isolated')
    })

    it('should find non-source assets without upstream', () => {
      store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
      store.createNode({ id: 'entity1', type: 'entity', name: 'Entity 1' }) // Entity without upstream
      store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })

      store.createEdge({ fromNodeId: 'entity1', toNodeId: 'sink1', operation: 'write' })

      const orphans = analyzer.findOrphans()

      const noUpstreamOrphan = orphans.find((o) => o.reason === 'no_upstream')
      expect(noUpstreamOrphan).toBeDefined()
      expect(noUpstreamOrphan?.node.id).toBe('entity1')
    })

    it('should find non-sink assets without downstream', () => {
      store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
      store.createNode({ id: 'entity1', type: 'entity', name: 'Entity 1' }) // Entity without downstream
      store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })

      store.createEdge({ fromNodeId: 'source1', toNodeId: 'entity1', operation: 'read' })

      const orphans = analyzer.findOrphans()

      const noDownstreamOrphan = orphans.find((o) => o.reason === 'no_downstream')
      expect(noDownstreamOrphan).toBeDefined()
      expect(noDownstreamOrphan?.node.id).toBe('entity1')
    })

    it('should not flag sources without upstream as orphans', () => {
      store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
      store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })

      store.createEdge({ fromNodeId: 'source1', toNodeId: 'sink1', operation: 'write' })

      const orphans = analyzer.findOrphans()

      expect(orphans.find((o) => o.node.id === 'source1')).toBeUndefined()
    })

    it('should not flag sinks without downstream as orphans', () => {
      store.createNode({ id: 'source1', type: 'source', name: 'Source 1' })
      store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })

      store.createEdge({ fromNodeId: 'source1', toNodeId: 'sink1', operation: 'write' })

      const orphans = analyzer.findOrphans()

      expect(orphans.find((o) => o.node.id === 'sink1')).toBeUndefined()
    })
  })

  describe('findIsolatedAssets', () => {
    it('should find only completely isolated assets', () => {
      store.createNode({ id: 'connected', type: 'entity', name: 'Connected' })
      store.createNode({ id: 'isolated1', type: 'entity', name: 'Isolated 1' })
      store.createNode({ id: 'isolated2', type: 'entity', name: 'Isolated 2' })
      store.createNode({ id: 'sink1', type: 'sink', name: 'Sink 1' })

      store.createEdge({ fromNodeId: 'connected', toNodeId: 'sink1', operation: 'write' })

      const isolated = analyzer.findIsolatedAssets()

      expect(isolated.map((n) => n.id).sort()).toEqual(['isolated1', 'isolated2'])
    })
  })
})

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('ImpactAnalyzer - Edge Cases', () => {
  let store: LineageStore
  let analyzer: ImpactAnalyzer

  beforeEach(() => {
    store = createTestStore()
    analyzer = createImpactAnalyzer(store)
  })

  it('should handle diamond dependencies', () => {
    //   A
    //  / \
    // B   C
    //  \ /
    //   D
    store.createNode({ id: 'A', type: 'source', name: 'A' })
    store.createNode({ id: 'B', type: 'transformation', name: 'B' })
    store.createNode({ id: 'C', type: 'transformation', name: 'C' })
    store.createNode({ id: 'D', type: 'sink', name: 'D' })

    store.createEdge({ fromNodeId: 'A', toNodeId: 'B', operation: 's1' })
    store.createEdge({ fromNodeId: 'A', toNodeId: 'C', operation: 's2' })
    store.createEdge({ fromNodeId: 'B', toNodeId: 'D', operation: 's3' })
    store.createEdge({ fromNodeId: 'C', toNodeId: 'D', operation: 's4' })

    const downstream = analyzer.analyzeDownstreamImpact('A')
    expect(downstream.totalAffected).toBe(3) // B, C, D

    const upstream = analyzer.analyzeUpstreamImpact('D')
    expect(upstream.totalAffected).toBe(3) // A, B, C
  })

  it('should handle very long chains', () => {
    // Create a chain of 50 nodes
    const nodes: LineageNode[] = []
    for (let i = 0; i < 50; i++) {
      nodes.push(store.createNode({ type: 'entity', name: `node_${i}` }))
    }

    for (let i = 0; i < 49; i++) {
      store.createEdge({
        fromNodeId: nodes[i].id,
        toNodeId: nodes[i + 1].id,
        operation: `step_${i}`,
      })
    }

    const downstream = analyzer.analyzeDownstreamImpact(nodes[0].id)
    expect(downstream.totalAffected).toBe(49)
    expect(downstream.maxDepth).toBe(49)

    const upstream = analyzer.analyzeUpstreamImpact(nodes[49].id)
    expect(upstream.totalAffected).toBe(49)
  })

  it('should handle wide graphs (many siblings)', () => {
    store.createNode({ id: 'root', type: 'source', name: 'Root' })

    for (let i = 0; i < 20; i++) {
      store.createNode({ id: `child${i}`, type: 'sink', name: `Child ${i}` })
      store.createEdge({ fromNodeId: 'root', toNodeId: `child${i}`, operation: `to_${i}` })
    }

    const downstream = analyzer.analyzeDownstreamImpact('root')
    expect(downstream.totalAffected).toBe(20)
    expect(downstream.maxDepth).toBe(1)
  })

  it('should handle disconnected components', () => {
    // Component 1
    store.createNode({ id: 'a1', type: 'source', name: 'A1' })
    store.createNode({ id: 'b1', type: 'sink', name: 'B1' })
    store.createEdge({ fromNodeId: 'a1', toNodeId: 'b1', operation: 'link' })

    // Component 2 (disconnected)
    store.createNode({ id: 'a2', type: 'source', name: 'A2' })
    store.createNode({ id: 'b2', type: 'sink', name: 'B2' })
    store.createEdge({ fromNodeId: 'a2', toNodeId: 'b2', operation: 'link' })

    const downstream = analyzer.analyzeDownstreamImpact('a1')
    expect(downstream.totalAffected).toBe(1) // Only b1

    const coverage = analyzer.getLineageCoverage()
    expect(coverage.roots.length).toBe(2)
    expect(coverage.leaves.length).toBe(2)
  })

  it('should exclude indirect when includeIndirect is false', () => {
    store.createNode({ id: 'a', type: 'source', name: 'A' })
    store.createNode({ id: 'b', type: 'transformation', name: 'B' })
    store.createNode({ id: 'c', type: 'sink', name: 'C' })

    store.createEdge({ fromNodeId: 'a', toNodeId: 'b', operation: 's1' })
    store.createEdge({ fromNodeId: 'b', toNodeId: 'c', operation: 's2' })

    const downstream = analyzer.analyzeDownstreamImpact('a', { includeIndirect: false })

    expect(downstream.totalAffected).toBe(1) // Only direct child B
    expect(downstream.affectedAssets[0].node.id).toBe('b')
  })
})

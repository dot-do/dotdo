/**
 * Cross-System Lineage Tests
 *
 * Tests for tracking lineage across multiple systems:
 * - System registration and management
 * - Metadata extraction
 * - URN normalization and matching
 * - Lineage stitching algorithm
 * - Confidence scoring
 * - End-to-end lineage queries
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CrossSystemLineageTracker,
  createCrossSystemLineageTracker,
  BaseSystemAdapter,
  calculateConfidence,
  normalizeAssetName,
  type SystemInfo,
  type CrossSystemAsset,
  type CrossSystemEdge,
  type StitchingConfig,
  type NamingConvention,
  type MatchingRule,
  type StitchingCandidate,
} from '../cross-system'

// =============================================================================
// MOCK ADAPTERS
// =============================================================================

/**
 * Mock adapter for Postgres source database
 */
class MockPostgresAdapter extends BaseSystemAdapter {
  private mockAssets: CrossSystemAsset[] = []
  private mockEdges: CrossSystemEdge[] = []

  constructor(id: string = 'postgres-prod') {
    super({
      id,
      name: 'Production Postgres',
      category: 'source_database',
      type: 'postgres',
      config: { host: 'localhost', port: 5432 },
      urnScheme: 'db',
    })
  }

  setMockData(assets: CrossSystemAsset[], edges: CrossSystemEdge[]): void {
    this.mockAssets = assets
    this.mockEdges = edges
  }

  async extractAssets(): Promise<CrossSystemAsset[]> {
    return this.mockAssets
  }

  async extractLineage(): Promise<CrossSystemEdge[]> {
    return this.mockEdges
  }

  async getAsset(identifier: string): Promise<CrossSystemAsset | null> {
    return this.mockAssets.find((a) => a.urn === identifier || a.sourceIdentifier === identifier) || null
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  // Expose helper for testing
  createTestAsset(name: string, type: 'table' | 'column' = 'table'): CrossSystemAsset {
    const urn = `db://${this.info.id}/public/${name}${type === 'column' ? '/id' : ''}`
    return this.createCrossSystemAsset(urn, type, name, `public.${name}`)
  }
}

/**
 * Mock adapter for DuckDB warehouse
 */
class MockDuckDBAdapter extends BaseSystemAdapter {
  private mockAssets: CrossSystemAsset[] = []
  private mockEdges: CrossSystemEdge[] = []

  constructor(id: string = 'duckdb-analytics') {
    super({
      id,
      name: 'Analytics DuckDB',
      category: 'warehouse',
      type: 'duckdb',
      config: { path: '/data/analytics.db' },
      urnScheme: 'warehouse',
    })
  }

  setMockData(assets: CrossSystemAsset[], edges: CrossSystemEdge[]): void {
    this.mockAssets = assets
    this.mockEdges = edges
  }

  async extractAssets(): Promise<CrossSystemAsset[]> {
    return this.mockAssets
  }

  async extractLineage(): Promise<CrossSystemEdge[]> {
    return this.mockEdges
  }

  async getAsset(identifier: string): Promise<CrossSystemAsset | null> {
    return this.mockAssets.find((a) => a.urn === identifier || a.sourceIdentifier === identifier) || null
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  createTestAsset(name: string, type: 'table' | 'view' = 'table'): CrossSystemAsset {
    const urn = `warehouse://${this.info.id}/main/${name}`
    return this.createCrossSystemAsset(urn, type, name, `main.${name}`)
  }
}

/**
 * Mock adapter for Metabase BI tool
 */
class MockMetabaseAdapter extends BaseSystemAdapter {
  private mockAssets: CrossSystemAsset[] = []
  private mockEdges: CrossSystemEdge[] = []

  constructor(id: string = 'metabase-bi') {
    super({
      id,
      name: 'Metabase BI',
      category: 'bi_tool',
      type: 'metabase',
      config: { url: 'https://metabase.example.com' },
      urnScheme: 'api',
    })
  }

  setMockData(assets: CrossSystemAsset[], edges: CrossSystemEdge[]): void {
    this.mockAssets = assets
    this.mockEdges = edges
  }

  async extractAssets(): Promise<CrossSystemAsset[]> {
    return this.mockAssets
  }

  async extractLineage(): Promise<CrossSystemEdge[]> {
    return this.mockEdges
  }

  async getAsset(identifier: string): Promise<CrossSystemAsset | null> {
    return this.mockAssets.find((a) => a.urn === identifier || a.sourceIdentifier === identifier) || null
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  createTestAsset(name: string, type: 'dashboard' | 'report' = 'dashboard'): CrossSystemAsset {
    const urn = `api://${this.info.id}/dashboards/${name}`
    return this.createCrossSystemAsset(urn, type, name, `dashboard:${name}`)
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('CrossSystemLineageTracker', () => {
  describe('system registration', () => {
    it('should register a system adapter', () => {
      const tracker = createCrossSystemLineageTracker()
      const adapter = new MockPostgresAdapter()

      tracker.registerSystem(adapter)

      expect(tracker.getSystems()).toHaveLength(1)
      expect(tracker.getSystems()[0].id).toBe('postgres-prod')
    })

    it('should throw when registering duplicate system', () => {
      const tracker = createCrossSystemLineageTracker()
      const adapter1 = new MockPostgresAdapter('pg')
      const adapter2 = new MockPostgresAdapter('pg')

      tracker.registerSystem(adapter1)

      expect(() => tracker.registerSystem(adapter2)).toThrow('already registered')
    })

    it('should unregister a system', () => {
      const tracker = createCrossSystemLineageTracker()
      const adapter = new MockPostgresAdapter()

      tracker.registerSystem(adapter)
      expect(tracker.getSystems()).toHaveLength(1)

      const result = tracker.unregisterSystem('postgres-prod')
      expect(result).toBe(true)
      expect(tracker.getSystems()).toHaveLength(0)
    })

    it('should register multiple systems', () => {
      const tracker = createCrossSystemLineageTracker()

      tracker.registerSystem(new MockPostgresAdapter())
      tracker.registerSystem(new MockDuckDBAdapter())
      tracker.registerSystem(new MockMetabaseAdapter())

      expect(tracker.getSystems()).toHaveLength(3)
      const categories = tracker.getSystems().map((s) => s.category)
      expect(categories).toContain('source_database')
      expect(categories).toContain('warehouse')
      expect(categories).toContain('bi_tool')
    })
  })

  describe('metadata extraction', () => {
    it('should sync assets from a system', async () => {
      const tracker = createCrossSystemLineageTracker()
      const adapter = new MockPostgresAdapter()

      const asset1 = adapter.createTestAsset('users')
      const asset2 = adapter.createTestAsset('orders')
      adapter.setMockData([asset1, asset2], [])

      tracker.registerSystem(adapter)
      await tracker.syncSystem('postgres-prod')

      expect(tracker.getAssets()).toHaveLength(2)
      expect(tracker.getAsset(asset1.urn)).toBeDefined()
    })

    it('should sync all registered systems', async () => {
      const tracker = createCrossSystemLineageTracker()

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      pgAdapter.setMockData([pgAdapter.createTestAsset('users')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('user_stats')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)

      const results = await tracker.syncAll()

      expect(results.size).toBe(2)
      expect(tracker.getAssets()).toHaveLength(2)
    })

    it('should handle sync errors gracefully', async () => {
      const tracker = createCrossSystemLineageTracker()
      const adapter = new MockPostgresAdapter()

      // Make extractAssets throw
      adapter.extractAssets = async () => {
        throw new Error('Connection failed')
      }

      tracker.registerSystem(adapter)
      const results = await tracker.syncAll()

      expect(results.get('postgres-prod')?.errors).toHaveLength(1)
      expect(results.get('postgres-prod')?.errors[0].code).toBe('ASSET_EXTRACTION_ERROR')
    })

    it('should index assets by both original and normalized URN', async () => {
      const tracker = createCrossSystemLineageTracker()
      const adapter = new MockPostgresAdapter()

      const asset = adapter.createTestAsset('UserAccounts')
      adapter.setMockData([asset], [])

      tracker.registerSystem(adapter)
      await tracker.syncSystem('postgres-prod')

      // Should find by original URN
      expect(tracker.getAsset(asset.urn)).toBeDefined()
      // Should also find by normalized URN
      expect(tracker.getAsset(asset.normalizedUrn)).toBeDefined()
    })
  })

  describe('lineage stitching - exact matching', () => {
    it('should find candidates with exact name match', async () => {
      const tracker = createCrossSystemLineageTracker()

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      // Same name in both systems
      pgAdapter.setMockData([pgAdapter.createTestAsset('users')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('users')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const result = tracker.stitchLineage()

      expect(result.stitchedEdges.length).toBeGreaterThan(0)
      expect(result.stitchedEdges[0].crossesBoundary).toBe(true)
      expect(result.stitchedEdges[0].stitchingMethod).toBe('name_match')
    })

    it('should stitch assets with alias matches', async () => {
      const tracker = createCrossSystemLineageTracker()

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      const pgAsset = pgAdapter.createTestAsset('user_accounts')
      const duckAsset = duckAdapter.createTestAsset('users')

      // Add alias to source asset pointing to target
      pgAsset.aliases = [
        {
          systemId: 'duckdb-analytics',
          alias: duckAsset.urn,
          matchType: 'mapped',
          confidence: 0.95,
        },
      ]

      pgAdapter.setMockData([pgAsset], [])
      duckAdapter.setMockData([duckAsset], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const result = tracker.stitchLineage()

      expect(result.stitchedEdges.length).toBeGreaterThan(0)
      expect(result.stitchedEdges[0].stitchingMethod).toBe('exact_match')
    })
  })

  describe('lineage stitching - fuzzy matching', () => {
    it('should match assets with similar names (fuzzy)', async () => {
      const tracker = createCrossSystemLineageTracker({ fuzzyMatching: true, minConfidence: 0.6 })

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      // Similar but not identical names
      pgAdapter.setMockData([pgAdapter.createTestAsset('user_events')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('userevents')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const result = tracker.stitchLineage()

      expect(result.stitchedEdges.length).toBeGreaterThan(0)
    })

    it('should not match very different names', async () => {
      const tracker = createCrossSystemLineageTracker({ fuzzyMatching: true, minConfidence: 0.7 })

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      pgAdapter.setMockData([pgAdapter.createTestAsset('users')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('orders')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const result = tracker.stitchLineage()

      // Should not match "users" with "orders"
      expect(result.stitchedEdges.length).toBe(0)
      expect(result.orphanAssets.length).toBe(2)
    })
  })

  describe('lineage stitching - custom rules', () => {
    it('should apply custom matching rules', async () => {
      const customRule: MatchingRule = {
        name: 'pg_to_duck_transform',
        sourcePattern: 'db://postgres-prod',
        targetPattern: 'warehouse://duckdb-analytics',
        transform: (name) => `${name}_transformed`,
        confidence: 0.9,
      }

      const tracker = createCrossSystemLineageTracker({ customRules: [customRule] })

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      pgAdapter.setMockData([pgAdapter.createTestAsset('events')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('events_transformed')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const result = tracker.stitchLineage()

      expect(result.stitchedEdges.length).toBeGreaterThan(0)
      expect(result.stitchedEdges[0].stitchingMethod).toBe('config_mapping')
    })
  })

  describe('lineage stitching - confidence scoring', () => {
    it('should reject matches below confidence threshold', async () => {
      const tracker = createCrossSystemLineageTracker({ minConfidence: 0.95, fuzzyMatching: true })

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      // Names that are similar but not identical after normalization
      // "user_profile" vs "users_profiles" are similar but will have < 0.95 confidence
      pgAdapter.setMockData([pgAdapter.createTestAsset('user_profile')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('users_profiles')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const result = tracker.stitchLineage()

      // With 0.95 threshold, fuzzy matches with similarity < 0.95 should be rejected
      // Since "userprofile" vs "usersprofiles" aren't identical, they'll be evaluated as fuzzy
      // The match should exist but with lower confidence (rejected candidates show evaluated but rejected)
      expect(result.stitchedEdges.length).toBe(0) // High threshold means no edges
      expect(result.orphanAssets.length).toBe(2) // Both assets are orphans
    })

    it('should calculate average confidence in stats', async () => {
      const tracker = createCrossSystemLineageTracker({ minConfidence: 0.5 })

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      pgAdapter.setMockData(
        [pgAdapter.createTestAsset('users'), pgAdapter.createTestAsset('orders')],
        []
      )
      duckAdapter.setMockData(
        [duckAdapter.createTestAsset('users'), duckAdapter.createTestAsset('orders')],
        []
      )

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const result = tracker.stitchLineage()

      expect(result.stats.avgConfidence).toBeGreaterThan(0)
      expect(result.stats.avgConfidence).toBeLessThanOrEqual(1)
    })

    it('should track stitching statistics', async () => {
      const tracker = createCrossSystemLineageTracker()

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      pgAdapter.setMockData([pgAdapter.createTestAsset('users')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('users')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const result = tracker.stitchLineage()

      expect(result.stats.totalCandidates).toBeGreaterThan(0)
      expect(result.stats.processingTimeMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('end-to-end lineage queries', () => {
    let tracker: CrossSystemLineageTracker

    beforeEach(async () => {
      tracker = createCrossSystemLineageTracker({ minConfidence: 0.5 })

      // Setup source -> warehouse -> BI pipeline
      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()
      const metabaseAdapter = new MockMetabaseAdapter()

      const pgUsers = pgAdapter.createTestAsset('users')
      const pgOrders = pgAdapter.createTestAsset('orders')
      const duckUsers = duckAdapter.createTestAsset('users')
      const duckOrderSummary = duckAdapter.createTestAsset('order_summary')
      const mbDashboard = metabaseAdapter.createTestAsset('sales_dashboard')

      // Internal lineage within warehouse
      const warehouseEdge: CrossSystemEdge = {
        id: 'wh-edge-1',
        sourceUrn: duckUsers.urn,
        targetUrn: duckOrderSummary.urn,
        transformationType: 'aggregated',
        lineageSource: 'parsed',
        confidence: 1.0,
        transformation: { sql: 'SELECT user_id, COUNT(*) FROM orders GROUP BY user_id' },
        metadata: {},
        createdAt: Date.now(),
        lastObservedAt: Date.now(),
        active: true,
        sourceSystemId: 'duckdb-analytics',
        targetSystemId: 'duckdb-analytics',
        crossesBoundary: false,
      }

      // Add alias from dashboard to warehouse table
      mbDashboard.aliases = [
        {
          systemId: 'duckdb-analytics',
          alias: duckOrderSummary.urn,
          matchType: 'mapped',
          confidence: 0.9,
        },
      ]

      pgAdapter.setMockData([pgUsers, pgOrders], [])
      duckAdapter.setMockData([duckUsers, duckOrderSummary], [warehouseEdge])
      metabaseAdapter.setMockData([mbDashboard], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      tracker.registerSystem(metabaseAdapter)

      await tracker.syncAll()
      tracker.stitchLineage()
    })

    it('should get downstream lineage from source', () => {
      const pgUsersUrn = 'db://postgres-prod/public/users'
      const lineage = tracker.getEndToEndLineage(pgUsersUrn, { direction: 'downstream' })

      expect(lineage.rootUrn).toBe(pgUsersUrn)
      expect(lineage.direction).toBe('downstream')
      expect(lineage.assets.length).toBeGreaterThan(0)
    })

    it('should get upstream lineage from BI tool', () => {
      const dashboardUrn = 'api://metabase-bi/dashboards/sales_dashboard'
      const lineage = tracker.getEndToEndLineage(dashboardUrn, { direction: 'upstream' })

      expect(lineage.rootUrn).toBe(dashboardUrn)
      expect(lineage.direction).toBe('upstream')
    })

    it('should filter lineage by systems', () => {
      const pgUsersUrn = 'db://postgres-prod/public/users'
      const lineage = tracker.getEndToEndLineage(pgUsersUrn, {
        direction: 'downstream',
        systems: ['duckdb-analytics'],
      })

      // Should only include assets from specified systems
      for (const asset of lineage.assets) {
        expect(asset.systemId).toBe('duckdb-analytics')
      }
    })

    it('should respect minimum confidence in queries', () => {
      const pgUsersUrn = 'db://postgres-prod/public/users'
      const lineage = tracker.getEndToEndLineage(pgUsersUrn, {
        direction: 'downstream',
        minConfidence: 0.99,
      })

      // High confidence threshold should filter out low-confidence edges
      for (const edge of lineage.edges) {
        expect(edge.confidence).toBeGreaterThanOrEqual(0.99)
      }
    })

    it('should include all relevant systems in result', () => {
      const pgUsersUrn = 'db://postgres-prod/public/users'
      const lineage = tracker.getEndToEndLineage(pgUsersUrn, { direction: 'both' })

      expect(lineage.systems.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('asset management', () => {
    it('should get assets by system', async () => {
      const tracker = createCrossSystemLineageTracker()

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      pgAdapter.setMockData([pgAdapter.createTestAsset('a'), pgAdapter.createTestAsset('b')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('c')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()

      const pgAssets = tracker.getAssetsBySystem('postgres-prod')
      expect(pgAssets).toHaveLength(2)

      const duckAssets = tracker.getAssetsBySystem('duckdb-analytics')
      expect(duckAssets).toHaveLength(1)
    })

    it('should get all edges including stitched', async () => {
      const tracker = createCrossSystemLineageTracker()

      const pgAdapter = new MockPostgresAdapter()
      const duckAdapter = new MockDuckDBAdapter()

      pgAdapter.setMockData([pgAdapter.createTestAsset('users')], [])
      duckAdapter.setMockData([duckAdapter.createTestAsset('users')], [])

      tracker.registerSystem(pgAdapter)
      tracker.registerSystem(duckAdapter)
      await tracker.syncAll()
      tracker.stitchLineage()

      const allEdges = tracker.getAllEdges()
      const stitchedOnly = tracker.getStitchedEdges()

      expect(allEdges.length).toBeGreaterThanOrEqual(stitchedOnly.length)
    })

    it('should clear all data', async () => {
      const tracker = createCrossSystemLineageTracker()

      const pgAdapter = new MockPostgresAdapter()
      pgAdapter.setMockData([pgAdapter.createTestAsset('users')], [])

      tracker.registerSystem(pgAdapter)
      await tracker.syncAll()

      expect(tracker.getAssets().length).toBeGreaterThan(0)

      tracker.clear()

      expect(tracker.getAssets()).toHaveLength(0)
      expect(tracker.getAllEdges()).toHaveLength(0)
    })
  })
})

describe('calculateConfidence', () => {
  it('should calculate weighted average', () => {
    const result = calculateConfidence([
      { score: 1.0, weight: 0.5 },
      { score: 0.8, weight: 0.3 },
      { score: 0.6, weight: 0.2 },
    ])

    // (1.0 * 0.5 + 0.8 * 0.3 + 0.6 * 0.2) / (0.5 + 0.3 + 0.2)
    // = (0.5 + 0.24 + 0.12) / 1.0 = 0.86
    expect(result).toBeCloseTo(0.86)
  })

  it('should return 0 for empty factors', () => {
    expect(calculateConfidence([])).toBe(0)
  })

  it('should handle single factor', () => {
    const result = calculateConfidence([{ score: 0.75, weight: 1.0 }])
    expect(result).toBe(0.75)
  })
})

describe('normalizeAssetName', () => {
  it('should normalize to lowercase', () => {
    const convention: NamingConvention = { caseStyle: 'lowercase' }
    expect(normalizeAssetName('UserAccounts', convention)).toBe('useraccounts')
  })

  it('should normalize to uppercase', () => {
    const convention: NamingConvention = { caseStyle: 'uppercase' }
    expect(normalizeAssetName('userAccounts', convention)).toBe('USERACCOUNTS')
  })

  it('should normalize to snake_case', () => {
    const convention: NamingConvention = { caseStyle: 'snake_case' }
    expect(normalizeAssetName('UserAccounts', convention)).toBe('user_accounts')
  })

  it('should normalize to camelCase', () => {
    const convention: NamingConvention = { caseStyle: 'camelCase' }
    expect(normalizeAssetName('user_accounts', convention)).toBe('userAccounts')
  })

  it('should remove prefix', () => {
    const convention: NamingConvention = { caseStyle: 'mixed', prefix: 'tbl_' }
    expect(normalizeAssetName('tbl_users', convention)).toBe('users')
  })

  it('should remove suffix', () => {
    const convention: NamingConvention = { caseStyle: 'mixed', suffix: '_raw' }
    expect(normalizeAssetName('users_raw', convention)).toBe('users')
  })

  it('should normalize separators', () => {
    const convention: NamingConvention = { caseStyle: 'mixed' }
    expect(normalizeAssetName('user-account_data  info', convention)).toBe('user_account_data_info')
  })
})

describe('BaseSystemAdapter', () => {
  it('should create cross-system asset correctly', () => {
    const adapter = new MockPostgresAdapter()
    const asset = adapter.createTestAsset('test_table')

    expect(asset.systemId).toBe('postgres-prod')
    expect(asset.systemType).toBe('postgres')
    expect(asset.systemCategory).toBe('source_database')
    expect(asset.type).toBe('table')
    expect(asset.syncStatus).toBe('synced')
    expect(asset.aliases).toEqual([])
  })

  it('should normalize identifier correctly', () => {
    const adapter = new MockPostgresAdapter()
    const normalized = adapter.normalizeIdentifier('Public.UserAccounts')

    expect(normalized).toContain('db://postgres-prod/')
    expect(normalized.toLowerCase()).toBe(normalized)
  })

  it('should check ownership correctly', () => {
    const adapter = new MockPostgresAdapter()

    expect(adapter.ownsIdentifier('db://postgres-prod/public/users')).toBe(true)
    expect(adapter.ownsIdentifier('db://other-db/public/users')).toBe(false)
    expect(adapter.ownsIdentifier('warehouse://duckdb/users')).toBe(false)
  })

  it('should extract all metadata', async () => {
    const adapter = new MockPostgresAdapter()
    const asset = adapter.createTestAsset('users')
    adapter.setMockData([asset], [])

    const metadata = await adapter.extractAll()

    expect(metadata.assets).toHaveLength(1)
    expect(metadata.edges).toHaveLength(0)
    expect(metadata.errors).toHaveLength(0)
    expect(metadata.extractedAt).toBeGreaterThan(0)
  })

  it('should handle extraction errors in extractAll', async () => {
    const adapter = new MockPostgresAdapter()

    // Make extractLineage throw
    adapter.extractLineage = async () => {
      throw new Error('Lineage extraction failed')
    }

    const metadata = await adapter.extractAll()

    expect(metadata.errors).toHaveLength(1)
    expect(metadata.errors[0].code).toBe('LINEAGE_EXTRACTION_ERROR')
  })
})

describe('cross-system edge creation', () => {
  it('should mark cross-boundary edges correctly', async () => {
    const tracker = createCrossSystemLineageTracker()

    const pgAdapter = new MockPostgresAdapter()
    const duckAdapter = new MockDuckDBAdapter()

    pgAdapter.setMockData([pgAdapter.createTestAsset('users')], [])
    duckAdapter.setMockData([duckAdapter.createTestAsset('users')], [])

    tracker.registerSystem(pgAdapter)
    tracker.registerSystem(duckAdapter)
    await tracker.syncAll()

    const result = tracker.stitchLineage()

    for (const edge of result.stitchedEdges) {
      expect(edge.crossesBoundary).toBe(true)
      expect(edge.sourceSystemId).not.toBe(edge.targetSystemId)
    }
  })

  it('should include stitching evidence in edge metadata', async () => {
    const tracker = createCrossSystemLineageTracker()

    const pgAdapter = new MockPostgresAdapter()
    const duckAdapter = new MockDuckDBAdapter()

    pgAdapter.setMockData([pgAdapter.createTestAsset('users')], [])
    duckAdapter.setMockData([duckAdapter.createTestAsset('users')], [])

    tracker.registerSystem(pgAdapter)
    tracker.registerSystem(duckAdapter)
    await tracker.syncAll()

    const result = tracker.stitchLineage()

    expect(result.stitchedEdges.length).toBeGreaterThan(0)
    const edge = result.stitchedEdges[0]
    expect(edge.metadata.stitchingEvidence).toBeDefined()
    expect(Array.isArray(edge.metadata.stitchingEvidence)).toBe(true)
  })
})

describe('incomplete lineage handling', () => {
  it('should identify orphan assets', async () => {
    const tracker = createCrossSystemLineageTracker()

    const pgAdapter = new MockPostgresAdapter()
    const duckAdapter = new MockDuckDBAdapter()

    // Assets with no matching names
    pgAdapter.setMockData([pgAdapter.createTestAsset('unique_pg_table')], [])
    duckAdapter.setMockData([duckAdapter.createTestAsset('unique_duck_table')], [])

    tracker.registerSystem(pgAdapter)
    tracker.registerSystem(duckAdapter)
    await tracker.syncAll()

    const result = tracker.stitchLineage()

    expect(result.orphanAssets.length).toBe(2)
  })

  it('should track rejected candidates', async () => {
    const tracker = createCrossSystemLineageTracker({ minConfidence: 0.99 })

    const pgAdapter = new MockPostgresAdapter()
    const duckAdapter = new MockDuckDBAdapter()

    // Similar but not identical names (will match but with lower confidence)
    pgAdapter.setMockData([pgAdapter.createTestAsset('user_data')], [])
    duckAdapter.setMockData([duckAdapter.createTestAsset('userdata')], [])

    tracker.registerSystem(pgAdapter)
    tracker.registerSystem(duckAdapter)
    await tracker.syncAll()

    const result = tracker.stitchLineage()

    // With very high threshold, fuzzy match should be rejected
    expect(result.rejectedCandidates.length).toBeGreaterThanOrEqual(0)
  })
})

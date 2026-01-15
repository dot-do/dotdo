/**
 * Fanout/Distributed Queries Tests
 *
 * RED phase tests for distributed query execution across sharded DOs:
 * - QueryCoordinator - dispatches queries to scanners, aggregates results
 * - ScannerDO - executes queries on local data, returns partial results
 * - ConsistentHashRing - maps keys to nodes with minimal redistribution
 * - Parallel Execution - 128+ scanners with subrequest budget management
 * - Result Merging - union, intersect, sort, limit strategies
 * - Subrequest Budget - track and enforce Cloudflare limits
 *
 * @see README.md for architecture overview
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS (for test clarity - actual types will be in implementation)
// ============================================================================

interface QueryResult<T = unknown> {
  rows: T[]
  cursor?: string
  hasMore?: boolean
  scannerId?: string
  error?: string
}

interface ScannerResponse {
  result: QueryResult
  metadata: {
    rowCount: number
    executionTimeMs: number
    scannerId: string
  }
}

interface MergeStrategy {
  union<T>(results: QueryResult<T>[]): QueryResult<T>
  intersect<T>(results: QueryResult<T>[], key: keyof T): QueryResult<T>
  sort<T>(results: QueryResult<T>[], key: keyof T, direction?: 'asc' | 'desc'): QueryResult<T>
  limit<T>(results: QueryResult<T>, n: number): QueryResult<T>
}

interface SubrequestBudget {
  initial: number
  remaining: number
  used: number
  track(count: number): void
  canMake(count: number): boolean
  exhausted: boolean
}

interface HashRingNode {
  id: string
  virtualNodes: number[]
}

interface ConsistentHashRing {
  hash(key: string): number
  getNode(key: string): string
  addNode(nodeId: string, weight?: number): void
  removeNode(nodeId: string): void
  getNodes(): string[]
  rebalance(): Map<string, string[]>  // Returns keys that moved: oldNode -> [keys]
}

interface QueryCoordinator {
  query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  queryWithBudget<T>(sql: string, budget: SubrequestBudget): Promise<QueryResult<T>>
  getScannerCount(): number
  getHealthyScannersCount(): number
}

interface ScannerDO {
  execute<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  executeWithCursor<T>(sql: string, cursor?: string, limit?: number): Promise<QueryResult<T>>
  getLocalRowCount(): number
  isHealthy(): boolean
}

// ============================================================================
// 1. QUERY COORDINATOR TESTS
// ============================================================================

describe('QueryCoordinator', () => {
  describe('query dispatch', () => {
    it('should dispatch query to all configured scanners', async () => {
      // Import the QueryCoordinator class (will fail until implemented)
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = Array.from({ length: 4 }, (_, i) => ({
        id: `scanner-${i}`,
        execute: vi.fn().mockResolvedValue({ rows: [{ id: i }] }),
      }))

      const coordinator = new QueryCoordinator(mockScanners)
      await coordinator.query('SELECT * FROM users')

      // All scanners should receive the query
      for (const scanner of mockScanners) {
        expect(scanner.execute).toHaveBeenCalledWith('SELECT * FROM users')
      }
    })

    it('should dispatch query to scanners in parallel', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const executionOrder: number[] = []
      const mockScanners = Array.from({ length: 4 }, (_, i) => ({
        id: `scanner-${i}`,
        execute: vi.fn().mockImplementation(async () => {
          executionOrder.push(i)
          await new Promise((r) => setTimeout(r, 10))
          return { rows: [] }
        }),
      }))

      const coordinator = new QueryCoordinator(mockScanners)
      const start = performance.now()
      await coordinator.query('SELECT * FROM users')
      const duration = performance.now() - start

      // If parallel, should complete in ~10ms, not 4*10ms=40ms
      expect(duration).toBeLessThan(30)
      // All scanners should have started before any completed
      expect(executionOrder.length).toBe(4)
    })

    it('should pass parameters to scanners', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanner = {
        id: 'scanner-0',
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }

      const coordinator = new QueryCoordinator([mockScanner])
      await coordinator.query('SELECT * FROM users WHERE tenant_id = ?', ['tenant-123'])

      expect(mockScanner.execute).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE tenant_id = ?',
        ['tenant-123']
      )
    })
  })

  describe('result aggregation', () => {
    it('should aggregate results from all scanners', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = [
        { id: 'scanner-0', execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] }) },
        { id: 'scanner-1', execute: vi.fn().mockResolvedValue({ rows: [{ id: 3 }, { id: 4 }] }) },
        { id: 'scanner-2', execute: vi.fn().mockResolvedValue({ rows: [{ id: 5 }] }) },
      ]

      const coordinator = new QueryCoordinator(mockScanners)
      const result = await coordinator.query('SELECT * FROM users')

      expect(result.rows).toHaveLength(5)
      expect(result.rows.map((r: any) => r.id)).toEqual([1, 2, 3, 4, 5])
    })

    it('should aggregate COUNT(*) results correctly', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = [
        { id: 'scanner-0', execute: vi.fn().mockResolvedValue({ rows: [{ count: 100 }] }) },
        { id: 'scanner-1', execute: vi.fn().mockResolvedValue({ rows: [{ count: 250 }] }) },
        { id: 'scanner-2', execute: vi.fn().mockResolvedValue({ rows: [{ count: 150 }] }) },
      ]

      const coordinator = new QueryCoordinator(mockScanners)
      const result = await coordinator.query('SELECT COUNT(*) as count FROM users')

      // COUNT should be summed across all scanners
      expect(result.rows).toHaveLength(1)
      expect((result.rows[0] as any).count).toBe(500)
    })

    it('should aggregate SUM results correctly', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = [
        { id: 'scanner-0', execute: vi.fn().mockResolvedValue({ rows: [{ total: 1000 }] }) },
        { id: 'scanner-1', execute: vi.fn().mockResolvedValue({ rows: [{ total: 2500 }] }) },
      ]

      const coordinator = new QueryCoordinator(mockScanners)
      const result = await coordinator.query('SELECT SUM(amount) as total FROM orders')

      expect((result.rows[0] as any).total).toBe(3500)
    })

    it('should handle AVG aggregation with weighted average', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      // Scanner 0: avg=10, count=100 (sum=1000)
      // Scanner 1: avg=20, count=200 (sum=4000)
      // Global avg = 5000 / 300 = 16.67
      const mockScanners = [
        { id: 'scanner-0', execute: vi.fn().mockResolvedValue({ rows: [{ avg: 10, _count: 100 }] }) },
        { id: 'scanner-1', execute: vi.fn().mockResolvedValue({ rows: [{ avg: 20, _count: 200 }] }) },
      ]

      const coordinator = new QueryCoordinator(mockScanners)
      const result = await coordinator.query('SELECT AVG(amount) as avg FROM orders')

      expect((result.rows[0] as any).avg).toBeCloseTo(16.67, 1)
    })
  })

  describe('scanner failure handling', () => {
    it('should handle single scanner failure gracefully', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = [
        { id: 'scanner-0', execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) },
        { id: 'scanner-1', execute: vi.fn().mockRejectedValue(new Error('Scanner unavailable')) },
        { id: 'scanner-2', execute: vi.fn().mockResolvedValue({ rows: [{ id: 2 }] }) },
      ]

      const coordinator = new QueryCoordinator(mockScanners)
      const result = await coordinator.query('SELECT * FROM users')

      // Should return partial results from healthy scanners
      expect(result.rows).toHaveLength(2)
      // Should include error marker
      expect(result.error).toContain('scanner-1')
    })

    it('should fail if majority of scanners fail', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = [
        { id: 'scanner-0', execute: vi.fn().mockRejectedValue(new Error('Failed')) },
        { id: 'scanner-1', execute: vi.fn().mockRejectedValue(new Error('Failed')) },
        { id: 'scanner-2', execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) },
      ]

      const coordinator = new QueryCoordinator(mockScanners)

      await expect(coordinator.query('SELECT * FROM users')).rejects.toThrow(
        /majority.*failed|insufficient.*scanners/i
      )
    })

    it('should track healthy vs unhealthy scanners', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = [
        { id: 'scanner-0', execute: vi.fn().mockResolvedValue({ rows: [] }), isHealthy: () => true },
        { id: 'scanner-1', execute: vi.fn().mockRejectedValue(new Error('Failed')), isHealthy: () => false },
        { id: 'scanner-2', execute: vi.fn().mockResolvedValue({ rows: [] }), isHealthy: () => true },
        { id: 'scanner-3', execute: vi.fn().mockRejectedValue(new Error('Failed')), isHealthy: () => false },
      ]

      const coordinator = new QueryCoordinator(mockScanners)
      await coordinator.query('SELECT 1')

      expect(coordinator.getScannerCount()).toBe(4)
      expect(coordinator.getHealthyScannersCount()).toBe(2)
    })

    it('should retry failed scanners with exponential backoff', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      let attempts = 0
      const mockScanner = {
        id: 'scanner-0',
        execute: vi.fn().mockImplementation(async () => {
          attempts++
          if (attempts < 3) throw new Error('Temporary failure')
          return { rows: [{ id: 1 }] }
        }),
      }

      const coordinator = new QueryCoordinator([mockScanner], { maxRetries: 3 })
      const result = await coordinator.query('SELECT * FROM users')

      expect(attempts).toBe(3)
      expect(result.rows).toHaveLength(1)
    })

    it('should timeout slow scanners', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = [
        {
          id: 'scanner-0',
          execute: vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 5000)) // Very slow
            return { rows: [{ id: 1 }] }
          }),
        },
        { id: 'scanner-1', execute: vi.fn().mockResolvedValue({ rows: [{ id: 2 }] }) },
      ]

      const coordinator = new QueryCoordinator(mockScanners, { timeoutMs: 100 })
      const result = await coordinator.query('SELECT * FROM users')

      // Should return results from scanner-1, timeout scanner-0
      expect(result.rows).toHaveLength(1)
      expect((result.rows[0] as any).id).toBe(2)
    })
  })
})

// ============================================================================
// 2. SCANNER DO TESTS
// ============================================================================

describe('ScannerDO', () => {
  describe('local query execution', () => {
    it('should execute query on local data', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO()
      // Seed with test data
      await scanner.seed([
        { id: 1, name: 'Alice', tenant_id: 'tenant-1' },
        { id: 2, name: 'Bob', tenant_id: 'tenant-1' },
        { id: 3, name: 'Charlie', tenant_id: 'tenant-2' },
      ])

      const result = await scanner.execute("SELECT * FROM users WHERE tenant_id = 'tenant-1'")

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r: any) => r.name)).toEqual(['Alice', 'Bob'])
    })

    it('should return scanner ID in response metadata', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO({ id: 'scanner-42' })
      const result = await scanner.execute('SELECT * FROM users')

      expect(result.scannerId).toBe('scanner-42')
    })

    it('should support parameterized queries', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO()
      await scanner.seed([
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'inactive' },
      ])

      const result = await scanner.execute('SELECT * FROM users WHERE status = ?', ['active'])

      expect(result.rows).toHaveLength(1)
      expect((result.rows[0] as any).name).toBe('Alice')
    })
  })

  describe('pagination and cursors', () => {
    it('should return partial results with cursor', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO()
      await scanner.seed(
        Array.from({ length: 100 }, (_, i) => ({ id: i, name: `User ${i}` }))
      )

      const result = await scanner.executeWithCursor('SELECT * FROM users', undefined, 10)

      expect(result.rows).toHaveLength(10)
      expect(result.hasMore).toBe(true)
      expect(result.cursor).toBeDefined()
    })

    it('should continue from cursor', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO()
      await scanner.seed(
        Array.from({ length: 25 }, (_, i) => ({ id: i, name: `User ${i}` }))
      )

      // First page
      const page1 = await scanner.executeWithCursor('SELECT * FROM users ORDER BY id', undefined, 10)
      expect(page1.rows).toHaveLength(10)
      expect((page1.rows[0] as any).id).toBe(0)
      expect(page1.cursor).toBeDefined()

      // Second page
      const page2 = await scanner.executeWithCursor('SELECT * FROM users ORDER BY id', page1.cursor, 10)
      expect(page2.rows).toHaveLength(10)
      expect((page2.rows[0] as any).id).toBe(10)
      expect(page2.cursor).toBeDefined()

      // Third page (partial)
      const page3 = await scanner.executeWithCursor('SELECT * FROM users ORDER BY id', page2.cursor, 10)
      expect(page3.rows).toHaveLength(5)
      expect((page3.rows[0] as any).id).toBe(20)
      expect(page3.hasMore).toBe(false)
    })

    it('should handle cursor expiration', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO({ cursorTtlMs: 100 })
      await scanner.seed([{ id: 1 }, { id: 2 }])

      const result = await scanner.executeWithCursor('SELECT * FROM users', undefined, 1)

      // Wait for cursor to expire
      await new Promise((r) => setTimeout(r, 150))

      await expect(
        scanner.executeWithCursor('SELECT * FROM users', result.cursor, 1)
      ).rejects.toThrow(/cursor.*expired/i)
    })
  })

  describe('local row count', () => {
    it('should report local row count', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO()
      await scanner.seed(
        Array.from({ length: 42 }, (_, i) => ({ id: i }))
      )

      expect(scanner.getLocalRowCount()).toBe(42)
    })
  })

  describe('health checks', () => {
    it('should report healthy status', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO()
      expect(scanner.isHealthy()).toBe(true)
    })

    it('should report unhealthy when storage is corrupted', async () => {
      const { ScannerDO } = await import('./scanner')

      const scanner = new ScannerDO()
      await scanner.corruptStorage() // Test helper

      expect(scanner.isHealthy()).toBe(false)
    })
  })
})

// ============================================================================
// 3. CONSISTENT HASH RING TESTS
// ============================================================================

describe('ConsistentHashRing', () => {
  describe('hash function', () => {
    it('should return consistent hash for same key', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1', 'node-2'])

      const hash1 = ring.hash('user-123')
      const hash2 = ring.hash('user-123')

      expect(hash1).toBe(hash2)
    })

    it('should distribute keys across full hash space', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0'])
      const hashes = new Set<number>()

      for (let i = 0; i < 1000; i++) {
        hashes.add(ring.hash(`key-${i}`))
      }

      // Should have diverse hash values (at least 500 unique out of 1000)
      expect(hashes.size).toBeGreaterThan(500)
    })
  })

  describe('virtual nodes', () => {
    it('should create virtual nodes for even distribution', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1'], { virtualNodesPerNode: 100 })

      // Count key distribution
      const distribution = new Map<string, number>()
      for (let i = 0; i < 10000; i++) {
        const node = ring.getNode(`key-${i}`)
        distribution.set(node, (distribution.get(node) || 0) + 1)
      }

      // Each node should get roughly 50% (between 40-60%)
      for (const [node, count] of distribution) {
        expect(count).toBeGreaterThan(4000)
        expect(count).toBeLessThan(6000)
      }
    })

    it('should default to 150 virtual nodes per physical node', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0'])

      // Implementation detail test - ring should have 150 virtual nodes
      expect(ring.getVirtualNodeCount()).toBe(150)
    })
  })

  describe('getNode', () => {
    it('should return node for key', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1', 'node-2'])

      const node = ring.getNode('user-123')

      expect(['node-0', 'node-1', 'node-2']).toContain(node)
    })

    it('should return same node for same key', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1', 'node-2'])

      const node1 = ring.getNode('user-123')
      const node2 = ring.getNode('user-123')

      expect(node1).toBe(node2)
    })

    it('should distribute different keys across nodes', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1', 'node-2', 'node-3'])
      const nodes = new Set<string>()

      for (let i = 0; i < 100; i++) {
        nodes.add(ring.getNode(`key-${i}`))
      }

      // Should use at least 3 of 4 nodes for 100 random keys
      expect(nodes.size).toBeGreaterThanOrEqual(3)
    })
  })

  describe('addNode', () => {
    it('should add node to ring', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1'])
      ring.addNode('node-2')

      expect(ring.getNodes()).toContain('node-2')
      expect(ring.getNodes()).toHaveLength(3)
    })

    it('should minimize key redistribution when adding node', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1', 'node-2', 'node-3'])

      // Record initial assignments
      const initialAssignments = new Map<string, string>()
      for (let i = 0; i < 1000; i++) {
        const key = `key-${i}`
        initialAssignments.set(key, ring.getNode(key))
      }

      // Add new node
      ring.addNode('node-4')

      // Count how many keys moved
      let moved = 0
      for (const [key, oldNode] of initialAssignments) {
        if (ring.getNode(key) !== oldNode) {
          moved++
        }
      }

      // With consistent hashing, only ~1/N keys should move (1/5 = 20%)
      // Allow some variance: should be less than 30%
      expect(moved).toBeLessThan(300)
    })

    it('should support weighted nodes', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing([])
      ring.addNode('node-small', 1)  // 1x weight
      ring.addNode('node-large', 4)  // 4x weight

      // Count distribution
      const distribution = new Map<string, number>()
      for (let i = 0; i < 5000; i++) {
        const node = ring.getNode(`key-${i}`)
        distribution.set(node, (distribution.get(node) || 0) + 1)
      }

      // node-large should get ~4x more keys than node-small
      const smallCount = distribution.get('node-small') || 0
      const largeCount = distribution.get('node-large') || 0

      expect(largeCount / smallCount).toBeGreaterThan(3)
      expect(largeCount / smallCount).toBeLessThan(5)
    })
  })

  describe('removeNode', () => {
    it('should remove node from ring', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1', 'node-2'])
      ring.removeNode('node-1')

      expect(ring.getNodes()).not.toContain('node-1')
      expect(ring.getNodes()).toHaveLength(2)
    })

    it('should redistribute removed node keys to remaining nodes', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1', 'node-2'])

      // Find keys assigned to node-1
      const node1Keys: string[] = []
      for (let i = 0; i < 1000; i++) {
        const key = `key-${i}`
        if (ring.getNode(key) === 'node-1') {
          node1Keys.push(key)
        }
      }

      ring.removeNode('node-1')

      // All keys that were on node-1 should now be on node-0 or node-2
      for (const key of node1Keys) {
        const newNode = ring.getNode(key)
        expect(['node-0', 'node-2']).toContain(newNode)
      }
    })

    it('should throw when removing last node', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0'])

      expect(() => ring.removeNode('node-0')).toThrow(/cannot remove.*last.*node/i)
    })

    it('should throw when removing non-existent node', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1'])

      expect(() => ring.removeNode('node-99')).toThrow(/node.*not found/i)
    })
  })

  describe('rebalance', () => {
    it('should return map of keys that moved', async () => {
      const { ConsistentHashRing } = await import('./hash-ring')

      const ring = new ConsistentHashRing(['node-0', 'node-1'])

      // Track keys before
      const keysBefore = new Map<string, string>()
      for (let i = 0; i < 100; i++) {
        keysBefore.set(`key-${i}`, ring.getNode(`key-${i}`))
      }

      ring.addNode('node-2')
      const moved = ring.rebalance()

      // Should return which keys need to move
      expect(moved).toBeInstanceOf(Map)

      // Verify moved keys actually changed nodes
      for (const [oldNode, keys] of moved) {
        for (const key of keys) {
          expect(keysBefore.get(key)).toBe(oldNode)
          expect(ring.getNode(key)).not.toBe(oldNode)
        }
      }
    })
  })
})

// ============================================================================
// 4. PARALLEL EXECUTION TESTS
// ============================================================================

describe('Parallel Execution', () => {
  describe('128+ scanner coordination', () => {
    it('should query 128 scanners in parallel', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = Array.from({ length: 128 }, (_, i) => ({
        id: `scanner-${i}`,
        execute: vi.fn().mockResolvedValue({ rows: [{ scanner: i }] }),
      }))

      const coordinator = new QueryCoordinator(mockScanners)
      const start = performance.now()
      const result = await coordinator.query('SELECT * FROM users')
      const duration = performance.now() - start

      // All scanners should be queried
      expect(result.rows).toHaveLength(128)

      // Should complete in parallel, not sequentially
      // 128 sequential 10ms calls = 1280ms
      // 128 parallel 10ms calls = ~10ms (plus overhead)
      // Allow up to 500ms for test environment variance
      expect(duration).toBeLessThan(500)
    })

    it('should handle 256 scanners', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = Array.from({ length: 256 }, (_, i) => ({
        id: `scanner-${i}`,
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }))

      const coordinator = new QueryCoordinator(mockScanners)
      const result = await coordinator.query('SELECT COUNT(*) FROM users')

      // Should successfully query all 256 scanners
      expect(mockScanners.every((s) => s.execute.mock.calls.length > 0)).toBe(true)
    })
  })

  describe('subrequest budget respect', () => {
    it('should batch scanner calls to respect 50 subrequest limit (Workers)', async () => {
      const { QueryCoordinator } = await import('./coordinator')
      const { SubrequestBudget } = await import('./budget')

      const mockScanners = Array.from({ length: 128 }, (_, i) => ({
        id: `scanner-${i}`,
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }))

      const coordinator = new QueryCoordinator(mockScanners)
      const budget = new SubrequestBudget(50) // Workers limit

      const result = await coordinator.queryWithBudget('SELECT * FROM users', budget)

      // Should batch into ceil(128/50) = 3 rounds
      // Each round uses up to 50 subrequests
      expect(budget.used).toBeLessThanOrEqual(50 * 3)
    })

    it('should batch scanner calls to respect 1000 subrequest limit (Durable Objects)', async () => {
      const { QueryCoordinator } = await import('./coordinator')
      const { SubrequestBudget } = await import('./budget')

      const mockScanners = Array.from({ length: 128 }, (_, i) => ({
        id: `scanner-${i}`,
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }))

      const coordinator = new QueryCoordinator(mockScanners)
      const budget = new SubrequestBudget(1000) // DO limit

      await coordinator.queryWithBudget('SELECT * FROM users', budget)

      // With 1000 budget, should complete in single round
      expect(budget.used).toBeLessThanOrEqual(128)
    })

    it('should error when budget is exhausted', async () => {
      const { QueryCoordinator } = await import('./coordinator')
      const { SubrequestBudget } = await import('./budget')

      const mockScanners = Array.from({ length: 128 }, (_, i) => ({
        id: `scanner-${i}`,
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      }))

      const coordinator = new QueryCoordinator(mockScanners)
      const budget = new SubrequestBudget(10) // Very limited

      await expect(
        coordinator.queryWithBudget('SELECT * FROM users', budget)
      ).rejects.toThrow(/budget.*exhausted|subrequest.*limit/i)
    })
  })

  describe('progressive result streaming', () => {
    it('should stream results as batches complete', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const mockScanners = [
        {
          id: 'scanner-fast',
          execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
        },
        {
          id: 'scanner-slow',
          execute: vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 100))
            return { rows: [{ id: 2 }] }
          }),
        },
      ]

      const coordinator = new QueryCoordinator(mockScanners)
      const results: unknown[] = []

      // Use streaming API
      for await (const batch of coordinator.queryStream('SELECT * FROM users')) {
        results.push(...batch.rows)
      }

      expect(results).toHaveLength(2)
    })

    it('should yield results in arrival order when streaming', async () => {
      const { QueryCoordinator } = await import('./coordinator')

      const arrivalOrder: string[] = []
      const mockScanners = [
        {
          id: 'scanner-slow',
          execute: vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 50))
            arrivalOrder.push('slow')
            return { rows: [{ source: 'slow' }] }
          }),
        },
        {
          id: 'scanner-fast',
          execute: vi.fn().mockImplementation(async () => {
            arrivalOrder.push('fast')
            return { rows: [{ source: 'fast' }] }
          }),
        },
      ]

      const coordinator = new QueryCoordinator(mockScanners)
      const results: unknown[] = []

      for await (const batch of coordinator.queryStream('SELECT * FROM users')) {
        results.push((batch.rows[0] as any).source)
      }

      // Fast should arrive before slow
      expect(arrivalOrder).toEqual(['fast', 'slow'])
      expect(results).toEqual(['fast', 'slow'])
    })
  })
})

// ============================================================================
// 5. RESULT MERGING TESTS
// ============================================================================

describe('Result Merging', () => {
  describe('merge.union', () => {
    it('should combine all results', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 1 }, { id: 2 }] },
        { rows: [{ id: 3 }, { id: 4 }] },
        { rows: [{ id: 5 }] },
      ]

      const merged = merge.union(results)

      expect(merged.rows).toHaveLength(5)
      expect(merged.rows.map((r: any) => r.id)).toEqual([1, 2, 3, 4, 5])
    })

    it('should preserve order from sources', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 'a' }, { id: 'b' }] },
        { rows: [{ id: 'c' }] },
        { rows: [{ id: 'd' }, { id: 'e' }] },
      ]

      const merged = merge.union(results)

      expect(merged.rows.map((r: any) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('should handle empty results', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [] },
        { rows: [{ id: 1 }] },
        { rows: [] },
      ]

      const merged = merge.union(results)

      expect(merged.rows).toHaveLength(1)
    })

    it('should deduplicate by key when specified', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] },
        { rows: [{ id: 2, name: 'Bob Updated' }, { id: 3, name: 'Charlie' }] },
      ]

      const merged = merge.union(results, { dedupeKey: 'id' })

      expect(merged.rows).toHaveLength(3)
      // First occurrence wins
      expect((merged.rows[1] as any).name).toBe('Bob')
    })
  })

  describe('merge.intersect', () => {
    it('should return only common rows by key', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        { rows: [{ id: 2 }, { id: 3 }, { id: 4 }] },
        { rows: [{ id: 3 }, { id: 4 }, { id: 5 }] },
      ]

      const merged = merge.intersect(results, 'id')

      // Only id: 3 is in all three
      expect(merged.rows).toHaveLength(1)
      expect((merged.rows[0] as any).id).toBe(3)
    })

    it('should return empty when no common rows', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 1 }, { id: 2 }] },
        { rows: [{ id: 3 }, { id: 4 }] },
      ]

      const merged = merge.intersect(results, 'id')

      expect(merged.rows).toHaveLength(0)
    })

    it('should work with two result sets', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] },
        { rows: [{ id: 2 }, { id: 3 }] },
      ]

      const merged = merge.intersect(results, 'id')

      expect(merged.rows).toHaveLength(2)
      expect(merged.rows.map((r: any) => r.id)).toEqual([2, 3])
    })
  })

  describe('merge.sort', () => {
    it('should sort combined results by key ascending', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 3 }, { id: 1 }] },
        { rows: [{ id: 4 }, { id: 2 }] },
      ]

      const merged = merge.sort(results, 'id', 'asc')

      expect(merged.rows.map((r: any) => r.id)).toEqual([1, 2, 3, 4])
    })

    it('should sort combined results by key descending', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 1 }, { id: 3 }] },
        { rows: [{ id: 2 }, { id: 4 }] },
      ]

      const merged = merge.sort(results, 'id', 'desc')

      expect(merged.rows.map((r: any) => r.id)).toEqual([4, 3, 2, 1])
    })

    it('should sort strings alphabetically', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ name: 'Charlie' }, { name: 'Alice' }] },
        { rows: [{ name: 'Bob' }] },
      ]

      const merged = merge.sort(results, 'name', 'asc')

      expect(merged.rows.map((r: any) => r.name)).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('should handle dates correctly', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ created: '2024-01-15' }, { created: '2024-01-01' }] },
        { rows: [{ created: '2024-01-10' }] },
      ]

      const merged = merge.sort(results, 'created', 'asc')

      expect(merged.rows.map((r: any) => r.created)).toEqual([
        '2024-01-01',
        '2024-01-10',
        '2024-01-15',
      ])
    })

    it('should handle null values (nulls last)', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 1 }, { id: null }] },
        { rows: [{ id: 2 }] },
      ]

      const merged = merge.sort(results, 'id', 'asc')

      expect(merged.rows.map((r: any) => r.id)).toEqual([1, 2, null])
    })
  })

  describe('merge.limit', () => {
    it('should return top N results', async () => {
      const { merge } = await import('./merge')

      const result: QueryResult = {
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      }

      const limited = merge.limit(result, 3)

      expect(limited.rows).toHaveLength(3)
      expect(limited.rows.map((r: any) => r.id)).toEqual([1, 2, 3])
    })

    it('should return all if limit exceeds count', async () => {
      const { merge } = await import('./merge')

      const result: QueryResult = {
        rows: [{ id: 1 }, { id: 2 }],
      }

      const limited = merge.limit(result, 10)

      expect(limited.rows).toHaveLength(2)
    })

    it('should return empty for limit 0', async () => {
      const { merge } = await import('./merge')

      const result: QueryResult = {
        rows: [{ id: 1 }, { id: 2 }],
      }

      const limited = merge.limit(result, 0)

      expect(limited.rows).toHaveLength(0)
    })

    it('should preserve hasMore flag correctly', async () => {
      const { merge } = await import('./merge')

      const result: QueryResult = {
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        hasMore: false,
      }

      const limited = merge.limit(result, 3)

      // After limiting, there are more results available
      expect(limited.hasMore).toBe(true)
    })
  })

  describe('combined operations', () => {
    it('should union then sort then limit (ORDER BY LIMIT pattern)', async () => {
      const { merge } = await import('./merge')

      const results: QueryResult[] = [
        { rows: [{ id: 5 }, { id: 3 }, { id: 1 }] },
        { rows: [{ id: 4 }, { id: 2 }] },
      ]

      // Union all, sort by id, take top 3
      const unioned = merge.union(results)
      const sorted = merge.sort([unioned], 'id', 'asc')
      const limited = merge.limit(sorted, 3)

      expect(limited.rows.map((r: any) => r.id)).toEqual([1, 2, 3])
    })
  })
})

// ============================================================================
// 6. SUBREQUEST BUDGET TESTS
// ============================================================================

describe('SubrequestBudget', () => {
  describe('initialization', () => {
    it('should initialize with given budget', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)

      expect(budget.initial).toBe(50)
      expect(budget.remaining).toBe(50)
      expect(budget.used).toBe(0)
    })

    it('should default to Workers limit (50)', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget()

      expect(budget.initial).toBe(50)
    })
  })

  describe('tracking', () => {
    it('should track subrequest usage', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(10)

      expect(budget.used).toBe(10)
      expect(budget.remaining).toBe(40)
    })

    it('should accumulate multiple tracks', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(10)
      budget.track(15)
      budget.track(5)

      expect(budget.used).toBe(30)
      expect(budget.remaining).toBe(20)
    })

    it('should throw when exceeding budget', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(40)

      expect(() => budget.track(20)).toThrow(/budget.*exceeded|insufficient.*budget/i)
    })
  })

  describe('canMake', () => {
    it('should return true when budget allows', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(30)

      expect(budget.canMake(20)).toBe(true)
      expect(budget.canMake(19)).toBe(true)
    })

    it('should return false when budget insufficient', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(40)

      expect(budget.canMake(11)).toBe(false)
      expect(budget.canMake(15)).toBe(false)
    })

    it('should return true for exact remaining', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(30)

      expect(budget.canMake(20)).toBe(true)
    })
  })

  describe('exhausted', () => {
    it('should return false when budget remaining', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(49)

      expect(budget.exhausted).toBe(false)
    })

    it('should return true when budget fully used', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(50)

      expect(budget.exhausted).toBe(true)
    })

    it('should return true when remaining is 0', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(10)
      budget.track(5)
      budget.track(5)

      expect(budget.exhausted).toBe(true)
      expect(budget.remaining).toBe(0)
    })
  })

  describe('batch size calculation', () => {
    it('should suggest optimal batch size', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)

      // For 128 scanners with 50 budget, optimal batch = 50
      expect(budget.optimalBatchSize(128)).toBe(50)
    })

    it('should return full count when budget allows', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(1000)

      // For 128 scanners with 1000 budget, can do all at once
      expect(budget.optimalBatchSize(128)).toBe(128)
    })

    it('should account for already used budget', async () => {
      const { SubrequestBudget } = await import('./budget')

      const budget = new SubrequestBudget(50)
      budget.track(30)

      // With 20 remaining, batch size should be 20
      expect(budget.optimalBatchSize(100)).toBe(20)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Fanout Integration', () => {
  it('should execute distributed query end-to-end', async () => {
    const { QueryCoordinator } = await import('./coordinator')
    const { ScannerDO } = await import('./scanner')
    const { ConsistentHashRing } = await import('./hash-ring')

    // Setup: 4 scanners, each with some data
    const scanners = Array.from({ length: 4 }, (_, i) => {
      const scanner = new ScannerDO({ id: `scanner-${i}` })
      // Each scanner has 25 users
      scanner.seed(
        Array.from({ length: 25 }, (_, j) => ({
          id: i * 25 + j,
          name: `User ${i * 25 + j}`,
          tenant_id: `tenant-${i % 2}`, // Two tenants
        }))
      )
      return scanner
    })

    const ring = new ConsistentHashRing(scanners.map((s) => s.id))
    const coordinator = new QueryCoordinator(scanners)

    // Query all users
    const result = await coordinator.query('SELECT * FROM users')

    expect(result.rows).toHaveLength(100)
  })

  it('should route single-tenant queries to specific scanner', async () => {
    const { QueryCoordinator } = await import('./coordinator')
    const { ScannerDO } = await import('./scanner')
    const { ConsistentHashRing } = await import('./hash-ring')

    const scanners = Array.from({ length: 4 }, (_, i) => {
      const scanner = new ScannerDO({ id: `scanner-${i}` })
      return scanner
    })

    const ring = new ConsistentHashRing(scanners.map((s) => s.id))
    const coordinator = new QueryCoordinator(scanners, { ring })

    // Single-tenant query should only hit one scanner
    const targetScanner = ring.getNode('tenant-123')
    const result = await coordinator.query(
      "SELECT * FROM users WHERE tenant_id = 'tenant-123'",
      [],
      { shardKey: 'tenant_id' }
    )

    // Only the target scanner should be queried
    const queriedScanners = scanners.filter((s) =>
      (s as any).lastQuery !== undefined
    )
    expect(queriedScanners).toHaveLength(1)
  })
})

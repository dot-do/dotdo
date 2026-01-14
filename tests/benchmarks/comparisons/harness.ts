/**
 * Cross-Store Comparison Harness
 *
 * GREEN PHASE: Shared comparison harness with mock stores for benchmarks.
 * Provides mock implementations for DocumentStore, RelationalStore,
 * ColumnarStore, VectorStore, and TieredDocumentStore.
 *
 * @see do-p7v - GREEN: Cross-Store Comparison Implementation
 */

import { createMockStore } from '../stores/harness'
import { CostTracker } from '../framework/cost-tracker'

// ============================================================================
// Document Store Mocks
// ============================================================================

/**
 * Create a mock document store for comparison benchmarks.
 * Supports CRUD, query, batch operations, and count.
 */
export function createComparisonDocumentStore() {
  const storage = new Map<string, any>()
  let idCounter = 0

  return createMockStore({
    create: async (doc: any) => {
      const id = doc.$id || `doc_${++idCounter}`
      const record = { ...doc, $id: id, $createdAt: new Date().toISOString() }
      storage.set(id, record)
      return record
    },
    get: async (id: string) => storage.get(id) || null,
    update: async (id: string, data: any) => {
      const existing = storage.get(id)
      if (!existing) return null
      const updated = { ...existing, ...data, $updatedAt: new Date().toISOString() }
      storage.set(id, updated)
      return updated
    },
    delete: async (id: string) => {
      const existed = storage.has(id)
      storage.delete(id)
      return existed
    },
    createMany: async (docs: any[]) => {
      return docs.map(doc => {
        const id = doc.$id || `doc_${++idCounter}`
        const record = { ...doc, $id: id, $createdAt: new Date().toISOString() }
        storage.set(id, record)
        return record
      })
    },
    query: async (opts?: any) => {
      const items = Array.from(storage.values())
      // Filter by where clause if provided
      let filtered = items
      if (opts?.where) {
        filtered = items.filter(item => {
          for (const [key, val] of Object.entries(opts.where)) {
            // Handle nested paths like 'metadata.type'
            const value = key.split('.').reduce((obj, k) => obj?.[k], item)
            if (value !== val) return false
          }
          return true
        })
      }
      return filtered.slice(0, opts?.limit || 100)
    },
    count: async (opts?: any) => {
      if (!opts?.where) return storage.size
      const items = Array.from(storage.values())
      return items.filter(item => {
        for (const [key, val] of Object.entries(opts.where)) {
          const value = key.split('.').reduce((obj: any, k) => obj?.[k], item)
          if (value !== val) return false
        }
        return true
      }).length
    },
    list: async (opts?: { limit?: number }) => {
      const items = Array.from(storage.values()).slice(0, opts?.limit || 100)
      return { items, cursor: null }
    },
  })
}

// ============================================================================
// Relational Store Mocks
// ============================================================================

/**
 * Create a mock relational store for comparison benchmarks.
 * Supports insert, find, query (SQL-like), and batch operations.
 */
export function createComparisonRelationalStore() {
  const tables = new Map<string, Map<string, any>>()

  const getTable = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map())
    return tables.get(name)!
  }

  return createMockStore({
    insert: async (table: string, data: any) => {
      const t = getTable(table)
      const id = data.id || `row_${t.size + 1}`
      const record = { ...data, id }
      t.set(id, record)
      return record
    },
    insertMany: async (table: string, rows: any[]) => {
      const t = getTable(table)
      return rows.map(data => {
        const id = data.id || `row_${t.size + 1}`
        const record = { ...data, id }
        t.set(id, record)
        return record
      })
    },
    findById: async (table: string, id: string) => {
      return getTable(table).get(id) || null
    },
    find: async (table: string, where: Record<string, unknown>) => {
      const t = getTable(table)
      return Array.from(t.values()).filter(row => {
        for (const [key, val] of Object.entries(where)) {
          if (row[key] !== val) return false
        }
        return true
      })
    },
    query: async (sql: string) => {
      // Simple mock - just return some results
      // In reality this would parse SQL
      return [{ id: '1', name: 'Alice', type: 'premium' }]
    },
    update: async (table: string, id: string, data: any) => {
      const t = getTable(table)
      const existing = t.get(id)
      if (!existing) return null
      const updated = { ...existing, ...data }
      t.set(id, updated)
      return updated
    },
    delete: async (table: string, id: string) => {
      return getTable(table).delete(id)
    },
  })
}

// ============================================================================
// Columnar Store Mocks
// ============================================================================

/**
 * Create a mock columnar store for cost comparison benchmarks.
 * Tracks writes to demonstrate O(1) vs O(N) cost difference.
 */
export function createComparisonColumnarStore(tracker: CostTracker) {
  const columns = new Map<string, any[]>()

  return createMockStore({
    insertBatch: async (records: any[]) => {
      // Columnar batches into ~6 column writes regardless of record count
      // This is the key insight: O(1) writes vs O(N) for document stores
      const columnCount = 6 // ids, types, data, timestamps, etc.
      tracker.trackWrite(columnCount)

      // Store the records (for completeness)
      for (const record of records) {
        const type = record.type || 'default'
        if (!columns.has(type)) columns.set(type, [])
        columns.get(type)!.push(record)
      }

      return records
    },
    aggregate: async (column: string, op: string) => {
      // Mock aggregation result
      return { result: 1000 }
    },
    query: async (opts: any) => {
      const type = opts?.type || 'default'
      return columns.get(type)?.slice(0, opts?.limit || 100) || []
    },
    count: async (opts?: any) => {
      let total = 0
      for (const records of columns.values()) total += records.length
      return total
    },
  })
}

/**
 * Create a mock document store with cost tracking for comparison.
 * Each create is 1 write, batch creates are N writes.
 */
export function createComparisonDocumentStoreWithCost(tracker: CostTracker) {
  const storage = new Map<string, any>()
  let idCounter = 0

  return createMockStore({
    create: async (doc: any) => {
      tracker.trackWrite(1) // 1 write per document
      const id = doc.$id || `doc_${++idCounter}`
      const record = { ...doc, $id: id }
      storage.set(id, record)
      return record
    },
    createBatch: async (docs: any[]) => {
      tracker.trackWrite(docs.length) // N writes for N docs
      return docs.map(doc => {
        const id = doc.$id || `doc_${++idCounter}`
        const record = { ...doc, $id: id }
        storage.set(id, record)
        return record
      })
    },
    createMany: async (docs: any[]) => {
      tracker.trackWrite(docs.length) // N writes for N docs
      return docs.map(doc => {
        const id = doc.$id || `doc_${++idCounter}`
        const record = { ...doc, $id: id }
        storage.set(id, record)
        return record
      })
    },
    update: async (id: string, data: any) => {
      tracker.trackWrite(1)
      const existing = storage.get(id)
      if (!existing) return null
      const updated = { ...existing, ...data }
      storage.set(id, updated)
      return updated
    },
    get: async (id: string) => storage.get(id) || null,
  })
}

// ============================================================================
// Vector Store Mocks
// ============================================================================

/**
 * Create a mock vector store with progressive search capabilities.
 * Supports binary search, hamming filter, and multi-stage refinement.
 */
export function createComparisonVectorStore() {
  const storage = new Map<string, any>()

  return createMockStore({
    binarySearch: async (query: number[], opts: { limit: number }) => {
      // Fast binary prefilter - return candidate IDs
      const limit = opts?.limit || 1000
      return Array.from({ length: limit }, (_, i) => `vec_${i}`)
    },
    hammingFilter: async (query: number[], opts: { maxDistance: number }) => {
      // Filter by hamming distance - return candidate IDs
      const limit = 100
      return Array.from({ length: limit }, (_, i) => `vec_${i}`)
    },
    search: async (opts: { embedding: Float32Array, limit: number }) => {
      const limit = opts?.limit || 10
      return Array.from({ length: limit }, (_, i) => ({
        id: `vec_${i}`,
        score: 1 - (i * 0.05),
      }))
    },
    refineSearch: async (
      query: number[],
      candidates: string[],
      opts: { limit: number }
    ) => {
      const limit = opts?.limit || 10
      return candidates.slice(0, limit)
    },
    insert: async (record: any) => {
      storage.set(record.id || record.$id, record)
      return record
    },
    insertBatch: async (records: any[]) => {
      for (const record of records) {
        storage.set(record.id || record.$id, record)
      }
      return records
    },
    get: async (id: string) => storage.get(id) || null,
  })
}

// ============================================================================
// Tiered Document Store Mocks
// ============================================================================

/**
 * Create a mock tiered document store with hot/warm/cold tiers.
 * Simulates latency differences between tiers.
 */
export function createTieredDocumentStore() {
  const hotData = new Map<string, any>()
  const warmData = new Map<string, any>()
  const coldData = new Map<string, any>()

  // Pre-populate tiers with sample data
  for (let i = 0; i < 100; i++) {
    hotData.set(`hot_doc_${i}`, {
      $id: `hot_doc_${i}`,
      name: `Hot Document ${i}`,
      status: 'active',
      tier: 'hot',
    })
  }
  for (let i = 0; i < 100; i++) {
    warmData.set(`warm_doc_${i}`, {
      $id: `warm_doc_${i}`,
      name: `Warm Document ${i}`,
      status: 'active',
      tier: 'warm',
    })
  }
  for (let i = 0; i < 100; i++) {
    coldData.set(`cold_doc_${i}`, {
      $id: `cold_doc_${i}`,
      name: `Cold Document ${i}`,
      status: 'archived',
      tier: 'cold',
    })
  }

  // Simulate latencies
  const hotLatency = 0.5  // <1ms
  const warmLatency = 5   // ~50ms (simulated as 5ms for faster tests)
  const coldLatency = 10  // ~100ms (simulated as 10ms for faster tests)

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

  return createMockStore({
    get: async (id: string) => {
      if (hotData.has(id)) {
        await delay(hotLatency)
        return hotData.get(id)
      }
      if (warmData.has(id)) {
        await delay(warmLatency)
        return warmData.get(id)
      }
      if (coldData.has(id)) {
        await delay(coldLatency)
        return coldData.get(id)
      }
      return null
    },
    getWithTiming: async (id: string) => {
      const start = performance.now()
      let data = null
      let tier = 'unknown'

      if (hotData.has(id)) {
        await delay(hotLatency)
        data = hotData.get(id)
        tier = 'hot'
      } else if (warmData.has(id)) {
        await delay(warmLatency)
        data = warmData.get(id)
        tier = 'warm'
      } else if (coldData.has(id)) {
        await delay(coldLatency)
        data = coldData.get(id)
        tier = 'cold'
      }

      return {
        data,
        latencyMs: performance.now() - start,
        tier,
      }
    },
    create: async (doc: any) => {
      const id = doc.$id || `doc_${Date.now()}`
      const record = { ...doc, $id: id, tier: 'hot' }
      hotData.set(id, record)
      return record
    },
    query: async (filter: any, opts?: { limit?: number }) => {
      const results: any[] = []
      const limit = opts?.limit || 100

      // Determine which tiers to query
      const targetTier = filter?.$tier

      if (!targetTier || targetTier === 'hot') {
        for (const [, v] of hotData) {
          if (results.length >= limit) break
          if (matchesFilter(v, filter)) results.push(v)
        }
      }
      if ((!targetTier || targetTier === 'warm') && results.length < limit) {
        await delay(warmLatency)
        for (const [, v] of warmData) {
          if (results.length >= limit) break
          if (matchesFilter(v, filter)) results.push(v)
        }
      }
      if ((!targetTier || targetTier === 'cold') && results.length < limit) {
        await delay(coldLatency)
        for (const [, v] of coldData) {
          if (results.length >= limit) break
          if (matchesFilter(v, filter)) results.push(v)
        }
      }

      return results
    },
    scan: async (opts: { $tier: string; $partition?: string }) => {
      if (opts.$tier === 'hot') {
        return { items: Array.from(hotData.values()) }
      }
      if (opts.$tier === 'warm') {
        await delay(warmLatency)
        return { items: Array.from(warmData.values()) }
      }
      if (opts.$tier === 'cold') {
        await delay(coldLatency)
        return { items: Array.from(coldData.values()) }
      }
      return { items: [] }
    },
    promote: async (id: string) => {
      // Move from warm/cold to hot
      let doc = warmData.get(id)
      if (doc) {
        warmData.delete(id)
        doc = { ...doc, tier: 'hot' }
        hotData.set(id, doc)
        return doc
      }
      doc = coldData.get(id)
      if (doc) {
        coldData.delete(id)
        doc = { ...doc, tier: 'hot' }
        hotData.set(id, doc)
        return doc
      }
      return null
    },
    demote: async (id: string, tier: 'warm' | 'cold') => {
      let doc = hotData.get(id)
      if (doc) {
        hotData.delete(id)
        doc = { ...doc, tier }
        if (tier === 'warm') warmData.set(id, doc)
        else coldData.set(id, doc)
        return doc
      }
      if (tier === 'cold') {
        doc = warmData.get(id)
        if (doc) {
          warmData.delete(id)
          doc = { ...doc, tier: 'cold' }
          coldData.set(id, doc)
          return doc
        }
      }
      return null
    },
    restore: async (id: string) => {
      // Move from cold to warm
      const doc = coldData.get(id)
      if (doc) {
        coldData.delete(id)
        const updated = { ...doc, tier: 'warm' }
        warmData.set(id, updated)
        return updated
      }
      return null
    },
    getTierStats: async () => ({
      hot: hotData.size,
      warm: warmData.size,
      cold: coldData.size,
    }),
  })
}

// Helper to match filter against document
function matchesFilter(doc: any, filter: any): boolean {
  if (!filter) return true
  for (const [key, val] of Object.entries(filter)) {
    if (key.startsWith('$')) continue // Skip special keys
    if (doc[key] !== val) return false
  }
  return true
}

// ============================================================================
// Type Exports
// ============================================================================

export type ComparisonDocumentStore = ReturnType<typeof createComparisonDocumentStore>
export type ComparisonRelationalStore = ReturnType<typeof createComparisonRelationalStore>
export type ComparisonColumnarStore = ReturnType<typeof createComparisonColumnarStore>
export type ComparisonVectorStore = ReturnType<typeof createComparisonVectorStore>
export type TieredDocumentStore = ReturnType<typeof createTieredDocumentStore>

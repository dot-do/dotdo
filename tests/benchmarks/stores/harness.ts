/**
 * Store Benchmark Harness
 *
 * GREEN PHASE: Shared test harness for running benchmarks against stores.
 * Provides mock stores, benchmark runners, and result formatting.
 *
 * @see do-z9k - Store Benchmark Implementation
 */

import { BenchmarkRunner, BenchmarkConfig } from '../framework/runner'
import { MetricCollector } from '../framework/metrics'
import { CostTracker } from '../framework/cost-tracker'
import { Reporter, BenchmarkResult } from '../framework/reporter'
import { BenchmarkMetrics, BenchmarkContext } from '../framework/types'

export interface StoreHarness<T> {
  store: T
  tracker: CostTracker
}

/**
 * Create a mock store for testing when real stores aren't available.
 * Uses a Proxy to provide mock implementations of any method.
 *
 * @example
 * const store = createMockStore<DocumentStore>({
 *   create: async (doc) => ({ ...doc, $id: doc.$id || `doc_${Date.now()}` }),
 *   get: async (id) => ({ $id: id, name: 'test' }),
 * })
 */
export function createMockStore<T>(methods: Record<string, (...args: any[]) => any>): T {
  return new Proxy({} as T, {
    get(_, prop: string) {
      if (prop in methods) {
        return methods[prop]
      }
      // Return a no-op async function for unmapped methods
      return async () => {}
    }
  })
}

/**
 * Create a mock document store with standard CRUD operations.
 */
export function createMockDocumentStore() {
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
    list: async (opts?: { limit?: number }) => {
      const items = Array.from(storage.values()).slice(0, opts?.limit || 100)
      return { items, cursor: null }
    },
    query: async (opts?: any) => {
      const items = Array.from(storage.values()).slice(0, opts?.limit || 100)
      return items
    },
    count: async () => storage.size,
    upsert: async (filter: any, data: any) => {
      const id = filter.$id || `doc_${++idCounter}`
      const existing = storage.get(id)
      const record = existing
        ? { ...existing, ...data, $updatedAt: new Date().toISOString() }
        : { ...data, $id: id, $createdAt: new Date().toISOString() }
      storage.set(id, record)
      return record
    },
    updateMany: async () => ({ modifiedCount: 0 }),
    deleteMany: async () => ({ deletedCount: 0 }),
    getBloomFilter: () => ({ mightContain: () => true }),
    getAsOf: async () => null,
  })
}

/**
 * Create a mock vector store with similarity search operations.
 */
export function createMockVectorStore(dimension = 1536) {
  const storage = new Map<string, any>()

  return createMockStore({
    insert: async (record: any) => {
      storage.set(record.id, record)
      return record
    },
    upsert: async (record: any) => {
      storage.set(record.id, record)
      return record
    },
    insertBatch: async (records: any[]) => {
      for (const record of records) {
        storage.set(record.id, record)
      }
      return records
    },
    search: async (opts: any) => {
      // Return mock results
      const limit = opts.limit || 10
      return Array.from(storage.values()).slice(0, limit).map((v, i) => ({
        ...v,
        score: 1 - (i * 0.1)
      }))
    },
    hybridSearch: async (opts: any) => {
      const limit = opts.limit || 10
      return Array.from(storage.values()).slice(0, limit).map((v, i) => ({
        ...v,
        score: 1 - (i * 0.1)
      }))
    },
    progressiveSearch: async (opts: any) => {
      const limit = opts.limit || 10
      return Array.from(storage.values()).slice(0, limit).map((v, i) => ({
        ...v,
        score: 1 - (i * 0.1)
      }))
    },
    get: async (id: string) => storage.get(id) || null,
    delete: async (id: string) => {
      storage.delete(id)
      return true
    },
    computeRRFScore: (rankings: any[]) => {
      const k = 60
      return rankings.reduce((sum, r) => sum + r.weight / (k + r.rank), 0)
    },
    hammingDistance: (a: ArrayBuffer, b: ArrayBuffer) => {
      const va = new Uint8Array(a)
      const vb = new Uint8Array(b)
      let dist = 0
      for (let i = 0; i < va.length; i++) {
        let xor = va[i] ^ vb[i]
        while (xor) {
          dist += xor & 1
          xor >>= 1
        }
      }
      return dist
    },
  })
}

/**
 * Create a mock columnar store with analytics operations.
 */
export function createMockColumnarStore() {
  const storage = new Map<string, any[]>()
  let writeCount = 0

  return createMockStore({
    insertBatch: async (records: any[]) => {
      // Columnar stores batch writes efficiently
      const byType = new Map<string, any[]>()
      for (const record of records) {
        const type = record.type || 'default'
        if (!byType.has(type)) byType.set(type, [])
        byType.get(type)!.push(record)
      }
      // Simulate ~6 writes per batch (one per column group)
      writeCount += Math.min(6, byType.size + 3)
      for (const [type, recs] of byType) {
        const existing = storage.get(type) || []
        storage.set(type, [...existing, ...recs])
      }
      return records
    },
    query: async (opts: any) => {
      const type = opts?.type || 'default'
      const records = storage.get(type) || []
      return records.slice(0, opts?.limit || 100)
    },
    count: async (opts: any) => {
      if (!opts?.type) {
        let total = 0
        for (const records of storage.values()) total += records.length
        return total
      }
      return (storage.get(opts.type) || []).length
    },
    aggregate: async (opts: any) => {
      const records = storage.get(opts?.type) || []
      return { count: records.length, sum: 0, avg: 0, min: 0, max: 0 }
    },
    getColumn: async () => [],
    getTypedColumn: async () => [],
    getBloomFilter: async () => ({ mightContain: () => true }),
    getColumnStats: async () => ({ min: 0, max: 100, count: 0 }),
    findPartitions: async () => [],
    getTypeIndex: async () => new Map(),
    listTypes: async () => [],
    getMeta: async () => ({}),
    calculateSavings: () => ({ percentage: 99.4, rowWritesSaved: writeCount * 100 }),
    estimateQueryCost: () => ({ reads: 1, cost: 0.000001 }),
    getPathStats: async () => ({}),
    getExtractedColumns: async () => [],
    getWriteCount: () => writeCount,
  })
}

/**
 * Create a mock time series store.
 */
export function createMockTimeSeriesStore() {
  const storage = new Map<string, any[]>()

  return createMockStore({
    put: async (key: string, value: number, timestamp: number) => {
      const points = storage.get(key) || []
      points.push({ value, timestamp })
      storage.set(key, points)
    },
    get: async (key: string) => {
      const points = storage.get(key) || []
      return points.length > 0 ? points[points.length - 1] : null
    },
    getAsOf: async (key: string, ts: number | string) => {
      const points = storage.get(key) || []
      const timestamp = typeof ts === 'string' ? new Date(ts).getTime() : ts
      for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].timestamp <= timestamp) return points[i]
      }
      return null
    },
    putBatch: async (items: any[]) => {
      for (const item of items) {
        const points = storage.get(item.key) || []
        points.push({ value: item.value, timestamp: item.timestamp })
        storage.set(item.key, points)
      }
    },
    range: async function* (key: string, opts: { start: number, end: number }) {
      const points = storage.get(key) || []
      for (const point of points) {
        if (point.timestamp >= opts.start && point.timestamp <= opts.end) {
          yield point
        }
      }
    },
    aggregate: async () => ({ buckets: [] }),
    rollup: async () => {},
    archive: async () => {},
    prune: async () => {},
    compact: async () => {},
    createSnapshot: () => `snapshot_${Date.now()}`,
    restoreSnapshot: async () => {},
  })
}

/**
 * Create a mock graph store.
 */
export function createMockGraphStore() {
  const things = new Map<string, any>()
  const relationships = new Map<string, any>()
  let relCounter = 0

  return createMockStore({
    createThing: async (data: any) => {
      things.set(data.id, data)
      return data
    },
    getThing: async (id: string) => things.get(id) || null,
    getThingsByType: async (typeId: number, opts?: any) => {
      return Array.from(things.values())
        .filter(t => t.typeId === typeId)
        .slice(0, opts?.limit || 100)
    },
    updateThing: async (id: string, data: any) => {
      const existing = things.get(id)
      if (!existing) return null
      const updated = { ...existing, ...data }
      things.set(id, updated)
      return updated
    },
    deleteThing: async (id: string) => {
      things.delete(id)
      return true
    },
    createRelationship: async (data: any) => {
      const id = `rel_${++relCounter}`
      const rel = { ...data, id }
      relationships.set(id, rel)
      return rel
    },
    getRelationship: async (id: string) => relationships.get(id) || null,
    queryRelationshipsFrom: async (nodeId: string, opts?: any) => {
      return Array.from(relationships.values())
        .filter(r => r.fromId === nodeId && (!opts?.verb || r.verb === opts.verb))
        .slice(0, opts?.limit || 100)
    },
    queryRelationshipsTo: async (nodeId: string, opts?: any) => {
      return Array.from(relationships.values())
        .filter(r => r.toId === nodeId && (!opts?.verb || r.verb === opts.verb))
        .slice(0, opts?.limit || 100)
    },
    queryRelationshipsByVerb: async (verb: string, opts?: any) => {
      return Array.from(relationships.values())
        .filter(r => r.verb === verb)
        .slice(0, opts?.limit || 100)
    },
    deleteRelationship: async (id: string) => {
      relationships.delete(id)
      return true
    },
    transaction: async (fn: any) => {
      // Just execute the function - no real transaction support in mock
      await fn({
        createThing: async (data: any) => {
          things.set(data.id, data)
          return data
        },
        createRelationship: async (data: any) => {
          const id = `rel_${++relCounter}`
          const rel = { ...data, id }
          relationships.set(id, rel)
          return rel
        },
      })
    },
  })
}

/**
 * Run a single benchmark and return result.
 */
export async function runBenchmark(
  name: string,
  fn: () => any | Promise<any>,
  config: BenchmarkConfig = {}
): Promise<BenchmarkResult> {
  const runner = new BenchmarkRunner({
    name,
    warmup: config.warmup ?? 3,
    iterations: config.iterations ?? 10,
    ...config
  })

  const tracker = new CostTracker()
  const { samples, context } = await runner.run(fn)
  const collector = new MetricCollector(samples)

  const metrics: BenchmarkMetrics = {
    latency: collector.toMetrics(),
    throughput: {
      opsPerSecond: samples.length > 0 ? 1000 / collector.avg : 0,
      bytesPerSecond: 0
    },
    cost: tracker.toMetrics(),
    resources: { peakMemoryMb: 0, storageBytesUsed: 0 }
  }

  return { name, samples, metrics, context }
}

/**
 * Run a benchmark suite and output results.
 */
export async function runSuite(
  suiteName: string,
  benchmarks: Array<{ name: string, fn: () => any | Promise<any> }>,
  config: BenchmarkConfig = {}
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []

  for (const { name, fn } of benchmarks) {
    const result = await runBenchmark(`${suiteName}.${name}`, fn, config)
    results.push(result)

    // Log progress
    console.log(`  ${name}: p50=${result.metrics.latency.p50.toFixed(2)}ms`)
  }

  return results
}

/**
 * Format results for console output.
 */
export function formatResults(results: BenchmarkResult[]): string {
  const reporter = new Reporter()
  return reporter.toConsole(results)
}

/**
 * Export results as JSON.
 */
export function exportResults(results: BenchmarkResult[]): string {
  const reporter = new Reporter()
  return reporter.toJSON(results)
}

/**
 * Export results as Markdown.
 */
export function exportMarkdown(results: BenchmarkResult[]): string {
  const reporter = new Reporter()
  return reporter.toMarkdown(results)
}

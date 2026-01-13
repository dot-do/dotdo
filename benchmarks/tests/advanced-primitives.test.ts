/**
 * Advanced DO Primitives Benchmarks
 *
 * Performance benchmarks for advanced Durable Object primitives:
 * 1. Cache - TTL, invalidation, compare-and-swap operations
 * 2. ColumnarStore - Batch inserts, aggregates, bloom filter predicates
 * 3. TemporalStore - Time-series data, snapshots, time-range queries
 * 4. VectorIndex - Vector storage, kNN search, filtered queries
 * 5. InvertedIndex - Document indexing, BM25 search, boolean queries
 *
 * Measures:
 * - Operation latency (single operations)
 * - Throughput (operations per second)
 * - Memory efficiency (operations under load)
 *
 * Note: These benchmarks use in-memory mock implementations to isolate
 * algorithm performance from database I/O. Production performance
 * will depend on SQLite in Durable Objects.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// BENCHMARK CONFIGURATION
// ============================================================================

/** Number of iterations for warm benchmarks */
const BENCHMARK_ITERATIONS = 100

/** Number of warmup iterations before measuring */
const WARMUP_ITERATIONS = 10

/** Maximum acceptable latency for single operations (ms) */
const MAX_SINGLE_OP_LATENCY_MS = 50

/** Minimum acceptable throughput (ops/sec) */
const MIN_THROUGHPUT_OPS_SEC = 100

/** Number of vectors/documents for search benchmarks */
const SEARCH_DATASET_SIZE = 1000

/** Vector dimension for vector index benchmarks */
const VECTOR_DIMENSION = 128

// ============================================================================
// BENCHMARK UTILITIES
// ============================================================================

interface BenchmarkResult {
  name: string
  iterations: number
  totalMs: number
  avgMs: number
  minMs: number
  maxMs: number
  opsPerSec: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

/**
 * Runs a benchmark and collects timing statistics
 */
async function runBenchmark(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = BENCHMARK_ITERATIONS,
  warmupIterations: number = WARMUP_ITERATIONS
): Promise<BenchmarkResult> {
  // Warmup phase
  for (let i = 0; i < warmupIterations; i++) {
    await fn()
  }

  // Collect timing samples
  const samples: number[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    const end = performance.now()
    samples.push(end - start)
  }

  // Calculate statistics
  samples.sort((a, b) => a - b)
  const totalMs = samples.reduce((a, b) => a + b, 0)
  const avgMs = totalMs / iterations
  const minMs = samples[0]!
  const maxMs = samples[samples.length - 1]!
  const opsPerSec = 1000 / avgMs
  const p50Ms = samples[Math.floor(iterations * 0.5)]!
  const p95Ms = samples[Math.floor(iterations * 0.95)]!
  const p99Ms = samples[Math.floor(iterations * 0.99)]!

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    opsPerSec,
    p50Ms,
    p95Ms,
    p99Ms,
  }
}

/**
 * Formats benchmark result for console output
 */
function formatBenchmarkResult(result: BenchmarkResult): string {
  return [
    `  ${result.name}:`,
    `    Avg: ${result.avgMs.toFixed(3)} ms`,
    `    Min: ${result.minMs.toFixed(3)} ms, Max: ${result.maxMs.toFixed(3)} ms`,
    `    P50: ${result.p50Ms.toFixed(3)} ms, P95: ${result.p95Ms.toFixed(3)} ms, P99: ${result.p99Ms.toFixed(3)} ms`,
    `    Throughput: ${result.opsPerSec.toFixed(1)} ops/sec`,
  ].join('\n')
}

// ============================================================================
// MOCK CACHE IMPLEMENTATION
// ============================================================================

interface CacheEntry<T = unknown> {
  value: T
  expiresAt: number
  dependencies: string[]
  etag: string
}

interface CacheStats {
  hits: number
  misses: number
  hitRatio: number
}

class MockCache {
  private cache = new Map<string, CacheEntry>()
  private dependencyIndex = new Map<string, Set<string>>()
  private stats = { hits: 0, misses: 0 }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key)
    if (!entry) {
      this.stats.misses++
      return undefined
    }
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key)
      this.stats.misses++
      return undefined
    }
    this.stats.hits++
    return entry.value as T
  }

  async set<T>(key: string, value: T, options?: { ttl?: number; dependencies?: string[] }): Promise<{ etag: string }> {
    const ttl = options?.ttl ?? 60000
    const dependencies = options?.dependencies ?? []
    const etag = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttl,
      dependencies,
      etag,
    }
    this.cache.set(key, entry)

    // Index dependencies
    for (const dep of dependencies) {
      if (!this.dependencyIndex.has(dep)) {
        this.dependencyIndex.set(dep, new Set())
      }
      this.dependencyIndex.get(dep)!.add(key)
    }

    return { etag }
  }

  async invalidate(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async invalidateCascade(key: string): Promise<{ invalidatedKeys: string[]; duration: number }> {
    const start = performance.now()
    const invalidated: string[] = []
    const visited = new Set<string>()

    const cascade = (currentKey: string) => {
      if (visited.has(currentKey)) return
      visited.add(currentKey)
      invalidated.push(currentKey)

      const dependents = this.dependencyIndex.get(currentKey)
      if (dependents) {
        for (const dependent of dependents) {
          cascade(dependent)
        }
      }
    }

    cascade(key)

    for (const k of invalidated) {
      this.cache.delete(k)
    }

    return {
      invalidatedKeys: invalidated,
      duration: performance.now() - start,
    }
  }

  async compareAndSwap<T>(key: string, value: T, expectedEtag: string): Promise<{ etag: string } | null> {
    const entry = this.cache.get(key)
    if (!entry || entry.etag !== expectedEtag) {
      return null
    }
    return this.set(key, value)
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRatio: total > 0 ? this.stats.hits / total : 0,
    }
  }

  clear(): void {
    this.cache.clear()
    this.dependencyIndex.clear()
    this.stats = { hits: 0, misses: 0 }
  }
}

// ============================================================================
// MOCK COLUMNAR STORE IMPLEMENTATION
// ============================================================================

interface ColumnarRow {
  id: string
  columns: Record<string, number | string | boolean | null>
}

interface BloomFilter {
  bitArray: Uint8Array
  hashCount: number
}

class MockColumnarStore {
  private rows: ColumnarRow[] = []
  private columnBloomFilters = new Map<string, BloomFilter>()

  private createBloomFilter(size: number = 1024): BloomFilter {
    return {
      bitArray: new Uint8Array(size),
      hashCount: 3,
    }
  }

  private hash(value: string, seed: number): number {
    let h = seed
    for (let i = 0; i < value.length; i++) {
      h = ((h << 5) - h + value.charCodeAt(i)) | 0
    }
    return Math.abs(h)
  }

  private bloomAdd(filter: BloomFilter, value: string): void {
    for (let i = 0; i < filter.hashCount; i++) {
      const idx = this.hash(value, i) % (filter.bitArray.length * 8)
      const byteIdx = Math.floor(idx / 8)
      const bitIdx = idx % 8
      filter.bitArray[byteIdx]! |= 1 << bitIdx
    }
  }

  private bloomMayContain(filter: BloomFilter, value: string): boolean {
    for (let i = 0; i < filter.hashCount; i++) {
      const idx = this.hash(value, i) % (filter.bitArray.length * 8)
      const byteIdx = Math.floor(idx / 8)
      const bitIdx = idx % 8
      if ((filter.bitArray[byteIdx]! & (1 << bitIdx)) === 0) {
        return false
      }
    }
    return true
  }

  async batchInsert(rows: ColumnarRow[]): Promise<number> {
    for (const row of rows) {
      this.rows.push(row)

      // Update bloom filters for each column
      for (const [col, value] of Object.entries(row.columns)) {
        if (value !== null) {
          if (!this.columnBloomFilters.has(col)) {
            this.columnBloomFilters.set(col, this.createBloomFilter())
          }
          this.bloomAdd(this.columnBloomFilters.get(col)!, String(value))
        }
      }
    }
    return rows.length
  }

  async aggregateSum(column: string): Promise<number> {
    let sum = 0
    for (const row of this.rows) {
      const value = row.columns[column]
      if (typeof value === 'number') {
        sum += value
      }
    }
    return sum
  }

  async aggregateAvg(column: string): Promise<number> {
    let sum = 0
    let count = 0
    for (const row of this.rows) {
      const value = row.columns[column]
      if (typeof value === 'number') {
        sum += value
        count++
      }
    }
    return count > 0 ? sum / count : 0
  }

  async queryWithBloomPredicate(column: string, value: string): Promise<ColumnarRow[]> {
    // Check bloom filter first
    const filter = this.columnBloomFilters.get(column)
    if (filter && !this.bloomMayContain(filter, value)) {
      return [] // Definitely not present
    }

    // Full scan if bloom filter says maybe present
    return this.rows.filter((row) => String(row.columns[column]) === value)
  }

  clear(): void {
    this.rows = []
    this.columnBloomFilters.clear()
  }
}

// ============================================================================
// MOCK TEMPORAL STORE IMPLEMENTATION
// ============================================================================

interface TemporalEntry<T = unknown> {
  key: string
  value: T
  timestamp: number
  version: number
}

interface Snapshot {
  id: string
  timestamp: number
  entries: Map<string, TemporalEntry>
}

class MockTemporalStore {
  private entries = new Map<string, TemporalEntry[]>()
  private snapshots: Snapshot[] = []
  private versionCounter = 0

  async put<T>(key: string, value: T, timestamp?: number): Promise<TemporalEntry<T>> {
    const ts = timestamp ?? Date.now()
    const entry: TemporalEntry<T> = {
      key,
      value,
      timestamp: ts,
      version: ++this.versionCounter,
    }

    if (!this.entries.has(key)) {
      this.entries.set(key, [])
    }
    this.entries.get(key)!.push(entry)

    return entry
  }

  async get<T>(key: string, timestamp?: number): Promise<T | undefined> {
    const history = this.entries.get(key)
    if (!history || history.length === 0) {
      return undefined
    }

    if (timestamp !== undefined) {
      // Find the latest version at or before the given timestamp
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i]!.timestamp <= timestamp) {
          return history[i]!.value as T
        }
      }
      return undefined
    }

    // Return latest
    return history[history.length - 1]!.value as T
  }

  async queryTimeRange<T>(key: string, startTime: number, endTime: number): Promise<TemporalEntry<T>[]> {
    const history = this.entries.get(key)
    if (!history) {
      return []
    }

    return history.filter(
      (e) => e.timestamp >= startTime && e.timestamp <= endTime
    ) as TemporalEntry<T>[]
  }

  async createSnapshot(): Promise<Snapshot> {
    const snapshot: Snapshot = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      entries: new Map(),
    }

    // Capture current state
    for (const [key, history] of this.entries) {
      if (history.length > 0) {
        snapshot.entries.set(key, history[history.length - 1]!)
      }
    }

    this.snapshots.push(snapshot)
    return snapshot
  }

  async restoreSnapshot(snapshotId: string): Promise<boolean> {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId)
    if (!snapshot) {
      return false
    }

    // Restore state from snapshot
    this.entries.clear()
    for (const [key, entry] of snapshot.entries) {
      this.entries.set(key, [entry])
    }

    return true
  }

  clear(): void {
    this.entries.clear()
    this.snapshots = []
    this.versionCounter = 0
  }
}

// ============================================================================
// MOCK VECTOR INDEX IMPLEMENTATION
// ============================================================================

interface VectorEntry {
  id: string
  vector: Float32Array
  metadata: Record<string, unknown>
}

interface VectorSearchResult {
  id: string
  distance: number
  metadata: Record<string, unknown>
}

class MockVectorIndex {
  private vectors: VectorEntry[] = []
  private dimension: number

  constructor(dimension: number = VECTOR_DIMENSION) {
    this.dimension = dimension
  }

  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0
    for (let i = 0; i < a.length; i++) {
      const diff = a[i]! - b[i]!
      sum += diff * diff
    }
    return Math.sqrt(sum)
  }

  private cosineDistance(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!
      normA += a[i]! * a[i]!
      normB += b[i]! * b[i]!
    }
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
    return 1 - similarity
  }

  async insert(id: string, vector: Float32Array, metadata: Record<string, unknown> = {}): Promise<void> {
    if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}`)
    }
    this.vectors.push({ id, vector, metadata })
  }

  async batchInsert(entries: Array<{ id: string; vector: Float32Array; metadata?: Record<string, unknown> }>): Promise<number> {
    for (const entry of entries) {
      await this.insert(entry.id, entry.vector, entry.metadata ?? {})
    }
    return entries.length
  }

  async knnSearch(query: Float32Array, k: number = 10): Promise<VectorSearchResult[]> {
    if (query.length !== this.dimension) {
      throw new Error(`Query dimension mismatch: expected ${this.dimension}, got ${query.length}`)
    }

    // Compute distances to all vectors
    const distances: Array<{ entry: VectorEntry; distance: number }> = []
    for (const entry of this.vectors) {
      distances.push({
        entry,
        distance: this.euclideanDistance(query, entry.vector),
      })
    }

    // Sort by distance and take top k
    distances.sort((a, b) => a.distance - b.distance)
    const topK = distances.slice(0, k)

    return topK.map((d) => ({
      id: d.entry.id,
      distance: d.distance,
      metadata: d.entry.metadata,
    }))
  }

  async filteredKnnSearch(
    query: Float32Array,
    k: number,
    filter: (metadata: Record<string, unknown>) => boolean
  ): Promise<VectorSearchResult[]> {
    if (query.length !== this.dimension) {
      throw new Error(`Query dimension mismatch: expected ${this.dimension}, got ${query.length}`)
    }

    // Filter vectors first, then compute distances
    const filtered = this.vectors.filter((v) => filter(v.metadata))

    const distances: Array<{ entry: VectorEntry; distance: number }> = []
    for (const entry of filtered) {
      distances.push({
        entry,
        distance: this.euclideanDistance(query, entry.vector),
      })
    }

    distances.sort((a, b) => a.distance - b.distance)
    const topK = distances.slice(0, k)

    return topK.map((d) => ({
      id: d.entry.id,
      distance: d.distance,
      metadata: d.entry.metadata,
    }))
  }

  size(): number {
    return this.vectors.length
  }

  clear(): void {
    this.vectors = []
  }
}

// ============================================================================
// MOCK INVERTED INDEX IMPLEMENTATION
// ============================================================================

interface IndexedDocument {
  id: string
  content: string
  fields: Record<string, string>
  termFrequencies: Map<string, number>
  length: number
}

interface SearchResult {
  id: string
  score: number
  highlights?: string[]
}

class MockInvertedIndex {
  private documents = new Map<string, IndexedDocument>()
  private invertedIndex = new Map<string, Set<string>>() // term -> doc ids
  private documentFrequencies = new Map<string, number>() // term -> doc count
  private avgDocLength = 0

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0)
  }

  async indexDocument(id: string, content: string, fields: Record<string, string> = {}): Promise<void> {
    // Remove old document if exists
    if (this.documents.has(id)) {
      await this.removeDocument(id)
    }

    const tokens = this.tokenize(content)
    const termFreqs = new Map<string, number>()

    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1)
    }

    const doc: IndexedDocument = {
      id,
      content,
      fields,
      termFrequencies: termFreqs,
      length: tokens.length,
    }
    this.documents.set(id, doc)

    // Update inverted index
    for (const term of termFreqs.keys()) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set())
      }
      this.invertedIndex.get(term)!.add(id)
      this.documentFrequencies.set(term, (this.documentFrequencies.get(term) ?? 0) + 1)
    }

    // Update average document length
    this.updateAvgDocLength()
  }

  async removeDocument(id: string): Promise<boolean> {
    const doc = this.documents.get(id)
    if (!doc) return false

    // Remove from inverted index
    for (const term of doc.termFrequencies.keys()) {
      const docSet = this.invertedIndex.get(term)
      if (docSet) {
        docSet.delete(id)
        if (docSet.size === 0) {
          this.invertedIndex.delete(term)
        }
        const df = this.documentFrequencies.get(term) ?? 1
        if (df <= 1) {
          this.documentFrequencies.delete(term)
        } else {
          this.documentFrequencies.set(term, df - 1)
        }
      }
    }

    this.documents.delete(id)
    this.updateAvgDocLength()
    return true
  }

  private updateAvgDocLength(): void {
    if (this.documents.size === 0) {
      this.avgDocLength = 0
      return
    }
    let totalLength = 0
    for (const doc of this.documents.values()) {
      totalLength += doc.length
    }
    this.avgDocLength = totalLength / this.documents.size
  }

  /**
   * BM25 scoring function
   * k1 controls term frequency saturation
   * b controls length normalization
   */
  private bm25Score(term: string, docId: string, k1 = 1.2, b = 0.75): number {
    const doc = this.documents.get(docId)
    if (!doc) return 0

    const tf = doc.termFrequencies.get(term) ?? 0
    if (tf === 0) return 0

    const N = this.documents.size
    const df = this.documentFrequencies.get(term) ?? 0
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)

    const numerator = tf * (k1 + 1)
    const denominator = tf + k1 * (1 - b + b * (doc.length / this.avgDocLength))

    return idf * (numerator / denominator)
  }

  async searchBM25(query: string, limit: number = 10): Promise<SearchResult[]> {
    const queryTerms = this.tokenize(query)
    const scores = new Map<string, number>()

    // Calculate BM25 scores
    for (const term of queryTerms) {
      const docIds = this.invertedIndex.get(term)
      if (!docIds) continue

      for (const docId of docIds) {
        const score = this.bm25Score(term, docId)
        scores.set(docId, (scores.get(docId) ?? 0) + score)
      }
    }

    // Sort by score
    const results: SearchResult[] = Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return results
  }

  async booleanQueryAnd(terms: string[]): Promise<SearchResult[]> {
    if (terms.length === 0) return []

    // Start with documents containing first term
    const firstTerm = terms[0]!.toLowerCase()
    let resultDocIds = new Set(this.invertedIndex.get(firstTerm) ?? [])

    // Intersect with documents containing each subsequent term
    for (let i = 1; i < terms.length; i++) {
      const term = terms[i]!.toLowerCase()
      const docIds = this.invertedIndex.get(term)
      if (!docIds) {
        return [] // No documents contain all terms
      }

      const newResult = new Set<string>()
      for (const docId of resultDocIds) {
        if (docIds.has(docId)) {
          newResult.add(docId)
        }
      }
      resultDocIds = newResult

      if (resultDocIds.size === 0) {
        return []
      }
    }

    // Return with simple term frequency score
    return Array.from(resultDocIds).map((id) => {
      const doc = this.documents.get(id)!
      let score = 0
      for (const term of terms) {
        score += doc.termFrequencies.get(term.toLowerCase()) ?? 0
      }
      return { id, score }
    }).sort((a, b) => b.score - a.score)
  }

  async booleanQueryOr(terms: string[]): Promise<SearchResult[]> {
    if (terms.length === 0) return []

    const resultDocIds = new Set<string>()
    for (const term of terms) {
      const docIds = this.invertedIndex.get(term.toLowerCase())
      if (docIds) {
        for (const docId of docIds) {
          resultDocIds.add(docId)
        }
      }
    }

    return Array.from(resultDocIds).map((id) => {
      const doc = this.documents.get(id)!
      let score = 0
      for (const term of terms) {
        score += doc.termFrequencies.get(term.toLowerCase()) ?? 0
      }
      return { id, score }
    }).sort((a, b) => b.score - a.score)
  }

  async phraseQuery(phrase: string): Promise<SearchResult[]> {
    const phraseTokens = this.tokenize(phrase)
    if (phraseTokens.length === 0) return []

    const results: SearchResult[] = []

    for (const [docId, doc] of this.documents) {
      const docTokens = this.tokenize(doc.content)

      // Find phrase matches
      let matches = 0
      for (let i = 0; i <= docTokens.length - phraseTokens.length; i++) {
        let match = true
        for (let j = 0; j < phraseTokens.length; j++) {
          if (docTokens[i + j] !== phraseTokens[j]) {
            match = false
            break
          }
        }
        if (match) {
          matches++
        }
      }

      if (matches > 0) {
        results.push({ id: docId, score: matches })
      }
    }

    return results.sort((a, b) => b.score - a.score)
  }

  size(): number {
    return this.documents.size
  }

  clear(): void {
    this.documents.clear()
    this.invertedIndex.clear()
    this.documentFrequencies.clear()
    this.avgDocLength = 0
  }
}

// ============================================================================
// HELPER: Generate Random Data
// ============================================================================

function generateRandomVector(dimension: number): Float32Array {
  const vector = new Float32Array(dimension)
  for (let i = 0; i < dimension; i++) {
    vector[i] = Math.random() * 2 - 1 // Random values between -1 and 1
  }
  return vector
}

function generateRandomDocument(index: number): { id: string; content: string } {
  const topics = ['technology', 'science', 'business', 'health', 'sports', 'politics']
  const adjectives = ['innovative', 'groundbreaking', 'revolutionary', 'traditional', 'modern', 'advanced']
  const nouns = ['solutions', 'approaches', 'methods', 'strategies', 'techniques', 'systems']

  const topic = topics[index % topics.length]
  const adj1 = adjectives[Math.floor(Math.random() * adjectives.length)]
  const adj2 = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun1 = nouns[Math.floor(Math.random() * nouns.length)]
  const noun2 = nouns[Math.floor(Math.random() * nouns.length)]

  return {
    id: `doc-${index}`,
    content: `This document discusses ${topic} with ${adj1} ${noun1} and ${adj2} ${noun2}. ` +
             `The ${topic} industry continues to evolve with new ${noun1}. ` +
             `Experts recommend ${adj1} ${noun2} for better results in ${topic}.`,
  }
}

// ============================================================================
// CACHE BENCHMARKS
// ============================================================================

describe('Cache Benchmarks', () => {
  let cache: MockCache

  beforeEach(() => {
    cache = new MockCache()
  })

  describe('get hit benchmark', () => {
    it('should measure cache hit performance', async () => {
      // Pre-populate cache
      for (let i = 0; i < 100; i++) {
        await cache.set(`key-${i}`, { data: `value-${i}`, index: i })
      }

      let idx = 0
      const result = await runBenchmark('Cache.get (hit)', async () => {
        await cache.get(`key-${idx++ % 100}`)
      })

      console.log('\n--- Cache.get (hit) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)

      const stats = cache.getStats()
      expect(stats.hitRatio).toBeGreaterThan(0.9)
    })
  })

  describe('get miss benchmark', () => {
    it('should measure cache miss performance', async () => {
      let idx = 0
      const result = await runBenchmark('Cache.get (miss)', async () => {
        await cache.get(`nonexistent-key-${idx++}`)
      })

      console.log('\n--- Cache.get (miss) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)

      const stats = cache.getStats()
      expect(stats.hitRatio).toBe(0)
    })
  })

  describe('set with TTL benchmark', () => {
    it('should measure cache set with TTL performance', async () => {
      let idx = 0
      const result = await runBenchmark('Cache.set (TTL)', async () => {
        await cache.set(`key-${idx++}`, { data: 'value', timestamp: Date.now() }, { ttl: 5000 })
      })

      console.log('\n--- Cache.set (TTL) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('cascade invalidation benchmark', () => {
    it('should measure cascade invalidation performance', async () => {
      // Build a dependency tree: root -> level1 -> level2 -> level3
      const setupDependencies = async () => {
        cache.clear()
        await cache.set('root', { level: 0 })

        for (let i = 0; i < 10; i++) {
          await cache.set(`level1-${i}`, { level: 1 }, { dependencies: ['root'] })
          for (let j = 0; j < 5; j++) {
            await cache.set(`level2-${i}-${j}`, { level: 2 }, { dependencies: [`level1-${i}`] })
            for (let k = 0; k < 2; k++) {
              await cache.set(`level3-${i}-${j}-${k}`, { level: 3 }, { dependencies: [`level2-${i}-${j}`] })
            }
          }
        }
      }

      await setupDependencies()

      const result = await runBenchmark('Cache.invalidateCascade', async () => {
        await setupDependencies() // Re-setup before each iteration
        await cache.invalidateCascade('root')
      }, 50, 5)

      console.log('\n--- Cache.invalidateCascade Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS * 2) // Allow more time for complex operation
    })
  })

  describe('compare-and-swap benchmark', () => {
    it('should measure compare-and-swap performance', async () => {
      // Setup initial values
      const etags: string[] = []
      for (let i = 0; i < 100; i++) {
        const { etag } = await cache.set(`cas-key-${i}`, { version: 0, data: 'initial' })
        etags.push(etag)
      }

      let idx = 0
      let version = 0
      const result = await runBenchmark('Cache.compareAndSwap', async () => {
        const keyIdx = idx++ % 100
        const key = `cas-key-${keyIdx}`
        const newValue = { version: ++version, data: `updated-${version}` }

        // Get current etag
        const currentEntry = await cache.set(key, newValue)
        etags[keyIdx] = currentEntry.etag

        // CAS with current etag
        const result = await cache.compareAndSwap(key, { ...newValue, version: version + 1 }, etags[keyIdx]!)
        if (result) {
          etags[keyIdx] = result.etag
        }
      })

      console.log('\n--- Cache.compareAndSwap Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })
})

// ============================================================================
// COLUMNAR STORE BENCHMARKS
// ============================================================================

describe('ColumnarStore Benchmarks', () => {
  let store: MockColumnarStore

  beforeEach(() => {
    store = new MockColumnarStore()
  })

  describe('batch insert benchmark', () => {
    it('should measure batch insert performance', async () => {
      const result = await runBenchmark('ColumnarStore.batchInsert', async () => {
        const rows: ColumnarRow[] = []
        for (let i = 0; i < 100; i++) {
          rows.push({
            id: crypto.randomUUID(),
            columns: {
              amount: Math.random() * 1000,
              quantity: Math.floor(Math.random() * 100),
              category: ['A', 'B', 'C'][i % 3],
              active: Math.random() > 0.5,
            },
          })
        }
        await store.batchInsert(rows)
      }, 50, 5)

      console.log('\n--- ColumnarStore.batchInsert (100 rows) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('aggregate SUM benchmark', () => {
    it('should measure aggregate SUM performance', async () => {
      // Pre-populate with data
      const rows: ColumnarRow[] = []
      for (let i = 0; i < 10000; i++) {
        rows.push({
          id: `row-${i}`,
          columns: {
            amount: Math.random() * 1000,
            quantity: Math.floor(Math.random() * 100),
          },
        })
      }
      await store.batchInsert(rows)

      const result = await runBenchmark('ColumnarStore.aggregateSum', async () => {
        await store.aggregateSum('amount')
      })

      console.log('\n--- ColumnarStore.aggregateSum (10K rows) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('bloom filter predicate pushdown benchmark', () => {
    it('should measure bloom filter predicate performance', async () => {
      // Pre-populate with data
      const rows: ColumnarRow[] = []
      const categories = ['electronics', 'clothing', 'food', 'furniture', 'toys']
      for (let i = 0; i < 10000; i++) {
        rows.push({
          id: `row-${i}`,
          columns: {
            category: categories[i % categories.length],
            amount: Math.random() * 1000,
          },
        })
      }
      await store.batchInsert(rows)

      let categoryIdx = 0
      const result = await runBenchmark('ColumnarStore.queryWithBloomPredicate', async () => {
        await store.queryWithBloomPredicate('category', categories[categoryIdx++ % categories.length]!)
      })

      console.log('\n--- ColumnarStore.queryWithBloomPredicate (10K rows) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// TEMPORAL STORE BENCHMARKS
// ============================================================================

describe('TemporalStore Benchmarks', () => {
  let store: MockTemporalStore

  beforeEach(() => {
    store = new MockTemporalStore()
  })

  describe('put with timestamp benchmark', () => {
    it('should measure temporal put performance', async () => {
      let idx = 0
      const result = await runBenchmark('TemporalStore.put', async () => {
        await store.put(`key-${idx++ % 100}`, { value: idx, data: 'test' }, Date.now())
      })

      console.log('\n--- TemporalStore.put Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('time-range query benchmark', () => {
    it('should measure time-range query performance', async () => {
      // Pre-populate with time-series data
      const baseTime = Date.now() - 86400000 // 24 hours ago
      for (let i = 0; i < 100; i++) {
        for (let j = 0; j < 100; j++) {
          await store.put(`sensor-${i}`, { reading: Math.random() * 100 }, baseTime + j * 60000)
        }
      }

      let sensorIdx = 0
      const result = await runBenchmark('TemporalStore.queryTimeRange', async () => {
        const startTime = baseTime + Math.floor(Math.random() * 3600000)
        const endTime = startTime + 3600000 // 1 hour range
        await store.queryTimeRange(`sensor-${sensorIdx++ % 100}`, startTime, endTime)
      })

      console.log('\n--- TemporalStore.queryTimeRange Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('snapshot creation benchmark', () => {
    it('should measure snapshot creation performance', async () => {
      // Pre-populate with data
      for (let i = 0; i < 1000; i++) {
        await store.put(`key-${i}`, { value: i, data: `data-${i}` })
      }

      const result = await runBenchmark('TemporalStore.createSnapshot', async () => {
        await store.createSnapshot()
      }, 50, 5)

      console.log('\n--- TemporalStore.createSnapshot (1K keys) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// VECTOR INDEX BENCHMARKS
// ============================================================================

describe('VectorIndex Benchmarks', () => {
  let index: MockVectorIndex

  beforeEach(() => {
    index = new MockVectorIndex(VECTOR_DIMENSION)
  })

  describe('batch insert vectors benchmark', () => {
    it('should measure batch vector insert performance', async () => {
      const result = await runBenchmark('VectorIndex.batchInsert', async () => {
        const entries = []
        for (let i = 0; i < 100; i++) {
          entries.push({
            id: crypto.randomUUID(),
            vector: generateRandomVector(VECTOR_DIMENSION),
            metadata: { category: ['A', 'B', 'C'][i % 3], index: i },
          })
        }
        await index.batchInsert(entries)
      }, 50, 5)

      console.log('\n--- VectorIndex.batchInsert (100 vectors) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('kNN search k=10 benchmark', () => {
    it('should measure kNN search k=10 performance', async () => {
      // Pre-populate with vectors
      const entries = []
      for (let i = 0; i < SEARCH_DATASET_SIZE; i++) {
        entries.push({
          id: `vec-${i}`,
          vector: generateRandomVector(VECTOR_DIMENSION),
          metadata: { category: ['A', 'B', 'C'][i % 3], index: i },
        })
      }
      await index.batchInsert(entries)

      const result = await runBenchmark('VectorIndex.knnSearch (k=10)', async () => {
        const query = generateRandomVector(VECTOR_DIMENSION)
        await index.knnSearch(query, 10)
      })

      console.log('\n--- VectorIndex.knnSearch k=10 (1K vectors) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('kNN search k=100 benchmark', () => {
    it('should measure kNN search k=100 performance', async () => {
      // Pre-populate with vectors
      const entries = []
      for (let i = 0; i < SEARCH_DATASET_SIZE; i++) {
        entries.push({
          id: `vec-${i}`,
          vector: generateRandomVector(VECTOR_DIMENSION),
          metadata: { category: ['A', 'B', 'C'][i % 3], index: i },
        })
      }
      await index.batchInsert(entries)

      const result = await runBenchmark('VectorIndex.knnSearch (k=100)', async () => {
        const query = generateRandomVector(VECTOR_DIMENSION)
        await index.knnSearch(query, 100)
      })

      console.log('\n--- VectorIndex.knnSearch k=100 (1K vectors) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('filtered vector search benchmark', () => {
    it('should measure filtered kNN search performance', async () => {
      // Pre-populate with vectors
      const entries = []
      for (let i = 0; i < SEARCH_DATASET_SIZE; i++) {
        entries.push({
          id: `vec-${i}`,
          vector: generateRandomVector(VECTOR_DIMENSION),
          metadata: { category: ['A', 'B', 'C'][i % 3], index: i },
        })
      }
      await index.batchInsert(entries)

      const categories = ['A', 'B', 'C']
      let catIdx = 0
      const result = await runBenchmark('VectorIndex.filteredKnnSearch', async () => {
        const query = generateRandomVector(VECTOR_DIMENSION)
        const category = categories[catIdx++ % 3]
        await index.filteredKnnSearch(query, 10, (meta) => meta.category === category)
      })

      console.log('\n--- VectorIndex.filteredKnnSearch (1K vectors) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// INVERTED INDEX BENCHMARKS
// ============================================================================

describe('InvertedIndex Benchmarks', () => {
  let index: MockInvertedIndex

  beforeEach(() => {
    index = new MockInvertedIndex()
  })

  describe('index document benchmark', () => {
    it('should measure document indexing performance', async () => {
      let idx = 0
      const result = await runBenchmark('InvertedIndex.indexDocument', async () => {
        const { id, content } = generateRandomDocument(idx++)
        await index.indexDocument(id, content)
      })

      console.log('\n--- InvertedIndex.indexDocument Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('BM25 search benchmark', () => {
    it('should measure BM25 search performance', async () => {
      // Pre-populate with documents
      for (let i = 0; i < SEARCH_DATASET_SIZE; i++) {
        const { id, content } = generateRandomDocument(i)
        await index.indexDocument(id, content)
      }

      const queries = ['technology solutions', 'innovative methods', 'business strategies', 'health systems', 'sports techniques']
      let queryIdx = 0
      const result = await runBenchmark('InvertedIndex.searchBM25', async () => {
        await index.searchBM25(queries[queryIdx++ % queries.length]!, 10)
      })

      console.log('\n--- InvertedIndex.searchBM25 (1K docs) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('boolean query (AND) benchmark', () => {
    it('should measure boolean AND query performance', async () => {
      // Pre-populate with documents
      for (let i = 0; i < SEARCH_DATASET_SIZE; i++) {
        const { id, content } = generateRandomDocument(i)
        await index.indexDocument(id, content)
      }

      const termSets = [
        ['technology', 'solutions'],
        ['innovative', 'methods'],
        ['business', 'strategies'],
        ['health', 'systems'],
      ]
      let queryIdx = 0
      const result = await runBenchmark('InvertedIndex.booleanQueryAnd', async () => {
        await index.booleanQueryAnd(termSets[queryIdx++ % termSets.length]!)
      })

      console.log('\n--- InvertedIndex.booleanQueryAnd (1K docs) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('phrase query benchmark', () => {
    it('should measure phrase query performance', async () => {
      // Pre-populate with documents
      for (let i = 0; i < SEARCH_DATASET_SIZE; i++) {
        const { id, content } = generateRandomDocument(i)
        await index.indexDocument(id, content)
      }

      const phrases = ['innovative solutions', 'technology industry', 'better results', 'new methods', 'experts recommend']
      let phraseIdx = 0
      const result = await runBenchmark('InvertedIndex.phraseQuery', async () => {
        await index.phraseQuery(phrases[phraseIdx++ % phrases.length]!)
      })

      console.log('\n--- InvertedIndex.phraseQuery (1K docs) Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// SUMMARY REPORT
// ============================================================================

describe('Advanced Primitives Benchmark Summary', () => {
  it('should print consolidated benchmark summary', async () => {
    console.log('\n========================================')
    console.log('ADVANCED PRIMITIVES BENCHMARK SUMMARY')
    console.log('========================================\n')

    console.log('Primitives benchmarked:')
    console.log('  1. Cache - TTL, cascade invalidation, CAS')
    console.log('  2. ColumnarStore - Batch inserts, aggregates, bloom filters')
    console.log('  3. TemporalStore - Time-series, snapshots, range queries')
    console.log('  4. VectorIndex - kNN search, filtered search')
    console.log('  5. InvertedIndex - BM25, boolean queries, phrase search')
    console.log('')

    console.log('Configuration:')
    console.log(`  Iterations per benchmark: ${BENCHMARK_ITERATIONS}`)
    console.log(`  Warmup iterations: ${WARMUP_ITERATIONS}`)
    console.log(`  Max single op latency: ${MAX_SINGLE_OP_LATENCY_MS} ms`)
    console.log(`  Min throughput: ${MIN_THROUGHPUT_OPS_SEC} ops/sec`)
    console.log(`  Vector dimension: ${VECTOR_DIMENSION}`)
    console.log(`  Search dataset size: ${SEARCH_DATASET_SIZE}`)
    console.log('')

    console.log('Performance targets:')
    console.log('  - Cache hit: < 1ms')
    console.log('  - Cache CAS: < 5ms')
    console.log('  - Columnar aggregate: < 10ms (10K rows)')
    console.log('  - Temporal range query: < 5ms')
    console.log('  - Vector kNN k=10: < 20ms (1K vectors)')
    console.log('  - BM25 search: < 10ms (1K docs)')
    console.log('')

    console.log('Note: These benchmarks use in-memory mock implementations.')
    console.log('Production performance depends on SQLite in Durable Objects.')
    console.log('')

    expect(true).toBe(true)
  })
})

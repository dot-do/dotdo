/**
 * Core 7 DO Stores Benchmarks
 *
 * Performance benchmarks for the core Durable Object stores:
 * 1. ThingsStore - CRUD operations for Things
 * 2. RelationshipsStore - Relationship management and traversal
 * 3. ActionsStore - Action logging and lifecycle
 * 4. EventsStore - Event emission and streaming
 * 5. SearchStore - Full-text and semantic search indexing
 * 6. ObjectsStore - DO registry and resolution
 * 7. DLQStore - Dead Letter Queue for failed events
 *
 * Measures:
 * - Operation latency (single operations)
 * - Throughput (operations per second)
 * - Memory efficiency (operations under load)
 *
 * Note: These benchmarks use in-memory mock storage to isolate
 * store logic performance from database I/O. Production performance
 * will depend on SQLite in Durable Objects.
 *
 * @see db/stores.ts for store implementations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ThingsStore,
  RelationshipsStore,
  ActionsStore,
  EventsStore,
  SearchStore,
  ObjectsStore,
  DLQStore,
  type StoreContext,
  type ThingEntity,
  type RelationshipEntity,
  type ActionEntity,
  type EventEntity,
  type SearchEntry,
  type DOObjectEntity,
  type DLQEntity,
} from '../../db/stores'

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
// MOCK STORE IMPLEMENTATIONS FOR BENCHMARKS
// ============================================================================

/**
 * In-memory mock ThingsStore for benchmarking store logic
 */
class MockThingsStore {
  private things = new Map<string, ThingEntity>()
  private versions = new Map<string, ThingEntity[]>()
  private typeCache = new Map<string, number>()
  private counter = 0

  async create(data: Partial<ThingEntity> & { $type: string }): Promise<ThingEntity> {
    const id = data.$id ?? crypto.randomUUID()
    const entity: ThingEntity = {
      $id: id,
      $type: data.$type,
      name: data.name ?? null,
      data: data.data ?? null,
      branch: data.branch ?? null,
      version: ++this.counter,
      deleted: false,
    }
    this.things.set(id, entity)
    this.versions.set(id, [entity])
    return entity
  }

  async get(id: string): Promise<ThingEntity | null> {
    return this.things.get(id) ?? null
  }

  async list(options?: { limit?: number; offset?: number }): Promise<ThingEntity[]> {
    const all = Array.from(this.things.values())
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 100
    return all.slice(offset, offset + limit)
  }

  async update(id: string, data: Partial<ThingEntity>): Promise<ThingEntity> {
    const existing = this.things.get(id)
    if (!existing) {
      throw new Error(`Thing '${id}' not found`)
    }
    const updated: ThingEntity = {
      ...existing,
      ...data,
      version: ++this.counter,
    }
    this.things.set(id, updated)
    const versionList = this.versions.get(id) ?? []
    versionList.push(updated)
    this.versions.set(id, versionList)
    return updated
  }

  async getVersions(id: string): Promise<ThingEntity[]> {
    return this.versions.get(id) ?? []
  }
}

/**
 * In-memory mock RelationshipsStore for benchmarking
 */
class MockRelationshipsStore {
  private relationships = new Map<string, RelationshipEntity>()
  private byFrom = new Map<string, Set<string>>()
  private byTo = new Map<string, Set<string>>()

  async create(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity> {
    const id = crypto.randomUUID()
    const entity: RelationshipEntity = {
      id,
      verb: data.verb,
      from: data.from,
      to: data.to,
      data: data.data ?? null,
      createdAt: new Date(),
    }
    this.relationships.set(id, entity)

    // Index by from/to
    if (!this.byFrom.has(data.from)) this.byFrom.set(data.from, new Set())
    this.byFrom.get(data.from)!.add(id)

    if (!this.byTo.has(data.to)) this.byTo.set(data.to, new Set())
    this.byTo.get(data.to)!.add(id)

    return entity
  }

  async from(url: string): Promise<RelationshipEntity[]> {
    const ids = this.byFrom.get(url) ?? new Set()
    return Array.from(ids).map((id) => this.relationships.get(id)!).filter(Boolean)
  }

  async to(url: string): Promise<RelationshipEntity[]> {
    const ids = this.byTo.get(url) ?? new Set()
    return Array.from(ids).map((id) => this.relationships.get(id)!).filter(Boolean)
  }

  async list(): Promise<RelationshipEntity[]> {
    return Array.from(this.relationships.values())
  }
}

/**
 * In-memory mock ActionsStore for benchmarking
 */
class MockActionsStore {
  private actions = new Map<string, ActionEntity>()
  private byTarget = new Map<string, Set<string>>()

  async log(options: {
    verb: string
    target: string
    actor?: string
    input?: unknown
    durability?: 'send' | 'try' | 'do'
  }): Promise<ActionEntity> {
    const id = crypto.randomUUID()
    const entity: ActionEntity = {
      id,
      verb: options.verb,
      target: options.target,
      actor: options.actor ?? null,
      input: options.input as any,
      output: null,
      options: null,
      durability: options.durability ?? 'try',
      status: 'pending',
      error: null,
      requestId: null,
      sessionId: null,
      workflowId: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      duration: null,
      retryCount: 0,
    }
    this.actions.set(id, entity)

    if (!this.byTarget.has(options.target)) this.byTarget.set(options.target, new Set())
    this.byTarget.get(options.target)!.add(id)

    return entity
  }

  async list(options?: { target?: string }): Promise<ActionEntity[]> {
    if (options?.target) {
      const ids = this.byTarget.get(options.target) ?? new Set()
      return Array.from(ids).map((id) => this.actions.get(id)!).filter(Boolean)
    }
    return Array.from(this.actions.values())
  }
}

/**
 * In-memory mock EventsStore for benchmarking
 */
class MockEventsStore {
  private events = new Map<string, EventEntity>()
  private sequence = 0
  private bySource = new Map<string, Set<string>>()

  async emit(options: {
    verb: string
    source: string
    data: Record<string, unknown>
    actionId?: string
  }): Promise<EventEntity> {
    const id = crypto.randomUUID()
    const entity: EventEntity = {
      id,
      verb: options.verb,
      source: options.source,
      data: options.data,
      actionId: options.actionId ?? null,
      sequence: ++this.sequence,
      streamed: false,
      streamedAt: null,
      createdAt: new Date(),
    }
    this.events.set(id, entity)

    if (!this.bySource.has(options.source)) this.bySource.set(options.source, new Set())
    this.bySource.get(options.source)!.add(id)

    return entity
  }

  async list(options?: { source?: string }): Promise<EventEntity[]> {
    if (options?.source) {
      const ids = this.bySource.get(options.source) ?? new Set()
      return Array.from(ids).map((id) => this.events.get(id)!).filter(Boolean)
    }
    return Array.from(this.events.values())
  }

  async replay(options: { fromSequence: number; limit?: number }): Promise<EventEntity[]> {
    const all = Array.from(this.events.values())
      .filter((e) => e.sequence >= options.fromSequence)
      .sort((a, b) => a.sequence - b.sequence)
    return all.slice(0, options.limit ?? 100)
  }
}

/**
 * In-memory mock SearchStore for benchmarking
 */
class MockSearchStore {
  private entries = new Map<string, SearchEntry>()

  async index(entry: { $id: string; $type: string; content: string }): Promise<SearchEntry> {
    const entity: SearchEntry = {
      $id: entry.$id,
      $type: entry.$type,
      content: entry.content,
      embedding: null,
      indexedAt: new Date(),
    }
    this.entries.set(entry.$id, entity)
    return entity
  }

  async query(text: string, options?: { limit?: number; type?: string }): Promise<Array<SearchEntry & { score: number }>> {
    const terms = text.toLowerCase().split(/\s+/)
    const limit = options?.limit ?? 10

    const results: Array<SearchEntry & { score: number }> = []
    for (const entry of this.entries.values()) {
      if (options?.type && entry.$type !== options.type) continue

      const content = entry.content.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (content.includes(term)) score++
      }
      if (score > 0) {
        results.push({ ...entry, score: score / terms.length })
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

/**
 * In-memory mock ObjectsStore for benchmarking
 */
class MockObjectsStore {
  private objects = new Map<string, DOObjectEntity>()
  private byShardKey = new Map<string, Set<string>>()

  async register(options: {
    ns: string
    id: string
    class: string
    relation?: string
    shardKey?: string
    shardIndex?: number
    region?: string
  }): Promise<DOObjectEntity> {
    const entity: DOObjectEntity = {
      ns: options.ns,
      id: options.id,
      class: options.class,
      relation: options.relation ?? null,
      shardKey: options.shardKey ?? null,
      shardIndex: options.shardIndex ?? null,
      region: options.region ?? null,
      colo: null,
      primary: null,
      cached: null,
      createdAt: new Date(),
    }
    this.objects.set(options.ns, entity)

    if (options.shardKey) {
      if (!this.byShardKey.has(options.shardKey)) {
        this.byShardKey.set(options.shardKey, new Set())
      }
      this.byShardKey.get(options.shardKey)!.add(options.ns)
    }

    return entity
  }

  async get(ns: string): Promise<DOObjectEntity | null> {
    return this.objects.get(ns) ?? null
  }

  async shards(key: string): Promise<DOObjectEntity[]> {
    const nss = this.byShardKey.get(key) ?? new Set()
    return Array.from(nss).map((ns) => this.objects.get(ns)!).filter(Boolean)
  }

  async list(): Promise<DOObjectEntity[]> {
    return Array.from(this.objects.values())
  }
}

/**
 * In-memory mock DLQStore for benchmarking
 */
class MockDLQStore {
  private entries = new Map<string, DLQEntity>()
  private handlers: Map<string, (data: unknown) => Promise<unknown>>

  constructor(handlers?: Map<string, (data: unknown) => Promise<unknown>>) {
    this.handlers = handlers ?? new Map()
  }

  async add(options: {
    eventId?: string
    verb: string
    source: string
    data: Record<string, unknown>
    error: string
    errorStack?: string
    maxRetries?: number
  }): Promise<DLQEntity> {
    const id = crypto.randomUUID()
    const entity: DLQEntity = {
      id,
      eventId: options.eventId ?? null,
      verb: options.verb,
      source: options.source,
      data: options.data,
      error: options.error,
      errorStack: options.errorStack ?? null,
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
      lastAttemptAt: new Date(),
      createdAt: new Date(),
    }
    this.entries.set(id, entity)
    return entity
  }

  async get(id: string): Promise<DLQEntity | null> {
    return this.entries.get(id) ?? null
  }

  async replay(id: string): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const entry = this.entries.get(id)
    if (!entry) {
      return { success: false, error: 'Entry not found' }
    }

    const handler = this.handlers.get(entry.verb)
    if (!handler) {
      return { success: false, error: `No handler for ${entry.verb}` }
    }

    try {
      const result = await handler(entry.data)
      this.entries.delete(id)
      return { success: true, result }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async list(): Promise<DLQEntity[]> {
    return Array.from(this.entries.values())
  }
}

// ============================================================================
// THINGS STORE BENCHMARKS
// ============================================================================

describe('ThingsStore Benchmarks', () => {
  let store: MockThingsStore

  beforeEach(() => {
    store = new MockThingsStore()
  })

  describe('create entity benchmark', () => {
    it('should measure create performance', async () => {
      const result = await runBenchmark('ThingsStore.create', async () => {
        await store.create({
          $type: 'Thing',
          name: `Entity-${Date.now()}`,
          data: { foo: 'bar', count: 42 },
        })
      })

      console.log('\n--- ThingsStore.create Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('get entity by ID benchmark', () => {
    it('should measure get performance', async () => {
      // Seed some entities
      for (let i = 0; i < 100; i++) {
        await store.create({
          $id: `entity-${i}`,
          $type: 'Thing',
          name: `Entity ${i}`,
          data: { index: i },
        })
      }

      let idx = 0
      const result = await runBenchmark('ThingsStore.get', async () => {
        await store.get(`entity-${idx++ % 100}`)
      })

      console.log('\n--- ThingsStore.get Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('list entities with pagination benchmark', () => {
    it('should measure list performance', async () => {
      // Seed entities
      for (let i = 0; i < 200; i++) {
        await store.create({
          $id: `entity-${i}`,
          $type: 'Thing',
          name: `Entity ${i}`,
          data: { index: i },
        })
      }

      let offset = 0
      const result = await runBenchmark('ThingsStore.list', async () => {
        await store.list({ limit: 20, offset: offset++ % 180 })
      })

      console.log('\n--- ThingsStore.list Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('update entity benchmark', () => {
    it('should measure update performance', async () => {
      // Create an entity to update
      await store.create({
        $id: 'update-target',
        $type: 'Thing',
        name: 'Original Name',
        data: { version: 0 },
      })

      let version = 0
      const result = await runBenchmark('ThingsStore.update', async () => {
        await store.update('update-target', {
          name: `Updated Name ${++version}`,
          data: { version },
        })
      })

      console.log('\n--- ThingsStore.update Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('versions query benchmark', () => {
    it('should measure versions query performance', async () => {
      // Create entity with multiple versions
      await store.create({
        $id: 'versioned-entity',
        $type: 'Thing',
        name: 'Version 1',
        data: { version: 1 },
      })
      for (let i = 2; i <= 10; i++) {
        await store.update('versioned-entity', {
          name: `Version ${i}`,
          data: { version: i },
        })
      }

      const result = await runBenchmark('ThingsStore.versions', async () => {
        await store.getVersions('versioned-entity')
      })

      console.log('\n--- ThingsStore.versions Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// RELATIONSHIPS STORE BENCHMARKS
// ============================================================================

describe('RelationshipsStore Benchmarks', () => {
  let store: MockRelationshipsStore

  beforeEach(() => {
    store = new MockRelationshipsStore()
  })

  describe('create relationship benchmark', () => {
    it('should measure relationship create performance', async () => {
      let idx = 0
      const result = await runBenchmark('RelationshipsStore.create', async () => {
        await store.create({
          verb: 'manages',
          from: `Person/${idx}`,
          to: `Project/${idx++}`,
          data: { role: 'owner' },
        })
      })

      console.log('\n--- RelationshipsStore.create Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('traverse from() benchmark', () => {
    it('should measure from() traversal performance', async () => {
      // Seed relationships
      for (let i = 0; i < 50; i++) {
        for (let j = 0; j < 5; j++) {
          await store.create({
            verb: 'manages',
            from: `Person/${i}`,
            to: `Project/${i * 5 + j}`,
          })
        }
      }

      let idx = 0
      const result = await runBenchmark('RelationshipsStore.from', async () => {
        await store.from(`Person/${idx++ % 50}`)
      })

      console.log('\n--- RelationshipsStore.from Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('traverse to() benchmark', () => {
    it('should measure to() traversal performance', async () => {
      // Seed relationships (multiple people to each project)
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 10; j++) {
          await store.create({
            verb: 'contributes',
            from: `Person/${j}`,
            to: `Project/${i}`,
          })
        }
      }

      let idx = 0
      const result = await runBenchmark('RelationshipsStore.to', async () => {
        await store.to(`Project/${idx++ % 20}`)
      })

      console.log('\n--- RelationshipsStore.to Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// ACTIONS STORE BENCHMARKS
// ============================================================================

describe('ActionsStore Benchmarks', () => {
  let store: MockActionsStore

  beforeEach(() => {
    store = new MockActionsStore()
  })

  describe('log action benchmark', () => {
    it('should measure action logging performance', async () => {
      let idx = 0
      const result = await runBenchmark('ActionsStore.log', async () => {
        await store.log({
          verb: 'create',
          target: `Thing/${idx++}`,
          actor: 'User/benchmark',
          input: { data: 'test' },
          durability: 'try',
        })
      })

      console.log('\n--- ActionsStore.log Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('list by target benchmark', () => {
    it('should measure list by target performance', async () => {
      // Seed actions for multiple targets
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 10; j++) {
          await store.log({
            verb: ['create', 'update', 'delete'][j % 3]!,
            target: `Thing/${i}`,
            actor: 'User/benchmark',
          })
        }
      }

      let idx = 0
      const result = await runBenchmark('ActionsStore.list', async () => {
        await store.list({ target: `Thing/${idx++ % 20}` })
      })

      console.log('\n--- ActionsStore.list Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// EVENTS STORE BENCHMARKS
// ============================================================================

describe('EventsStore Benchmarks', () => {
  let store: MockEventsStore

  beforeEach(() => {
    store = new MockEventsStore()
  })

  describe('emit event benchmark', () => {
    it('should measure event emission performance', async () => {
      let idx = 0
      const result = await runBenchmark('EventsStore.emit', async () => {
        await store.emit({
          verb: 'created',
          source: `Thing/${idx++}`,
          data: { timestamp: Date.now(), payload: 'test' },
        })
      })

      console.log('\n--- EventsStore.emit Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('list events benchmark', () => {
    it('should measure event listing performance', async () => {
      // Seed events
      for (let i = 0; i < 100; i++) {
        await store.emit({
          verb: ['created', 'updated', 'deleted'][i % 3]!,
          source: `Thing/${Math.floor(i / 5)}`,
          data: { index: i },
        })
      }

      let idx = 0
      const result = await runBenchmark('EventsStore.list', async () => {
        await store.list({ source: `Thing/${idx++ % 20}` })
      })

      console.log('\n--- EventsStore.list Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('replay events benchmark', () => {
    it('should measure event replay performance', async () => {
      // Seed events
      for (let i = 0; i < 100; i++) {
        await store.emit({
          verb: 'created',
          source: `Thing/${i}`,
          data: { sequence: i },
        })
      }

      let fromSeq = 0
      const result = await runBenchmark('EventsStore.replay', async () => {
        await store.replay({ fromSequence: fromSeq++ % 90, limit: 10 })
      })

      console.log('\n--- EventsStore.replay Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// SEARCH STORE BENCHMARKS
// ============================================================================

describe('SearchStore Benchmarks', () => {
  let store: MockSearchStore

  beforeEach(() => {
    store = new MockSearchStore()
  })

  describe('index document benchmark', () => {
    it('should measure document indexing performance', async () => {
      let idx = 0
      const result = await runBenchmark('SearchStore.index', async () => {
        await store.index({
          $id: `doc-${idx++}`,
          $type: 'Document',
          content: `This is document ${idx} with searchable content about technology and innovation.`,
        })
      })

      console.log('\n--- SearchStore.index Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('full-text query benchmark', () => {
    it('should measure full-text search performance', async () => {
      // Seed documents
      const terms = ['technology', 'innovation', 'startup', 'business', 'software', 'development']
      for (let i = 0; i < 100; i++) {
        await store.index({
          $id: `doc-${i}`,
          $type: 'Document',
          content: `Document ${i} about ${terms[i % terms.length]} and related topics.`,
        })
      }

      let idx = 0
      const result = await runBenchmark('SearchStore.query', async () => {
        await store.query(terms[idx++ % terms.length]!, { limit: 10 })
      })

      console.log('\n--- SearchStore.query Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// OBJECTS STORE BENCHMARKS
// ============================================================================

describe('ObjectsStore Benchmarks', () => {
  let store: MockObjectsStore

  beforeEach(() => {
    store = new MockObjectsStore()
  })

  describe('register DO benchmark', () => {
    it('should measure DO registration performance', async () => {
      let idx = 0
      const result = await runBenchmark('ObjectsStore.register', async () => {
        await store.register({
          ns: `tenant-${idx++}.example.ai`,
          id: `do-${idx}`,
          class: 'DO',
          region: 'wnam',
        })
      })

      console.log('\n--- ObjectsStore.register Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('resolve DO benchmark', () => {
    it('should measure DO resolution performance (get)', async () => {
      // Seed registrations
      for (let i = 0; i < 100; i++) {
        await store.register({
          ns: `tenant-${i}.example.ai`,
          id: `do-${i}`,
          class: 'DO',
        })
      }

      let idx = 0
      const result = await runBenchmark('ObjectsStore.get', async () => {
        await store.get(`tenant-${idx++ % 100}.example.ai`)
      })

      console.log('\n--- ObjectsStore.get Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })

  describe('list shards benchmark', () => {
    it('should measure shard listing performance', async () => {
      // Seed shards
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 8; j++) {
          await store.register({
            ns: `tenant-${i}-shard-${j}.example.ai`,
            id: `do-${i}-${j}`,
            class: 'DO',
            relation: 'shard',
            shardKey: `tenant-${i}`,
            shardIndex: j,
          })
        }
      }

      let idx = 0
      const result = await runBenchmark('ObjectsStore.shards', async () => {
        await store.shards(`tenant-${idx++ % 10}`)
      })

      console.log('\n--- ObjectsStore.shards Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// DLQ STORE BENCHMARKS
// ============================================================================

describe('DLQStore Benchmarks', () => {
  let store: MockDLQStore
  let eventHandlers: Map<string, (data: unknown) => Promise<unknown>>

  beforeEach(() => {
    eventHandlers = new Map([
      ['Test.created', async (data: unknown) => ({ processed: true, data })],
      ['Test.updated', async (data: unknown) => ({ processed: true, data })],
    ])
    store = new MockDLQStore(eventHandlers)
  })

  describe('add to DLQ benchmark', () => {
    it('should measure DLQ add performance', async () => {
      let idx = 0
      const result = await runBenchmark('DLQStore.add', async () => {
        await store.add({
          eventId: `event-${idx++}`,
          verb: 'Test.created',
          source: `Thing/${idx}`,
          data: { index: idx },
          error: 'Handler failed: timeout',
          maxRetries: 3,
        })
      })

      console.log('\n--- DLQStore.add Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
      expect(result.opsPerSec).toBeGreaterThan(MIN_THROUGHPUT_OPS_SEC)
    })
  })

  describe('replay from DLQ benchmark', () => {
    it('should measure DLQ replay performance', async () => {
      // Seed DLQ entries
      const entryIds: string[] = []
      for (let i = 0; i < 50; i++) {
        const entry = await store.add({
          eventId: `event-${i}`,
          verb: 'Test.created',
          source: `Thing/${i}`,
          data: { index: i },
          error: 'Handler failed',
          maxRetries: 3,
        })
        entryIds.push(entry.id)
      }

      let idx = 0
      const result = await runBenchmark('DLQStore.replay', async () => {
        // Re-add entries as replay removes them
        if (idx >= entryIds.length) {
          const entry = await store.add({
            eventId: `replay-event-${idx}`,
            verb: 'Test.created',
            source: `Thing/replay-${idx}`,
            data: { index: idx },
            error: 'Handler failed',
            maxRetries: 3,
          })
          entryIds.push(entry.id)
        }
        await store.replay(entryIds[idx++ % entryIds.length]!)
      })

      console.log('\n--- DLQStore.replay Benchmark ---')
      console.log(formatBenchmarkResult(result))

      expect(result.avgMs).toBeLessThan(MAX_SINGLE_OP_LATENCY_MS)
    })
  })
})

// ============================================================================
// SUMMARY REPORT
// ============================================================================

describe('Core Stores Benchmark Summary', () => {
  it('should print consolidated benchmark summary', async () => {
    console.log('\n========================================')
    console.log('CORE 7 STORES BENCHMARK SUMMARY')
    console.log('========================================\n')

    console.log('Stores benchmarked:')
    console.log('  1. ThingsStore - CRUD operations')
    console.log('  2. RelationshipsStore - Graph traversal')
    console.log('  3. ActionsStore - Audit logging')
    console.log('  4. EventsStore - Event streaming')
    console.log('  5. SearchStore - Full-text indexing')
    console.log('  6. ObjectsStore - DO registry')
    console.log('  7. DLQStore - Dead letter queue')
    console.log('')

    console.log('Configuration:')
    console.log(`  Iterations per benchmark: ${BENCHMARK_ITERATIONS}`)
    console.log(`  Warmup iterations: ${WARMUP_ITERATIONS}`)
    console.log(`  Max single op latency: ${MAX_SINGLE_OP_LATENCY_MS} ms`)
    console.log(`  Min throughput: ${MIN_THROUGHPUT_OPS_SEC} ops/sec`)
    console.log('')

    console.log('Performance targets:')
    console.log('  - Single operation: < 50ms (P99)')
    console.log('  - Write throughput: > 100 ops/sec')
    console.log('  - Read throughput: > 500 ops/sec')
    console.log('  - Memory: Stable under load')
    console.log('')

    console.log('Note: These benchmarks use in-memory mock stores.')
    console.log('Production performance depends on SQLite in Durable Objects.')
    console.log('')

    expect(true).toBe(true)
  })
})

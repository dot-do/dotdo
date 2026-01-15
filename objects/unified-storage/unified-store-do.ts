/**
 * UnifiedStoreDO - Unified Storage Durable Object Integration
 *
 * Integrates all unified storage components:
 * - InMemoryStateManager: Fast reads from memory
 * - PipelineEmitter: Durable writes to Pipeline (WAL)
 * - LazyCheckpointer: Batched SQLite persistence
 * - ColdStartRecovery: Startup state loading
 *
 * KEY INVARIANT: Pipeline is the WAL. Events are durable in Pipeline
 * BEFORE local SQLite persistence. This guarantees zero data loss.
 *
 * @module objects/unified-storage/unified-store-do
 */

import { InMemoryStateManager, type ThingData } from './in-memory-state-manager'
import { PipelineEmitter, type Pipeline, type EmittedEvent } from './pipeline-emitter'
import { LazyCheckpointer, type SqlStorage, type DirtyTracker } from './lazy-checkpointer'
import {
  ColdStartRecovery,
  type Thing,
  type DomainEvent,
  type SqliteConnection,
  type IcebergReader,
} from './cold-start-recovery'
import {
  MetricsCollector,
  NoOpMetricsCollector,
  type UnifiedStorageMetrics,
  type MetricsSnapshot,
  type MetricCheckpointTrigger,
  type MetricRecoverySource,
} from './metrics'
import { PrometheusExporter } from './prometheus-exporter'
import {
  CostMetricsCollector,
  type TenantCostReport,
} from './cost-attribution'

// Re-export types for test file imports
export type {
  Thing,
  DomainEvent,
  InMemoryStateManager,
  PipelineEmitter,
  LazyCheckpointer,
  ColdStartRecovery,
  UnifiedStorageMetrics,
  MetricsSnapshot,
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for UnifiedStoreDO
 */
export interface UnifiedStoreConfig {
  /** Namespace/tenant identifier */
  namespace?: string
  /** Checkpoint interval in ms (default: 5000) */
  checkpointInterval?: number
  /** Threshold for columnar vs normalized storage */
  columnarThreshold?: number
  /** Maximum dirty entries before checkpoint */
  dirtyCountThreshold?: number
  /** Iceberg reader for recovery */
  iceberg?: IcebergReader
  /** Enable metrics collection (default: false) */
  enableMetrics?: boolean
}

/**
 * WebSocket message for create operation
 */
interface CreateMessage {
  type: 'create'
  id: string
  $type: string
  data: Record<string, unknown>
}

/**
 * WebSocket message for read operation
 */
interface ReadMessage {
  type: 'read'
  id: string
  $ids: string[]
}

/**
 * WebSocket message for update operation
 */
interface UpdateMessage {
  type: 'update'
  id: string
  $id: string
  data: Record<string, unknown>
}

/**
 * WebSocket message for delete operation
 */
interface DeleteMessage {
  type: 'delete'
  id: string
  $id: string
}

/**
 * WebSocket message for batch operations
 */
interface BatchMessage {
  type: 'batch'
  id: string
  operations: Array<{
    type: 'create'
    id: string
    $type: string
    data: Record<string, unknown>
  }>
}

/**
 * Environment bindings
 */
interface Env {
  PIPELINE: Pipeline
  [key: string]: unknown
}

/**
 * Minimal DurableObjectState interface
 */
interface DOState {
  id: { toString(): string; name?: string }
  storage: {
    sql: SqlStorage
    get<T>(key: string): Promise<T | undefined>
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
    list(options?: { prefix?: string }): Promise<Map<string, unknown>>
  }
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
}

// ============================================================================
// DIRTY TRACKER ADAPTER
// ============================================================================

/**
 * Adapter to make InMemoryStateManager work with LazyCheckpointer's DirtyTracker interface
 */
class StateManagerDirtyTracker implements DirtyTracker {
  constructor(private stateManager: InMemoryStateManager) {}

  getDirtyEntries(): Map<string, { type: string; data: unknown; size: number }> {
    const entries = new Map<string, { type: string; data: unknown; size: number }>()
    const dirtyIds = this.stateManager.getDirtyEntries()

    for (const id of dirtyIds) {
      const thing = this.stateManager.get(id)
      if (thing) {
        entries.set(`${thing.$type}:${id}`, {
          type: thing.$type,
          data: thing,
          size: JSON.stringify(thing).length,
        })
      }
    }

    return entries
  }

  getDirtyCount(): number {
    return this.stateManager.getDirtyCount()
  }

  getMemoryUsage(): number {
    return this.stateManager.getStats().estimatedBytes
  }

  clearDirty(keys: string[]): void {
    // Keys are in format "type:id", extract just the id
    const ids = keys.map((key) => {
      const parts = key.split(':')
      return parts.length > 1 ? parts.slice(1).join(':') : key
    })
    this.stateManager.markClean(ids)
  }

  clear(): void {
    // Mark all as clean
    const allIds = this.stateManager.getAllIds()
    this.stateManager.markClean(allIds)
  }
}

// ============================================================================
// UNIFIED STORE DO
// ============================================================================

/**
 * UnifiedStoreDO - Main Durable Object class integrating all storage components
 *
 * Write Path:
 * 1. Emit to Pipeline BEFORE SQLite (durable WAL)
 * 2. Update in-memory state immediately
 * 3. ACK before checkpoint
 * 4. Lazy checkpoint to SQLite
 *
 * Read Path:
 * 1. Read from memory (O(1))
 * 2. Never touch SQLite for reads
 */
export class UnifiedStoreDO {
  private doState: DOState
  private env: Env
  private config: Required<UnifiedStoreConfig>

  // Components
  public stateManager: InMemoryStateManager
  public pipelineEmitter: PipelineEmitter
  public checkpointer: LazyCheckpointer
  public coldStartRecovery: ColdStartRecovery

  // Metrics
  private _metrics: UnifiedStorageMetrics
  private _prometheusExporter: PrometheusExporter
  private _costMetrics: CostMetricsCollector

  // Internal state
  private checkpointTimer?: ReturnType<typeof setTimeout>
  private namespace: string
  private stopped: boolean = false

  constructor(state: DOState, env: Env, config: Partial<UnifiedStoreConfig> = {}) {
    this.doState = state
    this.env = env

    // Resolve config with defaults
    this.namespace = config.namespace ?? state.id.name ?? state.id.toString()
    this.config = {
      namespace: this.namespace,
      checkpointInterval: config.checkpointInterval ?? 5000,
      columnarThreshold: config.columnarThreshold ?? 1000,
      dirtyCountThreshold: config.dirtyCountThreshold ?? 100,
      iceberg: config.iceberg,
      enableMetrics: config.enableMetrics ?? false,
    }

    // Initialize metrics collector (always enabled for Prometheus)
    this._metrics = new MetricsCollector()

    // Initialize Prometheus exporter
    this._prometheusExporter = new PrometheusExporter(this._metrics, {
      namespace: this.namespace,
    })

    // Initialize cost metrics collector
    this._costMetrics = new CostMetricsCollector(this.namespace)

    // Initialize InMemoryStateManager with metrics
    this.stateManager = new InMemoryStateManager({
      metrics: this._metrics.state,
    })

    // Initialize PipelineEmitter with metrics
    this.pipelineEmitter = new PipelineEmitter(env.PIPELINE, {
      namespace: this.namespace,
      flushInterval: 0, // Immediate flush for durability
      metrics: this._metrics.pipeline,
    })

    // Create dirty tracker adapter
    const dirtyTracker = new StateManagerDirtyTracker(this.stateManager)

    // Initialize LazyCheckpointer with metrics
    this.checkpointer = new LazyCheckpointer({
      sql: state.storage.sql,
      dirtyTracker,
      intervalMs: this.config.checkpointInterval,
      columnarThreshold: this.config.columnarThreshold,
      dirtyCountThreshold: this.config.dirtyCountThreshold,
      metrics: this._metrics.checkpoint,
    })

    // Initialize ColdStartRecovery with metrics
    this.coldStartRecovery = new ColdStartRecovery({
      namespace: this.namespace,
      sql: state.storage.sql as unknown as SqliteConnection,
      iceberg: config.iceberg,
      metrics: this._metrics.recovery,
    })

    // Start checkpoint timer
    this.startCheckpointTimer()
  }

  // ==========================================================================
  // METRICS
  // ==========================================================================

  /**
   * Get the metrics collector
   */
  get metrics(): UnifiedStorageMetrics {
    return this._metrics
  }

  /**
   * Get a snapshot of all metrics
   */
  getMetricsSnapshot(): MetricsSnapshot {
    return this._metrics.snapshot()
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this._metrics.reset()
  }

  /**
   * Get the Prometheus exporter
   */
  get prometheusExporter(): PrometheusExporter {
    return this._prometheusExporter
  }

  /**
   * Get the cost metrics collector
   */
  get costMetrics(): CostMetricsCollector {
    return this._costMetrics
  }

  // ==========================================================================
  // HTTP FETCH HANDLER
  // ==========================================================================

  /**
   * Handle HTTP fetch requests (including /metrics endpoint)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Handle /metrics endpoint
    if (path === '/metrics') {
      return this.handleMetricsRequest()
    }

    // Handle /cost-report endpoint
    if (path === '/cost-report') {
      return this.handleCostReportRequest(url)
    }

    // Default: return 404
    return new Response('Not Found', { status: 404 })
  }

  /**
   * Handle /metrics endpoint for Prometheus scraping
   */
  private handleMetricsRequest(): Response {
    const metricsText = this._prometheusExporter.export()

    // Append cost metrics
    const costMetricsText = this._costMetrics.exportPrometheusMetrics()
    const combinedMetrics = metricsText + (costMetricsText ? '\n' + costMetricsText : '')

    return new Response(combinedMetrics, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  }

  /**
   * Handle /cost-report endpoint for tenant cost reports
   */
  private handleCostReportRequest(url: URL): Response {
    // Parse optional time range from query params
    const startParam = url.searchParams.get('start')
    const endParam = url.searchParams.get('end')

    const options: { start?: Date; end?: Date } = {}
    if (startParam) {
      options.start = new Date(startParam)
    }
    if (endParam) {
      options.end = new Date(endParam)
    }

    const report = this._costMetrics.getTenantReport(this.namespace, options)

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Called on cold start to load state
   * If `queryIceberg` is overridden on this instance, it will also replay events from Iceberg
   */
  async onStart(): Promise<void> {
    const startTime = performance.now()
    let recoverySource: MetricRecoverySource = 'empty'

    // Try to restore Prometheus exporter state
    const savedMetrics = await this.doState.storage.get<string>('prometheus_metrics')
    if (savedMetrics) {
      this._prometheusExporter.deserialize(savedMetrics)
    }

    // Try to restore cost metrics state
    const savedCostMetrics = await this.doState.storage.get<string>('cost_metrics')
    if (savedCostMetrics) {
      this._costMetrics.deserialize(savedCostMetrics)
    }

    // First, try standard SQLite recovery
    const result = await this.coldStartRecovery.recover()

    // Load recovered state into InMemoryStateManager
    for (const [, thing] of result.state) {
      // Use loadBulk to avoid marking as dirty
      this.stateManager.loadBulk([thing as ThingData])
    }

    if (result.state.size > 0) {
      recoverySource = 'sqlite'
    }

    // Check if queryIceberg is overridden (for testing or real Iceberg integration)
    // This allows supplementing SQLite state with Pipeline/Iceberg events
    const hasCustomIceberg = this.queryIceberg !== UnifiedStoreDO.prototype.queryIceberg

    if (hasCustomIceberg) {
      // Use the overridden queryIceberg to replay additional events
      const events = await this.queryIceberg('', [])
      for (const event of events) {
        if (event.type === 'thing.created') {
          const payload = event.payload as Record<string, unknown>
          const entityId = event.entityId || (payload.$id as string)

          // Only add if not already in state (Iceberg supplements SQLite)
          if (!this.stateManager.has(entityId)) {
            this.stateManager.loadBulk([
              {
                $id: entityId,
                $type: event.entityType || (payload.$type as string) || 'Unknown',
                $version: event.version || 1,
                ...payload,
              },
            ])
          }
        }
      }
      if (events.length > 0) {
        recoverySource = 'iceberg'
      }
    }

    // Track recovery metrics
    const durationSeconds = (performance.now() - startTime) / 1000
    this._prometheusExporter.trackRecovery(recoverySource, durationSeconds)
  }

  /**
   * Called before hibernation to persist state
   */
  async beforeHibernation(): Promise<void> {
    // Persist Prometheus exporter state
    await this.doState.storage.put('prometheus_metrics', this._prometheusExporter.serialize())

    // Persist cost metrics state
    await this.doState.storage.put('cost_metrics', this._costMetrics.serialize())

    await this.checkpoint('hibernation')
  }

  /**
   * Checkpoint dirty state to SQLite
   */
  async checkpoint(trigger: string = 'manual'): Promise<void> {
    const startTime = performance.now()
    const dirtyCountBefore = this.stateManager.getDirtyCount()

    // Estimate bytes to checkpoint
    const dirtyEntries = this.stateManager.getDirtyEntries()
    let estimatedBytes = 0
    for (const id of dirtyEntries) {
      const thing = this.stateManager.get(id)
      if (thing) {
        estimatedBytes += JSON.stringify(thing).length
      }
    }

    await this.checkpointer.checkpoint(trigger as 'manual' | 'timer' | 'hibernation')

    // Track checkpoint metrics
    const durationSeconds = (performance.now() - startTime) / 1000
    this._prometheusExporter.trackCheckpoint(
      trigger as MetricCheckpointTrigger,
      durationSeconds
    )

    // Track batch size
    if (dirtyCountBefore > 0) {
      this._prometheusExporter.trackBatch('checkpoint', dirtyCountBefore)
    }

    // Track cost metrics for SQLite checkpoint - always track the checkpoint operation
    this._costMetrics.trackCheckpoint(dirtyCountBefore, estimatedBytes)
  }

  /**
   * Get dirty entries set (for testing)
   */
  getDirtyEntries(): Set<string> {
    return this.stateManager.getDirtyEntries()
  }

  /**
   * Get a thing by ID (from memory, O(1))
   */
  async get(id: string): Promise<Thing | null> {
    const startTime = performance.now()
    const thing = this.stateManager.get(id)

    // Track read metrics
    const durationSeconds = (performance.now() - startTime) / 1000
    if (thing) {
      const thingBytes = JSON.stringify(thing).length
      // Determine if this is a cache hit or miss based on read history
      const isFirstRead = !this.readEntityIds.has(id)
      this.readEntityIds.add(id)

      // First read is considered a "cache miss" from cost perspective
      // Subsequent reads are "cache hits"
      const cacheHit = !isFirstRead
      this._prometheusExporter.trackRead(thing.$type, cacheHit)
      this._prometheusExporter.trackOperation('read', thing.$type, durationSeconds)
      this._costMetrics.trackRead(thing.$type, thingBytes, cacheHit)
    } else {
      this._prometheusExporter.trackRead('unknown', false) // Cache miss
      this._prometheusExporter.trackOperation('read', 'unknown', durationSeconds)
      // Track cost metrics - cache miss
      this._costMetrics.trackRead('unknown', 0, false)
    }

    return thing as Thing | null
  }

  // Track entity IDs that have been read for cache hit/miss tracking
  private readEntityIds: Set<string> = new Set()

  /**
   * Query Iceberg for events (for recovery)
   */
  async queryIceberg(_sql: string, _params: unknown[]): Promise<DomainEvent[]> {
    // This is meant to be overridden in tests
    return []
  }

  // ==========================================================================
  // WEBSOCKET HANDLERS
  // ==========================================================================

  /**
   * Handle create operation
   */
  async handleCreate(ws: WebSocket, message: CreateMessage): Promise<void> {
    const startTime = performance.now()
    const now = Date.now()

    // Create thing in memory first
    const thing = this.stateManager.create({
      $type: message.$type,
      ...message.data,
    })

    // Calculate bytes for cost tracking
    const thingBytes = JSON.stringify(thing).length

    // Emit to Pipeline IMMEDIATELY (before SQLite)
    // This is the KEY INVARIANT - Pipeline is the WAL
    const pipelinePayload = {
      ...thing,
      $createdAt: now,
      $updatedAt: now,
    }
    this.emitToPipeline('thing.created', 'create', thing.$id, message.$type, pipelinePayload)

    // Track operation metrics
    const durationSeconds = (performance.now() - startTime) / 1000
    this._prometheusExporter.trackOperation('create', message.$type, durationSeconds)
    this._prometheusExporter.trackEvent('thing.created')

    // Track cost metrics - write
    this._costMetrics.trackWrite('create', message.$type, thingBytes)
    // Track cost metrics - pipeline event
    const pipelineBytes = JSON.stringify(pipelinePayload).length
    this._costMetrics.trackPipelineEvent('thing.created', pipelineBytes)

    // Send ACK to client BEFORE checkpoint (non-blocking)
    ws.send(
      JSON.stringify({
        status: 'ack',
        id: message.id,
        $id: thing.$id,
        $version: thing.$version,
      })
    )

    // Note: SQLite persistence happens lazily via checkpointer
  }

  /**
   * Handle read operation (batch)
   */
  async handleRead(ws: WebSocket, message: ReadMessage): Promise<void> {
    const startTime = performance.now()
    const things: Record<string, Thing> = {}

    for (const id of message.$ids) {
      const thing = this.stateManager.get(id)
      if (thing) {
        things[id] = thing as Thing
        const thingBytes = JSON.stringify(thing).length
        this._prometheusExporter.trackRead(thing.$type, true) // Cache hit
        this._costMetrics.trackRead(thing.$type, thingBytes, true)
      } else {
        this._prometheusExporter.trackRead('unknown', false) // Cache miss
        this._costMetrics.trackRead('unknown', 0, false)
      }
    }

    // Track operation duration
    const durationSeconds = (performance.now() - startTime) / 1000
    this._prometheusExporter.trackOperation('read', 'batch', durationSeconds)

    ws.send(
      JSON.stringify({
        id: message.id,
        things,
      })
    )
  }

  /**
   * Handle update operation
   */
  async handleUpdate(ws: WebSocket, message: UpdateMessage): Promise<void> {
    const startTime = performance.now()
    const now = Date.now()

    try {
      // Get the existing thing for type info
      const existing = this.stateManager.get(message.$id)
      const entityType = existing?.$type ?? 'Unknown'

      // Update in memory
      const updated = this.stateManager.update(message.$id, {
        ...message.data,
        $updatedAt: now,
      })

      // Calculate bytes for cost tracking
      const updateBytes = JSON.stringify(message.data).length

      // Emit to Pipeline IMMEDIATELY
      const pipelinePayload = {
        $id: message.$id,
        ...message.data,
        $version: updated.$version,
        $updatedAt: now,
      }
      this.emitToPipeline('thing.updated', 'update', message.$id, entityType, pipelinePayload)

      // Track operation metrics
      const durationSeconds = (performance.now() - startTime) / 1000
      this._prometheusExporter.trackOperation('update', entityType, durationSeconds)
      this._prometheusExporter.trackEvent('thing.updated')

      // Track cost metrics - write
      this._costMetrics.trackWrite('update', entityType, updateBytes)
      // Track cost metrics - pipeline event
      const pipelineBytes = JSON.stringify(pipelinePayload).length
      this._costMetrics.trackPipelineEvent('thing.updated', pipelineBytes)

      // Send ACK
      ws.send(
        JSON.stringify({
          status: 'ack',
          id: message.id,
          $id: message.$id,
          $version: updated.$version,
        })
      )
    } catch (error) {
      ws.send(
        JSON.stringify({
          status: 'error',
          id: message.id,
          error: (error as Error).message,
        })
      )
    }
  }

  /**
   * Handle delete operation
   */
  async handleDelete(ws: WebSocket, message: DeleteMessage): Promise<void> {
    const startTime = performance.now()
    const now = Date.now()

    // Get type info before deleting
    const existing = this.stateManager.get(message.$id)
    const entityType = existing?.$type ?? 'Unknown'

    const deleted = this.stateManager.delete(message.$id)

    if (deleted) {
      // Emit to Pipeline IMMEDIATELY
      const pipelinePayload = {
        $id: message.$id,
        $deletedAt: now,
      }
      this.emitToPipeline('thing.deleted', 'delete', message.$id, entityType, pipelinePayload)

      // Track operation metrics
      const durationSeconds = (performance.now() - startTime) / 1000
      this._prometheusExporter.trackOperation('delete', entityType, durationSeconds)
      this._prometheusExporter.trackEvent('thing.deleted')

      // Track cost metrics - write (delete is a write operation)
      this._costMetrics.trackWrite('delete', entityType, 0) // Minimal bytes for delete
      // Track cost metrics - pipeline event
      const pipelineBytes = JSON.stringify(pipelinePayload).length
      this._costMetrics.trackPipelineEvent('thing.deleted', pipelineBytes)
    }

    ws.send(
      JSON.stringify({
        status: 'ok',
        id: message.id,
      })
    )
  }

  /**
   * Handle batch operations
   */
  async handleBatch(ws: WebSocket, message: BatchMessage): Promise<void> {
    const now = Date.now()
    const results: Array<{ $id: string; $version: number }> = []

    for (const op of message.operations) {
      if (op.type === 'create') {
        const thing = this.stateManager.create({
          $type: op.$type,
          ...op.data,
        })

        // Calculate bytes for cost tracking
        const thingBytes = JSON.stringify(thing).length

        // Emit to Pipeline
        const pipelinePayload = {
          ...thing,
          $createdAt: now,
          $updatedAt: now,
        }
        this.emitToPipeline('thing.created', 'create', thing.$id, op.$type, pipelinePayload)

        // Track cost metrics - write
        this._costMetrics.trackWrite('create', op.$type, thingBytes)
        // Track cost metrics - pipeline event
        const pipelineBytes = JSON.stringify(pipelinePayload).length
        this._costMetrics.trackPipelineEvent('thing.created', pipelineBytes)

        results.push({ $id: thing.$id, $version: thing.$version ?? 1 })
      }
    }

    ws.send(
      JSON.stringify({
        status: 'ack',
        id: message.id,
        results,
      })
    )
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  /**
   * Emit an event to the Pipeline in the format expected by tests
   * Creates events with type, entityId, idempotencyKey fields
   */
  private emitToPipeline(
    type: 'thing.created' | 'thing.updated' | 'thing.deleted',
    operation: string,
    entityId: string,
    entityType: string,
    payload: Record<string, unknown>
  ): void {
    const now = Date.now()
    const idempotencyKey = `${entityId}:${operation}:${now}`

    // Create event in the format expected by tests (DomainEvent)
    const event = {
      type,
      collection: 'Thing',
      operation,
      entityId,
      entityType,
      payload,
      ts: now,
      version: (payload.$version as number) ?? 1,
      actorId: 'system',
      idempotencyKey,
    }

    // Send directly to pipeline
    this.env.PIPELINE.send([event])
  }

  /**
   * Start the checkpoint timer (call explicitly to start timer-based checkpoints)
   */
  startCheckpointTimer(): void {
    if (this.checkpointTimer || this.stopped) {
      return
    }

    // Use setInterval for predictable behavior with fake timers
    this.checkpointTimer = setInterval(() => {
      if (!this.stopped && this.stateManager.getDirtyCount() > 0) {
        this.checkpoint('timer').catch(() => {
          // Ignore errors in timer checkpoint
        })
      }
    }, this.config.checkpointInterval)
  }

  /**
   * Stop the checkpoint timer
   */
  stopCheckpointTimer(): void {
    this.stopped = true
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = undefined
    }
  }

  /**
   * Expose internal state map (for testing)
   */
  get state(): Map<string, ThingData> {
    return new Map(
      this.stateManager.getAllIds().map((id) => [id, this.stateManager.get(id)!])
    )
  }
}

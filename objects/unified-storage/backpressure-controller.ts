/**
 * BackpressureController - End-to-End Backpressure Coordination
 *
 * Coordinates backpressure signals across the unified storage system:
 * - Monitors PipelineEmitter retry queue depth
 * - Monitors memory usage via optional memory monitor
 * - Calculates backpressure severity based on utilization
 * - Broadcasts backpressure signals to WebSocket clients
 * - Tracks metrics for observability
 *
 * @example
 * ```typescript
 * const controller = new BackpressureController({
 *   pipelineEmitter: emitter,
 *   broadcaster: wsBroadcaster,
 *   memoryThreshold: 0.8,
 *   queueThreshold: 0.8,
 * })
 *
 * // Check current status
 * if (controller.isActive) {
 *   console.log('Backpressure active:', controller.status)
 * }
 *
 * // Get metrics
 * const metrics = controller.getMetrics()
 * console.log('Episodes:', metrics.episodeCount)
 *
 * // Clean up
 * await controller.close()
 * ```
 *
 * @module objects/unified-storage/backpressure-controller
 */

import type { PipelineEmitter, BackpressureChangeCallback } from './pipeline-emitter'
import type { WSBroadcaster } from './ws-broadcaster'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Backpressure status communicated to clients
 */
export interface BackpressureStatus {
  /** Whether backpressure is currently active */
  active: boolean
  /** Source of backpressure */
  source: 'pipeline' | 'memory' | 'queue' | 'external'
  /** Severity level (0-1, 1 = severe) */
  severity: number
  /** Recommended action for client */
  action: 'continue' | 'slow-down' | 'pause'
  /** Estimated time until pressure relieved (ms) */
  estimatedRecoveryMs?: number
}

/**
 * Backpressure metrics for observability
 */
export interface BackpressureMetrics {
  /** Current backpressure state */
  isActive: boolean
  /** Duration of current backpressure episode (ms) */
  currentDurationMs: number
  /** Total time spent in backpressure state (ms) */
  totalBackpressureMs: number
  /** Number of backpressure episodes */
  episodeCount: number
  /** Events rejected due to backpressure */
  rejectedCount: number
  /** Events delayed due to backpressure */
  delayedCount: number
  /** Current queue utilization (0-1) */
  queueUtilization: number
  /** Current memory utilization (0-1) */
  memoryUtilization: number
}

/**
 * Backpressure signal sent to WebSocket clients
 */
export interface BackpressureSignal {
  type: 'backpressure'
  status: BackpressureStatus
  ts: number
}

/**
 * Memory monitor interface for memory pressure detection
 */
export interface MemoryMonitor {
  getCurrentUsage(): number
  getThreshold(): number
  isUnderPressure(): boolean
}

/**
 * Configuration for BackpressureController
 */
export interface BackpressureControllerConfig {
  /** Pipeline emitter to monitor (required) */
  pipelineEmitter?: PipelineEmitter
  /** WebSocket broadcaster for signals */
  broadcaster?: WSBroadcaster
  /** Memory monitor for memory pressure */
  memoryMonitor?: MemoryMonitor
  /** Memory threshold (0-1) to trigger backpressure */
  memoryThreshold?: number
  /** Queue utilization threshold (0-1) to trigger backpressure */
  queueThreshold?: number
  /** Polling interval for memory checks (ms) */
  pollIntervalMs?: number
  /** Minimum severity to broadcast signals */
  minBroadcastSeverity?: number
}

/**
 * Status change listener callback
 */
export type StatusChangeListener = (status: BackpressureStatus) => void

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG = {
  memoryThreshold: 0.8,
  queueThreshold: 0.8,
  pollIntervalMs: 100, // Faster polling for responsiveness
  minBroadcastSeverity: 0,
} as const

// ============================================================================
// BACKPRESSURE CONTROLLER
// ============================================================================

/**
 * BackpressureController - Coordinates end-to-end backpressure
 *
 * This class monitors various sources of pressure (pipeline queue, memory)
 * and coordinates backpressure signals across the system. It:
 *
 * - Listens to PipelineEmitter backpressure callbacks
 * - Polls memory usage via MemoryMonitor
 * - Calculates severity based on utilization
 * - Broadcasts BackpressureSignals to WebSocket clients
 * - Tracks metrics for observability
 */
export class BackpressureController {
  private readonly config: Required<
    Omit<BackpressureControllerConfig, 'pipelineEmitter' | 'broadcaster' | 'memoryMonitor'>
  > & {
    pipelineEmitter?: PipelineEmitter
    broadcaster?: WSBroadcaster
    memoryMonitor?: MemoryMonitor
  }

  private _isActive = false
  private _status: BackpressureStatus = {
    active: false,
    source: 'pipeline',
    severity: 0,
    action: 'continue',
  }

  // Track pressure from different sources
  private _pipelinePressure = false
  private _memoryPressure = false
  private _memorySeverity = 0

  // Metrics tracking
  private _episodeCount = 0
  private _currentEpisodeStart?: number
  private _totalBackpressureMs = 0
  private _rejectedCount = 0
  private _delayedCount = 0
  private _queueUtilization = 0
  private _memoryUtilization = 0

  // Listeners
  private _statusListeners: StatusChangeListener[] = []

  // Timers
  private _pollTimer?: ReturnType<typeof setInterval>
  private _closed = false

  // Track if we need to broadcast (state changed but hasn't been broadcast yet)
  private _needsBroadcast = false

  constructor(config: BackpressureControllerConfig) {
    this.config = {
      pipelineEmitter: config.pipelineEmitter,
      broadcaster: config.broadcaster,
      memoryMonitor: config.memoryMonitor,
      memoryThreshold: config.memoryThreshold ?? DEFAULT_CONFIG.memoryThreshold,
      queueThreshold: config.queueThreshold ?? DEFAULT_CONFIG.queueThreshold,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_CONFIG.pollIntervalMs,
      minBroadcastSeverity: config.minBroadcastSeverity ?? DEFAULT_CONFIG.minBroadcastSeverity,
    }

    // Check initial state
    this.checkAllSources()

    // Start polling for state changes
    this.startPolling()
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Check if backpressure is currently active
   */
  get isActive(): boolean {
    // Synchronously check current state before returning
    this.checkAllSourcesSync()
    return this._isActive
  }

  /**
   * Get current backpressure status
   */
  get status(): BackpressureStatus {
    // Synchronously check current state before returning
    this.checkAllSourcesSync()
    return { ...this._status }
  }

  /**
   * Get backpressure metrics
   */
  getMetrics(): BackpressureMetrics {
    // Ensure we have latest state
    this.checkAllSources()

    const now = Date.now()
    const currentDuration = this._currentEpisodeStart ? now - this._currentEpisodeStart : 0

    return {
      isActive: this._isActive,
      currentDurationMs: currentDuration,
      totalBackpressureMs: this._totalBackpressureMs + currentDuration,
      episodeCount: this._episodeCount,
      rejectedCount: this._rejectedCount,
      delayedCount: this._delayedCount,
      queueUtilization: this._queueUtilization,
      memoryUtilization: this._memoryUtilization,
    }
  }

  /**
   * Register a status change listener
   */
  onStatusChange(listener: StatusChangeListener): void {
    this._statusListeners.push(listener)
  }

  /**
   * Apply backpressure from external source
   */
  applyBackpressure(source: BackpressureStatus['source'], severity: number): void {
    if (source === 'memory') {
      this._memoryPressure = true
      this._memorySeverity = severity
    } else if (source === 'pipeline') {
      this._pipelinePressure = true
    }

    this.updateStatus()
  }

  /**
   * Release backpressure from a source
   */
  releaseBackpressure(source: BackpressureStatus['source']): void {
    if (source === 'memory') {
      this._memoryPressure = false
      this._memorySeverity = 0
    } else if (source === 'pipeline') {
      this._pipelinePressure = false
    }

    this.updateStatus()
  }

  /**
   * Check if an operation should be rejected due to backpressure
   */
  shouldReject(): boolean {
    this.checkAllSources()
    // Reject when at high severity
    return this._isActive && this._status.severity >= 0.9
  }

  /**
   * Get recommended delay for client operations (ms)
   */
  getRecommendedDelayMs(): number {
    this.checkAllSources()

    if (!this._isActive) {
      return 0
    }

    // Scale delay based on severity
    // At 0.5 severity: 100ms, at 1.0 severity: 1000ms
    const baseDelay = 100
    const maxDelay = 1000
    return Math.round(baseDelay + (maxDelay - baseDelay) * this._status.severity)
  }

  /**
   * Increment rejected count (called when events are rejected)
   */
  incrementRejected(): void {
    this._rejectedCount++
  }

  /**
   * Increment delayed count (called when events are delayed)
   */
  incrementDelayed(): void {
    this._delayedCount++
  }

  /**
   * Close the controller and clean up resources
   */
  async close(): Promise<void> {
    if (this._closed) return

    this._closed = true

    // Stop polling
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = undefined
    }

    // Clear listeners
    this._statusListeners = []
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Start polling for state changes
   */
  private startPolling(): void {
    if (this._closed) return

    this._pollTimer = setInterval(() => {
      this.checkAllSources()

      // If state was updated from a sync check, broadcast now
      if (this._needsBroadcast) {
        this.broadcastStatus()
        this._needsBroadcast = false
      }
    }, this.config.pollIntervalMs)
  }

  /**
   * Synchronously check all pressure sources and update state
   * This is called from getters to ensure current state is returned
   */
  private checkAllSourcesSync(): void {
    if (this._closed) return

    const wasActive = this._isActive
    const wasPipelinePressure = this._pipelinePressure
    const wasMemoryPressure = this._memoryPressure

    // Check pipeline emitter state
    if (this.config.pipelineEmitter) {
      const emitter = this.config.pipelineEmitter

      // Pipeline pressure is active if either:
      // 1. Retry queue is at capacity (isBackpressured)
      // 2. System is in degraded mode (failures occurring)
      this._pipelinePressure = emitter.isBackpressured || emitter.isDegraded

      // Track queue utilization for metrics
      const queueMetrics = emitter.getRetryQueueMetrics()
      this._queueUtilization =
        queueMetrics.maxSize > 0 && queueMetrics.maxSize !== Infinity
          ? queueMetrics.size / queueMetrics.maxSize
          : 0

      // Track delayed events (events in retry queue + failed events)
      if (queueMetrics.size > 0 || emitter.failedEvents.length > 0) {
        this._delayedCount = queueMetrics.size + emitter.failedEvents.length
      }
    }

    // Check memory state
    if (this.config.memoryMonitor) {
      const monitor = this.config.memoryMonitor
      const currentUsage = monitor.getCurrentUsage()
      this._memoryUtilization = currentUsage

      const threshold = this.config.memoryThreshold

      if (currentUsage >= threshold) {
        this._memoryPressure = true
        // Severity maps the excess usage to 0-1 range
        // At threshold: 0, at 100%: 1
        this._memorySeverity = Math.min(1, (currentUsage - threshold) / (1.0 - threshold))
      } else {
        this._memoryPressure = false
        this._memorySeverity = 0
      }
    }

    // Update status (always, to ensure status reflects current state)
    this.updateStatusInternal(false) // Don't broadcast from sync check
  }

  /**
   * Check all pressure sources and update state (called from poll timer)
   */
  private checkAllSources(): void {
    if (this._closed) return

    const wasActive = this._isActive
    const wasPipelinePressure = this._pipelinePressure
    const wasMemoryPressure = this._memoryPressure

    // Check pipeline emitter state
    if (this.config.pipelineEmitter) {
      const emitter = this.config.pipelineEmitter

      // Pipeline pressure is active if either:
      // 1. Retry queue is at capacity (isBackpressured)
      // 2. System is in degraded mode (failures occurring)
      this._pipelinePressure = emitter.isBackpressured || emitter.isDegraded

      // Track queue utilization for metrics
      const queueMetrics = emitter.getRetryQueueMetrics()
      this._queueUtilization =
        queueMetrics.maxSize > 0 && queueMetrics.maxSize !== Infinity
          ? queueMetrics.size / queueMetrics.maxSize
          : 0

      // Track delayed events (events in retry queue + failed events)
      if (queueMetrics.size > 0 || emitter.failedEvents.length > 0) {
        this._delayedCount = queueMetrics.size + emitter.failedEvents.length
      }
    }

    // Check memory state
    if (this.config.memoryMonitor) {
      const monitor = this.config.memoryMonitor
      const currentUsage = monitor.getCurrentUsage()
      this._memoryUtilization = currentUsage

      const threshold = this.config.memoryThreshold

      if (currentUsage >= threshold) {
        this._memoryPressure = true
        // Severity maps the excess usage to 0-1 range
        // At threshold: 0, at 100%: 1
        this._memorySeverity = Math.min(1, (currentUsage - threshold) / (1.0 - threshold))
      } else {
        this._memoryPressure = false
        this._memorySeverity = 0
      }
    }

    // Determine if backpressure should be active
    const shouldBeActive = this._pipelinePressure || this._memoryPressure

    // Update status if anything changed (including severity changes)
    if (
      wasPipelinePressure !== this._pipelinePressure ||
      wasMemoryPressure !== this._memoryPressure ||
      wasActive !== shouldBeActive ||
      (this._memoryPressure && this._memorySeverity !== this._status.severity)
    ) {
      this.updateStatus()
    }
  }

  /**
   * Update the overall backpressure status based on all sources
   */
  private updateStatus(): void {
    this.updateStatusInternal(true)
  }

  /**
   * Internal status update with optional broadcasting
   */
  private updateStatusInternal(broadcast: boolean): void {
    const wasActive = this._isActive

    // Determine if backpressure should be active
    this._isActive = this._pipelinePressure || this._memoryPressure

    // Determine primary source and severity
    let source: BackpressureStatus['source'] = 'pipeline'
    let severity = 0

    if (this._memoryPressure) {
      source = 'memory'
      severity = this._memorySeverity
    }

    if (this._pipelinePressure) {
      // Pipeline backpressure severity depends on the state:
      // - If queue is at capacity (isBackpressured): severity based on utilization, min 0.5
      // - If just degraded (failures but queue not full): lower severity (0.3-0.5)
      const emitter = this.config.pipelineEmitter
      let pipelineSeverity = 0.5

      if (emitter) {
        if (emitter.isBackpressured) {
          // Queue at capacity - higher severity
          pipelineSeverity = Math.max(0.5, this._queueUtilization)
        } else if (emitter.isDegraded) {
          // Just degraded (failures occurring) - moderate severity
          // Use 0.3-0.5 range based on consecutive failures or queue size
          const queueMetrics = emitter.getRetryQueueMetrics()
          pipelineSeverity = 0.3 + Math.min(0.2, queueMetrics.size * 0.05)
        }
      }

      // Use pipeline as source if it has higher severity or memory isn't active
      if (!this._memoryPressure || pipelineSeverity > severity) {
        source = 'pipeline'
        severity = pipelineSeverity
      }
    }

    // Determine action based on severity
    let action: BackpressureStatus['action'] = 'continue'
    if (this._isActive) {
      if (severity >= 0.7) {
        action = 'pause'
      } else {
        action = 'slow-down'
      }
    }

    // Calculate estimated recovery time
    let estimatedRecoveryMs: number | undefined
    if (this._isActive && this.config.pipelineEmitter) {
      const queueMetrics = this.config.pipelineEmitter.getRetryQueueMetrics()
      const retryDelay = this.config.pipelineEmitter.config.retryDelay
      // Rough estimate: queue size * retry delay
      if (queueMetrics.size > 0) {
        estimatedRecoveryMs = queueMetrics.size * retryDelay
      }
    }

    // Update status
    this._status = {
      active: this._isActive,
      source,
      severity,
      action,
      estimatedRecoveryMs,
    }

    // Track episode metrics
    const now = Date.now()
    if (!wasActive && this._isActive) {
      // Starting new episode
      this._episodeCount++
      this._currentEpisodeStart = now
    } else if (wasActive && !this._isActive) {
      // Ending episode
      if (this._currentEpisodeStart) {
        this._totalBackpressureMs += now - this._currentEpisodeStart
        this._currentEpisodeStart = undefined
      }
    }

    // Notify listeners
    for (const listener of this._statusListeners) {
      try {
        listener({ ...this._status })
      } catch {
        // Ignore listener errors
      }
    }

    // Mark that we need to broadcast the new state
    this._needsBroadcast = true

    // Broadcast to WebSocket clients (only if requested)
    if (broadcast) {
      this.broadcastStatus()
      this._needsBroadcast = false
    }
  }

  /**
   * Broadcast backpressure status to WebSocket clients
   */
  private broadcastStatus(): void {
    if (!this.config.broadcaster) return

    const signal: BackpressureSignal = {
      type: 'backpressure',
      status: { ...this._status },
      ts: Date.now(),
    }

    // Broadcast to all connected clients
    this.broadcastSignalToClients(signal)
  }

  /**
   * Broadcast signal to all connected WebSocket clients
   * This accesses the broadcaster's internal client map to send backpressure signals
   */
  private broadcastSignalToClients(signal: BackpressureSignal): void {
    if (!this.config.broadcaster) return

    // Access internal clients map via type assertion
    // This is necessary because WSBroadcaster is designed for domain events
    const broadcaster = this.config.broadcaster as unknown as {
      clients: Map<WebSocket, { ws: WebSocket; messageQueue: string[] }>
    }

    if (!broadcaster.clients) return

    const message = JSON.stringify(signal)

    for (const [ws] of broadcaster.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          // Use the async send method
          const wsAny = ws as unknown as { send(msg: string): Promise<void> | void }
          const result = wsAny.send(message)
          // Don't await - fire and forget for backpressure signals
          if (result instanceof Promise) {
            result.catch(() => {
              // Ignore send errors for backpressure signals
            })
          }
        } catch {
          // Ignore send errors for backpressure signals
        }
      }
    }
  }
}

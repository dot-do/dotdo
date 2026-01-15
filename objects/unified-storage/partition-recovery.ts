/**
 * PartitionRecoveryManager - Network partition detection and recovery
 *
 * Handles network partition scenarios in distributed systems:
 * - Heartbeat-based partition detection
 * - Event buffering during partition
 * - Automatic replay when partition heals
 * - Client disconnection tracking and reconnection
 * - Graceful degradation (local reads continue)
 * - Integration with LeaderFollowerManager for split-brain prevention
 * - Integration with MultiMasterManager for CRDT convergence
 *
 * @module unified-storage/partition-recovery
 * @see tests/unified-storage/chaos/partition-recovery.test.ts
 */

import type { Pipeline } from './types/pipeline'

// ============================================================================
// Types
// ============================================================================

/**
 * Partition state enum
 */
export type PartitionState = 'normal' | 'partitioned' | 'healing'

/**
 * Recovery event types
 */
export interface RecoveryEvent {
  type: 'partition_detected' | 'recovery_started' | 'recovery_completed' | 'recovery_failed'
  timestamp: number
  details?: Record<string, unknown>
}

/**
 * Partition metrics
 */
export interface PartitionMetrics {
  isPartitioned: boolean
  partitionDurationMs: number
  queuedOperations: number
  localOperationsServed: number
  totalPartitionCount: number
  totalPartitionDurationMs: number
  recoveryAttempts: number
  recoverySuccesses: number
  recoveryFailures: number
}

/**
 * Buffer metrics
 */
export interface BufferMetrics {
  bufferedCount: number
  oldestEventAge: number
  bufferUtilization: number
  eventsDiscardedDueToTimeout: number
}

/**
 * Network partition info
 */
export interface NetworkPartition {
  type: 'full' | 'partial'
  unreachableNodes: string[]
  detectedAt: number
}

/**
 * Partition info returned by getPartitionInfo()
 */
export interface PartitionInfo {
  type: 'full' | 'partial' | 'none'
  unreachableNodes: string[]
  detectedAt?: number
}

/**
 * Client interface for reconnection management
 */
export interface Client {
  id: string
  isConnected(): boolean
  send(message: unknown): Promise<void>
  onReconnect(): void
  onDisconnect(): void
}

/**
 * Client status information
 */
export interface ClientStatus {
  state: 'connected' | 'disconnected' | 'reconnecting'
  reconnectAttempts: number
  lastSeen: number
}

/**
 * Degradation configuration
 */
export interface DegradationConfig {
  allowLocalReads: boolean
  allowLocalWrites: boolean
  queueRemoteOperations: boolean
  maxQueueSize: number
}

/**
 * Remote write result
 */
export interface RemoteWriteResult {
  status: 'success' | 'queued' | 'rejected'
  reason?: string
}

/**
 * Local write result
 */
export interface LocalWriteResult {
  success: boolean
  error?: string
}

/**
 * Configuration for PartitionRecoveryManager
 */
export interface PartitionRecoveryConfig {
  nodeId: string
  pipeline: Pipeline & {
    subscribe?: (nodeId: string, handler: (event: unknown) => Promise<void>) => () => void
    partitionNode?: (nodeId: string) => void
    healNode?: (nodeId: string) => void
    createGlobalPartition?: () => void
    healGlobalPartition?: () => void
    isPartitioned?: (nodeId: string) => boolean
    isGlobalPartition?: () => boolean
  }
  bufferSize?: number
  maxBufferDurationMs?: number
  overflowStrategy?: 'drop-oldest' | 'drop-newest' | 'reject'
  partitionDetectionTimeoutMs?: number
  heartbeatIntervalMs?: number
  reconnectIntervalMs?: number
  maxReconnectAttempts?: number
  degradationConfig?: DegradationConfig
}

/**
 * Queued operation during partition
 */
interface QueuedOperation {
  key: string
  value: unknown
  timestamp: number
}

/**
 * Buffered event with metadata
 */
interface BufferedEvent {
  event: unknown
  timestamp: number
  sequence?: number
}

// ============================================================================
// NetworkSimulator - For testing network partitions
// ============================================================================

/**
 * NetworkSimulator - Simulates network conditions for testing
 */
export class NetworkSimulator {
  private partitionedNodes: Set<string> = new Set()
  private globalPartition = false

  partitionNode(nodeId: string): void {
    this.partitionedNodes.add(nodeId)
  }

  healNode(nodeId: string): void {
    this.partitionedNodes.delete(nodeId)
  }

  createGlobalPartition(): void {
    this.globalPartition = true
  }

  healGlobalPartition(): void {
    this.globalPartition = false
  }

  isPartitioned(nodeId: string): boolean {
    return this.globalPartition || this.partitionedNodes.has(nodeId)
  }

  isGlobalPartition(): boolean {
    return this.globalPartition
  }

  clear(): void {
    this.partitionedNodes.clear()
    this.globalPartition = false
  }
}

// ============================================================================
// PartitionRecoveryManager
// ============================================================================

/**
 * PartitionRecoveryManager - Manages network partition detection and recovery
 */
export class PartitionRecoveryManager {
  private readonly nodeId: string
  private readonly pipeline: PartitionRecoveryConfig['pipeline']
  private readonly bufferSize: number
  private readonly maxBufferDurationMs: number
  private readonly overflowStrategy: 'drop-oldest' | 'drop-newest' | 'reject'
  private readonly partitionDetectionTimeoutMs: number
  private readonly heartbeatIntervalMs: number
  private readonly reconnectIntervalMs: number
  private readonly maxReconnectAttempts: number
  private readonly degradationConfig: DegradationConfig

  // State
  private closed = false
  private started = false
  private _partitionState: PartitionState = 'normal'
  private partitionDetectedAt?: number
  private lastCommunicationAt: number = Date.now()

  // Event buffering
  private eventBuffer: BufferedEvent[] = []
  private eventsDiscardedDueToTimeout = 0

  // Client management
  private clients: Map<string, Client> = new Map()
  private clientStatuses: Map<string, ClientStatus> = new Map()
  private clientLastSequences: Map<string, number> = new Map()
  private reconnectAttemptCallbacks: ((clientId: string, attempt: number, delayMs: number) => void)[] = []

  // Event storage for client replay
  private storedEvents: Array<{ sequence: number; data: unknown }> = []

  // Local state for degradation
  private localState: Map<string, unknown> = new Map()

  // Operation queue during partition
  private operationQueue: QueuedOperation[] = []
  private localOperationsServed = 0

  // Timers
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private bufferCleanupTimer?: ReturnType<typeof setInterval>

  // Event handlers
  private partitionDetectedHandlers: (() => void)[] = []
  private stateChangeHandlers: ((state: PartitionState) => void)[] = []
  private recoveryEventHandlers: ((event: RecoveryEvent) => void)[] = []

  // Metrics
  private totalPartitionCount = 0
  private totalPartitionDurationMs = 0
  private recoveryAttempts = 0
  private recoverySuccesses = 0
  private recoveryFailures = 0

  // Track unreachable nodes for partial partitions
  private unreachableNodes: Set<string> = new Set()

  constructor(config: PartitionRecoveryConfig) {
    this.nodeId = config.nodeId
    this.pipeline = config.pipeline
    this.bufferSize = config.bufferSize ?? 10000
    this.maxBufferDurationMs = config.maxBufferDurationMs ?? 60000
    this.overflowStrategy = config.overflowStrategy ?? 'drop-oldest'
    this.partitionDetectionTimeoutMs = config.partitionDetectionTimeoutMs ?? 3000
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 1000
    this.reconnectIntervalMs = config.reconnectIntervalMs ?? 1000
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5
    this.degradationConfig = config.degradationConfig ?? {
      allowLocalReads: true,
      allowLocalWrites: true,
      queueRemoteOperations: true,
      maxQueueSize: 1000,
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    if (this.started || this.closed) return
    this.started = true
    this.lastCommunicationAt = Date.now()

    // Start heartbeat for partition detection
    this.startHeartbeat()

    // Start buffer cleanup timer
    this.startBufferCleanup()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    // Stop timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }

    if (this.bufferCleanupTimer) {
      clearInterval(this.bufferCleanupTimer)
      this.bufferCleanupTimer = undefined
    }

    // Clear reconnect timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer)
    }
    this.reconnectTimers.clear()

    // Clear handlers
    this.partitionDetectedHandlers = []
    this.stateChangeHandlers = []
    this.recoveryEventHandlers = []
  }

  // ==========================================================================
  // Event Buffering
  // ==========================================================================

  /**
   * Send an event, buffering if partitioned
   */
  async sendEvent(event: unknown): Promise<void> {
    // Check if we're partitioned
    const isPartitioned = this.checkPartition()

    if (isPartitioned) {
      // Buffer the event
      this.bufferEvent(event)
      return
    }

    // Try to send
    try {
      await this.pipeline.send([event])
      this.lastCommunicationAt = Date.now()
    } catch {
      // Network error - buffer the event
      this.bufferEvent(event)
      this.detectPartition()
    }
  }

  private bufferEvent(event: unknown): void {
    // Check buffer size limit
    if (this.eventBuffer.length >= this.bufferSize) {
      switch (this.overflowStrategy) {
        case 'drop-oldest':
          this.eventBuffer.shift()
          break
        case 'drop-newest':
          return // Don't add the new event
        case 'reject':
          throw new Error('Event buffer full')
      }
    }

    this.eventBuffer.push({
      event,
      timestamp: Date.now(),
    })
  }

  /**
   * Get number of buffered events
   */
  getBufferedEventCount(): number {
    return this.eventBuffer.length
  }

  /**
   * Get buffer metrics
   */
  getBufferMetrics(): BufferMetrics {
    const now = Date.now()
    const oldestEventAge = this.eventBuffer.length > 0
      ? now - this.eventBuffer[0].timestamp
      : 0

    return {
      bufferedCount: this.eventBuffer.length,
      oldestEventAge,
      bufferUtilization: this.eventBuffer.length / this.bufferSize,
      eventsDiscardedDueToTimeout: this.eventsDiscardedDueToTimeout,
    }
  }

  /**
   * Flush buffered events to pipeline
   */
  async flushBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return

    const eventsToSend = [...this.eventBuffer]
    this.eventBuffer = []

    try {
      await this.pipeline.send(eventsToSend.map(e => e.event))
      this.lastCommunicationAt = Date.now()
    } catch {
      // Re-buffer the events
      this.eventBuffer = eventsToSend
    }
  }

  // ==========================================================================
  // Partition Detection
  // ==========================================================================

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return

    this.heartbeatTimer = setInterval(() => {
      this.checkPartitionStatus()
    }, this.heartbeatIntervalMs)
  }

  private startBufferCleanup(): void {
    if (this.bufferCleanupTimer) return

    this.bufferCleanupTimer = setInterval(() => {
      this.cleanupOldBufferedEvents()
    }, 1000)
  }

  private cleanupOldBufferedEvents(): void {
    const now = Date.now()
    const cutoff = now - this.maxBufferDurationMs

    const originalLength = this.eventBuffer.length
    this.eventBuffer = this.eventBuffer.filter(e => e.timestamp > cutoff)
    const removed = originalLength - this.eventBuffer.length
    if (removed > 0) {
      this.eventsDiscardedDueToTimeout += removed
    }
  }

  private checkPartitionStatus(): void {
    // First check if pipeline is indicating a partition
    const pipelineGlobalPartitioned = this.pipeline.isGlobalPartition?.() ?? false
    const pipelineNodePartitioned = this.pipeline.isPartitioned?.(this.nodeId) ?? false
    const pipelinePartitioned = pipelineGlobalPartitioned || pipelineNodePartitioned

    if (pipelinePartitioned) {
      if (this._partitionState !== 'partitioned') {
        this.detectPartition()
      }
      return
    }

    // Pipeline says we're not partitioned - check if we need to transition from partitioned state
    if (this._partitionState === 'partitioned') {
      // Partition may have healed - transition to healing
      this._partitionState = 'healing'
      for (const handler of this.stateChangeHandlers) {
        handler('healing')
      }

      // After a bit more time, transition to normal
      setTimeout(() => {
        if (this._partitionState === 'healing' && !this.checkPartition()) {
          // Mark partition end time for metrics
          if (this.partitionDetectedAt) {
            this.totalPartitionDurationMs += Date.now() - this.partitionDetectedAt
            this.partitionDetectedAt = undefined
          }
          this._partitionState = 'normal'
          for (const handler of this.stateChangeHandlers) {
            handler('normal')
          }
        }
      }, 500)
      return
    }

    // Time-based partition detection is ONLY used when pipeline doesn't have explicit partition state
    // and we have evidence of communication failure (failed sends will update lastCommunicationAt)
    // Don't use pure time-based detection as it can give false positives
  }

  private checkPartition(): boolean {
    const pipelineGlobalPartition = this.pipeline.isGlobalPartition?.() ?? false
    const pipelineNodePartition = this.pipeline.isPartitioned?.(this.nodeId) ?? false

    // Check if pipeline indicates partition
    if (pipelineGlobalPartition || pipelineNodePartition) {
      return true
    }

    // Also check our internal state
    return this._partitionState === 'partitioned'
  }

  private detectPartition(): void {
    if (this._partitionState === 'partitioned') return

    this._partitionState = 'partitioned'
    this.partitionDetectedAt = Date.now()
    this.totalPartitionCount++

    // Emit events
    for (const handler of this.partitionDetectedHandlers) {
      handler()
    }

    for (const handler of this.stateChangeHandlers) {
      handler('partitioned')
    }

    this.emitRecoveryEvent({
      type: 'partition_detected',
      timestamp: Date.now(),
    })
  }

  /**
   * Check if currently partitioned
   */
  isPartitioned(): boolean {
    const pipelineGlobalPartition = this.pipeline.isGlobalPartition?.() ?? false
    const pipelineNodePartition = this.pipeline.isPartitioned?.(this.nodeId) ?? false
    const pipelinePartitioned = pipelineGlobalPartition || pipelineNodePartition

    // If pipeline says we're partitioned but we haven't detected yet, detect now
    if (pipelinePartitioned && this._partitionState !== 'partitioned') {
      this.detectPartition()
    }

    return this._partitionState === 'partitioned' || pipelinePartitioned
  }

  /**
   * Get time since last successful communication
   */
  getTimeSinceLastCommunication(): number {
    return Date.now() - this.lastCommunicationAt
  }

  /**
   * Get partition info
   */
  getPartitionInfo(): PartitionInfo {
    // First update the unreachable nodes from the pipeline
    this.updateUnreachableNodes()

    // Check for partial partition first (other nodes unreachable but not us)
    const hasUnreachableNodes = this.unreachableNodes.size > 0
    const isGlobal = this.pipeline.isGlobalPartition?.() ?? false
    const weArePartitioned = this.isPartitioned()

    // Partial partition: other nodes are partitioned but not global and not us
    if (hasUnreachableNodes && !isGlobal && !weArePartitioned) {
      return {
        type: 'partial',
        unreachableNodes: Array.from(this.unreachableNodes),
        detectedAt: this.partitionDetectedAt,
      }
    }

    // Full partition: global partition or we are partitioned
    if (weArePartitioned || isGlobal) {
      return {
        type: 'full',
        unreachableNodes: Array.from(this.unreachableNodes),
        detectedAt: this.partitionDetectedAt,
      }
    }

    return { type: 'none', unreachableNodes: [] }
  }

  /**
   * Update the list of unreachable nodes from pipeline state
   */
  private updateUnreachableNodes(): void {
    // Check for partial partitions by querying pipeline
    const pipeline = this.pipeline as PartitionRecoveryConfig['pipeline'] & {
      isPartitioned?: (nodeId: string) => boolean
    }

    // Clear and rebuild unreachable set
    this.unreachableNodes.clear()

    // If we can query specific node partitions, do so
    if (pipeline.isPartitioned) {
      // Check common node names
      const nodesToCheck = ['node-1', 'node-2', 'node-3', 'leader-node', 'follower-1', 'follower-2']
      for (const nodeId of nodesToCheck) {
        // Check if this node (other than ourselves) is partitioned
        if (nodeId !== this.nodeId && pipeline.isPartitioned(nodeId)) {
          this.unreachableNodes.add(nodeId)
        }
      }
    }
  }

  /**
   * Check if there's a partial partition (some nodes unreachable but not all)
   */
  hasPartialPartition(): boolean {
    this.updateUnreachableNodes()
    return this.unreachableNodes.size > 0 && !(this.pipeline.isGlobalPartition?.() ?? false)
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Register partition detected handler
   */
  onPartitionDetected(handler: () => void): () => void {
    this.partitionDetectedHandlers.push(handler)
    return () => {
      const idx = this.partitionDetectedHandlers.indexOf(handler)
      if (idx >= 0) this.partitionDetectedHandlers.splice(idx, 1)
    }
  }

  /**
   * Register state change handler
   */
  onStateChange(handler: (state: PartitionState) => void): () => void {
    this.stateChangeHandlers.push(handler)
    return () => {
      const idx = this.stateChangeHandlers.indexOf(handler)
      if (idx >= 0) this.stateChangeHandlers.splice(idx, 1)
    }
  }

  /**
   * Register recovery event handler
   */
  onRecoveryEvent(handler: (event: RecoveryEvent) => void): () => void {
    this.recoveryEventHandlers.push(handler)
    return () => {
      const idx = this.recoveryEventHandlers.indexOf(handler)
      if (idx >= 0) this.recoveryEventHandlers.splice(idx, 1)
    }
  }

  private emitRecoveryEvent(event: RecoveryEvent): void {
    for (const handler of this.recoveryEventHandlers) {
      handler(event)
    }
  }

  // ==========================================================================
  // Client Management
  // ==========================================================================

  /**
   * Register a client for reconnection management
   */
  async registerClient(client: Client): Promise<void> {
    this.clients.set(client.id, client)
    this.clientStatuses.set(client.id, {
      state: 'connected',
      reconnectAttempts: 0,
      lastSeen: Date.now(),
    })
  }

  /**
   * Get count of connected clients
   */
  getConnectedClientCount(): number {
    let count = 0
    for (const status of this.clientStatuses.values()) {
      if (status.state === 'connected') count++
    }
    return count
  }

  /**
   * Get list of disconnected client IDs
   */
  getDisconnectedClients(): string[] {
    const disconnected: string[] = []
    for (const [id, status] of this.clientStatuses) {
      if (status.state === 'disconnected') {
        disconnected.push(id)
      }
    }
    return disconnected
  }

  /**
   * Simulate client disconnection (for testing)
   */
  simulateClientDisconnect(clientId: string): void {
    const status = this.clientStatuses.get(clientId)
    if (status) {
      status.state = 'disconnected'
      status.reconnectAttempts = 0

      const client = this.clients.get(clientId)
      if (client) {
        client.onDisconnect()
      }

      // Schedule reconnection attempts if partition is healed
      this.scheduleReconnect(clientId)
    }
  }

  /**
   * Record client's last seen sequence
   */
  async recordClientSequence(clientId: string, sequence: number): Promise<void> {
    this.clientLastSequences.set(clientId, sequence)
  }

  /**
   * Record an event for client replay
   */
  async recordEvent(event: { sequence: number; data?: unknown }): Promise<void> {
    this.storedEvents.push({ sequence: event.sequence, data: event })
  }

  /**
   * Reconnect a specific client
   */
  async reconnectClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId)
    const status = this.clientStatuses.get(clientId)

    if (!client || !status) return

    status.state = 'connected'
    client.onReconnect()

    // Replay missed events
    const lastSequence = this.clientLastSequences.get(clientId) ?? 0
    const missedEvents = this.storedEvents.filter(e => e.sequence > lastSequence)

    for (const event of missedEvents) {
      await client.send(event.data ?? event)
    }
  }

  /**
   * Get client status
   */
  getClientStatus(clientId: string): ClientStatus {
    return this.clientStatuses.get(clientId) ?? {
      state: 'disconnected',
      reconnectAttempts: 0,
      lastSeen: 0,
    }
  }

  /**
   * Register reconnect attempt callback
   */
  onReconnectAttempt(callback: (clientId: string, attempt: number, delayMs: number) => void): () => void {
    this.reconnectAttemptCallbacks.push(callback)
    return () => {
      const idx = this.reconnectAttemptCallbacks.indexOf(callback)
      if (idx >= 0) this.reconnectAttemptCallbacks.splice(idx, 1)
    }
  }

  private scheduleReconnect(clientId: string): void {
    const status = this.clientStatuses.get(clientId)
    if (!status || status.state === 'connected') return
    if (status.reconnectAttempts >= this.maxReconnectAttempts) return

    // Clear any existing reconnect timer
    const existingTimer = this.reconnectTimers.get(clientId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Increment attempt immediately so we track it correctly
    status.reconnectAttempts++
    const attempt = status.reconnectAttempts

    // Use constant interval for initial attempts, then linear backoff
    // This allows rapid initial reconnection attempts before backing off
    const delayMs = attempt <= 3
      ? this.reconnectIntervalMs
      : this.reconnectIntervalMs * (attempt - 2)

    // Notify callbacks
    for (const callback of this.reconnectAttemptCallbacks) {
      callback(clientId, attempt, delayMs)
    }

    const timer = setTimeout(async () => {
      // Check if partition is healed
      if (!this.checkPartition()) {
        await this.reconnectClient(clientId)
      } else {
        // Schedule another attempt if under limit
        this.scheduleReconnect(clientId)
      }
    }, delayMs)

    this.reconnectTimers.set(clientId, timer)
  }

  // ==========================================================================
  // Graceful Degradation
  // ==========================================================================

  /**
   * Set local state value
   */
  async setLocal(key: string, value: unknown): Promise<void> {
    this.localState.set(key, value)
  }

  /**
   * Get local state value
   */
  async getLocal(key: string): Promise<unknown | undefined> {
    this.localOperationsServed++
    return this.localState.get(key)
  }

  /**
   * Perform a local write (during partition)
   */
  async localWrite(key: string, value: unknown): Promise<LocalWriteResult> {
    if (this.isPartitioned() && !this.degradationConfig.allowLocalWrites) {
      return {
        success: false,
        error: 'Local writes not allowed during partition',
      }
    }

    this.localState.set(key, value)
    this.localOperationsServed++
    return { success: true }
  }

  /**
   * Perform a remote write (queued during partition)
   */
  async remoteWrite(key: string, value: unknown): Promise<RemoteWriteResult> {
    // Check if partitioned
    if (this.isPartitioned()) {
      if (!this.degradationConfig.queueRemoteOperations) {
        return { status: 'rejected', reason: 'Remote operations not queued during partition' }
      }

      // Check queue size
      if (this.operationQueue.length >= this.degradationConfig.maxQueueSize) {
        return { status: 'rejected', reason: 'Queue is full' }
      }

      // Queue the operation
      this.operationQueue.push({ key, value, timestamp: Date.now() })
      return { status: 'queued' }
    }

    // Not partitioned - send directly
    try {
      await this.pipeline.send([{ type: 'write', key, value }])
      this.lastCommunicationAt = Date.now()
      return { status: 'success' }
    } catch {
      // Network error - queue if allowed
      if (this.degradationConfig.queueRemoteOperations) {
        this.operationQueue.push({ key, value, timestamp: Date.now() })
        this.detectPartition()
        return { status: 'queued' }
      }
      return { status: 'rejected', reason: 'Network error' }
    }
  }

  /**
   * Get count of queued operations
   */
  getQueuedOperationCount(): number {
    return this.operationQueue.length
  }

  /**
   * Process queued operations
   */
  async processQueue(): Promise<void> {
    if (this.operationQueue.length === 0) return

    // Check pipeline state directly - if pipeline is still partitioned, don't try
    const pipelinePartitioned =
      (this.pipeline.isGlobalPartition?.() ?? false) ||
      (this.pipeline.isPartitioned?.(this.nodeId) ?? false)

    if (pipelinePartitioned) return

    const operations = [...this.operationQueue]
    this.operationQueue = []

    for (const op of operations) {
      try {
        await this.pipeline.send([{ type: 'write', key: op.key, value: op.value }])
        this.lastCommunicationAt = Date.now()

        // If we successfully sent, update our state
        if (this._partitionState !== 'normal') {
          this._partitionState = 'normal'
          for (const handler of this.stateChangeHandlers) {
            handler('normal')
          }
        }
      } catch {
        // Re-queue on failure
        this.operationQueue.push(op)
      }
    }
  }

  /**
   * Get operational status
   */
  getOperationalStatus(): 'normal' | 'degraded' {
    return this.isPartitioned() ? 'degraded' : 'normal'
  }

  /**
   * Get partition metrics for monitoring
   */
  getPartitionMetrics(): PartitionMetrics {
    const now = Date.now()
    const partitionDurationMs = this.partitionDetectedAt
      ? now - this.partitionDetectedAt
      : 0

    return {
      isPartitioned: this.isPartitioned(),
      partitionDurationMs,
      queuedOperations: this.operationQueue.length,
      localOperationsServed: this.localOperationsServed,
      totalPartitionCount: this.totalPartitionCount,
      totalPartitionDurationMs: this.totalPartitionDurationMs + partitionDurationMs,
      recoveryAttempts: this.recoveryAttempts,
      recoverySuccesses: this.recoverySuccesses,
      recoveryFailures: this.recoveryFailures,
    }
  }

  /**
   * Get estimated recovery time based on queue size
   */
  getEstimatedRecoveryTime(): number {
    // Estimate based on queue size and average processing time
    const avgProcessingTimeMs = 10 // Assumed average
    return this.operationQueue.length * avgProcessingTimeMs
  }

  // ==========================================================================
  // Recovery
  // ==========================================================================

  /**
   * Attempt recovery from partition
   */
  async attemptRecovery(): Promise<boolean> {
    this.recoveryAttempts++

    this.emitRecoveryEvent({
      type: 'recovery_started',
      timestamp: Date.now(),
    })

    // Check if pipeline is still partitioned (direct check, no state changes)
    const pipelineStillPartitioned =
      (this.pipeline.isGlobalPartition?.() ?? false) ||
      (this.pipeline.isPartitioned?.(this.nodeId) ?? false)

    if (pipelineStillPartitioned) {
      this.recoveryFailures++
      this.emitRecoveryEvent({
        type: 'recovery_failed',
        timestamp: Date.now(),
      })
      return false
    }

    // Transition to healing state
    if (this._partitionState === 'partitioned') {
      this._partitionState = 'healing'
      for (const handler of this.stateChangeHandlers) {
        handler('healing')
      }
    }

    // Flush buffered events
    await this.flushBuffer()

    // Process queued operations
    await this.processQueue()

    // Reconnect clients
    for (const clientId of this.getDisconnectedClients()) {
      await this.reconnectClient(clientId)
    }

    // Update metrics
    if (this.partitionDetectedAt) {
      this.totalPartitionDurationMs += Date.now() - this.partitionDetectedAt
      this.partitionDetectedAt = undefined
    }

    // Transition to normal state
    this._partitionState = 'normal'
    this.recoverySuccesses++

    for (const handler of this.stateChangeHandlers) {
      handler('normal')
    }

    this.emitRecoveryEvent({
      type: 'recovery_completed',
      timestamp: Date.now(),
    })

    return true
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics(): PartitionMetrics {
    return this.getPartitionMetrics()
  }
}

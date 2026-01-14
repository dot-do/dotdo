/**
 * Heartbeat, Reconnection, and State Synchronization Primitives
 *
 * Production-grade connection management primitives for WebSocket sync:
 * - HeartbeatMonitor: Configurable intervals, connection health monitoring
 * - ReconnectionManager: Exponential backoff, retry limits
 * - StateSynchronizer: State diff and resync after reconnect
 *
 * @module db/primitives/sync/heartbeat
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for HeartbeatMonitor
 */
export interface HeartbeatConfig {
  /** Interval between heartbeat pings in milliseconds */
  intervalMs?: number
  /** Timeout after which connection is considered stale */
  timeoutMs?: number
}

/**
 * Current state of the heartbeat monitor
 */
export interface HeartbeatState {
  /** Timestamp of last received pong */
  lastPongAt: number
  /** Whether a ping is awaiting pong response */
  pendingPing: boolean
  /** Number of consecutive missed pings */
  missedPings: number
}

/**
 * Ping event payload
 */
export interface PingEvent {
  timestamp: number
}

/**
 * Timeout event payload
 */
export interface TimeoutEvent {
  lastPongAge: number
}

/**
 * Pong message received from server/client
 */
export interface PongMessage {
  timestamp: number
}

/**
 * HeartbeatMonitor interface
 */
export interface HeartbeatMonitor {
  getConfig(): Required<HeartbeatConfig>
  isRunning(): boolean
  start(): void
  stop(): void
  reset(): void
  receivePong(pong: PongMessage): void
  isHealthy(): boolean
  getState(): HeartbeatState
  onPing(callback: (event: PingEvent) => void): () => void
  onTimeout(callback: (event: TimeoutEvent) => void): () => void
}

/**
 * Configuration for ReconnectionManager
 */
export interface ReconnectionConfig {
  /** Base delay for reconnection in milliseconds */
  baseDelayMs?: number
  /** Maximum delay for reconnection in milliseconds */
  maxDelayMs?: number
  /** Maximum number of reconnection attempts */
  maxAttempts?: number
  /** Jitter factor for randomizing delays (0-1) */
  jitterFactor?: number
}

/**
 * Current state of the reconnection manager
 */
export interface ReconnectionState {
  /** Current attempt number */
  attempts: number
  /** Whether a reconnection is pending */
  isPending: boolean
  /** Timestamp when next reconnection will be attempted */
  nextReconnectAt: number | null
}

/**
 * Attempt event payload
 */
export interface AttemptEvent {
  attempt: number
}

/**
 * Exhausted event payload
 */
export interface ExhaustedEvent {
  totalAttempts: number
}

/**
 * ReconnectionManager interface
 */
export interface ReconnectionManager {
  getConfig(): Required<ReconnectionConfig>
  getNextDelay(): number
  recordAttempt(): void
  recordSuccess(): void
  scheduleReconnect(): void
  cancel(): void
  getState(): ReconnectionState
  onReconnect(callback: () => void): () => void
  onAttempt(callback: (event: AttemptEvent) => void): () => void
  onExhausted(callback: (event: ExhaustedEvent) => void): () => void
}

/**
 * Sync state for collections
 */
export interface SyncState {
  collection: string
  branch: string | null
  fromTxid: number | null
}

/**
 * Pending mutation
 */
export interface PendingMutation {
  id: string
  collection: string
  operation: 'insert' | 'update' | 'delete'
  key: string
  data?: Record<string, unknown>
}

/**
 * Result of processing initial state
 */
export interface StateSyncResult {
  missedChanges: boolean
  gapStart?: number
  gapEnd?: number
}

/**
 * State diff result
 */
export interface StateDiff<T = Record<string, unknown>> {
  inserts: T[]
  updates: T[]
  deletes: string[]
}

/**
 * Subscription entry
 */
export interface SubscriptionEntry {
  collection: string
  branch: string | null
}

/**
 * StateSynchronizer interface
 */
export interface StateSynchronizer {
  recordTxid(collection: string, txid: number): void
  getLastTxid(collection: string): number | null
  addSubscription(collection: string, branch: string | null): void
  removeSubscription(collection: string, branch: string | null): void
  getSubscriptions(): SubscriptionEntry[]
  addPendingMutation(mutation: PendingMutation): void
  confirmMutation(id: string): void
  getPendingMutations(): PendingMutation[]
  getMutationsToRetry(): PendingMutation[]
  onDisconnect(): void
  getResyncPlan(): SyncState[]
  processInitialState(collection: string, items: unknown[], txid: number): Promise<StateSyncResult>
  computeDiff<T extends { $id: string; version?: number }>(collection: string, localState: T[], remoteState: T[]): StateDiff<T>
  reset(): void
  clearCollection(collection: string): void
}

// =============================================================================
// HEARTBEAT MONITOR IMPLEMENTATION
// =============================================================================

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45000

/**
 * Create a HeartbeatMonitor instance
 */
export function createHeartbeatMonitor(config: HeartbeatConfig = {}): HeartbeatMonitor {
  const resolvedConfig: Required<HeartbeatConfig> = {
    intervalMs: config.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    timeoutMs: config.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
  }

  // Validate config
  if (resolvedConfig.timeoutMs <= resolvedConfig.intervalMs) {
    throw new Error('Timeout must be greater than interval')
  }

  let running = false
  let intervalId: ReturnType<typeof setInterval> | null = null
  let lastPongAt = Date.now()
  let pendingPing = false
  let missedPings = 0
  let lastPingAt = 0

  const pingListeners = new Set<(event: PingEvent) => void>()
  const timeoutListeners = new Set<(event: TimeoutEvent) => void>()

  function emitPing(): void {
    if (pendingPing) {
      // Already waiting for pong, don't send another
      return
    }

    pendingPing = true
    lastPingAt = Date.now()
    const event: PingEvent = { timestamp: lastPingAt }
    Array.from(pingListeners).forEach((listener) => {
      try {
        listener(event)
      } catch {
        // Ignore callback errors
      }
    })
  }

  function checkHealth(): void {
    const now = Date.now()
    const lastPongAge = now - lastPongAt

    // Track missed pings - count intervals since the pending ping was sent
    if (pendingPing && lastPingAt > 0) {
      const timeSincePing = now - lastPingAt
      // If one full interval has passed since ping, we've missed 1 pong
      missedPings = Math.floor(timeSincePing / resolvedConfig.intervalMs)
    }

    // Emit timeout event when at or past timeout threshold
    if (lastPongAge >= resolvedConfig.timeoutMs) {
      const event: TimeoutEvent = { lastPongAge }
      Array.from(timeoutListeners).forEach((listener) => {
        try {
          listener(event)
        } catch {
          // Ignore callback errors
        }
      })
    }

    // Reset pendingPing only when strictly PAST timeout (not at boundary)
    // This allows sending another ping to try to recover the connection
    if (lastPongAge > resolvedConfig.timeoutMs) {
      pendingPing = false
    }
  }

  const monitor: HeartbeatMonitor = {
    getConfig(): Required<HeartbeatConfig> {
      return { ...resolvedConfig }
    },

    isRunning(): boolean {
      return running
    },

    start(): void {
      if (running) return

      running = true
      lastPongAt = Date.now()
      pendingPing = false
      missedPings = 0

      intervalId = setInterval(() => {
        // Check health first - if timed out, reset pendingPing to allow retrying
        checkHealth()
        emitPing()
      }, resolvedConfig.intervalMs)
    },

    stop(): void {
      if (!running) return

      running = false
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    },

    reset(): void {
      lastPongAt = Date.now()
      pendingPing = false
      missedPings = 0
    },

    receivePong(_pong: PongMessage): void {
      lastPongAt = Date.now()
      pendingPing = false
      missedPings = 0
    },

    isHealthy(): boolean {
      const now = Date.now()
      const lastPongAge = now - lastPongAt
      return lastPongAge <= resolvedConfig.timeoutMs
    },

    getState(): HeartbeatState {
      return {
        lastPongAt,
        pendingPing,
        missedPings,
      }
    },

    onPing(callback: (event: PingEvent) => void): () => void {
      pingListeners.add(callback)
      return () => {
        pingListeners.delete(callback)
      }
    },

    onTimeout(callback: (event: TimeoutEvent) => void): () => void {
      timeoutListeners.add(callback)
      return () => {
        timeoutListeners.delete(callback)
      }
    },
  }

  return monitor
}

// =============================================================================
// RECONNECTION MANAGER IMPLEMENTATION
// =============================================================================

const DEFAULT_RECONNECT_BASE_DELAY_MS = 1000
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30000
const DEFAULT_RECONNECT_MAX_ATTEMPTS = Infinity
const DEFAULT_JITTER_FACTOR = 0

/**
 * Create a ReconnectionManager instance
 */
export function createReconnectionManager(config: ReconnectionConfig = {}): ReconnectionManager {
  const resolvedConfig: Required<ReconnectionConfig> = {
    baseDelayMs: config.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
    maxDelayMs: config.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
    maxAttempts: config.maxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS,
    jitterFactor: config.jitterFactor ?? DEFAULT_JITTER_FACTOR,
  }

  let attempts = 0
  let isPending = false
  let nextReconnectAt: number | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const reconnectListeners = new Set<() => void>()
  const attemptListeners = new Set<(event: AttemptEvent) => void>()
  const exhaustedListeners = new Set<(event: ExhaustedEvent) => void>()

  function applyJitter(delay: number): number {
    if (resolvedConfig.jitterFactor === 0) return delay

    const jitter = delay * resolvedConfig.jitterFactor
    const min = delay - jitter
    const max = delay + jitter
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  const manager: ReconnectionManager = {
    getConfig(): Required<ReconnectionConfig> {
      return { ...resolvedConfig }
    },

    getNextDelay(): number {
      const exponentialDelay = resolvedConfig.baseDelayMs * Math.pow(2, attempts)
      const cappedDelay = Math.min(exponentialDelay, resolvedConfig.maxDelayMs)
      return applyJitter(cappedDelay)
    },

    recordAttempt(): void {
      attempts++
    },

    recordSuccess(): void {
      attempts = 0
      isPending = false
      nextReconnectAt = null
    },

    scheduleReconnect(): void {
      // Check if attempts exhausted
      if (attempts >= resolvedConfig.maxAttempts) {
        const event: ExhaustedEvent = { totalAttempts: attempts }
        Array.from(exhaustedListeners).forEach((listener) => {
          try {
            listener(event)
          } catch {
            // Ignore callback errors
          }
        })
        return
      }

      // Cancel any pending reconnect
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }

      const delay = manager.getNextDelay()
      nextReconnectAt = Date.now() + delay
      isPending = true

      reconnectTimer = setTimeout(() => {
        isPending = false
        nextReconnectAt = null
        reconnectTimer = null

        // Record and emit attempt
        manager.recordAttempt()
        const attemptEvent: AttemptEvent = { attempt: attempts }
        Array.from(attemptListeners).forEach((listener) => {
          try {
            listener(attemptEvent)
          } catch {
            // Ignore callback errors
          }
        })

        // Emit reconnect
        Array.from(reconnectListeners).forEach((listener) => {
          try {
            listener()
          } catch {
            // Ignore callback errors
          }
        })
      }, delay)
    },

    cancel(): void {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      isPending = false
      nextReconnectAt = null
    },

    getState(): ReconnectionState {
      return {
        attempts,
        isPending,
        nextReconnectAt,
      }
    },

    onReconnect(callback: () => void): () => void {
      reconnectListeners.add(callback)
      return () => {
        reconnectListeners.delete(callback)
      }
    },

    onAttempt(callback: (event: AttemptEvent) => void): () => void {
      attemptListeners.add(callback)
      return () => {
        attemptListeners.delete(callback)
      }
    },

    onExhausted(callback: (event: ExhaustedEvent) => void): () => void {
      exhaustedListeners.add(callback)
      return () => {
        exhaustedListeners.delete(callback)
      }
    },
  }

  return manager
}

// =============================================================================
// STATE SYNCHRONIZER IMPLEMENTATION
// =============================================================================

/**
 * Create a StateSynchronizer instance
 */
export function createStateSynchronizer(): StateSynchronizer {
  const txidMap = new Map<string, number>()
  const subscriptions = new Map<string, SubscriptionEntry>()
  const pendingMutations = new Map<string, PendingMutation>()

  function getSubscriptionKey(collection: string, branch: string | null): string {
    return branch ? `${collection}:${branch}` : collection
  }

  const synchronizer: StateSynchronizer = {
    recordTxid(collection: string, txid: number): void {
      const existing = txidMap.get(collection)
      if (existing === undefined || txid > existing) {
        txidMap.set(collection, txid)
      }
    },

    getLastTxid(collection: string): number | null {
      return txidMap.get(collection) ?? null
    },

    addSubscription(collection: string, branch: string | null): void {
      const key = getSubscriptionKey(collection, branch)
      if (!subscriptions.has(key)) {
        subscriptions.set(key, { collection, branch })
      }
    },

    removeSubscription(collection: string, branch: string | null): void {
      const key = getSubscriptionKey(collection, branch)
      subscriptions.delete(key)
    },

    getSubscriptions(): SubscriptionEntry[] {
      return Array.from(subscriptions.values())
    },

    addPendingMutation(mutation: PendingMutation): void {
      pendingMutations.set(mutation.id, mutation)
    },

    confirmMutation(id: string): void {
      pendingMutations.delete(id)
    },

    getPendingMutations(): PendingMutation[] {
      return Array.from(pendingMutations.values())
    },

    getMutationsToRetry(): PendingMutation[] {
      return Array.from(pendingMutations.values())
    },

    onDisconnect(): void {
      // State is preserved during disconnect - this is intentional
      // subscriptions, txids, and pending mutations are all kept
    },

    getResyncPlan(): SyncState[] {
      return Array.from(subscriptions.values()).map((sub) => ({
        collection: sub.collection,
        branch: sub.branch,
        fromTxid: txidMap.get(sub.collection) ?? null,
      }))
    },

    async processInitialState(collection: string, _items: unknown[], txid: number): Promise<StateSyncResult> {
      const lastTxid = txidMap.get(collection)

      if (lastTxid !== undefined && txid > lastTxid) {
        // Gap detected - missed some changes
        return {
          missedChanges: true,
          gapStart: lastTxid,
          gapEnd: txid,
        }
      }

      // No missed changes or first time receiving
      return {
        missedChanges: false,
      }
    },

    computeDiff<T extends { $id: string; version?: number }>(
      _collection: string,
      localState: T[],
      remoteState: T[]
    ): StateDiff<T> {
      const localMap = new Map<string, T>()
      for (const item of localState) {
        localMap.set(item.$id, item)
      }

      const remoteMap = new Map<string, T>()
      for (const item of remoteState) {
        remoteMap.set(item.$id, item)
      }

      const inserts: T[] = []
      const updates: T[] = []
      const deletes: string[] = []

      // Find inserts and updates
      Array.from(remoteMap.entries()).forEach(([id, remoteItem]) => {
        const localItem = localMap.get(id)
        if (!localItem) {
          // New item
          inserts.push(remoteItem)
        } else if (remoteItem.version !== undefined && localItem.version !== undefined && remoteItem.version > localItem.version) {
          // Updated item
          updates.push(remoteItem)
        }
      })

      // Find deletes
      Array.from(localMap.keys()).forEach((id) => {
        if (!remoteMap.has(id)) {
          deletes.push(id)
        }
      })

      return { inserts, updates, deletes }
    },

    reset(): void {
      txidMap.clear()
      subscriptions.clear()
      pendingMutations.clear()
    },

    clearCollection(collection: string): void {
      txidMap.delete(collection)
    },
  }

  return synchronizer
}

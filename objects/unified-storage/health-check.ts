/**
 * Health Check Manager for Unified Storage
 *
 * Provides health check endpoints for unified storage DOs:
 * - /health/live - Liveness probe (is DO running?)
 * - /health/ready - Readiness probe (is state loaded?)
 * - /health - Detailed component health
 *
 * @module objects/unified-storage/health-check
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type HealthStatusLevel = 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

export interface HealthStatus {
  status: HealthStatusLevel
  timestamp: string
  uptimeMs: number
  doId?: string
}

export interface ComponentHealth {
  status: HealthStatusLevel
  error?: string
  [key: string]: unknown
}

export interface ReplicationLagMetrics {
  role: 'leader' | 'follower'
  lagMs?: number
  lagEvents?: number
  lastSyncMs?: number
  timeSinceLastSyncMs?: number
  status?: HealthStatusLevel
  leader?: { id: string; lastHeartbeatMs: number }
  followerCount?: number
}

export interface RecoveryProgress {
  phase: string
  loaded: number
  total: number
  elapsedMs: number
  percentComplete?: number
}

export interface LivenessResponse {
  status: number
  body: {
    alive: boolean
    timestamp: string
    doId?: string
    uptimeMs: number
  }
}

export interface ReadinessResponse {
  status: number
  body: {
    ready: boolean
    reason?: string
    loadDurationMs?: number
    recoveryProgress?: RecoveryProgress
  }
}

export interface DetailedHealthResponse {
  status: number
  body: {
    status: HealthStatusLevel
    timestamp: string
    uptimeMs: number
    timedOut?: boolean
    components: {
      state: ComponentHealth
      pipeline: ComponentHealth
      sql: ComponentHealth
    }
    replication?: ReplicationLagMetrics
    customChecks?: Record<string, ComponentHealth>
    degradedReason?: string
    degradedReasons?: string[]
  }
}

export interface HealthCheckCallback {
  (): Promise<{
    status: HealthStatusLevel
    name: string
    [key: string]: unknown
  }>
}

export interface StateManager {
  isLoaded(): boolean
  getLoadDuration?(): number
  getThingCount?(): number
  getDirtyCount?(): number
  getLastAccessTime?(): number
}

export interface PipelineEmitter {
  isConnected(): boolean
  getPendingCount?(): number
  getLastSendTime?(): number
  getErrorCount?(): number
}

export interface SqlStorage {
  isHealthy(): boolean
  getLastCheckpointTime?(): number
  getPendingWriteCount?(): number
  getAverageQueryLatency?(): number
  ping?(): Promise<number>
}

export interface ReplicationManager {
  getRole(): 'leader' | 'follower'
  isHealthy(): boolean
  getReplicationLagMs(): number
  getReplicationLagEvents(): number
  getLastSyncTime(): number
  getLeaderInfo(): { leaderId: string; lastHeartbeatMs: number } | null
  getFollowerCount(): number
}

export interface HealthThresholds {
  pipelinePendingWarning?: number
  pipelinePendingCritical?: number
  dirtyCountWarning?: number
  dirtyCountCritical?: number
  checkpointAgeWarningMs?: number
  checkpointAgeCriticalMs?: number
  replicationLagWarningMs?: number
  replicationLagCriticalMs?: number
}

export interface HealthCheckConfig {
  stateManager: StateManager
  pipelineEmitter: PipelineEmitter
  sqlStorage: SqlStorage
  replicationManager?: ReplicationManager
  doId?: string
  thresholds?: HealthThresholds
  recoveryProgress?: RecoveryProgress
  cacheStatusMs?: number
  customCheckTimeoutMs?: number
  overallTimeoutMs?: number
}

export interface ResolvedHealthConfig {
  stateManager: StateManager
  pipelineEmitter: PipelineEmitter
  sqlStorage: SqlStorage
  replicationManager?: ReplicationManager
  doId?: string
  thresholds: Required<HealthThresholds>
  recoveryProgress?: RecoveryProgress
  cacheStatusMs: number
  customCheckTimeoutMs: number
  overallTimeoutMs: number
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const DEFAULT_THRESHOLDS: Required<HealthThresholds> = {
  pipelinePendingWarning: 1000,
  pipelinePendingCritical: 5000,
  dirtyCountWarning: 1000,
  dirtyCountCritical: 50000,
  checkpointAgeWarningMs: 30000,
  checkpointAgeCriticalMs: 120000,
  replicationLagWarningMs: 5000,
  replicationLagCriticalMs: 30000,
}

// ============================================================================
// HEALTH CHECK MANAGER
// ============================================================================

export class HealthCheckManager {
  readonly config: ResolvedHealthConfig
  private readonly startTime: number
  private readonly customChecks = new Map<string, HealthCheckCallback>()
  private cachedStatus: DetailedHealthResponse['body'] | null = null
  private cachedStatusTime = 0
  private closed = false

  constructor(config: HealthCheckConfig) {
    this.startTime = Date.now()
    this.config = {
      stateManager: config.stateManager,
      pipelineEmitter: config.pipelineEmitter,
      sqlStorage: config.sqlStorage,
      replicationManager: config.replicationManager,
      doId: config.doId,
      thresholds: { ...DEFAULT_THRESHOLDS, ...config.thresholds },
      recoveryProgress: config.recoveryProgress,
      cacheStatusMs: config.cacheStatusMs ?? 1000,
      customCheckTimeoutMs: config.customCheckTimeoutMs ?? 5000,
      overallTimeoutMs: config.overallTimeoutMs ?? 5000,
    }
  }

  /**
   * Handle HTTP requests to health endpoints
   */
  async handleRequest(request: Request): Promise<Response> {
    if (this.closed) {
      return new Response(JSON.stringify({ error: 'Health manager closed' }), {
        status: 503,
        headers: this.getHeaders(),
      })
    }

    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/health/live') {
      const result = await this.handleLivenessProbe()
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: this.getHeaders(),
      })
    }

    if (path === '/health/ready') {
      const result = await this.handleReadinessProbe()
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: this.getHeaders(),
      })
    }

    if (path === '/health') {
      const result = await this.handleDetailedHealth()
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: this.getHeaders(),
      })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: this.getHeaders(),
    })
  }

  /**
   * Liveness probe - is the DO running?
   */
  async handleLivenessProbe(): Promise<LivenessResponse> {
    return {
      status: 200,
      body: {
        alive: true,
        timestamp: new Date().toISOString(),
        doId: this.config.doId,
        uptimeMs: Date.now() - this.startTime,
      },
    }
  }

  /**
   * Readiness probe - is state loaded and ready to serve?
   */
  async handleReadinessProbe(): Promise<ReadinessResponse> {
    const stateManager = this.config.stateManager
    const pipelineEmitter = this.config.pipelineEmitter
    const sqlStorage = this.config.sqlStorage

    // Check if state is loaded
    if (!stateManager.isLoaded()) {
      const progress = this.config.recoveryProgress
      return {
        status: 503,
        body: {
          ready: false,
          reason: 'State is loading during cold start recovery',
          recoveryProgress: progress
            ? {
                ...progress,
                percentComplete: Math.round((progress.loaded / progress.total) * 100),
              }
            : undefined,
        },
      }
    }

    // Check pipeline connection
    if (!pipelineEmitter.isConnected()) {
      return {
        status: 503,
        body: {
          ready: false,
          reason: 'Pipeline is disconnected',
        },
      }
    }

    // Check SQL health
    if (!sqlStorage.isHealthy()) {
      return {
        status: 503,
        body: {
          ready: false,
          reason: 'SQL storage is unhealthy',
        },
      }
    }

    return {
      status: 200,
      body: {
        ready: true,
        loadDurationMs: stateManager.getLoadDuration?.() ?? 0,
      },
    }
  }

  /**
   * Detailed health check with component status
   */
  async handleDetailedHealth(): Promise<DetailedHealthResponse> {
    // Check cache
    const now = Date.now()
    if (this.cachedStatus && now - this.cachedStatusTime < this.config.cacheStatusMs) {
      return {
        status: this.getHttpStatus(this.cachedStatus.status),
        body: this.cachedStatus,
      }
    }

    // Run checks with overall timeout
    let timedOut = false
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true
        reject(new Error('Health check timed out'))
      }, this.config.overallTimeoutMs)
    })

    try {
      const result = await Promise.race([this.runDetailedHealthChecks(), timeoutPromise])
      this.cachedStatus = result
      this.cachedStatusTime = now
      return {
        status: this.getHttpStatus(result.status),
        body: result,
      }
    } catch {
      // Timeout or error
      const partialResult = this.buildTimeoutResponse(timedOut)
      return {
        status: 503,
        body: partialResult,
      }
    }
  }

  /**
   * Register a custom health check
   */
  registerHealthCheck(name: string, callback: HealthCheckCallback): void {
    this.customChecks.set(name, callback)
  }

  /**
   * Unregister a custom health check
   */
  unregisterHealthCheck(name: string): void {
    this.customChecks.delete(name)
  }

  /**
   * Close the health check manager
   */
  async close(): Promise<void> {
    this.closed = true
  }

  /**
   * Check if manager is closed
   */
  isClosed(): boolean {
    return this.closed
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private async runDetailedHealthChecks(): Promise<DetailedHealthResponse['body']> {
    const degradedReasons: string[] = []

    // Run component checks in parallel
    const [stateHealth, pipelineHealth, sqlHealth] = await Promise.all([
      this.checkStateManager(),
      this.checkPipelineEmitter(),
      this.checkSqlStorage(),
    ])

    // Check replication if available
    let replication: ReplicationLagMetrics | undefined
    if (this.config.replicationManager) {
      replication = this.checkReplication()
    }

    // Run custom checks with timeout
    const customResults = await this.runCustomChecks()

    // Collect degraded reasons
    if (stateHealth.status === 'degraded') {
      degradedReasons.push('State manager degraded')
    }
    if (pipelineHealth.status === 'unhealthy') {
      degradedReasons.push('Pipeline disconnected')
    } else if (pipelineHealth.status === 'degraded') {
      degradedReasons.push('Pipeline backlog high')
    }
    if (sqlHealth.status === 'degraded') {
      degradedReasons.push('SQL storage degraded')
    }
    if (replication?.status === 'degraded') {
      degradedReasons.push('Replication lag high')
    }

    // Determine overall status
    const overallStatus = this.calculateOverallStatus(
      stateHealth.status,
      pipelineHealth.status,
      sqlHealth.status,
      replication?.status
    )

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeMs: Date.now() - this.startTime,
      components: {
        state: stateHealth,
        pipeline: pipelineHealth,
        sql: sqlHealth,
      },
      replication,
      customChecks: customResults,
      degradedReason: degradedReasons[0],
      degradedReasons: degradedReasons.length > 0 ? degradedReasons : undefined,
    }
  }

  private async checkStateManager(): Promise<ComponentHealth> {
    const sm = this.config.stateManager
    const thresholds = this.config.thresholds

    try {
      const isLoaded = sm.isLoaded()
      const thingCount = sm.getThingCount?.() ?? 0
      const dirtyCount = sm.getDirtyCount?.() ?? 0

      let status: HealthStatusLevel = 'healthy'

      if (!isLoaded) {
        status = 'unhealthy'
      } else if (dirtyCount >= thresholds.dirtyCountCritical) {
        status = 'unhealthy'
      } else if (dirtyCount >= thresholds.dirtyCountWarning) {
        status = 'degraded'
      }

      return {
        status,
        loaded: isLoaded,
        thingCount,
        dirtyCount,
      }
    } catch (e) {
      return {
        status: 'unhealthy',
        error: e instanceof Error ? e.message : 'State manager check failed',
      }
    }
  }

  private async checkPipelineEmitter(): Promise<ComponentHealth> {
    const pe = this.config.pipelineEmitter
    const thresholds = this.config.thresholds

    try {
      const isConnected = pe.isConnected()
      const pendingEvents = pe.getPendingCount?.() ?? 0
      const errorCount = pe.getErrorCount?.() ?? 0

      let status: HealthStatusLevel = 'healthy'

      if (!isConnected) {
        status = 'unhealthy'
      } else if (pendingEvents >= thresholds.pipelinePendingCritical) {
        status = 'degraded'
      } else if (pendingEvents >= thresholds.pipelinePendingWarning) {
        status = 'degraded'
      }

      return {
        status,
        connected: isConnected,
        pendingEvents,
        errorCount,
      }
    } catch (e) {
      return {
        status: 'unhealthy',
        error: e instanceof Error ? e.message : 'Pipeline check failed',
      }
    }
  }

  private async checkSqlStorage(): Promise<ComponentHealth> {
    const sql = this.config.sqlStorage
    const thresholds = this.config.thresholds

    try {
      const isHealthy = sql.isHealthy()
      const lastCheckpointMs = sql.getLastCheckpointTime?.() ?? Date.now()
      const pendingWrites = sql.getPendingWriteCount?.() ?? 0
      let avgQueryLatencyMs = sql.getAverageQueryLatency?.() ?? 0

      // If ping is available, use it to measure actual latency (this is async)
      if (sql.ping) {
        try {
          avgQueryLatencyMs = await sql.ping()
        } catch {
          // Ping failed - but we continue with other metrics
        }
      }

      const checkpointAgeMs = Date.now() - lastCheckpointMs
      let status: HealthStatusLevel = 'healthy'

      if (!isHealthy) {
        status = 'unhealthy'
      } else if (checkpointAgeMs >= thresholds.checkpointAgeCriticalMs) {
        status = 'unhealthy'
      } else if (checkpointAgeMs >= thresholds.checkpointAgeWarningMs) {
        status = 'degraded'
      }

      return {
        status,
        pendingWrites,
        avgQueryLatencyMs,
        lastCheckpointAgeMs: checkpointAgeMs,
      }
    } catch (e) {
      return {
        status: 'unhealthy',
        error: e instanceof Error ? e.message : 'SQL check failed',
      }
    }
  }

  private checkReplication(): ReplicationLagMetrics {
    const rm = this.config.replicationManager!
    const thresholds = this.config.thresholds

    const role = rm.getRole()
    const lagMs = rm.getReplicationLagMs()
    const lagEvents = rm.getReplicationLagEvents()
    const lastSyncMs = rm.getLastSyncTime()
    const leaderInfo = rm.getLeaderInfo()
    const followerCount = rm.getFollowerCount()

    let status: HealthStatusLevel = 'healthy'

    if (lagMs >= thresholds.replicationLagCriticalMs) {
      status = 'unhealthy'
    } else if (lagMs >= thresholds.replicationLagWarningMs) {
      status = 'degraded'
    }

    return {
      role,
      lagMs,
      lagEvents,
      lastSyncMs,
      timeSinceLastSyncMs: Date.now() - lastSyncMs,
      status,
      leader: leaderInfo ? { id: leaderInfo.leaderId, lastHeartbeatMs: leaderInfo.lastHeartbeatMs } : undefined,
      followerCount: role === 'leader' ? followerCount : undefined,
    }
  }

  private async runCustomChecks(): Promise<Record<string, ComponentHealth> | undefined> {
    if (this.customChecks.size === 0) return undefined

    const results: Record<string, ComponentHealth> = {}

    for (const [name, callback] of Array.from(this.customChecks.entries())) {
      try {
        const result = await Promise.race([
          callback(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), this.config.customCheckTimeoutMs)
          ),
        ])
        // Spread all properties from the custom check result
        // Handle details object specially - spread its contents at top level
        const { name: _name, details, ...rest } = result as any
        results[name] = {
          ...rest,
          ...(details || {}),
          status: result.status,
        }
      } catch (e) {
        const isTimeout = e instanceof Error && e.message.toLowerCase().includes('timeout')
        results[name] = {
          status: 'unhealthy',
          error: isTimeout ? 'Health check timeout' : (e instanceof Error ? e.message : 'Custom check failed'),
        }
      }
    }

    return results
  }

  private calculateOverallStatus(
    state: HealthStatusLevel,
    pipeline: HealthStatusLevel,
    sql: HealthStatusLevel,
    replication?: HealthStatusLevel
  ): HealthStatusLevel {
    // Critical components - unhealthy state or sql means overall unhealthy
    if (state === 'unhealthy' || sql === 'unhealthy') {
      return 'unhealthy'
    }

    // Non-critical components - unhealthy pipeline means degraded (not unhealthy)
    // because we can still serve requests without pipeline
    if (pipeline === 'unhealthy') {
      return 'degraded'
    }

    // Any degraded component means overall degraded
    const statuses = [state, pipeline, sql, replication].filter(Boolean) as HealthStatusLevel[]
    if (statuses.includes('degraded')) return 'degraded'
    if (statuses.includes('unknown')) return 'degraded'

    return 'healthy'
  }

  private buildTimeoutResponse(timedOut: boolean): DetailedHealthResponse['body'] {
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptimeMs: Date.now() - this.startTime,
      timedOut,
      components: {
        state: { status: 'unknown' },
        pipeline: { status: 'unknown' },
        sql: { status: 'unknown' },
      },
    }
  }

  private getHttpStatus(status: HealthStatusLevel): number {
    switch (status) {
      case 'healthy':
        return 200
      case 'degraded':
        return 200
      case 'unhealthy':
        return 503
      default:
        return 503
    }
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    }
  }
}

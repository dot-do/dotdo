/**
 * ACID Test Suite - Phase 4: Replication Fixtures
 *
 * Shared fixtures and test data for Phase 4 replication tests.
 * Used by both unit tests and E2E tests.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 4 Replication
 */

import type { ColoCode, Region } from '../../../types/Location'

// ============================================================================
// REPLICA TYPE DEFINITIONS
// ============================================================================

/**
 * Replica status indicates the current state of the replica
 */
export type ReplicaStatus = 'initializing' | 'syncing' | 'active' | 'stale' | 'disconnected' | 'promoting'

/**
 * Replica role distinguishes primary from follower
 */
export type ReplicaRole = 'primary' | 'follower' | 'standalone'

/**
 * Replica metadata stored on the DO
 */
export interface ReplicaMetadata {
  /** Role of this replica */
  role: ReplicaRole
  /** Current status */
  status: ReplicaStatus
  /** Primary namespace (for followers) */
  primaryNs?: string
  /** Array of follower namespaces (for primary) */
  followerNs?: string[]
  /** Last sync timestamp */
  lastSyncAt: Date | null
  /** Current lag in versions behind primary */
  lag: number
  /** Geographic location hint */
  location?: ColoCode | Region
  /** When this replica was created */
  createdAt: Date
  /** Current sequence number */
  sequence: number
}

/**
 * Replica handle for managing replica operations
 */
export interface ReplicaHandle {
  /** Namespace of the replica */
  ns: string
  /** DO ID of the replica */
  doId: string
  /** Get current replica metadata */
  getMetadata(): Promise<ReplicaMetadata>
  /** Get current lag */
  getLag(): Promise<number>
  /** Force sync from primary */
  sync(): Promise<void>
  /** Disconnect from primary (become standalone) */
  disconnect(): Promise<void>
  /** Promote to primary (failover) */
  promote(): Promise<FailoverResult>
}

/**
 * Failover result from promotion
 */
export interface FailoverResult {
  /** Whether failover succeeded */
  success: boolean
  /** New primary namespace */
  newPrimary?: string
  /** Old primary namespace */
  oldPrimary: string
  /** Duration of failover in milliseconds */
  durationMs: number
  /** Data loss indicator (versions lost if any) */
  dataLoss: number
  /** Replicas that were reconfigured */
  reconfiguredReplicas: string[]
  /** Error if failover failed */
  error?: string
}

/**
 * Health check result
 */
export interface HealthCheck {
  /** Status of the primary */
  status: 'healthy' | 'degraded' | 'unreachable' | 'failed'
  /** Latency in milliseconds */
  latencyMs: number
  /** Timestamp of check */
  checkedAt: Date
  /** Number of consecutive failures */
  consecutiveFailures: number
  /** Last successful check */
  lastSuccessAt: Date | null
}

/**
 * Failover configuration
 */
export interface FailoverConfig {
  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number
  /** Number of failures before triggering failover */
  failureThreshold: number
  /** Timeout for health check in milliseconds */
  healthCheckTimeoutMs: number
  /** Whether automatic failover is enabled */
  autoFailover: boolean
  /** Minimum replicas before failover can proceed */
  minReplicas: number
  /** Promotion strategy */
  promotionStrategy: 'lowest-lag' | 'designated' | 'random'
  /** Designated replica for promotion (if strategy is 'designated') */
  designatedReplica?: string
  /** Whether to require quorum for failover */
  requireQuorum: boolean
  /** Quorum size (number of replicas that must agree) */
  quorumSize?: number
}

/**
 * Failover event
 */
export interface FailoverEvent {
  /** Event type */
  type: 'started' | 'promoted' | 'reconfigured' | 'completed' | 'failed' | 'rolled_back'
  /** Old primary namespace */
  oldPrimary: string
  /** New primary namespace (if applicable) */
  newPrimary?: string
  /** Timestamp */
  timestamp: Date
  /** Additional details */
  details?: Record<string, unknown>
}

/**
 * Extended clone options for replica creation
 */
export interface ReplicaCloneOptions {
  asReplica: true
  /** Sync mode for replica */
  syncMode?: 'sync' | 'async' | 'lazy'
  /** Maximum acceptable lag before forcing sync */
  maxLag?: number
  /** Sync interval in milliseconds */
  syncInterval?: number
  /** Target colo for replica */
  colo?: string
  /** Failover configuration */
  failoverConfig?: Partial<FailoverConfig>
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Default test data for replica tests
 */
export const DEFAULT_TEST_DATA = {
  things: Array.from({ length: 50 }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    data: { index: i, name: `Item ${i}` },
    version: 1,
    branch: null,
    deleted: false,
  })),
}

/**
 * Primary DO object fixture
 */
export const PRIMARY_OBJECT = {
  ns: 'https://primary.test.do',
  class: 'DO',
  primary: true,
  sequence: 100,
  region: 'us-east',
  createdAt: new Date().toISOString(),
}

/**
 * Default failover configuration
 */
export const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  healthCheckIntervalMs: 5000,
  failureThreshold: 3,
  healthCheckTimeoutMs: 2000,
  autoFailover: false,
  minReplicas: 1,
  promotionStrategy: 'lowest-lag',
  requireQuorum: false,
}

/**
 * Test replica configurations
 */
export const TEST_REPLICAS = {
  usWest: {
    ns: 'https://replica-us-west.test.do',
    colo: 'LAX',
    region: 'us-west',
  },
  euWest: {
    ns: 'https://replica-eu.test.do',
    colo: 'LHR',
    region: 'eu-west',
  },
  asiaPacific: {
    ns: 'https://replica-asia.test.do',
    colo: 'SIN',
    region: 'asia-pacific',
  },
}

/**
 * Multi-region test configuration
 */
export const MULTI_REGION_CONFIG = {
  regions: ['us-east', 'us-west', 'eu-west', 'asia-pacific'],
  colos: {
    'us-east': ['IAD', 'EWR'],
    'us-west': ['SJC', 'LAX', 'SEA'],
    'eu-west': ['LHR', 'CDG', 'FRA', 'AMS'],
    'asia-pacific': ['NRT', 'SIN', 'HKG', 'SYD'],
  },
  latencyMatrix: {
    // Approximate RTT in ms between regions
    'us-east': { 'us-west': 60, 'eu-west': 90, 'asia-pacific': 180 },
    'us-west': { 'us-east': 60, 'eu-west': 150, 'asia-pacific': 120 },
    'eu-west': { 'us-east': 90, 'us-west': 150, 'asia-pacific': 200 },
    'asia-pacific': { 'us-east': 180, 'us-west': 120, 'eu-west': 200 },
  },
}

// ============================================================================
// FIXTURE FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a test replica metadata fixture
 */
export function createReplicaMetadata(overrides: Partial<ReplicaMetadata> = {}): ReplicaMetadata {
  return {
    role: 'follower',
    status: 'active',
    primaryNs: 'https://primary.test.do',
    lastSyncAt: new Date(),
    lag: 0,
    createdAt: new Date(),
    sequence: 100,
    ...overrides,
  }
}

/**
 * Create a test failover result fixture
 */
export function createFailoverResult(overrides: Partial<FailoverResult> = {}): FailoverResult {
  return {
    success: true,
    oldPrimary: 'https://primary.test.do',
    newPrimary: 'https://replica.test.do',
    durationMs: 500,
    dataLoss: 0,
    reconfiguredReplicas: [],
    ...overrides,
  }
}

/**
 * Create a test health check fixture
 */
export function createHealthCheck(overrides: Partial<HealthCheck> = {}): HealthCheck {
  return {
    status: 'healthy',
    latencyMs: 10,
    checkedAt: new Date(),
    consecutiveFailures: 0,
    lastSuccessAt: new Date(),
    ...overrides,
  }
}

/**
 * Create test things data with specified count
 */
export function createTestThings(count: number, prefix: string = 'thing'): typeof DEFAULT_TEST_DATA.things {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    type: 1,
    data: { index: i, name: `${prefix} ${i}`, createdAt: Date.now() },
    version: i + 1,
    branch: null,
    deleted: false,
  }))
}

/**
 * Generate a test namespace URL
 */
export function generateTestNs(prefix: string = 'test'): string {
  const id = Math.random().toString(36).slice(2, 10)
  return `https://${prefix}-${id}.test.do`
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Assert replica is in expected state
 */
export function assertReplicaState(
  metadata: ReplicaMetadata,
  expected: {
    role?: ReplicaRole
    status?: ReplicaStatus
    maxLag?: number
  }
): void {
  if (expected.role !== undefined && metadata.role !== expected.role) {
    throw new Error(`Expected replica role ${expected.role}, got ${metadata.role}`)
  }

  if (expected.status !== undefined && metadata.status !== expected.status) {
    throw new Error(`Expected replica status ${expected.status}, got ${metadata.status}`)
  }

  if (expected.maxLag !== undefined && metadata.lag > expected.maxLag) {
    throw new Error(`Expected replica lag <= ${expected.maxLag}, got ${metadata.lag}`)
  }
}

/**
 * Assert failover succeeded
 */
export function assertFailoverSuccess(result: FailoverResult): void {
  if (!result.success) {
    throw new Error(`Failover failed: ${result.error ?? 'unknown error'}`)
  }

  if (result.dataLoss > 0) {
    console.warn(`Failover completed with ${result.dataLoss} versions of data loss`)
  }
}

/**
 * Assert replication topology is healthy
 */
export function assertTopologyHealthy(
  topology: {
    primary: { ns: string }
    replicas: Array<{ status: ReplicaStatus; lag: number }>
    healthyReplicas: number
    totalReplicas: number
  },
  options: {
    minHealthy?: number
    maxLag?: number
  } = {}
): void {
  const { minHealthy = 1, maxLag = 1000 } = options

  if (topology.healthyReplicas < minHealthy) {
    throw new Error(
      `Expected at least ${minHealthy} healthy replicas, got ${topology.healthyReplicas}`
    )
  }

  const highLagReplicas = topology.replicas.filter((r) => r.lag > maxLag)
  if (highLagReplicas.length > 0) {
    throw new Error(
      `${highLagReplicas.length} replicas have lag > ${maxLag}ms`
    )
  }

  const nonActiveReplicas = topology.replicas.filter((r) => r.status !== 'active')
  if (nonActiveReplicas.length > 0) {
    console.warn(
      `${nonActiveReplicas.length} replicas are not active: ${nonActiveReplicas.map((r) => r.status).join(', ')}`
    )
  }
}

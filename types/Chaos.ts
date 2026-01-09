/**
 * Chaos Testing Types for Failure Injection
 *
 * Jepsen-inspired chaos testing types for validating distributed system
 * correctness under failure conditions. These types support:
 * - Network partition simulation
 * - DO crash and recovery scenarios
 * - Pipeline backpressure handling
 * - Transient and persistent failure modes
 *
 * @see https://jepsen.io/ for inspiration
 * @task dotdo-ga1r (ACID Phase 6 - Failure Injection)
 */

// ============================================================================
// Failure Types
// ============================================================================

/**
 * Types of failures that can be injected
 */
export type FailureType =
  | 'network_partition'
  | 'do_crash'
  | 'do_restart'
  | 'pipeline_backpressure'
  | 'storage_failure'
  | 'timeout'
  | 'rate_limit'
  | 'oom' // Out of memory
  | 'cpu_exhaustion'
  | 'clock_skew'

/**
 * Failure severity levels
 */
export type FailureSeverity = 'transient' | 'persistent' | 'intermittent'

/**
 * Pattern for intermittent failures
 */
export type IntermittentPattern =
  | 'random' // Random failures with probability
  | 'burst' // Failures in bursts
  | 'periodic' // Regular periodic failures
  | 'degrading' // Increasingly frequent failures
  | 'recovering' // Decreasingly frequent failures

// ============================================================================
// Network Partition Types
// ============================================================================

/**
 * Network partition configuration
 */
export interface NetworkPartitionConfig {
  /** Type of partition */
  type: 'full' | 'partial' | 'asymmetric'
  /** Nodes affected by the partition */
  affectedNodes: string[]
  /** Duration of the partition (ms), undefined = permanent */
  duration?: number
  /** Partition behavior */
  behavior: PartitionBehavior
}

/**
 * How the partition behaves
 */
export interface PartitionBehavior {
  /** How requests to partitioned nodes are handled */
  requestHandling: 'drop' | 'timeout' | 'error'
  /** Timeout duration if requestHandling is 'timeout' (ms) */
  timeoutMs?: number
  /** Error code/message if requestHandling is 'error' */
  error?: {
    code: string
    message: string
  }
  /** For partial partitions: probability of request success (0-1) */
  successRate?: number
}

/**
 * Result of a network partition operation
 */
export interface NetworkPartitionResult {
  /** Partition ID for tracking/healing */
  partitionId: string
  /** Nodes that are partitioned */
  partitionedNodes: string[]
  /** Time partition was created */
  createdAt: Date
  /** Scheduled heal time (if duration was set) */
  healAt?: Date
  /** Current status */
  status: 'active' | 'healing' | 'healed'
}

// ============================================================================
// DO Crash Types
// ============================================================================

/**
 * DO crash configuration
 */
export interface DOCrashConfig {
  /** Target DO namespace */
  targetNs: string
  /** Type of crash */
  crashType: 'immediate' | 'graceful' | 'oom' | 'infinite_loop'
  /** Whether the DO should restart automatically */
  autoRestart: boolean
  /** Delay before restart (ms), if autoRestart is true */
  restartDelay?: number
  /** State preservation mode during crash */
  statePreservation: 'none' | 'partial' | 'full'
  /** Callback before crash (for setting up assertions) */
  beforeCrash?: () => Promise<void>
  /** Callback after restart (for verifying recovery) */
  afterRestart?: () => Promise<void>
}

/**
 * Result of a DO crash operation
 */
export interface DOCrashResult {
  /** Crash event ID */
  crashId: string
  /** Target DO namespace */
  targetNs: string
  /** Time of crash */
  crashedAt: Date
  /** Time of restart (if applicable) */
  restartedAt?: Date
  /** State that was preserved */
  preservedState?: {
    /** Number of items preserved */
    itemCount: number
    /** Storage operations in flight at crash time */
    pendingOperations: number
    /** Whether WAL was flushed */
    walFlushed: boolean
  }
  /** Recovery status */
  recovery: RecoveryStatus
}

/**
 * Recovery status after crash
 */
export interface RecoveryStatus {
  /** Whether recovery was successful */
  successful: boolean
  /** Recovery strategy used */
  strategy: 'wal_replay' | 'checkpoint' | 'full_rebuild' | 'none'
  /** Items recovered */
  itemsRecovered: number
  /** Items lost */
  itemsLost: number
  /** Time taken to recover (ms) */
  recoveryTimeMs: number
  /** Errors during recovery */
  errors: RecoveryError[]
}

/**
 * Error encountered during recovery
 */
export interface RecoveryError {
  /** Error type */
  type: 'data_corruption' | 'missing_data' | 'constraint_violation' | 'timeout'
  /** Affected item ID */
  itemId?: string
  /** Error message */
  message: string
  /** Whether the error was recoverable */
  recoverable: boolean
}

// ============================================================================
// Pipeline Backpressure Types
// ============================================================================

/**
 * Pipeline backpressure configuration
 */
export interface BackpressureConfig {
  /** Target pipeline binding */
  pipeline: string
  /** Backpressure intensity */
  intensity: 'light' | 'moderate' | 'severe' | 'complete'
  /** Duration of backpressure (ms), undefined = permanent */
  duration?: number
  /** Queue behavior when backpressure is applied */
  queueBehavior: QueueBehavior
  /** Rate limiting configuration */
  rateLimit?: {
    /** Maximum events per second */
    maxEventsPerSecond: number
    /** Burst allowance */
    burstSize: number
  }
}

/**
 * Queue behavior during backpressure
 */
export interface QueueBehavior {
  /** Maximum queue size before dropping/rejecting */
  maxQueueSize: number
  /** What to do when queue is full */
  onQueueFull: 'drop_oldest' | 'drop_newest' | 'reject' | 'block'
  /** Timeout for blocked operations (ms) */
  blockTimeoutMs?: number
}

/**
 * Result of backpressure application
 */
export interface BackpressureResult {
  /** Backpressure session ID */
  sessionId: string
  /** Time backpressure was applied */
  appliedAt: Date
  /** Time backpressure was released (if applicable) */
  releasedAt?: Date
  /** Statistics during backpressure */
  stats: BackpressureStats
}

/**
 * Statistics collected during backpressure
 */
export interface BackpressureStats {
  /** Total events queued */
  eventsQueued: number
  /** Events dropped due to queue full */
  eventsDropped: number
  /** Events rejected (returned error to caller) */
  eventsRejected: number
  /** Events successfully processed despite backpressure */
  eventsProcessed: number
  /** Maximum queue depth reached */
  maxQueueDepth: number
  /** Average queue wait time (ms) */
  avgQueueWaitMs: number
  /** P99 queue wait time (ms) */
  p99QueueWaitMs: number
}

// ============================================================================
// Chaos Scenario Types
// ============================================================================

/**
 * Complete chaos scenario configuration
 */
export interface ChaosScenario {
  /** Scenario name */
  name: string
  /** Description */
  description: string
  /** Failures to inject */
  failures: FailureInjection[]
  /** Order of failure injection */
  order: 'sequential' | 'parallel' | 'random'
  /** Duration of the scenario (ms) */
  duration: number
  /** Assertions to verify after scenario */
  assertions: ChaosAssertion[]
  /** Recovery verification */
  recoveryVerification?: RecoveryVerification
}

/**
 * Individual failure injection in a scenario
 */
export interface FailureInjection {
  /** Failure type */
  type: FailureType
  /** When to inject (ms from scenario start) */
  injectAt: number
  /** Duration of the failure (ms), undefined = permanent until scenario end */
  duration?: number
  /** Failure-specific configuration */
  config: NetworkPartitionConfig | DOCrashConfig | BackpressureConfig | GenericFailureConfig
  /** Severity */
  severity: FailureSeverity
  /** For intermittent failures */
  intermittent?: {
    pattern: IntermittentPattern
    /** Probability of failure (0-1) for random pattern */
    probability?: number
    /** Interval between failures (ms) for periodic pattern */
    interval?: number
    /** Number of failures in a burst for burst pattern */
    burstSize?: number
  }
}

/**
 * Generic failure configuration for simple failures
 */
export interface GenericFailureConfig {
  /** Target (namespace, binding, etc.) */
  target: string
  /** Parameters specific to the failure type */
  params: Record<string, unknown>
}

/**
 * Assertion to verify after chaos scenario
 */
export interface ChaosAssertion {
  /** Assertion name */
  name: string
  /** Property being asserted */
  property: ChaosProperty
  /** Expected value or constraint */
  expected: AssertionExpectation
}

/**
 * Properties that can be asserted after chaos
 */
export type ChaosProperty =
  | 'data_integrity' // All data is consistent
  | 'no_data_loss' // No data was lost
  | 'eventual_consistency' // System reached consistent state
  | 'linearizability' // Operations appear in order
  | 'availability' // System remained available
  | 'durability' // Committed data persisted
  | 'recovery_time' // Time to recover within bounds

/**
 * Expectation for assertion
 */
export interface AssertionExpectation {
  /** Type of expectation */
  type: 'equals' | 'lessThan' | 'greaterThan' | 'within' | 'true'
  /** Value for comparison */
  value?: unknown
  /** Tolerance for 'within' comparisons */
  tolerance?: number
}

/**
 * Recovery verification configuration
 */
export interface RecoveryVerification {
  /** Maximum time allowed for recovery (ms) */
  maxRecoveryTimeMs: number
  /** Expected recovery strategy */
  expectedStrategy?: 'automatic' | 'manual' | 'hybrid'
  /** Verification checks to perform */
  checks: RecoveryCheck[]
}

/**
 * Individual recovery check
 */
export interface RecoveryCheck {
  /** Check name */
  name: string
  /** What to check */
  checkType: 'data_presence' | 'data_integrity' | 'service_health' | 'replication_lag'
  /** Check-specific parameters */
  params?: Record<string, unknown>
}

// ============================================================================
// Chaos Execution Types
// ============================================================================

/**
 * Result of executing a chaos scenario
 */
export interface ChaosExecutionResult {
  /** Scenario that was executed */
  scenario: ChaosScenario
  /** Start time */
  startedAt: Date
  /** End time */
  endedAt: Date
  /** Duration (ms) */
  durationMs: number
  /** Individual failure results */
  failureResults: FailureExecutionResult[]
  /** Assertion results */
  assertionResults: AssertionResult[]
  /** Recovery verification result */
  recoveryResult?: RecoveryVerificationResult
  /** Overall status */
  status: 'passed' | 'failed' | 'error'
  /** Summary */
  summary: ChaosSummary
}

/**
 * Result of executing a single failure injection
 */
export interface FailureExecutionResult {
  /** Failure injection config */
  injection: FailureInjection
  /** Whether injection succeeded */
  injected: boolean
  /** Time of injection */
  injectedAt?: Date
  /** Time failure was healed/ended */
  healedAt?: Date
  /** Observed effects */
  effects: FailureEffect[]
  /** Errors during injection */
  errors: string[]
}

/**
 * Observed effect of a failure
 */
export interface FailureEffect {
  /** Type of effect */
  type: 'request_failed' | 'request_timeout' | 'data_unavailable' | 'replication_stopped' | 'queue_buildup'
  /** Count of occurrences */
  count: number
  /** Duration the effect was observed (ms) */
  durationMs: number
  /** Additional details */
  details?: Record<string, unknown>
}

/**
 * Result of a single assertion
 */
export interface AssertionResult {
  /** Assertion that was checked */
  assertion: ChaosAssertion
  /** Whether it passed */
  passed: boolean
  /** Actual value observed */
  actualValue?: unknown
  /** Error message if failed */
  errorMessage?: string
}

/**
 * Result of recovery verification
 */
export interface RecoveryVerificationResult {
  /** Whether recovery completed within time limit */
  recoveredInTime: boolean
  /** Actual recovery time (ms) */
  actualRecoveryTimeMs: number
  /** Check results */
  checkResults: RecoveryCheckResult[]
  /** Overall recovery status */
  status: 'full_recovery' | 'partial_recovery' | 'no_recovery'
}

/**
 * Result of a single recovery check
 */
export interface RecoveryCheckResult {
  /** Check that was performed */
  check: RecoveryCheck
  /** Whether it passed */
  passed: boolean
  /** Details */
  details?: Record<string, unknown>
}

/**
 * Summary of chaos execution
 */
export interface ChaosSummary {
  /** Total failures injected */
  totalFailuresInjected: number
  /** Failures that were successfully healed */
  failuresHealed: number
  /** Assertions that passed */
  assertionsPassed: number
  /** Assertions that failed */
  assertionsFailed: number
  /** Total data operations during chaos */
  dataOperations: number
  /** Data operations that failed */
  dataOperationsFailed: number
  /** System availability percentage during chaos */
  availabilityPercent: number
}

// ============================================================================
// Chaos Controller Interface
// ============================================================================

/**
 * Controller for managing chaos scenarios
 */
export interface ChaosController {
  /**
   * Inject a network partition
   */
  partition(config: NetworkPartitionConfig): Promise<NetworkPartitionResult>

  /**
   * Heal a network partition
   */
  healPartition(partitionId: string): Promise<void>

  /**
   * Crash a Durable Object
   */
  crashDO(config: DOCrashConfig): Promise<DOCrashResult>

  /**
   * Restart a crashed DO
   */
  restartDO(targetNs: string): Promise<void>

  /**
   * Apply pipeline backpressure
   */
  applyBackpressure(config: BackpressureConfig): Promise<BackpressureResult>

  /**
   * Release pipeline backpressure
   */
  releaseBackpressure(sessionId: string): Promise<BackpressureStats>

  /**
   * Run a complete chaos scenario
   */
  runScenario(scenario: ChaosScenario): Promise<ChaosExecutionResult>

  /**
   * Get current chaos state
   */
  getState(): ChaosState

  /**
   * Reset all injected failures
   */
  reset(): Promise<void>
}

/**
 * Current state of chaos controller
 */
export interface ChaosState {
  /** Active partitions */
  activePartitions: NetworkPartitionResult[]
  /** Crashed DOs */
  crashedDOs: DOCrashResult[]
  /** Active backpressure sessions */
  activeBackpressure: BackpressureResult[]
  /** Pending failures to inject */
  pendingInjections: FailureInjection[]
}

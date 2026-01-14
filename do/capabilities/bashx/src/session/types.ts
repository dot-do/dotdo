/**
 * Session Persistence Types
 *
 * Types for R2 Iceberg session recovery with fork/branch/experiment primitives.
 * Enables session state persistence, recovery from DO eviction, and parallel
 * AI agent experimentation.
 *
 * @module bashx/session/types
 */

import type { BashResult, SafetyClassification, ExecOptions } from '../types.js'

// ============================================================================
// Core Session Types
// ============================================================================

/**
 * Unique session identifier.
 * Format: "session-{uuid}" or custom names like "experiment-1-fork-2"
 */
export type SessionId = string

/**
 * Complete session state that can be serialized for persistence.
 * This is the "commit" equivalent - a snapshot of everything needed
 * to recreate a session.
 */
export interface SessionState {
  /** Unique session identifier */
  id: SessionId

  /** Parent session ID (for fork lineage tracking) */
  parentId?: SessionId

  /** Creation timestamp (ms since epoch) */
  createdAt: number

  /** Last update timestamp (ms since epoch) */
  updatedAt: number

  /** Current working directory */
  cwd: string

  /** Environment variables */
  env: Record<string, string>

  /** Command history with results */
  history: CommandHistoryEntry[]

  /** Filesystem state reference (gitx tree hash, 40-char hex) */
  treeHash: string

  /** Running or suspended process state (for recovery) */
  processes: ProcessState[]

  /** Session configuration */
  config: SessionConfig

  /** Observability metrics */
  metrics: SessionMetrics
}

/**
 * A single command execution record in session history.
 * Contains before/after state for time-travel and undo.
 */
export interface CommandHistoryEntry {
  /** Unique ID for this execution */
  id: string

  /** Sequence number in session (0-indexed) */
  seq: number

  /** The command input (raw command or natural language) */
  input: string

  /** The actual command executed (may differ from input if generated) */
  command: string

  /** Was this command generated from natural language? */
  generated: boolean

  /** Safety classification at time of execution */
  classification: SafetyClassification

  /** Execution result */
  result: CommandResult

  /** Filesystem tree hash BEFORE execution */
  treeBeforeHash: string

  /** Filesystem tree hash AFTER execution */
  treeAfterHash: string

  /** Execution start timestamp */
  timestamp: number

  /** Execution duration in milliseconds */
  duration: number
}

/**
 * Simplified command result stored in history.
 * Full BashResult may be too large for persistent storage.
 */
export interface CommandResult {
  /** Exit code (0 = success) */
  exitCode: number

  /** Standard output (may be truncated) */
  stdout: string

  /** Standard error output (may be truncated) */
  stderr: string

  /** Whether output was truncated due to size limits */
  truncated: boolean
}

/**
 * State of a running or suspended process.
 * Used for potential process recovery on session restore.
 */
export interface ProcessState {
  /** Process ID */
  pid: number

  /** Command that started the process */
  command: string

  /** Process start time */
  startedAt: number

  /** Current status */
  status: 'running' | 'suspended' | 'zombie'

  /** Can this process be recovered after DO eviction? */
  recoverable: boolean
}

/**
 * Session configuration options.
 */
export interface SessionConfig {
  /** Shell to use for command execution */
  shell: '/bin/bash' | '/bin/sh' | '/bin/zsh'

  /** Default timeout for commands (ms) */
  defaultTimeout: number

  /** Maximum output capture size (bytes) */
  maxOutputSize: number

  /** Checkpoint configuration */
  checkpoint: CheckpointConfig
}

/**
 * Configuration for automatic checkpointing.
 */
export interface CheckpointConfig {
  /** Checkpoint after N commands executed */
  commandThreshold: number

  /** Checkpoint after N seconds of idle (no commands) */
  idleTimeout: number

  /** Minimum interval between checkpoints (seconds) */
  minInterval: number

  /** Maximum WAL entries to replay on recovery */
  maxReplayOps: number
}

/**
 * Session metrics for observability and debugging.
 */
export interface SessionMetrics {
  /** Total commands executed */
  commandCount: number

  /** Total execution time (ms) */
  totalDuration: number

  /** Last checkpoint timestamp */
  lastCheckpointAt: number

  /** Number of checkpoints created */
  checkpointCount: number

  /** Number of forks created from this session */
  forkCount: number

  /** Number of times this session was recovered */
  recoveryCount: number

  /** Number of experiments run */
  experimentCount: number

  /** Number of successful recoveries */
  recoverySuccessCount: number

  /** Number of failed recoveries */
  recoveryFailureCount: number

  /** Total checkpoint duration (ms) */
  totalCheckpointDuration: number

  /** Average checkpoint duration (ms) */
  avgCheckpointDuration: number

  /** Minimum checkpoint duration (ms) */
  minCheckpointDuration: number

  /** Maximum checkpoint duration (ms) */
  maxCheckpointDuration: number
}

// ============================================================================
// Metrics Collector Types
// ============================================================================

/**
 * Event types emitted by session operations.
 */
export type SessionEventType =
  | 'session:created'
  | 'session:loaded'
  | 'session:disposed'
  | 'command:start'
  | 'command:end'
  | 'checkpoint:start'
  | 'checkpoint:end'
  | 'fork:start'
  | 'fork:end'
  | 'branch:created'
  | 'experiment:start'
  | 'experiment:end'
  | 'recovery:start'
  | 'recovery:success'
  | 'recovery:failure'

/**
 * Base event data shared by all events.
 */
export interface SessionEventBase {
  /** Event type */
  type: SessionEventType

  /** Session ID */
  sessionId: SessionId

  /** Event timestamp */
  timestamp: number
}

/**
 * Event emitted when a session is created.
 */
export interface SessionCreatedEvent extends SessionEventBase {
  type: 'session:created'
}

/**
 * Event emitted when a session is loaded from storage.
 */
export interface SessionLoadedEvent extends SessionEventBase {
  type: 'session:loaded'

  /** Checkpoint hash used for recovery */
  checkpointHash: string

  /** Number of WAL entries replayed */
  walEntriesReplayed: number
}

/**
 * Event emitted when a session is disposed.
 */
export interface SessionDisposedEvent extends SessionEventBase {
  type: 'session:disposed'

  /** Session lifetime in ms */
  lifetimeMs: number
}

/**
 * Event emitted when a command starts execution.
 */
export interface CommandStartEvent extends SessionEventBase {
  type: 'command:start'

  /** Command being executed */
  command: string

  /** Command sequence number */
  seq: number
}

/**
 * Event emitted when a command finishes execution.
 */
export interface CommandEndEvent extends SessionEventBase {
  type: 'command:end'

  /** Command that was executed */
  command: string

  /** Command sequence number */
  seq: number

  /** Exit code */
  exitCode: number

  /** Duration in ms */
  durationMs: number

  /** Whether the command was generated from natural language */
  generated: boolean
}

/**
 * Event emitted when a checkpoint starts.
 */
export interface CheckpointStartEvent extends SessionEventBase {
  type: 'checkpoint:start'

  /** Checkpoint type */
  checkpointType: CheckpointType
}

/**
 * Event emitted when a checkpoint completes.
 */
export interface CheckpointEndEvent extends SessionEventBase {
  type: 'checkpoint:end'

  /** Checkpoint type */
  checkpointType: CheckpointType

  /** Checkpoint hash */
  hash: string

  /** Duration in ms */
  durationMs: number

  /** Checkpoint size in bytes */
  sizeBytes: number
}

/**
 * Event emitted when a fork starts.
 */
export interface ForkStartEvent extends SessionEventBase {
  type: 'fork:start'

  /** Name of the fork (if provided) */
  forkName?: string
}

/**
 * Event emitted when a fork completes.
 */
export interface ForkEndEvent extends SessionEventBase {
  type: 'fork:end'

  /** New fork session ID */
  forkSessionId: SessionId

  /** Fork point checkpoint hash */
  forkPointHash: string

  /** Duration in ms */
  durationMs: number
}

/**
 * Event emitted when a branch is created.
 */
export interface BranchCreatedEvent extends SessionEventBase {
  type: 'branch:created'

  /** Branch name */
  branchName: string

  /** Checkpoint hash */
  checkpointHash: string
}

/**
 * Event emitted when an experiment starts.
 */
export interface ExperimentStartEvent extends SessionEventBase {
  type: 'experiment:start'

  /** Number of parallel experiments */
  experimentCount: number

  /** Commands being run */
  commands: string[]
}

/**
 * Event emitted when an experiment completes.
 */
export interface ExperimentEndEvent extends SessionEventBase {
  type: 'experiment:end'

  /** Number of experiments that completed */
  completedCount: number

  /** Number of successful experiments */
  successCount: number

  /** Total duration in ms */
  durationMs: number

  /** Winner session ID (if any) */
  winnerId?: SessionId
}

/**
 * Event emitted when recovery starts.
 */
export interface RecoveryStartEvent extends SessionEventBase {
  type: 'recovery:start'

  /** Checkpoint hash being recovered from */
  checkpointHash: string
}

/**
 * Event emitted when recovery succeeds.
 */
export interface RecoverySuccessEvent extends SessionEventBase {
  type: 'recovery:success'

  /** Checkpoint hash recovered from */
  checkpointHash: string

  /** Duration in ms */
  durationMs: number

  /** Number of WAL entries replayed */
  walEntriesReplayed: number
}

/**
 * Event emitted when recovery fails.
 */
export interface RecoveryFailureEvent extends SessionEventBase {
  type: 'recovery:failure'

  /** Error message */
  error: string

  /** Checkpoint hash attempted */
  checkpointHash?: string
}

/**
 * Union of all session events.
 */
export type SessionEvent =
  | SessionCreatedEvent
  | SessionLoadedEvent
  | SessionDisposedEvent
  | CommandStartEvent
  | CommandEndEvent
  | CheckpointStartEvent
  | CheckpointEndEvent
  | ForkStartEvent
  | ForkEndEvent
  | BranchCreatedEvent
  | ExperimentStartEvent
  | ExperimentEndEvent
  | RecoveryStartEvent
  | RecoverySuccessEvent
  | RecoveryFailureEvent

/**
 * Interface for collecting session metrics and events.
 *
 * Implementations can:
 * - Log events for debugging
 * - Send to monitoring systems (e.g., CloudWatch, Datadog)
 * - Aggregate for analytics
 * - Store for audit trails
 */
export interface SessionMetricsCollector {
  /**
   * Record a session event.
   * Called at key points in the session lifecycle.
   */
  emit(event: SessionEvent): void

  /**
   * Flush any buffered metrics.
   * Called when session is disposed or at periodic intervals.
   */
  flush?(): Promise<void>
}

/**
 * No-op metrics collector for when metrics are not needed.
 */
export const noopMetricsCollector: SessionMetricsCollector = {
  emit: () => {},
  flush: async () => {},
}

// ============================================================================
// Checkpoint Types
// ============================================================================

/**
 * A checkpoint is a persisted SessionState with metadata.
 * Analogous to a git commit - content-addressed and immutable.
 */
export interface Checkpoint {
  /** Content hash of this checkpoint (40-char hex SHA-1) */
  hash: string

  /** Session state at this checkpoint */
  state: SessionState

  /** Parent checkpoint hash (null for initial checkpoint) */
  parentHash: string | null

  /** How this checkpoint was created */
  type: CheckpointType

  /** Optional user message (for manual checkpoints) */
  message?: string

  /** R2 storage key for this checkpoint */
  r2Key: string

  /** Serialized size in bytes */
  size: number

  /** Compression algorithm used */
  compression: 'gzip' | 'zstd' | 'none'
}

/**
 * How a checkpoint was triggered.
 */
export type CheckpointType = 'auto' | 'manual' | 'fork' | 'branch' | 'experiment'

/**
 * Reference to a checkpoint (like git ref).
 * Used for branches, forks, HEAD, etc.
 */
export interface SessionRef {
  /** Reference name (e.g., "main", "fork/exp-1", "branch/before-refactor") */
  name: string

  /** Checkpoint hash this ref points to */
  checkpointHash: string

  /** Type of reference */
  type: RefType

  /** Session ID this ref belongs to */
  sessionId: SessionId

  /** Last update timestamp */
  updatedAt: number

  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Type of session reference.
 */
export type RefType = 'head' | 'branch' | 'fork' | 'experiment'

// ============================================================================
// Branch Types (for gitx integration)
// ============================================================================

/**
 * A session branch with full metadata.
 *
 * Extends SessionRef with additional fields for branch-specific operations.
 * Used with BranchStorage implementations like GitxBranchStorage.
 *
 * @example
 * ```typescript
 * const branch: SessionBranch = {
 *   name: 'before-refactor',
 *   checkpointHash: 'abc123...',
 *   type: 'branch',
 *   sessionId: 'session-123',
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   metadata: { author: 'user', message: 'Before major refactor' }
 * }
 * ```
 */
export interface SessionBranch {
  /** Branch name (without path prefix) */
  name: string

  /** Checkpoint hash this branch points to */
  checkpointHash: string

  /** Type is always 'branch' for SessionBranch */
  type: 'branch'

  /** Session ID this branch belongs to */
  sessionId: SessionId

  /** Timestamp when branch was created */
  createdAt: number

  /** Timestamp when branch was last updated */
  updatedAt?: number

  /** Additional metadata (author, message, etc.) */
  metadata?: Record<string, unknown>
}

/**
 * Abstract storage interface for session branches.
 *
 * This interface defines the contract for branch storage backends.
 * Implementations can use different storage mechanisms:
 * - In-memory (for testing)
 * - R2/KV (default CheckpointStorage)
 * - gitx RefStorage (for Git semantics)
 *
 * @example
 * ```typescript
 * // Using GitxBranchStorage
 * const storage: BranchStorage = new GitxBranchStorage(sessionId, gitxAdapter)
 *
 * // Save a branch
 * await storage.saveBranch(branch)
 *
 * // List branches
 * const branches = await storage.listBranches()
 * ```
 */
export interface BranchStorage {
  /**
   * Save a branch to storage.
   * Creates or updates the branch.
   *
   * @param branch - The branch to save
   */
  saveBranch(branch: SessionBranch): Promise<void>

  /**
   * Get a branch by name.
   *
   * @param name - The branch name
   * @returns The branch, or null if not found
   */
  getBranch(name: string): Promise<SessionBranch | null>

  /**
   * List all branches for the session.
   *
   * @returns Array of all branches
   */
  listBranches(): Promise<SessionBranch[]>

  /**
   * Delete a branch by name.
   *
   * @param name - The branch name to delete
   * @returns true if deleted, false if branch didn't exist
   */
  deleteBranch(name: string): Promise<boolean>

  /**
   * Check if a branch exists.
   *
   * @param name - The branch name
   * @returns true if branch exists
   */
  branchExists?(name: string): Promise<boolean>
}

// ============================================================================
// Write-Ahead Log Types
// ============================================================================

/**
 * Write-Ahead Log entry for recent operations.
 * Stored in DO SQLite for fast writes, compacted into checkpoints on flush.
 */
export interface WALEntry {
  /** Entry sequence number (monotonically increasing) */
  seq: number

  /** Operation type */
  op: WALOperationType

  /** Operation-specific data */
  data: WALOperationData

  /** Timestamp when operation occurred */
  timestamp: number

  /** Has this entry been included in a checkpoint? */
  checkpointed: boolean
}

/**
 * Types of operations recorded in WAL.
 */
export type WALOperationType = 'command' | 'env' | 'cwd' | 'file'

/**
 * Union of all WAL operation data types.
 */
export type WALOperationData = CommandHistoryEntry | EnvChange | CwdChange | FileChange

/**
 * Environment variable change record.
 */
export interface EnvChange {
  /** Variable name */
  key: string

  /** Previous value (undefined if new) */
  oldValue: string | undefined

  /** New value (undefined if deleted) */
  newValue: string | undefined
}

/**
 * Working directory change record.
 */
export interface CwdChange {
  /** Previous working directory */
  oldCwd: string

  /** New working directory */
  newCwd: string
}

/**
 * Filesystem change record.
 */
export interface FileChange {
  /** File path affected */
  path: string

  /** Type of change */
  op: 'create' | 'modify' | 'delete' | 'rename'

  /** Previous content hash (for modify/delete) */
  oldHash?: string

  /** New content hash (for create/modify) */
  newHash?: string

  /** Original path (for rename) */
  renamedFrom?: string
}

// ============================================================================
// Fork/Branch/Experiment Types
// ============================================================================

/**
 * Options for creating a fork.
 */
export interface ForkOptions {
  /** Optional name for the fork (defaults to auto-generated) */
  name?: string

  /** Fork from a specific checkpoint (defaults to current state) */
  fromCheckpoint?: string

  /** Include WAL entries since checkpoint? */
  includeWAL?: boolean

  /** Additional metadata to attach */
  metadata?: Record<string, unknown>
}

/**
 * Result of a fork operation.
 */
export interface ForkResult {
  /** New session ID */
  sessionId: SessionId

  /** Initial state of the forked session */
  state: SessionState

  /** Checkpoint hash of the fork point */
  forkPoint: string

  /** Reference created for the fork */
  ref: SessionRef
}

/**
 * Options for creating a branch.
 */
export interface BranchOptions {
  /** Branch name (required) */
  name: string

  /** Optional message describing the branch */
  message?: string

  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Result of a branch operation.
 */
export interface BranchResult {
  /** The created branch reference */
  ref: SessionRef

  /** Checkpoint hash the branch points to */
  checkpointHash: string
}

/**
 * Configuration for running experiments.
 */
export interface ExperimentConfig {
  /** Commands to run in parallel (one per fork) */
  commands?: string[]

  /** Single command to run with different configs */
  command?: string

  /** Different configurations for the single command */
  configs?: Partial<SessionConfig>[]

  /** Timeout for each experiment (ms) */
  timeout?: number

  /** Metric to compare results by */
  compareBy?: ExperimentCompareMetric

  /** Custom comparison function */
  compareFn?: (results: ExperimentResult[]) => ExperimentComparison

  /** Keep fork sessions after experiment? */
  keepForks?: boolean

  /** Maximum parallel experiments */
  maxParallel?: number
}

/**
 * Built-in comparison metrics.
 */
export type ExperimentCompareMetric = 'exitCode' | 'output' | 'duration' | 'custom'

/**
 * Result of a single experiment run.
 */
export interface ExperimentResult {
  /** Fork session ID */
  forkId: SessionId

  /** Command executed */
  command: string

  /** Execution result (null if error) */
  result: BashResult | null

  /** Execution duration (ms) */
  duration: number

  /** Final filesystem tree hash */
  treeHash: string

  /** Error message if failed */
  error?: string
}

/**
 * Comparison of experiment results.
 */
export interface ExperimentComparison {
  /** Session ID of the "winner" (by compareBy metric) */
  winner?: SessionId

  /** Results sorted by metric (best first) */
  ranked: ExperimentResult[]

  /** Pairwise diffs between results */
  diffs: ResultDiff[]

  /** Aggregate statistics */
  stats: ExperimentStats
}

/**
 * Statistics across all experiment results.
 */
export interface ExperimentStats {
  /** Minimum duration (ms) */
  minDuration: number

  /** Maximum duration (ms) */
  maxDuration: number

  /** Average duration (ms) */
  avgDuration: number

  /** Fraction of successful experiments (0-1) */
  successRate: number
}

/**
 * Diff between two experiment results.
 */
export interface ResultDiff {
  /** First session being compared */
  forkA: SessionId

  /** Second session being compared */
  forkB: SessionId

  /** Difference in exit codes */
  exitCodeDiff: number

  /** Unified diff of stdout */
  stdoutDiff: string

  /** Unified diff of stderr */
  stderrDiff: string

  /** Filesystem differences */
  filesDiff: TreeDiff[]
}

/**
 * A single file difference between trees.
 */
export interface TreeDiff {
  /** File path */
  path: string

  /** Type of change */
  type: 'added' | 'removed' | 'modified'

  /** Hash in first tree (undefined if added) */
  oldHash?: string

  /** Hash in second tree (undefined if removed) */
  newHash?: string
}

// ============================================================================
// Storage Types
// ============================================================================

/**
 * Abstract storage interface for R2 operations.
 */
export interface CheckpointStorage {
  /** Store a checkpoint */
  putCheckpoint(checkpoint: Checkpoint): Promise<void>

  /** Retrieve a checkpoint by hash */
  getCheckpoint(hash: string): Promise<Checkpoint | null>

  /** Check if checkpoint exists */
  hasCheckpoint(hash: string): Promise<boolean>

  /** Delete a checkpoint */
  deleteCheckpoint(hash: string): Promise<void>

  /** Store a reference */
  putRef(ref: SessionRef): Promise<void>

  /** Get a reference by name */
  getRef(name: string): Promise<SessionRef | null>

  /** List references matching prefix */
  listRefs(prefix: string): Promise<SessionRef[]>

  /** Delete a reference */
  deleteRef(name: string): Promise<void>
}

/**
 * Abstract WAL storage interface (for DO SQLite).
 */
export interface WALStorage {
  /** Append an entry to the WAL */
  append(sessionId: SessionId, entry: WALEntry): Promise<void>

  /** Get entries since a sequence number */
  getEntriesSince(sessionId: SessionId, seq: number): Promise<WALEntry[]>

  /** Mark entries as checkpointed */
  markCheckpointed(sessionId: SessionId, throughSeq: number): Promise<void>

  /** Get the latest sequence number */
  getLatestSeq(sessionId: SessionId): Promise<number>

  /** Prune checkpointed entries */
  prune(sessionId: SessionId): Promise<number>
}

// ============================================================================
// Session Capability Interface
// ============================================================================

/**
 * Extended BashCapability with session management.
 * Provides fork/branch/experiment primitives on top of bash execution.
 */
export interface SessionBashCapability {
  /** Current session state */
  readonly session: SessionState

  /** Execute a command (tracks in history) */
  exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult>

  /** Run a shell script */
  run(script: string, options?: ExecOptions): Promise<BashResult>

  /** Fork the current session */
  fork(options?: ForkOptions): Promise<ForkResult>

  /** Create a named branch */
  branch(options: BranchOptions): Promise<BranchResult>

  /** Checkout a branch (restore state) */
  checkout(branchName: string): Promise<SessionState>

  /** Run parallel experiments */
  experiment(config: ExperimentConfig): Promise<ExperimentComparison>

  /** Create a manual checkpoint */
  checkpoint(message?: string): Promise<Checkpoint>

  /** Get command history */
  history(): CommandHistoryEntry[]

  /** Get session metrics */
  metrics(): SessionMetrics

  /** List all branches */
  listBranches(): Promise<SessionRef[]>

  /** List all forks */
  listForks(): Promise<SessionRef[]>
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default session configuration values.
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  shell: '/bin/bash',
  defaultTimeout: 30000,
  maxOutputSize: 1024 * 1024, // 1MB
  checkpoint: {
    commandThreshold: 10,
    idleTimeout: 30,
    minInterval: 5,
    maxReplayOps: 100,
  },
}

/**
 * Create initial session state.
 */
export function createInitialSessionState(
  id: SessionId,
  config: Partial<SessionConfig> = {}
): SessionState {
  const now = Date.now()
  return {
    id,
    createdAt: now,
    updatedAt: now,
    cwd: '/',
    env: {},
    history: [],
    treeHash: '', // Empty tree hash, will be set on first checkpoint
    processes: [],
    config: { ...DEFAULT_SESSION_CONFIG, ...config },
    metrics: {
      commandCount: 0,
      totalDuration: 0,
      lastCheckpointAt: 0,
      checkpointCount: 0,
      forkCount: 0,
      recoveryCount: 0,
      experimentCount: 0,
      recoverySuccessCount: 0,
      recoveryFailureCount: 0,
      totalCheckpointDuration: 0,
      avgCheckpointDuration: 0,
      minCheckpointDuration: Infinity,
      maxCheckpointDuration: 0,
    },
  }
}

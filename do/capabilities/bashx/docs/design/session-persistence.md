# R2 Iceberg Session Persistence Design

## Overview

This document describes the design for session persistence in bashx.do, enabling:
- **Session Recovery**: Survive DO eviction by checkpointing to R2
- **fork()**: Create independent session copies for parallel exploration
- **branch()**: Create named snapshots for return points
- **experiment()**: Run N parallel sessions and compare results

The design leverages gitx's commit model for versioning and fsx's tiered storage for efficient state management.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         AI Agent Session                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐    ┌──────────────┐    ┌────────────────────┐    │
│   │   bashx     │───▶│ SessionState │───▶│  CheckpointManager │    │
│   │  Commands   │    │  (in-memory) │    │                    │    │
│   └─────────────┘    └──────────────┘    └─────────┬──────────┘    │
│                              │                      │               │
│                              │                      ▼               │
│   ┌─────────────┐            │           ┌──────────────────────┐  │
│   │   fsx.do    │───────────▶│           │    R2 Checkpoint     │  │
│   │ (filesystem)│            │           │    (Iceberg-style)   │  │
│   └─────────────┘            │           └──────────────────────┘  │
│                              │                      │               │
│                              ▼                      ▼               │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │                    gitx Commit Model                         │  │
│   │    tree: filesystem snapshot    │    refs: branches/forks   │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Core Types

### SessionState

The complete state of a bash session, including working directory, environment, command history, and filesystem state.

```typescript
/**
 * Complete session state that can be serialized for persistence.
 * This is the "commit" equivalent - a snapshot of everything needed
 * to recreate a session.
 */
interface SessionState {
  /** Session metadata */
  id: SessionId
  parentId?: SessionId  // For fork lineage tracking
  createdAt: number
  updatedAt: number

  /** Shell environment */
  cwd: string
  env: Record<string, string>

  /** Command history with results */
  history: CommandHistoryEntry[]

  /** Filesystem state reference (gitx tree hash) */
  treeHash: string

  /** Running process state (for recovery) */
  processes: ProcessState[]

  /** Session configuration */
  config: SessionConfig

  /** Metrics for observability */
  metrics: SessionMetrics
}

/** Unique session identifier with optional human-readable prefix */
type SessionId = string  // e.g., "session-abc123" or "experiment-1-fork-2"

/** A single command execution record */
interface CommandHistoryEntry {
  /** Unique ID for this execution */
  id: string

  /** Sequence number in session */
  seq: number

  /** The command input (raw or natural language) */
  input: string

  /** The actual command executed */
  command: string

  /** Was this generated from natural language? */
  generated: boolean

  /** Safety classification at time of execution */
  classification: SafetyClassification

  /** Execution result */
  result: CommandResult

  /** Filesystem tree hash BEFORE execution */
  treeBeforeHash: string

  /** Filesystem tree hash AFTER execution */
  treeAfterHash: string

  /** Timestamp */
  timestamp: number

  /** Duration in milliseconds */
  duration: number
}

/** Simplified result stored in history */
interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  /** Truncated if output exceeded maxSize */
  truncated: boolean
}

/** State of a running or suspended process */
interface ProcessState {
  pid: number
  command: string
  startedAt: number
  status: 'running' | 'suspended' | 'zombie'
  /** Can this process be recovered? */
  recoverable: boolean
}

/** Session configuration options */
interface SessionConfig {
  /** Shell to use */
  shell: '/bin/bash' | '/bin/sh' | '/bin/zsh'

  /** Default timeout for commands */
  defaultTimeout: number

  /** Maximum output capture size */
  maxOutputSize: number

  /** Auto-checkpoint settings */
  checkpoint: CheckpointConfig
}

/** Checkpoint configuration */
interface CheckpointConfig {
  /** Checkpoint after N commands */
  commandThreshold: number

  /** Checkpoint after N seconds of idle */
  idleTimeout: number

  /** Minimum interval between checkpoints */
  minInterval: number

  /** Maximum ops to replay on recovery */
  maxReplayOps: number
}

/** Session metrics for observability */
interface SessionMetrics {
  commandCount: number
  totalDuration: number
  lastCheckpointAt: number
  checkpointCount: number
  forkCount: number
  recoveryCount: number
}
```

### Checkpoint Types

```typescript
/**
 * A checkpoint is a persisted SessionState with additional metadata
 * for efficient storage and recovery.
 */
interface Checkpoint {
  /** Checkpoint identifier (content-addressed, like git commit) */
  hash: string

  /** Session state at this checkpoint */
  state: SessionState

  /** Parent checkpoint hash (null for initial) */
  parentHash: string | null

  /** Checkpoint type */
  type: 'auto' | 'manual' | 'fork' | 'branch'

  /** Optional message (for manual checkpoints) */
  message?: string

  /** R2 storage key */
  r2Key: string

  /** Size in bytes */
  size: number

  /** Compression used */
  compression: 'gzip' | 'zstd' | 'none'
}

/**
 * Reference to a checkpoint (like git ref).
 * Used for branches, forks, and the current session pointer.
 */
interface SessionRef {
  /** Reference name */
  name: string  // e.g., "main", "fork/experiment-1", "branch/before-refactor"

  /** Checkpoint hash this ref points to */
  checkpointHash: string

  /** Reference type */
  type: 'head' | 'branch' | 'fork' | 'experiment'

  /** Session ID this ref belongs to */
  sessionId: SessionId

  /** When this ref was last updated */
  updatedAt: number

  /** Metadata */
  metadata?: Record<string, unknown>
}
```

### Storage Layer Types

```typescript
/**
 * Write-Ahead Log entry for recent operations.
 * These are stored in DO SQLite for fast writes, then
 * compacted into checkpoints on flush.
 */
interface WALEntry {
  /** Entry sequence number */
  seq: number

  /** Operation type */
  op: 'command' | 'env' | 'cwd' | 'file'

  /** Operation data */
  data: CommandHistoryEntry | EnvChange | CwdChange | FileChange

  /** Timestamp */
  timestamp: number

  /** Has this been checkpointed? */
  checkpointed: boolean
}

interface EnvChange {
  key: string
  oldValue: string | undefined
  newValue: string | undefined
}

interface CwdChange {
  oldCwd: string
  newCwd: string
}

interface FileChange {
  path: string
  op: 'create' | 'modify' | 'delete' | 'rename'
  oldHash?: string
  newHash?: string
  renamedFrom?: string
}
```

## Checkpoint/Recovery Flow

### When to Checkpoint

Checkpointing is triggered by three conditions:

1. **Idle Timeout**: After N seconds of no activity (default: 30s)
2. **Command Threshold**: After N commands executed (default: 10)
3. **Explicit**: When `$.session.checkpoint()` is called

```typescript
class CheckpointManager {
  private timer: number | null = null
  private pendingOps: number = 0
  private lastCheckpoint: number = Date.now()

  constructor(
    private state: SessionState,
    private storage: R2Storage,
    private config: CheckpointConfig
  ) {}

  /** Called after each operation */
  async onOperation(entry: WALEntry): Promise<void> {
    this.pendingOps++

    // Reset idle timer
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(
      () => this.checkpointIfNeeded('idle'),
      this.config.idleTimeout * 1000
    )

    // Check command threshold
    if (this.pendingOps >= this.config.commandThreshold) {
      await this.checkpoint('threshold')
    }
  }

  /** Create a checkpoint */
  async checkpoint(reason: 'idle' | 'threshold' | 'manual' | 'fork'): Promise<Checkpoint> {
    const now = Date.now()

    // Enforce minimum interval
    if (now - this.lastCheckpoint < this.config.minInterval * 1000) {
      if (reason !== 'fork' && reason !== 'manual') {
        return this.getLatestCheckpoint()
      }
    }

    // Snapshot filesystem state via fsx
    const treeHash = await this.snapshotFilesystem()

    // Create checkpoint
    const checkpoint = await this.createCheckpoint({
      ...this.state,
      treeHash,
      updatedAt: now,
    }, reason === 'fork' ? 'fork' : reason === 'manual' ? 'manual' : 'auto')

    // Store in R2
    await this.storage.put(checkpoint.r2Key, checkpoint)

    // Update ref
    await this.updateRef('HEAD', checkpoint.hash)

    this.pendingOps = 0
    this.lastCheckpoint = now

    return checkpoint
  }
}
```

### Recovery from R2

When a DO is evicted and recreated, or when loading a forked session:

```typescript
async function recoverSession(
  sessionId: SessionId,
  storage: R2Storage,
  walStorage: DOSQLite
): Promise<SessionState> {
  // 1. Find the latest checkpoint for this session
  const headRef = await storage.getRef(`sessions/${sessionId}/HEAD`)
  if (!headRef) {
    throw new Error(`No checkpoint found for session: ${sessionId}`)
  }

  // 2. Load the checkpoint
  const checkpoint = await storage.get<Checkpoint>(
    `checkpoints/${headRef.checkpointHash}`
  )

  // 3. Restore filesystem state from tree
  await restoreFilesystem(checkpoint.state.treeHash)

  // 4. Get WAL entries since checkpoint
  const walEntries = await walStorage.query<WALEntry[]>(
    `SELECT * FROM wal
     WHERE session_id = ? AND seq > ?
     ORDER BY seq ASC`,
    [sessionId, checkpoint.state.history.length]
  )

  // 5. Replay WAL entries (if within limit)
  const state = { ...checkpoint.state }

  if (walEntries.length <= checkpoint.state.config.checkpoint.maxReplayOps) {
    for (const entry of walEntries) {
      await replayWALEntry(state, entry)
    }
  } else {
    console.warn(`Too many WAL entries (${walEntries.length}), some may be lost`)
    // Replay most recent entries only
    const recent = walEntries.slice(-checkpoint.state.config.checkpoint.maxReplayOps)
    for (const entry of recent) {
      await replayWALEntry(state, entry)
    }
  }

  // 6. Update metrics
  state.metrics.recoveryCount++

  return state
}

async function replayWALEntry(state: SessionState, entry: WALEntry): Promise<void> {
  switch (entry.op) {
    case 'command':
      state.history.push(entry.data as CommandHistoryEntry)
      break
    case 'env':
      const envChange = entry.data as EnvChange
      if (envChange.newValue !== undefined) {
        state.env[envChange.key] = envChange.newValue
      } else {
        delete state.env[envChange.key]
      }
      break
    case 'cwd':
      state.cwd = (entry.data as CwdChange).newCwd
      break
    case 'file':
      // File changes are replayed via treeHash restoration
      break
  }
}
```

### Filesystem Snapshot (gitx Integration)

Using gitx's tree structure for filesystem snapshots:

```typescript
import { GitTree, GitBlob, calculateObjectHash } from '@dotdo/gitx'

/**
 * Create a git tree from the current filesystem state.
 * Uses fsx to enumerate files and gitx for tree construction.
 */
async function snapshotFilesystem(
  fs: FsCapability,
  cas: ContentAddressableFS,
  rootPath: string = '/'
): Promise<string> {
  const entries: TreeEntry[] = []

  // List all files recursively
  const files = await fs.list(rootPath, { recursive: true, withStats: true })

  for (const file of files) {
    const stat = await fs.stat(file.path)

    if (stat.isDirectory()) {
      // Recursively snapshot subdirectory
      const subTreeHash = await snapshotFilesystem(fs, cas, file.path)
      entries.push({
        mode: '040000',
        name: file.name,
        sha: subTreeHash,
      })
    } else {
      // Store file content as blob
      const content = await fs.read(file.path)
      const blobHash = await cas.putObject(
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content,
        'blob'
      )

      entries.push({
        mode: stat.mode & 0o111 ? '100755' : '100644',
        name: file.name,
        sha: blobHash,
      })
    }
  }

  // Create tree and return its hash
  const tree = new GitTree(entries)
  const treeHash = await tree.hash()

  // Store tree object
  await cas.putObject(tree.serialize(), 'tree')

  return treeHash
}

/**
 * Restore filesystem from a tree hash.
 */
async function restoreFilesystem(
  fs: FsCapability,
  cas: ContentAddressableFS,
  treeHash: string,
  targetPath: string = '/'
): Promise<void> {
  const treeObj = await cas.getObject(treeHash)
  if (!treeObj || treeObj.type !== 'tree') {
    throw new Error(`Invalid tree hash: ${treeHash}`)
  }

  const tree = GitTree.parse(treeObj.data)

  for (const entry of tree.entries) {
    const entryPath = `${targetPath}/${entry.name}`

    if (entry.mode === '040000') {
      // Directory - recurse
      await fs.mkdir(entryPath, { recursive: true })
      await restoreFilesystem(fs, cas, entry.sha, entryPath)
    } else {
      // File - restore content
      const blobObj = await cas.getObject(entry.sha)
      if (!blobObj || blobObj.type !== 'blob') {
        throw new Error(`Invalid blob hash: ${entry.sha}`)
      }

      await fs.write(entryPath, blobObj.data, {
        mode: entry.mode === '100755' ? 0o755 : 0o644
      })
    }
  }
}
```

## Fork, Branch, and Experiment APIs

### fork() - Create Independent Session Copy

Creates a new session that starts from the current state but evolves independently.

```typescript
interface ForkOptions {
  /** Optional name for the fork */
  name?: string

  /** Start from a specific checkpoint (default: current state) */
  fromCheckpoint?: string

  /** Copy WAL entries since checkpoint? */
  includeWAL?: boolean

  /** Metadata to attach to fork */
  metadata?: Record<string, unknown>
}

interface ForkResult {
  /** New session ID */
  sessionId: SessionId

  /** New session state */
  state: SessionState

  /** Checkpoint hash of the fork point */
  forkPoint: string

  /** Reference to the fork */
  ref: SessionRef
}

class Session {
  async fork(options: ForkOptions = {}): Promise<ForkResult> {
    // 1. Create checkpoint of current state
    const checkpoint = await this.checkpointManager.checkpoint('fork')

    // 2. Generate new session ID
    const newSessionId = options.name
      ? `fork/${options.name}`
      : `fork-${generateId()}`

    // 3. Clone state with new ID
    const forkedState: SessionState = {
      ...this.state,
      id: newSessionId,
      parentId: this.state.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metrics: {
        ...this.state.metrics,
        forkCount: 0,
        recoveryCount: 0,
        checkpointCount: 0,
      },
    }

    // 4. Create fork checkpoint
    const forkCheckpoint = await this.createCheckpoint(forkedState, 'fork')
    await this.storage.put(forkCheckpoint.r2Key, forkCheckpoint)

    // 5. Create reference
    const ref: SessionRef = {
      name: `forks/${newSessionId}`,
      checkpointHash: forkCheckpoint.hash,
      type: 'fork',
      sessionId: newSessionId,
      updatedAt: Date.now(),
      metadata: options.metadata,
    }
    await this.storage.put(`refs/${ref.name}`, ref)

    // 6. Update parent's fork count
    this.state.metrics.forkCount++

    return {
      sessionId: newSessionId,
      state: forkedState,
      forkPoint: checkpoint.hash,
      ref,
    }
  }
}
```

### branch() - Create Named Snapshot

Creates a named reference to the current state for later return.

```typescript
interface BranchOptions {
  /** Branch name (required) */
  name: string

  /** Optional message */
  message?: string

  /** Metadata */
  metadata?: Record<string, unknown>
}

interface BranchResult {
  /** The created branch reference */
  ref: SessionRef

  /** Checkpoint hash */
  checkpointHash: string
}

class Session {
  async branch(options: BranchOptions): Promise<BranchResult> {
    // 1. Create checkpoint
    const checkpoint = await this.checkpointManager.checkpoint('manual')

    // 2. Create branch reference
    const ref: SessionRef = {
      name: `branches/${this.state.id}/${options.name}`,
      checkpointHash: checkpoint.hash,
      type: 'branch',
      sessionId: this.state.id,
      updatedAt: Date.now(),
      metadata: {
        ...options.metadata,
        message: options.message,
      },
    }

    await this.storage.put(`refs/${ref.name}`, ref)

    return {
      ref,
      checkpointHash: checkpoint.hash,
    }
  }

  /** Switch to a branch (restore that state) */
  async checkout(branchName: string): Promise<SessionState> {
    const ref = await this.storage.get<SessionRef>(
      `refs/branches/${this.state.id}/${branchName}`
    )

    if (!ref) {
      throw new Error(`Branch not found: ${branchName}`)
    }

    // Auto-branch current state before checkout (like git stash)
    await this.branch({
      name: `_auto/before-checkout-${Date.now()}`,
    })

    // Load the checkpoint
    const checkpoint = await this.storage.get<Checkpoint>(
      `checkpoints/${ref.checkpointHash}`
    )

    // Restore state
    this.state = checkpoint.state
    await restoreFilesystem(this.fs, this.cas, this.state.treeHash)

    return this.state
  }

  /** List all branches for this session */
  async listBranches(): Promise<SessionRef[]> {
    const prefix = `refs/branches/${this.state.id}/`
    return this.storage.list<SessionRef>(prefix)
  }
}
```

### experiment() - Parallel Session Execution

Run multiple commands in parallel across forked sessions and compare results.

```typescript
interface ExperimentConfig {
  /** Commands to run in parallel (one per fork) */
  commands: string[]

  /** Or: same command, different configurations */
  command?: string
  configs?: Partial<SessionConfig>[]

  /** Timeout for each experiment */
  timeout?: number

  /** How to compare results */
  compareBy?: 'exitCode' | 'output' | 'duration' | 'custom'

  /** Custom comparison function */
  compareFn?: (results: ExperimentResult[]) => ExperimentComparison

  /** Keep forks after experiment? */
  keepForks?: boolean
}

interface ExperimentResult {
  /** Fork ID */
  forkId: SessionId

  /** Command executed */
  command: string

  /** Result */
  result: BashResult

  /** Duration */
  duration: number

  /** Final tree hash */
  treeHash: string

  /** Error if failed */
  error?: string
}

interface ExperimentComparison {
  /** Which fork "won" (by compareBy metric) */
  winner?: SessionId

  /** Results sorted by metric */
  ranked: ExperimentResult[]

  /** Diff between results */
  diffs: ResultDiff[]

  /** Summary statistics */
  stats: {
    minDuration: number
    maxDuration: number
    avgDuration: number
    successRate: number
  }
}

interface ResultDiff {
  forkA: SessionId
  forkB: SessionId
  exitCodeDiff: number
  stdoutDiff: string  // Unified diff
  stderrDiff: string
  filesDiff: TreeDiff[]
}

interface TreeDiff {
  path: string
  type: 'added' | 'removed' | 'modified'
  oldHash?: string
  newHash?: string
}

class Session {
  async experiment(config: ExperimentConfig): Promise<ExperimentComparison> {
    // 1. Determine what to run
    const experiments = config.commands
      ? config.commands.map(cmd => ({ command: cmd, config: this.state.config }))
      : config.configs!.map(cfg => ({
          command: config.command!,
          config: { ...this.state.config, ...cfg }
        }))

    // 2. Create forks for each experiment
    const forks = await Promise.all(
      experiments.map((exp, i) => this.fork({
        name: `experiment-${Date.now()}-${i}`,
        metadata: { experimentConfig: exp },
      }))
    )

    // 3. Run commands in parallel
    const results = await Promise.all(
      forks.map(async (fork, i) => {
        const session = await createSession(fork.sessionId)
        const startTime = Date.now()

        try {
          const result = await session.execute(experiments[i].command, {
            timeout: config.timeout,
          })

          const treeHash = await snapshotFilesystem(session.fs, session.cas)

          return {
            forkId: fork.sessionId,
            command: experiments[i].command,
            result,
            duration: Date.now() - startTime,
            treeHash,
          } as ExperimentResult
        } catch (error) {
          return {
            forkId: fork.sessionId,
            command: experiments[i].command,
            result: null as any,
            duration: Date.now() - startTime,
            treeHash: fork.state.treeHash,
            error: error instanceof Error ? error.message : String(error),
          } as ExperimentResult
        }
      })
    )

    // 4. Compare results
    const comparison = config.compareFn
      ? config.compareFn(results)
      : this.defaultCompare(results, config.compareBy || 'exitCode')

    // 5. Cleanup forks if not keeping
    if (!config.keepForks) {
      await Promise.all(
        forks.map(fork => this.deleteSession(fork.sessionId))
      )
    }

    return comparison
  }

  private defaultCompare(
    results: ExperimentResult[],
    compareBy: string
  ): ExperimentComparison {
    const successful = results.filter(r => !r.error && r.result.exitCode === 0)

    let ranked: ExperimentResult[]
    switch (compareBy) {
      case 'duration':
        ranked = [...results].sort((a, b) => a.duration - b.duration)
        break
      case 'output':
        ranked = [...results].sort((a, b) =>
          (a.result?.stdout.length || 0) - (b.result?.stdout.length || 0)
        )
        break
      default:
        ranked = [...results].sort((a, b) =>
          (a.result?.exitCode || 999) - (b.result?.exitCode || 999)
        )
    }

    const durations = results.map(r => r.duration)

    return {
      winner: ranked[0]?.error ? undefined : ranked[0]?.forkId,
      ranked,
      diffs: this.computeDiffs(results),
      stats: {
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
        successRate: successful.length / results.length,
      },
    }
  }

  private computeDiffs(results: ExperimentResult[]): ResultDiff[] {
    const diffs: ResultDiff[] = []

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        diffs.push({
          forkA: results[i].forkId,
          forkB: results[j].forkId,
          exitCodeDiff: (results[i].result?.exitCode || 0) - (results[j].result?.exitCode || 0),
          stdoutDiff: computeUnifiedDiff(
            results[i].result?.stdout || '',
            results[j].result?.stdout || ''
          ),
          stderrDiff: computeUnifiedDiff(
            results[i].result?.stderr || '',
            results[j].result?.stderr || ''
          ),
          filesDiff: [], // Would compare treeHashes
        })
      }
    }

    return diffs
  }
}
```

## Storage Layout in R2

```
r2://bashx-sessions/
├── checkpoints/
│   ├── {hash1}              # Serialized Checkpoint
│   ├── {hash2}
│   └── ...
├── refs/
│   ├── sessions/{id}/HEAD   # Current session pointer
│   ├── branches/{id}/{name} # Named branches
│   ├── forks/{id}           # Fork references
│   └── experiments/{id}     # Experiment references
├── trees/
│   ├── {hash}/              # Filesystem tree objects
│   └── ...
└── blobs/
    ├── {hash}               # File content blobs
    └── ...
```

## Integration with bashx

### Session-Aware BashCapability

```typescript
interface SessionBashCapability extends BashCapability {
  /** Get current session */
  session: Session

  /** Fork the current session */
  fork(options?: ForkOptions): Promise<ForkResult>

  /** Create a named branch */
  branch(options: BranchOptions): Promise<BranchResult>

  /** Checkout a branch */
  checkout(branchName: string): Promise<SessionState>

  /** Run parallel experiments */
  experiment(config: ExperimentConfig): Promise<ExperimentComparison>

  /** Manually checkpoint */
  checkpoint(message?: string): Promise<Checkpoint>

  /** Get session history */
  history(): CommandHistoryEntry[]

  /** Get session metrics */
  metrics(): SessionMetrics
}

/** Factory to create session-aware bash */
function createSessionBash(
  executor: BashExecutor,
  storage: R2Storage,
  sessionId?: SessionId
): Promise<SessionBashCapability> {
  // Load or create session
  // Return proxied BashCapability with session management
}
```

### Usage Example

```typescript
// In a Durable Object
class AgentSession extends DurableObject {
  private bash: SessionBashCapability

  async init() {
    this.bash = await createSessionBash(
      new CloudflareContainerExecutor({ containerBinding: this.env.CONTAINER }),
      this.env.R2,
      this.ctx.id.toString()
    )
  }

  async handleTask(task: string): Promise<void> {
    // Create a branch before risky operation
    await this.bash.branch({ name: 'before-task', message: task })

    try {
      // Try multiple approaches in parallel
      const comparison = await this.bash.experiment({
        commands: [
          `npm install && npm run build`,
          `pnpm install && pnpm run build`,
          `yarn install && yarn build`,
        ],
        compareBy: 'duration',
        timeout: 120000,
      })

      console.log(`Fastest: ${comparison.winner}`)
      console.log(`Stats:`, comparison.stats)

      // Adopt the winning approach
      if (comparison.winner) {
        await this.bash.checkout(`forks/${comparison.winner}`)
      }
    } catch (error) {
      // Rollback to before-task
      await this.bash.checkout('before-task')
      throw error
    }
  }
}
```

## Cost Optimization

### Columnar Storage Integration

As described in bashx-chqc, use columnar storage in DO SQLite to minimize costs:

```typescript
/** Store WAL entries as columnar JSON row */
interface WALRow {
  id: string  // Session ID
  entries: string  // JSON array of WALEntry
  lastSeq: number
  checkpointedThrough: number
  updatedAt: number
}

// One row per session instead of one row per entry
// Reduces DO SQLite costs by ~99.6%
```

### Tiered Checkpoint Storage

```typescript
interface CheckpointTier {
  tier: 'hot' | 'warm' | 'cold'
  maxAge: number  // seconds
  storage: 'do' | 'r2' | 'r2-ia'  // R2 Infrequent Access
}

const CHECKPOINT_TIERS: CheckpointTier[] = [
  { tier: 'hot', maxAge: 3600, storage: 'do' },      // Last hour in DO
  { tier: 'warm', maxAge: 86400, storage: 'r2' },    // Last day in R2
  { tier: 'cold', maxAge: Infinity, storage: 'r2-ia' },  // Older in R2 IA
]
```

## Security Considerations

1. **Session Isolation**: Each session has unique ID, forks inherit but don't share state
2. **Checkpoint Encryption**: Consider encrypting checkpoints at rest
3. **Access Control**: Verify session ownership before fork/branch/checkout
4. **Resource Limits**: Limit number of forks, checkpoints, and experiment parallelism
5. **Cleanup**: TTL on orphaned forks and old checkpoints

## Future Enhancements

1. **Merge**: Combine changes from multiple forks
2. **Cherry-pick**: Apply specific commands from one session to another
3. **Rebase**: Replay commands on top of different base state
4. **Bisect**: Binary search through history to find breaking change
5. **Hooks**: Pre/post checkpoint, fork, branch hooks
6. **Collaboration**: Multi-agent session sharing

## References

- gitx: `/Users/nathanclevenger/projects/gitx`
- fsx: `/Users/nathanclevenger/projects/fsx`
- bashx: `/Users/nathanclevenger/projects/bashx`
- Related issue: bashx-chqc (Columnar store for DO SQLite cost optimization)

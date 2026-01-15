/**
 * Session Class
 *
 * Core session implementation with fork/branch/experiment primitives.
 *
 * @module bashx/session/session
 */

import type { BashResult, ExecOptions } from '../types.js'
import type {
  SessionState,
  SessionId,
  Checkpoint,
  SessionRef,
  CommandHistoryEntry,
  SessionMetrics,
  ForkOptions,
  ForkResult,
  BranchOptions,
  BranchResult,
  ExperimentConfig,
  ExperimentResult,
  ExperimentComparison,
  ExperimentStats,
  ResultDiff,
  CheckpointStorage,
  WALStorage,
  WALEntry,
  SessionBashCapability,
  SessionMetricsCollector,
} from './types.js'
import { noopMetricsCollector } from './types.js'
import { CheckpointManager } from './checkpoint-manager.js'
import { logger } from '../../../../../lib/logging'

// ============================================================================
// Session Class
// ============================================================================

/**
 * A bash session with persistence and fork/branch/experiment capabilities.
 *
 * Sessions are stateful bash environments that can:
 * - Survive DO eviction via R2 checkpointing
 * - Be forked for parallel exploration
 * - Create named branches for return points
 * - Run experiments across parallel sessions
 */
export class Session implements SessionBashCapability {
  private _state: SessionState
  private checkpointManager: CheckpointManager
  private executor: BashExecutor
  private metricsCollector: SessionMetricsCollector
  private sessionCreatedAt: number

  constructor(
    state: SessionState,
    private checkpointStorage: CheckpointStorage,
    walStorage: WALStorage,
    executor: BashExecutor,
    private getTreeHash: () => Promise<string>,
    private createSessionFn: (id: SessionId) => Promise<Session>,
    private restoreFilesystemFn: (treeHash: string) => Promise<void>,
    metricsCollector?: SessionMetricsCollector
  ) {
    this._state = state
    this.executor = executor
    this.metricsCollector = metricsCollector ?? noopMetricsCollector
    this.sessionCreatedAt = Date.now()
    this.checkpointManager = new CheckpointManager(
      state.id,
      state.config.checkpoint,
      checkpointStorage,
      walStorage,
      getTreeHash,
      () => this._state,
      this.metricsCollector
    )

    // Emit session created event
    this.metricsCollector.emit({
      type: 'session:created',
      sessionId: state.id,
      timestamp: this.sessionCreatedAt,
    })
  }

  /** Current session state (read-only view) */
  get session(): SessionState {
    return { ...this._state }
  }

  // ==========================================================================
  // Command Execution
  // ==========================================================================

  /**
   * Execute a command and track in history.
   */
  async exec(
    command: string,
    args: string[] = [],
    options?: ExecOptions
  ): Promise<BashResult> {
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
    return this.runCommand(fullCommand, options)
  }

  /**
   * Run a shell script.
   */
  async run(script: string, options?: ExecOptions): Promise<BashResult> {
    return this.runCommand(script, options)
  }

  /**
   * Internal command execution with tracking.
   */
  private async runCommand(command: string, options?: ExecOptions): Promise<BashResult> {
    const seq = this._state.history.length
    const startTime = Date.now()
    const treeBeforeHash = await this.getTreeHash()

    // Emit command start event
    this.metricsCollector.emit({
      type: 'command:start',
      sessionId: this._state.id,
      timestamp: startTime,
      command,
      seq,
    })

    // Execute via backend
    const result = await this.executor.execute(command, {
      cwd: options?.cwd || this._state.cwd,
      env: { ...this._state.env, ...options?.env },
      timeout: options?.timeout || this._state.config.defaultTimeout,
    })

    const duration = Date.now() - startTime
    const treeAfterHash = await this.getTreeHash()

    // Emit command end event
    this.metricsCollector.emit({
      type: 'command:end',
      sessionId: this._state.id,
      timestamp: Date.now(),
      command: result.command,
      seq,
      exitCode: result.exitCode,
      durationMs: duration,
      generated: result.generated,
    })

    // Create history entry
    const historyEntry: CommandHistoryEntry = {
      id: crypto.randomUUID(),
      seq,
      input: command,
      command: result.command,
      generated: result.generated,
      classification: result.classification,
      result: {
        exitCode: result.exitCode,
        stdout: this.truncateOutput(result.stdout),
        stderr: this.truncateOutput(result.stderr),
        truncated:
          result.stdout.length > this._state.config.maxOutputSize ||
          result.stderr.length > this._state.config.maxOutputSize,
      },
      treeBeforeHash,
      treeAfterHash,
      timestamp: startTime,
      duration,
    }

    // Update state
    this._state.history.push(historyEntry)
    this._state.updatedAt = Date.now()
    this._state.metrics.commandCount++
    this._state.metrics.totalDuration += duration

    // Record in WAL and potentially checkpoint
    const walEntry: WALEntry = {
      seq,
      op: 'command',
      data: historyEntry,
      timestamp: startTime,
      checkpointed: false,
    }
    await this.checkpointManager.onOperation(walEntry)

    return result
  }

  private truncateOutput(output: string): string {
    if (output.length <= this._state.config.maxOutputSize) {
      return output
    }
    return output.slice(0, this._state.config.maxOutputSize)
  }

  // ==========================================================================
  // Fork
  // ==========================================================================

  /**
   * Fork the current session, creating an independent copy.
   */
  async fork(options: ForkOptions = {}): Promise<ForkResult> {
    const startTime = Date.now()

    // Emit fork start event
    this.metricsCollector.emit({
      type: 'fork:start',
      sessionId: this._state.id,
      timestamp: startTime,
      forkName: options.name,
    })

    // Use specified checkpoint or create new one at current state
    let checkpoint: Checkpoint
    if (options.fromCheckpoint) {
      // Fork from a specific checkpoint
      const existingCheckpoint = await this.checkpointStorage.getCheckpoint(options.fromCheckpoint)
      if (!existingCheckpoint) {
        throw new Error(`Checkpoint not found: ${options.fromCheckpoint}`)
      }
      checkpoint = existingCheckpoint
    } else {
      // Create checkpoint of current state
      checkpoint = await this.checkpointManager.checkpoint('fork')
    }

    // Generate new session ID
    const newSessionId = options.name
      ? `fork/${options.name}`
      : `fork-${crypto.randomUUID().slice(0, 8)}`

    // Clone state with new ID (deep copy env and other nested objects)
    const forkedState: SessionState = {
      ...this._state,
      id: newSessionId,
      parentId: this._state.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cwd: this._state.cwd,
      env: { ...this._state.env },  // Deep copy env
      history: options.includeWAL ? [...this._state.history] : [],
      processes: [...this._state.processes],  // Copy processes array
      config: { ...this._state.config, checkpoint: { ...this._state.config.checkpoint } },  // Deep copy config
      metrics: {
        commandCount: options.includeWAL ? this._state.metrics.commandCount : 0,
        totalDuration: options.includeWAL ? this._state.metrics.totalDuration : 0,
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

    // Create fork checkpoint
    const forkCheckpoint = await this.createCheckpointForState(forkedState, 'fork')

    // Create fork reference
    const ref: SessionRef = {
      name: `forks/${newSessionId}`,
      checkpointHash: forkCheckpoint.hash,
      type: 'fork',
      sessionId: newSessionId,
      updatedAt: Date.now(),
      metadata: options.metadata,
    }
    await this.checkpointStorage.putRef(ref)

    // Create HEAD ref for the forked session so it can be loaded
    const headRef: SessionRef = {
      name: `sessions/${newSessionId}/HEAD`,
      checkpointHash: forkCheckpoint.hash,
      type: 'head',
      sessionId: newSessionId,
      updatedAt: Date.now(),
    }
    await this.checkpointStorage.putRef(headRef)

    // Update parent's fork count
    this._state.metrics.forkCount++

    const duration = Date.now() - startTime

    // Emit fork end event
    this.metricsCollector.emit({
      type: 'fork:end',
      sessionId: this._state.id,
      timestamp: Date.now(),
      forkSessionId: newSessionId,
      forkPointHash: checkpoint.hash,
      durationMs: duration,
    })

    return {
      sessionId: newSessionId,
      state: forkedState,
      forkPoint: checkpoint.hash,
      ref,
    }
  }

  // ==========================================================================
  // Branch
  // ==========================================================================

  /**
   * Create a named branch (snapshot) of current state.
   */
  async branch(options: BranchOptions): Promise<BranchResult> {
    // Create checkpoint
    const checkpoint = await this.checkpointManager.checkpoint(
      'branch',
      options.message
    )

    // Create branch reference
    const ref: SessionRef = {
      name: `branches/${this._state.id}/${options.name}`,
      checkpointHash: checkpoint.hash,
      type: 'branch',
      sessionId: this._state.id,
      updatedAt: Date.now(),
      metadata: {
        ...options.metadata,
        message: options.message,
      },
    }
    await this.checkpointStorage.putRef(ref)

    // Emit branch created event
    this.metricsCollector.emit({
      type: 'branch:created',
      sessionId: this._state.id,
      timestamp: Date.now(),
      branchName: options.name,
      checkpointHash: checkpoint.hash,
    })

    return {
      ref,
      checkpointHash: checkpoint.hash,
    }
  }

  /**
   * Checkout a branch, restoring that state.
   */
  async checkout(branchName: string): Promise<SessionState> {
    // Get branch reference
    const ref = await this.checkpointStorage.getRef(
      `branches/${this._state.id}/${branchName}`
    )
    if (!ref) {
      throw new Error(`Branch not found: ${branchName}`)
    }

    // Auto-save current state before checkout
    await this.branch({
      name: `_auto/before-checkout-${Date.now()}`,
      message: `Auto-saved before checkout to ${branchName}`,
    })

    // Load the checkpoint
    const checkpoint = await this.checkpointStorage.getCheckpoint(ref.checkpointHash)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${ref.checkpointHash}`)
    }

    // Restore filesystem state
    await this.restoreFilesystemFn(checkpoint.state.treeHash)

    // Update session state
    this._state = { ...checkpoint.state }

    return this._state
  }

  /**
   * List all branches for this session.
   */
  async listBranches(): Promise<SessionRef[]> {
    return this.checkpointStorage.listRefs(`branches/${this._state.id}/`)
  }

  /**
   * List all forks from this session.
   */
  async listForks(): Promise<SessionRef[]> {
    // This would need a more sophisticated query in practice
    const allForks = await this.checkpointStorage.listRefs('forks/')
    return allForks.filter(ref => {
      // Check if fork's parent is this session
      return ref.sessionId.startsWith(`fork/`) // Simplified
    })
  }

  // ==========================================================================
  // Experiment
  // ==========================================================================

  /**
   * Run parallel experiments and compare results.
   */
  async experiment(config: ExperimentConfig): Promise<ExperimentComparison> {
    const startTime = Date.now()

    // Determine experiments to run
    const experiments = config.commands
      ? config.commands.map(cmd => ({ command: cmd, config: this._state.config }))
      : config.configs!.map(cfg => ({
          command: config.command!,
          config: { ...this._state.config, ...cfg },
        }))

    const commands = experiments.map(exp => exp.command)

    // Emit experiment start event
    this.metricsCollector.emit({
      type: 'experiment:start',
      sessionId: this._state.id,
      timestamp: startTime,
      experimentCount: experiments.length,
      commands,
    })

    // Create forks for each experiment
    const forks = await Promise.all(
      experiments.map((exp, i) =>
        this.fork({
          name: `experiment-${Date.now()}-${i}`,
          metadata: { experimentConfig: exp },
        })
      )
    )

    // Run commands in parallel (with optional limit)
    const maxParallel = config.maxParallel || experiments.length
    const results: ExperimentResult[] = []

    for (let i = 0; i < forks.length; i += maxParallel) {
      const batch = forks.slice(i, i + maxParallel)
      const batchResults = await Promise.all(
        batch.map(async (fork, j) => {
          const forkSession = await this.createSessionFn(fork.sessionId)
          const expIndex = i + j
          const expStartTime = Date.now()

          try {
            const result = await forkSession.run(experiments[expIndex].command, {
              timeout: config.timeout,
            })

            const treeHash = await forkSession.getTreeHash()

            return {
              forkId: fork.sessionId,
              command: experiments[expIndex].command,
              result,
              duration: Date.now() - expStartTime,
              treeHash,
            } as ExperimentResult
          } catch (error) {
            return {
              forkId: fork.sessionId,
              command: experiments[expIndex].command,
              result: null,
              duration: Date.now() - expStartTime,
              treeHash: fork.state.treeHash,
              error: error instanceof Error ? error.message : String(error),
            } as ExperimentResult
          }
        })
      )
      results.push(...batchResults)
    }

    // Compare results
    const comparison = config.compareFn
      ? config.compareFn(results)
      : this.defaultCompare(results, config.compareBy || 'exitCode')

    // Cleanup forks if not keeping
    if (!config.keepForks) {
      await Promise.all(
        forks.map(fork => this.deleteSession(fork.sessionId))
      )
    }

    // Update experiment count
    this._state.metrics.experimentCount++

    const duration = Date.now() - startTime
    const successCount = results.filter(r => r.result && r.result.exitCode === 0).length

    // Emit experiment end event
    this.metricsCollector.emit({
      type: 'experiment:end',
      sessionId: this._state.id,
      timestamp: Date.now(),
      completedCount: results.length,
      successCount,
      durationMs: duration,
      winnerId: comparison.winner,
    })

    return comparison
  }

  /**
   * Default result comparison.
   */
  private defaultCompare(
    results: ExperimentResult[],
    compareBy: string
  ): ExperimentComparison {
    const successful = results.filter(
      r => !r.error && r.result && r.result.exitCode === 0
    )

    let ranked: ExperimentResult[]
    switch (compareBy) {
      case 'duration':
        ranked = [...results].sort((a, b) => a.duration - b.duration)
        break
      case 'output':
        ranked = [...results].sort(
          (a, b) =>
            (a.result?.stdout.length || 0) - (b.result?.stdout.length || 0)
        )
        break
      default: // exitCode
        ranked = [...results].sort(
          (a, b) => (a.result?.exitCode || 999) - (b.result?.exitCode || 999)
        )
    }

    const durations = results.map(r => r.duration)
    const stats: ExperimentStats = {
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      successRate: successful.length / results.length,
    }

    return {
      winner: ranked[0]?.error ? undefined : ranked[0]?.forkId,
      ranked,
      diffs: this.computeDiffs(results),
      stats,
    }
  }

  /**
   * Compute pairwise diffs between results.
   */
  private computeDiffs(results: ExperimentResult[]): ResultDiff[] {
    const diffs: ResultDiff[] = []

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const a = results[i]
        const b = results[j]

        diffs.push({
          forkA: a.forkId,
          forkB: b.forkId,
          exitCodeDiff:
            (a.result?.exitCode || 0) - (b.result?.exitCode || 0),
          stdoutDiff: this.computeUnifiedDiff(
            a.result?.stdout || '',
            b.result?.stdout || ''
          ),
          stderrDiff: this.computeUnifiedDiff(
            a.result?.stderr || '',
            b.result?.stderr || ''
          ),
          filesDiff: [], // Would compare tree hashes
        })
      }
    }

    return diffs
  }

  /**
   * Compute unified diff between two strings.
   * Placeholder - would use a real diff algorithm.
   */
  private computeUnifiedDiff(a: string, b: string): string {
    if (a === b) return ''
    // In a real implementation, use a proper diff library
    return `--- a\n+++ b\n@@ @@\n-${a}\n+${b}`
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Create a manual checkpoint.
   */
  async checkpoint(message?: string): Promise<Checkpoint> {
    return this.checkpointManager.checkpoint('manual', message)
  }

  /**
   * Get command history.
   */
  history(): CommandHistoryEntry[] {
    return [...this._state.history]
  }

  /**
   * Get session metrics.
   */
  metrics(): SessionMetrics {
    return { ...this._state.metrics }
  }

  /**
   * Helper to create a checkpoint for a given state.
   */
  private async createCheckpointForState(
    state: SessionState,
    type: 'fork' | 'branch'
  ): Promise<Checkpoint> {
    const content = JSON.stringify({ state, type })
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(content))
    const hash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const checkpoint: Checkpoint = {
      hash,
      state,
      parentHash: null,
      type,
      r2Key: `checkpoints/${hash}`,
      size: content.length,
      compression: 'none',
    }

    await this.checkpointStorage.putCheckpoint(checkpoint)
    return checkpoint
  }

  /**
   * Delete a session and its resources.
   * Placeholder - would clean up storage.
   */
  private async deleteSession(sessionId: SessionId): Promise<void> {
    // In a real implementation:
    // - Delete all checkpoints for this session
    // - Delete all refs for this session
    // - Delete WAL entries
    logger.info('Would delete session', {
      source: 'bashx/session/session',
      sessionId,
    })
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    const lifetimeMs = Date.now() - this.sessionCreatedAt

    // Emit session disposed event
    this.metricsCollector.emit({
      type: 'session:disposed',
      sessionId: this._state.id,
      timestamp: Date.now(),
      lifetimeMs,
    })

    // Flush metrics if the collector supports it
    if (this.metricsCollector.flush) {
      this.metricsCollector.flush().catch(() => {
        // Ignore flush errors on dispose
      })
    }

    this.checkpointManager.dispose()
  }
}

// ============================================================================
// Executor Interface (matches bashx pattern)
// ============================================================================

/**
 * Bash executor interface for command execution.
 */
interface BashExecutor {
  execute(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ): Promise<BashResult>
}

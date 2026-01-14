/**
 * SandboxExecutor Module
 *
 * Tier 4 execution: Full Linux sandbox via Sandbox SDK.
 *
 * This module handles commands that require a full Linux environment
 * with process isolation:
 * - System commands (ps, top, htop, kill, pkill)
 * - Process management
 * - Container operations
 * - Any command not handled by higher tiers
 *
 * Interface Contract:
 * -------------------
 * SandboxExecutor implements the TierExecutor interface:
 * - canExecute(command): Returns true if sandbox is configured (fallback tier)
 * - execute(command, options): Executes in sandbox and returns BashResult
 *
 * Dependency Injection:
 * ---------------------
 * - sandbox: SandboxBackend for executing commands in isolated environment
 * - defaultTimeout: Optional timeout configuration
 *
 * Session Management:
 * -------------------
 * Supports persistent sessions for multi-command workflows where
 * state (cwd, env) needs to be preserved between commands.
 *
 * @module bashx/do/executors/sandbox-executor
 */

import type { BashResult, ExecOptions, SpawnOptions, SpawnHandle } from '../../types.js'
import type { TierExecutor, BaseExecutorConfig } from './types.js'
import {
  ResourceLimits,
  ResourceLimitEnforcer,
  createResourceLimitEnforcer,
  DEFAULT_RESOURCE_LIMITS,
  type BashResultWithResourceUsage,
} from '../security/resource-limits.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sandbox backend interface for executing commands
 */
export interface SandboxBackend {
  /** Execute a command in the sandbox */
  execute: (command: string, options?: ExecOptions) => Promise<BashResult>
  /** Spawn a command for streaming execution (optional) */
  spawn?: (command: string, args?: string[], options?: SpawnOptions) => Promise<SpawnHandle>
}

/**
 * Alias for SandboxBackend for test compatibility
 */
export type SandboxBinding = SandboxBackend

/**
 * Sandbox session for persistent execution
 */
export interface SandboxSession {
  /** Session ID */
  id: string
  /** Execute a command in this session */
  execute: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  /** Spawn a command in this session */
  spawn?: (command: string, args?: string[], options?: SpawnOptions) => Promise<SpawnHandle>
  /** Get the current working directory */
  getWorkingDirectory: () => string
  /** Set the working directory */
  setWorkingDirectory: (path: string) => Promise<void>
  /** Get environment variables */
  getEnvironment: () => Record<string, string>
  /** Set environment variables */
  setEnvironment: (env: Record<string, string>) => Promise<void>
  /** Close the session */
  close: () => Promise<void>
  /** Check if session is active */
  isActive: () => boolean
}

/**
 * Configuration for SandboxExecutor.
 *
 * @example
 * ```typescript
 * const config: SandboxExecutorConfig = {
 *   sandbox: {
 *     execute: async (command, options) => {
 *       // Execute in sandbox environment
 *       return { input: command, command, ... }
 *     },
 *   },
 *   defaultTimeout: 60000, // Longer timeout for sandbox ops
 * }
 * const executor = createSandboxExecutor(config)
 * ```
 */
export interface SandboxExecutorConfig extends BaseExecutorConfig {
  /**
   * Sandbox backend for executing commands.
   *
   * Without a sandbox backend, canExecute() returns false and
   * execute() returns an error result.
   */
  sandbox?: SandboxBackend

  /**
   * Resource limits for sandbox execution.
   *
   * Controls execution time and output size limits.
   * If not specified, DEFAULT_RESOURCE_LIMITS are used.
   */
  resourceLimits?: Partial<ResourceLimits>
}

/**
 * Sandbox capability types
 */
export type SandboxCapability = 'execute' | 'spawn' | 'session' | 'filesystem' | 'network'

/**
 * Extended result from sandbox execution
 */
export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  duration?: number
  memoryUsage?: number
  cpuTime?: number
}

// ============================================================================
// SANDBOX COMMAND SETS
// ============================================================================

/**
 * Commands that require full sandbox execution
 */
export const SANDBOX_COMMANDS = new Set([
  // System commands
  'ps', 'top', 'htop', 'kill', 'pkill', 'pgrep', 'killall',
  // Process management
  'nohup', 'nice', 'renice', 'bg', 'fg', 'jobs',
  // System info
  'free', 'vmstat', 'iostat', 'mpstat', 'uptime', 'dmesg',
  // System utilities
  'sudo', 'su', 'chgrp',
  // File system (advanced)
  'mount', 'umount', 'df', 'du', 'fdisk', 'mkfs',
  // Networking
  'ip', 'ifconfig', 'netstat', 'ss', 'ping', 'traceroute',
  'nc', 'ncat', 'nmap', 'tcpdump', 'iptables', 'ssh', 'scp',
  // Container/VM
  'docker', 'docker-compose', 'podman', 'kubectl', 'helm',
  // Package management
  'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'apk', 'brew',
  // Build tools / Compilers
  'make', 'cmake', 'gcc', 'g++', 'clang', 'rustc', 'cargo', 'go',
  // Scripting / Runtimes
  'python', 'python3', 'ruby', 'perl', 'lua',
  'node', 'deno', 'bun',
  // Archives
  'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'bzip2', 'xz',
  // Text editors (interactive)
  'vim', 'vi', 'nano', 'emacs',
  // Shell
  'bash', 'sh', 'zsh', 'fish',
])

/**
 * Categories of sandbox commands
 */
export const SANDBOX_CATEGORIES = {
  process: ['ps', 'kill', 'killall', 'top', 'htop', 'pkill', 'pgrep', 'nohup', 'nice', 'renice', 'bg', 'fg', 'jobs'],
  network: ['ping', 'ssh', 'scp', 'nc', 'ncat', 'netstat', 'ss', 'ip', 'ifconfig', 'traceroute', 'nmap', 'tcpdump', 'iptables'],
  container: ['docker', 'docker-compose', 'podman', 'kubectl', 'helm'],
  compiler: ['gcc', 'g++', 'clang', 'rustc', 'cargo', 'make', 'cmake'],
  runtime: ['python', 'python3', 'ruby', 'perl', 'go', 'lua', 'node', 'deno', 'bun'],
  package: ['apt', 'apt-get', 'yum', 'dnf', 'pacman', 'apk', 'brew'],
  shell: ['bash', 'sh', 'zsh', 'fish'],
  system: ['sudo', 'su', 'chgrp', 'mount', 'umount', 'df', 'du'],
} as const

// ============================================================================
// SANDBOX EXECUTOR CLASS
// ============================================================================

/**
 * SandboxExecutor - Execute commands in a full Linux sandbox
 *
 * Provides Tier 4 execution for commands that require full system access
 * and process isolation. This is the fallback tier for any command not
 * handled by tiers 1-3.
 *
 * Implements the TierExecutor interface for composition with TieredExecutor.
 *
 * @example
 * ```typescript
 * // Create with a sandbox backend
 * const executor = new SandboxExecutor({
 *   sandbox: mySandboxBackend,
 * })
 *
 * // Execute any command
 * const result = await executor.execute('ps aux')
 *
 * // Create and use sessions
 * const session = await executor.createSession()
 * await session.setWorkingDirectory('/app')
 * const result1 = await session.execute('ls')
 * const result2 = await session.execute('pwd')
 * await session.close()
 * ```
 *
 * @implements {TierExecutor}
 */
export class SandboxExecutor implements TierExecutor {
  private readonly sandbox?: SandboxBackend
  readonly defaultTimeout: number
  private readonly sessions: Map<string, SandboxSession> = new Map()
  private readonly resourceLimitEnforcer: ResourceLimitEnforcer
  private readonly resourceLimits: ResourceLimits

  constructor(config: SandboxExecutorConfig = {}) {
    this.sandbox = config.sandbox
    this.defaultTimeout = config.defaultTimeout ?? 30000
    this.resourceLimits = {
      ...DEFAULT_RESOURCE_LIMITS,
      ...config.resourceLimits,
    }
    this.resourceLimitEnforcer = createResourceLimitEnforcer(this.resourceLimits)
  }

  /**
   * Get the current resource limits
   */
  getResourceLimits(): ResourceLimits {
    return { ...this.resourceLimits }
  }

  /**
   * Check if sandbox is configured
   */
  get hasSandbox(): boolean {
    return this.sandbox !== undefined
  }

  /**
   * Check if sandbox is configured (alias)
   */
  get isSandboxConfigured(): boolean {
    return this.sandbox !== undefined
  }

  /**
   * Check if spawn is available
   */
  get canSpawn(): boolean {
    return this.sandbox?.spawn !== undefined
  }

  /**
   * Check if sessions can be created
   */
  get canCreateSession(): boolean {
    return this.sandbox !== undefined
  }

  /**
   * Check if this executor can handle a command
   *
   * SandboxExecutor is a fallback - it can handle any command
   */
  canExecute(_command: string): boolean {
    // Sandbox can execute anything if it's configured
    return this.sandbox !== undefined
  }

  /**
   * Check if a command specifically requires sandbox execution
   */
  requiresSandbox(command: string): boolean {
    const cmd = this.extractCommandName(command)
    return SANDBOX_COMMANDS.has(cmd)
  }

  /**
   * Check if a command is sandbox-specific (different commands not in tier 1/2/3)
   */
  isSandboxSpecific(command: string): boolean {
    const cmd = this.extractCommandName(command)
    return SANDBOX_COMMANDS.has(cmd)
  }

  /**
   * Get the command category
   */
  getCommandCategory(command: string): string {
    const cmd = this.extractCommandName(command)

    for (const [category, commands] of Object.entries(SANDBOX_CATEGORIES)) {
      if ((commands as readonly string[]).includes(cmd)) {
        return category
      }
    }

    return 'general'
  }

  /**
   * Get capabilities of this executor
   */
  getCapabilities(): SandboxCapability[] {
    const capabilities: SandboxCapability[] = []

    if (this.sandbox) {
      capabilities.push('execute')
      if (this.sandbox.spawn) {
        capabilities.push('spawn')
      }
      capabilities.push('session')
      capabilities.push('filesystem')
      capabilities.push('network')
    }

    return capabilities
  }

  /**
   * Execute a command in the sandbox with resource limit enforcement
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResultWithResourceUsage> {
    if (!this.sandbox) {
      return this.createErrorResult(command, 'No sandbox available')
    }

    const sandbox = this.sandbox
    const category = this.getCommandCategory(command)
    const timeout = options?.timeout ?? this.defaultTimeout

    // Support per-execution limit overrides from options
    const effectiveTimeoutMs = options?.timeout ?? this.resourceLimits.maxExecutionTimeMs
    const effectiveMaxOutput = options?.maxOutputSize ?? this.resourceLimits.maxOutputBytes

    // Use resource limit enforcer to wrap execution
    const result = await this.resourceLimitEnforcer.enforce(
      async () => {
        const sandboxResult = await sandbox.execute(command, {
          ...options,
          timeout,
        })

        // Add tier information to the result
        return {
          ...sandboxResult,
          classification: {
            ...sandboxResult.classification,
            reason: `${sandboxResult.classification.reason} (Tier 4: Sandbox)`,
            category,
          } as BashResult['classification'],
        }
      },
      {
        timeoutMs: effectiveTimeoutMs,
        maxOutputBytes: effectiveMaxOutput,
      }
    )

    return result
  }

  /**
   * Spawn a command for streaming execution
   */
  async spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    if (!this.sandbox?.spawn) {
      throw new Error('No sandbox available for spawn')
    }

    return this.sandbox.spawn(command, args, options ?? {})
  }

  /**
   * Create a new session
   */
  async createSession(): Promise<SandboxSession> {
    if (!this.sandbox) {
      throw new Error('No sandbox available for session')
    }

    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let workingDirectory = '/home/user'
    let environment: Record<string, string> = {}
    let active = true

    const session: SandboxSession = {
      id,
      execute: async (cmd: string) => {
        if (!active) {
          throw new Error('Session is closed')
        }
        const result = await this.sandbox!.execute(cmd, {
          cwd: workingDirectory,
          env: environment,
        })
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        }
      },
      getWorkingDirectory: () => workingDirectory,
      setWorkingDirectory: async (path: string) => {
        workingDirectory = path
      },
      getEnvironment: () => ({ ...environment }),
      setEnvironment: async (env: Record<string, string>) => {
        environment = { ...environment, ...env }
      },
      close: async () => {
        active = false
        this.sessions.delete(id)
      },
      isActive: () => active,
    }

    this.sessions.set(id, session)
    return session
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): SandboxSession[] {
    return Array.from(this.sessions.values()).filter(s => s.isActive())
  }

  /**
   * Close all sessions
   */
  async closeAllSessions(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.close()
    }
    this.sessions.clear()
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private createErrorResult(command: string, error: string): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: '',
      stderr: error,
      exitCode: 1,
      intent: {
        commands: [this.extractCommandName(command)],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Tier 4: Sandbox not available',
      },
    }
  }

  private extractCommandName(command: string): string {
    const trimmed = command.trim()
    const withoutEnvVars = trimmed.replace(/^(\w+=\S+\s+)+/, '')
    const match = withoutEnvVars.match(/^[\w\-./]+/)
    if (!match) return ''
    return match[0].split('/').pop() || ''
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a SandboxExecutor with the given configuration
 */
export function createSandboxExecutor(config: SandboxExecutorConfig = {}): SandboxExecutor {
  return new SandboxExecutor(config)
}

/**
 * withBash Mixin - Shell Execution Capability
 *
 * Adds $.bash to the WorkflowContext with shell operations:
 * - exec, run, spawn
 * - which, env, cd
 * - pipe
 *
 * Requires: withFs (depends on filesystem access for cwd management)
 *
 * This is a stub file - implementation pending.
 * Tests are written to drive implementation (RED TDD).
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { DO, Env } from '../../objects/DO'
import type { FsCapability, WithFsContext } from './fs'

// ============================================================================
// CAPABILITY TYPES
// ============================================================================

export interface BashExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface BashExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  shell?: string
}

export interface BashSpawnProcess {
  stdout: {
    on(event: 'data', callback: (chunk: string) => void): void
  }
  stderr: {
    on(event: 'data', callback: (chunk: string) => void): void
  }
  wait(): Promise<number>
  kill(signal?: string): void
}

export interface BashCapability {
  /**
   * Execute a shell command and return full result
   * Does not throw on non-zero exit code
   */
  exec(command: string, options?: BashExecOptions): Promise<BashExecResult>

  /**
   * Execute a shell command and return stdout
   * Throws on non-zero exit code
   */
  run(command: string, options?: BashExecOptions): Promise<string>

  /**
   * Spawn a process with streaming output
   */
  spawn(command: string, args?: string[], options?: BashExecOptions): Promise<BashSpawnProcess>

  /**
   * Find the path to an executable
   */
  which(command: string): Promise<string | null>

  /**
   * Get environment variable(s)
   */
  env(): Promise<Record<string, string>>
  env(name: string): Promise<string | undefined>

  /**
   * Change working directory for subsequent commands
   */
  cd(path: string): Promise<void>

  /**
   * Execute piped commands
   */
  pipe(commands: string[]): Promise<BashExecResult>
}

// ============================================================================
// EXTENDED CONTEXT TYPES
// ============================================================================

export interface WithBashContext extends WithFsContext {
  bash: BashCapability
}

// ============================================================================
// MIXIN TYPE
// ============================================================================

// Note: TypeScript requires any[] for mixin constructor patterns (TS2545)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T

// Type that requires $.fs to exist on the base class
type DOWithFsConstructor<E extends Env = Env> = Constructor<DO<E> & { $: WithFsContext }> & typeof DO<E>

export interface WithBashDO<E extends Env = Env> extends DO<E> {
  $: WithBashContext
}

// ============================================================================
// CAPABILITY IMPLEMENTATION
// ============================================================================

/**
 * Creates a BashCapability instance
 * This is a stub implementation - actual bash operations would be
 * implemented using a sandboxed execution environment
 */
function createBashCapability(): BashCapability {
  // Current working directory state
  let cwd = '/'

  return {
    async exec(command: string, options?: BashExecOptions): Promise<BashExecResult> {
      // Stub implementation
      throw new Error('bash.exec not implemented')
    },
    async run(command: string, options?: BashExecOptions): Promise<string> {
      // Stub implementation
      throw new Error('bash.run not implemented')
    },
    async spawn(command: string, args?: string[], options?: BashExecOptions): Promise<BashSpawnProcess> {
      // Stub implementation
      throw new Error('bash.spawn not implemented')
    },
    async which(command: string): Promise<string | null> {
      // Stub implementation
      throw new Error('bash.which not implemented')
    },
    env(name?: string): Promise<Record<string, string>> | Promise<string | undefined> {
      // Stub implementation - overloaded function
      throw new Error('bash.env not implemented')
    },
    async cd(path: string): Promise<void> {
      // Stub implementation - would validate path exists via fs
      cwd = path
    },
    async pipe(commands: string[]): Promise<BashExecResult> {
      // Stub implementation
      throw new Error('bash.pipe not implemented')
    },
  } as BashCapability
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

// Symbol for caching the bash capability instance
const BASH_CAPABILITY_CACHE = Symbol('bashCapabilityCache')

/**
 * Adds bash/shell capability to a DO class that already has filesystem capability
 *
 * @example
 * ```typescript
 * class MyDO extends withBash(withFs(DO)) {
 *   async runTests() {
 *     const result = await this.$.bash.exec('npm test')
 *     if (result.exitCode !== 0) {
 *       throw new Error(`Tests failed: ${result.stderr}`)
 *     }
 *     return result.stdout
 *   }
 * }
 * ```
 */
export function withBash<TBase extends Constructor<{ $: WithFsContext }>>(Base: TBase) {
  return class WithBash extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static capabilities = [...((Base as any).capabilities || []), 'bash']

    /**
     * Check if this DO class has a specific capability
     */
    hasCapability(name: string): boolean {
      if (name === 'bash') return true
      // Check if parent class has the hasCapability method (WithFs class)
      const baseProto = Base.prototype
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    // Cache for the bash capability instance
    private [BASH_CAPABILITY_CACHE]?: BashCapability

    /**
     * Lazy-loaded bash capability
     */
    private get bashCapability(): BashCapability {
      if (!this[BASH_CAPABILITY_CACHE]) {
        this[BASH_CAPABILITY_CACHE] = createBashCapability()
      }
      return this[BASH_CAPABILITY_CACHE]
    }

    // TypeScript requires any[] for mixin constructors (TS2545)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Extend $ to include bash capability (preserving fs from parent)
      const originalContext = this.$
      const self = this

      // Create a new proxy that extends the original $ with bash
      this.$ = new Proxy(originalContext as WithBashContext, {
        get(target, prop: string | symbol) {
          if (prop === 'bash') {
            return self.bashCapability
          }
          // Forward to original context (which includes fs)
          const value = (target as any)[prop]
          if (typeof value === 'function') {
            return value.bind(target)
          }
          return value
        },
      })
    }
  }
}

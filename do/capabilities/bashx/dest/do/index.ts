/**
 * bashx Durable Object Integration Module
 *
 * Provides the BashModule class for integrating bashx capabilities into
 * dotdo Durable Objects via the WorkflowContext ($) proxy.
 *
 * @example
 * ```typescript
 * import { BashModule } from 'bashx/do'
 *
 * // In a DO class
 * class MyDO extends DO {
 *   async run() {
 *     const bash = new BashModule(this.executor)
 *     const result = await bash.exec('ls -la')
 *     console.log(result.stdout)
 *   }
 * }
 * ```
 *
 * @module bashx/do
 */

import type {
  BashResult,
  BashCapability,
  ExecOptions,
  SpawnOptions,
  SpawnHandle,
  Program,
  SafetyClassification,
  Intent,
  FsCapability,
  FsEntry,
  FsStat,
  FsReadOptions,
  FsListOptions,
} from '../types.js'
import { parse } from '../ast/parser.js'
import { analyze, isDangerous } from '../ast/analyze.js'

// ============================================================================
// EXECUTOR INTERFACE
// ============================================================================

/**
 * Interface for external command executors.
 *
 * BashModule delegates actual command execution to an executor,
 * which could be Cloudflare Containers, a local shell, or a mock.
 */
export interface BashExecutor {
  /**
   * Execute a command and return the result.
   */
  execute(command: string, options?: ExecOptions): Promise<BashResult>

  /**
   * Spawn a command for streaming execution (optional).
   */
  spawn?(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle>
}

// ============================================================================
// MODULE OPTIONS
// ============================================================================

/**
 * Options for configuring BashModule behavior.
 *
 * @example
 * ```typescript
 * const bash = new BashModule(executor, {
 *   fs: fsCapability,           // Optional FsCapability for native file ops
 *   useNativeOps: true,         // Enable native operation optimization
 * })
 * ```
 */
export interface BashModuleOptions {
  /**
   * Optional FsCapability for native file operations.
   *
   * When provided, commands like `cat`, `head`, `tail`, `ls` can be
   * executed natively using $.fs instead of spawning a subprocess.
   * This is faster (Tier 1) and works in pure Workers environments.
   */
  fs?: FsCapability

  /**
   * Whether to use native operations when available.
   * When true and fs is provided, file operations will use FsCapability.
   *
   * @default true
   */
  useNativeOps?: boolean
}

/**
 * Commands that can be executed natively via FsCapability.
 * Maps command names to their native implementation handler.
 */
const NATIVE_FS_COMMANDS = new Set(['cat', 'head', 'tail', 'ls', 'test'])

// ============================================================================
// BASH MODULE CLASS
// ============================================================================

/**
 * BashModule - Capability module for bash execution in Durable Objects.
 *
 * Implements the BashCapability interface from dotdo, providing AST-based
 * safety analysis and command execution through an external executor.
 *
 * @example
 * ```typescript
 * import { BashModule } from 'bashx/do'
 *
 * // Create with a custom executor
 * const bash = new BashModule({
 *   execute: async (cmd, opts) => {
 *     // Execute via Cloudflare Containers, RPC, etc.
 *     return await containerExecutor.run(cmd, opts)
 *   }
 * })
 *
 * // Execute commands
 * const result = await bash.exec('npm', ['install'])
 * if (result.exitCode === 0) {
 *   console.log('Dependencies installed')
 * }
 *
 * // Run scripts
 * await bash.run(`
 *   set -e
 *   npm run build
 *   npm run test
 * `)
 *
 * // Check safety
 * const check = bash.isDangerous('rm -rf /')
 * if (check.dangerous) {
 *   console.warn(check.reason)
 * }
 * ```
 */
export class BashModule implements BashCapability {
  /**
   * Capability module name identifier.
   */
  readonly name = 'bash' as const

  /**
   * The executor used for running commands.
   */
  private readonly executor: BashExecutor

  /**
   * Optional FsCapability for native file operations.
   */
  private readonly fs?: FsCapability

  /**
   * Whether to use native operations when available.
   */
  private readonly useNativeOps: boolean

  /**
   * Whether the module has been initialized.
   */
  private initialized = false

  /**
   * Create a new BashModule instance.
   *
   * @param executor - The executor to use for running commands
   * @param options - Optional configuration including FsCapability integration
   *
   * @example
   * ```typescript
   * // Basic usage
   * const bash = new BashModule(executor)
   *
   * // With FsCapability for native file operations
   * const bash = new BashModule(executor, { fs: fsCapability })
   *
   * // Disable native ops (always use executor)
   * const bash = new BashModule(executor, { fs: fsCapability, useNativeOps: false })
   * ```
   */
  constructor(executor: BashExecutor, options?: BashModuleOptions) {
    this.executor = executor
    this.fs = options?.fs
    this.useNativeOps = options?.useNativeOps ?? true
  }

  /**
   * Check if FsCapability is available and native ops are enabled.
   */
  get hasFsCapability(): boolean {
    return this.useNativeOps && this.fs !== undefined
  }

  /**
   * Initialize the module.
   * Called when the capability is first accessed.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    // Future: initialize tree-sitter WASM, etc.
    this.initialized = true
  }

  /**
   * Clean up resources.
   * Called when the capability is unloaded.
   */
  async dispose(): Promise<void> {
    // Future: cleanup resources
    this.initialized = false
  }

  /**
   * Execute a command and wait for completion.
   *
   * This method performs AST-based safety analysis before execution:
   * 1. Parses the command into an AST
   * 2. Analyzes the AST for safety classification
   * 3. Blocks critical/high impact commands unless confirm: true is passed
   * 4. Executes the command if it passes the safety gate
   *
   * When FsCapability is available and the command is a native file operation
   * (cat, head, tail, ls, test), it will be executed natively without spawning
   * a subprocess. This is faster and works in pure Workers environments.
   *
   * @param command - The command to execute (e.g., 'git', 'npm', 'ls')
   * @param args - Optional array of command arguments
   * @param options - Optional execution options
   * @returns Promise resolving to the execution result
   *
   * @example
   * ```typescript
   * // Simple command
   * const result = await bash.exec('ls')
   *
   * // With arguments
   * const result = await bash.exec('git', ['status', '--short'])
   *
   * // With options
   * const result = await bash.exec('npm', ['install'], {
   *   cwd: '/app',
   *   timeout: 60000
   * })
   *
   * // Dangerous commands are blocked by default
   * const result = await bash.exec('rm', ['-rf', '/'])
   * // result.blocked === true, result.requiresConfirm === true
   *
   * // Use confirm: true to execute dangerous commands
   * const result = await bash.exec('rm', ['-rf', 'temp/'], { confirm: true })
   *
   * // With FsCapability, this uses $.fs.read() instead of spawning cat
   * const result = await bash.exec('cat', ['file.txt'])
   * ```
   */
  async exec(command: string, args?: string[], options?: ExecOptions): Promise<BashResult> {
    const fullCommand = args && args.length > 0 ? `${command} ${args.join(' ')}` : command

    // Perform AST-based safety analysis
    const safetyResult = this.performSafetyAnalysis(fullCommand, options)
    if (safetyResult) {
      return safetyResult
    }

    // Try native operation if FsCapability is available
    if (this.hasFsCapability && NATIVE_FS_COMMANDS.has(command)) {
      const nativeResult = await this.tryNativeExec(command, args || [], options)
      if (nativeResult) {
        return nativeResult
      }
    }

    // Execute via executor
    return this.executor.execute(fullCommand, options)
  }

  /**
   * Perform AST-based safety analysis on a command.
   * Returns a blocked result if the command should not be executed,
   * or null if execution should proceed.
   */
  private performSafetyAnalysis(command: string, options?: ExecOptions): BashResult | null {
    try {
      // Parse and analyze the command
      const ast = parse(command)
      const { classification, intent } = analyze(ast)
      const dangerCheck = isDangerous(ast)

      // Check if command requires confirmation
      const requiresConfirm = classification.impact === 'critical' || classification.impact === 'high'

      // If dangerous and not confirmed, block execution
      if (requiresConfirm && !options?.confirm) {
        return this.createBlockedResult(command, classification, intent, dangerCheck.reason)
      }

      // Command is safe or confirmed - allow execution
      return null
    } catch {
      // If AST analysis fails (e.g., parse error), allow executor to handle
      // This ensures backward compatibility and allows the executor to
      // provide its own error handling
      return null
    }
  }

  /**
   * Create a blocked result for dangerous commands.
   */
  private createBlockedResult(
    command: string,
    classification: SafetyClassification,
    intent: Intent,
    reason?: string,
  ): BashResult {
    const blockReason = reason || classification.reason || 'Command blocked due to safety concerns'

    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
      intent,
      classification,
      blocked: true,
      requiresConfirm: true,
      blockReason,
    }
  }

  /**
   * Try to execute a command natively using FsCapability.
   * Returns null if the command cannot be executed natively.
   */
  private async tryNativeExec(
    command: string,
    args: string[],
    options?: ExecOptions,
  ): Promise<BashResult | null> {
    if (!this.fs) return null

    try {
      switch (command) {
        case 'cat':
          return await this.nativeCat(args, options)
        case 'ls':
          return await this.nativeLs(args, options)
        case 'test':
          return await this.nativeTest(args, options)
        case 'head':
          return await this.nativeHead(args, options)
        case 'tail':
          return await this.nativeTail(args, options)
        default:
          return null
      }
    } catch (error) {
      // If native execution fails, return null to fall back to executor
      return null
    }
  }

  /**
   * Native implementation of 'cat' using FsCapability.
   */
  private async nativeCat(args: string[], options?: ExecOptions): Promise<BashResult | null> {
    if (!this.fs || args.length === 0) return null

    // Simple cat: cat file1 [file2 ...]
    const files = args.filter((arg) => !arg.startsWith('-'))
    if (files.length === 0) return null

    try {
      const contents = await Promise.all(files.map((file) => this.fs!.read(file)))
      const stdout = contents.join('')

      return this.createNativeResult(`cat ${args.join(' ')}`, stdout)
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return this.createNativeResult(`cat ${args.join(' ')}`, '', stderr, 1)
    }
  }

  /**
   * Native implementation of 'ls' using FsCapability.
   */
  private async nativeLs(args: string[], options?: ExecOptions): Promise<BashResult | null> {
    if (!this.fs) return null

    // Simple ls: ls [path]
    const paths = args.filter((arg) => !arg.startsWith('-'))
    const path = paths[0] || '.'

    try {
      const entries = await this.fs.list(path)
      const stdout = entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name)).join('\n') + '\n'

      return this.createNativeResult(`ls ${args.join(' ')}`, stdout)
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return this.createNativeResult(`ls ${args.join(' ')}`, '', stderr, 1)
    }
  }

  /**
   * Native implementation of 'test' using FsCapability.
   */
  private async nativeTest(args: string[], options?: ExecOptions): Promise<BashResult | null> {
    if (!this.fs) return null

    // Support: test -e file, test -f file, test -d file
    if (args.length < 2) return null

    const flag = args[0]
    const path = args[1]

    try {
      switch (flag) {
        case '-e': {
          // File exists
          const exists = await this.fs.exists(path)
          return this.createNativeResult(`test ${args.join(' ')}`, '', '', exists ? 0 : 1)
        }
        case '-f': {
          // Is regular file
          const exists = await this.fs.exists(path)
          if (!exists) return this.createNativeResult(`test ${args.join(' ')}`, '', '', 1)
          const stat = await this.fs.stat(path)
          return this.createNativeResult(`test ${args.join(' ')}`, '', '', stat.isFile ? 0 : 1)
        }
        case '-d': {
          // Is directory
          const exists = await this.fs.exists(path)
          if (!exists) return this.createNativeResult(`test ${args.join(' ')}`, '', '', 1)
          const stat = await this.fs.stat(path)
          return this.createNativeResult(`test ${args.join(' ')}`, '', '', stat.isDirectory ? 0 : 1)
        }
        default:
          return null // Unknown flag, fall back to executor
      }
    } catch {
      return this.createNativeResult(`test ${args.join(' ')}`, '', '', 1)
    }
  }

  /**
   * Native implementation of 'head' using FsCapability.
   */
  private async nativeHead(args: string[], options?: ExecOptions): Promise<BashResult | null> {
    if (!this.fs) return null

    // Parse arguments: head [-n lines] file
    let lines = 10 // default
    let file: string | undefined

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1]) {
        lines = parseInt(args[i + 1], 10)
        i++
      } else if (!args[i].startsWith('-')) {
        file = args[i]
      }
    }

    if (!file) return null

    try {
      const content = await this.fs.read(file)
      const allLines = content.split('\n')
      const stdout = allLines.slice(0, lines).join('\n') + (allLines.length > lines ? '\n' : '')

      return this.createNativeResult(`head ${args.join(' ')}`, stdout)
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return this.createNativeResult(`head ${args.join(' ')}`, '', stderr, 1)
    }
  }

  /**
   * Native implementation of 'tail' using FsCapability.
   */
  private async nativeTail(args: string[], options?: ExecOptions): Promise<BashResult | null> {
    if (!this.fs) return null

    // Parse arguments: tail [-n lines] file
    let lines = 10 // default
    let file: string | undefined

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1]) {
        lines = parseInt(args[i + 1], 10)
        i++
      } else if (!args[i].startsWith('-')) {
        file = args[i]
      }
    }

    if (!file) return null

    try {
      const content = await this.fs.read(file)
      const allLines = content.split('\n')
      // Handle trailing newline - if last element is empty, don't count it
      const effectiveLines = allLines[allLines.length - 1] === '' ? allLines.slice(0, -1) : allLines
      const stdout = effectiveLines.slice(-lines).join('\n') + '\n'

      return this.createNativeResult(`tail ${args.join(' ')}`, stdout)
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return this.createNativeResult(`tail ${args.join(' ')}`, '', stderr, 1)
    }
  }

  /**
   * Create a BashResult for native operations.
   */
  private createNativeResult(
    command: string,
    stdout: string,
    stderr: string = '',
    exitCode: number = 0,
  ): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout,
      stderr,
      exitCode,
      intent: {
        commands: [command.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Native filesystem operation',
      },
    }
  }

  /**
   * Spawn a command for streaming execution.
   * Returns a handle that can be used to interact with the running process.
   *
   * @param command - The command to spawn
   * @param args - Optional array of command arguments
   * @param options - Optional spawn options including stream callbacks
   * @returns Promise resolving to a spawn handle
   *
   * @example
   * ```typescript
   * // Stream output from a long-running process
   * const handle = await bash.spawn('tail', ['-f', '/var/log/app.log'], {
   *   onStdout: (chunk) => console.log(chunk),
   *   onStderr: (chunk) => console.error(chunk)
   * })
   *
   * // Later, stop the process
   * handle.kill()
   *
   * // Wait for it to finish
   * const result = await handle.done
   * ```
   */
  async spawn(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    if (!this.executor.spawn) {
      throw new Error('Spawn not supported by this executor')
    }
    return this.executor.spawn(command, args, options)
  }

  /**
   * Run a shell script.
   * Executes a multi-line bash script with full shell features.
   *
   * This method performs AST-based safety analysis before execution,
   * blocking dangerous scripts unless confirm: true is passed.
   *
   * @param script - The bash script to execute
   * @param options - Optional execution options
   * @returns Promise resolving to the execution result
   *
   * @example
   * ```typescript
   * const result = await bash.run(`
   *   set -e
   *   cd /app
   *   npm install
   *   npm run build
   *   npm run test
   * `)
   *
   * if (result.exitCode !== 0) {
   *   throw new Error('Build failed: ' + result.stderr)
   * }
   * ```
   */
  async run(script: string, options?: ExecOptions): Promise<BashResult> {
    // Perform AST-based safety analysis
    const safetyResult = this.performSafetyAnalysis(script, options)
    if (safetyResult) {
      return safetyResult
    }

    // Execute script via executor
    return this.executor.execute(script, options)
  }

  /**
   * Parse a command without executing it.
   * Useful for validation and analysis.
   *
   * @param input - The command or script to parse
   * @returns The parsed AST program
   */
  parse(input: string): Program {
    return parse(input)
  }

  /**
   * Analyze a command for safety classification.
   * Returns the safety classification and intent without executing.
   *
   * @param input - The command or script to analyze
   * @returns Analysis result with classification and intent
   */
  analyze(input: string): { classification: SafetyClassification; intent: Intent } {
    const ast = parse(input)
    return analyze(ast)
  }

  /**
   * Check if a command is dangerous.
   * Quick safety check without full analysis.
   *
   * @param input - The command to check
   * @returns Object indicating if dangerous and why
   */
  isDangerous(input: string): { dangerous: boolean; reason?: string } {
    const ast = parse(input)
    return isDangerous(ast)
  }
}

// ============================================================================
// MIXIN FUNCTION
// ============================================================================

/**
 * Type helper for classes with bash capability.
 */
export interface WithBashCapability {
  /** The bash module for executing commands */
  readonly bash: BashModule
}

/**
 * Constructor type helper for mixin composition.
 */
export type Constructor<T = object> = new (...args: any[]) => T

/**
 * Configuration for the withBash mixin.
 */
export interface WithBashConfig<TBase> {
  /**
   * Factory function to create the executor.
   * Receives the instance as its argument, allowing access to instance
   * properties like `env` for configuring the executor.
   */
  executor: (instance: InstanceType<TBase extends Constructor ? TBase : never>) => BashExecutor

  /**
   * Optional factory function to get FsCapability from the instance.
   * When provided, native file operations will use FsCapability.
   *
   * @example
   * ```typescript
   * const BaseDO = withBash(withFs(DO), {
   *   executor: (instance) => containerExecutor,
   *   fs: (instance) => instance.$.fs  // Use $.fs from withFs mixin
   * })
   * ```
   */
  fs?: (instance: InstanceType<TBase extends Constructor ? TBase : never>) => FsCapability | undefined

  /**
   * Whether to use native operations when FsCapability is available.
   * @default true
   */
  useNativeOps?: boolean
}

/**
 * Mixin function to add bash capability to a Durable Object class.
 *
 * This mixin provides lazy initialization of the BashModule, meaning
 * the executor is only created when the `bash` property is first accessed.
 * The BashModule instance is then cached for subsequent accesses.
 *
 * @param Base - The base DO class to extend
 * @param config - Configuration object or factory function for creating the executor.
 *   When a function is provided, it works as a simple executor factory.
 *   When an object is provided, it can include FsCapability integration.
 * @returns Extended class with bash capability
 *
 * @example Basic usage with executor function
 * ```typescript
 * import { withBash } from 'bashx/do'
 * import { DO } from 'dotdo'
 *
 * class MyDO extends withBash(DO, (instance) => ({
 *   execute: async (cmd, opts) => {
 *     // Use instance.env.CONTAINER_SERVICE or similar
 *     return await containerService.run(cmd, opts)
 *   }
 * })) {
 *   async deploy() {
 *     const result = await this.bash.exec('npm', ['run', 'build'])
 *     return result.exitCode === 0
 *   }
 * }
 * ```
 *
 * @example With FsCapability integration
 * ```typescript
 * import { withBash } from 'bashx/do'
 * import { withFs } from 'dotdo/fs'
 * import { DO } from 'dotdo'
 *
 * // First add fs capability, then bash with fs integration
 * class MyDO extends withBash(withFs(DO), {
 *   executor: (instance) => containerExecutor,
 *   fs: (instance) => instance.$.fs  // Native file ops use $.fs
 * }) {
 *   async readConfig() {
 *     // 'cat config.json' uses $.fs.read() natively (Tier 1, fast!)
 *     const result = await this.bash.exec('cat', ['config.json'])
 *     return result.stdout
 *   }
 * }
 * ```
 *
 * @example With environment bindings
 * ```typescript
 * import { withBash } from 'bashx/do'
 * import { DO } from 'dotdo'
 *
 * interface Env {
 *   CONTAINER_SERVICE: Fetcher
 * }
 *
 * class MyDO extends withBash(DO<Env>, (instance) => ({
 *   execute: async (cmd, opts) => {
 *     const response = await instance.env.CONTAINER_SERVICE.fetch(
 *       'https://container/exec',
 *       { method: 'POST', body: JSON.stringify({ cmd, opts }) }
 *     )
 *     return response.json()
 *   }
 * })) {
 *   // this.bash is now available with type safety
 * }
 * ```
 *
 * @example Chaining with other mixins
 * ```typescript
 * import { withBash } from 'bashx/do'
 * import { withFs } from 'fsx/do'
 * import { DO } from 'dotdo'
 *
 * // Compose multiple capabilities
 * const BaseDO = withBash(withFs(DO, fsExecutor), bashExecutor)
 *
 * class MyDO extends BaseDO {
 *   async build() {
 *     // Access both capabilities
 *     await this.fs.write('config.json', JSON.stringify(config))
 *     await this.bash.exec('npm', ['run', 'build'])
 *   }
 * }
 * ```
 */
export function withBash<TBase extends Constructor>(
  Base: TBase,
  config: ((instance: InstanceType<TBase>) => BashExecutor) | WithBashConfig<TBase>,
): TBase & Constructor<WithBashCapability> {
  // Normalize config to object form
  const normalizedConfig: WithBashConfig<TBase> =
    typeof config === 'function' ? { executor: config as any } : config

  // Use abstract class to properly type the mixin
  abstract class BashMixin extends Base implements WithBashCapability {
    private _bashModule?: BashModule

    get bash(): BashModule {
      if (!this._bashModule) {
        const executor = normalizedConfig.executor(this as InstanceType<TBase>)
        const fs = normalizedConfig.fs?.(this as InstanceType<TBase>)
        const useNativeOps = normalizedConfig.useNativeOps ?? true

        this._bashModule = new BashModule(executor, { fs, useNativeOps })
      }
      return this._bashModule
    }
  }

  return BashMixin as TBase & Constructor<WithBashCapability>
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  BashResult,
  BashCapability,
  ExecOptions,
  SpawnOptions,
  SpawnHandle,
  FsCapability,
  FsEntry,
  FsStat,
  FsReadOptions,
  FsListOptions,
}

// Re-export container executor for convenience
export {
  CloudflareContainerExecutor,
  createContainerExecutor,
  createSessionContainerExecutor,
} from './container-executor.js'

export type {
  ContainerStub,
  GetContainerFn,
  ContainerExecutorConfig,
} from './container-executor.js'

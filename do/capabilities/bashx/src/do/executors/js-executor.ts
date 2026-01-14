/**
 * JsExecutor Module
 *
 * Tier 3 execution: Native JavaScript/TypeScript execution via V8 isolate sandbox.
 *
 * This module handles execution of inline JavaScript and TypeScript code:
 * - node -e "code" - Execute inline JavaScript
 * - bun -e "code" - Execute inline JavaScript (bun syntax)
 * - tsx -e "code" - Execute TypeScript
 * - esm run @scope/module - Execute esm.do module
 *
 * Security Guarantees:
 * -------------------
 * - V8 isolate sandbox (ai-evaluate)
 * - No filesystem access
 * - No network by default
 * - CPU/memory limits
 *
 * Interface Contract:
 * -------------------
 * JsExecutor implements the TierExecutor interface:
 * - canExecute(command): Returns true if command is node/bun/tsx -e or esm run
 * - execute(command, options): Evaluates code in sandboxed V8 isolate
 *
 * Dependency Injection:
 * ---------------------
 * - evaluator: JsEvaluator for sandboxed code execution
 * - defaultTimeout: Optional timeout configuration
 * - maxMemoryMB: Optional memory limit configuration
 *
 * @module bashx/do/executors/js-executor
 */

import type { BashResult, ExecOptions } from '../../types.js'
import type { TierExecutor, BaseExecutorConfig } from './types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from JavaScript evaluation
 */
export interface JsEvaluationResult {
  /** Evaluated result value */
  result: unknown
  /** Standard output (console.log, etc.) */
  stdout: string
  /** Standard error (console.error, exceptions) */
  stderr: string
  /** Exit code (0 for success, 1 for error) */
  exitCode: number
  /** Execution duration in milliseconds */
  duration?: number
}

/**
 * JavaScript evaluator interface
 *
 * Implementations should provide sandboxed execution of JavaScript code.
 * The default implementation uses ai-evaluate for V8 isolate sandboxing.
 */
export interface JsEvaluator {
  /**
   * Evaluate JavaScript code in a sandboxed environment
   *
   * @param code - JavaScript code to evaluate
   * @param options - Optional evaluation options
   * @returns Evaluation result with stdout, stderr, exitCode
   */
  evaluate(code: string, options?: {
    timeout?: number
    env?: Record<string, string>
    stdin?: string
  }): Promise<JsEvaluationResult>

  /**
   * Evaluate an ESM module by name
   *
   * @param moduleName - Module name (e.g., 'lodash', '@scope/module')
   * @param args - Optional arguments to pass to the module
   * @returns Evaluation result
   */
  evaluateModule(moduleName: string, args?: string[]): Promise<JsEvaluationResult>
}

/**
 * Configuration for JsExecutor.
 *
 * @example
 * ```typescript
 * const config: JsExecutorConfig = {
 *   evaluator: myEvaluator,
 *   defaultTimeout: 5000,
 *   maxMemoryMB: 128,
 * }
 * const executor = createJsExecutor(config)
 * ```
 */
export interface JsExecutorConfig extends BaseExecutorConfig {
  /**
   * JavaScript evaluator for sandboxed code execution.
   *
   * Without an evaluator, execute() will return an error for all commands.
   */
  evaluator?: JsEvaluator

  /**
   * Maximum memory limit in megabytes.
   * @default 256
   */
  maxMemoryMB?: number
}

// ============================================================================
// COMMAND SETS
// ============================================================================

/**
 * Commands handled by JsExecutor
 */
export const JS_COMMANDS = new Set<string>([
  'node',
  'bun',
  'tsx',
  'esm',
])

// ============================================================================
// JS EXECUTOR CLASS
// ============================================================================

/**
 * JsExecutor - Execute JavaScript/TypeScript code in a sandboxed V8 isolate
 *
 * Provides Tier 3 execution for inline JavaScript and TypeScript code.
 * Uses ai-evaluate for V8 isolate sandboxing with security guarantees.
 *
 * Implements the TierExecutor interface for composition with TieredExecutor.
 *
 * @example
 * ```typescript
 * // Create with an evaluator
 * const executor = new JsExecutor({
 *   evaluator: myEvaluator,
 * })
 *
 * // Check if command can be handled
 * if (executor.canExecute('node -e "console.log(1)"')) {
 *   const result = await executor.execute('node -e "console.log(1)"')
 *   console.log(result.stdout) // '1\n'
 * }
 *
 * // Execute TypeScript
 * const tsResult = await executor.execute('tsx -e "const x: number = 42; console.log(x)"')
 *
 * // Execute ESM module
 * const esmResult = await executor.execute('esm run lodash')
 * ```
 *
 * @implements {TierExecutor}
 */
export class JsExecutor implements TierExecutor {
  private readonly evaluator?: JsEvaluator
  private readonly defaultTimeout: number
  private readonly maxMemoryMB: number

  constructor(config: JsExecutorConfig = {}) {
    this.evaluator = config.evaluator
    this.defaultTimeout = config.defaultTimeout ?? 30000
    this.maxMemoryMB = config.maxMemoryMB ?? 256
  }

  /**
   * Check if an evaluator is available
   */
  get hasEvaluator(): boolean {
    return this.evaluator !== undefined
  }

  /**
   * Get the configured memory limit in MB
   */
  get memoryLimit(): number {
    return this.maxMemoryMB
  }

  /**
   * Check if this executor can handle a command
   *
   * Matches:
   * - node -e "code" or node --eval "code"
   * - bun -e "code" or bun --eval "code"
   * - tsx -e "code" or tsx --eval "code"
   * - esm run moduleName
   */
  canExecute(command: string): boolean {
    const trimmed = command.trim()

    // Check for node/bun/tsx -e or --eval
    if (/^(node|bun|tsx)\s+(-e|--eval)\s+/.test(trimmed)) {
      return true
    }

    // Check for esm run
    if (/^esm\s+run\s+/.test(trimmed)) {
      return true
    }

    return false
  }

  /**
   * Extract code from a command
   *
   * @param command - Full command string
   * @returns Extracted code or module name
   */
  extractCode(command: string): string {
    const trimmed = command.trim()

    // Handle esm run
    if (trimmed.startsWith('esm run ')) {
      const rest = trimmed.slice('esm run '.length).trim()
      // Module name is the first argument (before any flags)
      const parts = rest.split(/\s+/)
      return parts[0] || ''
    }

    // Handle node/bun/tsx -e or --eval
    const match = trimmed.match(/^(?:node|bun|tsx)\s+(?:-e|--eval)\s+(.+)$/)
    if (!match) return ''

    let codeArg = match[1].trim()

    // Handle quoted code
    if ((codeArg.startsWith('"') && codeArg.endsWith('"')) ||
        (codeArg.startsWith("'") && codeArg.endsWith("'"))) {
      codeArg = codeArg.slice(1, -1)
    }

    // Unescape escaped quotes
    codeArg = codeArg.replace(/\\"/g, '"').replace(/\\'/g, "'")

    return codeArg
  }

  /**
   * Extract module arguments from esm run command
   */
  private extractEsmArgs(command: string): string[] {
    const trimmed = command.trim()
    if (!trimmed.startsWith('esm run ')) return []

    const rest = trimmed.slice('esm run '.length).trim()
    const parts = rest.split(/\s+/)
    return parts.slice(1) // Skip module name
  }

  /**
   * Detect if command is TypeScript
   */
  private isTypeScript(command: string): boolean {
    return command.trim().startsWith('tsx ')
  }

  /**
   * Simple TypeScript to JavaScript transpilation
   * Strips type annotations for basic cases
   */
  private transpileTypeScript(code: string): string {
    // Remove type annotations: `: Type`
    let result = code.replace(/:\s*\w+(\[\])?(\s*=)/g, '$2')
    result = result.replace(/:\s*\w+(\[\])?(\s*[;,)])/g, '$2')
    result = result.replace(/:\s*\w+(\[\])?$/g, '')

    // Remove interface declarations
    result = result.replace(/interface\s+\w+\s*\{[^}]*\}\s*;?/g, '')

    // Remove type declarations
    result = result.replace(/type\s+\w+\s*=\s*[^;]+;/g, '')

    // Remove generic type parameters
    result = result.replace(/<\w+(\s*,\s*\w+)*>/g, '')

    // Clean up multiple semicolons
    result = result.replace(/;+/g, ';')
    result = result.replace(/^\s*;/gm, '')

    return result.trim()
  }

  /**
   * Execute a JavaScript/TypeScript command
   */
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    if (!this.evaluator) {
      return this.createResult(
        command,
        '',
        'No JavaScript evaluator available',
        1
      )
    }

    const trimmed = command.trim()

    try {
      // Handle esm run
      if (trimmed.startsWith('esm run ')) {
        return await this.executeEsmModule(command, options)
      }

      // Extract and execute code
      let code = this.extractCode(command)

      // Transpile TypeScript if needed
      if (this.isTypeScript(command)) {
        code = this.transpileTypeScript(code)
      }

      // Prepare evaluation options
      const evalOptions: { timeout?: number; env?: Record<string, string>; stdin?: string } = {
        timeout: options?.timeout ?? this.defaultTimeout,
      }

      if (options?.env) {
        evalOptions.env = options.env
      }

      if (options?.stdin) {
        evalOptions.stdin = options.stdin
      }

      const result = await this.evaluator.evaluate(code, evalOptions)

      return this.createResult(
        command,
        result.stdout,
        result.stderr,
        result.exitCode
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.createResult(
        command,
        '',
        message,
        1
      )
    }
  }

  /**
   * Execute an ESM module
   */
  private async executeEsmModule(command: string, _options?: ExecOptions): Promise<BashResult> {
    if (!this.evaluator) {
      return this.createResult(
        command,
        '',
        'No JavaScript evaluator available',
        1
      )
    }

    const moduleName = this.extractCode(command)
    const args = this.extractEsmArgs(command)

    try {
      const result = await this.evaluator.evaluateModule(moduleName, args)

      return this.createResult(
        command,
        result.stdout,
        result.stderr,
        result.exitCode
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.createResult(
        command,
        '',
        message,
        1
      )
    }
  }

  /**
   * Create a BashResult from execution output
   */
  private createResult(
    command: string,
    stdout: string,
    stderr: string,
    exitCode: number
  ): BashResult {
    const cmd = this.extractCommandName(command)

    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout,
      stderr,
      exitCode,
      intent: {
        commands: [cmd],
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
        reason: 'Tier 3: Sandboxed JavaScript execution',
        capability: 'js-executor',
      } as BashResult['classification'],
    }
  }

  /**
   * Extract the command name from a full command string
   */
  private extractCommandName(command: string): string {
    const trimmed = command.trim()
    const match = trimmed.match(/^(\w+)/)
    return match ? match[1] : ''
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a JsExecutor with the given configuration
 */
export function createJsExecutor(config: JsExecutorConfig = {}): JsExecutor {
  return new JsExecutor(config)
}

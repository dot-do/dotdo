/**
 * PolyglotExecutor Module
 *
 * Routes commands to language-specific warm runtime workers via RPC.
 * This is the bridge between bashx and language-specific execution environments.
 *
 * Supported Language Runtimes:
 * - pyx.do for Python (python, python3, pip, pip3, pipx, uvx)
 * - ruby.do for Ruby (ruby, irb, gem, bundle)
 * - node.do for Node.js (node, npm, npx, pnpm, yarn, bun)
 * - go.do for Go (go)
 * - rust.do for Rust (cargo, rustc)
 *
 * Each runtime is accessed via Cloudflare service bindings, providing
 * warm language runtimes with millisecond cold starts.
 *
 * @module bashx/do/executors/polyglot-executor
 */

import type { BashResult, ExecOptions } from '../../types.js'
import type { LanguageExecutor, SupportedLanguage, BaseExecutorConfig } from './types.js'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Language runtime binding - a service with a fetch method
 */
export type LanguageBinding = { fetch: typeof fetch }

/**
 * Configuration for PolyglotExecutor.
 *
 * @example
 * ```typescript
 * const config: PolyglotExecutorConfig = {
 *   bindings: {
 *     python: env.PYX_SERVICE,
 *     ruby: env.RUBY_SERVICE,
 *     node: env.NODE_SERVICE,
 *   },
 *   defaultTimeout: 30000,
 * }
 * const executor = new PolyglotExecutor(config)
 * ```
 */
export interface PolyglotExecutorConfig extends BaseExecutorConfig {
  /**
   * Language runtime bindings.
   * Maps language names to their service bindings.
   */
  bindings: Partial<Record<SupportedLanguage, LanguageBinding>>

  /**
   * Default timeout for command execution in milliseconds.
   * @default 30000
   */
  defaultTimeout?: number
}

/**
 * RPC request payload for language runtime
 */
export interface PolyglotRequestPayload {
  /** Command to execute */
  command: string
  /** Working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
  /** Standard input */
  stdin?: string
}

/**
 * RPC response payload from language runtime
 */
export interface PolyglotResponsePayload {
  /** Standard output */
  stdout: string
  /** Standard error */
  stderr: string
  /** Exit code */
  exitCode: number
}

// ============================================================================
// LANGUAGE TO BINDING MAPPING
// ============================================================================

/**
 * Default service URLs for each language runtime
 */
export const DEFAULT_LANGUAGE_SERVICES: Record<SupportedLanguage, string> = {
  bash: 'https://bash.do',
  python: 'https://pyx.do',
  ruby: 'https://ruby.do',
  node: 'https://node.do',
  go: 'https://go.do',
  rust: 'https://rust.do',
}

// ============================================================================
// POLYGLOT EXECUTOR CLASS
// ============================================================================

/**
 * PolyglotExecutor - Route commands to language-specific warm runtime workers
 *
 * Provides multi-language execution by routing commands to appropriate
 * language runtime services. Supports both Cloudflare service bindings
 * and HTTP endpoints.
 *
 * @example
 * ```typescript
 * // Create with service bindings
 * const executor = new PolyglotExecutor({
 *   bindings: {
 *     python: env.PYX_SERVICE,
 *     ruby: env.RUBY_SERVICE,
 *   },
 * })
 *
 * // Check if language is available
 * if (executor.canExecute('python')) {
 *   const result = await executor.execute('print("hello")', 'python')
 * }
 * ```
 *
 * Note: PolyglotExecutor implements LanguageExecutor, NOT TierExecutor.
 * This is intentional because the interface contracts differ:
 * - LanguageExecutor.canExecute(language) - checks language availability
 * - LanguageExecutor.execute(command, language, options) - requires language param
 *
 * See types.ts for detailed documentation on the interface separation.
 *
 * @implements {LanguageExecutor}
 */
export class PolyglotExecutor implements LanguageExecutor {
  private readonly bindings: Partial<Record<SupportedLanguage, LanguageBinding>>
  private readonly defaultTimeout: number

  constructor(config: PolyglotExecutorConfig) {
    this.bindings = config.bindings
    this.defaultTimeout = config.defaultTimeout ?? 30000
  }

  /**
   * Check if a language runtime binding is available.
   *
   * @param language - The language to check
   * @returns true if a binding exists for the language
   */
  canExecute(language: SupportedLanguage): boolean {
    return this.bindings[language] !== undefined
  }

  /**
   * Get the binding for a language.
   *
   * @param language - The language to get binding for
   * @returns The language binding or undefined
   */
  getBinding(language: SupportedLanguage): LanguageBinding | undefined {
    return this.bindings[language]
  }

  /**
   * Get list of available languages.
   *
   * @returns Array of language names with bindings
   */
  getAvailableLanguages(): SupportedLanguage[] {
    return Object.keys(this.bindings).filter(
      (key) => this.bindings[key as SupportedLanguage] !== undefined
    ) as SupportedLanguage[]
  }

  /**
   * Create a blocked BashResult when execution cannot proceed.
   */
  private createBlockedResult(
    command: string,
    reason: string,
    language: SupportedLanguage
  ): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: '',
      stderr: reason,
      exitCode: 1,
      blocked: true,
      blockReason: reason,
      intent: {
        commands: [],
        reads: [],
        writes: [],
        deletes: [],
        network: true,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'medium',
        reversible: false,
        reason: `Polyglot execution blocked for ${language}: ${reason}`,
      },
    }
  }

  /**
   * Create an error BashResult for execution failures.
   */
  private createErrorResult(
    command: string,
    error: string,
    language: SupportedLanguage
  ): BashResult {
    return {
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: '',
      stderr: error,
      exitCode: 1,
      intent: {
        commands: [],
        reads: [],
        writes: [],
        deletes: [],
        network: true,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'medium',
        reversible: false,
        reason: `Polyglot ${language} execution error`,
      },
    }
  }

  /**
   * Execute a command in the specified language runtime.
   *
   * @param command - The command or code to execute
   * @param language - The target language runtime
   * @param options - Optional execution options
   * @returns Promise resolving to a BashResult
   */
  async execute(
    command: string,
    language: SupportedLanguage,
    options?: ExecOptions
  ): Promise<BashResult> {
    const binding = this.bindings[language]

    // Check if binding is available
    if (!binding) {
      return this.createBlockedResult(
        command,
        `No binding available for ${language} runtime`,
        language
      )
    }

    // Build request payload
    const payload: PolyglotRequestPayload = {
      command,
      timeout: options?.timeout ?? this.defaultTimeout,
    }

    if (options?.cwd) {
      payload.cwd = options.cwd
    }
    if (options?.env) {
      payload.env = options.env
    }
    if (options?.stdin) {
      payload.stdin = options.stdin
    }

    // Execute via RPC
    try {
      const timeout = payload.timeout!

      // Create timeout promise for reliable timeout handling
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout exceeded')), timeout)
      })

      // Race fetch against timeout
      let response: Response
      try {
        response = await Promise.race([
          binding.fetch(DEFAULT_LANGUAGE_SERVICES[language], {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          }),
          timeoutPromise,
        ])
      } catch (err) {
        // Handle timeout from race
        if (err instanceof Error && err.message === 'Request timeout exceeded') {
          return this.createErrorResult(command, 'Request timeout exceeded', language)
        }
        throw err
      }

      // Handle non-OK response
      if (!response.ok) {
        const errorText = await response.text()
        return this.createErrorResult(
          command,
          `RPC error (${response.status}): ${errorText}`,
          language
        )
      }

      // Parse response
      let responsePayload: PolyglotResponsePayload
      try {
        responsePayload = (await response.json()) as PolyglotResponsePayload
      } catch {
        return this.createErrorResult(command, 'Failed to parse RPC response as JSON', language)
      }

      // Build successful result
      return {
        input: command,
        command,
        valid: true,
        generated: false,
        stdout: responsePayload.stdout,
        stderr: responsePayload.stderr,
        exitCode: responsePayload.exitCode,
        intent: {
          commands: [],
          reads: [],
          writes: [],
          deletes: [],
          network: true,
          elevated: false,
        },
        classification: {
          type: 'execute',
          impact: 'medium',
          reversible: false,
          reason: `Polyglot ${language} execution`,
        },
      }
    } catch (error) {
      // Handle network errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return this.createErrorResult(command, `Network error: ${errorMessage}`, language)
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a PolyglotExecutor with the given configuration
 */
export function createPolyglotExecutor(config: PolyglotExecutorConfig): PolyglotExecutor {
  return new PolyglotExecutor(config)
}

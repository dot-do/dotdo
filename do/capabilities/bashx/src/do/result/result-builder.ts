/**
 * ResultBuilder - Fluent API for BashResult construction
 *
 * Provides a builder pattern for constructing BashResult objects with
 * sensible defaults for intent and classification. This eliminates
 * repetitive boilerplate across 70+ createResult calls in the codebase.
 *
 * @example
 * ```typescript
 * // Simple success result
 * const result = ResultBuilder.success('echo hello', 'hello\n').build()
 *
 * // With tier information
 * const result = ResultBuilder.success('ls', 'files')
 *   .withTier(1)
 *   .build()
 *
 * // Convenience method
 * const result = ResultBuilder.tier1Success('ls', 'files')
 * ```
 *
 * @module src/do/result/result-builder
 */

import type { BashResult, Intent, SafetyClassification } from '../../types.js'

/**
 * Default intent for commands - safe empty state.
 */
const DEFAULT_INTENT: Intent = {
  commands: [],
  reads: [],
  writes: [],
  deletes: [],
  network: false,
  elevated: false,
}

/**
 * Default classification for successful commands.
 */
const DEFAULT_SUCCESS_CLASSIFICATION: SafetyClassification = {
  type: 'execute',
  impact: 'none',
  reversible: true,
  reason: 'Command executed successfully',
}

/**
 * Default classification for failed commands.
 */
const DEFAULT_ERROR_CLASSIFICATION: SafetyClassification = {
  type: 'execute',
  impact: 'none',
  reversible: true,
  reason: 'Command execution failed',
}

/**
 * Default classification for blocked commands.
 */
const DEFAULT_BLOCKED_CLASSIFICATION: SafetyClassification = {
  type: 'execute',
  impact: 'medium',
  reversible: false,
  reason: 'Command execution blocked',
}

/**
 * Internal state for the builder.
 */
interface BuilderState {
  input: string
  command: string
  stdout: string
  stderr: string
  exitCode: number
  valid: boolean
  generated: boolean
  blocked?: boolean
  blockReason?: string
  intent: Intent
  classification: SafetyClassification
  tier?: 1 | 2 | 3
  language?: 'bash' | 'python' | 'ruby' | 'node' | 'go' | 'rust'
}

/**
 * Builder class for constructing BashResult objects with a fluent API.
 *
 * Use the static factory methods to create a builder:
 * - `ResultBuilder.success(command, stdout)` - for successful executions
 * - `ResultBuilder.error(command, stderr, exitCode)` - for failed executions
 * - `ResultBuilder.blocked(command, reason)` - for blocked commands
 *
 * Then chain optional customizations:
 * - `.withTier(1|2|3)` - set execution tier
 * - `.withLanguage('python'|...)` - set language
 * - `.withIntent({...})` - override intent
 * - `.withClassification({...})` - override classification
 *
 * Finally, call `.build()` to get the BashResult.
 */
export class ResultBuilder {
  private state: BuilderState

  /**
   * Private constructor - use static factory methods instead.
   */
  private constructor(state: BuilderState) {
    this.state = { ...state }
  }

  // ============================================================================
  // STATIC FACTORY METHODS
  // ============================================================================

  /**
   * Create a builder for a successful command execution.
   *
   * @param command - The command that was executed
   * @param stdout - The standard output from the command
   * @returns A new ResultBuilder instance
   *
   * @example
   * ```typescript
   * const result = ResultBuilder.success('ls', 'file1\nfile2\n').build()
   * ```
   */
  static success(command: string, stdout: string): ResultBuilder {
    return new ResultBuilder({
      input: command,
      command,
      stdout,
      stderr: '',
      exitCode: 0,
      valid: true,
      generated: false,
      intent: { ...DEFAULT_INTENT },
      classification: { ...DEFAULT_SUCCESS_CLASSIFICATION },
    })
  }

  /**
   * Create a builder for a failed command execution.
   *
   * @param command - The command that was executed
   * @param stderr - The standard error from the command
   * @param exitCode - The exit code (non-zero)
   * @returns A new ResultBuilder instance
   *
   * @example
   * ```typescript
   * const result = ResultBuilder.error('cat missing.txt', 'No such file', 1).build()
   * ```
   */
  static error(command: string, stderr: string, exitCode: number): ResultBuilder {
    return new ResultBuilder({
      input: command,
      command,
      stdout: '',
      stderr,
      exitCode,
      valid: true,
      generated: false,
      intent: { ...DEFAULT_INTENT },
      classification: { ...DEFAULT_ERROR_CLASSIFICATION },
    })
  }

  /**
   * Create a builder for a blocked command.
   *
   * @param command - The command that was blocked
   * @param reason - The reason for blocking
   * @returns A new ResultBuilder instance
   *
   * @example
   * ```typescript
   * const result = ResultBuilder.blocked('rm -rf /', 'Destructive command').build()
   * ```
   */
  static blocked(command: string, reason: string): ResultBuilder {
    return new ResultBuilder({
      input: command,
      command,
      stdout: '',
      stderr: reason,
      exitCode: 1,
      valid: true,
      generated: false,
      blocked: true,
      blockReason: reason,
      intent: { ...DEFAULT_INTENT },
      classification: { ...DEFAULT_BLOCKED_CLASSIFICATION },
    })
  }

  // ============================================================================
  // CONVENIENCE FACTORY METHODS
  // ============================================================================

  /**
   * Create a successful Tier 1 result (direct shell execution).
   *
   * @param command - The command that was executed
   * @param stdout - The standard output
   * @returns A complete BashResult (not a builder)
   */
  static tier1Success(command: string, stdout: string): BashResult {
    return ResultBuilder.success(command, stdout)
      .withTier(1)
      .withClassification({
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Executed via Tier 1',
      })
      .build()
  }

  /**
   * Create a successful Tier 2 result (interpreted execution).
   *
   * @param command - The command that was executed
   * @param stdout - The standard output
   * @returns A complete BashResult (not a builder)
   */
  static tier2Success(command: string, stdout: string): BashResult {
    return ResultBuilder.success(command, stdout)
      .withTier(2)
      .withClassification({
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Executed via Tier 2',
      })
      .build()
  }

  /**
   * Create a successful Tier 3 result (compiled execution).
   *
   * @param command - The command that was executed
   * @param stdout - The standard output
   * @returns A complete BashResult (not a builder)
   */
  static tier3Success(command: string, stdout: string): BashResult {
    return ResultBuilder.success(command, stdout)
      .withTier(3)
      .withClassification({
        type: 'execute',
        impact: 'none',
        reversible: true,
        reason: 'Executed via Tier 3',
      })
      .build()
  }

  // ============================================================================
  // FLUENT CUSTOMIZATION METHODS
  // ============================================================================

  /**
   * Set a custom safety classification.
   *
   * @param classification - The classification to use
   * @returns This builder for chaining
   */
  withClassification(classification: SafetyClassification): this {
    this.state.classification = { ...classification }
    return this
  }

  /**
   * Set a custom intent.
   *
   * @param intent - The intent to use
   * @returns This builder for chaining
   */
  withIntent(intent: Intent): this {
    this.state.intent = { ...intent }
    return this
  }

  /**
   * Set the execution tier.
   *
   * @param tier - The tier (1, 2, or 3)
   * @returns This builder for chaining
   */
  withTier(tier: 1 | 2 | 3): this {
    this.state.tier = tier
    return this
  }

  /**
   * Set the execution language.
   *
   * @param language - The language used
   * @returns This builder for chaining
   */
  withLanguage(language: 'bash' | 'python' | 'ruby' | 'node' | 'go' | 'rust'): this {
    this.state.language = language
    return this
  }

  // ============================================================================
  // BUILD METHOD
  // ============================================================================

  /**
   * Build the final BashResult object.
   *
   * @returns A complete BashResult
   */
  build(): BashResult {
    const result: BashResult = {
      input: this.state.input,
      command: this.state.command,
      valid: this.state.valid,
      generated: this.state.generated,
      stdout: this.state.stdout,
      stderr: this.state.stderr,
      exitCode: this.state.exitCode,
      intent: { ...this.state.intent },
      classification: { ...this.state.classification },
    }

    // Add optional fields
    if (this.state.blocked) {
      result.blocked = this.state.blocked
    }
    if (this.state.blockReason) {
      result.blockReason = this.state.blockReason
    }
    if (this.state.tier !== undefined) {
      result.tier = this.state.tier
    }
    if (this.state.language !== undefined) {
      result.language = this.state.language
    }

    return result
  }
}

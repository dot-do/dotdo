/**
 * PipelineExecutor - Orchestrates pipeline command execution
 *
 * Implements the composite pattern for pipeline orchestration:
 * - Splits pipeline commands respecting shell quoting rules
 * - Chains stdout/stdin between pipeline stages
 * - Provides early termination on non-zero exit codes
 *
 * @module bashx/do/pipeline
 */

import type { BashResult, ExecOptions } from '../../types.js'

/**
 * Type for the command executor function.
 * Takes a command string and optional execution options,
 * returns a Promise resolving to a BashResult.
 */
export type CommandExecutor = (cmd: string, opts?: ExecOptions) => Promise<BashResult>

/**
 * PipelineExecutor orchestrates the execution of piped commands.
 *
 * It composes individual command executors and handles:
 * - Pipeline parsing (respecting quotes and escapes)
 * - Stdout-to-stdin chaining between stages
 * - Early termination on errors
 *
 * @example
 * ```typescript
 * const pipeline = new PipelineExecutor(async (cmd, opts) => {
 *   // Your command execution logic
 *   return await tieredExecutor.execute(cmd, opts)
 * })
 *
 * const result = await pipeline.execute('ls | grep foo | wc -l')
 * ```
 */
export class PipelineExecutor {
  /**
   * Create a new PipelineExecutor.
   *
   * @param executeCommand - Function to execute individual commands
   */
  constructor(private executeCommand: CommandExecutor) {}

  /**
   * Split a command into pipeline segments, respecting quotes.
   *
   * This method handles:
   * - Single and double quoted strings (pipes inside quotes are preserved)
   * - Escaped pipes (\|)
   * - Logical OR operators (||) which are NOT split
   * - Whitespace trimming
   *
   * @param input - The command string to split
   * @returns Array of pipeline segments
   *
   * @example
   * ```typescript
   * splitPipeline('ls | grep foo')      // ['ls', 'grep foo']
   * splitPipeline('echo "a | b" | cat') // ['echo "a | b"', 'cat']
   * splitPipeline('cmd1 || cmd2')       // ['cmd1 || cmd2']
   * ```
   */
  splitPipeline(input: string): string[] {
    const segments: string[] = []
    let current = ''
    let inSingleQuote = false
    let inDoubleQuote = false

    for (let i = 0; i < input.length; i++) {
      const char = input[i]

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        current += char
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        current += char
      } else if (char === '\\' && !inSingleQuote && input[i + 1] === '|') {
        // Escaped pipe - keep it as \|, don't split
        current += '\\|'
        i++
      } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
        // Check if it's || (logical OR) - skip if so
        if (input[i + 1] === '|') {
          current += '||'
          i++
        } else {
          // This is a pipe - split here
          const trimmed = current.trim()
          if (trimmed) {
            segments.push(trimmed)
          }
          current = ''
        }
      } else {
        current += char
      }
    }

    // Add final segment
    const trimmed = current.trim()
    if (trimmed) {
      segments.push(trimmed)
    }

    return segments
  }

  /**
   * Execute a pipeline of commands, passing stdout of each to stdin of next.
   *
   * Behavior:
   * - For single commands (no pipe), executes directly
   * - For pipelines, chains stdout to stdin sequentially
   * - Stops pipeline on non-zero exit code (early termination)
   * - Preserves all execution options across stages
   *
   * @param pipelineCommand - The full pipeline command string
   * @param options - Optional execution options
   * @returns Promise resolving to the final BashResult
   *
   * @example
   * ```typescript
   * // Simple pipeline
   * const result = await pipeline.execute('echo hello | cat')
   *
   * // With options
   * const result = await pipeline.execute('ls | grep foo', {
   *   cwd: '/tmp',
   *   timeout: 5000,
   * })
   * ```
   */
  async execute(pipelineCommand: string, options?: ExecOptions): Promise<BashResult> {
    const segments = this.splitPipeline(pipelineCommand)

    // Handle empty pipeline
    if (segments.length === 0) {
      return this.createEmptyResult(pipelineCommand)
    }

    let stdin = options?.stdin || ''
    let lastResult: BashResult | null = null

    for (const segment of segments) {
      const segmentOptions: ExecOptions = {
        ...options,
        stdin,
      }

      lastResult = await this.executeCommand(segment, segmentOptions)

      // If command failed, stop the pipeline (early termination)
      if (lastResult.exitCode !== 0) {
        return lastResult
      }

      // Pass stdout to next command's stdin
      stdin = lastResult.stdout
    }

    return lastResult!
  }

  /**
   * Create an empty result for empty pipelines.
   */
  private createEmptyResult(input: string): BashResult {
    return {
      input,
      command: input,
      stdout: '',
      stderr: '',
      exitCode: 0,
      valid: true,
      generated: false,
      intent: {
        commands: [],
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
        reason: 'Empty pipeline',
      },
    }
  }
}

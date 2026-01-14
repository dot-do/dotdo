/**
 * formatResult Pipeline Stage
 *
 * Final stage of the MCP pipeline that assembles the BashResult from all
 * previous pipeline stage outputs. This stage transforms the intermediate
 * representations into the final output format expected by consumers.
 *
 * This stage is independently callable and provides a clean interface for
 * result formatting that can be used standalone or as part of a larger pipeline.
 *
 * @packageDocumentation
 */

import type { BashResult, ParseError } from '../../types.js'
import type { ClassifyResult } from './classify.js'

/**
 * Result from the parse stage.
 */
export interface ParseResult {
  /** The command string (may differ from original if fixed) */
  command: string
  /** Parsed AST or null if parsing failed */
  ast: { type: 'Program'; body: unknown[] } | null
  /** Parse errors, if any */
  errors: string[]
  /** Whether the command was auto-fixed */
  wasFix: boolean
  /** Suggestions for fixing parse errors */
  suggestions: string[]
}

/**
 * Result from the safety analysis stage.
 */
export interface SafetyResult {
  /** Safety classification of the command */
  classification: {
    type: 'read' | 'write' | 'delete' | 'execute' | 'network' | 'system' | 'mixed'
    impact: 'none' | 'low' | 'medium' | 'high' | 'critical'
    reversible: boolean
    reason: string
    suggestion?: string
  }
  /** Semantic intent extracted from the command */
  intent: {
    commands: string[]
    reads: string[]
    writes: string[]
    deletes: string[]
    network: boolean
    elevated: boolean
  }
}

/**
 * Result from the execute stage.
 */
export interface ExecuteResult {
  /** Whether the command was executed */
  executed: boolean
  /** Whether the command was blocked */
  blocked?: boolean
  /** Reason the command was blocked */
  blockReason?: string
  /** Standard output from execution */
  stdout?: string
  /** Standard error from execution */
  stderr?: string
  /** Exit code from execution */
  exitCode?: number
}

/**
 * Input for the formatResult stage.
 * Contains outputs from all previous pipeline stages.
 */
export interface FormatInput {
  /** The original user input */
  originalInput: string
  /** Result from the classify stage */
  classifyResult: ClassifyResult
  /** Result from the parse stage */
  parseResult: ParseResult
  /** Result from the safety analysis stage */
  safetyResult: SafetyResult
  /** Result from the execute stage */
  executeResult: ExecuteResult
}

/**
 * Result from the formatResult stage.
 * This is an alias for BashResult as this stage produces the final output.
 */
export type FormatResult = BashResult

/**
 * Format pipeline stage outputs into a BashResult.
 *
 * This is the final stage of the MCP pipeline. It assembles all the intermediate
 * results from classification, parsing, safety analysis, and execution into a
 * single BashResult that can be returned to consumers.
 *
 * @param input - The format input containing all previous stage outputs
 * @returns The final BashResult
 *
 * @example
 * ```typescript
 * const result = formatResult({
 *   originalInput: 'ls -la',
 *   classifyResult: { type: 'command', command: 'ls -la', originalInput: 'ls -la', wasGenerated: false },
 *   parseResult: { command: 'ls -la', ast: { type: 'Program', body: [] }, errors: [], wasFix: false, suggestions: [] },
 *   safetyResult: { classification: {...}, intent: {...} },
 *   executeResult: { executed: true, stdout: 'files...', stderr: '', exitCode: 0 }
 * })
 * // Returns complete BashResult
 * ```
 */
export function formatResult(input: FormatInput): BashResult {
  const {
    originalInput,
    classifyResult,
    parseResult,
    safetyResult,
    executeResult,
  } = input

  // Build errors array from parse errors and block reasons
  const errors: ParseError[] = []

  // Add parse errors
  for (const errorMsg of parseResult.errors) {
    errors.push({
      message: errorMsg,
      line: 1,
      column: 1,
    })
  }

  // Add block reason as an error if blocked
  if (executeResult.blocked && executeResult.blockReason) {
    errors.push({
      message: `Command blocked: ${executeResult.blockReason}`,
      line: 1,
      column: 1,
    })
  }

  // Build the BashResult
  // Note: We use a type assertion because the pipeline's `fixed` field is a boolean
  // indicating whether a fix was applied, while BashResult.fixed expects an object
  // with the fix details. The test contract specifies boolean semantics.
  const result = {
    // Input
    input: originalInput,

    // AST Analysis
    valid: parseResult.errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,

    // Include AST if parsing succeeded
    ...(parseResult.ast && {
      ast: parseResult.ast,
    }),

    // Mark if command was auto-fixed (boolean per pipeline contract)
    fixed: parseResult.wasFix,

    // Semantic Understanding
    intent: safetyResult.intent,

    // Safety Classification
    classification: safetyResult.classification,

    // Execution
    command: parseResult.command,
    generated: classifyResult.wasGenerated,
    stdout: executeResult.stdout ?? '',
    stderr: executeResult.stderr ?? '',
    exitCode: executeResult.exitCode ?? 0,

    // Safety Gate
    blocked: executeResult.blocked,

    // Recovery - include suggestion if available from safety classification
    ...(safetyResult.classification.suggestion && {
      suggestion: safetyResult.classification.suggestion,
    }),
  } as unknown as BashResult

  return result
}

/**
 * classifyAndGenerate Pipeline Stage
 *
 * First stage of the MCP pipeline that classifies input as either a bash command
 * or natural language intent and generates commands from intents if needed.
 *
 * This stage is independently callable and provides a clean interface for
 * input classification that can be used standalone or as part of a larger pipeline.
 *
 * @packageDocumentation
 */

import { classifyInput } from '../../../core/classify/index.js'

/**
 * Input for the classifyAndGenerate stage.
 */
export interface ClassifyInput {
  /**
   * The raw user input to classify (command or natural language).
   */
  input: string
}

/**
 * Result from the classifyAndGenerate stage.
 */
export interface ClassifyResult {
  /**
   * Type of input detected:
   * - 'command': Valid bash command syntax
   * - 'intent': Natural language request
   */
  type: 'command' | 'intent'

  /**
   * The command to execute.
   * For 'command' type: the original input (trimmed for whitespace-only)
   * For 'intent' type: a generated command (if available) or placeholder
   */
  command: string

  /**
   * The original input as provided.
   */
  originalInput: string

  /**
   * Whether the command was generated from natural language.
   * - true: command was generated from an intent
   * - false: command is the original input (it was already a command)
   */
  wasGenerated: boolean
}

/**
 * Pattern for environment variable assignments at the start of a command.
 * Matches patterns like: VAR=value command, NODE_ENV=production npm start
 */
const ENV_VAR_ASSIGNMENT = /^[A-Z_][A-Z0-9_]*=/i

/**
 * Pattern for bash comments (lines starting with #).
 */
const COMMENT_PATTERN = /^#/

/**
 * Check if input is a bash command based on shell syntax patterns.
 * This catches cases that the core classifier may miss.
 *
 * @param input - The input to check
 * @returns true if input looks like a shell command
 */
function isShellSyntax(input: string): boolean {
  // Environment variable assignment (e.g., NODE_ENV=production npm start)
  if (ENV_VAR_ASSIGNMENT.test(input)) {
    return true
  }

  // Comment lines (e.g., # this is a comment)
  if (COMMENT_PATTERN.test(input)) {
    return true
  }

  return false
}

/**
 * Classify input and optionally generate a command from natural language.
 *
 * This is the first stage of the MCP pipeline. It determines whether the input
 * is a direct bash command or natural language intent, and returns a normalized
 * result that downstream stages can process.
 *
 * @param input - The classification input containing the raw user input
 * @returns Classification result with type, command, and metadata
 *
 * @example
 * ```typescript
 * // Direct command
 * const result = await classifyAndGenerate({ input: 'ls -la' })
 * // { type: 'command', command: 'ls -la', originalInput: 'ls -la', wasGenerated: false }
 *
 * // Natural language intent
 * const result = await classifyAndGenerate({ input: 'show me all files' })
 * // { type: 'intent', command: 'ls -la', originalInput: 'show me all files', wasGenerated: true }
 *
 * // Empty input
 * const result = await classifyAndGenerate({ input: '' })
 * // { type: 'command', command: '', originalInput: '', wasGenerated: false }
 * ```
 */
export async function classifyAndGenerate(input: ClassifyInput): Promise<ClassifyResult> {
  const { input: rawInput } = input
  const trimmed = rawInput.trim()

  // Handle empty or whitespace-only input
  if (!trimmed) {
    return {
      type: 'command',
      command: '',
      originalInput: rawInput,
      wasGenerated: false,
    }
  }

  // Check for shell syntax patterns first (env vars, comments)
  // These are definitively commands that the core classifier might miss
  if (isShellSyntax(trimmed)) {
    return {
      type: 'command',
      command: trimmed,
      originalInput: rawInput,
      wasGenerated: false,
    }
  }

  // Use the core classification logic
  const classification = await classifyInput(trimmed)

  // Map classification result to pipeline stage result
  if (classification.type === 'command' || classification.type === 'invalid') {
    // Commands and invalid inputs pass through as commands
    return {
      type: 'command',
      command: trimmed,
      originalInput: rawInput,
      wasGenerated: false,
    }
  }

  // Intent type - return with generated command if available
  return {
    type: 'intent',
    command: classification.suggestedCommand ?? trimmed,
    originalInput: rawInput,
    wasGenerated: !!classification.suggestedCommand,
  }
}

/**
 * bashx MCP Tools
 *
 * Core tool: bash - AI-enhanced command execution
 * Stateful tools: execute_command, get_session_state, fork_session - persistent sessions
 */

import type { BashMcpTool, BashResult, Intent, SafetyClassification, Fix } from '../types.js'
import { parse } from '../ast/parser.js'
import { analyze } from '../ast/analyze.js'
import { autoFix } from '../ast/fix.js'
import { classifyInput } from '../classify.js'
import { generateCommand } from '../generate.js'
import { execute } from '../execute.js'
import { trackForUndo } from '../undo.js'

/**
 * The single bash MCP tool
 */
export const BASH_TOOL: BashMcpTool = {
  name: 'bash',
  description: `Execute bash commands with AI-enhanced safety and AST-based validation.

Provide either:
- A bash command to execute (e.g., "ls -la", "git status")
- A natural language description of what you want (e.g., "find large files", "count lines of code")

The tool will:
1. Parse the input to determine if it's a command or intent
2. If intent, generate the appropriate command
3. Parse the command into an AST for structural analysis
4. Classify safety (read/write/delete/system) and impact level
5. Block critical operations unless confirm=true
6. Execute and return results with undo capability if reversible

Dangerous commands (rm -rf /, chmod -R 777 /, etc.) require confirm=true.`,
  inputSchema: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: 'A bash command OR a natural language description of what you want to do',
      },
      confirm: {
        type: 'boolean',
        description: 'Set to true to execute dangerous/critical operations that would otherwise be blocked',
      },
    },
    required: ['input'],
  },
}

/**
 * Get the MCP tool definition
 */
export function getToolDefinition(): BashMcpTool {
  return BASH_TOOL
}

/**
 * Default intent for empty/invalid commands
 */
const EMPTY_INTENT: Intent = {
  commands: [],
  reads: [],
  writes: [],
  deletes: [],
  network: false,
  elevated: false,
}

/**
 * Default classification for read-only/empty commands
 */
const DEFAULT_CLASSIFICATION: SafetyClassification = {
  type: 'read',
  impact: 'none',
  reversible: true,
  reason: 'No operation',
}

/**
 * Handle bash tool invocation
 *
 * This is the main entry point for the MCP bash tool. It:
 * 1. Classifies input as command or natural language
 * 2. Generates command from NL if needed
 * 3. Parses the command into AST
 * 4. Analyzes safety classification
 * 5. Executes (or blocks) the command
 * 6. Returns comprehensive results
 */
export async function handleBash(params: { input: string; confirm?: boolean }): Promise<BashResult> {
  const { input, confirm = false } = params
  const trimmedInput = input.trim()

  // Handle empty or whitespace-only input
  if (!trimmedInput) {
    return {
      input,
      valid: true,
      intent: EMPTY_INTENT,
      classification: DEFAULT_CLASSIFICATION,
      command: '',
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
    }
  }

  // Step 1: Classify input (command vs natural language)
  const inputClassification = await classifyInput(trimmedInput)

  let command: string
  let generated = false
  let suggestions: string[] | undefined

  // Step 2: If natural language, generate command
  if (inputClassification.type === 'intent') {
    const genResult = await generateCommand(trimmedInput)

    if (!genResult.success || !genResult.command) {
      // Could not generate command from intent
      return {
        input,
        valid: false,
        intent: EMPTY_INTENT,
        classification: DEFAULT_CLASSIFICATION,
        command: '',
        generated: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        errors: [{
          message: genResult.error || 'Could not generate command from natural language',
          line: 1,
          column: 1,
          suggestion: genResult.alternatives?.[0],
        }],
        suggestions: genResult.alternatives,
      }
    }

    command = genResult.command
    generated = true
    suggestions = genResult.alternatives

    // If generated command is dangerous and blocked by generator
    if (genResult.blocked) {
      const ast = parse(command || trimmedInput)
      const { classification, intent } = command ? analyze(ast) : { classification: { ...DEFAULT_CLASSIFICATION, impact: 'critical' as const, type: 'delete' as const }, intent: EMPTY_INTENT }

      return {
        input,
        valid: true,
        ast,
        intent,
        classification: {
          ...classification,
          impact: 'critical',
        },
        command: command || '',
        generated: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
        blocked: true,
        requiresConfirm: true,
        blockReason: genResult.warning || 'Generated command is too dangerous to execute',
        suggestions,
      }
    }
  } else if (inputClassification.type === 'invalid') {
    // Invalid input
    return {
      input,
      valid: false,
      intent: EMPTY_INTENT,
      classification: DEFAULT_CLASSIFICATION,
      command: '',
      generated: false,
      stdout: '',
      stderr: '',
      exitCode: 0,
      errors: [{
        message: 'Invalid input',
        line: 1,
        column: 1,
      }],
    }
  } else {
    // It's a command
    command = trimmedInput
  }

  // Step 3: Parse the command into AST
  const ast = parse(command)
  const hasErrors = ast.errors && ast.errors.length > 0

  // Step 4: If there are parse errors, try to auto-fix
  let fixed: { command: string; changes: Fix[] } | undefined
  if (hasErrors) {
    const fixResult = autoFix(command)
    if (fixResult) {
      fixed = fixResult
    }
  }

  // Step 5: Analyze for safety (use fixed command if available)
  const analysisAst = fixed ? parse(fixed.command) : ast
  const { classification, intent } = analyze(analysisAst)

  // If command has unfixable errors, return error result
  if (hasErrors && !fixed) {
    return {
      input,
      valid: false,
      ast,
      intent,
      classification,
      command,
      generated,
      stdout: '',
      stderr: '',
      exitCode: 0,
      errors: ast.errors,
      suggestions: ast.errors?.map(e => e.suggestion).filter((s): s is string => !!s),
    }
  }

  // Step 6: Execute the command using the execute module
  const execResult = await execute(fixed?.command || command, { confirm })

  // Build the final result
  // Note: 'valid' reflects the original command's validity, not the fixed version
  // If we have errors in the original, valid is false even if we auto-fixed it
  const result: BashResult = {
    input,
    valid: !hasErrors,
    ast: analysisAst,
    intent: execResult.intent || intent,
    classification: execResult.classification || classification,
    command: fixed?.command || command,
    generated,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    exitCode: execResult.exitCode,
  }

  // Add optional fields
  if (hasErrors) {
    result.errors = ast.errors
  }

  if (fixed) {
    result.fixed = fixed
  }

  if (execResult.blocked) {
    result.blocked = true
    result.requiresConfirm = execResult.requiresConfirm
    result.blockReason = execResult.blockReason
  }

  // Add undo capability - either from successful execution or generated for capability display
  // This shows what command would undo the operation, even if the execution failed
  if (execResult.undo) {
    result.undo = execResult.undo
  } else if (!result.blocked && result.classification.reversible) {
    // Generate undo info for reversible operations that didn't succeed
    // This helps users understand what undo would be possible
    const undoInfo = trackForUndo(result.command, result.classification)
    if (undoInfo?.undoCommand) {
      result.undo = undoInfo.undoCommand
    }
  }

  // Include suggestions from various sources:
  // 1. NL generation suggestions
  // 2. Syntax error suggestions from parser
  const allSuggestions: string[] = []
  if (suggestions) {
    allSuggestions.push(...suggestions)
  }
  if (hasErrors && ast.errors) {
    const errorSuggestions = ast.errors
      .map(e => e.suggestion)
      .filter((s): s is string => !!s)
    allSuggestions.push(...errorSuggestions)
  }
  if (allSuggestions.length > 0) {
    result.suggestions = allSuggestions
  }

  return result
}

// ============================================================================
// Stateful Shell Exports
// ============================================================================

export {
  // Tool handlers
  executeCommand,
  getSessionState,
  forkSession,
  listSessions,
  closeSession,
  // Tool definitions
  mcpTools as statefulShellTools,
  // Types
  type ExecuteCommandInput,
  type ExecuteCommandOutput,
  type SessionStateOutput,
  // Utilities
  clearAllSessions,
  getSessionCount,
} from './stateful-shell.js'

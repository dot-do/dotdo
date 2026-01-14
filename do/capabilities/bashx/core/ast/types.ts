/**
 * AST Type Definitions and Type Guards
 *
 * This module provides type guards, factory functions, and serialization utilities
 * for working with bash AST nodes.
 *
 * @packageDocumentation
 */

import type {
  BashNode,
  Program,
  Command,
  Pipeline,
  List,
  Word,
  Redirect,
  Assignment,
  Subshell,
  CompoundCommand,
  FunctionDef,
  Expansion,
  ParseError,
} from '../types.js'

// Re-export types for convenience
export type {
  BashNode,
  Program,
  Command,
  Pipeline,
  List,
  Word,
  Redirect,
  Assignment,
  Subshell,
  CompoundCommand,
  FunctionDef,
  Expansion,
  ParseError,
}

// ============================================================================
// Node Type Constants
// ============================================================================

/**
 * Enum of all AST node types
 */
export const NodeType = {
  Program: 'Program',
  Command: 'Command',
  Pipeline: 'Pipeline',
  List: 'List',
  Subshell: 'Subshell',
  CompoundCommand: 'CompoundCommand',
  FunctionDef: 'FunctionDef',
  Word: 'Word',
  Redirect: 'Redirect',
  Assignment: 'Assignment',
} as const

/**
 * Array of all node type strings
 */
export const NODE_TYPES: string[] = [
  'Program',
  'Command',
  'Pipeline',
  'List',
  'Subshell',
  'CompoundCommand',
  'FunctionDef',
  'Word',
  'Redirect',
  'Assignment',
]

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Helper to check if value is a non-null object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Check if a value is a Program node
 */
export function isProgram(value: unknown): value is Program {
  return isObject(value) && value.type === 'Program'
}

/**
 * Check if a value is a Command node
 */
export function isCommand(value: unknown): value is Command {
  return isObject(value) && value.type === 'Command'
}

/**
 * Check if a value is a Pipeline node
 */
export function isPipeline(value: unknown): value is Pipeline {
  return isObject(value) && value.type === 'Pipeline'
}

/**
 * Check if a value is a List node
 */
export function isList(value: unknown): value is List {
  return isObject(value) && value.type === 'List'
}

/**
 * Check if a value is a Word node
 */
export function isWord(value: unknown): value is Word {
  return isObject(value) && value.type === 'Word'
}

/**
 * Check if a value is a Redirect node
 */
export function isRedirect(value: unknown): value is Redirect {
  return isObject(value) && value.type === 'Redirect'
}

/**
 * Check if a value is an Assignment node
 */
export function isAssignment(value: unknown): value is Assignment {
  return isObject(value) && value.type === 'Assignment'
}

/**
 * Check if a value is a Subshell node
 */
export function isSubshell(value: unknown): value is Subshell {
  return isObject(value) && value.type === 'Subshell'
}

/**
 * Check if a value is a CompoundCommand node
 */
export function isCompoundCommand(value: unknown): value is CompoundCommand {
  return isObject(value) && value.type === 'CompoundCommand'
}

/**
 * Check if a value is a FunctionDef node
 */
export function isFunctionDef(value: unknown): value is FunctionDef {
  return isObject(value) && value.type === 'FunctionDef'
}

/**
 * Check if a value is an Expansion object
 */
export function isExpansion(value: unknown): value is Expansion {
  if (!isObject(value)) return false
  const type = value.type
  return (
    type === 'ParameterExpansion' ||
    type === 'CommandSubstitution' ||
    type === 'ArithmeticExpansion' ||
    type === 'ProcessSubstitution'
  )
}

/**
 * Check if a value is any valid BashNode
 */
export function isBashNode(value: unknown): value is BashNode {
  if (!isObject(value)) return false
  const type = value.type
  return NODE_TYPES.includes(type as string)
}

/**
 * Get the type of a node, or undefined if not a valid node
 */
export function getNodeType(value: unknown): string | undefined {
  if (!isObject(value)) return undefined
  const type = value.type
  if (typeof type === 'string' && NODE_TYPES.includes(type)) {
    return type
  }
  return undefined
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a Program AST node (the root of a parsed bash script).
 *
 * @param body - Array of top-level AST nodes (defaults to empty array)
 * @param errors - Optional array of parse errors
 * @returns A new Program node
 *
 * @example
 * ```typescript
 * const program = createProgram([
 *   createCommand('ls', ['-la']),
 *   createCommand('echo', ['hello'])
 * ])
 * ```
 */
export function createProgram(body?: BashNode[], errors?: ParseError[]): Program {
  const program: Program = {
    type: 'Program',
    body: body ?? [],
  }
  if (errors !== undefined) {
    program.errors = errors
  }
  return program
}

/**
 * Create a Command node
 */
export function createCommand(
  name: string | null,
  args?: string[],
  redirects?: Redirect[],
  prefix?: Assignment[]
): Command {
  return {
    type: 'Command',
    name: name !== null ? createWord(name) : null,
    prefix: prefix ?? [],
    args: (args ?? []).map((arg) => createWord(arg)),
    redirects: redirects ?? [],
  }
}

/**
 * Create a Pipeline node
 */
export function createPipeline(commands: Command[], negated?: boolean): Pipeline {
  return {
    type: 'Pipeline',
    negated: negated ?? false,
    commands,
  }
}

/**
 * Create a List node
 */
export function createList(
  left: BashNode,
  operator: '&&' | '||' | ';' | '&',
  right: BashNode
): List {
  return {
    type: 'List',
    operator,
    left,
    right,
  }
}

/**
 * Create a Word node
 */
export function createWord(
  value: string,
  quoted?: 'single' | 'double' | 'ansi-c' | 'locale'
): Word {
  const word: Word = {
    type: 'Word',
    value,
  }
  if (quoted !== undefined) {
    word.quoted = quoted
  }
  return word
}

/**
 * Create a Redirect node
 */
export function createRedirect(
  op: Redirect['op'],
  target: string,
  fd?: number
): Redirect {
  const redirect: Redirect = {
    type: 'Redirect',
    op,
    target: createWord(target),
  }
  if (fd !== undefined) {
    redirect.fd = fd
  }
  return redirect
}

/**
 * Create an Assignment node
 */
export function createAssignment(
  name: string,
  value: string | null,
  operator?: '=' | '+='
): Assignment {
  return {
    type: 'Assignment',
    name,
    value: value !== null ? createWord(value) : null,
    operator: operator ?? '=',
  }
}

// ============================================================================
// Serialization Functions
// ============================================================================

/**
 * Serialize an AST to a JSON string
 */
export function serializeAST(ast: Program): string {
  return JSON.stringify(ast)
}

/**
 * Deserialize a JSON string to an AST
 */
export function deserializeAST(json: string): Program {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid JSON')
  }

  if (!isProgram(parsed)) {
    throw new Error('Invalid AST structure: expected Program node')
  }

  return parsed
}

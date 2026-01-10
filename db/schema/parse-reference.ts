/**
 * Cascade Reference Operator Parsing
 *
 * Parses field definitions containing reference operators:
 * - `->` Forward Exact
 * - `~>` Forward Fuzzy
 * - `<-` Backward Exact
 * - `<~` Backward Fuzzy
 *
 * Supports modifiers:
 * - `[]` Array
 * - `?` Optional
 * - `|` Union types
 */

import { OPERATORS, type Operator } from './operators'

export type OperatorDirection = 'forward' | 'backward'
export type OperatorMode = 'exact' | 'fuzzy'

export interface ParsedReference {
  prompt?: string
  operator: Operator
  direction: OperatorDirection
  mode: OperatorMode
  target: string
  targets?: string[]
  isArray?: boolean
  isOptional?: boolean
}

// Regex to match operator and target
// Group 1: optional prompt (everything before operator)
// Group 2: operator (->|~>|<-|<~)
// Group 3: target (everything after operator)
const OPERATOR_REGEX = /^([\s\S]*?)(->|~>|<-|<~)(.+)$/

/**
 * Parse the target portion of a reference, extracting:
 * - Type name(s)
 * - Array modifier ([])
 * - Optional modifier (?)
 * - Union types (|)
 */
function parseTarget(target: string): {
  target: string
  targets?: string[]
  isArray?: boolean
  isOptional?: boolean
} {
  let remaining = target.trim()

  // Check for optional modifier at the end
  const isOptional = remaining.endsWith('?')
  if (isOptional) {
    remaining = remaining.slice(0, -1)
  }

  // Check for array modifier
  const isArray = remaining.endsWith('[]')
  if (isArray) {
    remaining = remaining.slice(0, -2)
  }

  // Check for union types
  const types = remaining.split('|').map((t) => t.trim())
  const primaryTarget = types[0]

  const result: ReturnType<typeof parseTarget> = {
    target: primaryTarget,
  }

  if (types.length > 1) {
    result.targets = types
  }

  if (isArray) {
    result.isArray = true
  }

  if (isOptional) {
    result.isOptional = true
  }

  return result
}

/**
 * Parse a field string to extract reference operator information.
 *
 * @param field - The field definition string to parse
 * @returns ParsedReference if an operator is found, null otherwise
 *
 * @example
 * parseReferenceOperator('->User')
 * // { operator: '->', direction: 'forward', mode: 'exact', target: 'User' }
 *
 * parseReferenceOperator('What is the idea? <-Idea')
 * // { prompt: 'What is the idea?', operator: '<-', direction: 'backward', mode: 'exact', target: 'Idea' }
 *
 * parseReferenceOperator('->User|Org[]')
 * // { operator: '->', direction: 'forward', mode: 'exact', target: 'User', targets: ['User', 'Org'], isArray: true }
 */
export function parseReferenceOperator(field: string): ParsedReference | null {
  if (!field) return null

  const match = field.match(OPERATOR_REGEX)
  if (!match) return null

  const [, rawPrompt, op, rawTarget] = match
  const operator = op as Operator

  // Determine direction and mode from operator
  const direction: OperatorDirection = operator.startsWith('<')
    ? 'backward'
    : 'forward'
  const mode: OperatorMode = operator.includes('~') ? 'fuzzy' : 'exact'

  // Parse the target
  const targetInfo = parseTarget(rawTarget)

  // Build result
  const result: ParsedReference = {
    operator,
    direction,
    mode,
    ...targetInfo,
  }

  // Add prompt if present (trim whitespace)
  const prompt = rawPrompt?.trim()
  if (prompt) {
    result.prompt = prompt
  }

  return result
}

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
 *
 * This module now delegates to the centralized schema-parser for consistency.
 */

import { type Operator } from './operators'
import {
  defaultParser,
  type ParsedOperatorReference,
  type OperatorDirection,
  type OperatorMode,
} from './schema-parser'

// Re-export types for backward compatibility
export type { OperatorDirection, OperatorMode }

/**
 * ParsedReference interface for backward compatibility
 * Identical to ParsedOperatorReference from schema-parser
 */
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
 * @example
 * parseReferenceOperator('What is the idea? <-Idea')
 * // { prompt: 'What is the idea?', operator: '<-', direction: 'backward', mode: 'exact', target: 'Idea' }
 *
 * @example
 * parseReferenceOperator('->User|Org[]')
 * // { operator: '->', direction: 'forward', mode: 'exact', target: 'User', targets: ['User', 'Org'], isArray: true }
 */
export function parseReferenceOperator(field: string): ParsedReference | null {
  // Delegate to centralized parser
  return defaultParser.parseReference(field) as ParsedReference | null
}

/**
 * Type Guards for the db4ai-style Cascade Generation Type System
 *
 * Provides runtime type checking for ParsedField discriminated union types.
 */

import type {
  ParsedField,
  StringField,
  NumberField,
  BooleanField,
  ArrayField,
  ObjectField,
  ReferenceField,
  ComputedField,
  JSONPathField,
  PromptField,
  FieldInput,
} from './types'

// ============================================================================
// Type Guards for ParsedField Union
// ============================================================================

/**
 * Check if a ParsedField is a StringField
 */
export function isStringField(field: ParsedField): field is StringField {
  return field.kind === 'string'
}

/**
 * Check if a ParsedField is a NumberField
 */
export function isNumberField(field: ParsedField): field is NumberField {
  return field.kind === 'number'
}

/**
 * Check if a ParsedField is a BooleanField
 */
export function isBooleanField(field: ParsedField): field is BooleanField {
  return field.kind === 'boolean'
}

/**
 * Check if a ParsedField is an ArrayField
 */
export function isArrayField(field: ParsedField): field is ArrayField {
  return field.kind === 'array'
}

/**
 * Check if a ParsedField is an ObjectField
 */
export function isObjectField(field: ParsedField): field is ObjectField {
  return field.kind === 'object'
}

/**
 * Check if a ParsedField is a ReferenceField
 */
export function isReferenceField(field: ParsedField): field is ReferenceField {
  return field.kind === 'reference'
}

/**
 * Check if a ParsedField is a ComputedField
 */
export function isComputedField(field: ParsedField): field is ComputedField {
  return field.kind === 'computed'
}

/**
 * Check if a ParsedField is a JSONPathField
 */
export function isJSONPathField(field: ParsedField): field is JSONPathField {
  return field.kind === 'jsonpath'
}

/**
 * Check if a ParsedField is a PromptField
 */
export function isPromptField(field: ParsedField): field is PromptField {
  return field.kind === 'prompt'
}

// ============================================================================
// Reference Operator Parsing
// ============================================================================

/**
 * Reference operators and their meanings:
 * -> Forward exact (generate new, link to it)
 * ~> Forward fuzzy (semantic search, generate if not found)
 * <- Backward exact (generate new, link from it)
 * <~ Backward fuzzy (semantic search, link from found)
 */
const REFERENCE_OPERATORS = {
  '->': { direction: 'forward', mode: 'exact' },
  '~>': { direction: 'forward', mode: 'fuzzy' },
  '<-': { direction: 'backward', mode: 'exact' },
  '<~': { direction: 'backward', mode: 'fuzzy' },
} as const

type ReferenceOperator = keyof typeof REFERENCE_OPERATORS

/**
 * Parse a reference string to extract operator, target, and optional flag
 *
 * Examples:
 * - "->User" -> { operator: "->", target: "User", optional: false }
 * - "~>Category" -> { operator: "~>", target: "Category", optional: false }
 * - "<-Post" -> { operator: "<-", target: "Post", optional: false }
 * - "<~Article" -> { operator: "<~", target: "Article", optional: false }
 * - "->Employee?" -> { operator: "->", target: "Employee", optional: true }
 * - "Who is the owner? ->User" -> { operator: "->", target: "User", optional: false, prompt: "Who is the owner?" }
 */
function parseReferenceString(input: string): {
  operator: ReferenceOperator
  target: string | string[]
  optional: boolean
  prompt?: string
} | null {
  // Try each operator pattern
  const operatorPatterns: { pattern: RegExp; operator: ReferenceOperator }[] = [
    { pattern: /^(.*?)(<-)([A-Z][a-zA-Z0-9|]*)(\??)$/, operator: '<-' },
    { pattern: /^(.*?)(<~)([A-Z][a-zA-Z0-9|]*)(\??)$/, operator: '<~' },
    { pattern: /^(.*?)(->)([A-Z][a-zA-Z0-9|]*)(\??)$/, operator: '->' },
    { pattern: /^(.*?)(~>)([A-Z][a-zA-Z0-9|]*)(\??)$/, operator: '~>' },
  ]

  for (const { pattern, operator } of operatorPatterns) {
    const match = input.match(pattern)
    if (match) {
      const [, promptPart, , targetPart, optionalPart] = match
      const prompt = promptPart!.trim() || undefined

      // Parse target - check for union types (User|Org)
      const targets = targetPart!.split('|').filter(Boolean)
      const target: string | string[] = targets.length === 1 ? targets[0]! : targets

      return {
        operator,
        target,
        optional: optionalPart === '?',
        prompt,
      }
    }
  }

  return null
}

// ============================================================================
// Field Input Parsing (Any In)
// ============================================================================

/**
 * Parse a flexible FieldInput into a strongly typed ParsedField
 *
 * Supports:
 * - String: "What is the name?" -> StringField
 * - String with reference: "->User" -> ReferenceField
 * - Array: ["What are the tags?"] -> ArrayField of strings
 * - Array with reference: ["->OrderItem"] -> ArrayField of references
 * - Object: { street: "Street?", city: "City?" } -> ObjectField
 * - Function: (entity) => entity.a + entity.b -> ComputedField
 */
export function parseFieldInput(input: FieldInput): ParsedField {
  // Function -> ComputedField
  if (typeof input === 'function') {
    return {
      kind: 'computed',
      compute: input as (entity: unknown) => unknown,
      returnType: 'unknown', // Could be inferred from return type in more sophisticated implementation
    }
  }

  // Array -> ArrayField
  // Note: FieldInput arrays are [string] tuples, so always have exactly one element
  if (Array.isArray(input)) {
    const firstElement = input[0]
    if (typeof firstElement === 'string') {
      // Check if it's a reference array
      const refParsed = parseReferenceString(firstElement)
      if (refParsed) {
        return {
          kind: 'array',
          prompt: refParsed.prompt,
          items: {
            kind: 'reference',
            target: refParsed.target,
            direction: REFERENCE_OPERATORS[refParsed.operator].direction,
            mode: REFERENCE_OPERATORS[refParsed.operator].mode,
          },
        }
      }

      // String array
      return {
        kind: 'array',
        items: { kind: 'string', prompt: firstElement },
      }
    }

    // Nested object array - not fully supported in this implementation
    return {
      kind: 'array',
      items: { kind: 'string', prompt: 'Item' },
    }
  }

  // Object -> ObjectField
  if (typeof input === 'object' && input !== null) {
    const fields: Record<string, ParsedField> = {}
    for (const [key, value] of Object.entries(input)) {
      fields[key] = parseFieldInput(value as FieldInput)
    }
    return {
      kind: 'object',
      fields,
    }
  }

  // String -> StringField or ReferenceField
  if (typeof input === 'string') {
    // Check for reference operator
    const refParsed = parseReferenceString(input)
    if (refParsed) {
      return {
        kind: 'reference',
        target: refParsed.target,
        direction: REFERENCE_OPERATORS[refParsed.operator].direction,
        mode: REFERENCE_OPERATORS[refParsed.operator].mode,
        prompt: refParsed.prompt,
        optional: refParsed.optional || undefined,
      }
    }

    // Plain string prompt
    return {
      kind: 'string',
      prompt: input,
    }
  }

  // Fallback to string
  return {
    kind: 'string',
    prompt: String(input),
  }
}

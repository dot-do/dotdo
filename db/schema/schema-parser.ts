/**
 * Centralized Schema Parser for Cascade Generation System
 *
 * This module consolidates all schema parsing logic into a single, configurable parser
 * with improved error messages, validation, and caching.
 *
 * Features:
 * - Single source of truth for operator parsing patterns
 * - Rich error messages with hints
 * - Schema validation at parse time
 * - Circular reference detection
 * - Optional schema caching
 */

import { OPERATORS, type Operator } from './operators'

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Detailed schema parsing error with context and hints
 */
export class CascadeSchemaError extends Error {
  public field?: string
  public value?: string
  public reason: string
  public hint?: string
  public typeName?: string

  constructor(options: {
    field?: string
    value?: string
    reason: string
    hint?: string
    typeName?: string
  }) {
    const message = CascadeSchemaError.buildMessage(options)
    super(message)
    this.name = 'CascadeSchemaError'
    this.field = options.field
    this.value = options.value
    this.reason = options.reason
    this.hint = options.hint
    this.typeName = options.typeName
  }

  private static buildMessage(options: {
    field?: string
    value?: string
    reason: string
    hint?: string
    typeName?: string
  }): string {
    const parts: string[] = []

    if (options.typeName && options.field) {
      parts.push(`Error in ${options.typeName}.${options.field}`)
    } else if (options.field) {
      parts.push(`Error in field '${options.field}'`)
    } else if (options.typeName) {
      parts.push(`Error in type '${options.typeName}'`)
    } else {
      parts.push('Schema parsing error')
    }

    parts.push(`: ${options.reason}`)

    if (options.value !== undefined) {
      const displayValue = options.value.length > 50
        ? options.value.slice(0, 50) + '...'
        : options.value
      parts.push(` (got: '${displayValue}')`)
    }

    if (options.hint) {
      parts.push(`\n  Hint: ${options.hint}`)
    }

    return parts.join('')
  }
}

/**
 * Error thrown when circular references are detected at parse time
 */
export class CircularReferenceError extends CascadeSchemaError {
  public cyclePath: string[]

  constructor(cyclePath: string[]) {
    super({
      reason: `Circular reference detected: ${cyclePath.join(' -> ')}`,
      hint: 'Consider using a fuzzy operator (~> or <~) to break the cycle, or mark one field as optional (?)',
    })
    this.name = 'CircularReferenceError'
    this.cyclePath = cyclePath
  }
}

// ============================================================================
// PARSER CONFIGURATION
// ============================================================================

/**
 * Configuration options for the schema parser
 */
export interface SchemaParserConfig {
  /** Operators to recognize (defaults to all four cascade operators) */
  operators?: Operator[]
  /** Pattern for valid type names (defaults to PascalCase) */
  typePattern?: RegExp
  /** Pattern for array suffix (defaults to []) */
  arrayPattern?: RegExp
  /** Enable strict mode - reject unknown patterns */
  strict?: boolean
  /** Enable caching of parsed schemas */
  enableCache?: boolean
  /** Validate that referenced types exist */
  validateReferences?: boolean
  /** Detect circular references at parse time */
  detectCircularReferences?: boolean
}

const DEFAULT_CONFIG: Required<SchemaParserConfig> = {
  operators: [OPERATORS.FORWARD_EXACT, OPERATORS.FORWARD_FUZZY, OPERATORS.BACKWARD_EXACT, OPERATORS.BACKWARD_FUZZY],
  typePattern: /^[A-Z][a-zA-Z0-9]*$/,
  arrayPattern: /\[\]$/,
  strict: false,
  enableCache: true,
  validateReferences: true,
  detectCircularReferences: true,
}

// ============================================================================
// PARSED TYPES
// ============================================================================

export type OperatorDirection = 'forward' | 'backward'
export type OperatorMode = 'exact' | 'fuzzy'

/**
 * Result of parsing a reference operator from a field definition
 */
export interface ParsedOperatorReference {
  /** The raw operator string (e.g., '->') */
  operator: Operator
  /** Direction of the reference */
  direction: OperatorDirection
  /** Mode of resolution */
  mode: OperatorMode
  /** Primary target type name */
  target: string
  /** All target types (for union types like User|Org) */
  targets?: string[]
  /** Whether this is an array reference */
  isArray?: boolean
  /** Whether this reference is optional */
  isOptional?: boolean
  /** Prompt text preceding the operator */
  prompt?: string
}

/**
 * Primitive types that don't require reference resolution
 */
export const PRIMITIVE_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'email',
  'url',
  'uuid',
  'int',
  'float',
  'text',
  'json',
  'any',
  'unknown',
  'object',
  'array',
])

// ============================================================================
// SCHEMA PARSER CLASS
// ============================================================================

/**
 * Centralized schema parser with configurable options
 */
export class SchemaParser {
  private config: Required<SchemaParserConfig>
  private cache: Map<string, ParsedOperatorReference | null> = new Map()
  private operatorRegex: RegExp

  constructor(config: SchemaParserConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    // Build regex from configured operators, sorted by length (longest first for correct matching)
    const sortedOps = [...this.config.operators].sort((a, b) => b.length - a.length)
    const escapedOps = sortedOps.map(op => op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    this.operatorRegex = new RegExp(`^([\\s\\S]*?)(${escapedOps.join('|')})(.+)$`)
  }

  /**
   * Parse a field value string to extract reference operator information.
   * Returns null if no operator is found.
   *
   * @example
   * parser.parseReference('->User')
   * // { operator: '->', direction: 'forward', mode: 'exact', target: 'User' }
   *
   * @example
   * parser.parseReference('What is the idea? <-Idea')
   * // { prompt: 'What is the idea?', operator: '<-', direction: 'backward', mode: 'exact', target: 'Idea' }
   */
  parseReference(field: string): ParsedOperatorReference | null {
    if (!field) return null

    // Check cache
    if (this.config.enableCache) {
      const cached = this.cache.get(field)
      if (cached !== undefined) {
        return cached
      }
    }

    const result = this.parseReferenceInternal(field)

    // Cache result
    if (this.config.enableCache) {
      this.cache.set(field, result)
    }

    return result
  }

  private parseReferenceInternal(field: string): ParsedOperatorReference | null {
    const match = field.match(this.operatorRegex)
    if (!match) return null

    const [, rawPrompt, op, rawTarget] = match
    const operator = op as Operator

    // Validate operator is in our configured list
    if (!this.config.operators.includes(operator)) {
      return null
    }

    // Determine direction and mode from operator
    const direction: OperatorDirection = operator.startsWith('<') ? 'backward' : 'forward'
    const mode: OperatorMode = operator.includes('~') ? 'fuzzy' : 'exact'

    // Parse the target
    const targetInfo = this.parseTarget(rawTarget!)

    // Validate target type name if in strict mode
    if (this.config.strict && !this.config.typePattern.test(targetInfo.target)) {
      throw new CascadeSchemaError({
        value: `${operator}${rawTarget}`,
        reason: 'Target type must be PascalCase',
        hint: `Use ${operator}${targetInfo.target.charAt(0).toUpperCase()}${targetInfo.target.slice(1)} instead of ${operator}${targetInfo.target}`,
      })
    }

    // Build result
    const result: ParsedOperatorReference = {
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

  /**
   * Parse the target portion of a reference, extracting modifiers
   */
  private parseTarget(target: string): {
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
    const isArray = this.config.arrayPattern.test(remaining)
    if (isArray) {
      remaining = remaining.replace(this.config.arrayPattern, '')
    }

    // Check for union types
    const types = remaining.split('|').map((t) => t.trim())
    const primaryTarget = types[0]!

    const result: ReturnType<typeof this.parseTarget> = {
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
   * Check if a string represents a primitive type
   */
  isPrimitiveType(type: string): boolean {
    return PRIMITIVE_TYPES.has(type.toLowerCase())
  }

  /**
   * Check if a string is a valid PascalCase type name
   */
  isValidTypeName(name: string): boolean {
    return this.config.typePattern.test(name)
  }

  /**
   * Validate that all referenced types exist in the schema
   */
  validateReferences(
    schema: Record<string, Record<string, unknown>>
  ): CascadeSchemaError[] {
    const errors: CascadeSchemaError[] = []
    const definedTypes = new Set(Object.keys(schema).filter(k => !k.startsWith('$')))

    for (const [typeName, typeDef] of Object.entries(schema)) {
      if (typeName.startsWith('$')) continue

      for (const [fieldName, fieldValue] of Object.entries(typeDef)) {
        if (fieldName.startsWith('$')) continue

        const refs = this.extractReferencedTypes(fieldValue)
        for (const ref of refs) {
          if (!definedTypes.has(ref) && !this.isPrimitiveType(ref)) {
            errors.push(new CascadeSchemaError({
              typeName,
              field: fieldName,
              value: typeof fieldValue === 'string' ? fieldValue : String(fieldValue),
              reason: `Referenced type '${ref}' is not defined in schema`,
              hint: `Define the '${ref}' type in your schema, or use a primitive type (string, number, boolean, etc.)`,
            }))
          }
        }
      }
    }

    return errors
  }

  /**
   * Extract all referenced type names from a field value
   */
  private extractReferencedTypes(fieldValue: unknown): string[] {
    const refs: string[] = []

    if (typeof fieldValue === 'string') {
      const parsed = this.parseReference(fieldValue)
      if (parsed) {
        refs.push(...(parsed.targets ?? [parsed.target]))
      }
    } else if (Array.isArray(fieldValue)) {
      for (const item of fieldValue) {
        refs.push(...this.extractReferencedTypes(item))
      }
    }

    return refs
  }

  /**
   * Detect circular references in schema at parse time
   */
  detectCircularReferences(
    schema: Record<string, Record<string, unknown>>
  ): CircularReferenceError | null {
    const definedTypes = new Set(Object.keys(schema).filter(k => !k.startsWith('$')))

    // Build adjacency list for hard dependencies (-> and <- only)
    const hardDeps: Map<string, string[]> = new Map()

    for (const typeName of definedTypes) {
      const deps: string[] = []
      const typeDef = schema[typeName]

      for (const [fieldName, fieldValue] of Object.entries(typeDef ?? {})) {
        if (fieldName.startsWith('$')) continue

        if (typeof fieldValue === 'string') {
          const parsed = this.parseReference(fieldValue)
          // Only consider exact operators (-> and <-) as hard dependencies
          // Fuzzy operators (~> and <~) can be resolved lazily
          if (parsed && parsed.mode === 'exact' && !parsed.isOptional) {
            for (const target of parsed.targets ?? [parsed.target]) {
              if (definedTypes.has(target)) {
                deps.push(target)
              }
            }
          }
        } else if (Array.isArray(fieldValue) && fieldValue.length > 0) {
          const first = fieldValue[0]
          if (typeof first === 'string') {
            const parsed = this.parseReference(first)
            if (parsed && parsed.mode === 'exact' && !parsed.isOptional) {
              for (const target of parsed.targets ?? [parsed.target]) {
                if (definedTypes.has(target)) {
                  deps.push(target)
                }
              }
            }
          }
        }
      }

      hardDeps.set(typeName, deps)
    }

    // DFS to detect cycles
    const visited = new Set<string>()
    const recStack = new Set<string>()
    const path: string[] = []

    const hasCycle = (type: string): string[] | null => {
      if (recStack.has(type)) {
        // Found cycle - return the path from the cycle start
        const cycleStart = path.indexOf(type)
        return [...path.slice(cycleStart), type]
      }

      if (visited.has(type)) {
        return null
      }

      visited.add(type)
      recStack.add(type)
      path.push(type)

      for (const dep of hardDeps.get(type) ?? []) {
        const cycle = hasCycle(dep)
        if (cycle) {
          return cycle
        }
      }

      path.pop()
      recStack.delete(type)
      return null
    }

    for (const type of definedTypes) {
      const cycle = hasCycle(type)
      if (cycle) {
        return new CircularReferenceError(cycle)
      }
    }

    return null
  }

  /**
   * Clear the parse cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number } {
    return { size: this.cache.size }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a configured schema parser instance
 */
export function createSchemaParser(config: SchemaParserConfig = {}): SchemaParser {
  return new SchemaParser(config)
}

// ============================================================================
// DEFAULT PARSER INSTANCE
// ============================================================================

/**
 * Default schema parser with standard configuration
 */
export const defaultParser = createSchemaParser()

/**
 * Convenience function to parse a reference using the default parser
 */
export function parseOperatorReference(field: string): ParsedOperatorReference | null {
  return defaultParser.parseReference(field)
}

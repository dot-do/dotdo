/**
 * Targeting Operators System
 *
 * Plugin-based system for targeting operators with performance optimizations:
 * - Custom operator registration
 * - Regex caching with LRU eviction
 * - Optimized SemVer comparison
 * - Smart type coercion
 *
 * @module @dotdo/compat/flags/operators
 */

import type { EvaluationContext, TargetingClause, TargetingOperator } from './types'

// ============================================================================
// CUSTOM OPERATOR TYPES
// ============================================================================

/**
 * Function signature for custom operator implementations
 *
 * @param value - The value from the evaluation context
 * @param clauseValues - The values specified in the targeting clause
 * @param context - Full evaluation context (for advanced operators)
 * @returns true if the clause matches, false otherwise
 *
 * @example Basic custom operator
 * ```ts
 * const isEvenOperator: OperatorFunction = (value, clauseValues) => {
 *   return typeof value === 'number' && value % 2 === 0
 * }
 * ```
 *
 * @example Operator using context
 * ```ts
 * const hasAllTagsOperator: OperatorFunction = (value, clauseValues, context) => {
 *   const tags = context.tags as string[]
 *   return Array.isArray(tags) && clauseValues.every(v => tags.includes(String(v)))
 * }
 * ```
 */
export type OperatorFunction = (
  value: unknown,
  clauseValues: unknown[],
  context: EvaluationContext
) => boolean

/**
 * Custom operator definition with metadata
 *
 * @example
 * ```ts
 * const operator: CustomOperatorDefinition = {
 *   name: 'isEven',
 *   description: 'Matches when the numeric value is even',
 *   evaluate: (value) => typeof value === 'number' && value % 2 === 0,
 *   examples: [
 *     { value: 2, clauseValues: [], expected: true },
 *     { value: 3, clauseValues: [], expected: false },
 *   ],
 * }
 * ```
 */
export interface CustomOperatorDefinition {
  /** Unique operator name */
  name: string
  /** Human-readable description */
  description?: string
  /** The operator evaluation function */
  evaluate: OperatorFunction
  /** Example usages for documentation */
  examples?: Array<{
    value: unknown
    clauseValues: unknown[]
    expected: boolean
    description?: string
  }>
  /** Category for grouping in documentation */
  category?: 'membership' | 'string' | 'numeric' | 'date' | 'semver' | 'custom'
}

/**
 * Options for the operator registry
 */
export interface OperatorRegistryOptions {
  /** Maximum size of regex cache (default: 1000) */
  regexCacheSize?: number
  /** Enable strict mode - throw on unknown operators (default: false) */
  strictMode?: boolean
}

// ============================================================================
// REGEX CACHING
// ============================================================================

/**
 * LRU cache for compiled regex patterns
 */
class RegexCache {
  private cache = new Map<string, RegExp | null>()
  private maxSize: number

  constructor(maxSize = 1000) {
    this.maxSize = maxSize
  }

  /**
   * Get or compile a regex pattern
   */
  get(pattern: string): RegExp | null {
    // Check cache first
    if (this.cache.has(pattern)) {
      const cached = this.cache.get(pattern)!
      // Move to end for LRU behavior
      this.cache.delete(pattern)
      this.cache.set(pattern, cached)
      return cached
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }

    // Compile and cache
    try {
      const regex = new RegExp(pattern)
      this.cache.set(pattern, regex)
      return regex
    } catch {
      // Cache the failure to avoid repeated compilation attempts
      this.cache.set(pattern, null)
      return null
    }
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number } {
    return { size: this.cache.size, maxSize: this.maxSize }
  }
}

// ============================================================================
// SEMVER UTILITIES
// ============================================================================

/**
 * Parsed semantic version
 */
interface ParsedSemVer {
  major: number
  minor: number
  patch: number
  prerelease: string
  build: string
}

/**
 * Cache for parsed semver strings
 */
const semverCache = new Map<string, ParsedSemVer | null>()
const SEMVER_CACHE_MAX_SIZE = 500

/**
 * Parse a semantic version string with caching
 *
 * Handles formats: 1.0.0, 1.0.0-alpha, 1.0.0+build, v1.0.0, V2.0.0
 */
function parseSemVer(version: string): ParsedSemVer | null {
  // Check cache
  if (semverCache.has(version)) {
    return semverCache.get(version) ?? null
  }

  // Evict oldest if at capacity
  if (semverCache.size >= SEMVER_CACHE_MAX_SIZE) {
    const oldest = semverCache.keys().next().value
    if (oldest) semverCache.delete(oldest)
  }

  // Strip leading 'v' or 'V' prefix
  const cleanVersion = version.replace(/^[vV]/, '')

  // SemVer regex pattern
  const match = cleanVersion.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/
  )

  if (!match) {
    semverCache.set(version, null)
    return null
  }

  const parsed: ParsedSemVer = {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || '',
    build: match[5] || '',
  }

  semverCache.set(version, parsed)
  return parsed
}

/**
 * Compare two semantic versions
 *
 * @returns -1 if a < b, 0 if a == b, 1 if a > b, null if invalid
 */
function compareSemVer(a: string, b: string): number | null {
  const parsedA = parseSemVer(a)
  const parsedB = parseSemVer(b)

  if (!parsedA || !parsedB) return null

  // Compare major.minor.patch
  if (parsedA.major !== parsedB.major) return parsedA.major > parsedB.major ? 1 : -1
  if (parsedA.minor !== parsedB.minor) return parsedA.minor > parsedB.minor ? 1 : -1
  if (parsedA.patch !== parsedB.patch) return parsedA.patch > parsedB.patch ? 1 : -1

  // Compare prerelease (no prerelease > has prerelease)
  if (!parsedA.prerelease && parsedB.prerelease) return 1
  if (parsedA.prerelease && !parsedB.prerelease) return -1
  if (parsedA.prerelease && parsedB.prerelease) {
    // Lexicographic comparison for prerelease identifiers
    const partsA = parsedA.prerelease.split('.')
    const partsB = parsedB.prerelease.split('.')
    const maxLen = Math.max(partsA.length, partsB.length)

    for (let i = 0; i < maxLen; i++) {
      const partA = partsA[i]
      const partB = partsB[i]

      // Missing part is "less than" existing part
      if (partA === undefined) return -1
      if (partB === undefined) return 1

      // Numeric comparison if both are numbers
      const numA = parseInt(partA, 10)
      const numB = parseInt(partB, 10)
      const isNumA = !isNaN(numA) && String(numA) === partA
      const isNumB = !isNaN(numB) && String(numB) === partB

      if (isNumA && isNumB) {
        if (numA !== numB) return numA > numB ? 1 : -1
      } else if (isNumA) {
        // Numeric identifiers have lower precedence
        return -1
      } else if (isNumB) {
        return 1
      } else {
        // String comparison
        if (partA !== partB) return partA > partB ? 1 : -1
      }
    }
  }

  return 0
}

// ============================================================================
// TYPE COERCION
// ============================================================================

/**
 * Smart type coercion utilities for operator comparisons
 */
export const TypeCoercion = {
  /**
   * Coerce value to number if possible
   */
  toNumber(value: unknown): number | null {
    if (typeof value === 'number') return isNaN(value) ? null : value
    if (typeof value === 'string') {
      const num = parseFloat(value)
      return isNaN(num) ? null : num
    }
    if (typeof value === 'boolean') return value ? 1 : 0
    return null
  },

  /**
   * Coerce value to string
   */
  toString(value: unknown): string | null {
    if (typeof value === 'string') return value
    if (typeof value === 'number' && !isNaN(value)) return String(value)
    if (typeof value === 'boolean') return String(value)
    if (value === null) return 'null'
    if (value === undefined) return null
    return null
  },

  /**
   * Coerce value to Date
   */
  toDate(value: unknown): Date | null {
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value)
      return isNaN(date.getTime()) ? null : date
    }
    return null
  },

  /**
   * Coerce value to array
   */
  toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value
    if (value === null || value === undefined) return []
    return [value]
  },

  /**
   * Compare two values with type coercion
   */
  equals(a: unknown, b: unknown): boolean {
    // Direct equality
    if (a === b) return true

    // Null/undefined handling
    if (a === null && b === undefined) return false
    if (a === undefined && b === null) return false

    // Number comparison with coercion
    const numA = TypeCoercion.toNumber(a)
    const numB = TypeCoercion.toNumber(b)
    if (numA !== null && numB !== null) return numA === numB

    // String comparison with coercion
    const strA = TypeCoercion.toString(a)
    const strB = TypeCoercion.toString(b)
    if (strA !== null && strB !== null) return strA === strB

    return false
  },
}

// ============================================================================
// BUILT-IN OPERATORS
// ============================================================================

/**
 * Create the built-in operators
 */
function createBuiltInOperators(regexCache: RegexCache): Map<string, OperatorFunction> {
  const operators = new Map<string, OperatorFunction>()

  // Membership operators
  operators.set('in', (value, clauseValues) => {
    if (Array.isArray(value)) {
      return value.some(v => clauseValues.some(cv => cv === v))
    }
    return clauseValues.some(v => v === value)
  })

  operators.set('notIn', (value, clauseValues) => {
    if (Array.isArray(value)) {
      return !value.some(v => clauseValues.some(cv => cv === v))
    }
    return !clauseValues.some(v => v === value)
  })

  // String operators
  operators.set('startsWith', (value, clauseValues) => {
    if (typeof value !== 'string') return false
    return clauseValues.some(v => typeof v === 'string' && value.startsWith(v))
  })

  operators.set('endsWith', (value, clauseValues) => {
    if (typeof value !== 'string') return false
    return clauseValues.some(v => typeof v === 'string' && value.endsWith(v))
  })

  operators.set('contains', (value, clauseValues) => {
    if (typeof value !== 'string') return false
    return clauseValues.some(v => typeof v === 'string' && value.includes(v))
  })

  operators.set('matches', (value, clauseValues) => {
    if (typeof value !== 'string') return false
    return clauseValues.some(v => {
      if (typeof v !== 'string') return false
      const regex = regexCache.get(v)
      return regex ? regex.test(value) : false
    })
  })

  // Numeric operators
  operators.set('lessThan', (value, clauseValues) => {
    if (typeof value !== 'number') return false
    return clauseValues.some(v => typeof v === 'number' && value < v)
  })

  operators.set('lessThanOrEqual', (value, clauseValues) => {
    if (typeof value !== 'number') return false
    return clauseValues.some(v => typeof v === 'number' && value <= v)
  })

  operators.set('greaterThan', (value, clauseValues) => {
    if (typeof value !== 'number') return false
    return clauseValues.some(v => typeof v === 'number' && value > v)
  })

  operators.set('greaterThanOrEqual', (value, clauseValues) => {
    if (typeof value !== 'number') return false
    return clauseValues.some(v => typeof v === 'number' && value >= v)
  })

  // Date operators
  operators.set('before', (value, clauseValues) => {
    const dateValue = TypeCoercion.toDate(value)
    if (!dateValue) return false
    return clauseValues.some(v => {
      const threshold = TypeCoercion.toDate(v)
      return threshold && dateValue.getTime() < threshold.getTime()
    })
  })

  operators.set('after', (value, clauseValues) => {
    const dateValue = TypeCoercion.toDate(value)
    if (!dateValue) return false
    return clauseValues.some(v => {
      const threshold = TypeCoercion.toDate(v)
      return threshold && dateValue.getTime() > threshold.getTime()
    })
  })

  // Semantic version operators
  operators.set('semVerEqual', (value, clauseValues) => {
    if (typeof value !== 'string') return false
    return clauseValues.some(v => {
      if (typeof v !== 'string') return false
      return compareSemVer(value, v) === 0
    })
  })

  operators.set('semVerLessThan', (value, clauseValues) => {
    if (typeof value !== 'string') return false
    return clauseValues.some(v => {
      if (typeof v !== 'string') return false
      return compareSemVer(value, v) === -1
    })
  })

  operators.set('semVerGreaterThan', (value, clauseValues) => {
    if (typeof value !== 'string') return false
    return clauseValues.some(v => {
      if (typeof v !== 'string') return false
      return compareSemVer(value, v) === 1
    })
  })

  // Segment operator
  operators.set('segmentMatch', (value, clauseValues, context) => {
    // Look for segments in context
    const segmentsValue = context.segments ?? value
    if (Array.isArray(segmentsValue)) {
      return segmentsValue.some(segment => clauseValues.includes(segment))
    }
    if (segmentsValue !== undefined) {
      return clauseValues.some(v => v === segmentsValue)
    }
    return false
  })

  return operators
}

// ============================================================================
// OPERATOR REGISTRY
// ============================================================================

/**
 * Registry for managing targeting operators
 *
 * @example Basic usage
 * ```ts
 * const registry = new OperatorRegistry()
 *
 * // Register a custom operator
 * registry.register({
 *   name: 'divisibleBy',
 *   description: 'Matches when value is divisible by the clause value',
 *   evaluate: (value, clauseValues) => {
 *     if (typeof value !== 'number') return false
 *     return clauseValues.some(v => typeof v === 'number' && value % v === 0)
 *   },
 *   category: 'numeric',
 *   examples: [
 *     { value: 10, clauseValues: [5], expected: true },
 *     { value: 10, clauseValues: [3], expected: false },
 *   ],
 * })
 *
 * // Evaluate a clause
 * const matches = registry.evaluate(clause, context)
 * ```
 */
export class OperatorRegistry {
  private operators: Map<string, OperatorFunction>
  private customOperators: Map<string, CustomOperatorDefinition> = new Map()
  private regexCache: RegexCache
  private strictMode: boolean

  constructor(options: OperatorRegistryOptions = {}) {
    this.regexCache = new RegexCache(options.regexCacheSize ?? 1000)
    this.strictMode = options.strictMode ?? false
    this.operators = createBuiltInOperators(this.regexCache)
  }

  /**
   * Register a custom operator
   *
   * @throws Error if operator name is already registered (in strict mode)
   */
  register(definition: CustomOperatorDefinition): void {
    if (this.strictMode && this.operators.has(definition.name)) {
      throw new Error(`Operator '${definition.name}' is already registered`)
    }

    this.operators.set(definition.name, definition.evaluate)
    this.customOperators.set(definition.name, definition)
  }

  /**
   * Unregister a custom operator
   *
   * @returns true if the operator was removed, false if it didn't exist
   */
  unregister(name: string): boolean {
    // Don't allow unregistering built-in operators in strict mode
    if (this.strictMode && !this.customOperators.has(name)) {
      throw new Error(`Cannot unregister built-in operator '${name}'`)
    }

    this.customOperators.delete(name)
    return this.operators.delete(name)
  }

  /**
   * Check if an operator is registered
   */
  has(name: string): boolean {
    return this.operators.has(name)
  }

  /**
   * Get the operator function for a given name
   */
  get(name: string): OperatorFunction | undefined {
    return this.operators.get(name)
  }

  /**
   * Get a custom operator definition
   */
  getDefinition(name: string): CustomOperatorDefinition | undefined {
    return this.customOperators.get(name)
  }

  /**
   * Evaluate a targeting clause against a context
   */
  evaluate(clause: TargetingClause, context: EvaluationContext): boolean {
    const operatorFn = this.operators.get(clause.operator)

    if (!operatorFn) {
      if (this.strictMode) {
        throw new Error(`Unknown operator: ${clause.operator}`)
      }
      return false
    }

    const value = context[clause.attribute]

    // Handle missing attribute
    // For notIn and segmentMatch, we allow evaluation even when attribute is missing
    if (!(clause.attribute in context)) {
      const allowMissing = clause.operator === 'notIn' || clause.operator === 'segmentMatch'
      if (!clause.negate && !allowMissing) {
        return false
      }
    }

    const matches = operatorFn(value, clause.values, context)
    return clause.negate ? !matches : matches
  }

  /**
   * Get all registered operator names
   */
  getOperatorNames(): string[] {
    return Array.from(this.operators.keys())
  }

  /**
   * Get all custom operator definitions
   */
  getCustomOperators(): CustomOperatorDefinition[] {
    return Array.from(this.customOperators.values())
  }

  /**
   * Get operators grouped by category
   */
  getOperatorsByCategory(): Record<string, string[]> {
    const categories: Record<string, string[]> = {
      membership: ['in', 'notIn'],
      string: ['startsWith', 'endsWith', 'contains', 'matches'],
      numeric: ['lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual'],
      date: ['before', 'after'],
      semver: ['semVerEqual', 'semVerLessThan', 'semVerGreaterThan'],
      segment: ['segmentMatch'],
      custom: [],
    }

    // Add custom operators to their categories
    for (const [name, def] of this.customOperators) {
      const category = def.category || 'custom'
      if (!categories[category]) {
        categories[category] = []
      }
      if (!categories[category].includes(name)) {
        categories[category].push(name)
      }
    }

    return categories
  }

  /**
   * Clear the regex cache
   */
  clearRegexCache(): void {
    this.regexCache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { regexCache: { size: number; maxSize: number } } {
    return {
      regexCache: this.regexCache.stats(),
    }
  }
}

// ============================================================================
// GLOBAL REGISTRY
// ============================================================================

let globalRegistry: OperatorRegistry | null = null

/**
 * Get the global operator registry
 */
export function getOperatorRegistry(): OperatorRegistry {
  if (!globalRegistry) {
    globalRegistry = new OperatorRegistry()
  }
  return globalRegistry
}

/**
 * Set a custom global operator registry
 */
export function setOperatorRegistry(registry: OperatorRegistry): void {
  globalRegistry = registry
}

/**
 * Register a custom operator on the global registry
 *
 * @example
 * ```ts
 * registerOperator({
 *   name: 'isWeekend',
 *   description: 'Matches if the date falls on a weekend',
 *   evaluate: (value) => {
 *     const date = TypeCoercion.toDate(value)
 *     if (!date) return false
 *     const day = date.getDay()
 *     return day === 0 || day === 6
 *   },
 *   category: 'date',
 * })
 * ```
 */
export function registerOperator(definition: CustomOperatorDefinition): void {
  getOperatorRegistry().register(definition)
}

/**
 * Unregister a custom operator from the global registry
 */
export function unregisterOperator(name: string): boolean {
  return getOperatorRegistry().unregister(name)
}

// ============================================================================
// OPERATOR DOCUMENTATION
// ============================================================================

/**
 * Operator documentation entry
 */
export interface OperatorDocumentation {
  name: string
  description: string
  category: string
  examples: Array<{
    clause: Partial<TargetingClause>
    context: EvaluationContext
    expected: boolean
    description?: string
  }>
}

/**
 * Get documentation for all operators
 */
export function getOperatorDocumentation(): OperatorDocumentation[] {
  const docs: OperatorDocumentation[] = [
    // Membership operators
    {
      name: 'in',
      description: 'Matches when the context value is included in the clause values list',
      category: 'membership',
      examples: [
        {
          clause: { attribute: 'country', operator: 'in', values: ['US', 'CA', 'UK'] },
          context: { country: 'US' },
          expected: true,
          description: 'Country is in the allowed list',
        },
        {
          clause: { attribute: 'tier', operator: 'in', values: [1, 2, 3] },
          context: { tier: 4 },
          expected: false,
          description: 'Tier is not in the list',
        },
        {
          clause: { attribute: 'tags', operator: 'in', values: ['premium'] },
          context: { tags: ['premium', 'beta'] },
          expected: true,
          description: 'Array context - at least one element matches',
        },
      ],
    },
    {
      name: 'notIn',
      description: 'Matches when the context value is NOT in the clause values list',
      category: 'membership',
      examples: [
        {
          clause: { attribute: 'country', operator: 'notIn', values: ['CN', 'RU'] },
          context: { country: 'US' },
          expected: true,
          description: 'Country is not in blocked list',
        },
        {
          clause: { attribute: 'country', operator: 'notIn', values: ['US'] },
          context: {},
          expected: true,
          description: 'Missing attribute matches (undefined is not in list)',
        },
      ],
    },

    // String operators
    {
      name: 'startsWith',
      description: 'Matches when the string value starts with any of the clause values',
      category: 'string',
      examples: [
        {
          clause: { attribute: 'email', operator: 'startsWith', values: ['admin@'] },
          context: { email: 'admin@example.com' },
          expected: true,
          description: 'Email starts with admin@',
        },
      ],
    },
    {
      name: 'endsWith',
      description: 'Matches when the string value ends with any of the clause values',
      category: 'string',
      examples: [
        {
          clause: { attribute: 'email', operator: 'endsWith', values: ['@company.com'] },
          context: { email: 'user@company.com' },
          expected: true,
          description: 'Email domain check',
        },
      ],
    },
    {
      name: 'contains',
      description: 'Matches when the string value contains any of the clause values',
      category: 'string',
      examples: [
        {
          clause: { attribute: 'name', operator: 'contains', values: ['Admin'] },
          context: { name: 'Admin User' },
          expected: true,
          description: 'Name contains Admin',
        },
      ],
    },
    {
      name: 'matches',
      description: 'Matches when the string value matches any regex pattern in clause values',
      category: 'string',
      examples: [
        {
          clause: { attribute: 'email', operator: 'matches', values: ['^[a-z]+@example\\.com$'] },
          context: { email: 'user@example.com' },
          expected: true,
          description: 'Email matches regex pattern',
        },
      ],
    },

    // Numeric operators
    {
      name: 'lessThan',
      description: 'Matches when the numeric value is less than the clause value',
      category: 'numeric',
      examples: [
        {
          clause: { attribute: 'age', operator: 'lessThan', values: [18] },
          context: { age: 17 },
          expected: true,
          description: 'Age is less than 18',
        },
      ],
    },
    {
      name: 'lessThanOrEqual',
      description: 'Matches when the numeric value is less than or equal to the clause value',
      category: 'numeric',
      examples: [
        {
          clause: { attribute: 'age', operator: 'lessThanOrEqual', values: [18] },
          context: { age: 18 },
          expected: true,
          description: 'Age is 18 or younger',
        },
      ],
    },
    {
      name: 'greaterThan',
      description: 'Matches when the numeric value is greater than the clause value',
      category: 'numeric',
      examples: [
        {
          clause: { attribute: 'score', operator: 'greaterThan', values: [100] },
          context: { score: 150 },
          expected: true,
          description: 'Score exceeds threshold',
        },
      ],
    },
    {
      name: 'greaterThanOrEqual',
      description: 'Matches when the numeric value is greater than or equal to the clause value',
      category: 'numeric',
      examples: [
        {
          clause: { attribute: 'level', operator: 'greaterThanOrEqual', values: [5] },
          context: { level: 5 },
          expected: true,
          description: 'Level is at least 5',
        },
      ],
    },

    // Date operators
    {
      name: 'before',
      description: 'Matches when the date value is before the clause value',
      category: 'date',
      examples: [
        {
          clause: { attribute: 'createdAt', operator: 'before', values: ['2024-01-01T00:00:00Z'] },
          context: { createdAt: '2023-12-31T23:59:59Z' },
          expected: true,
          description: 'Account created before 2024',
        },
      ],
    },
    {
      name: 'after',
      description: 'Matches when the date value is after the clause value',
      category: 'date',
      examples: [
        {
          clause: { attribute: 'lastLogin', operator: 'after', values: ['2024-01-01T00:00:00Z'] },
          context: { lastLogin: '2024-06-15T12:00:00Z' },
          expected: true,
          description: 'User logged in after 2024 started',
        },
      ],
    },

    // SemVer operators
    {
      name: 'semVerEqual',
      description: 'Matches when the semantic version equals the clause value',
      category: 'semver',
      examples: [
        {
          clause: { attribute: 'appVersion', operator: 'semVerEqual', values: ['2.0.0'] },
          context: { appVersion: '2.0.0' },
          expected: true,
          description: 'Exact version match',
        },
        {
          clause: { attribute: 'appVersion', operator: 'semVerEqual', values: ['2.0.0'] },
          context: { appVersion: 'v2.0.0' },
          expected: true,
          description: 'V-prefix is handled',
        },
      ],
    },
    {
      name: 'semVerLessThan',
      description: 'Matches when the semantic version is older than the clause value',
      category: 'semver',
      examples: [
        {
          clause: { attribute: 'appVersion', operator: 'semVerLessThan', values: ['2.0.0'] },
          context: { appVersion: '1.9.9' },
          expected: true,
          description: 'Older version',
        },
        {
          clause: { attribute: 'appVersion', operator: 'semVerLessThan', values: ['2.0.0'] },
          context: { appVersion: '2.0.0-beta' },
          expected: true,
          description: 'Prerelease is less than release',
        },
      ],
    },
    {
      name: 'semVerGreaterThan',
      description: 'Matches when the semantic version is newer than the clause value',
      category: 'semver',
      examples: [
        {
          clause: { attribute: 'appVersion', operator: 'semVerGreaterThan', values: ['2.0.0'] },
          context: { appVersion: '2.0.1' },
          expected: true,
          description: 'Newer version',
        },
      ],
    },

    // Segment operator
    {
      name: 'segmentMatch',
      description: 'Matches when the user belongs to any of the specified segments',
      category: 'segment',
      examples: [
        {
          clause: { attribute: 'segments', operator: 'segmentMatch', values: ['beta-users', 'premium'] },
          context: { targetingKey: 'user-123', segments: ['beta-users', 'early-adopters'] },
          expected: true,
          description: 'User is in beta-users segment',
        },
      ],
    },
  ]

  // Add custom operator documentation
  const registry = getOperatorRegistry()
  for (const customOp of registry.getCustomOperators()) {
    const docEntry: OperatorDocumentation = {
      name: customOp.name,
      description: customOp.description || 'Custom operator',
      category: customOp.category || 'custom',
      examples: (customOp.examples || []).map(ex => ({
        clause: { attribute: 'value', operator: customOp.name as TargetingOperator, values: ex.clauseValues },
        context: { value: ex.value },
        expected: ex.expected,
        description: ex.description,
      })),
    }
    docs.push(docEntry)
  }

  return docs
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  compareSemVer,
  parseSemVer,
  type ParsedSemVer,
}

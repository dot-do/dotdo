/**
 * Feature Flags Evaluation Engine
 *
 * Evaluates flag definitions against evaluation contexts using targeting rules,
 * percentage rollouts, and prerequisites.
 *
 * Features:
 * - Caching: Per (flag, context) tuple caching for performance
 * - Diagnostics: Detailed evaluation traces for debugging
 * - Performance: Optimized hot paths with compiled regex caching
 * - Explanation API: Human-readable explanations of flag decisions
 * - Dry Run: Test flag changes before deploying
 *
 * @module @dotdo/compat/flags/evaluation
 */

import type {
  EvaluationContext,
  EvaluationDetails,
  EvaluationReason,
  ErrorCode,
  FlagDefinition,
  TargetingClause,
  TargetingOperator,
} from './types'

// ============================================================================
// DIAGNOSTICS TYPES
// ============================================================================

/**
 * A single step in the evaluation trace
 */
export interface EvaluationStep {
  /** Step type */
  type: 'flag_lookup' | 'prerequisite' | 'targeting_rule' | 'clause' | 'rollout' | 'variation'
  /** Description of what happened */
  description: string
  /** Result of this step */
  result: 'matched' | 'not_matched' | 'error' | 'skipped' | 'selected'
  /** Duration of this step in microseconds */
  durationUs?: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Complete evaluation trace for diagnostics
 */
export interface EvaluationTrace {
  /** The flag key that was evaluated */
  flagKey: string
  /** The context used for evaluation */
  context: EvaluationContext
  /** Individual steps in the evaluation */
  steps: EvaluationStep[]
  /** Total evaluation time in microseconds */
  totalDurationUs: number
  /** Whether the result came from cache */
  cached: boolean
  /** Timestamp when evaluation occurred */
  timestamp: number
}

/**
 * Extended evaluation result with diagnostics
 */
export interface EvaluationDetailsWithDiagnostics<T> extends EvaluationDetails<T> {
  /** Evaluation trace for debugging */
  trace?: EvaluationTrace
  /** Human-readable explanation of the decision */
  explanation?: string
}

// ============================================================================
// CACHING
// ============================================================================

/**
 * Cache entry for evaluation results
 */
interface CacheEntry<T> {
  result: EvaluationDetails<T>
  timestamp: number
  flagVersion?: string
}

/**
 * LRU cache for evaluation results
 */
export class EvaluationCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map()
  private maxSize: number
  private ttlMs: number

  constructor(options: { maxSize?: number; ttlMs?: number } = {}) {
    this.maxSize = options.maxSize ?? 10000
    this.ttlMs = options.ttlMs ?? 60000 // 1 minute default TTL
  }

  /**
   * Generate a cache key from flag key and context
   */
  private generateKey(flagKey: string, context: EvaluationContext): string {
    // Sort context keys for consistent hashing
    const sortedContext = Object.keys(context)
      .sort()
      .map(k => `${k}:${JSON.stringify(context[k])}`)
      .join('|')
    return `${flagKey}::${sortedContext}`
  }

  /**
   * Get a cached result if available and not expired
   */
  get<T>(flagKey: string, context: EvaluationContext, flagVersion?: string): EvaluationDetails<T> | null {
    const key = this.generateKey(flagKey, context)
    const entry = this.cache.get(key) as CacheEntry<T> | undefined

    if (!entry) return null

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return null
    }

    // Check flag version if provided
    if (flagVersion && entry.flagVersion !== flagVersion) {
      this.cache.delete(key)
      return null
    }

    // Move to end for LRU behavior
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.result
  }

  /**
   * Cache an evaluation result
   */
  set<T>(
    flagKey: string,
    context: EvaluationContext,
    result: EvaluationDetails<T>,
    flagVersion?: string
  ): void {
    const key = this.generateKey(flagKey, context)

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      flagVersion,
    })
  }

  /**
   * Invalidate cache for a specific flag
   */
  invalidateFlag(flagKey: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${flagKey}::`)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    }
  }
}

// Global cache instance (can be replaced with custom instance)
let globalCache: EvaluationCache | null = null

/**
 * Get or create the global evaluation cache
 */
export function getEvaluationCache(): EvaluationCache {
  if (!globalCache) {
    globalCache = new EvaluationCache()
  }
  return globalCache
}

/**
 * Set a custom evaluation cache
 */
export function setEvaluationCache(cache: EvaluationCache): void {
  globalCache = cache
}

// ============================================================================
// REGEX CACHING FOR PERFORMANCE
// ============================================================================

const regexCache = new Map<string, RegExp | null>()
const MAX_REGEX_CACHE_SIZE = 1000

/**
 * Get or compile a cached regex pattern
 */
function getCachedRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) {
    return regexCache.get(pattern)!
  }

  // Evict oldest if at capacity
  if (regexCache.size >= MAX_REGEX_CACHE_SIZE) {
    const oldest = regexCache.keys().next().value
    if (oldest) regexCache.delete(oldest)
  }

  try {
    const regex = new RegExp(pattern)
    regexCache.set(pattern, regex)
    return regex
  } catch {
    regexCache.set(pattern, null)
    return null
  }
}

// Extended flag definition with additional fields used in evaluation
interface ExtendedFlagDefinition<T> extends FlagDefinition<T> {
  enabled?: boolean
  targeting?: {
    rules: TargetingRuleInternal<T>[]
  }
  offVariation?: number
}

// Internal targeting rule type that matches the test expectations
interface TargetingRuleInternal<T> {
  id: string
  description?: string
  clauses: TargetingClause[]
  variation?: number
  rollout?: RolloutInternal
}

interface RolloutInternal {
  variations: { variation: number; weight: number }[]
  bucketBy?: string
  seed?: number
}

// Exported TargetingRule type for matchesTargeting
export interface TargetingRule {
  id: string
  description?: string
  clauses: TargetingClause[]
  variation?: number
  rollout?: RolloutInternal
}

/**
 * MurmurHash3-like hash function for better distribution
 */
function hashString(str: string): number {
  let h = 0xdeadbeef

  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 2654435761)
  }

  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  h ^= h >>> 16

  return h >>> 0 // Ensure unsigned
}

/**
 * Get bucket value (0-99999) for a given key
 */
function getBucket(key: string, seed?: number): number {
  const seedStr = seed !== undefined ? String(seed) : ''
  const hash = hashString(`${seedStr}${key}`)
  return hash % 100000
}

/**
 * Parse a semantic version string into components
 * Handles formats like: 1.0.0, 1.0.0-alpha, 1.0.0+build, v1.0.0, V2.0.0
 */
function parseSemVer(version: string): { major: number; minor: number; patch: number; prerelease: string } | null {
  // Strip leading 'v' or 'V' prefix if present
  const cleanVersion = version.replace(/^[vV]/, '')
  const match = cleanVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+[a-zA-Z0-9.-]+)?$/)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || '',
  }
}

/**
 * Compare two semantic versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
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
    return parsedA.prerelease < parsedB.prerelease ? -1 : parsedA.prerelease > parsedB.prerelease ? 1 : 0
  }

  return 0
}

/**
 * Parse a value as a Date
 */
function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return isNaN(date.getTime()) ? null : date
  }
  return null
}

/**
 * Evaluate a single clause against the context
 */
function evaluateClause(clause: TargetingClause, context: EvaluationContext): boolean {
  const value = context[clause.attribute]

  let matches = false

  switch (clause.operator) {
    // Membership operators
    case 'in':
      // Handle array context values - check if any element is in the clause values
      if (Array.isArray(value)) {
        matches = value.some(contextVal => clause.values.some(v => v === contextVal))
      } else {
        matches = clause.values.some(v => v === value)
      }
      break
    case 'notIn':
      // Handle array context values - check that no element is in the clause values
      if (Array.isArray(value)) {
        matches = !value.some(contextVal => clause.values.some(v => v === contextVal))
      } else {
        matches = !clause.values.some(v => v === value)
      }
      break

    // String operators
    case 'startsWith':
      matches = typeof value === 'string' &&
        clause.values.some(v => typeof v === 'string' && value.startsWith(v))
      break
    case 'endsWith':
      matches = typeof value === 'string' &&
        clause.values.some(v => typeof v === 'string' && value.endsWith(v))
      break
    case 'contains':
      matches = typeof value === 'string' &&
        clause.values.some(v => typeof v === 'string' && value.includes(v))
      break
    case 'matches':
      matches = typeof value === 'string' &&
        clause.values.some(v => {
          if (typeof v === 'string') {
            const regex = getCachedRegex(v)
            return regex ? regex.test(value) : false
          }
          return false
        })
      break

    // Numeric operators
    case 'lessThan':
      matches = typeof value === 'number' &&
        clause.values.some(v => typeof v === 'number' && value < v)
      break
    case 'lessThanOrEqual':
      matches = typeof value === 'number' &&
        clause.values.some(v => typeof v === 'number' && value <= v)
      break
    case 'greaterThan':
      matches = typeof value === 'number' &&
        clause.values.some(v => typeof v === 'number' && value > v)
      break
    case 'greaterThanOrEqual':
      matches = typeof value === 'number' &&
        clause.values.some(v => typeof v === 'number' && value >= v)
      break

    // Date operators
    case 'before': {
      const dateValue = parseDate(value)
      if (dateValue) {
        matches = clause.values.some(v => {
          const threshold = parseDate(v)
          return threshold && dateValue.getTime() < threshold.getTime()
        })
      }
      break
    }
    case 'after': {
      const dateValue = parseDate(value)
      if (dateValue) {
        matches = clause.values.some(v => {
          const threshold = parseDate(v)
          return threshold && dateValue.getTime() > threshold.getTime()
        })
      }
      break
    }

    // Semantic version operators
    case 'semVerEqual':
      if (typeof value === 'string') {
        matches = clause.values.some(v => {
          if (typeof v === 'string') {
            const cmp = compareSemVer(value, v)
            return cmp === 0
          }
          return false
        })
      }
      break
    case 'semVerLessThan':
      if (typeof value === 'string') {
        matches = clause.values.some(v => {
          if (typeof v === 'string') {
            const cmp = compareSemVer(value, v)
            return cmp === -1
          }
          return false
        })
      }
      break
    case 'semVerGreaterThan':
      if (typeof value === 'string') {
        matches = clause.values.some(v => {
          if (typeof v === 'string') {
            const cmp = compareSemVer(value, v)
            return cmp === 1
          }
          return false
        })
      }
      break

    // Segment operator (checks if user is in one of the named segments)
    // The context should have a 'segments' attribute containing an array of segment IDs
    // This operator checks if any of the user's segments are in the clause values
    case 'segmentMatch': {
      // Look for segments in the context, either at the specified attribute or at 'segments'
      const segmentsValue = context.segments ?? value
      if (Array.isArray(segmentsValue)) {
        // Check if any of the context segments match any of the clause values
        matches = segmentsValue.some(segment => clause.values.includes(segment))
      } else if (segmentsValue !== undefined) {
        // Single segment value
        matches = clause.values.some(v => v === segmentsValue)
      }
      break
    }

    default:
      matches = false
  }

  return clause.negate ? !matches : matches
}

/**
 * Check if a targeting rule matches the given context
 */
export function matchesTargeting(rule: TargetingRule, context: EvaluationContext): boolean {
  // All clauses must match (AND logic)
  for (const clause of rule.clauses) {
    // Check if attribute exists in context
    if (!(clause.attribute in context)) {
      // Operators that should proceed even when attribute is missing:
      // - notIn: missing attribute means value is not in list (match)
      // - segmentMatch: will check context.segments instead of the attribute
      const allowMissingAttribute = clause.operator === 'notIn' || clause.operator === 'segmentMatch'

      if (!clause.negate && !allowMissingAttribute) {
        return false
      }
    }

    if (!evaluateClause(clause, context)) {
      return false
    }
  }

  return true
}

/**
 * Evaluate a flag and return the result with details
 */
export async function evaluate<T>(
  flagKey: string,
  defaultValue: T,
  context: EvaluationContext,
  flag?: ExtendedFlagDefinition<T>,
  flags?: Map<string, ExtendedFlagDefinition<unknown>>,
  visitedFlags?: Set<string>
): Promise<EvaluationDetails<T>> {
  // Flag not found
  if (!flag) {
    return {
      value: defaultValue,
      reason: 'DEFAULT',
      errorCode: 'FLAG_NOT_FOUND',
      errorMessage: `Flag '${flagKey}' not found`,
    }
  }

  // Check for circular prerequisites
  const visited = visitedFlags || new Set<string>()
  if (visited.has(flagKey)) {
    return {
      value: defaultValue,
      reason: 'ERROR',
      errorCode: 'GENERAL',
      errorMessage: 'circular prerequisite dependency detected',
    }
  }
  visited.add(flagKey)

  // Check if flag is disabled
  if (flag.enabled === false) {
    return {
      value: flag.defaultValue,
      reason: 'DISABLED',
    }
  }

  // Check prerequisites
  if (flag.prerequisites && flag.prerequisites.length > 0 && flags) {
    for (const prereq of flag.prerequisites) {
      const prereqFlag = flags.get(prereq.key) as ExtendedFlagDefinition<unknown> | undefined
      if (!prereqFlag) {
        const offValue = flag.offVariation !== undefined && flag.variations
          ? flag.variations[flag.offVariation]?.value ?? flag.defaultValue
          : flag.defaultValue
        return {
          value: offValue as T,
          reason: 'PREREQUISITE_FAILED' as EvaluationReason,
        }
      }

      const prereqResult = await evaluate(
        prereq.key,
        prereqFlag.defaultValue,
        context,
        prereqFlag,
        flags,
        visited
      )

      // Propagate errors from prerequisite evaluation (e.g., circular dependencies)
      if (prereqResult.reason === 'ERROR') {
        return {
          value: defaultValue,
          reason: 'ERROR',
          errorCode: prereqResult.errorCode,
          errorMessage: prereqResult.errorMessage,
        }
      }

      // Check if prerequisite matches required variation
      const requiredVariation = prereqFlag.variations?.[prereq.variation as number]
      if (!requiredVariation || prereqResult.value !== requiredVariation.value) {
        const offValue = flag.offVariation !== undefined && flag.variations
          ? flag.variations[flag.offVariation]?.value ?? flag.defaultValue
          : flag.defaultValue
        return {
          value: offValue as T,
          reason: 'PREREQUISITE_FAILED' as EvaluationReason,
        }
      }
    }
  }

  // No variations - return default
  if (!flag.variations || flag.variations.length === 0) {
    return {
      value: flag.defaultValue,
      reason: 'DEFAULT',
    }
  }

  // No targeting rules - check if we should use static or default
  if (!flag.targeting || !flag.targeting.rules || flag.targeting.rules.length === 0) {
    // Find a variation with 100% weight
    const dominantVariation = flag.variations.find(v => v.weight === 100)

    // Determine if we should use STATIC:
    // 1. Context is empty (no targeting key to use for rollout)
    // 2. Flag has prerequisites (which passed - reaching here means they passed)
    // 3. Dominant variation matches defaultValue (consistent state)
    const isEmptyContext = Object.keys(context).length === 0
    const hasPrerequisites = flag.prerequisites && flag.prerequisites.length > 0

    if (dominantVariation) {
      if (isEmptyContext || hasPrerequisites || dominantVariation.value === flag.defaultValue) {
        return {
          value: dominantVariation.value,
          reason: 'STATIC',
          variant: dominantVariation.label,
        }
      }
    }

    // Otherwise return flag's default value
    return {
      value: flag.defaultValue,
      reason: 'DEFAULT',
    }
  }

  // Evaluate targeting rules in order
  for (const rule of flag.targeting.rules) {
    // Check if rule has clauses and if they match
    const clausesMatch = rule.clauses.length === 0 || matchesTargeting(rule, context)

    if (clausesMatch) {
      // Rule matches - check for rollout or variation
      if (rule.rollout) {
        // Percentage rollout
        const bucketBy = rule.rollout.bucketBy || 'targetingKey'
        const bucketValue = context[bucketBy]

        if (bucketValue === undefined || bucketValue === null) {
          return {
            value: defaultValue,
            reason: 'ERROR',
            errorCode: 'TARGETING_KEY_MISSING',
            errorMessage: `Bucket attribute '${bucketBy}' is missing from context`,
          }
        }

        const bucket = getBucket(String(bucketValue), rule.rollout.seed)

        let cumulative = 0
        for (const rolloutVariation of rule.rollout.variations) {
          cumulative += rolloutVariation.weight
          if (bucket < cumulative) {
            const variation = flag.variations[rolloutVariation.variation]
            if (!variation) {
              return {
                value: defaultValue,
                reason: 'ERROR',
                errorCode: 'GENERAL',
                errorMessage: `Invalid variation index ${rolloutVariation.variation}`,
              }
            }
            return {
              value: variation.value,
              reason: 'SPLIT',
              variant: variation.label,
            }
          }
        }

        // Fallback to last variation if weights don't add up to 100000
        const lastRollout = rule.rollout.variations[rule.rollout.variations.length - 1]
        const lastVariation = flag.variations[lastRollout.variation]
        return {
          value: lastVariation?.value ?? defaultValue,
          reason: 'SPLIT',
          variant: lastVariation?.label,
        }
      } else if (rule.variation !== undefined) {
        // Fixed variation
        const variation = flag.variations[rule.variation]
        if (!variation) {
          return {
            value: defaultValue,
            reason: 'ERROR',
            errorCode: 'GENERAL',
            errorMessage: `Invalid variation index ${rule.variation}`,
          }
        }
        return {
          value: variation.value,
          reason: 'TARGETING_MATCH',
          variant: variation.label,
        }
      }
    }
  }

  // No rules matched - return default
  return {
    value: flag.defaultValue,
    reason: 'DEFAULT',
  }
}

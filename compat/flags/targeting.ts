/**
 * @dotdo/flags - User Targeting Rules
 *
 * Implements LaunchDarkly-compatible targeting rule operators:
 * - in: Value is in list
 * - contains: String contains substring
 * - startsWith: String starts with prefix
 * - endsWith: String ends with suffix
 * - matches: String matches regex
 * - lessThan/greaterThan: Numeric comparisons
 * - semVer*: Semantic version comparisons
 * - before/after: Date comparisons
 * - segmentMatch: Segment membership
 */

import {
  type LDFlagValue,
  type LDContext,
  type Clause,
  type ClauseOperator,
} from './types'
import { getContextAttribute } from './evaluation'

// =============================================================================
// SemVer Parsing
// =============================================================================

interface SemVer {
  major: number
  minor: number
  patch: number
  prerelease: string[]
  build: string[]
}

/**
 * Parse a semantic version string
 */
function parseSemVer(version: string): SemVer | null {
  // Remove leading 'v' if present
  const v = version.startsWith('v') ? version.slice(1) : version

  // Basic semver regex
  const match = v.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
  )

  if (!match) {
    // Try simpler version formats
    const simpleMatch = v.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
    if (!simpleMatch) return null

    return {
      major: parseInt(simpleMatch[1]!, 10),
      minor: simpleMatch[2] ? parseInt(simpleMatch[2], 10) : 0,
      patch: simpleMatch[3] ? parseInt(simpleMatch[3], 10) : 0,
      prerelease: [],
      build: [],
    }
  }

  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  }
}

/**
 * Compare two semantic versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareSemVer(a: SemVer, b: SemVer): number {
  // Compare major.minor.patch
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1

  // Compare prerelease
  // A version without prerelease is greater than one with
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1

  const maxLen = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < maxLen; i++) {
    const ai = a.prerelease[i]
    const bi = b.prerelease[i]

    if (ai === undefined) return -1
    if (bi === undefined) return 1

    // Numeric identifiers have lower precedence than alphanumeric
    const aiNum = parseInt(ai, 10)
    const biNum = parseInt(bi, 10)
    const aiIsNum = !isNaN(aiNum) && String(aiNum) === ai
    const biIsNum = !isNaN(biNum) && String(biNum) === bi

    if (aiIsNum && biIsNum) {
      if (aiNum !== biNum) return aiNum < biNum ? -1 : 1
    } else if (aiIsNum) {
      return -1
    } else if (biIsNum) {
      return 1
    } else {
      if (ai < bi) return -1
      if (ai > bi) return 1
    }
  }

  return 0
}

// =============================================================================
// Operator Implementations
// =============================================================================

/**
 * Check if value is in the list of values
 */
function opIn(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  return clauseValues.some((cv) => {
    if (typeof userValue === typeof cv) {
      return userValue === cv
    }
    // Handle string/number coercion
    return String(userValue) === String(cv)
  })
}

/**
 * Check if string contains substring
 */
function opContains(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'string') return false
  return clauseValues.some((cv) => {
    if (typeof cv !== 'string') return false
    return userValue.includes(cv)
  })
}

/**
 * Check if string starts with prefix
 */
function opStartsWith(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'string') return false
  return clauseValues.some((cv) => {
    if (typeof cv !== 'string') return false
    return userValue.startsWith(cv)
  })
}

/**
 * Check if string ends with suffix
 */
function opEndsWith(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'string') return false
  return clauseValues.some((cv) => {
    if (typeof cv !== 'string') return false
    return userValue.endsWith(cv)
  })
}

/**
 * Check if string matches regex pattern
 */
function opMatches(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'string') return false
  return clauseValues.some((cv) => {
    if (typeof cv !== 'string') return false
    try {
      const regex = new RegExp(cv)
      return regex.test(userValue)
    } catch {
      return false
    }
  })
}

/**
 * Numeric less than comparison
 */
function opLessThan(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'number') return false
  return clauseValues.some((cv) => {
    if (typeof cv !== 'number') return false
    return userValue < cv
  })
}

/**
 * Numeric less than or equal comparison
 */
function opLessThanOrEqual(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'number') return false
  return clauseValues.some((cv) => {
    if (typeof cv !== 'number') return false
    return userValue <= cv
  })
}

/**
 * Numeric greater than comparison
 */
function opGreaterThan(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'number') return false
  return clauseValues.some((cv) => {
    if (typeof cv !== 'number') return false
    return userValue > cv
  })
}

/**
 * Numeric greater than or equal comparison
 */
function opGreaterThanOrEqual(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'number') return false
  return clauseValues.some((cv) => {
    if (typeof cv !== 'number') return false
    return userValue >= cv
  })
}

/**
 * Semantic version equal comparison
 */
function opSemVerEqual(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'string') return false
  const userSemVer = parseSemVer(userValue)
  if (!userSemVer) return false

  return clauseValues.some((cv) => {
    if (typeof cv !== 'string') return false
    const clauseSemVer = parseSemVer(cv)
    if (!clauseSemVer) return false
    return compareSemVer(userSemVer, clauseSemVer) === 0
  })
}

/**
 * Semantic version less than comparison
 */
function opSemVerLessThan(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'string') return false
  const userSemVer = parseSemVer(userValue)
  if (!userSemVer) return false

  return clauseValues.some((cv) => {
    if (typeof cv !== 'string') return false
    const clauseSemVer = parseSemVer(cv)
    if (!clauseSemVer) return false
    return compareSemVer(userSemVer, clauseSemVer) < 0
  })
}

/**
 * Semantic version greater than comparison
 */
function opSemVerGreaterThan(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  if (typeof userValue !== 'string') return false
  const userSemVer = parseSemVer(userValue)
  if (!userSemVer) return false

  return clauseValues.some((cv) => {
    if (typeof cv !== 'string') return false
    const clauseSemVer = parseSemVer(cv)
    if (!clauseSemVer) return false
    return compareSemVer(userSemVer, clauseSemVer) > 0
  })
}

/**
 * Date before comparison
 */
function opBefore(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  const userDate = toDate(userValue)
  if (!userDate) return false

  return clauseValues.some((cv) => {
    const clauseDate = toDate(cv)
    if (!clauseDate) return false
    return userDate.getTime() < clauseDate.getTime()
  })
}

/**
 * Date after comparison
 */
function opAfter(userValue: LDFlagValue, clauseValues: LDFlagValue[]): boolean {
  const userDate = toDate(userValue)
  if (!userDate) return false

  return clauseValues.some((cv) => {
    const clauseDate = toDate(cv)
    if (!clauseDate) return false
    return userDate.getTime() > clauseDate.getTime()
  })
}

/**
 * Convert value to Date
 */
function toDate(value: LDFlagValue): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!isNaN(date.getTime())) return date
  }
  return null
}

/**
 * Segment match (placeholder - requires segment store)
 */
function opSegmentMatch(
  _userValue: LDFlagValue,
  _clauseValues: LDFlagValue[],
  _context: LDContext
): boolean {
  // Segment matching requires access to segment definitions
  // This is a placeholder for future implementation
  return false
}

// =============================================================================
// Clause Evaluation
// =============================================================================

/**
 * Map of operators to their implementation functions
 */
const OPERATORS: Record<
  ClauseOperator,
  (userValue: LDFlagValue, clauseValues: LDFlagValue[], context?: LDContext) => boolean
> = {
  in: opIn,
  contains: opContains,
  startsWith: opStartsWith,
  endsWith: opEndsWith,
  matches: opMatches,
  lessThan: opLessThan,
  lessThanOrEqual: opLessThanOrEqual,
  greaterThan: opGreaterThan,
  greaterThanOrEqual: opGreaterThanOrEqual,
  semVerEqual: opSemVerEqual,
  semVerLessThan: opSemVerLessThan,
  semVerGreaterThan: opSemVerGreaterThan,
  before: opBefore,
  after: opAfter,
  segmentMatch: opSegmentMatch,
}

/**
 * Evaluate a targeting clause against a context
 */
export function evaluateClause(clause: Clause, context: LDContext): boolean {
  const contextKind = clause.contextKind ?? 'user'
  const userValue = getContextAttribute(context, clause.attribute, contextKind)

  // If user doesn't have the attribute, clause doesn't match
  if (userValue === undefined || userValue === null) {
    return clause.negate ? true : false
  }

  const operator = OPERATORS[clause.op]
  if (!operator) {
    // Unknown operator - doesn't match
    return clause.negate ? true : false
  }

  const result = operator(userValue, clause.values, context)
  return clause.negate ? !result : result
}

// =============================================================================
// Rule Helpers
// =============================================================================

/**
 * Create a simple targeting rule
 */
export function createRule(
  attribute: string,
  op: ClauseOperator,
  values: LDFlagValue[],
  variation: number
): import('./types').FlagRule {
  return {
    clauses: [{ attribute, op, values }],
    variation,
  }
}

/**
 * Create a rule with multiple clauses (AND logic)
 */
export function createRuleWithClauses(
  clauses: Array<{ attribute: string; op: ClauseOperator; values: LDFlagValue[] }>,
  variation: number
): import('./types').FlagRule {
  return {
    clauses: clauses.map((c) => ({ ...c })),
    variation,
  }
}

/**
 * Create a percentage rollout rule
 */
export function createRolloutRule(
  attribute: string,
  op: ClauseOperator,
  values: LDFlagValue[],
  rollout: { variation: number; weight: number }[]
): import('./types').FlagRule {
  return {
    clauses: [{ attribute, op, values }],
    rollout: {
      variations: rollout.map((r) => ({ variation: r.variation, weight: r.weight })),
    },
  }
}

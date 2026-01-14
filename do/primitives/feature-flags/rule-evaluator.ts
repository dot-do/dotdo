/**
 * Feature Flag Rule Evaluator
 *
 * Evaluates targeting rules against user/context attributes for feature flag systems.
 * Supports attribute matching, numeric comparisons, list operations, regex matching,
 * segment membership, and boolean logic with short-circuit evaluation.
 *
 * @see dotdo-32ver
 */

// ============================================================================
// TYPES
// ============================================================================

/** Supported comparison operators */
export type Operator =
  // String operators
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'matches' // regex
  // Numeric operators
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  // List operators
  | 'in'
  | 'notIn'
  // Boolean logic operators
  | 'and'
  | 'or'
  | 'not'
  // Segment operator
  | 'inSegment'
  | 'notInSegment'
  // Existence operators
  | 'exists'
  | 'notExists'

/** A targeting rule */
export interface Rule {
  /** Attribute to evaluate (nested paths supported: "user.plan") */
  attribute: string
  /** Comparison operator */
  operator: Operator
  /** Value to compare against */
  value: unknown
  /** Child rules for AND/OR/NOT operators */
  children?: Rule[]
}

/** Context containing attributes to evaluate against */
export interface EvaluationContext {
  /** User attributes (id, email, plan, etc.) */
  user?: Record<string, unknown>
  /** Device attributes (os, browser, etc.) */
  device?: Record<string, unknown>
  /** Session attributes */
  session?: Record<string, unknown>
  /** Custom attributes */
  custom?: Record<string, unknown>
  /** All attributes flattened (for convenience) */
  [key: string]: unknown
}

/** Result of evaluating a single rule */
export interface EvaluationResult {
  /** The rule that was evaluated */
  rule: Rule
  /** Whether the rule matched */
  matched: boolean
  /** Reason for match/no-match (useful for debugging) */
  reason?: string
  /** Any error that occurred during evaluation */
  error?: Error
}

/** Segment definition for segment membership checks */
export interface Segment {
  id: string
  name: string
  rules: Rule[]
}

/** Options for the rule evaluator */
export interface RuleEvaluatorOptions {
  /** Segments available for segment membership checks */
  segments?: Map<string, Segment> | Record<string, Segment>
  /** Maximum depth for nested rule evaluation (default: 10) */
  maxDepth?: number
  /** Whether to throw on errors or return false (default: false) */
  throwOnError?: boolean
}

/** Rule evaluator interface */
export interface RuleEvaluator {
  /** Evaluate a single rule against the context */
  evaluate(rule: Rule, context: EvaluationContext): boolean
  /** Evaluate multiple rules and return detailed results */
  evaluateAll(rules: Rule[], context: EvaluationContext): EvaluationResult[]
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: EvaluationContext, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Convert value to number for numeric comparisons
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  return null
}

/**
 * Convert value to string for string comparisons
 */
function toString(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  return String(value)
}

/**
 * Check if two values are equal (with type coercion)
 */
function areEqual(a: unknown, b: unknown): boolean {
  // Strict equality first
  if (a === b) return true

  // Handle null/undefined
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b
  }

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }
  if (a instanceof Date) {
    const bNum = toNumber(b)
    return bNum !== null && a.getTime() === bNum
  }
  if (b instanceof Date) {
    const aNum = toNumber(a)
    return aNum !== null && b.getTime() === aNum
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((val, idx) => areEqual(val, b[idx]))
  }

  // Handle objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object)
    const bKeys = Object.keys(b as object)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) =>
      areEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  }

  // Coerce to string for comparison
  return String(a) === String(b)
}

/**
 * Create a rule evaluator instance
 */
export function createRuleEvaluator(options: RuleEvaluatorOptions = {}): RuleEvaluator {
  const segments = options.segments instanceof Map ? options.segments : new Map(Object.entries(options.segments ?? {}))

  const maxDepth = options.maxDepth ?? 10
  const throwOnError = options.throwOnError ?? false

  /**
   * Evaluate a rule at a given depth
   */
  function evaluateAtDepth(rule: Rule, context: EvaluationContext, depth: number): boolean {
    if (depth > maxDepth) {
      const error = new Error(`Maximum rule depth exceeded (${maxDepth})`)
      if (throwOnError) throw error
      return false
    }

    const { attribute, operator, value, children } = rule

    // Handle boolean logic operators first
    switch (operator) {
      case 'and': {
        if (!children || children.length === 0) return true
        // Short-circuit: return false as soon as any child fails
        for (const child of children) {
          if (!evaluateAtDepth(child, context, depth + 1)) {
            return false
          }
        }
        return true
      }

      case 'or': {
        if (!children || children.length === 0) return false
        // Short-circuit: return true as soon as any child succeeds
        for (const child of children) {
          if (evaluateAtDepth(child, context, depth + 1)) {
            return true
          }
        }
        return false
      }

      case 'not': {
        if (!children || children.length === 0) return true
        // NOT only applies to the first child
        return !evaluateAtDepth(children[0], context, depth + 1)
      }
    }

    // Get attribute value from context
    const attrValue = getNestedValue(context, attribute)

    // Handle existence operators
    switch (operator) {
      case 'exists':
        return attrValue !== undefined && attrValue !== null

      case 'notExists':
        return attrValue === undefined || attrValue === null
    }

    // Handle segment operators
    switch (operator) {
      case 'inSegment': {
        const segmentId = toString(value)
        const segment = segments.get(segmentId)
        if (!segment) {
          if (throwOnError) throw new Error(`Segment not found: ${segmentId}`)
          return false
        }
        // Evaluate all segment rules with AND logic
        return segment.rules.every((r) => evaluateAtDepth(r, context, depth + 1))
      }

      case 'notInSegment': {
        const segmentId = toString(value)
        const segment = segments.get(segmentId)
        if (!segment) {
          // If segment doesn't exist, user is not in it
          return true
        }
        // NOT in segment = not all rules match
        return !segment.rules.every((r) => evaluateAtDepth(r, context, depth + 1))
      }
    }

    // Handle comparison operators
    switch (operator) {
      case 'equals':
        return areEqual(attrValue, value)

      case 'notEquals':
        return !areEqual(attrValue, value)

      case 'contains': {
        const attrStr = toString(attrValue)
        const valStr = toString(value)
        return attrStr.includes(valStr)
      }

      case 'notContains': {
        const attrStr = toString(attrValue)
        const valStr = toString(value)
        return !attrStr.includes(valStr)
      }

      case 'startsWith': {
        const attrStr = toString(attrValue)
        const valStr = toString(value)
        return attrStr.startsWith(valStr)
      }

      case 'endsWith': {
        const attrStr = toString(attrValue)
        const valStr = toString(value)
        return attrStr.endsWith(valStr)
      }

      case 'matches': {
        try {
          const attrStr = toString(attrValue)
          const pattern = value instanceof RegExp ? value : new RegExp(toString(value))
          return pattern.test(attrStr)
        } catch (e) {
          if (throwOnError) throw e
          return false
        }
      }

      case 'gt': {
        const attrNum = toNumber(attrValue)
        const valNum = toNumber(value)
        if (attrNum === null || valNum === null) return false
        return attrNum > valNum
      }

      case 'gte': {
        const attrNum = toNumber(attrValue)
        const valNum = toNumber(value)
        if (attrNum === null || valNum === null) return false
        return attrNum >= valNum
      }

      case 'lt': {
        const attrNum = toNumber(attrValue)
        const valNum = toNumber(value)
        if (attrNum === null || valNum === null) return false
        return attrNum < valNum
      }

      case 'lte': {
        const attrNum = toNumber(attrValue)
        const valNum = toNumber(value)
        if (attrNum === null || valNum === null) return false
        return attrNum <= valNum
      }

      case 'between': {
        if (!Array.isArray(value) || value.length !== 2) {
          if (throwOnError) throw new Error('between operator requires [min, max] array')
          return false
        }
        const attrNum = toNumber(attrValue)
        const minNum = toNumber(value[0])
        const maxNum = toNumber(value[1])
        if (attrNum === null || minNum === null || maxNum === null) return false
        return attrNum >= minNum && attrNum <= maxNum
      }

      case 'in': {
        if (!Array.isArray(value)) {
          if (throwOnError) throw new Error('in operator requires an array value')
          return false
        }
        return value.some((v) => areEqual(attrValue, v))
      }

      case 'notIn': {
        if (!Array.isArray(value)) {
          if (throwOnError) throw new Error('notIn operator requires an array value')
          return false
        }
        return !value.some((v) => areEqual(attrValue, v))
      }

      default: {
        const error = new Error(`Unknown operator: ${operator}`)
        if (throwOnError) throw error
        return false
      }
    }
  }

  return {
    evaluate(rule: Rule, context: EvaluationContext): boolean {
      try {
        return evaluateAtDepth(rule, context, 0)
      } catch (e) {
        if (throwOnError) throw e
        return false
      }
    },

    evaluateAll(rules: Rule[], context: EvaluationContext): EvaluationResult[] {
      return rules.map((rule) => {
        try {
          const matched = evaluateAtDepth(rule, context, 0)
          return {
            rule,
            matched,
            reason: matched ? 'Rule matched' : 'Rule did not match',
          }
        } catch (e) {
          return {
            rule,
            matched: false,
            reason: 'Evaluation error',
            error: e instanceof Error ? e : new Error(String(e)),
          }
        }
      })
    },
  }
}

/**
 * Default rule evaluator instance
 */
export const defaultRuleEvaluator = createRuleEvaluator()

// ============================================================================
// HELPER FUNCTIONS FOR RULE BUILDING
// ============================================================================

/** Create an equals rule */
export function equals(attribute: string, value: unknown): Rule {
  return { attribute, operator: 'equals', value }
}

/** Create a not equals rule */
export function notEquals(attribute: string, value: unknown): Rule {
  return { attribute, operator: 'notEquals', value }
}

/** Create a contains rule */
export function contains(attribute: string, value: string): Rule {
  return { attribute, operator: 'contains', value }
}

/** Create a startsWith rule */
export function startsWith(attribute: string, value: string): Rule {
  return { attribute, operator: 'startsWith', value }
}

/** Create an endsWith rule */
export function endsWith(attribute: string, value: string): Rule {
  return { attribute, operator: 'endsWith', value }
}

/** Create a regex matches rule */
export function matches(attribute: string, pattern: string | RegExp): Rule {
  return { attribute, operator: 'matches', value: pattern }
}

/** Create a greater than rule */
export function gt(attribute: string, value: number): Rule {
  return { attribute, operator: 'gt', value }
}

/** Create a greater than or equal rule */
export function gte(attribute: string, value: number): Rule {
  return { attribute, operator: 'gte', value }
}

/** Create a less than rule */
export function lt(attribute: string, value: number): Rule {
  return { attribute, operator: 'lt', value }
}

/** Create a less than or equal rule */
export function lte(attribute: string, value: number): Rule {
  return { attribute, operator: 'lte', value }
}

/** Create a between rule */
export function between(attribute: string, min: number, max: number): Rule {
  return { attribute, operator: 'between', value: [min, max] }
}

/** Create an in rule */
export function inList(attribute: string, values: unknown[]): Rule {
  return { attribute, operator: 'in', value: values }
}

/** Create a not in rule */
export function notIn(attribute: string, values: unknown[]): Rule {
  return { attribute, operator: 'notIn', value: values }
}

/** Create an in segment rule */
export function inSegment(segmentId: string): Rule {
  return { attribute: '', operator: 'inSegment', value: segmentId }
}

/** Create a not in segment rule */
export function notInSegment(segmentId: string): Rule {
  return { attribute: '', operator: 'notInSegment', value: segmentId }
}

/** Create an exists rule */
export function exists(attribute: string): Rule {
  return { attribute, operator: 'exists', value: null }
}

/** Create a not exists rule */
export function notExists(attribute: string): Rule {
  return { attribute, operator: 'notExists', value: null }
}

/** Create an AND rule */
export function and(...rules: Rule[]): Rule {
  return { attribute: '', operator: 'and', value: null, children: rules }
}

/** Create an OR rule */
export function or(...rules: Rule[]): Rule {
  return { attribute: '', operator: 'or', value: null, children: rules }
}

/** Create a NOT rule */
export function not(rule: Rule): Rule {
  return { attribute: '', operator: 'not', value: null, children: [rule] }
}

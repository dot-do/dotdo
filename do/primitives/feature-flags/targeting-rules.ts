/**
 * Feature Flags Targeting Rules Engine
 *
 * High-level API for creating and evaluating targeting rules that determine
 * which users/contexts see which feature flag variants.
 *
 * @module db/primitives/feature-flags/targeting-rules
 */

// =============================================================================
// Types
// =============================================================================

/**
 * User context for targeting evaluation
 */
export interface UserContext {
  userId: string
  email?: string
  sessionId?: string
  role?: string
  plan?: string
  country?: string
  platform?: string
  deviceType?: string
  appVersion?: string
  browserVersion?: string
  osVersion?: string
  screenWidth?: number
  connectionType?: string
  locale?: string
  timezone?: string
  createdAt?: string | Date | number
  lastLoginAt?: string | Date | number
  subscriptionExpiresAt?: string | Date | number
  attributes?: Record<string, unknown>
  segments?: string[]
  [key: string]: unknown
}

/**
 * Operators for targeting conditions
 */
export type ConditionOperator =
  | 'equals' | 'notEquals' | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
  | 'in' | 'notIn' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'matches'
  | 'before' | 'after' | 'inSegment' | 'notInSegment' | 'exists' | 'notExists'
  | 'semverGt' | 'semverGte' | 'semverLt' | 'semverLte'
  | 'iEquals' // case-insensitive equals

/**
 * Condition for targeting rules
 */
export interface RuleCondition {
  attribute: string
  operator: ConditionOperator
  value: unknown
  negate?: boolean
}

/**
 * Clause for segment rules (same structure as RuleCondition)
 */
export interface SegmentClause {
  attribute: string
  operator: ConditionOperator
  value: unknown
}

/**
 * Rule within a segment
 */
export interface SegmentRule {
  clauses: SegmentClause[]
}

/**
 * Segment definition for grouping users
 */
export interface SegmentDefinition {
  key: string
  id?: string
  name: string
  description?: string
  included?: string[]
  excluded?: string[]
  rules?: SegmentRule[]
  conditions?: RuleCondition[]
}

/**
 * Re-export for compatibility
 */
export type Segment = SegmentDefinition

/**
 * Targeting rule definition
 */
export interface TargetingRule {
  id: string
  flagKey: string
  conditions: RuleCondition[]
  conditionGroups?: RuleCondition[][]
  variation: number
  enabled?: boolean
  priority?: number
  percentage?: number
  bucketKey?: string
  order?: number
  trackEvents?: boolean
}

/**
 * Reason for evaluation result
 */
export interface EvaluationReason {
  kind: 'RULE_MATCH' | 'NO_MATCH' | 'NO_RULES' | 'DEFAULT' | 'FALLTHROUGH' | 'ERROR'
  ruleIndex?: number
  matchedConditions?: RuleCondition[]
}

/**
 * Result of rule evaluation
 */
export interface EvaluationResult {
  matched: boolean
  ruleId?: string
  variation?: number
  reason?: EvaluationReason | string
  trackEvents?: boolean
  evaluatedAt?: number
}

/**
 * Configuration for targeting engine
 */
export interface TargetingEngineConfig {
  throwOnError?: boolean
  maxRuleDepth?: number
}

/**
 * Weighted variation for default rollouts
 */
export interface WeightedVariation {
  variation: number
  weight: number
}

/**
 * Default rollout configuration
 */
export interface DefaultRolloutConfig {
  variations: WeightedVariation[]
  bucketBy?: string
}

/**
 * Targeting engine interface
 */
export interface TargetingEngine {
  createRule(rule: TargetingRule): Promise<void>
  updateRule(ruleId: string, updates: Partial<TargetingRule>): Promise<void>
  deleteRule(ruleId: string): Promise<void>
  getRule(ruleId: string): TargetingRule | undefined
  getRulesForFlag(flagKey: string): TargetingRule[]

  createSegment(segment: SegmentDefinition): Promise<void>
  updateSegment(segmentId: string, updates: Partial<SegmentDefinition>): Promise<void>
  deleteSegment(segmentId: string): Promise<void>
  getSegment(segmentId: string): SegmentDefinition | undefined
  checkSegmentMembership(segmentId: string, context: UserContext): boolean

  evaluate(flagKey: string, context: UserContext): Promise<EvaluationResult>
  evaluateAll(flagKey: string, contexts: UserContext[]): Promise<Map<string, EvaluationResult>>

  setDefaultVariation(flagKey: string, variation: number): Promise<void>
  setDefaultRollout(flagKey: string, config: DefaultRolloutConfig): Promise<void>
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Compare semver versions
 */
function compareSemver(a: string, b: string): number {
  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    const aVal = aParts[i] ?? 0
    const bVal = bParts[i] ?? 0
    if (aVal !== bVal) return aVal - bVal
  }
  return 0
}

/**
 * Convert value to Date timestamp
 */
function toTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const date = new Date(value)
    return isNaN(date.getTime()) ? null : date.getTime()
  }
  return null
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Flatten user context for evaluation
 */
function flattenContext(context: UserContext): Record<string, unknown> {
  const { attributes, ...rest } = context
  return {
    ...rest,
    ...attributes,
  }
}

/**
 * Simple hash function for consistent bucketing
 */
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}

/**
 * Create a targeting engine instance
 */
export function createTargetingEngine(config: TargetingEngineConfig = {}): TargetingEngine {
  const rules = new Map<string, TargetingRule>()
  const rulesByFlag = new Map<string, Set<string>>()
  const segments = new Map<string, SegmentDefinition>()
  const defaultVariations = new Map<string, number>()
  const defaultRollouts = new Map<string, DefaultRolloutConfig>()

  /**
   * Evaluate a single condition
   */
  function evaluateCondition(condition: RuleCondition, context: Record<string, unknown>): boolean {
    const { attribute, operator, value, negate } = condition

    // Handle segment membership
    if (attribute === 'segment' && (operator === 'in' || operator === 'inSegment')) {
      const segmentKey = String(value)
      const segment = segments.get(segmentKey)
      if (!segment) return negate // Segment doesn't exist

      const userId = context.userId as string

      // Check excluded users FIRST (exclusions override inclusions)
      if (segment.excluded && segment.excluded.length > 0) {
        if (segment.excluded.includes(userId)) {
          return negate // User is excluded from segment
        }
      }

      // Check included users
      if (segment.included && segment.included.length > 0) {
        if (segment.included.includes(userId)) {
          return !negate
        }
      }

      // Check rules-based membership
      if (segment.rules && segment.rules.length > 0) {
        for (const rule of segment.rules) {
          if (evaluateClauses(rule.clauses, context)) {
            return !negate
          }
        }
      }

      // Check conditions-based membership
      if (segment.conditions && segment.conditions.length > 0) {
        const allMatch = segment.conditions.every(c => evaluateCondition(c, context))
        if (allMatch) return !negate
      }

      return negate // Not in segment
    }

    // Handle NOT IN segment
    if (attribute === 'segment' && (operator === 'notIn' || operator === 'notInSegment')) {
      const segmentKey = String(value)
      const segment = segments.get(segmentKey)
      if (!segment) return !negate // Segment doesn't exist, user is not in it

      const userId = context.userId as string

      // Check included users
      if (segment.included && segment.included.includes(userId)) {
        return negate
      }

      // Check rules-based membership
      if (segment.rules && segment.rules.length > 0) {
        for (const rule of segment.rules) {
          if (evaluateClauses(rule.clauses, context)) {
            return negate
          }
        }
      }

      return !negate // Not in segment
    }

    // Get attribute value from context
    const attrValue = getNestedValue(context, attribute)

    let result = false

    switch (operator) {
      case 'equals':
        result = attrValue === value
        break

      case 'iEquals':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          attrValue.toLowerCase() === value.toLowerCase()
        break

      case 'notEquals':
        result = attrValue !== value
        break

      case 'contains':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          attrValue.includes(value)
        break

      case 'notContains':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          !attrValue.includes(value)
        break

      case 'startsWith':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          attrValue.startsWith(value)
        break

      case 'endsWith':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          attrValue.endsWith(value)
        break

      case 'in':
        result = Array.isArray(value) && value.includes(attrValue)
        break

      case 'notIn':
        result = Array.isArray(value) && !value.includes(attrValue)
        break

      case 'gt': {
        const attrNum = typeof attrValue === 'number' ? attrValue : parseFloat(String(attrValue))
        const valNum = typeof value === 'number' ? value : parseFloat(String(value))
        result = !isNaN(attrNum) && !isNaN(valNum) && attrNum > valNum
        break
      }

      case 'gte': {
        const attrNum = typeof attrValue === 'number' ? attrValue : parseFloat(String(attrValue))
        const valNum = typeof value === 'number' ? value : parseFloat(String(value))
        result = !isNaN(attrNum) && !isNaN(valNum) && attrNum >= valNum
        break
      }

      case 'lt': {
        const attrNum = typeof attrValue === 'number' ? attrValue : parseFloat(String(attrValue))
        const valNum = typeof value === 'number' ? value : parseFloat(String(value))
        result = !isNaN(attrNum) && !isNaN(valNum) && attrNum < valNum
        break
      }

      case 'lte': {
        const attrNum = typeof attrValue === 'number' ? attrValue : parseFloat(String(attrValue))
        const valNum = typeof value === 'number' ? value : parseFloat(String(value))
        result = !isNaN(attrNum) && !isNaN(valNum) && attrNum <= valNum
        break
      }

      case 'between': {
        if (!Array.isArray(value) || value.length !== 2) {
          result = false
          break
        }
        const attrNum = typeof attrValue === 'number' ? attrValue : parseFloat(String(attrValue))
        const minNum = typeof value[0] === 'number' ? value[0] : parseFloat(String(value[0]))
        const maxNum = typeof value[1] === 'number' ? value[1] : parseFloat(String(value[1]))
        result = !isNaN(attrNum) && !isNaN(minNum) && !isNaN(maxNum) &&
          attrNum >= minNum && attrNum <= maxNum
        break
      }

      case 'matches': {
        if (typeof attrValue !== 'string' || typeof value !== 'string') {
          result = false
          break
        }
        try {
          result = new RegExp(value).test(attrValue)
        } catch {
          result = false
        }
        break
      }

      case 'before': {
        const attrTs = toTimestamp(attrValue)
        const valTs = toTimestamp(value)
        result = attrTs !== null && valTs !== null && attrTs < valTs
        break
      }

      case 'after': {
        const attrTs = toTimestamp(attrValue)
        const valTs = toTimestamp(value)
        result = attrTs !== null && valTs !== null && attrTs > valTs
        break
      }

      case 'semverGt':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          compareSemver(attrValue, value) > 0
        break

      case 'semverGte':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          compareSemver(attrValue, value) >= 0
        break

      case 'semverLt':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          compareSemver(attrValue, value) < 0
        break

      case 'semverLte':
        result = typeof attrValue === 'string' && typeof value === 'string' &&
          compareSemver(attrValue, value) <= 0
        break

      case 'exists':
        result = attrValue !== undefined && attrValue !== null
        break

      case 'notExists':
        result = attrValue === undefined || attrValue === null
        break

      default:
        result = false
    }

    return negate ? !result : result
  }

  /**
   * Evaluate segment clauses
   */
  function evaluateClauses(clauses: SegmentClause[], context: Record<string, unknown>): boolean {
    if (!clauses || clauses.length === 0) return true
    return clauses.every(clause => evaluateCondition(clause as RuleCondition, context))
  }

  /**
   * Check if all conditions match (AND logic)
   */
  function matchesConditions(conditions: RuleCondition[], context: Record<string, unknown>): boolean {
    if (!conditions || conditions.length === 0) return true
    return conditions.every(c => evaluateCondition(c, context))
  }

  /**
   * Check if any condition group matches (OR between groups, AND within groups)
   */
  function matchesConditionGroups(groups: RuleCondition[][], context: Record<string, unknown>): boolean {
    if (!groups || groups.length === 0) return false
    return groups.some(group => matchesConditions(group, context))
  }

  return {
    async createRule(rule: TargetingRule): Promise<void> {
      rules.set(rule.id, { ...rule, enabled: rule.enabled ?? true })

      if (!rulesByFlag.has(rule.flagKey)) {
        rulesByFlag.set(rule.flagKey, new Set())
      }
      rulesByFlag.get(rule.flagKey)!.add(rule.id)
    },

    async updateRule(ruleId: string, updates: Partial<TargetingRule>): Promise<void> {
      const existing = rules.get(ruleId)
      if (!existing) throw new Error(`Rule not found: ${ruleId}`)

      if (updates.flagKey && updates.flagKey !== existing.flagKey) {
        rulesByFlag.get(existing.flagKey)?.delete(ruleId)
        if (!rulesByFlag.has(updates.flagKey)) {
          rulesByFlag.set(updates.flagKey, new Set())
        }
        rulesByFlag.get(updates.flagKey)!.add(ruleId)
      }

      rules.set(ruleId, { ...existing, ...updates })
    },

    async deleteRule(ruleId: string): Promise<void> {
      const existing = rules.get(ruleId)
      if (existing) {
        rulesByFlag.get(existing.flagKey)?.delete(ruleId)
        rules.delete(ruleId)
      }
    },

    getRule(ruleId: string): TargetingRule | undefined {
      return rules.get(ruleId)
    },

    getRulesForFlag(flagKey: string): TargetingRule[] {
      const ruleIds = rulesByFlag.get(flagKey)
      if (!ruleIds) return []

      const flagRules: TargetingRule[] = []
      for (const ruleId of ruleIds) {
        const rule = rules.get(ruleId)
        if (rule) flagRules.push(rule)
      }

      // Sort by order/priority (lower = higher priority)
      flagRules.sort((a, b) => {
        const orderA = a.order ?? a.priority ?? 0
        const orderB = b.order ?? b.priority ?? 0
        return orderA - orderB
      })

      return flagRules
    },

    async createSegment(segment: SegmentDefinition): Promise<void> {
      segments.set(segment.key || segment.id!, segment)
    },

    async updateSegment(segmentId: string, updates: Partial<SegmentDefinition>): Promise<void> {
      const existing = segments.get(segmentId)
      if (!existing) throw new Error(`Segment not found: ${segmentId}`)
      segments.set(segmentId, { ...existing, ...updates })
    },

    async deleteSegment(segmentId: string): Promise<void> {
      segments.delete(segmentId)
    },

    getSegment(segmentId: string): SegmentDefinition | undefined {
      return segments.get(segmentId)
    },

    checkSegmentMembership(segmentId: string, context: UserContext): boolean {
      const segment = segments.get(segmentId)
      if (!segment) return false

      const flatContext = flattenContext(context)

      // Check included users
      if (segment.included && segment.included.includes(context.userId)) {
        return true
      }

      // Check excluded users
      if (segment.excluded && segment.excluded.includes(context.userId)) {
        return false
      }

      // Check rules
      if (segment.rules && segment.rules.length > 0) {
        for (const rule of segment.rules) {
          if (evaluateClauses(rule.clauses, flatContext)) {
            return true
          }
        }
      }

      return false
    },

    async evaluate(flagKey: string, context: UserContext): Promise<EvaluationResult> {
      const flagRules = this.getRulesForFlag(flagKey)
      const flatContext = flattenContext(context)
      const evaluatedAt = Date.now()

      if (flagRules.length === 0) {
        // Check for default rollout
        const defaultRollout = defaultRollouts.get(flagKey)
        if (defaultRollout !== undefined) {
          const hash = Math.abs(simpleHash(context.userId + flagKey)) % 100
          if (hash < defaultRollout) {
            const variation = defaultVariations.get(flagKey) ?? 1
            return {
              matched: true,
              variation,
              reason: { kind: 'FALLTHROUGH' },
              evaluatedAt,
            }
          }
        }

        // Check for default variation
        const defaultVar = defaultVariations.get(flagKey)
        if (defaultVar !== undefined) {
          return {
            matched: true,
            variation: defaultVar,
            reason: { kind: 'DEFAULT' },
            evaluatedAt,
          }
        }

        return {
          matched: false,
          reason: { kind: 'NO_RULES' },
          evaluatedAt,
        }
      }

      // Evaluate rules in order
      for (let i = 0; i < flagRules.length; i++) {
        const rule = flagRules[i]!

        // Skip disabled rules
        if (rule.enabled === false) continue

        // Check condition groups (OR logic between groups)
        let matched = false
        if (rule.conditionGroups && rule.conditionGroups.length > 0) {
          matched = matchesConditionGroups(rule.conditionGroups, flatContext)
        } else {
          // Check conditions (AND logic)
          matched = matchesConditions(rule.conditions, flatContext)
        }

        if (matched) {
          // Check percentage rollout
          if (rule.percentage !== undefined && rule.percentage < 100) {
            const bucketKey = rule.bucketKey
              ? String(flatContext[rule.bucketKey])
              : context.userId
            const hash = Math.abs(simpleHash(bucketKey + flagKey + rule.id)) % 100
            if (hash >= rule.percentage) {
              continue // Not in rollout
            }
          }

          return {
            matched: true,
            ruleId: rule.id,
            variation: rule.variation,
            reason: {
              kind: 'RULE_MATCH',
              ruleIndex: i,
              matchedConditions: rule.conditions,
            },
            trackEvents: rule.trackEvents,
            evaluatedAt,
          }
        }
      }

      // Check for default variation/rollout as fallback
      const defaultRollout = defaultRollouts.get(flagKey)
      if (defaultRollout !== undefined) {
        const hash = Math.abs(simpleHash(context.userId + flagKey)) % 100
        if (hash < defaultRollout) {
          const variation = defaultVariations.get(flagKey) ?? 0
          return {
            matched: true,
            variation,
            reason: { kind: 'FALLTHROUGH' },
            evaluatedAt,
          }
        }
      }

      const defaultVar = defaultVariations.get(flagKey)
      if (defaultVar !== undefined) {
        return {
          matched: true,
          variation: defaultVar,
          reason: { kind: 'DEFAULT' },
          evaluatedAt,
        }
      }

      return {
        matched: false,
        reason: { kind: 'NO_MATCH' },
        evaluatedAt,
      }
    },

    async evaluateAll(flagKey: string, contexts: UserContext[]): Promise<Map<string, EvaluationResult>> {
      const results = new Map<string, EvaluationResult>()
      for (const context of contexts) {
        results.set(context.userId, await this.evaluate(flagKey, context))
      }
      return results
    },

    async setDefaultVariation(flagKey: string, variation: number): Promise<void> {
      defaultVariations.set(flagKey, variation)
    },

    async setDefaultRollout(flagKey: string, rolloutConfig: DefaultRolloutConfig): Promise<void> {
      defaultRollouts.set(flagKey, rolloutConfig)
    },
  }
}

// =============================================================================
// Helper Functions (Rule Builders)
// =============================================================================

/**
 * Create a targeting rule
 */
export function createRule(rule: TargetingRule): TargetingRule {
  return {
    ...rule,
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? 0,
  }
}

/**
 * Create a segment definition
 */
export function createSegment(segment: SegmentDefinition): SegmentDefinition {
  return { ...segment }
}

/**
 * Evaluate targeting rules (standalone function)
 */
export async function evaluateTargetingRules(
  rules: TargetingRule[],
  context: UserContext,
  segmentDefs?: Map<string, SegmentDefinition>
): Promise<EvaluationResult> {
  const engine = createTargetingEngine()

  if (segmentDefs) {
    for (const [, segment] of segmentDefs) {
      await engine.createSegment(segment)
    }
  }

  const tempFlagKey = '__temp__'
  for (const rule of rules) {
    await engine.createRule({ ...rule, flagKey: tempFlagKey })
  }

  return engine.evaluate(tempFlagKey, context)
}

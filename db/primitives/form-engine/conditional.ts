/**
 * FormEngine Conditional Logic Module
 *
 * Evaluates show/hide, enable/disable, require/optional, and navigation conditions
 */

import type {
  FormSchema,
  FormField,
  FormData,
  Condition,
  ConditionGroup,
  ConditionalRule,
  ComparisonOperator,
  GroupField,
} from './types'
import { getAllFields } from './schema'

// ============================================================================
// CONDITION EVALUATION RESULT
// ============================================================================

export interface ConditionEvaluationResult {
  visibility: Record<string, boolean>
  enabled: Record<string, boolean>
  required: Record<string, boolean>
  values: Record<string, unknown>
  stepVisibility: Record<string, boolean>
  nextStep?: number
  skipToEnd?: boolean
}

export interface EvaluationOptions {
  currentStep?: number
}

// ============================================================================
// CONDITION EVALUATOR CLASS
// ============================================================================

export class ConditionalEvaluator {
  /**
   * Evaluate a single condition against form data
   */
  evaluate(condition: Condition, data: FormData): boolean {
    const value = this.getFieldValue(condition.field, data)
    return this.compareValues(value, condition.operator, condition.value)
  }

  /**
   * Evaluate a condition group (AND/OR)
   */
  evaluateGroup(group: ConditionGroup, data: FormData): boolean {
    if (group.conditions.length === 0) {
      return group.logic === 'and' // Empty AND is true, empty OR is false
    }

    for (const condition of group.conditions) {
      const result = this.isConditionGroup(condition)
        ? this.evaluateGroup(condition as ConditionGroup, data)
        : this.evaluate(condition as Condition, data)

      if (group.logic === 'or' && result) {
        return true
      }
      if (group.logic === 'and' && !result) {
        return false
      }
    }

    return group.logic === 'and'
  }

  /**
   * Check if a condition is a group
   */
  private isConditionGroup(condition: Condition | ConditionGroup): boolean {
    return 'logic' in condition && 'conditions' in condition
  }

  /**
   * Get a field value from data (supports nested paths)
   */
  private getFieldValue(fieldPath: string, data: FormData): unknown {
    const parts = fieldPath.split('.')
    let value: unknown = data

    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }

    return value
  }

  /**
   * Compare values using the specified operator
   */
  private compareValues(actual: unknown, operator: ComparisonOperator, expected: unknown): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected

      case 'notEquals':
        return actual !== expected

      case 'contains':
        if (typeof actual === 'string') {
          return actual.includes(String(expected))
        }
        if (Array.isArray(actual)) {
          return actual.includes(expected)
        }
        return false

      case 'notContains':
        if (typeof actual === 'string') {
          return !actual.includes(String(expected))
        }
        if (Array.isArray(actual)) {
          return !actual.includes(expected)
        }
        return true

      case 'startsWith':
        return typeof actual === 'string' && actual.startsWith(String(expected))

      case 'endsWith':
        return typeof actual === 'string' && actual.endsWith(String(expected))

      case 'greaterThan':
        return this.compareNumeric(actual, expected) > 0

      case 'lessThan':
        return this.compareNumeric(actual, expected) < 0

      case 'greaterThanOrEquals':
        return this.compareNumeric(actual, expected) >= 0

      case 'lessThanOrEquals':
        return this.compareNumeric(actual, expected) <= 0

      case 'isEmpty':
        return this.isEmpty(actual)

      case 'isNotEmpty':
        return !this.isEmpty(actual)

      case 'matches':
        if (typeof actual !== 'string') return false
        const regex = new RegExp(String(expected))
        return regex.test(actual)

      case 'in':
        if (Array.isArray(expected)) {
          return expected.includes(actual)
        }
        return false

      case 'notIn':
        if (Array.isArray(expected)) {
          return !expected.includes(actual)
        }
        return true

      default:
        return false
    }
  }

  /**
   * Compare values numerically or as dates
   */
  private compareNumeric(actual: unknown, expected: unknown): number {
    // Try date comparison
    if (typeof actual === 'string' && typeof expected === 'string') {
      const dateA = new Date(actual)
      const dateB = new Date(expected)
      if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
        return dateA.getTime() - dateB.getTime()
      }
    }

    // Numeric comparison
    const numA = typeof actual === 'number' ? actual : parseFloat(String(actual))
    const numB = typeof expected === 'number' ? expected : parseFloat(String(expected))

    if (isNaN(numA) || isNaN(numB)) {
      return 0 // Cannot compare, treat as equal
    }

    return numA - numB
  }

  /**
   * Check if a value is empty
   */
  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string' && value === '') return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
  }
}

// ============================================================================
// FULL CONDITION EVALUATION
// ============================================================================

/**
 * Evaluate all conditions in a form schema and return the resulting state
 */
export function evaluateConditions(
  schema: FormSchema,
  data: FormData,
  options: EvaluationOptions = {}
): ConditionEvaluationResult {
  const evaluator = createConditionEvaluator()

  const result: ConditionEvaluationResult = {
    visibility: {},
    enabled: {},
    required: {},
    values: {},
    stepVisibility: {},
  }

  // Initialize all fields as visible and enabled by default
  const allFields = getAllFields(schema)
  for (const field of allFields) {
    result.visibility[field.id] = !field.hidden
    result.enabled[field.id] = !field.disabled
    result.required[field.id] = field.required ?? false
  }

  // Initialize all steps as visible
  if (schema.steps) {
    for (const step of schema.steps) {
      result.stepVisibility[step.id] = true
    }
  }

  // Track evaluated fields to handle cascading
  const evaluatedFields = new Set<string>()
  const maxIterations = 100 // Prevent infinite loops

  // Evaluate field conditions with cascade support
  const evaluateFieldConditions = (fields: FormField[]) => {
    for (const field of fields) {
      if (evaluatedFields.has(field.id)) continue

      if (field.conditions) {
        for (const rule of field.conditions) {
          const conditionMet = evaluateRule(evaluator, rule.when, data)
          applyAction(result, rule, conditionMet, field.id)
        }
      }

      evaluatedFields.add(field.id)

      // Handle nested group fields
      if (field.type === 'group' && (field as GroupField).fields) {
        evaluateFieldConditions((field as GroupField).fields)
      }
    }
  }

  // Run multiple passes to handle cascading visibility
  let iterations = 0
  let previousState = JSON.stringify(result.visibility)

  while (iterations < maxIterations) {
    evaluatedFields.clear()
    evaluateFieldConditions(allFields)

    const currentState = JSON.stringify(result.visibility)
    if (currentState === previousState) break
    previousState = currentState
    iterations++
  }

  // Evaluate step conditions
  if (schema.steps) {
    for (const step of schema.steps) {
      if (step.conditions) {
        for (const rule of step.conditions) {
          const conditionMet = evaluateRule(evaluator, rule.when, data)

          if (rule.action === 'show') {
            result.stepVisibility[step.id] = conditionMet
          } else if (rule.action === 'hide') {
            result.stepVisibility[step.id] = !conditionMet
          } else if (rule.action === 'skipToStep' && conditionMet && rule.step !== undefined) {
            result.nextStep = rule.step
          } else if (rule.action === 'skipToEnd' && conditionMet) {
            result.skipToEnd = true
          }
        }
      }
    }

    // Calculate next step based on visibility
    if (options.currentStep !== undefined && result.nextStep === undefined) {
      const nextVisibleStep = findNextVisibleStep(schema, result.stepVisibility, options.currentStep)
      if (nextVisibleStep !== undefined) {
        result.nextStep = nextVisibleStep
      }
    }
  }

  // Evaluate form-level conditions
  if (schema.conditions) {
    for (const rule of schema.conditions) {
      const conditionMet = evaluateRule(evaluator, rule.when, data)
      applyAction(result, rule, conditionMet)
    }
  }

  // Hidden fields should not be required
  for (const fieldId of Object.keys(result.visibility)) {
    if (result.visibility[fieldId] === false) {
      result.required[fieldId] = false
    }
  }

  return result
}

/**
 * Evaluate a condition or condition group
 */
function evaluateRule(
  evaluator: ConditionalEvaluator,
  when: Condition | ConditionGroup,
  data: FormData
): boolean {
  if ('logic' in when && 'conditions' in when) {
    return evaluator.evaluateGroup(when as ConditionGroup, data)
  }
  return evaluator.evaluate(when as Condition, data)
}

/**
 * Apply an action based on condition result
 */
function applyAction(
  result: ConditionEvaluationResult,
  rule: ConditionalRule,
  conditionMet: boolean,
  defaultTarget?: string
): void {
  const targets = rule.target
    ? Array.isArray(rule.target)
      ? rule.target
      : [rule.target]
    : defaultTarget
      ? [defaultTarget]
      : []

  for (const target of targets) {
    switch (rule.action) {
      case 'show':
        result.visibility[target] = conditionMet
        break
      case 'hide':
        result.visibility[target] = !conditionMet
        break
      case 'enable':
        result.enabled[target] = conditionMet
        break
      case 'disable':
        result.enabled[target] = !conditionMet
        break
      case 'require':
        result.required[target] = conditionMet
        break
      case 'optional':
        result.required[target] = !conditionMet
        break
      case 'setValue':
        if (conditionMet && rule.value !== undefined) {
          result.values[target] = rule.value
        }
        break
      case 'skipToStep':
        if (conditionMet && rule.step !== undefined) {
          result.nextStep = rule.step
        }
        break
      case 'skipToEnd':
        if (conditionMet) {
          result.skipToEnd = true
        }
        break
    }
  }
}

/**
 * Find the next visible step after the current step
 */
function findNextVisibleStep(
  schema: FormSchema,
  stepVisibility: Record<string, boolean>,
  currentStep: number
): number | undefined {
  if (!schema.steps) return undefined

  for (let i = currentStep + 1; i < schema.steps.length; i++) {
    const step = schema.steps[i]
    if (stepVisibility[step.id] !== false) {
      return i
    }
  }

  // No more visible steps
  return schema.steps.length
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a condition evaluator
 */
export function createConditionEvaluator(): ConditionalEvaluator {
  return new ConditionalEvaluator()
}

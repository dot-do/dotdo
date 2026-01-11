/**
 * Quinn - QA Agent for Product Discovery
 *
 * Quinn is the QA agent responsible for:
 * - Validating specs are testable
 * - Reviewing acceptance criteria
 * - Identifying ambiguities and gaps
 * - Ensuring quality of specifications
 *
 * @example
 * ```ts
 * import { quinn } from './agents/quinn'
 *
 * const validation = await quinn`validate ${spec} is testable`
 * if (validation.isTestable) {
 *   console.log('Spec is ready for development!')
 * }
 * ```
 *
 * @module agent-product-discovery/agents/quinn
 */

import type {
  UserStory,
  AcceptanceCriterion,
  SpecValidation,
  ValidationIssue,
} from '../ProductDiscoveryDO'

// ============================================================================
// TYPES
// ============================================================================

export interface QuinnConfig {
  /** Temperature for AI responses */
  temperature?: number
  /** Maximum tokens for response */
  maxTokens?: number
  /** Model to use */
  model?: string
  /** Strictness level for validation */
  strictness?: 'lenient' | 'moderate' | 'strict'
}

export interface ValidationRequest {
  story: UserStory
  strictness?: 'lenient' | 'moderate' | 'strict'
}

export interface SpecReviewResult {
  storyId: string
  isTestable: boolean
  score: number
  issues: ValidationIssue[]
  suggestions: string[]
  improvedCriteria?: AcceptanceCriterion[]
}

export interface CriteriaAnalysis {
  criterionId: string
  isTestable: boolean
  specificity: 'vague' | 'adequate' | 'specific'
  measurability: 'unmeasurable' | 'partially' | 'measurable'
  issues: string[]
  suggestion?: string
}

// ============================================================================
// MOCK MODE
// ============================================================================

let mockMode = false
let mockResponses: Map<string, unknown> = new Map()

/**
 * Enable mock mode for testing without API calls
 */
export function enableMockMode(): void {
  mockMode = true
}

/**
 * Disable mock mode
 */
export function disableMockMode(): void {
  mockMode = false
  mockResponses.clear()
}

/**
 * Set a mock response for a specific operation
 */
export function setMockResponse(operation: string, response: unknown): void {
  mockResponses.set(operation, response)
}

/**
 * Check if mock mode is enabled
 */
export function isMockMode(): boolean {
  return mockMode
}

// ============================================================================
// QUINN AGENT FUNCTIONS
// ============================================================================

/**
 * Quinn validates a user story's acceptance criteria for testability
 */
export async function validateSpec(request: ValidationRequest): Promise<SpecValidation> {
  const { story, strictness = 'moderate' } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('validate')
    if (mockResponse) {
      return mockResponse as SpecValidation
    }

    return generateMockValidation(story, strictness)
  }

  return generateMockValidation(story, strictness)
}

/**
 * Quinn reviews acceptance criteria and provides detailed analysis
 */
export async function reviewCriteria(
  criteria: AcceptanceCriterion[]
): Promise<CriteriaAnalysis[]> {
  if (mockMode) {
    const mockResponse = mockResponses.get('review')
    if (mockResponse) {
      return mockResponse as CriteriaAnalysis[]
    }

    return generateMockCriteriaAnalysis(criteria)
  }

  return generateMockCriteriaAnalysis(criteria)
}

/**
 * Quinn suggests improvements for acceptance criteria
 */
export async function suggestImprovements(
  story: UserStory
): Promise<SpecReviewResult> {
  if (mockMode) {
    const mockResponse = mockResponses.get('suggest')
    if (mockResponse) {
      return mockResponse as SpecReviewResult
    }

    return generateMockSpecReview(story)
  }

  return generateMockSpecReview(story)
}

/**
 * Quinn validates multiple stories in batch
 */
export async function validateBatch(
  stories: UserStory[],
  strictness: 'lenient' | 'moderate' | 'strict' = 'moderate'
): Promise<SpecValidation[]> {
  if (mockMode) {
    const mockResponse = mockResponses.get('batch')
    if (mockResponse) {
      return mockResponse as SpecValidation[]
    }

    return Promise.all(stories.map(story => generateMockValidation(story, strictness)))
  }

  return Promise.all(stories.map(story => generateMockValidation(story, strictness)))
}

// ============================================================================
// TEMPLATE LITERAL INTERFACE
// ============================================================================

/**
 * Quinn template literal function for natural language interaction
 *
 * @example
 * ```ts
 * const validation = await quinn`validate ${story} is testable`
 * const review = await quinn`review criteria for ${story}`
 * const suggestions = await quinn`suggest improvements for ${story}`
 * ```
 */
export function quinn(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<string | SpecValidation | CriteriaAnalysis[] | SpecReviewResult> {
  const prompt = interpolate(strings, values)
  const promptLower = prompt.toLowerCase()

  // Get story from values
  const story = values.find(isUserStory) as UserStory | undefined

  // Suggest improvements (check before review since "suggest improvements" might contain "review")
  if (promptLower.includes('suggest') || promptLower.includes('improvement')) {
    if (story) {
      return suggestImprovements(story) as Promise<SpecReviewResult>
    }
  }

  // Review criteria
  if (promptLower.includes('review') && promptLower.includes('criteria')) {
    if (story) {
      return reviewCriteria(story.acceptanceCriteria) as Promise<CriteriaAnalysis[]>
    }

    const criteria = values.find(isCriteriaArray) as AcceptanceCriterion[] | undefined
    if (criteria) {
      return reviewCriteria(criteria) as Promise<CriteriaAnalysis[]>
    }
  }

  // Validation (default if story provided and nothing else matched)
  if (promptLower.includes('validate') || promptLower.includes('testable') || story) {
    if (story) {
      const strictness = promptLower.includes('strict')
        ? 'strict'
        : promptLower.includes('lenient')
          ? 'lenient'
          : 'moderate'
      return validateSpec({ story, strictness }) as Promise<SpecValidation>
    }
  }

  // Default: return a generic response
  return Promise.resolve(`[Quinn] Processed: ${prompt.slice(0, 100)}...`)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function interpolate(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((result, str, i) => {
    let value = ''
    if (i < values.length) {
      const v = values[i]
      if (v === null || v === undefined) {
        value = ''
      } else if (typeof v === 'object') {
        value = JSON.stringify(v, null, 2)
      } else {
        value = String(v)
      }
    }
    return result + str + value
  }, '')
}

function isUserStory(value: unknown): value is UserStory {
  return (
    typeof value === 'object' &&
    value !== null &&
    'asA' in value &&
    'iWant' in value &&
    'soThat' in value &&
    'acceptanceCriteria' in value
  )
}

function isCriteriaArray(value: unknown): value is AcceptanceCriterion[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null &&
    'given' in value[0] &&
    'when' in value[0] &&
    'then' in value[0]
  )
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

// ============================================================================
// MOCK GENERATORS
// ============================================================================

function generateMockValidation(
  story: UserStory,
  strictness: 'lenient' | 'moderate' | 'strict'
): SpecValidation {
  const issues: ValidationIssue[] = []
  const suggestions: string[] = []

  // Analyze each criterion
  for (const criterion of story.acceptanceCriteria) {
    const analysis = analyzeCriterion(criterion, strictness)

    if (!analysis.isTestable) {
      issues.push({
        criterionId: criterion.id,
        type: analysis.type,
        description: analysis.description,
        suggestion: analysis.suggestion,
      })
    }
  }

  // Add general suggestions based on strictness
  if (strictness === 'strict' && story.acceptanceCriteria.length < 3) {
    suggestions.push('Consider adding more acceptance criteria to cover edge cases')
  }

  if (issues.length === 0) {
    suggestions.push('All criteria are testable and well-defined')
  } else {
    suggestions.push(`${issues.length} issue(s) found - address these before development`)
  }

  // Calculate testability based on strictness thresholds
  const testableCount = story.acceptanceCriteria.length - issues.length
  const testableRatio = story.acceptanceCriteria.length > 0
    ? testableCount / story.acceptanceCriteria.length
    : 0

  const isTestable = strictness === 'lenient'
    ? testableRatio >= 0.5
    : strictness === 'moderate'
      ? testableRatio >= 0.7
      : testableRatio >= 0.9

  return {
    storyId: story.id,
    isTestable,
    issues,
    suggestions,
    validatedAt: new Date().toISOString(),
  }
}

function analyzeCriterion(
  criterion: AcceptanceCriterion,
  strictness: 'lenient' | 'moderate' | 'strict'
): {
  isTestable: boolean
  type: ValidationIssue['type']
  description: string
  suggestion: string
} {
  const { given, when, then } = criterion

  // Check for vague language
  const vagueTerms = ['should', 'might', 'could', 'appropriate', 'properly', 'correctly', 'good']
  const hasVagueTerms = vagueTerms.some(term =>
    given.toLowerCase().includes(term) ||
    when.toLowerCase().includes(term) ||
    then.toLowerCase().includes(term)
  )

  // Check for measurable outcomes
  const measurableIndicators = ['see', 'receive', 'display', 'show', 'return', 'error', 'success', 'within', 'equals', 'contains']
  const hasMeasurable = measurableIndicators.some(term => then.toLowerCase().includes(term))

  // Check for specificity
  const isSpecific = given.length > 20 && when.length > 10 && then.length > 15

  // Determine testability based on strictness
  if (strictness === 'strict') {
    if (hasVagueTerms) {
      return {
        isTestable: false,
        type: 'ambiguous',
        description: `Contains vague language that makes testing subjective`,
        suggestion: `Replace vague terms like "should" or "properly" with specific, measurable outcomes`,
      }
    }
    if (!hasMeasurable) {
      return {
        isTestable: false,
        type: 'untestable',
        description: `The "Then" clause lacks measurable outcome`,
        suggestion: `Add specific, observable results (e.g., "see error message X", "receive confirmation email")`,
      }
    }
    if (!isSpecific) {
      return {
        isTestable: false,
        type: 'incomplete',
        description: `Criteria lacks sufficient detail for reliable testing`,
        suggestion: `Add more context to Given/When/Then clauses`,
      }
    }
  } else if (strictness === 'moderate') {
    if (hasVagueTerms && !hasMeasurable) {
      return {
        isTestable: false,
        type: 'ambiguous',
        description: `Criterion is too vague to test reliably`,
        suggestion: `Add specific, measurable outcomes to the "Then" clause`,
      }
    }
  }

  // Lenient mode: only fail for clearly untestable criteria
  if (then.length < 5 || then.toLowerCase() === 'it works') {
    return {
      isTestable: false,
      type: 'untestable',
      description: `The "Then" clause is too generic to test`,
      suggestion: `Specify exactly what should happen and how to verify it`,
    }
  }

  return {
    isTestable: true,
    type: 'ambiguous', // Not used when testable
    description: '',
    suggestion: '',
  }
}

function generateMockCriteriaAnalysis(criteria: AcceptanceCriterion[]): CriteriaAnalysis[] {
  return criteria.map(criterion => {
    const { given, when, then } = criterion

    // Analyze specificity
    const totalLength = given.length + when.length + then.length
    const specificity: CriteriaAnalysis['specificity'] =
      totalLength < 50 ? 'vague' : totalLength < 100 ? 'adequate' : 'specific'

    // Analyze measurability
    const measurableIndicators = ['see', 'receive', 'display', 'show', 'return', 'error', 'success']
    const hasMeasurable = measurableIndicators.some(term => then.toLowerCase().includes(term))
    const measurability: CriteriaAnalysis['measurability'] =
      hasMeasurable ? 'measurable' : then.length > 30 ? 'partially' : 'unmeasurable'

    // Determine issues
    const issues: string[] = []
    if (specificity === 'vague') {
      issues.push('Criterion lacks sufficient detail')
    }
    if (measurability === 'unmeasurable') {
      issues.push('Outcome is not measurable')
    }

    return {
      criterionId: criterion.id,
      isTestable: issues.length === 0,
      specificity,
      measurability,
      issues,
      suggestion: issues.length > 0
        ? 'Add specific, measurable outcomes to improve testability'
        : undefined,
    }
  })
}

function generateMockSpecReview(story: UserStory): SpecReviewResult {
  const validation = generateMockValidation(story, 'moderate')

  // Generate improved criteria
  const improvedCriteria: AcceptanceCriterion[] = story.acceptanceCriteria.map(criterion => ({
    ...criterion,
    id: generateId('ac'),
    given: criterion.given.length < 30
      ? `${criterion.given} with valid session and permissions`
      : criterion.given,
    then: criterion.then.includes('should')
      ? criterion.then.replace('should', 'will').replace('properly', 'displaying the confirmation message')
      : `${criterion.then} within 2 seconds`,
    isTestable: true,
  }))

  // Calculate score
  const testableCount = story.acceptanceCriteria.filter(c => c.isTestable).length
  const score = Math.round((testableCount / story.acceptanceCriteria.length) * 100)

  return {
    storyId: story.id,
    isTestable: validation.isTestable,
    score,
    issues: validation.issues,
    suggestions: [
      ...validation.suggestions,
      'Consider adding error handling scenarios',
      'Add performance requirements where applicable',
    ],
    improvedCriteria,
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default quinn

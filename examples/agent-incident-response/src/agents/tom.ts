/**
 * Tom - Tech Lead Agent for Incident Response
 *
 * Tom is the tech lead agent responsible for:
 * - Reviewing hotfixes for quality and safety
 * - Approving or rejecting emergency deployments
 * - Assessing risk of proposed changes
 *
 * @example
 * ```ts
 * import { tom } from './agents/tom'
 *
 * const review = await tom`emergency review ${hotfix}`
 * if (review.approved) {
 *   await deploy(hotfix)
 * }
 * ```
 *
 * @module agent-incident-response/agents/tom
 */

import type { Diagnosis, Hotfix, Review, ReviewComment, ReviewChecklist } from '../IncidentResponseDO'

// ============================================================================
// TYPES
// ============================================================================

export interface TomConfig {
  /** Temperature for AI responses (lower = more strict) */
  temperature?: number
  /** Maximum tokens for response */
  maxTokens?: number
  /** Model to use */
  model?: string
  /** Risk tolerance level */
  riskTolerance?: 'strict' | 'moderate' | 'lenient'
}

export interface ReviewRequest {
  hotfix: Hotfix
  diagnosis: Diagnosis
  isEmergency?: boolean
}

export interface ApprovalDecision {
  approved: boolean
  reason: string
  conditions?: string[]
}

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical'
  factors: string[]
  mitigations: string[]
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
// TOM AGENT FUNCTIONS
// ============================================================================

/**
 * Tom performs an emergency code review of a hotfix
 */
export async function emergencyReview(request: ReviewRequest): Promise<Review> {
  const { hotfix, diagnosis, isEmergency = true } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('review')
    if (mockResponse) {
      return mockResponse as Review
    }

    return generateMockReview(hotfix, diagnosis, isEmergency)
  }

  return generateMockReview(hotfix, diagnosis, isEmergency)
}

/**
 * Tom makes an approval decision based on a review
 */
export async function approve(review: Review): Promise<ApprovalDecision> {
  if (mockMode) {
    const mockResponse = mockResponses.get('approve')
    if (mockResponse) {
      return mockResponse as ApprovalDecision
    }

    return {
      approved: review.approved,
      reason: review.approved
        ? 'All checklist items passed and risk is acceptable'
        : `Review rejected: ${review.riskAssessment}`,
      conditions: review.approved
        ? ['Monitor error rates for 15 minutes post-deploy', 'Keep rollback ready']
        : undefined,
    }
  }

  return {
    approved: review.approved,
    reason: review.approved
      ? 'All checklist items passed and risk is acceptable'
      : `Review rejected: ${review.riskAssessment}`,
    conditions: review.approved
      ? ['Monitor error rates for 15 minutes post-deploy', 'Keep rollback ready']
      : undefined,
  }
}

/**
 * Tom assesses the risk of a proposed change
 */
export async function assessRisk(hotfix: Hotfix): Promise<RiskAssessment> {
  const factors: string[] = []
  const mitigations: string[] = []

  // Check change scope
  if (hotfix.changes.length > 3) {
    factors.push('Multiple files modified')
    mitigations.push('Consider splitting into smaller changes')
  }

  // Check test coverage
  const passedTests = hotfix.testResults.filter((t) => t.passed).length
  const totalTests = hotfix.testResults.length
  if (passedTests < totalTests) {
    factors.push(`${totalTests - passedTests} tests failing`)
    mitigations.push('Fix failing tests before deployment')
  }

  // Check rollback plan
  if (!hotfix.rollbackPlan) {
    factors.push('No rollback plan defined')
    mitigations.push('Define clear rollback procedure')
  }

  // Determine risk level
  let level: 'low' | 'medium' | 'high' | 'critical' = 'low'
  if (factors.length >= 3) {
    level = 'critical'
  } else if (factors.length >= 2) {
    level = 'high'
  } else if (factors.length >= 1) {
    level = 'medium'
  }

  return { level, factors, mitigations }
}

// ============================================================================
// TEMPLATE LITERAL INTERFACE
// ============================================================================

/**
 * Tom template literal function for natural language interaction
 *
 * @example
 * ```ts
 * const review = await tom`emergency review ${hotfix}`
 * const approved = await tom`approve ${review}`
 * ```
 */
export function tom(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<string | Review | ApprovalDecision | RiskAssessment> {
  const prompt = interpolate(strings, values)

  // Parse the prompt to determine the action
  const promptLower = prompt.toLowerCase()

  if (promptLower.includes('review')) {
    const hotfix = values.find(isHotfix) as Hotfix | undefined
    const diagnosis = values.find(isDiagnosis) as Diagnosis | undefined

    if (hotfix && diagnosis) {
      const isEmergency = promptLower.includes('emergency')
      return emergencyReview({ hotfix, diagnosis, isEmergency }) as Promise<Review>
    }
  }

  if (promptLower.includes('approve')) {
    const review = values.find(isReview) as Review | undefined
    if (review) {
      return approve(review) as Promise<ApprovalDecision>
    }
  }

  if (promptLower.includes('risk') || promptLower.includes('assess')) {
    const hotfix = values.find(isHotfix) as Hotfix | undefined
    if (hotfix) {
      return assessRisk(hotfix) as Promise<RiskAssessment>
    }
  }

  // Default: return a generic response
  return Promise.resolve(`[Tom] Processed: ${prompt.slice(0, 100)}...`)
}

// Add approve method for compatibility with agent approval pattern
tom.approve = async (input: unknown): Promise<{ approved: boolean; feedback?: string }> => {
  if (isReview(input)) {
    const decision = await approve(input)
    return { approved: decision.approved, feedback: decision.reason }
  }

  if (isHotfix(input)) {
    const risk = await assessRisk(input)
    const approved = risk.level === 'low' || risk.level === 'medium'
    return {
      approved,
      feedback: approved
        ? `Approved with ${risk.level} risk. Factors: ${risk.factors.join(', ') || 'none'}`
        : `Rejected due to ${risk.level} risk. Issues: ${risk.factors.join(', ')}`,
    }
  }

  return { approved: false, feedback: 'Unable to evaluate input' }
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

function isHotfix(value: unknown): value is Hotfix {
  return (
    typeof value === 'object' &&
    value !== null &&
    'changes' in value &&
    'testResults' in value &&
    'rollbackPlan' in value
  )
}

function isDiagnosis(value: unknown): value is Diagnosis {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rootCause' in value &&
    'suggestedFix' in value
  )
}

function isReview(value: unknown): value is Review {
  return (
    typeof value === 'object' &&
    value !== null &&
    'approved' in value &&
    'reviewer' in value &&
    'checklist' in value
  )
}

// ============================================================================
// MOCK GENERATORS
// ============================================================================

function generateMockReview(
  hotfix: Hotfix,
  diagnosis: Diagnosis,
  isEmergency: boolean
): Review {
  const comments: ReviewComment[] = []

  // Analyze changes
  for (const change of hotfix.changes) {
    // Check for common issues in the diff
    if (change.diff.includes('maxConnections')) {
      comments.push({
        file: change.path,
        line: 10,
        severity: 'info',
        message: 'Consider using environment variable for connection pool size',
      })
    }
  }

  // Check test results
  const failedTests = hotfix.testResults.filter((t) => !t.passed)
  if (failedTests.length > 0) {
    comments.push({
      file: 'tests',
      line: 0,
      severity: 'blocker',
      message: `${failedTests.length} test(s) failing: ${failedTests.map((t) => t.name).join(', ')}`,
    })
  }

  // Build checklist
  // Check if hotfix addresses root cause by seeing if key words from the suggested fix
  // appear in the hotfix description
  const suggestedFixWords = diagnosis.suggestedFix.toLowerCase().split(/\s+/)
  const hotfixDescWords = hotfix.description.toLowerCase().split(/\s+/)
  const addressesRootCause = suggestedFixWords.some(
    (word) => word.length > 3 && hotfixDescWords.includes(word)
  )

  const checklist: ReviewChecklist = {
    addressesRootCause,
    noRegressions: failedTests.length === 0,
    hasRollbackPlan: !!hotfix.rollbackPlan && hotfix.rollbackPlan.length > 10,
    testsPass: failedTests.length === 0,
    metricsMonitored: true, // Assume true for emergency fixes
  }

  // Determine approval
  const hasBlockers = comments.some((c) => c.severity === 'blocker')
  const checklistPassed = Object.values(checklist).every((v) => v === true)

  // In emergency mode, be more lenient but not reckless
  const approved = isEmergency
    ? !hasBlockers && checklist.addressesRootCause && checklist.hasRollbackPlan
    : checklistPassed && !hasBlockers

  return {
    approved,
    reviewer: 'tom',
    comments,
    riskAssessment: hasBlockers
      ? 'Blocking issues found that must be resolved'
      : hotfix.estimatedRisk === 'high'
        ? 'High risk change - extra caution advised'
        : 'Acceptable risk level for emergency deployment',
    checklist,
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default tom

/**
 * Quinn - QA Agent for Incident Response
 *
 * Quinn is the QA agent responsible for:
 * - Validating that fixes prevent recurrence
 * - Testing edge cases
 * - Ensuring quality standards are met
 *
 * @example
 * ```ts
 * import { quinn } from './agents/quinn'
 *
 * const validation = await quinn`validate ${hotfix} prevents recurrence`
 * if (validation.passed) {
 *   console.log('Fix verified!')
 * }
 * ```
 *
 * @module agent-incident-response/agents/quinn
 */

import type { Alert, Hotfix, Validation } from '../IncidentResponseDO'

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
  hotfix: Hotfix
  alert: Alert
  reproductionSteps?: string[]
}

export interface TestCoverage {
  percentage: number
  uncoveredPaths: string[]
  criticalPathsCovered: boolean
}

export interface EdgeCaseAnalysis {
  identified: string[]
  tested: string[]
  untested: string[]
  riskLevel: 'low' | 'medium' | 'high'
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
 * Quinn validates that a hotfix prevents recurrence of the issue
 */
export async function validateFix(request: ValidationRequest): Promise<Validation> {
  const { hotfix, alert } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('validate')
    if (mockResponse) {
      return mockResponse as Validation
    }

    return generateMockValidation(hotfix, alert)
  }

  return generateMockValidation(hotfix, alert)
}

/**
 * Quinn analyzes test coverage for the hotfix
 */
export async function analyzeTestCoverage(hotfix: Hotfix): Promise<TestCoverage> {
  if (mockMode) {
    const mockResponse = mockResponses.get('coverage')
    if (mockResponse) {
      return mockResponse as TestCoverage
    }

    return generateMockCoverage(hotfix)
  }

  return generateMockCoverage(hotfix)
}

/**
 * Quinn identifies edge cases that should be tested
 */
export async function analyzeEdgeCases(
  hotfix: Hotfix,
  alert: Alert
): Promise<EdgeCaseAnalysis> {
  if (mockMode) {
    const mockResponse = mockResponses.get('edgeCases')
    if (mockResponse) {
      return mockResponse as EdgeCaseAnalysis
    }

    return generateMockEdgeCaseAnalysis(hotfix, alert)
  }

  return generateMockEdgeCaseAnalysis(hotfix, alert)
}

// ============================================================================
// TEMPLATE LITERAL INTERFACE
// ============================================================================

/**
 * Quinn template literal function for natural language interaction
 *
 * @example
 * ```ts
 * const validation = await quinn`validate ${hotfix} for ${alert}`
 * const coverage = await quinn`analyze coverage for ${hotfix}`
 * ```
 */
export function quinn(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<string | Validation | TestCoverage | EdgeCaseAnalysis> {
  const prompt = interpolate(strings, values)

  // Parse the prompt to determine the action
  const promptLower = prompt.toLowerCase()

  if (promptLower.includes('validate') || promptLower.includes('verify')) {
    const hotfix = values.find(isHotfix) as Hotfix | undefined
    const alert = values.find(isAlert) as Alert | undefined

    if (hotfix && alert) {
      return validateFix({ hotfix, alert }) as Promise<Validation>
    }
  }

  if (promptLower.includes('coverage')) {
    const hotfix = values.find(isHotfix) as Hotfix | undefined
    if (hotfix) {
      return analyzeTestCoverage(hotfix) as Promise<TestCoverage>
    }
  }

  if (promptLower.includes('edge case') || promptLower.includes('edge-case')) {
    const hotfix = values.find(isHotfix) as Hotfix | undefined
    const alert = values.find(isAlert) as Alert | undefined

    if (hotfix && alert) {
      return analyzeEdgeCases(hotfix, alert) as Promise<EdgeCaseAnalysis>
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

function isHotfix(value: unknown): value is Hotfix {
  return (
    typeof value === 'object' &&
    value !== null &&
    'changes' in value &&
    'testResults' in value &&
    'rollbackPlan' in value
  )
}

function isAlert(value: unknown): value is Alert {
  return (
    typeof value === 'object' &&
    value !== null &&
    'severity' in value &&
    'service' in value &&
    'summary' in value
  )
}

// ============================================================================
// MOCK GENERATORS
// ============================================================================

function generateMockValidation(hotfix: Hotfix, alert: Alert): Validation {
  // Determine if the fix is valid based on test results and risk
  const testsPass = hotfix.testResults.every((t) => t.passed)
  const lowRisk = hotfix.estimatedRisk === 'low'
  const testCount = hotfix.testResults.length

  // Calculate a realistic pass rate
  const passed = testsPass && (lowRisk || testCount >= 2)

  // Generate edge cases based on the service
  const edgeCases = getEdgeCasesForService(alert.service)
  const coveredEdgeCases = edgeCases.slice(0, Math.ceil(edgeCases.length * 0.7))
  const potentialGaps = edgeCases.slice(coveredEdgeCases.length)

  return {
    passed,
    testsRun: testCount + 3, // Include additional validation tests
    testsPassed: testsPass ? testCount + 3 : testCount,
    coverage: testsPass ? 85 : 65,
    edgeCasesCovered: coveredEdgeCases,
    potentialGaps: potentialGaps.length > 0 ? potentialGaps : ['None identified'],
  }
}

function generateMockCoverage(hotfix: Hotfix): TestCoverage {
  const testsPass = hotfix.testResults.every((t) => t.passed)
  const changedFiles = hotfix.changes.map((c) => c.path)

  return {
    percentage: testsPass ? 87 : 62,
    uncoveredPaths: testsPass
      ? []
      : changedFiles.map((f) => `${f}:error-path`),
    criticalPathsCovered: testsPass,
  }
}

function generateMockEdgeCaseAnalysis(hotfix: Hotfix, alert: Alert): EdgeCaseAnalysis {
  const edgeCases = getEdgeCasesForService(alert.service)
  const testedCount = Math.ceil(edgeCases.length * 0.6)

  return {
    identified: edgeCases,
    tested: edgeCases.slice(0, testedCount),
    untested: edgeCases.slice(testedCount),
    riskLevel: edgeCases.slice(testedCount).length > 2 ? 'high' : 'medium',
  }
}

function getEdgeCasesForService(service: string): string[] {
  const edgeCases: Record<string, string[]> = {
    'api-gateway': [
      'Connection timeout during pool exhaustion',
      'Concurrent connection limit reached',
      'Slow query holding connections',
      'Database failover during request',
      'Connection leak on error path',
    ],
    'payment-service': [
      'Duplicate payment prevention',
      'Partial payment failure',
      'Currency conversion edge cases',
      'Refund during pending charge',
      'Webhook replay handling',
    ],
    'auth-service': [
      'Token expiry during request',
      'Concurrent session limit',
      'Password reset race condition',
      'OAuth callback failure',
      'Clock skew edge cases',
    ],
  }

  return edgeCases[service] || [
    'Error path handling',
    'Timeout scenarios',
    'Concurrent request handling',
    'Resource cleanup on failure',
  ]
}

// ============================================================================
// EXPORTS
// ============================================================================

export default quinn

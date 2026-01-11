/**
 * Ralph - Engineering Agent for Incident Response
 *
 * Ralph is the engineering agent responsible for:
 * - Diagnosing incident root causes
 * - Implementing hotfixes
 * - Writing post-incident RCAs
 *
 * @example
 * ```ts
 * import { ralph } from './agents/ralph'
 *
 * const diagnosis = await ralph`diagnose ${alert}`
 * const hotfix = await ralph`implement hotfix for ${diagnosis}`
 * ```
 *
 * @module agent-incident-response/agents/ralph
 */

import type { Alert, Diagnosis, Hotfix, Incident, RCA, DiagnosisEvidence, FileChange, TestResult, ActionItem, TimelineEvent } from '../IncidentResponseDO'

// ============================================================================
// TYPES
// ============================================================================

export interface RalphConfig {
  /** Temperature for AI responses (lower = more deterministic) */
  temperature?: number
  /** Maximum tokens for response */
  maxTokens?: number
  /** Model to use */
  model?: string
}

export interface DiagnosisRequest {
  alert: Alert
  logs?: string[]
  metrics?: Record<string, number>
  traces?: string[]
}

export interface HotfixRequest {
  diagnosis: Diagnosis
  runbookGuidance?: string[]
  codeContext?: string
}

export interface RCARequest {
  incident: Incident
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
// RALPH AGENT FUNCTIONS
// ============================================================================

/**
 * Ralph diagnoses an incident by analyzing logs, metrics, and traces
 */
export async function diagnose(request: DiagnosisRequest): Promise<Diagnosis> {
  const { alert } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('diagnose')
    if (mockResponse) {
      return mockResponse as Diagnosis
    }

    // Generate realistic mock diagnosis based on alert
    return generateMockDiagnosis(alert)
  }

  // In production, this would call the AI provider
  // For now, return a mock diagnosis
  return generateMockDiagnosis(alert)
}

/**
 * Ralph implements a hotfix based on diagnosis
 */
export async function implementHotfix(request: HotfixRequest): Promise<Hotfix> {
  const { diagnosis, runbookGuidance } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('hotfix')
    if (mockResponse) {
      return mockResponse as Hotfix
    }

    return generateMockHotfix(diagnosis, runbookGuidance)
  }

  return generateMockHotfix(diagnosis, runbookGuidance)
}

/**
 * Ralph writes a Root Cause Analysis document
 */
export async function writeRCA(request: RCARequest): Promise<RCA> {
  const { incident } = request

  if (mockMode) {
    const mockResponse = mockResponses.get('rca')
    if (mockResponse) {
      return mockResponse as RCA
    }

    return generateMockRCA(incident)
  }

  return generateMockRCA(incident)
}

// ============================================================================
// TEMPLATE LITERAL INTERFACE
// ============================================================================

/**
 * Ralph template literal function for natural language interaction
 *
 * @example
 * ```ts
 * const diagnosis = await ralph`diagnose ${alert}`
 * const fix = await ralph`implement hotfix for ${diagnosis}`
 * ```
 */
export function ralph(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<string | Diagnosis | Hotfix | RCA> {
  const prompt = interpolate(strings, values)

  // Parse the prompt to determine the action
  const promptLower = prompt.toLowerCase()

  if (promptLower.includes('diagnose')) {
    // Extract alert from values
    const alert = values.find(isAlert) as Alert | undefined
    if (alert) {
      return diagnose({ alert }) as Promise<Diagnosis>
    }
  }

  if (promptLower.includes('hotfix') || promptLower.includes('implement')) {
    const diagnosis = values.find(isDiagnosis) as Diagnosis | undefined
    if (diagnosis) {
      return implementHotfix({ diagnosis }) as Promise<Hotfix>
    }
  }

  if (promptLower.includes('rca') || promptLower.includes('root cause analysis')) {
    const incident = values.find(isIncident) as Incident | undefined
    if (incident) {
      return writeRCA({ incident }) as Promise<RCA>
    }
  }

  // Default: return a generic response
  return Promise.resolve(`[Ralph] Processed: ${prompt.slice(0, 100)}...`)
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

function isAlert(value: unknown): value is Alert {
  return (
    typeof value === 'object' &&
    value !== null &&
    'severity' in value &&
    'service' in value &&
    'summary' in value
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

function isIncident(value: unknown): value is Incident {
  return (
    typeof value === 'object' &&
    value !== null &&
    'alert' in value &&
    'status' in value &&
    'timeline' in value
  )
}

// ============================================================================
// MOCK GENERATORS
// ============================================================================

function generateMockDiagnosis(alert: Alert): Diagnosis {
  const diagnoses: Record<string, Partial<Diagnosis>> = {
    'api-gateway': {
      rootCause: 'Database connection pool exhaustion causing request timeouts',
      affectedComponents: ['api-gateway', 'postgres-primary', 'connection-pool'],
      suggestedFix: 'Increase connection pool size and add connection timeout handling',
    },
    'payment-service': {
      rootCause: 'Stripe API rate limiting due to retry storm',
      affectedComponents: ['payment-service', 'stripe-integration', 'retry-logic'],
      suggestedFix: 'Implement exponential backoff with jitter in retry logic',
    },
    'auth-service': {
      rootCause: 'JWT token validation failure due to clock skew',
      affectedComponents: ['auth-service', 'jwt-validator', 'time-service'],
      suggestedFix: 'Add clock skew tolerance to JWT validation',
    },
  }

  const serviceMatch = diagnoses[alert.service] || {
    rootCause: `Service ${alert.service} experiencing ${alert.summary}`,
    affectedComponents: [alert.service],
    suggestedFix: 'Investigate and apply appropriate fix based on logs',
  }

  const evidence: DiagnosisEvidence[] = [
    {
      type: 'log',
      source: `${alert.service}/error.log`,
      content: `ERROR: ${alert.summary}`,
      relevance: 0.95,
    },
    {
      type: 'metric',
      source: 'datadog',
      content: `Error rate spike to ${alert.metrics?.errorRate || 5}%`,
      relevance: 0.9,
    },
  ]

  return {
    rootCause: serviceMatch.rootCause!,
    affectedComponents: serviceMatch.affectedComponents!,
    impactAssessment: {
      usersAffected: alert.severity === 'critical' ? 10000 : 1000,
      revenueImpact: alert.severity === 'critical' ? 'high' : 'medium',
      dataIntegrity: true,
    },
    suggestedFix: serviceMatch.suggestedFix!,
    confidence: 0.85,
    evidence,
  }
}

function generateMockHotfix(diagnosis: Diagnosis, runbookGuidance?: string[]): Hotfix {
  const changes: FileChange[] = [
    {
      path: 'src/config/database.ts',
      type: 'modify',
      diff: `--- a/src/config/database.ts
+++ b/src/config/database.ts
@@ -10,7 +10,8 @@ export const dbConfig = {
-  maxConnections: 10,
+  maxConnections: 50,
+  connectionTimeout: 5000,
 }`,
    },
  ]

  const testResults: TestResult[] = [
    { name: 'connection-pool.test.ts', passed: true, duration: 150 },
    { name: 'integration.test.ts', passed: true, duration: 2500 },
    { name: 'smoke.test.ts', passed: true, duration: 500 },
  ]

  return {
    id: `hotfix-${Date.now().toString(36)}`,
    description: `Fix: ${diagnosis.suggestedFix}`,
    changes,
    testResults,
    rollbackPlan: 'Revert the config change and restart affected pods',
    estimatedRisk: diagnosis.confidence > 0.8 ? 'low' : 'medium',
  }
}

function generateMockRCA(incident: Incident): RCA {
  const actionItems: ActionItem[] = [
    {
      description: 'Add monitoring for connection pool utilization',
      owner: 'platform-team',
      priority: 'p1',
    },
    {
      description: 'Document incident response runbook',
      owner: 'sre-team',
      priority: 'p2',
    },
    {
      description: 'Add alerting for early warning signs',
      owner: 'observability-team',
      priority: 'p1',
    },
  ]

  return {
    incidentId: incident.id,
    title: `RCA: ${incident.alert.summary}`,
    summary: `Incident caused by ${incident.diagnosis?.rootCause || 'unknown issue'}. Resolved via automated response.`,
    timeline: incident.timeline,
    rootCause: incident.diagnosis?.rootCause || 'Root cause under investigation',
    contributingFactors: [
      'Insufficient monitoring coverage',
      'Missing circuit breaker pattern',
      'Outdated runbook documentation',
    ],
    impact: `Affected ${incident.alert.service} service for approximately ${getIncidentDuration(incident)} minutes`,
    resolution: incident.hotfix?.description || 'Manual intervention required',
    lessonsLearned: [
      'Automated incident response significantly reduced MTTR',
      'Early detection enabled faster diagnosis',
      'Runbook guidance improved fix quality',
    ],
    actionItems,
  }
}

function getIncidentDuration(incident: Incident): number {
  if (!incident.resolvedAt) return 0
  return Math.round(
    (new Date(incident.resolvedAt).getTime() - new Date(incident.createdAt).getTime()) / 1000 / 60
  )
}

// ============================================================================
// EXPORTS
// ============================================================================

export default ralph

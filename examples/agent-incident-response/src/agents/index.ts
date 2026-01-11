/**
 * Agent Exports for Incident Response
 *
 * Exports Ralph (Engineering), Tom (Tech Lead), and Quinn (QA) agents
 * for AI-powered incident response.
 *
 * @example
 * ```ts
 * import { ralph, tom, quinn } from './agents'
 *
 * const diagnosis = await ralph`diagnose ${alert}`
 * const hotfix = await ralph`implement hotfix for ${diagnosis}`
 * const review = await tom`emergency review ${hotfix}`
 *
 * if (review.approved) {
 *   await deploy(hotfix)
 *   const validation = await quinn`validate ${hotfix} for ${alert}`
 *   if (validation.passed) {
 *     console.log('Incident resolved!')
 *   }
 * }
 * ```
 *
 * @module agent-incident-response/agents
 */

// Ralph - Engineering Agent
export {
  ralph,
  diagnose,
  implementHotfix,
  writeRCA,
  enableMockMode as enableRalphMockMode,
  disableMockMode as disableRalphMockMode,
  setMockResponse as setRalphMockResponse,
  isMockMode as isRalphMockMode,
  type RalphConfig,
  type DiagnosisRequest,
  type HotfixRequest,
  type RCARequest,
} from './ralph'

// Tom - Tech Lead Agent
export {
  tom,
  emergencyReview,
  approve,
  assessRisk,
  enableMockMode as enableTomMockMode,
  disableMockMode as disableTomMockMode,
  setMockResponse as setTomMockResponse,
  isMockMode as isTomMockMode,
  type TomConfig,
  type ReviewRequest,
  type ApprovalDecision,
  type RiskAssessment,
} from './tom'

// Quinn - QA Agent
export {
  quinn,
  validateFix,
  analyzeTestCoverage,
  analyzeEdgeCases,
  enableMockMode as enableQuinnMockMode,
  disableMockMode as disableQuinnMockMode,
  setMockResponse as setQuinnMockResponse,
  isMockMode as isQuinnMockMode,
  type QuinnConfig,
  type ValidationRequest,
  type TestCoverage,
  type EdgeCaseAnalysis,
} from './quinn'

// Convenience function to enable mock mode for all agents
export function enableMockMode(): void {
  const { enableMockMode: enableRalph } = require('./ralph')
  const { enableMockMode: enableTom } = require('./tom')
  const { enableMockMode: enableQuinn } = require('./quinn')
  enableRalph()
  enableTom()
  enableQuinn()
}

// Convenience function to disable mock mode for all agents
export function disableMockMode(): void {
  const { disableMockMode: disableRalph } = require('./ralph')
  const { disableMockMode: disableTom } = require('./tom')
  const { disableMockMode: disableQuinn } = require('./quinn')
  disableRalph()
  disableTom()
  disableQuinn()
}

/**
 * Agent Exports for Product Discovery
 *
 * Exports Priya (Product) and Quinn (QA) agents
 * for AI-powered product discovery and spec validation.
 *
 * @example
 * ```ts
 * import { priya, quinn } from './agents'
 *
 * const mvp = await priya`define MVP for ${hypothesis}`
 * const stories = await priya`break ${mvp} into user stories`
 * const prioritized = await priya`prioritize ${stories} by impact`
 *
 * const validated = await Promise.all(
 *   prioritized.stories.map(story =>
 *     quinn`validate ${story} is testable`
 *   )
 * )
 *
 * const roadmap = await priya`create quarterly roadmap from ${validated}`
 * ```
 *
 * @module agent-product-discovery/agents
 */

// Priya - Product Agent
export {
  priya,
  defineMVP,
  generateStories,
  prioritizeBacklog,
  createRoadmap,
  conductUserResearch,
  prioritizeWithRICE,
  prioritizeWithMoSCoW,
  enableMockMode as enablePriyaMockMode,
  disableMockMode as disablePriyaMockMode,
  setMockResponse as setPriyaMockResponse,
  isMockMode as isPriyaMockMode,
  type PriyaConfig,
  type MVPRequest,
  type UserStoryRequest,
  type PrioritizationRequest,
  type RoadmapRequest,
  type UserResearchContext,
  type UserInterview,
  type FeaturePrioritization,
  type RICEScore,
  type MoSCoWCategory,
} from './priya'

// Quinn - QA Agent
export {
  quinn,
  validateSpec,
  reviewCriteria,
  suggestImprovements,
  validateBatch,
  enableMockMode as enableQuinnMockMode,
  disableMockMode as disableQuinnMockMode,
  setMockResponse as setQuinnMockResponse,
  isMockMode as isQuinnMockMode,
  type QuinnConfig,
  type ValidationRequest,
  type SpecReviewResult,
  type CriteriaAnalysis,
} from './quinn'

// Convenience function to enable mock mode for all agents
export function enableMockMode(): void {
  const { enableMockMode: enablePriya } = require('./priya')
  const { enableMockMode: enableQuinn } = require('./quinn')
  enablePriya()
  enableQuinn()
}

// Convenience function to disable mock mode for all agents
export function disableMockMode(): void {
  const { disableMockMode: disablePriya } = require('./priya')
  const { disableMockMode: disableQuinn } = require('./quinn')
  disablePriya()
  disableQuinn()
}

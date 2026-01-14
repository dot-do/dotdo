/**
 * Named Agents
 *
 * Pre-configured AI agents with specific personas and capabilities
 * for the Business-as-Code framework.
 *
 * | Agent | Role |
 * |-------|------|
 * | Priya | Product - specs, roadmaps |
 * | Ralph | Engineering - builds code |
 * | Tom   | Tech Lead - architecture, review |
 * | Mark  | Marketing - content, launches |
 * | Sally | Sales - outreach, closing |
 * | Quinn | QA - testing, quality |
 * | Rae   | Frontend - React, components, design systems |
 * | Casey | Customer Success - onboarding, retention |
 * | Finn  | Finance - budgets, forecasting, analysis |
 * | Dana  | Data - analytics, metrics, data-driven insights |
 *
 * @example
 * ```ts
 * import { priya, ralph, tom, rae, finn } from 'agents.do'
 *
 * const spec = await priya`define the MVP for ${hypothesis}`
 * let app = await ralph`build ${spec}`
 * let ui = await rae`create the dashboard UI`
 * let budget = await finn`estimate budget for ${spec}`
 *
 * do {
 *   app = await ralph`improve ${app} per ${tom}`
 * } while (!(await tom.approve(app)).approved)
 * ```
 *
 * @module agents/named
 */

// ============================================================================
// Named Agents (from factory)
// ============================================================================

export {
  priya,
  ralph,
  tom,
  mark,
  sally,
  quinn,
  rae,
  casey,
  finn,
  dana,
  createNamedAgent,
  enableMockMode,
  disableMockMode,
  setMockResponse,
  isMockMode,
  PERSONAS,
  type NamedAgent,
  type AgentPersona,
  type AgentRole,
  type AgentConfig,
  type TypedTemplateLiteral,
  type TypedInvokeOptions,
} from './factory'

// ============================================================================
// Typed Agent Results
// ============================================================================

export {
  // Types
  type AgentResult,
  type AgentResultMeta,
  type ToolCallRecord,
  type AgentSchemaRegistry,
  type AgentTaskResult,
  // Schema registration
  defineAgentSchema,
  getAgentSchema,
  hasAgentSchema,
  // Common schemas
  SpecSchema,
  ReviewSchema,
  ImplementationSchema,
  TestResultSchema,
  ContentSchema,
  FinancialAnalysisSchema,
  DataAnalysisSchema,
  // Schema types
  type Spec,
  type Review,
  type Implementation,
  type TestResult,
  type Content,
  type FinancialAnalysis,
  type DataAnalysis,
  // Utilities
  parseAgentResult,
  createTypedInvoke,
  createTypedTemplateLiteral,
  zodToPromptSchema,
  generateSchemaPrompt,
} from '../typed-result'

// ============================================================================
// Composable Persona System (from personas)
// ============================================================================

export {
  PersonaBuilder,
  persona,
  TRAITS,
  ROLE_DEFINITIONS,
  PERSONA_DEFINITIONS,
  type Trait,
  type RoleDefinition,
  type PersonaBuilderOptions,
} from './personas'

// Default export for convenience
export { ralph as default } from './factory'

// ============================================================================
// Legacy Ralph exports (for backwards compatibility)
// ============================================================================

export {
  RalphAgent,
  createRalph,
  RALPH_SYSTEM_PROMPT,
  type RalphConfig,
  type RalphTemplateLiteralOptions,
  type CreateRalphOptions,
} from './ralph'

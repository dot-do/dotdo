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
 *
 * @example
 * ```ts
 * import { priya, ralph, tom } from 'agents.do'
 *
 * const spec = await priya`define the MVP for ${hypothesis}`
 * let app = await ralph`build ${spec}`
 *
 * do {
 *   app = await ralph`improve ${app} per ${tom}`
 * } while (!await tom.approve(app))
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
} from './factory'

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

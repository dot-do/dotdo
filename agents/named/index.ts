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
 * import { ralph } from 'agents.do'
 *
 * const app = await ralph`build ${spec}`
 * ```
 *
 * @module agents/named
 */

// ============================================================================
// Ralph - Engineering Agent
// ============================================================================

export {
  ralph,
  RalphAgent,
  createRalph,
  RALPH_SYSTEM_PROMPT,
  type RalphConfig,
  type RalphTemplateLiteralOptions,
  type CreateRalphOptions,
} from './ralph'

// Default export for convenience
export { ralph as default } from './ralph'

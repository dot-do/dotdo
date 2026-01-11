/**
 * Agent Launch Campaign - Named Agents
 *
 * Mark (Marketing) and Sally (Sales) work together to execute
 * your entire product launch.
 *
 * @example
 * ```ts
 * import { mark, sally, createMark, createSally } from './agents'
 *
 * // Default agents (mock responses)
 * const narrative = await mark`write launch story for ${product}`
 * const email = await sally`write personalized email to ${lead}`
 *
 * // With AI (production)
 * const markAI = createMark(env.AI)
 * const sallyAI = createSally(env.AI)
 * ```
 *
 * @module agent-launch-campaign/agents
 */

// Mark - Marketing Agent
export {
  mark,
  createMark,
  MARK_SYSTEM_PROMPT,
  type MarkAgent,
} from './mark'

// Sally - Sales Agent
export {
  sally,
  createSally,
  SALLY_SYSTEM_PROMPT,
  type SallyAgent,
} from './sally'

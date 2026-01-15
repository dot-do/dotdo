/**
 * @module @dotdo/digital-workers
 *
 * Digital Workers package providing types, schemas, and type guards
 * for Worker, Agent, and Human entities.
 *
 * @example
 * ```typescript
 * import type { Worker, Agent, Human } from '@dotdo/digital-workers'
 * import { isAgent, AgentSchema } from '@dotdo/digital-workers'
 *
 * // Type-safe agent creation
 * const agent: Agent = {
 *   $id: 'https://schema.org.ai/agents/a1',
 *   $type: 'https://schema.org.ai/Agent',
 *   name: 'Code Review Agent',
 *   skills: ['code-review'],
 *   status: 'available',
 *   model: 'claude-3-opus',
 *   tools: ['read', 'write'],
 *   autonomous: true
 * }
 *
 * // Runtime validation
 * if (isAgent(unknownData)) {
 *   console.log(unknownData.model)
 * }
 * ```
 */

// Types
export type { Worker, Agent, Human } from './types'

// Schemas
export { WorkerSchema, AgentSchema, HumanSchema } from './types'

// Type guards
export { isWorker, isAgent, isHuman } from './types'

// Factory functions
export { createWorker, createAgent, createHuman } from './types'

// Re-export everything for convenience
export * from './types'

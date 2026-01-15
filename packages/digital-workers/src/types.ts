import { z } from 'zod'

/**
 * Worker - Base interface for work performers
 *
 * Workers are the fundamental unit of work execution in the digital-workers system.
 * They can be either AI agents or human workers, and track availability status.
 *
 * @see https://schema.org.ai/Worker
 *
 * @example
 * ```typescript
 * const worker: Worker = {
 *   $id: 'https://schema.org.ai/workers/w1',
 *   $type: 'https://schema.org.ai/Worker',
 *   name: 'Task Executor',
 *   skills: ['data-processing', 'reporting'],
 *   status: 'available'
 * }
 * ```
 */
export interface Worker {
  /** Unique identifier URI for the worker */
  $id: string
  /** JSON-LD type discriminator */
  $type: 'https://schema.org.ai/Worker'
  /** Display name of the worker */
  name: string
  /** List of skills/capabilities the worker possesses */
  skills: string[]
  /** Current availability status */
  status: 'available' | 'busy' | 'away' | 'offline'
}

/**
 * Agent - AI autonomous worker that can perform tasks independently
 *
 * Agents extend Worker with AI-specific properties including the model used,
 * available tools, and whether they can operate autonomously without human oversight.
 *
 * @see https://schema.org.ai/Agent
 *
 * @example
 * ```typescript
 * const agent: Agent = {
 *   $id: 'https://schema.org.ai/agents/a1',
 *   $type: 'https://schema.org.ai/Agent',
 *   name: 'Code Review Agent',
 *   skills: ['code-review', 'testing'],
 *   status: 'available',
 *   model: 'claude-3-opus',
 *   tools: ['read', 'write', 'bash'],
 *   autonomous: true
 * }
 * ```
 */
export interface Agent extends Omit<Worker, '$type'> {
  /** JSON-LD type discriminator for Agent */
  $type: 'https://schema.org.ai/Agent'
  /** AI model identifier (e.g., 'claude-3-opus', 'gpt-4') */
  model: string
  /** List of tools the agent can use */
  tools: string[]
  /** Whether the agent can operate without human approval */
  autonomous: boolean
}

/**
 * Human - Human worker that may require approval for actions
 *
 * Humans extend Worker with properties for managing human-in-the-loop workflows,
 * including approval requirements and notification preferences.
 *
 * @see https://schema.org.ai/Human
 *
 * @example
 * ```typescript
 * const human: Human = {
 *   $id: 'https://schema.org.ai/humans/h1',
 *   $type: 'https://schema.org.ai/Human',
 *   name: 'Alice',
 *   skills: ['design', 'review'],
 *   status: 'available',
 *   requiresApproval: true,
 *   notificationChannels: ['email', 'slack']
 * }
 * ```
 */
export interface Human extends Omit<Worker, '$type'> {
  /** JSON-LD type discriminator for Human */
  $type: 'https://schema.org.ai/Human'
  /** Whether actions require approval from this human */
  requiresApproval: boolean
  /** Channels for sending notifications (e.g., 'email', 'slack', 'sms') */
  notificationChannels: string[]
}

/**
 * Zod schema for validating Worker objects
 * @see {@link Worker}
 */
export const WorkerSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Worker'),
  name: z.string(),
  skills: z.array(z.string()),
  status: z.enum(['available', 'busy', 'away', 'offline'])
})

/**
 * Zod schema for validating Agent objects
 * @see {@link Agent}
 */
export const AgentSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Agent'),
  name: z.string(),
  skills: z.array(z.string()),
  status: z.enum(['available', 'busy', 'away', 'offline']),
  model: z.string(),
  tools: z.array(z.string()),
  autonomous: z.boolean()
})

/**
 * Zod schema for validating Human objects
 * @see {@link Human}
 */
export const HumanSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Human'),
  name: z.string(),
  skills: z.array(z.string()),
  status: z.enum(['available', 'busy', 'away', 'offline']),
  requiresApproval: z.boolean(),
  notificationChannels: z.array(z.string())
})

/**
 * Type guard to check if an object is a valid Worker
 *
 * @param obj - Object to validate
 * @returns True if the object is a valid Worker
 *
 * @example
 * ```typescript
 * if (isWorker(obj)) {
 *   console.log(obj.name) // TypeScript knows obj is Worker
 * }
 * ```
 */
export function isWorker(obj: unknown): obj is Worker {
  return WorkerSchema.safeParse(obj).success
}

/**
 * Type guard to check if an object is a valid Agent
 *
 * @param obj - Object to validate
 * @returns True if the object is a valid Agent
 *
 * @example
 * ```typescript
 * if (isAgent(obj)) {
 *   console.log(obj.model) // TypeScript knows obj is Agent
 * }
 * ```
 */
export function isAgent(obj: unknown): obj is Agent {
  return AgentSchema.safeParse(obj).success
}

/**
 * Type guard to check if an object is a valid Human
 *
 * @param obj - Object to validate
 * @returns True if the object is a valid Human
 *
 * @example
 * ```typescript
 * if (isHuman(obj)) {
 *   console.log(obj.notificationChannels) // TypeScript knows obj is Human
 * }
 * ```
 */
export function isHuman(obj: unknown): obj is Human {
  return HumanSchema.safeParse(obj).success
}

/**
 * Factory function to create a new Worker
 *
 * Automatically sets the `$type` field to the correct schema.org.ai URL.
 *
 * @param input - Worker data without the $type field
 * @returns A complete Worker object with $type set
 *
 * @example
 * ```typescript
 * const worker = createWorker({
 *   $id: 'https://schema.org.ai/workers/w1',
 *   name: 'Task Executor',
 *   skills: ['data-processing'],
 *   status: 'available'
 * })
 * // worker.$type is automatically 'https://schema.org.ai/Worker'
 * ```
 */
export function createWorker(input: Omit<Worker, '$type'>): Worker {
  return { ...input, $type: 'https://schema.org.ai/Worker' }
}

/**
 * Factory function to create a new Agent
 *
 * Automatically sets the `$type` field to the correct schema.org.ai URL.
 *
 * @param input - Agent data without the $type field
 * @returns A complete Agent object with $type set
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   $id: 'https://schema.org.ai/agents/a1',
 *   name: 'Code Review Agent',
 *   skills: ['code-review'],
 *   status: 'available',
 *   model: 'claude-3-opus',
 *   tools: ['read', 'write'],
 *   autonomous: true
 * })
 * // agent.$type is automatically 'https://schema.org.ai/Agent'
 * ```
 */
export function createAgent(input: Omit<Agent, '$type'>): Agent {
  return { ...input, $type: 'https://schema.org.ai/Agent' }
}

/**
 * Factory function to create a new Human
 *
 * Automatically sets the `$type` field to the correct schema.org.ai URL.
 *
 * @param input - Human data without the $type field
 * @returns A complete Human object with $type set
 *
 * @example
 * ```typescript
 * const human = createHuman({
 *   $id: 'https://schema.org.ai/humans/h1',
 *   name: 'Alice',
 *   skills: ['design', 'review'],
 *   status: 'available',
 *   requiresApproval: true,
 *   notificationChannels: ['email', 'slack']
 * })
 * // human.$type is automatically 'https://schema.org.ai/Human'
 * ```
 */
export function createHuman(input: Omit<Human, '$type'>): Human {
  return { ...input, $type: 'https://schema.org.ai/Human' }
}

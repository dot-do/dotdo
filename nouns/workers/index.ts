/**
 * Workers Domain Nouns
 *
 * Types for work performers in the digital-workers system:
 * - Worker: Base interface for all work performers
 * - Agent: AI autonomous worker
 * - Human: Human worker with approval workflows
 * - Team: Group of workers that collaborate
 *
 * @packageDocumentation
 */

// Worker - Base type
export { Worker, WorkerSchema, isWorker } from './Worker'
export type { Worker as WorkerType } from './Worker'

// Agent - AI worker
export { Agent, AgentSchema, isAgent } from './Agent'
export type { Agent as AgentType } from './Agent'

// Human - Human worker
export { Human, HumanSchema, isHuman } from './Human'
export type { Human as HumanType } from './Human'

// Team - Worker group
export { Team, TeamSchema, isTeam } from './Team'
export type { Team as TeamType } from './Team'

/**
 * Workers domain Durable Objects
 *
 * This module exports the worker hierarchy for work-performing entities:
 * - Worker: Base class for all work-performing entities
 * - Agent: AI-powered autonomous worker with tools and memory
 * - Human: Human worker with approval flows and notifications
 */

export { Worker } from './Worker'
export type {
  WorkerMode,
  Task,
  TaskResult,
  Context,
  Answer,
  Option,
  Decision,
  ApprovalRequest,
  ApprovalResult,
  Channel,
} from './Worker'

export { Agent } from './Agent'
export type { Tool, Goal, GoalResult, Memory } from './Agent'

export { Human } from './Human'
export type {
  NotificationChannel,
  EscalationRule,
  EscalationPolicy,
  PendingApproval,
  BlockingApprovalRequest,
} from './Human'

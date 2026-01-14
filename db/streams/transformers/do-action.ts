/**
 * DO Action to Unified Event Transformer
 *
 * Transforms Durable Object action records into the unified event schema
 * for consistent observability across the platform.
 *
 * @module db/streams/transformers/do-action
 */

import { createUnifiedEvent, type UnifiedEvent } from '../../../types/unified-event'

/**
 * Input action shape for transformation.
 * Based on the db/actions.ts schema but with optional fields
 * for flexibility in transformation.
 */
export interface ActionInput {
  /** Unique action identifier (UUID) */
  id: string
  /** Action verb (create, update, delete, etc.) */
  verb: string
  /** Actor path (e.g., 'Human/nathan', 'Agent/support') */
  actor?: string
  /** Target path (e.g., 'Startup/acme') */
  target?: string
  /** Input version (things.rowid before action) */
  inputVersion?: number
  /** Output version (things.rowid after action) */
  outputVersion?: number
  /** Durability level */
  durability: 'send' | 'try' | 'do'
  /** Action status - only terminal states should be transformed */
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  /** Error information (string or object) */
  error?: string | Record<string, unknown>
  /** Request correlation ID */
  requestId?: string
  /** User session ID */
  sessionId?: string
  /** Workflow execution ID */
  workflowId?: string
  /** When the action started */
  startedAt?: Date
  /** When the action completed */
  completedAt?: Date
  /** Pre-calculated duration in milliseconds */
  durationMs?: number
}

/**
 * Terminal action statuses that can be transformed to events
 */
const TERMINAL_STATUSES = ['completed', 'failed'] as const
type TerminalStatus = (typeof TERMINAL_STATUSES)[number]

/**
 * Maps action status to unified event outcome
 */
function mapStatusToOutcome(status: TerminalStatus): string {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
  }
}

/**
 * Extracts resource type from a target path.
 * Target paths follow the pattern: Type/id or Type/id/SubType/subId
 *
 * @param target - Target path like 'Customer/cust_123'
 * @returns The resource type (first path segment) or null
 */
function extractResourceType(target: string | undefined): string | null {
  if (!target) return null
  const firstSlash = target.indexOf('/')
  if (firstSlash === -1) return target
  return target.substring(0, firstSlash)
}

/**
 * Formats error to string for error_message field.
 * Handles both string errors and error objects.
 */
function formatError(error: string | Record<string, unknown> | undefined): string | null {
  if (error === undefined) return null
  if (typeof error === 'string') return error
  return JSON.stringify(error)
}

/**
 * Calculates duration in milliseconds from start and end timestamps.
 * Returns null if either timestamp is missing.
 */
function calculateDuration(
  startedAt: Date | undefined,
  completedAt: Date | undefined,
  fallbackDurationMs: number | undefined
): number | null {
  if (startedAt && completedAt) {
    return completedAt.getTime() - startedAt.getTime()
  }
  return fallbackDurationMs ?? null
}

/**
 * Transforms a DO action into a UnifiedEvent.
 *
 * Only terminal action states (completed, failed) should be transformed.
 * Pending or in-progress actions are not suitable for the unified event stream.
 *
 * Field mappings:
 * - id → span_id, id (event identity)
 * - verb → action_verb, event_name (as "action.{verb}")
 * - actor → actor_id
 * - target → action_target, resource_id
 * - target (parsed) → resource_type
 * - inputVersion → action_input_version
 * - durability → action_durability
 * - status → outcome (completed→success, failed→error)
 * - error → error_message
 * - requestId → correlation_id
 * - sessionId → session_id
 * - workflowId → workflow_id
 * - startedAt → started_at
 * - completedAt → ended_at
 * - calculated/durationMs → duration_ms
 *
 * @param action - The action record to transform
 * @param ns - The namespace URL for the event
 * @returns A UnifiedEvent representing the action
 * @throws Error if action is not in a terminal state
 *
 * @example
 * ```typescript
 * const action = {
 *   id: 'act_123',
 *   verb: 'create',
 *   actor: 'Human/nathan',
 *   target: 'Customer/cust_456',
 *   durability: 'do',
 *   status: 'completed',
 *   startedAt: new Date('2024-01-15T10:00:00Z'),
 *   completedAt: new Date('2024-01-15T10:00:01Z'),
 * }
 *
 * const event = transformDoAction(action, 'tenant.api.dotdo.dev')
 * // event.event_type === 'trace'
 * // event.event_name === 'action.create'
 * // event.outcome === 'success'
 * // event.duration_ms === 1000
 * ```
 */
export function transformDoAction(action: ActionInput, ns: string): UnifiedEvent {
  // Validate terminal state
  if (!TERMINAL_STATUSES.includes(action.status as TerminalStatus)) {
    throw new Error('Only terminal action states should be transformed')
  }

  const status = action.status as TerminalStatus

  return createUnifiedEvent({
    // Core Identity (required)
    id: action.id,
    event_type: 'trace',
    event_name: `action.${action.verb}`,
    ns,

    // Causality Chain
    span_id: action.id,
    session_id: action.sessionId ?? null,
    workflow_id: action.workflowId ?? null,
    correlation_id: action.requestId ?? null,

    // Actor
    actor_id: action.actor ?? null,

    // Resource
    resource_type: extractResourceType(action.target),
    resource_id: action.target ?? null,

    // Timing
    started_at: action.startedAt?.toISOString() ?? null,
    ended_at: action.completedAt?.toISOString() ?? null,
    duration_ms: calculateDuration(action.startedAt, action.completedAt, action.durationMs),

    // Outcome
    outcome: mapStatusToOutcome(status),
    error_message: formatError(action.error),

    // DO Specific
    action_verb: action.verb,
    action_durability: action.durability,
    action_target: action.target ?? null,
    action_input_version: action.inputVersion ?? null,

    // Partition/Internal
    event_source: 'do_action',
    schema_version: 1,
  })
}

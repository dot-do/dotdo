/**
 * bashx Exec Table Schema
 *
 * Drizzle ORM schema for tracking shell command executions with safety settings.
 * This table integrates with bashx's safety classification system to persist
 * execution records with their safety analysis, status, timing, and output.
 *
 * Safety Integration:
 * - safetyType: Type of operation (read, write, delete, execute, network, system, mixed)
 * - safetyImpact: Impact level (none, low, medium, high, critical)
 * - safetyReversible: Whether the operation can be undone
 * - safetyReason: Human-readable explanation of the classification
 * - blocked: Whether execution was blocked by safety gate
 * - requiresConfirm: Whether command requires explicit confirmation
 *
 * @module bashx/db/exec
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import type { SafetyClassification, Intent } from '../types.js'

// ============================================================================
// STATUS ENUM
// ============================================================================

/**
 * Valid execution status values.
 * - 'pending': Command queued but not yet started
 * - 'running': Command currently executing
 * - 'completed': Command finished successfully (exitCode 0)
 * - 'failed': Command finished with error (exitCode non-zero)
 * - 'timeout': Command exceeded time limit and was terminated
 * - 'blocked': Command was blocked by safety gate
 */
export const ExecStatus = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timeout: 'timeout',
  blocked: 'blocked',
} as const

export type ExecStatusType = (typeof ExecStatus)[keyof typeof ExecStatus]

// ============================================================================
// SAFETY TYPES
// ============================================================================

/**
 * Valid safety classification types.
 * Matches SafetyClassification.type from bashx types.
 */
export const SafetyType = {
  read: 'read',
  write: 'write',
  delete: 'delete',
  execute: 'execute',
  network: 'network',
  system: 'system',
  mixed: 'mixed',
} as const

export type SafetyTypeValue = (typeof SafetyType)[keyof typeof SafetyType]

/**
 * Valid safety impact levels.
 * Matches SafetyClassification.impact from bashx types.
 */
export const SafetyImpact = {
  none: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
} as const

export type SafetyImpactValue = (typeof SafetyImpact)[keyof typeof SafetyImpact]

// ============================================================================
// EXEC TABLE
// ============================================================================

/**
 * Exec table schema for tracking command executions with safety settings.
 *
 * This extends the standard dotdo exec table with bashx-specific safety fields.
 */
export const exec = sqliteTable(
  'exec',
  {
    // -------------------------------------------------------------------------
    // Primary Key
    // -------------------------------------------------------------------------

    /** Primary key - unique identifier for this execution */
    id: text('id').primaryKey(),

    // -------------------------------------------------------------------------
    // Command Fields
    // -------------------------------------------------------------------------

    /** The command to execute (e.g., 'npm', 'git', 'node') */
    command: text('command').notNull(),

    /** JSON array of command arguments (e.g., ['install', '--save-dev']) */
    args: text('args', { mode: 'json' }).$type<string[] | null>(),

    /** Working directory for command execution */
    cwd: text('cwd'),

    /** JSON object of filtered environment variables (sensitive values excluded) */
    env: text('env', { mode: 'json' }).$type<Record<string, string> | null>(),

    // -------------------------------------------------------------------------
    // Safety Classification Fields (bashx-specific)
    // -------------------------------------------------------------------------

    /** Safety type: read, write, delete, execute, network, system, mixed */
    safetyType: text('safety_type').$type<SafetyTypeValue>(),

    /** Impact level: none, low, medium, high, critical */
    safetyImpact: text('safety_impact').$type<SafetyImpactValue>(),

    /** Whether the operation can be undone */
    safetyReversible: integer('safety_reversible', { mode: 'boolean' }),

    /** Human-readable explanation of the safety classification */
    safetyReason: text('safety_reason'),

    /** Whether execution was blocked by safety gate */
    blocked: integer('blocked', { mode: 'boolean' }).default(false),

    /** Whether command requires explicit confirmation */
    requiresConfirm: integer('requires_confirm', { mode: 'boolean' }).default(false),

    /** Reason the command was blocked, if applicable */
    blockReason: text('block_reason'),

    // -------------------------------------------------------------------------
    // Intent Fields (bashx-specific)
    // -------------------------------------------------------------------------

    /** JSON object of extracted intent from command */
    intent: text('intent', { mode: 'json' }).$type<Intent | null>(),

    // -------------------------------------------------------------------------
    // Execution Results
    // -------------------------------------------------------------------------

    /** Exit code from the command (0 = success, non-zero = error, null = not finished/timeout) */
    exitCode: integer('exit_code'),

    /** Standard output captured from the command (may be truncated for large output) */
    stdout: text('stdout'),

    /** Standard error captured from the command */
    stderr: text('stderr'),

    /** Undo script to reverse the effects of this command */
    undo: text('undo'),

    // -------------------------------------------------------------------------
    // Timing Fields
    // -------------------------------------------------------------------------

    /** Timestamp when command execution started (Unix milliseconds) */
    startedAt: integer('started_at'),

    /** Timestamp when command execution completed (Unix milliseconds) */
    completedAt: integer('completed_at'),

    /** Duration of execution in milliseconds (completedAt - startedAt) */
    durationMs: integer('duration_ms'),

    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------

    /** Execution status: 'pending', 'running', 'completed', 'failed', 'timeout', 'blocked' */
    status: text('status').notNull().default('pending').$type<ExecStatusType>(),
  },
  (table) => [
    /** Index for filtering by execution status */
    index('exec_status_idx').on(table.status),
    /** Index for looking up by command name */
    index('exec_command_idx').on(table.command),
    /** Index for time-based queries */
    index('exec_started_at_idx').on(table.startedAt),
    /** Index for safety impact level filtering */
    index('exec_safety_impact_idx').on(table.safetyImpact),
    /** Index for blocked commands */
    index('exec_blocked_idx').on(table.blocked),
  ],
)

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * TypeScript type for an exec record inferred from the schema.
 * Use this type when working with exec data in application code.
 */
export type Exec = typeof exec.$inferSelect

/**
 * TypeScript type for inserting a new exec record.
 * Use this type when creating new exec records.
 */
export type NewExec = typeof exec.$inferInsert

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert a SafetyClassification to exec table fields.
 *
 * @param classification - The safety classification to convert
 * @returns Object with exec table field values
 *
 * @example
 * ```typescript
 * const classification = analyze(ast).classification
 * const fields = classificationToExecFields(classification)
 * await db.insert(exec).values({
 *   id: 'exec-123',
 *   command: 'rm -rf temp',
 *   ...fields,
 * })
 * ```
 */
export function classificationToExecFields(classification: SafetyClassification): {
  safetyType: SafetyTypeValue
  safetyImpact: SafetyImpactValue
  safetyReversible: boolean
  safetyReason: string
} {
  return {
    safetyType: classification.type,
    safetyImpact: classification.impact,
    safetyReversible: classification.reversible,
    safetyReason: classification.reason,
  }
}

/**
 * Convert exec table fields back to a SafetyClassification.
 *
 * @param record - The exec record (or partial with safety fields)
 * @returns SafetyClassification object
 *
 * @example
 * ```typescript
 * const record = await db.select().from(exec).where(eq(exec.id, 'exec-123'))
 * const classification = execFieldsToClassification(record[0])
 * console.log(classification.impact) // 'critical'
 * ```
 */
export function execFieldsToClassification(
  record: Pick<Exec, 'safetyType' | 'safetyImpact' | 'safetyReversible' | 'safetyReason'>,
): SafetyClassification {
  return {
    type: record.safetyType ?? 'read',
    impact: record.safetyImpact ?? 'none',
    reversible: record.safetyReversible ?? true,
    reason: record.safetyReason ?? '',
  }
}

/**
 * Check if a command should be blocked based on safety settings.
 *
 * @param classification - The safety classification to check
 * @param confirm - Whether the user has provided confirmation
 * @returns Object indicating if blocked and why
 *
 * @example
 * ```typescript
 * const result = shouldBlock(classification, false)
 * if (result.blocked) {
 *   console.log('Blocked:', result.reason)
 * }
 * ```
 */
export function shouldBlock(
  classification: SafetyClassification,
  confirm: boolean = false,
): { blocked: boolean; reason?: string; requiresConfirm: boolean } {
  // Critical operations are always blocked without confirmation
  if (classification.impact === 'critical') {
    if (!confirm) {
      return {
        blocked: true,
        reason: `Critical operation blocked: ${classification.reason}`,
        requiresConfirm: true,
      }
    }
  }

  // High impact operations require confirmation
  if (classification.impact === 'high') {
    if (!confirm) {
      return {
        blocked: true,
        reason: `High-impact operation requires confirmation: ${classification.reason}`,
        requiresConfirm: true,
      }
    }
  }

  // Not blocked
  return { blocked: false, requiresConfirm: false }
}

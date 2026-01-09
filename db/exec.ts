import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// ============================================================================
// EXEC - Tracks shell command executions
// ============================================================================
//
// Records shell command executions with their arguments, working directory,
// environment, output, timing, and status. This is a standalone table with
// no foreign key relationships - it serves as a simple execution log.
//
// Status lifecycle:
//   pending → running → completed (exitCode 0)
//                    → failed (exitCode non-zero)
//                    → timeout (exceeded time limit)
//
// ============================================================================

/**
 * Valid execution status values.
 * - 'pending': Command queued but not yet started
 * - 'running': Command currently executing
 * - 'completed': Command finished successfully (exitCode 0)
 * - 'failed': Command finished with error (exitCode non-zero)
 * - 'timeout': Command exceeded time limit and was terminated
 */
export const ExecStatus = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timeout: 'timeout',
} as const

export type ExecStatusType = (typeof ExecStatus)[keyof typeof ExecStatus]

export const exec = sqliteTable(
  'exec',
  {
    /** Primary key - unique identifier for this execution */
    id: text('id').primaryKey(),

    /** The command to execute (e.g., 'npm', 'git', 'node') */
    command: text('command').notNull(),

    /** JSON array of command arguments (e.g., ['install', '--save-dev']) */
    args: text('args', { mode: 'json' }).$type<string[] | null>(),

    /** Working directory for command execution */
    cwd: text('cwd'),

    /** JSON object of filtered environment variables (sensitive values excluded) */
    env: text('env', { mode: 'json' }).$type<Record<string, string> | null>(),

    /** Exit code from the command (0 = success, non-zero = error, null = not finished/timeout) */
    exitCode: integer('exit_code'),

    /** Standard output captured from the command (may be truncated for large output) */
    stdout: text('stdout'),

    /** Standard error captured from the command */
    stderr: text('stderr'),

    /** Timestamp when command execution started (Unix milliseconds) */
    startedAt: integer('started_at'),

    /** Timestamp when command execution completed (Unix milliseconds) */
    completedAt: integer('completed_at'),

    /** Duration of execution in milliseconds (completedAt - startedAt) */
    durationMs: integer('duration_ms'),

    /** Execution status: 'pending', 'running', 'completed', 'failed', 'timeout' */
    status: text('status').notNull().default('pending').$type<ExecStatusType>(),
  },
  (table) => [
    /** Index for filtering by execution status */
    index('exec_status_idx').on(table.status),
    /** Index for looking up by command name */
    index('exec_command_idx').on(table.command),
    /** Index for time-based queries */
    index('exec_started_at_idx').on(table.startedAt),
  ],
)

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

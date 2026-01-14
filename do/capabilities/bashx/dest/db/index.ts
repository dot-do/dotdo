/**
 * bashx Database Schema Exports
 *
 * This module exports all database schemas for the bashx package.
 * The primary schema is the exec table which tracks command executions
 * with safety settings.
 *
 * @module bashx/db
 *
 * @example
 * ```typescript
 * import { exec, type Exec, ExecStatus, shouldBlock } from 'bashx/db'
 *
 * // Insert a new execution record
 * await db.insert(exec).values({
 *   id: 'exec-123',
 *   command: 'npm',
 *   args: ['install'],
 *   status: ExecStatus.pending,
 * })
 *
 * // Check if command should be blocked
 * const { blocked, reason } = shouldBlock(classification, false)
 * ```
 */

// Export everything from exec module
export {
  // Table
  exec,
  // Types
  type Exec,
  type NewExec,
  type ExecStatusType,
  type SafetyTypeValue,
  type SafetyImpactValue,
  // Constants
  ExecStatus,
  SafetyType,
  SafetyImpact,
  // Helper functions
  classificationToExecFields,
  execFieldsToClassification,
  shouldBlock,
} from './exec.js'

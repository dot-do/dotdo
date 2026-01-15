/**
 * Shared event converter utility
 *
 * This stub will be implemented in the GREEN phase.
 * Currently throws to ensure all tests fail (TDD RED phase).
 *
 * @issue do-ekak - RED: toStoredUnifiedEvent shared utility tests
 */

import type { UnifiedEvent } from '../../../types/unified-event'

// Re-export types
export { type StoredUnifiedEvent } from '../event-store'

// Minimal BroadcastEvent type for legacy support
export interface BroadcastEvent {
  id: string
  type: string
  topic: string
  payload: unknown
  timestamp: number
  [key: string]: unknown
}

/**
 * Converts a BroadcastEvent or UnifiedEvent to StoredUnifiedEvent format.
 *
 * RED PHASE STUB - This function is intentionally unimplemented.
 * The implementation will be added in the GREEN phase.
 */
export function toStoredUnifiedEvent(
  _event: BroadcastEvent | Partial<UnifiedEvent>
): never {
  throw new Error('NOT IMPLEMENTED - TDD RED PHASE')
}

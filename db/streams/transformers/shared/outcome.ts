/**
 * Outcome Mapping Utilities
 *
 * Maps various outcome formats to the unified event schema outcome field.
 */

/**
 * Workers tail event outcome values.
 */
export type TailOutcome =
  | 'ok'
  | 'exception'
  | 'exceededCpu'
  | 'exceededMemory'
  | 'canceled'
  | 'unknown'

/**
 * Unified event outcome values.
 */
export type UnifiedOutcome =
  | 'success'
  | 'error'
  | 'exceeded_cpu'
  | 'exceeded_memory'
  | 'canceled'
  | 'unknown'
  | 'timeout'
  | 'rate_limited'

/**
 * Maps Workers tail outcomes to unified event outcomes.
 *
 * - ok → success (normal completion)
 * - exception → error (uncaught exception)
 * - exceededCpu → exceeded_cpu (CPU time limit reached)
 * - exceededMemory → exceeded_memory (memory limit reached)
 * - canceled → canceled (request was canceled)
 * - unknown → unknown (unknown outcome)
 */
export const TAIL_OUTCOME_MAP: Record<TailOutcome, UnifiedOutcome> = {
  ok: 'success',
  exception: 'error',
  exceededCpu: 'exceeded_cpu',
  exceededMemory: 'exceeded_memory',
  canceled: 'canceled',
  unknown: 'unknown',
}

/**
 * Maps a tail outcome to a unified outcome.
 *
 * @param outcome - The tail event outcome
 * @returns The corresponding unified outcome
 */
export function mapTailOutcome(outcome: TailOutcome): UnifiedOutcome {
  return TAIL_OUTCOME_MAP[outcome] ?? 'unknown'
}

/**
 * Determines if an outcome represents a failure.
 *
 * @param outcome - The unified outcome
 * @returns true if the outcome represents a failure
 */
export function isFailureOutcome(outcome: UnifiedOutcome): boolean {
  return outcome !== 'success'
}

/**
 * Maps HTTP status codes to outcome values.
 *
 * @param status - HTTP status code
 * @returns The corresponding unified outcome
 */
export function outcomeFromHttpStatus(status: number): UnifiedOutcome {
  if (status >= 200 && status < 400) return 'success'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504) return 'timeout'
  return 'error'
}

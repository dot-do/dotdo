/**
 * Tail Worker Sampling Logic
 *
 * Determines which TailItems should be captured for observability purposes.
 *
 * Sampling Rules:
 * - errorRate applies to: outcome !== 'ok', status >= 500, has exceptions
 * - successRate applies to: all other cases
 */

/**
 * Configuration for sampling rates
 */
export interface SampleConfig {
  /** Sampling rate for error conditions (0.0 - 1.0) */
  errorRate: number
  /** Sampling rate for successful requests (0.0 - 1.0) */
  successRate: number
}

/**
 * Minimal TailItem interface for sampling decisions
 */
interface TailItem {
  readonly event:
    | {
        readonly response?: {
          readonly status: number
        }
      }
    | unknown
  readonly exceptions: readonly unknown[]
  readonly outcome: 'ok' | 'exception' | 'exceededCpu' | 'exceededMemory' | 'canceled' | 'unknown'
}

/**
 * Determines if a TailItem should be sampled based on the configuration.
 *
 * @param item - The TailItem to evaluate
 * @param config - Sampling configuration with errorRate and successRate
 * @param random - Optional random function for deterministic testing (defaults to Math.random)
 * @returns true if the item should be sampled, false otherwise
 */
export function shouldSample(
  item: TailItem,
  config: SampleConfig,
  random: () => number = Math.random
): boolean {
  const isError = isErrorCondition(item)
  const rate = isError ? config.errorRate : config.successRate

  // Rate of 1.0 means always sample, rate of 0.0 means never sample
  if (rate >= 1.0) return true
  if (rate <= 0.0) return false

  return random() < rate
}

/**
 * Checks if the TailItem represents an error condition.
 *
 * Error conditions:
 * - outcome is not 'ok' (exception, exceededCpu, exceededMemory, canceled, unknown)
 * - HTTP status >= 500
 * - exceptions array is not empty
 */
function isErrorCondition(item: TailItem): boolean {
  // Check outcome
  if (item.outcome !== 'ok') {
    return true
  }

  // Check for exceptions
  if (item.exceptions.length > 0) {
    return true
  }

  // Check HTTP status >= 500
  const event = item.event as { response?: { status: number } } | undefined
  if (event?.response?.status !== undefined && event.response.status >= 500) {
    return true
  }

  return false
}

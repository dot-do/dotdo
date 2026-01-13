/**
 * Latency statistics calculated from benchmark samples
 */
export interface LatencyStats {
  /** 50th percentile (median) */
  p50: number
  /** 95th percentile */
  p95: number
  /** 99th percentile */
  p99: number
  /** Minimum value */
  min: number
  /** Maximum value */
  max: number
  /** Arithmetic mean */
  mean: number
  /** Standard deviation */
  stddev: number
}

/**
 * Calculate a percentile from sorted samples using linear interpolation
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]

  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower

  if (lower === upper) return sorted[lower]
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

/**
 * Calculate comprehensive latency statistics from benchmark samples
 *
 * @param samples - Array of latency measurements in milliseconds
 * @returns LatencyStats object with p50, p95, p99, min, max, mean, and stddev
 * @throws Error if samples array is empty
 *
 * @example
 * ```ts
 * const samples = [10, 20, 30, 40, 50]
 * const stats = calculateStats(samples)
 * console.log(stats.p50) // 30
 * console.log(stats.mean) // 30
 * ```
 */
export function calculateStats(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    throw new Error('Cannot calculate stats from empty samples array')
  }

  // Sort samples for percentile calculations
  const sorted = [...samples].sort((a, b) => a - b)

  // Calculate min and max
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  // Calculate mean
  const sum = samples.reduce((acc, val) => acc + val, 0)
  const mean = sum / samples.length

  // Calculate standard deviation
  let variance = 0
  if (samples.length > 1) {
    const squaredDiffs = samples.map((val) => Math.pow(val - mean, 2))
    variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / samples.length
  }
  const stddev = Math.sqrt(variance)

  // Calculate percentiles
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, 95)
  const p99 = percentile(sorted, 99)

  return {
    p50,
    p95,
    p99,
    min,
    max,
    mean,
    stddev,
  }
}

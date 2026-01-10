/**
 * A/B Testing Metrics Context API for $.measure()
 *
 * Provides a workflow context API for A/B testing and metrics tracking:
 * - $.measure('metric_name').increment() - Increment a counter
 * - $.measure('metric_name').record(value) - Record a value (gauges/histograms)
 * - $.measure('experiment_A').compare('experiment_B') - Compare two experiments
 *
 * Supports:
 * - Counter metrics (increment/decrement)
 * - Recorded values with statistics (min, max, avg, sum)
 * - Experiment comparison with percent change calculation
 * - Labeled metrics with dimensions
 *
 * @module workflows/context/measure
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Statistics for a metric with recorded values
 */
export interface MetricStats {
  count: number
  sum: number
  min: number | null
  max: number | null
  avg: number | null
  last: number | null
  lastRecordedAt: number | null
}

/**
 * Stored metric data
 */
export interface MetricData {
  name: string
  value: number
  type: 'counter' | 'recorded'
  values: number[]
  count: number
  sum: number
  min: number | null
  max: number | null
  lastRecordedAt: number | null
  labels?: Record<string, string>
}

/**
 * Comparison result between two metrics
 */
export interface ComparisonResult {
  baseline: {
    value: number | null
    sampleSize: number
    avg: number | null
  }
  variant: {
    value: number | null
    sampleSize: number
    avg: number | null
  }
  difference: number | null
  percentChange: number | null
  winner: 'baseline' | 'variant' | 'tie' | null
}

/**
 * Metric instance returned by $.measure('name')
 */
export interface MetricInstance {
  increment(amount?: number): Promise<number>
  record(value: number): Promise<number>
  value(): Promise<number>
  stats(): Promise<MetricStats>
  reset(): Promise<void>
  compare(variantName: string): Promise<ComparisonResult>
}

/**
 * Metric info for listing
 */
export interface MetricInfo {
  name: string
  type: 'counter' | 'recorded'
  value: number
  count: number
}

/**
 * Exported metric format
 */
export interface ExportedMetric {
  name: string
  value: number
  type: 'counter' | 'recorded'
  count: number
  sum: number
  timestamp: number
  labels?: Record<string, string>
}

/**
 * Metrics collection API at $.metrics
 */
export interface MetricsCollection {
  list(): Promise<MetricInfo[]>
  fetch(): Promise<Record<string, MetricData>>
  clear(): Promise<void>
  export(): Promise<ExportedMetric[]>
}

/**
 * Mock storage interface for metrics
 */
export interface MockStorage {
  metrics: Map<string, MetricData>
}

/**
 * Full context interface returned by createMeasureContext
 */
export interface MeasureContext {
  measure: (name: string, labels?: Record<string, string>) => MetricInstance
  metrics: MetricsCollection
  _storage: MockStorage
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a unique key for a metric with labels
 */
function generateMetricKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) {
    return name
  }

  // Sort labels by key to ensure consistent ordering
  const sortedLabels = Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(',')

  return `${name}{${sortedLabels}}`
}

/**
 * Validate a numeric value for recording
 */
function validateValue(value: number): void {
  if (typeof value !== 'number') {
    throw new Error(`Value must be a number, got ${typeof value}`)
  }
  if (Number.isNaN(value)) {
    throw new Error('Value cannot be NaN')
  }
  if (!Number.isFinite(value)) {
    throw new Error('Value cannot be Infinity')
  }
}

/**
 * Validate metric name
 */
function validateMetricName(name: string): void {
  if (!name || name.trim() === '') {
    throw new Error('Metric name cannot be empty')
  }
}

/**
 * Create default metric data
 */
function createDefaultMetricData(name: string, labels?: Record<string, string>): MetricData {
  return {
    name,
    value: 0,
    type: 'counter',
    values: [],
    count: 0,
    sum: 0,
    min: null,
    max: null,
    lastRecordedAt: null,
    labels,
  }
}

/**
 * Create default stats
 */
function createDefaultStats(): MetricStats {
  return {
    count: 0,
    sum: 0,
    min: null,
    max: null,
    avg: null,
    last: null,
    lastRecordedAt: null,
  }
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates a mock workflow context ($) with measure support for testing
 *
 * This factory creates a context object with:
 * - $.measure(name, labels?) - Returns a MetricInstance for metric operations
 * - $.metrics - Collection-level operations (list, fetch, clear, export)
 * - $._storage - Internal storage for test setup
 *
 * @returns A MeasureContext object with measure API methods
 */
export function createMeasureContext(): MeasureContext {
  // Internal metrics storage
  const storage: MockStorage = {
    metrics: new Map<string, MetricData>(),
  }

  /**
   * Create a MetricInstance for a specific metric
   */
  function createMetricInstance(name: string, labels?: Record<string, string>): MetricInstance {
    const metricKey = generateMetricKey(name, labels)

    return {
      /**
       * Increment a counter metric
       * @param amount - Amount to increment by (default: 1)
       * @returns The new value after increment
       */
      async increment(amount: number = 1): Promise<number> {
        validateMetricName(name)
        validateValue(amount)

        let metric = storage.metrics.get(metricKey)
        if (!metric) {
          metric = createDefaultMetricData(name, labels)
          metric.type = 'counter'
        }

        metric.value += amount
        metric.sum += amount
        metric.count++
        metric.lastRecordedAt = Date.now()

        // Update min/max
        if (metric.min === null || amount < metric.min) {
          metric.min = amount
        }
        if (metric.max === null || amount > metric.max) {
          metric.max = amount
        }

        storage.metrics.set(metricKey, metric)
        return metric.value
      },

      /**
       * Record a value for this metric
       * @param value - The value to record
       * @returns The recorded value
       */
      async record(value: number): Promise<number> {
        validateMetricName(name)
        validateValue(value)

        let metric = storage.metrics.get(metricKey)
        if (!metric) {
          metric = createDefaultMetricData(name, labels)
          metric.type = 'recorded'
        }

        metric.type = 'recorded'
        metric.values.push(value)
        metric.count++
        metric.sum += value
        metric.value = metric.sum // For recorded metrics, value is the sum
        metric.lastRecordedAt = Date.now()

        // Update min/max
        if (metric.min === null || value < metric.min) {
          metric.min = value
        }
        if (metric.max === null || value > metric.max) {
          metric.max = value
        }

        storage.metrics.set(metricKey, metric)
        return value
      },

      /**
       * Get the current value of the metric
       * For counters: returns the accumulated value
       * For recorded: returns the sum of all recorded values
       */
      async value(): Promise<number> {
        const metric = storage.metrics.get(metricKey)
        if (!metric) {
          return 0
        }
        return metric.value
      },

      /**
       * Get statistics for the metric
       */
      async stats(): Promise<MetricStats> {
        const metric = storage.metrics.get(metricKey)
        if (!metric) {
          return createDefaultStats()
        }

        const avg = metric.count > 0 ? metric.sum / metric.count : null
        const last = metric.values.length > 0 ? metric.values[metric.values.length - 1] : null

        return {
          count: metric.count,
          sum: metric.sum,
          min: metric.min,
          max: metric.max,
          avg,
          last,
          lastRecordedAt: metric.lastRecordedAt,
        }
      },

      /**
       * Reset the metric to initial state
       */
      async reset(): Promise<void> {
        const metric = storage.metrics.get(metricKey)
        if (metric) {
          metric.value = 0
          metric.values = []
          metric.count = 0
          metric.sum = 0
          metric.min = null
          metric.max = null
          metric.lastRecordedAt = null
          storage.metrics.set(metricKey, metric)
        }
      },

      /**
       * Compare this metric with another metric
       * @param variantName - The name of the variant metric to compare
       */
      async compare(variantName: string): Promise<ComparisonResult> {
        const baselineMetric = storage.metrics.get(metricKey)
        const variantKey = generateMetricKey(variantName, labels)
        const variantMetric = storage.metrics.get(variantKey)

        // Calculate baseline stats
        const baselineValue = baselineMetric?.value ?? null
        const baselineSampleSize = baselineMetric?.count ?? 0
        const baselineAvg = baselineMetric && baselineMetric.count > 0
          ? baselineMetric.sum / baselineMetric.count
          : null

        // Calculate variant stats
        const variantValue = variantMetric?.value ?? null
        const variantSampleSize = variantMetric?.count ?? 0
        const variantAvg = variantMetric && variantMetric.count > 0
          ? variantMetric.sum / variantMetric.count
          : null

        // Calculate difference and percent change
        let difference: number | null = null
        let percentChange: number | null = null
        let winner: 'baseline' | 'variant' | 'tie' | null = null

        if (baselineAvg !== null && variantAvg !== null) {
          difference = variantAvg - baselineAvg

          if (baselineAvg !== 0) {
            percentChange = ((variantAvg - baselineAvg) / baselineAvg) * 100
          }

          if (variantAvg > baselineAvg) {
            winner = 'variant'
          } else if (variantAvg < baselineAvg) {
            winner = 'baseline'
          } else {
            winner = 'tie'
          }
        } else if (baselineValue !== null && variantValue !== null) {
          // Fall back to raw values for counter comparison
          difference = variantValue - baselineValue

          if (baselineValue !== 0) {
            percentChange = ((variantValue - baselineValue) / baselineValue) * 100
          }

          if (variantValue > baselineValue) {
            winner = 'variant'
          } else if (variantValue < baselineValue) {
            winner = 'baseline'
          } else {
            winner = 'tie'
          }
        }

        return {
          baseline: {
            value: baselineValue,
            sampleSize: baselineSampleSize,
            avg: baselineAvg,
          },
          variant: {
            value: variantValue,
            sampleSize: variantSampleSize,
            avg: variantAvg,
          },
          difference,
          percentChange,
          winner,
        }
      },
    }
  }

  /**
   * Metrics collection API
   */
  const metricsCollection: MetricsCollection = {
    /**
     * List all metrics with basic info
     */
    async list(): Promise<MetricInfo[]> {
      const result: MetricInfo[] = []

      for (const [_key, metric] of storage.metrics) {
        result.push({
          name: metric.name,
          type: metric.type,
          value: metric.value,
          count: metric.count,
        })
      }

      return result
    },

    /**
     * Fetch all metrics with their full data
     */
    async fetch(): Promise<Record<string, MetricData>> {
      const result: Record<string, MetricData> = {}

      for (const [key, metric] of storage.metrics) {
        // Create a deep copy to prevent mutations
        result[key] = {
          ...metric,
          values: [...metric.values],
          labels: metric.labels ? { ...metric.labels } : undefined,
        }
      }

      return result
    },

    /**
     * Clear all metrics
     */
    async clear(): Promise<void> {
      storage.metrics.clear()
    },

    /**
     * Export metrics in standard format
     */
    async export(): Promise<ExportedMetric[]> {
      const result: ExportedMetric[] = []
      const timestamp = Date.now()

      for (const [_key, metric] of storage.metrics) {
        result.push({
          name: metric.name,
          value: metric.value,
          type: metric.type,
          count: metric.count,
          sum: metric.sum,
          timestamp,
          labels: metric.labels,
        })
      }

      return result
    },
  }

  return {
    measure: createMetricInstance,
    metrics: metricsCollection,
    _storage: storage,
  }
}

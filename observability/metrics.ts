/**
 * Metrics Collection for dotdo
 *
 * Provides a lightweight metrics collection system compatible with
 * OpenTelemetry Metrics semantic conventions:
 * - Counters for monotonically increasing values (requests, errors)
 * - Gauges for point-in-time measurements (connections, queue size)
 * - Histograms for distributions (latency, request sizes)
 * - Labels/attributes for dimensional data
 *
 * @module observability/metrics
 */

/**
 * Metric types following OpenTelemetry conventions
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
}

/**
 * Attributes/labels for metrics
 */
export type MetricAttributes = Record<string, string | number | boolean>

/**
 * A single metric data point
 */
export interface MetricDataPoint {
  name: string
  type: MetricType
  value: number
  timestamp: number
  attributes: MetricAttributes
}

/**
 * Histogram bucket configuration
 */
export interface HistogramBuckets {
  boundaries: number[]
  counts: number[]
  sum: number
  count: number
  min: number
  max: number
}

/**
 * Counter metric - monotonically increasing value
 */
export interface Counter {
  /** Add to the counter (must be positive) */
  add(value: number, attributes?: MetricAttributes): void
  /** Increment by 1 */
  inc(attributes?: MetricAttributes): void
  /** Get current value (for testing/export) */
  getValue(attributes?: MetricAttributes): number
}

/**
 * Gauge metric - point-in-time measurement
 */
export interface Gauge {
  /** Set the gauge value */
  set(value: number, attributes?: MetricAttributes): void
  /** Add to the gauge (can be negative) */
  add(value: number, attributes?: MetricAttributes): void
  /** Get current value */
  getValue(attributes?: MetricAttributes): number
}

/**
 * Histogram metric - distribution of values
 */
export interface Histogram {
  /** Record a value in the histogram */
  record(value: number, attributes?: MetricAttributes): void
  /** Get histogram data */
  getData(attributes?: MetricAttributes): HistogramBuckets | undefined
}

/**
 * Meter interface for creating metrics
 */
export interface Meter {
  /** Create or get a counter */
  createCounter(name: string, options?: MetricOptions): Counter
  /** Create or get a gauge */
  createGauge(name: string, options?: MetricOptions): Gauge
  /** Create or get a histogram */
  createHistogram(name: string, options?: HistogramOptions): Histogram
  /** Get all collected metrics */
  collect(): MetricDataPoint[]
  /** Reset all metrics */
  reset(): void
}

/**
 * Options for creating metrics
 */
export interface MetricOptions {
  /** Human-readable description */
  description?: string
  /** Unit of measurement (e.g., 'ms', 'bytes', 'requests') */
  unit?: string
}

/**
 * Options specific to histograms
 */
export interface HistogramOptions extends MetricOptions {
  /** Custom bucket boundaries (defaults to exponential) */
  boundaries?: number[]
}

/**
 * Meter configuration
 */
export interface MeterConfig {
  name: string
  version?: string
}

/**
 * Metrics exporter interface
 */
export interface MetricsExporter {
  export(metrics: MetricDataPoint[]): Promise<void>
  shutdown(): Promise<void>
}

/**
 * Serialize attributes to a consistent string key
 */
function attributesToKey(attributes?: MetricAttributes): string {
  if (!attributes || Object.keys(attributes).length === 0) {
    return ''
  }
  const sorted = Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(sorted)
}

/**
 * Default histogram boundaries (exponential)
 */
const DEFAULT_HISTOGRAM_BOUNDARIES = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
]

/**
 * Internal counter implementation
 */
function createCounterImpl(name: string, _options?: MetricOptions): Counter {
  const values = new Map<string, number>()

  return {
    add(value: number, attributes?: MetricAttributes): void {
      if (value < 0) {
        throw new Error('Counter can only be incremented with positive values')
      }
      const key = attributesToKey(attributes)
      values.set(key, (values.get(key) ?? 0) + value)
    },

    inc(attributes?: MetricAttributes): void {
      this.add(1, attributes)
    },

    getValue(attributes?: MetricAttributes): number {
      const key = attributesToKey(attributes)
      return values.get(key) ?? 0
    },
  }
}

/**
 * Internal gauge implementation
 */
function createGaugeImpl(name: string, _options?: MetricOptions): Gauge {
  const values = new Map<string, number>()

  return {
    set(value: number, attributes?: MetricAttributes): void {
      const key = attributesToKey(attributes)
      values.set(key, value)
    },

    add(value: number, attributes?: MetricAttributes): void {
      const key = attributesToKey(attributes)
      values.set(key, (values.get(key) ?? 0) + value)
    },

    getValue(attributes?: MetricAttributes): number {
      const key = attributesToKey(attributes)
      return values.get(key) ?? 0
    },
  }
}

/**
 * Internal histogram implementation
 */
function createHistogramImpl(name: string, options?: HistogramOptions): Histogram {
  const boundaries = options?.boundaries ?? DEFAULT_HISTOGRAM_BOUNDARIES
  const data = new Map<string, HistogramBuckets>()

  function initBuckets(): HistogramBuckets {
    return {
      boundaries: [...boundaries],
      counts: new Array(boundaries.length + 1).fill(0),
      sum: 0,
      count: 0,
      min: Infinity,
      max: -Infinity,
    }
  }

  return {
    record(value: number, attributes?: MetricAttributes): void {
      const key = attributesToKey(attributes)
      let buckets = data.get(key)
      if (!buckets) {
        buckets = initBuckets()
        data.set(key, buckets)
      }

      // Update statistics
      buckets.sum += value
      buckets.count += 1
      buckets.min = Math.min(buckets.min, value)
      buckets.max = Math.max(buckets.max, value)

      // Find bucket and increment
      let bucketIndex = boundaries.length // overflow bucket
      for (let i = 0; i < boundaries.length; i++) {
        if (value <= boundaries[i]!) {
          bucketIndex = i
          break
        }
      }
      buckets.counts[bucketIndex]!++
    },

    getData(attributes?: MetricAttributes): HistogramBuckets | undefined {
      const key = attributesToKey(attributes)
      const buckets = data.get(key)
      if (!buckets) return undefined
      return { ...buckets, counts: [...buckets.counts] }
    },
  }
}

/**
 * Create a meter for collecting metrics
 */
export function createMeter(config: MeterConfig): Meter {
  const counters = new Map<string, { counter: Counter; options?: MetricOptions; values: Map<string, number> }>()
  const gauges = new Map<string, { gauge: Gauge; options?: MetricOptions; values: Map<string, number> }>()
  const histograms = new Map<string, { histogram: Histogram; options?: HistogramOptions; data: Map<string, HistogramBuckets> }>()

  return {
    createCounter(name: string, options?: MetricOptions): Counter {
      const existing = counters.get(name)
      if (existing) return existing.counter

      const values = new Map<string, number>()
      const counter: Counter = {
        add(value: number, attributes?: MetricAttributes): void {
          if (value < 0) {
            throw new Error('Counter can only be incremented with positive values')
          }
          const key = attributesToKey(attributes)
          values.set(key, (values.get(key) ?? 0) + value)
        },
        inc(attributes?: MetricAttributes): void {
          this.add(1, attributes)
        },
        getValue(attributes?: MetricAttributes): number {
          const key = attributesToKey(attributes)
          return values.get(key) ?? 0
        },
      }

      counters.set(name, { counter, ...(options !== undefined && { options }), values })
      return counter
    },

    createGauge(name: string, options?: MetricOptions): Gauge {
      const existing = gauges.get(name)
      if (existing) return existing.gauge

      const values = new Map<string, number>()
      const gauge: Gauge = {
        set(value: number, attributes?: MetricAttributes): void {
          const key = attributesToKey(attributes)
          values.set(key, value)
        },
        add(value: number, attributes?: MetricAttributes): void {
          const key = attributesToKey(attributes)
          values.set(key, (values.get(key) ?? 0) + value)
        },
        getValue(attributes?: MetricAttributes): number {
          const key = attributesToKey(attributes)
          return values.get(key) ?? 0
        },
      }

      gauges.set(name, { gauge, ...(options !== undefined && { options }), values })
      return gauge
    },

    createHistogram(name: string, options?: HistogramOptions): Histogram {
      const existing = histograms.get(name)
      if (existing) return existing.histogram

      const boundaries = options?.boundaries ?? DEFAULT_HISTOGRAM_BOUNDARIES
      const data = new Map<string, HistogramBuckets>()

      function initBuckets(): HistogramBuckets {
        return {
          boundaries: [...boundaries],
          counts: new Array(boundaries.length + 1).fill(0),
          sum: 0,
          count: 0,
          min: Infinity,
          max: -Infinity,
        }
      }

      const histogram: Histogram = {
        record(value: number, attributes?: MetricAttributes): void {
          const key = attributesToKey(attributes)
          let buckets = data.get(key)
          if (!buckets) {
            buckets = initBuckets()
            data.set(key, buckets)
          }

          buckets.sum += value
          buckets.count += 1
          buckets.min = Math.min(buckets.min, value)
          buckets.max = Math.max(buckets.max, value)

          let bucketIndex = boundaries.length
          for (let i = 0; i < boundaries.length; i++) {
            if (value <= boundaries[i]!) {
              bucketIndex = i
              break
            }
          }
          buckets.counts[bucketIndex]!++
        },
        getData(attributes?: MetricAttributes): HistogramBuckets | undefined {
          const key = attributesToKey(attributes)
          const buckets = data.get(key)
          if (!buckets) return undefined
          return { ...buckets, counts: [...buckets.counts] }
        },
      }

      histograms.set(name, { histogram, ...(options !== undefined && { options }), data })
      return histogram
    },

    collect(): MetricDataPoint[] {
      const timestamp = Date.now()
      const points: MetricDataPoint[] = []

      // Collect counter values
      for (const [name, { values }] of counters) {
        for (const [key, value] of values) {
          points.push({
            name,
            type: MetricType.COUNTER,
            value,
            timestamp,
            attributes: key ? JSON.parse(key).reduce((acc: MetricAttributes, [k, v]: [string, string | number | boolean]) => {
              acc[k] = v
              return acc
            }, {}) : {},
          })
        }
      }

      // Collect gauge values
      for (const [name, { values }] of gauges) {
        for (const [key, value] of values) {
          points.push({
            name,
            type: MetricType.GAUGE,
            value,
            timestamp,
            attributes: key ? JSON.parse(key).reduce((acc: MetricAttributes, [k, v]: [string, string | number | boolean]) => {
              acc[k] = v
              return acc
            }, {}) : {},
          })
        }
      }

      // Collect histogram values (as count for simplicity)
      for (const [name, { data }] of histograms) {
        for (const [key, buckets] of data) {
          points.push({
            name,
            type: MetricType.HISTOGRAM,
            value: buckets.count,
            timestamp,
            attributes: key ? JSON.parse(key).reduce((acc: MetricAttributes, [k, v]: [string, string | number | boolean]) => {
              acc[k] = v
              return acc
            }, {}) : {},
          })
        }
      }

      return points
    },

    reset(): void {
      counters.clear()
      gauges.clear()
      histograms.clear()
    },
  }
}

/**
 * Global meter instance
 */
let globalMeter: Meter | undefined

/**
 * Get or create the global meter
 */
export function getMeter(name = 'dotdo'): Meter {
  if (!globalMeter) {
    globalMeter = createMeter({ name })
  }
  return globalMeter
}

/**
 * Set the global meter
 */
export function setGlobalMeter(meter: Meter): void {
  globalMeter = meter
}

/**
 * Console metrics exporter for development
 */
export function createConsoleMetricsExporter(): MetricsExporter {
  return {
    async export(metrics: MetricDataPoint[]): Promise<void> {
      for (const metric of metrics) {
        console.log(
          `[METRIC] ${metric.name} (${metric.type}): ${metric.value}`,
          Object.keys(metric.attributes).length > 0 ? metric.attributes : ''
        )
      }
    },

    async shutdown(): Promise<void> {
      // No cleanup needed
    },
  }
}

/**
 * Create a periodic metrics reporter
 */
export function createPeriodicReporter(
  meter: Meter,
  exporter: MetricsExporter,
  intervalMs = 60000
): { start(): void; stop(): void; flush(): Promise<void> } {
  let timer: ReturnType<typeof setInterval> | undefined

  return {
    start(): void {
      if (timer) return
      timer = setInterval(async () => {
        const metrics = meter.collect()
        if (metrics.length > 0) {
          await exporter.export(metrics)
        }
      }, intervalMs)
    },

    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
    },

    async flush(): Promise<void> {
      const metrics = meter.collect()
      if (metrics.length > 0) {
        await exporter.export(metrics)
      }
    },
  }
}

/**
 * Common metric names following OpenTelemetry semantic conventions
 */
export const MetricNames = {
  // HTTP metrics
  HTTP_REQUEST_DURATION: 'http.server.request.duration',
  HTTP_REQUEST_SIZE: 'http.server.request.body.size',
  HTTP_RESPONSE_SIZE: 'http.server.response.body.size',
  HTTP_ACTIVE_REQUESTS: 'http.server.active_requests',

  // DO metrics
  DO_REQUEST_DURATION: 'do.request.duration',
  DO_STORAGE_OPERATIONS: 'do.storage.operations',
  DO_ALARM_EXECUTIONS: 'do.alarm.executions',
  DO_WEBSOCKET_CONNECTIONS: 'do.websocket.connections',

  // RPC metrics
  RPC_REQUEST_DURATION: 'rpc.request.duration',
  RPC_REQUEST_COUNT: 'rpc.request.count',
  RPC_ERROR_COUNT: 'rpc.error.count',

  // Event metrics
  EVENT_EMIT_COUNT: 'event.emit.count',
  EVENT_HANDLER_DURATION: 'event.handler.duration',
  EVENT_DLQ_SIZE: 'event.dlq.size',
} as const

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  MetricsCollector,
  Counter,
  Gauge,
  Histogram,
  Summary,
  Timer,
  MetricsExporter,
  MetricsAggregator,
} from './index'
import type { MetricLabels, ExportFormat } from './types'

describe('MetricsCollector', () => {
  let collector: MetricsCollector

  beforeEach(() => {
    collector = new MetricsCollector()
  })

  describe('Counter', () => {
    it('should increment counter by 1 by default', () => {
      collector.counter('requests_total')
      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find((m) => m.name === 'requests_total')
      expect(metric).toBeDefined()
      expect(metric?.value).toBe(1)
      expect(metric?.type).toBe('counter')
    })

    it('should increment counter by specified amount', () => {
      collector.counter('requests_total', {}, 5)
      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find((m) => m.name === 'requests_total')
      expect(metric?.value).toBe(5)
    })

    it('should accumulate counter increments', () => {
      collector.counter('requests_total')
      collector.counter('requests_total')
      collector.counter('requests_total', {}, 3)
      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find((m) => m.name === 'requests_total')
      expect(metric?.value).toBe(5)
    })

    it('should support labels on counters', () => {
      collector.counter('http_requests', { method: 'GET', status: '200' })
      collector.counter('http_requests', { method: 'POST', status: '201' })
      collector.counter('http_requests', { method: 'GET', status: '200' }, 2)

      const snapshot = collector.snapshot()
      const getMetric = snapshot.metrics.find(
        (m) =>
          m.name === 'http_requests' &&
          m.labels.method === 'GET' &&
          m.labels.status === '200'
      )
      const postMetric = snapshot.metrics.find(
        (m) =>
          m.name === 'http_requests' &&
          m.labels.method === 'POST' &&
          m.labels.status === '201'
      )

      expect(getMetric?.value).toBe(3)
      expect(postMetric?.value).toBe(1)
    })

    it('should not allow negative increments', () => {
      expect(() => collector.counter('requests_total', {}, -1)).toThrow(
        'Counter cannot be decremented'
      )
    })
  })

  describe('Gauge', () => {
    it('should set gauge to specified value', () => {
      collector.gauge('temperature', 25.5)
      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find((m) => m.name === 'temperature')
      expect(metric?.value).toBe(25.5)
      expect(metric?.type).toBe('gauge')
    })

    it('should overwrite gauge value on subsequent sets', () => {
      collector.gauge('memory_usage', 100)
      collector.gauge('memory_usage', 150)
      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find((m) => m.name === 'memory_usage')
      expect(metric?.value).toBe(150)
    })

    it('should support labels on gauges', () => {
      collector.gauge('cpu_usage', 50, { core: '0' })
      collector.gauge('cpu_usage', 75, { core: '1' })

      const snapshot = collector.snapshot()
      const core0 = snapshot.metrics.find(
        (m) => m.name === 'cpu_usage' && m.labels.core === '0'
      )
      const core1 = snapshot.metrics.find(
        (m) => m.name === 'cpu_usage' && m.labels.core === '1'
      )

      expect(core0?.value).toBe(50)
      expect(core1?.value).toBe(75)
    })

    it('should allow negative gauge values', () => {
      collector.gauge('temperature', -10)
      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find((m) => m.name === 'temperature')
      expect(metric?.value).toBe(-10)
    })
  })

  describe('Histogram', () => {
    it('should record histogram values', () => {
      collector.histogram('request_duration', 0.1)
      collector.histogram('request_duration', 0.5)
      collector.histogram('request_duration', 1.2)

      const snapshot = collector.snapshot()
      const metrics = snapshot.metrics.filter(
        (m) => m.name.startsWith('request_duration')
      )
      expect(metrics.length).toBeGreaterThan(0)
    })

    it('should use default buckets', () => {
      collector.histogram('response_time', 0.05)
      collector.histogram('response_time', 0.2)
      collector.histogram('response_time', 0.8)

      const snapshot = collector.snapshot()
      const bucketMetrics = snapshot.metrics.filter(
        (m) => m.name === 'response_time_bucket'
      )
      expect(bucketMetrics.length).toBeGreaterThan(0)
    })

    it('should support custom buckets', () => {
      const customCollector = new MetricsCollector({
        defaultBuckets: [1, 5, 10, 50, 100],
      })
      customCollector.histogram('custom_duration', 3)
      customCollector.histogram('custom_duration', 25)
      customCollector.histogram('custom_duration', 75)

      const snapshot = customCollector.snapshot()
      const bucketMetrics = snapshot.metrics.filter(
        (m) => m.name === 'custom_duration_bucket'
      )

      // Should have buckets for 1, 5, 10, 50, 100, +Inf
      expect(bucketMetrics.length).toBe(6)
    })

    it('should track sum and count for histograms', () => {
      collector.histogram('latency', 10)
      collector.histogram('latency', 20)
      collector.histogram('latency', 30)

      const snapshot = collector.snapshot()
      const sumMetric = snapshot.metrics.find((m) => m.name === 'latency_sum')
      const countMetric = snapshot.metrics.find(
        (m) => m.name === 'latency_count'
      )

      expect(sumMetric?.value).toBe(60)
      expect(countMetric?.value).toBe(3)
    })

    it('should support labels on histograms', () => {
      collector.histogram('request_size', 100, { endpoint: '/api/users' })
      collector.histogram('request_size', 200, { endpoint: '/api/users' })
      collector.histogram('request_size', 500, { endpoint: '/api/posts' })

      const snapshot = collector.snapshot()
      const usersSum = snapshot.metrics.find(
        (m) =>
          m.name === 'request_size_sum' && m.labels.endpoint === '/api/users'
      )
      const postsSum = snapshot.metrics.find(
        (m) =>
          m.name === 'request_size_sum' && m.labels.endpoint === '/api/posts'
      )

      expect(usersSum?.value).toBe(300)
      expect(postsSum?.value).toBe(500)
    })
  })

  describe('Summary', () => {
    it('should calculate percentiles', () => {
      // Add 100 values from 1 to 100
      for (let i = 1; i <= 100; i++) {
        collector.summary('request_duration', i)
      }

      const snapshot = collector.snapshot()
      const p50 = snapshot.metrics.find(
        (m) => m.name === 'request_duration' && m.labels.quantile === '0.5'
      )
      const p90 = snapshot.metrics.find(
        (m) => m.name === 'request_duration' && m.labels.quantile === '0.9'
      )
      const p99 = snapshot.metrics.find(
        (m) => m.name === 'request_duration' && m.labels.quantile === '0.99'
      )

      expect(p50?.value).toBeCloseTo(50, 0)
      expect(p90?.value).toBeCloseTo(90, 0)
      expect(p99?.value).toBeCloseTo(99, 0)
    })

    it('should support custom percentiles', () => {
      const customCollector = new MetricsCollector({
        defaultPercentiles: [0.25, 0.75, 0.95],
      })

      for (let i = 1; i <= 100; i++) {
        customCollector.summary('latency', i)
      }

      const snapshot = customCollector.snapshot()
      const p25 = snapshot.metrics.find(
        (m) => m.name === 'latency' && m.labels.quantile === '0.25'
      )
      const p75 = snapshot.metrics.find(
        (m) => m.name === 'latency' && m.labels.quantile === '0.75'
      )

      expect(p25?.value).toBeCloseTo(25, 0)
      expect(p75?.value).toBeCloseTo(75, 0)
    })

    it('should track sum and count for summaries', () => {
      collector.summary('processing_time', 10)
      collector.summary('processing_time', 20)
      collector.summary('processing_time', 30)

      const snapshot = collector.snapshot()
      const sum = snapshot.metrics.find(
        (m) => m.name === 'processing_time_sum'
      )
      const count = snapshot.metrics.find(
        (m) => m.name === 'processing_time_count'
      )

      expect(sum?.value).toBe(60)
      expect(count?.value).toBe(3)
    })
  })

  describe('Timer', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should measure elapsed time', () => {
      const stop = collector.timer('operation_duration')
      vi.advanceTimersByTime(100)
      const elapsed = stop()

      expect(elapsed).toBeCloseTo(100, -1)
    })

    it('should record timer as histogram', () => {
      const stop = collector.timer('api_latency')
      vi.advanceTimersByTime(250)
      stop()

      const snapshot = collector.snapshot()
      const count = snapshot.metrics.find(
        (m) => m.name === 'api_latency_count'
      )
      expect(count?.value).toBe(1)
    })

    it('should support labels on timers', () => {
      const stop = collector.timer('db_query', { table: 'users' })
      vi.advanceTimersByTime(50)
      stop()

      const snapshot = collector.snapshot()
      const count = snapshot.metrics.find(
        (m) => m.name === 'db_query_count' && m.labels.table === 'users'
      )
      expect(count?.value).toBe(1)
    })
  })

  describe('Snapshot', () => {
    it('should return all metrics', () => {
      collector.counter('counter1')
      collector.gauge('gauge1', 10)
      collector.histogram('hist1', 5)

      const snapshot = collector.snapshot()
      expect(snapshot.metrics.length).toBeGreaterThan(0)
      expect(snapshot.timestamp).toBeDefined()
      expect(typeof snapshot.timestamp).toBe('number')
    })

    it('should include timestamp', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))

      collector.counter('test')
      const snapshot = collector.snapshot()

      expect(snapshot.timestamp).toBe(new Date('2024-01-01T00:00:00Z').getTime())
      vi.useRealTimers()
    })
  })

  describe('Reset', () => {
    it('should clear all metrics', () => {
      collector.counter('requests')
      collector.gauge('memory', 100)
      collector.histogram('latency', 50)

      collector.reset()

      const snapshot = collector.snapshot()
      expect(snapshot.metrics.length).toBe(0)
    })

    it('should allow new metrics after reset', () => {
      collector.counter('requests', {}, 10)
      collector.reset()
      collector.counter('requests', {}, 5)

      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find((m) => m.name === 'requests')
      expect(metric?.value).toBe(5)
    })
  })

  describe('Export', () => {
    describe('Prometheus format', () => {
      it('should export counters in Prometheus format', () => {
        collector.counter('http_requests_total', { method: 'GET' }, 42)
        const output = collector.export('prometheus')

        expect(output).toContain('http_requests_total{method="GET"} 42')
      })

      it('should export gauges in Prometheus format', () => {
        collector.gauge('temperature_celsius', 23.5, { location: 'office' })
        const output = collector.export('prometheus')

        expect(output).toContain(
          'temperature_celsius{location="office"} 23.5'
        )
      })

      it('should export histograms in Prometheus format', () => {
        collector.histogram('request_duration_seconds', 0.5)
        const output = collector.export('prometheus')

        expect(output).toContain('request_duration_seconds_bucket')
        expect(output).toContain('request_duration_seconds_sum')
        expect(output).toContain('request_duration_seconds_count')
      })

      it('should handle metrics without labels', () => {
        collector.counter('simple_counter')
        const output = collector.export('prometheus')

        expect(output).toContain('simple_counter 1')
      })
    })

    describe('JSON format', () => {
      it('should export metrics as JSON', () => {
        collector.counter('requests', { status: '200' }, 100)
        collector.gauge('memory', 512)

        const output = collector.export('json')
        const parsed = JSON.parse(output)

        expect(parsed).toHaveProperty('metrics')
        expect(parsed).toHaveProperty('timestamp')
        expect(Array.isArray(parsed.metrics)).toBe(true)
      })

      it('should include all metric properties in JSON', () => {
        collector.counter('test_metric', { env: 'prod' }, 5)
        const output = collector.export('json')
        const parsed = JSON.parse(output)

        const metric = parsed.metrics.find(
          (m: any) => m.name === 'test_metric'
        )
        expect(metric).toMatchObject({
          name: 'test_metric',
          type: 'counter',
          value: 5,
          labels: { env: 'prod' },
        })
      })
    })

    describe('StatsD format', () => {
      it('should export counters in StatsD format', () => {
        collector.counter('page_views', {}, 10)
        const output = collector.export('statsd')

        expect(output).toContain('page_views:10|c')
      })

      it('should export gauges in StatsD format', () => {
        collector.gauge('cpu_usage', 75.5)
        const output = collector.export('statsd')

        expect(output).toContain('cpu_usage:75.5|g')
      })

      it('should export histograms as timing in StatsD', () => {
        collector.histogram('response_time', 250)
        const output = collector.export('statsd')

        expect(output).toContain('response_time:250|ms')
      })
    })

    describe('OpenTelemetry format', () => {
      it('should export in OpenTelemetry JSON format', () => {
        collector.counter('requests', { service: 'api' })
        const output = collector.export('opentelemetry')
        const parsed = JSON.parse(output)

        expect(parsed).toHaveProperty('resourceMetrics')
        expect(Array.isArray(parsed.resourceMetrics)).toBe(true)
      })
    })
  })

  describe('Label Cardinality', () => {
    it('should handle high cardinality labels', () => {
      for (let i = 0; i < 1000; i++) {
        collector.counter('requests', { request_id: `req-${i}` })
      }

      const snapshot = collector.snapshot()
      const requestMetrics = snapshot.metrics.filter(
        (m) => m.name === 'requests'
      )
      expect(requestMetrics.length).toBe(1000)
    })

    it('should track unique label combinations separately', () => {
      collector.counter('api_calls', { method: 'GET', path: '/users' })
      collector.counter('api_calls', { method: 'GET', path: '/posts' })
      collector.counter('api_calls', { method: 'POST', path: '/users' })
      collector.counter('api_calls', { method: 'GET', path: '/users' }, 2)

      const snapshot = collector.snapshot()
      const apiMetrics = snapshot.metrics.filter((m) => m.name === 'api_calls')

      expect(apiMetrics.length).toBe(3)

      const getUsersMetric = apiMetrics.find(
        (m) => m.labels.method === 'GET' && m.labels.path === '/users'
      )
      expect(getUsersMetric?.value).toBe(3)
    })
  })

  describe('Multiple Metrics', () => {
    it('should handle many different metric types simultaneously', () => {
      collector.counter('requests')
      collector.gauge('connections', 10)
      collector.histogram('latency', 100)
      collector.summary('processing', 50)

      const snapshot = collector.snapshot()

      expect(
        snapshot.metrics.some((m) => m.name === 'requests')
      ).toBe(true)
      expect(
        snapshot.metrics.some((m) => m.name === 'connections')
      ).toBe(true)
      expect(
        snapshot.metrics.some((m) => m.name.startsWith('latency'))
      ).toBe(true)
      expect(
        snapshot.metrics.some((m) => m.name.startsWith('processing'))
      ).toBe(true)
    })
  })

  describe('Options', () => {
    it('should apply prefix to all metric names', () => {
      const prefixedCollector = new MetricsCollector({ prefix: 'myapp_' })
      prefixedCollector.counter('requests')

      const snapshot = prefixedCollector.snapshot()
      expect(
        snapshot.metrics.some((m) => m.name === 'myapp_requests')
      ).toBe(true)
    })

    it('should apply default labels to all metrics', () => {
      const labeledCollector = new MetricsCollector({
        defaultLabels: { env: 'production', region: 'us-east' },
      })
      labeledCollector.counter('requests')

      const snapshot = labeledCollector.snapshot()
      const metric = snapshot.metrics.find((m) =>
        m.name.includes('requests')
      )
      expect(metric?.labels.env).toBe('production')
      expect(metric?.labels.region).toBe('us-east')
    })

    it('should merge default labels with metric labels', () => {
      const collector = new MetricsCollector({
        defaultLabels: { env: 'prod' },
      })
      collector.counter('requests', { method: 'GET' })

      const snapshot = collector.snapshot()
      const metric = snapshot.metrics.find((m) => m.name === 'requests')
      expect(metric?.labels.env).toBe('prod')
      expect(metric?.labels.method).toBe('GET')
    })
  })
})

describe('Counter class', () => {
  it('should create standalone counter', () => {
    const counter = new Counter('my_counter')
    counter.inc()
    counter.inc(5)

    expect(counter.value()).toBe(6)
  })

  it('should support labels', () => {
    const counter = new Counter('labeled_counter')
    counter.inc(1, { status: '200' })
    counter.inc(2, { status: '500' })
    counter.inc(1, { status: '200' })

    expect(counter.value({ status: '200' })).toBe(2)
    expect(counter.value({ status: '500' })).toBe(2)
  })
})

describe('Gauge class', () => {
  it('should set, increment, and decrement', () => {
    const gauge = new Gauge('my_gauge')
    gauge.set(100)
    expect(gauge.value()).toBe(100)

    gauge.inc(10)
    expect(gauge.value()).toBe(110)

    gauge.dec(30)
    expect(gauge.value()).toBe(80)
  })

  it('should support labels', () => {
    const gauge = new Gauge('labeled_gauge')
    gauge.set(50, { core: '0' })
    gauge.set(75, { core: '1' })

    expect(gauge.value({ core: '0' })).toBe(50)
    expect(gauge.value({ core: '1' })).toBe(75)
  })
})

describe('Histogram class', () => {
  it('should record observations and calculate buckets', () => {
    const histogram = new Histogram('request_duration', {
      buckets: [0.1, 0.5, 1, 5],
    })

    histogram.observe(0.05)
    histogram.observe(0.3)
    histogram.observe(0.8)
    histogram.observe(3)

    const data = histogram.data()
    expect(data.count).toBe(4)
    expect(data.sum).toBeCloseTo(4.15, 2)
  })
})

describe('Summary class', () => {
  it('should calculate percentiles', () => {
    const summary = new Summary('latency', {
      percentiles: [0.5, 0.9, 0.99],
    })

    for (let i = 1; i <= 100; i++) {
      summary.observe(i)
    }

    const data = summary.data()
    expect(data.percentiles[0.5]).toBeCloseTo(50, 0)
    expect(data.percentiles[0.9]).toBeCloseTo(90, 0)
    expect(data.percentiles[0.99]).toBeCloseTo(99, 0)
  })
})

describe('Timer class', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should measure duration', () => {
    const timer = new Timer()
    timer.start()
    vi.advanceTimersByTime(150)
    const elapsed = timer.stop()

    expect(elapsed).toBeCloseTo(150, -1)
  })

  it('should support multiple measurements', () => {
    const timer = new Timer()

    timer.start()
    vi.advanceTimersByTime(100)
    const first = timer.stop()

    timer.start()
    vi.advanceTimersByTime(200)
    const second = timer.stop()

    expect(first).toBeCloseTo(100, -1)
    expect(second).toBeCloseTo(200, -1)
  })
})

describe('MetricsExporter', () => {
  it('should support multiple formats', () => {
    const exporter = new MetricsExporter()

    expect(exporter.supports('prometheus')).toBe(true)
    expect(exporter.supports('json')).toBe(true)
    expect(exporter.supports('statsd')).toBe(true)
    expect(exporter.supports('opentelemetry')).toBe(true)
  })
})

describe('MetricsAggregator', () => {
  it('should aggregate metrics over time', () => {
    const aggregator = new MetricsAggregator()

    aggregator.add({ name: 'latency', type: 'gauge', value: 10, labels: {}, timestamp: Date.now() })
    aggregator.add({ name: 'latency', type: 'gauge', value: 20, labels: {}, timestamp: Date.now() })
    aggregator.add({ name: 'latency', type: 'gauge', value: 30, labels: {}, timestamp: Date.now() })

    const result = aggregator.aggregate('latency')

    expect(result.count).toBe(3)
    expect(result.sum).toBe(60)
    expect(result.min).toBe(10)
    expect(result.max).toBe(30)
    expect(result.avg).toBe(20)
  })

  it('should calculate percentiles for aggregated data', () => {
    const aggregator = new MetricsAggregator({ percentiles: [0.5, 0.9] })

    for (let i = 1; i <= 100; i++) {
      aggregator.add({ name: 'response_time', type: 'gauge', value: i, labels: {}, timestamp: Date.now() })
    }

    const result = aggregator.aggregate('response_time')

    expect(result.percentiles[0.5]).toBeCloseTo(50, 0)
    expect(result.percentiles[0.9]).toBeCloseTo(90, 0)
  })
})

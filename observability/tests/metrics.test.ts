/**
 * Tests for metrics collection
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  MetricType,
  createMeter,
  getMeter,
  setGlobalMeter,
  createConsoleMetricsExporter,
  createPeriodicReporter,
  MetricNames,
  type Meter,
} from '../metrics'

describe('Meter', () => {
  let meter: Meter

  beforeEach(() => {
    meter = createMeter({ name: 'test-meter' })
  })

  describe('Counter', () => {
    it('should create a counter', () => {
      const counter = meter.createCounter('test.counter')
      expect(counter).toBeDefined()
      expect(counter.getValue()).toBe(0)
    })

    it('should increment counter by value', () => {
      const counter = meter.createCounter('test.counter')
      counter.add(5)
      expect(counter.getValue()).toBe(5)
      counter.add(3)
      expect(counter.getValue()).toBe(8)
    })

    it('should increment counter by 1 with inc()', () => {
      const counter = meter.createCounter('test.counter')
      counter.inc()
      counter.inc()
      counter.inc()
      expect(counter.getValue()).toBe(3)
    })

    it('should throw on negative increment', () => {
      const counter = meter.createCounter('test.counter')
      expect(() => counter.add(-1)).toThrow('Counter can only be incremented with positive values')
    })

    it('should support attributes', () => {
      const counter = meter.createCounter('http.requests')
      counter.inc({ method: 'GET', status: 200 })
      counter.inc({ method: 'POST', status: 201 })
      counter.inc({ method: 'GET', status: 200 })

      expect(counter.getValue({ method: 'GET', status: 200 })).toBe(2)
      expect(counter.getValue({ method: 'POST', status: 201 })).toBe(1)
      expect(counter.getValue({ method: 'DELETE', status: 404 })).toBe(0)
    })

    it('should return same counter for same name', () => {
      const counter1 = meter.createCounter('test.counter')
      const counter2 = meter.createCounter('test.counter')

      counter1.inc()
      expect(counter2.getValue()).toBe(1)
    })
  })

  describe('Gauge', () => {
    it('should create a gauge', () => {
      const gauge = meter.createGauge('test.gauge')
      expect(gauge).toBeDefined()
      expect(gauge.getValue()).toBe(0)
    })

    it('should set gauge value', () => {
      const gauge = meter.createGauge('test.gauge')
      gauge.set(42)
      expect(gauge.getValue()).toBe(42)
      gauge.set(100)
      expect(gauge.getValue()).toBe(100)
    })

    it('should add to gauge (positive)', () => {
      const gauge = meter.createGauge('test.gauge')
      gauge.set(50)
      gauge.add(10)
      expect(gauge.getValue()).toBe(60)
    })

    it('should add to gauge (negative)', () => {
      const gauge = meter.createGauge('test.gauge')
      gauge.set(50)
      gauge.add(-20)
      expect(gauge.getValue()).toBe(30)
    })

    it('should support attributes', () => {
      const gauge = meter.createGauge('connections')
      gauge.set(5, { pool: 'primary' })
      gauge.set(3, { pool: 'secondary' })

      expect(gauge.getValue({ pool: 'primary' })).toBe(5)
      expect(gauge.getValue({ pool: 'secondary' })).toBe(3)
    })

    it('should return same gauge for same name', () => {
      const gauge1 = meter.createGauge('test.gauge')
      const gauge2 = meter.createGauge('test.gauge')

      gauge1.set(42)
      expect(gauge2.getValue()).toBe(42)
    })
  })

  describe('Histogram', () => {
    it('should create a histogram', () => {
      const histogram = meter.createHistogram('test.histogram')
      expect(histogram).toBeDefined()
    })

    it('should record values', () => {
      const histogram = meter.createHistogram('latency')
      histogram.record(10)
      histogram.record(20)
      histogram.record(30)

      const data = histogram.getData()
      expect(data).toBeDefined()
      expect(data!.count).toBe(3)
      expect(data!.sum).toBe(60)
      expect(data!.min).toBe(10)
      expect(data!.max).toBe(30)
    })

    it('should bucket values correctly', () => {
      const histogram = meter.createHistogram('latency', {
        boundaries: [10, 50, 100, 500],
      })

      histogram.record(5)   // bucket 0 (<=10)
      histogram.record(10)  // bucket 0 (<=10)
      histogram.record(25)  // bucket 1 (<=50)
      histogram.record(75)  // bucket 2 (<=100)
      histogram.record(200) // bucket 3 (<=500)
      histogram.record(1000) // bucket 4 (overflow)

      const data = histogram.getData()
      expect(data!.counts[0]).toBe(2)  // <=10
      expect(data!.counts[1]).toBe(1)  // <=50
      expect(data!.counts[2]).toBe(1)  // <=100
      expect(data!.counts[3]).toBe(1)  // <=500
      expect(data!.counts[4]).toBe(1)  // >500 (overflow)
    })

    it('should support attributes', () => {
      const histogram = meter.createHistogram('request.duration')
      histogram.record(10, { endpoint: '/users' })
      histogram.record(20, { endpoint: '/users' })
      histogram.record(100, { endpoint: '/orders' })

      const usersData = histogram.getData({ endpoint: '/users' })
      const ordersData = histogram.getData({ endpoint: '/orders' })

      expect(usersData!.count).toBe(2)
      expect(ordersData!.count).toBe(1)
    })

    it('should return same histogram for same name', () => {
      const hist1 = meter.createHistogram('test.histogram')
      const hist2 = meter.createHistogram('test.histogram')

      hist1.record(42)
      expect(hist2.getData()!.count).toBe(1)
    })
  })

  describe('collect()', () => {
    it('should collect all metrics', () => {
      const counter = meter.createCounter('requests')
      const gauge = meter.createGauge('connections')
      const histogram = meter.createHistogram('latency')

      counter.inc()
      counter.inc()
      gauge.set(5)
      histogram.record(100)

      const collected = meter.collect()
      expect(collected.length).toBe(3)

      const counterMetric = collected.find(m => m.name === 'requests')
      const gaugeMetric = collected.find(m => m.name === 'connections')
      const histogramMetric = collected.find(m => m.name === 'latency')

      expect(counterMetric!.type).toBe(MetricType.COUNTER)
      expect(counterMetric!.value).toBe(2)

      expect(gaugeMetric!.type).toBe(MetricType.GAUGE)
      expect(gaugeMetric!.value).toBe(5)

      expect(histogramMetric!.type).toBe(MetricType.HISTOGRAM)
      expect(histogramMetric!.value).toBe(1) // count
    })

    it('should include attributes in collected metrics', () => {
      const counter = meter.createCounter('requests')
      counter.inc({ method: 'GET' })
      counter.inc({ method: 'POST' })

      const collected = meter.collect()
      expect(collected.length).toBe(2)

      const getMetric = collected.find(m =>
        m.attributes['method'] === 'GET'
      )
      const postMetric = collected.find(m =>
        m.attributes['method'] === 'POST'
      )

      expect(getMetric!.value).toBe(1)
      expect(postMetric!.value).toBe(1)
    })

    it('should include timestamp in collected metrics', () => {
      const counter = meter.createCounter('requests')
      counter.inc()

      const before = Date.now()
      const collected = meter.collect()
      const after = Date.now()

      expect(collected[0]!.timestamp).toBeGreaterThanOrEqual(before)
      expect(collected[0]!.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('reset()', () => {
    it('should clear all metrics', () => {
      const counter = meter.createCounter('requests')
      const gauge = meter.createGauge('connections')

      counter.inc()
      gauge.set(5)

      meter.reset()

      const collected = meter.collect()
      expect(collected.length).toBe(0)
    })
  })
})

describe('Global meter', () => {
  it('should provide a default global meter', () => {
    const meter = getMeter()
    expect(meter).toBeDefined()
  })

  it('should allow setting a custom global meter', () => {
    const customMeter = createMeter({ name: 'custom' })
    setGlobalMeter(customMeter)

    // The global meter should now be the custom one
    const meter = getMeter()
    const counter = meter.createCounter('test')
    counter.inc()

    // Verify it's the same instance
    expect(customMeter.collect()[0]!.value).toBe(1)
  })
})

describe('MetricsExporter', () => {
  describe('createConsoleMetricsExporter', () => {
    it('should export metrics without error', async () => {
      const exporter = createConsoleMetricsExporter()
      const meter = createMeter({ name: 'export-test' })
      const counter = meter.createCounter('test')
      counter.inc()

      await expect(exporter.export(meter.collect())).resolves.not.toThrow()
      await expect(exporter.shutdown()).resolves.not.toThrow()
    })
  })
})

describe('PeriodicReporter', () => {
  it('should flush metrics on demand', async () => {
    const meter = createMeter({ name: 'reporter-test' })
    const exported: any[] = []
    const exporter = {
      async export(metrics: any[]) {
        exported.push(...metrics)
      },
      async shutdown() {},
    }

    const reporter = createPeriodicReporter(meter, exporter, 60000)

    const counter = meter.createCounter('test')
    counter.inc()

    await reporter.flush()

    expect(exported.length).toBe(1)
    expect(exported[0].name).toBe('test')

    reporter.stop()
  })
})

describe('MetricNames', () => {
  it('should have standard HTTP metric names', () => {
    expect(MetricNames.HTTP_REQUEST_DURATION).toBe('http.server.request.duration')
    expect(MetricNames.HTTP_ACTIVE_REQUESTS).toBe('http.server.active_requests')
  })

  it('should have standard DO metric names', () => {
    expect(MetricNames.DO_REQUEST_DURATION).toBe('do.request.duration')
    expect(MetricNames.DO_STORAGE_OPERATIONS).toBe('do.storage.operations')
  })

  it('should have standard RPC metric names', () => {
    expect(MetricNames.RPC_REQUEST_COUNT).toBe('rpc.request.count')
    expect(MetricNames.RPC_ERROR_COUNT).toBe('rpc.error.count')
  })
})

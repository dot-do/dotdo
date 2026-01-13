/**
 * @dotdo/datadog - Metrics Module Tests
 *
 * Comprehensive tests for Datadog-compatible metrics API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  MetricsClient,
  createMetricsClient,
  getDefaultClient,
  setDefaultClient,
  clearDefaultClient,
  increment,
  decrement,
  gauge,
  histogram,
  distribution,
  timing,
} from '../metrics'

describe('@dotdo/datadog - Metrics Module', () => {
  let client: MetricsClient

  beforeEach(() => {
    client = new MetricsClient({
      service: 'test-service',
      env: 'test',
      hostname: 'test-host',
      batching: false, // Disable auto-flush for tests
    })
    clearDefaultClient()
  })

  afterEach(() => {
    client.disable()
    clearDefaultClient()
  })

  // ===========================================================================
  // Counter Metrics
  // ===========================================================================

  describe('Counter Metrics', () => {
    it('should increment a counter', () => {
      client.count('requests.total', 1)

      const buffer = client.getBuffer()
      expect(buffer.length).toBe(1)
      expect(buffer[0].metric).toBe('requests.total')
      expect(buffer[0].type).toBe('count')
      expect(buffer[0].points[0].value).toBe(1)
    })

    it('should increment by custom value', () => {
      client.count('bytes.sent', 1024)

      const buffer = client.getBuffer()
      expect(buffer[0].points[0].value).toBe(1024)
    })

    it('should use increment alias', () => {
      client.increment('events.processed', 5)

      const buffer = client.getBuffer()
      expect(buffer[0].metric).toBe('events.processed')
      expect(buffer[0].points[0].value).toBe(5)
    })

    it('should decrement a counter', () => {
      client.decrement('active.connections', 1)

      const buffer = client.getBuffer()
      expect(buffer[0].points[0].value).toBe(-1)
    })

    it('should decrement by custom value', () => {
      client.decrement('queue.size', 10)

      const buffer = client.getBuffer()
      expect(buffer[0].points[0].value).toBe(-10)
    })

    it('should attach tags to counter', () => {
      client.count('http.requests', 1, {
        tags: ['method:GET', 'path:/api/users'],
      })

      const buffer = client.getBuffer()
      expect(buffer[0].tags).toContain('method:GET')
      expect(buffer[0].tags).toContain('path:/api/users')
      expect(buffer[0].tags).toContain('service:test-service')
    })

    it('should set custom host', () => {
      client.count('requests', 1, { host: 'custom-host' })

      const buffer = client.getBuffer()
      expect(buffer[0].host).toBe('custom-host')
    })
  })

  // ===========================================================================
  // Gauge Metrics
  // ===========================================================================

  describe('Gauge Metrics', () => {
    it('should record gauge value', () => {
      client.gauge('system.memory', 2048)

      const buffer = client.getBuffer()
      expect(buffer[0].metric).toBe('system.memory')
      expect(buffer[0].type).toBe('gauge')
      expect(buffer[0].points[0].value).toBe(2048)
    })

    it('should record gauge with unit', () => {
      client.gauge('disk.free', 500, { unit: 'gigabyte' })

      const buffer = client.getBuffer()
      expect(buffer[0].unit).toBe('gigabyte')
    })

    it('should get last gauge value', () => {
      client.gauge('cpu.usage', 45.5)

      const value = client.getGauge('cpu.usage')
      expect(value).toBe(45.5)
    })

    it('should get gauge by tags', () => {
      client.gauge('memory.used', 1000, { tags: ['host:server1'] })
      client.gauge('memory.used', 2000, { tags: ['host:server2'] })

      const value1 = client.getGauge('memory.used', ['host:server1'])
      const value2 = client.getGauge('memory.used', ['host:server2'])

      expect(value1).toBe(1000)
      expect(value2).toBe(2000)
    })

    it('should return undefined for non-existent gauge', () => {
      const value = client.getGauge('non.existent')
      expect(value).toBeUndefined()
    })

    it('should update gauge value', () => {
      client.gauge('connections.active', 10)
      client.gauge('connections.active', 15)

      const value = client.getGauge('connections.active')
      expect(value).toBe(15)
    })
  })

  // ===========================================================================
  // Histogram Metrics
  // ===========================================================================

  describe('Histogram Metrics', () => {
    it('should record histogram value', () => {
      client.histogram('request.latency', 125)

      const buffer = client.getBuffer()
      expect(buffer[0].metric).toBe('request.latency')
      expect(buffer[0].type).toBe('histogram')
      expect(buffer[0].points[0].value).toBe(125)
    })

    it('should calculate histogram statistics', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      for (const v of values) {
        client.histogram('latency', v)
      }

      const stats = client.getHistogramStats('latency')

      expect(stats).not.toBeNull()
      expect(stats!.count).toBe(10)
      expect(stats!.sum).toBe(550)
      expect(stats!.min).toBe(10)
      expect(stats!.max).toBe(100)
      expect(stats!.avg).toBe(55)
    })

    it('should calculate percentiles', () => {
      for (let i = 1; i <= 100; i++) {
        client.histogram('percentile.test', i)
      }

      const stats = client.getHistogramStats('percentile.test')

      expect(stats!.p50).toBe(50)
      expect(stats!.p90).toBe(90)
      expect(stats!.p95).toBe(95)
      expect(stats!.p99).toBe(99)
    })

    it('should track histogram by tags', () => {
      client.histogram('db.query', 10, { tags: ['table:users'] })
      client.histogram('db.query', 20, { tags: ['table:orders'] })

      const usersStats = client.getHistogramStats('db.query', ['table:users'])
      const ordersStats = client.getHistogramStats('db.query', ['table:orders'])

      expect(usersStats!.count).toBe(1)
      expect(ordersStats!.count).toBe(1)
    })

    it('should return null for non-existent histogram', () => {
      const stats = client.getHistogramStats('non.existent')
      expect(stats).toBeNull()
    })

    it('should clear histogram values', () => {
      client.histogram('test.hist', 100)
      client.clearHistogram('test.hist')

      const stats = client.getHistogramStats('test.hist')
      expect(stats).toBeNull()
    })
  })

  // ===========================================================================
  // Distribution Metrics
  // ===========================================================================

  describe('Distribution Metrics', () => {
    it('should record distribution value', () => {
      client.distribution('response.size', 2048)

      const buffer = client.getBuffer()
      expect(buffer[0].metric).toBe('response.size')
      expect(buffer[0].type).toBe('distribution')
      expect(buffer[0].points[0].value).toBe(2048)
    })

    it('should record distribution with unit', () => {
      client.distribution('download.size', 100, { unit: 'megabyte' })

      const buffer = client.getBuffer()
      expect(buffer[0].unit).toBe('megabyte')
    })
  })

  // ===========================================================================
  // Rate Metrics
  // ===========================================================================

  describe('Rate Metrics', () => {
    it('should record rate value', () => {
      client.rate('requests.per_second', 150)

      const buffer = client.getBuffer()
      expect(buffer[0].metric).toBe('requests.per_second')
      expect(buffer[0].type).toBe('rate')
      expect(buffer[0].points[0].value).toBe(150)
    })

    it('should record rate with custom interval', () => {
      client.rate('events.per_minute', 3000, { interval: 60 })

      const buffer = client.getBuffer()
      expect(buffer[0].interval).toBe(60)
    })
  })

  // ===========================================================================
  // Set Metrics
  // ===========================================================================

  describe('Set Metrics', () => {
    it('should track unique values', () => {
      client.set('users.unique', 'user-1')
      client.set('users.unique', 'user-2')
      client.set('users.unique', 'user-1') // Duplicate

      const size = client.getSetSize('users.unique')
      expect(size).toBe(2)
    })

    it('should track numeric values in set', () => {
      client.set('error.codes', 404)
      client.set('error.codes', 500)
      client.set('error.codes', 404)

      const size = client.getSetSize('error.codes')
      expect(size).toBe(2)
    })

    it('should track sets by tags', () => {
      client.set('visitors', 'v1', { tags: ['page:home'] })
      client.set('visitors', 'v2', { tags: ['page:home'] })
      client.set('visitors', 'v1', { tags: ['page:about'] })

      const homeSize = client.getSetSize('visitors', ['page:home'])
      const aboutSize = client.getSetSize('visitors', ['page:about'])

      expect(homeSize).toBe(2)
      expect(aboutSize).toBe(1)
    })

    it('should return 0 for non-existent set', () => {
      const size = client.getSetSize('non.existent')
      expect(size).toBe(0)
    })

    it('should clear set values', () => {
      client.set('test.set', 'value')
      client.clearSet('test.set')

      const size = client.getSetSize('test.set')
      expect(size).toBe(0)
    })
  })

  // ===========================================================================
  // Timer Metrics
  // ===========================================================================

  describe('Timer Metrics', () => {
    it('should time sync function', () => {
      const stop = client.timer('operation.duration')

      // Simulate work
      const start = Date.now()
      while (Date.now() - start < 10) {
        // busy wait
      }

      const duration = stop()

      expect(duration).toBeGreaterThan(0)
      expect(client.getBuffer().some((s) => s.metric === 'operation.duration')).toBe(true)
    })

    it('should time async function', async () => {
      const result = await client.time('async.operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'done'
      })

      expect(result).toBe('done')
      expect(client.getBuffer().some((s) => s.metric === 'async.operation')).toBe(true)
    })

    it('should use millisecond unit for timer', () => {
      const stop = client.timer('quick.op')
      stop()

      const buffer = client.getBuffer()
      expect(buffer[0].unit).toBe('millisecond')
    })
  })

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  describe('Bulk Operations', () => {
    it('should submit multiple series', () => {
      client.submit([
        {
          metric: 'bulk.metric1',
          type: 'count',
          points: [{ timestamp: Date.now() / 1000, value: 1 }],
        },
        {
          metric: 'bulk.metric2',
          type: 'gauge',
          points: [{ timestamp: Date.now() / 1000, value: 100 }],
        },
      ])

      const buffer = client.getBuffer()
      expect(buffer.length).toBe(2)
    })

    it('should clear buffer', () => {
      client.count('test', 1)
      client.count('test', 2)

      expect(client.getBuffer().length).toBe(2)

      client.clearBuffer()

      expect(client.getBuffer().length).toBe(0)
    })
  })

  // ===========================================================================
  // Flush & Lifecycle
  // ===========================================================================

  describe('Flush & Lifecycle', () => {
    it('should flush metrics', async () => {
      client.count('flush.test', 1)
      client.count('flush.test', 2)

      const response = await client.flush()

      expect(response.status).toBe('ok')
      expect(response.data?.series_count).toBe(2)
      expect(client.getBuffer().length).toBe(0)
    })

    it('should handle empty flush', async () => {
      const response = await client.flush()

      expect(response.status).toBe('ok')
      expect(response.data?.series_count).toBe(0)
    })

    it('should close client', async () => {
      client.count('before.close', 1)

      await client.close()

      // Client should be disabled after close
      expect(client.isEnabled()).toBe(false)
    })

    it('should disable client', () => {
      client.disable()
      client.count('disabled.metric', 1)

      expect(client.getBuffer().length).toBe(0)
    })

    it('should re-enable client', () => {
      client.disable()
      client.enable()
      client.count('enabled.metric', 1)

      expect(client.getBuffer().length).toBe(1)
    })

    it('should check enabled state', () => {
      expect(client.isEnabled()).toBe(true)
      client.disable()
      expect(client.isEnabled()).toBe(false)
    })
  })

  // ===========================================================================
  // Configuration
  // ===========================================================================

  describe('Configuration', () => {
    it('should get configuration', () => {
      const config = client.getConfig()

      expect(config.service).toBe('test-service')
      expect(config.env).toBe('test')
      expect(config.hostname).toBe('test-host')
    })

    it('should include service and env tags automatically', () => {
      client.count('tagged.metric', 1)

      const buffer = client.getBuffer()
      expect(buffer[0].tags).toContain('service:test-service')
      expect(buffer[0].tags).toContain('env:test')
    })

    it('should merge global and local tags', () => {
      const taggedClient = new MetricsClient({
        service: 'tagged',
        env: 'test',
        tags: ['global:tag'],
        batching: false,
      })

      taggedClient.count('test', 1, { tags: ['local:tag'] })

      const buffer = taggedClient.getBuffer()
      expect(buffer[0].tags).toContain('global:tag')
      expect(buffer[0].tags).toContain('local:tag')

      taggedClient.disable()
    })
  })

  // ===========================================================================
  // Default Client
  // ===========================================================================

  describe('Default Client', () => {
    it('should get default client', () => {
      const defaultClient = getDefaultClient()
      expect(defaultClient).toBeInstanceOf(MetricsClient)
    })

    it('should set default client', () => {
      const custom = createMetricsClient({ service: 'custom' })
      setDefaultClient(custom)

      const retrieved = getDefaultClient()
      expect(retrieved).toBe(custom)

      custom.disable()
    })

    it('should use convenience functions with default client', () => {
      const custom = createMetricsClient({ service: 'default-test', batching: false })
      setDefaultClient(custom)

      increment('conv.increment', 1)
      decrement('conv.decrement', 1)
      gauge('conv.gauge', 50)
      histogram('conv.histogram', 100)
      distribution('conv.distribution', 200)
      timing('conv.timing', 15)

      const buffer = custom.getBuffer()
      expect(buffer.length).toBe(6)

      custom.disable()
    })

    it('should clear default client', () => {
      const custom = createMetricsClient()
      setDefaultClient(custom)
      clearDefaultClient()

      // Should create a new default
      const newDefault = getDefaultClient()
      expect(newDefault).not.toBe(custom)

      newDefault.disable()
      custom.disable()
    })
  })

  // ===========================================================================
  // Timestamps
  // ===========================================================================

  describe('Timestamps', () => {
    it('should auto-generate timestamp', () => {
      const before = Math.floor(Date.now() / 1000)
      client.count('timestamp.test', 1)
      const after = Math.floor(Date.now() / 1000)

      const buffer = client.getBuffer()
      const timestamp = buffer[0].points[0].timestamp

      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })

    it('should accept custom timestamp', () => {
      const customTs = 1704067200 // 2024-01-01 00:00:00 UTC

      client.count('custom.timestamp', 1, { timestamp: customTs })

      const buffer = client.getBuffer()
      expect(buffer[0].points[0].timestamp).toBe(customTs)
    })
  })
})

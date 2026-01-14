import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  logRoutingEvent,
  createRoutingSpan,
  addRoutingHeaders,
  RoutingDebugInfo,
  type RoutingEvent,
} from '../utils/routing-telemetry'

/**
 * Test suite for routing telemetry module
 *
 * Tests:
 * 1. Event logging with structured JSON
 * 2. Timing span creation and measurement
 * 3. Response header generation
 * 4. Debug info collection
 */

describe('Routing Telemetry', () => {
  // ========================================================================
  // logRoutingEvent Tests
  // ========================================================================

  describe('logRoutingEvent', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('logs event with type "routing"', () => {
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 5,
      }

      logRoutingEvent(event)

      expect(consoleSpy).toHaveBeenCalledOnce()
      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.type).toBe('routing')
    })

    it('includes all event properties in log', () => {
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        colo: 'sjc',
        region: 'us-west-1',
        lat: 37.3382,
        lon: -121.8863,
        nounName: 'customers',
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 5,
      }

      logRoutingEvent(event)

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.timestamp).toBe(1000)
      expect(logged.requestId).toBe('req-123')
      expect(logged.pathname).toBe('/customers/456')
      expect(logged.colo).toBe('sjc')
      expect(logged.region).toBe('us-west-1')
      expect(logged.nounName).toBe('customers')
    })

    it('logs location data when provided', () => {
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        colo: 'ewr',
        region: 'us-east-1',
        lat: 40.6895,
        lon: -74.1745,
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 5,
      }

      logRoutingEvent(event)

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.colo).toBe('ewr')
      expect(logged.region).toBe('us-east-1')
      expect(logged.lat).toBeCloseTo(40.6895)
      expect(logged.lon).toBeCloseTo(-74.1745)
    })

    it('logs replica information', () => {
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        nounName: 'customers',
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
        replicaRegion: 'us-east-1',
        routingDurationMs: 5,
      }

      logRoutingEvent(event)

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.isReplica).toBe(true)
      expect(logged.replicaRegion).toBe('us-east-1')
      expect(logged.targetBinding).toBe('REPLICA_DO')
    })

    it('logs routing duration', () => {
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 12,
      }

      logRoutingEvent(event)

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.routingDurationMs).toBe(12)
    })

    it('formats as valid JSON', () => {
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 5,
      }

      logRoutingEvent(event)

      expect(() => {
        JSON.parse(consoleSpy.mock.calls[0][0])
      }).not.toThrow()
    })
  })

  // ========================================================================
  // createRoutingSpan Tests
  // ========================================================================

  describe('createRoutingSpan', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('creates a span with start time', () => {
      const span = createRoutingSpan('req-123', '/customers/456', 'GET')
      expect(span).toBeDefined()
      expect(typeof span.end).toBe('function')
    })

    it('measures duration when span is ended', () => {
      const span = createRoutingSpan('req-123', '/customers/456', 'GET')

      // Simulate some delay
      const startTime = Date.now()
      while (Date.now() - startTime < 10) {
        // Busy wait for ~10ms
      }

      span.end({
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
      })

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.routingDurationMs).toBeGreaterThanOrEqual(10)
    })

    it('includes span context when ending', () => {
      const span = createRoutingSpan('req-456', '/products/789', 'POST')

      span.end({
        targetBinding: 'DO',
        consistencyMode: 'strong',
        isReplica: false,
        nounName: 'products',
      })

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.requestId).toBe('req-456')
      expect(logged.pathname).toBe('/products/789')
      expect(logged.method).toBe('POST')
      expect(logged.nounName).toBe('products')
    })

    it('can override default consistency mode', () => {
      const span = createRoutingSpan('req-123', '/customers/456', 'GET')

      span.end({
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
        replicaRegion: 'eu-west-1',
      })

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.consistencyMode).toBe('eventual')
      expect(logged.isReplica).toBe(true)
    })

    it('logs replica region information', () => {
      const span = createRoutingSpan('req-123', '/customers/456', 'GET')

      span.end({
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
        replicaRegion: 'ap-southeast-1',
        region: 'ap-southeast-1',
      })

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.replicaRegion).toBe('ap-southeast-1')
    })

    it('includes location data in logged span', () => {
      const span = createRoutingSpan('req-123', '/customers/456', 'GET')

      span.end({
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        colo: 'sjc',
        region: 'us-west-1',
        lat: 37.3382,
        lon: -121.8863,
      })

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.colo).toBe('sjc')
      expect(logged.region).toBe('us-west-1')
      expect(logged.lat).toBeCloseTo(37.3382)
    })

    it('can be ended multiple times (creates multiple events)', () => {
      const span = createRoutingSpan('req-123', '/customers/456', 'GET')

      span.end({
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
      })

      span.end({
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
      })

      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })
  })

  // ========================================================================
  // addRoutingHeaders Tests
  // ========================================================================

  describe('addRoutingHeaders', () => {
    it('adds X-DO-Target header', () => {
      const headers = new Headers()
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 5,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-DO-Target')).toBe('DO')
    })

    it('adds X-DO-Replica header as boolean string', () => {
      const headers = new Headers()
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
        routingDurationMs: 5,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-DO-Replica')).toBe('true')
    })

    it('adds X-DO-Replica-Region header when applicable', () => {
      const headers = new Headers()
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
        replicaRegion: 'us-east-1',
        routingDurationMs: 5,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-DO-Replica-Region')).toBe('us-east-1')
    })

    it('does not add X-DO-Replica-Region when not provided', () => {
      const headers = new Headers()
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 5,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-DO-Replica-Region')).toBeNull()
    })

    it('adds X-Location-Colo header when colo provided', () => {
      const headers = new Headers()
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        colo: 'sjc',
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 5,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-Location-Colo')).toBe('sjc')
    })

    it('adds X-DO-Consistency-Mode header', () => {
      const headers = new Headers()
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'DO',
        consistencyMode: 'strong',
        isReplica: false,
        routingDurationMs: 5,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-DO-Consistency-Mode')).toBe('strong')
    })

    it('adds X-Routing-Duration-Ms header', () => {
      const headers = new Headers()
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'DO',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 23,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-Routing-Duration-Ms')).toBe('23')
    })

    it('adds all headers for complete event', () => {
      const headers = new Headers()
      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        colo: 'ewr',
        region: 'us-east-1',
        lat: 40.6895,
        lon: -74.1745,
        nounName: 'customers',
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
        replicaRegion: 'us-east-1',
        routingDurationMs: 8,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-DO-Target')).toBe('REPLICA_DO')
      expect(headers.get('X-DO-Replica')).toBe('true')
      expect(headers.get('X-DO-Replica-Region')).toBe('us-east-1')
      expect(headers.get('X-Location-Colo')).toBe('ewr')
      expect(headers.get('X-DO-Consistency-Mode')).toBe('eventual')
      expect(headers.get('X-Routing-Duration-Ms')).toBe('8')
    })

    it('overwrites existing headers', () => {
      const headers = new Headers()
      headers.set('X-DO-Target', 'old-value')

      const event: RoutingEvent = {
        timestamp: 1000,
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        targetBinding: 'new-value',
        consistencyMode: 'eventual',
        isReplica: false,
        routingDurationMs: 5,
      }

      addRoutingHeaders(headers, event)

      expect(headers.get('X-DO-Target')).toBe('new-value')
    })
  })

  // ========================================================================
  // RoutingDebugInfo Tests
  // ========================================================================

  describe('RoutingDebugInfo', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('records routing decisions', () => {
      const debug = new RoutingDebugInfo('req-123')

      debug.recordDecision('checking', 'static-routes')
      debug.recordDecision('routing', 'customers → REPLICA_DO')

      const decisions = debug.getDecisions()
      expect(decisions).toHaveLength(2)
      expect(decisions[0].action).toBe('checking')
      expect(decisions[0].detail).toBe('static-routes')
    })

    it('includes timestamps for each decision', () => {
      const debug = new RoutingDebugInfo('req-123')

      debug.recordDecision('decision-1', 'detail-1')
      const startTime = Date.now()
      debug.recordDecision('decision-2', 'detail-2')

      const decisions = debug.getDecisions()
      expect(decisions[0].timestamp).toBeLessThanOrEqual(startTime)
      expect(decisions[1].timestamp).toBeGreaterThanOrEqual(startTime)
    })

    it('prints debug info as JSON', () => {
      const debug = new RoutingDebugInfo('req-456')

      debug.recordDecision('check', 'static')
      debug.recordDecision('route', 'replica')
      debug.print()

      expect(consoleSpy).toHaveBeenCalledOnce()
      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.type).toBe('routing-debug')
      expect(logged.requestId).toBe('req-456')
      expect(logged.decisions).toHaveLength(2)
    })

    it('can be used to build decision tree', () => {
      const debug = new RoutingDebugInfo('req-789')

      debug.recordDecision('start', 'routing-request')
      debug.recordDecision('extract-location', 'success')
      debug.recordDecision('check-static-routes', 'no-match')
      debug.recordDecision('check-noun-config', 'match-found')
      debug.recordDecision('check-replica-conditions', 'conditions-met')
      debug.recordDecision('select-replica', 'us-east-1')
      debug.recordDecision('end', 'routing-complete')

      const decisions = debug.getDecisions()
      expect(decisions).toHaveLength(7)
      expect(decisions[0].action).toBe('start')
      expect(decisions[decisions.length - 1].action).toBe('end')
    })

    it('preserves request ID across operations', () => {
      const debug = new RoutingDebugInfo('req-specific-id')

      debug.recordDecision('test', 'action')
      debug.print()

      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.requestId).toBe('req-specific-id')
    })
  })

  // ========================================================================
  // Integration Tests
  // ========================================================================

  describe('Integration scenarios', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('handles full routing with debug info', () => {
      const debug = new RoutingDebugInfo('req-integration')
      const span = createRoutingSpan('req-integration', '/customers/456', 'GET')

      debug.recordDecision('start', 'routing')
      debug.recordDecision('location-extracted', 'sjc:us-west-1')
      debug.recordDecision('checking-replicas', 'yes')

      span.end({
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
        replicaRegion: 'us-west-1',
        colo: 'sjc',
        region: 'us-west-1',
      })

      debug.recordDecision('end', 'routing-complete')
      debug.print()

      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('provides headers and events together', () => {
      const event: RoutingEvent = {
        timestamp: Date.now(),
        requestId: 'req-123',
        pathname: '/customers/456',
        method: 'GET',
        colo: 'ewr',
        region: 'us-east-1',
        lat: 40.6895,
        lon: -74.1745,
        nounName: 'customers',
        targetBinding: 'REPLICA_DO',
        consistencyMode: 'eventual',
        isReplica: true,
        replicaRegion: 'us-east-1',
        routingDurationMs: 12,
      }

      const headers = new Headers()
      addRoutingHeaders(headers, event)
      logRoutingEvent(event)

      // Verify headers were set
      expect(headers.get('X-DO-Replica')).toBe('true')
      expect(headers.get('X-DO-Replica-Region')).toBe('us-east-1')

      // Verify event was logged
      expect(consoleSpy).toHaveBeenCalledOnce()
      const logged = JSON.parse(consoleSpy.mock.calls[0][0])
      expect(logged.type).toBe('routing')
    })
  })
})

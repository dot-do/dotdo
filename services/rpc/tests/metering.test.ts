/**
 * Metering Tests
 *
 * Tests for usage metering including:
 * - Event recording
 * - Cost calculation
 * - Sink implementations
 * - Summary generation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  MeteringService,
  InMemoryUsageSink,
  defaultCostCalculator,
  createDevMeteringService,
} from '../src/metering'
import type { UsageEvent, MeteringConfig } from '../src/metering'

describe('Metering', () => {
  describe('InMemoryUsageSink', () => {
    let sink: InMemoryUsageSink

    beforeEach(() => {
      sink = new InMemoryUsageSink()
    })

    it('should write events', async () => {
      const events: UsageEvent[] = [
        {
          id: 'evt-1',
          timestamp: new Date(),
          tenantId: 'tenant-1',
          service: 'agents',
          method: 'list',
          durationMs: 100,
          status: 'success',
          costUnits: 1,
        },
      ]

      await sink.write(events)

      const stored = sink.getEvents()
      expect(stored.length).toBe(1)
      expect(stored[0].id).toBe('evt-1')
    })

    it('should query events by tenant', async () => {
      const now = new Date()
      const events: UsageEvent[] = [
        { id: 'evt-1', timestamp: now, tenantId: 'tenant-1', service: 'agents', method: 'list', durationMs: 100, status: 'success', costUnits: 1 },
        { id: 'evt-2', timestamp: now, tenantId: 'tenant-2', service: 'agents', method: 'list', durationMs: 100, status: 'success', costUnits: 1 },
      ]

      await sink.write(events)

      const results = await sink.query({ tenantId: 'tenant-1' })
      expect(results.length).toBe(1)
      expect(results[0].tenantId).toBe('tenant-1')
    })

    it('should query events by status', async () => {
      const now = new Date()
      const events: UsageEvent[] = [
        { id: 'evt-1', timestamp: now, tenantId: 'tenant-1', service: 'agents', method: 'list', durationMs: 100, status: 'success', costUnits: 1 },
        { id: 'evt-2', timestamp: now, tenantId: 'tenant-1', service: 'agents', method: 'list', durationMs: 100, status: 'error', costUnits: 1 },
      ]

      await sink.write(events)

      const results = await sink.query({ status: 'error' })
      expect(results.length).toBe(1)
      expect(results[0].status).toBe('error')
    })

    it('should generate summary', async () => {
      const now = new Date()
      const events: UsageEvent[] = [
        { id: 'evt-1', timestamp: now, tenantId: 'tenant-1', service: 'agents', method: 'list', durationMs: 100, status: 'success', costUnits: 5 },
        { id: 'evt-2', timestamp: now, tenantId: 'tenant-1', service: 'llm', method: 'complete', durationMs: 200, status: 'success', costUnits: 10, inputTokens: 100, outputTokens: 50 },
        { id: 'evt-3', timestamp: now, tenantId: 'tenant-1', service: 'agents', method: 'invoke', durationMs: 150, status: 'error', costUnits: 2 },
      ]

      await sink.write(events)

      const periodStart = new Date(now.getTime() - 1000)
      const periodEnd = new Date(now.getTime() + 1000)
      const summary = sink.getSummary('tenant-1', periodStart, periodEnd)

      expect(summary.totalRequests).toBe(3)
      expect(summary.successfulRequests).toBe(2)
      expect(summary.failedRequests).toBe(1)
      expect(summary.totalCostUnits).toBe(17)
      expect(summary.totalInputTokens).toBe(100)
      expect(summary.totalOutputTokens).toBe(50)
      expect(summary.byService.agents).toBeDefined()
      expect(summary.byService.agents.requests).toBe(2)
      expect(summary.byService.llm.requests).toBe(1)
    })

    it('should clear events', async () => {
      await sink.write([
        { id: 'evt-1', timestamp: new Date(), tenantId: 'tenant-1', service: 'agents', method: 'list', durationMs: 100, status: 'success', costUnits: 1 },
      ])

      sink.clear()

      expect(sink.getEvents().length).toBe(0)
    })
  })

  describe('Default Cost Calculator', () => {
    it('should return base cost for standard services', () => {
      const cost = defaultCostCalculator('workers', 'deploy', 100)
      expect(cost).toBe(1)
    })

    it('should return higher cost for AI services', () => {
      const llmCost = defaultCostCalculator('llm', 'complete', 100)
      const agentsCost = defaultCostCalculator('agents', 'invoke', 100)

      expect(llmCost).toBe(10)
      expect(agentsCost).toBe(10)
    })

    it('should add token costs', () => {
      const cost = defaultCostCalculator('llm', 'complete', 100, {
        inputTokens: 2000, // 2 units
        outputTokens: 1500, // 3 units
      })

      expect(cost).toBe(10 + 2 + 3) // base + input + output
    })

    it('should reduce cost for cached responses', () => {
      const normalCost = defaultCostCalculator('llm', 'complete', 100)
      const cachedCost = defaultCostCalculator('llm', 'complete', 100, { cached: true })

      expect(cachedCost).toBeLessThan(normalCost)
      expect(cachedCost).toBe(1) // 10 * 0.1 = 1
    })
  })

  describe('MeteringService', () => {
    let service: MeteringService
    let sink: InMemoryUsageSink

    beforeEach(() => {
      const result = createDevMeteringService({ flushIntervalMs: 0 })
      service = result.metering
      sink = result.sink
    })

    afterEach(() => {
      service.stopPeriodicFlush()
    })

    it('should record events', async () => {
      await service.record({
        tenantId: 'tenant-1',
        service: 'agents',
        method: 'list',
        durationMs: 100,
        status: 'success',
      })

      await service.flush()

      const events = sink.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].tenantId).toBe('tenant-1')
      expect(events[0].costUnits).toBeDefined()
    })

    it('should auto-generate ID and timestamp', async () => {
      await service.record({
        tenantId: 'tenant-1',
        service: 'agents',
        method: 'list',
        durationMs: 100,
        status: 'success',
      })

      await service.flush()

      const events = sink.getEvents()
      expect(events[0].id).toBeDefined()
      expect(events[0].timestamp).toBeInstanceOf(Date)
    })

    it('should calculate cost automatically', async () => {
      await service.record({
        tenantId: 'tenant-1',
        service: 'llm',
        method: 'complete',
        durationMs: 100,
        status: 'success',
        inputTokens: 1000,
        outputTokens: 500,
      })

      await service.flush()

      const events = sink.getEvents()
      expect(events[0].costUnits).toBeGreaterThan(1)
    })

    it('should respect disabled config', async () => {
      const { metering: disabledService, sink: disabledSink } = createDevMeteringService({
        enabled: false,
        flushIntervalMs: 0,
      })

      await disabledService.record({
        tenantId: 'tenant-1',
        service: 'agents',
        method: 'list',
        durationMs: 100,
        status: 'success',
      })

      await disabledService.flush()

      expect(disabledSink.getEvents().length).toBe(0)
    })

    it('should buffer events', async () => {
      await service.record({
        tenantId: 'tenant-1',
        service: 'agents',
        method: 'list',
        durationMs: 100,
        status: 'success',
      })

      // Not flushed yet
      expect(sink.getEvents().length).toBe(0)
      expect(service.getBufferSize()).toBe(1)

      await service.flush()

      expect(sink.getEvents().length).toBe(1)
      expect(service.getBufferSize()).toBe(0)
    })
  })
})

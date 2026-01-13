/**
 * Process Mining Tests
 *
 * Tests for business process mining capabilities:
 * - Process discovery from event logs
 * - Conformance checking against process models
 * - Bottleneck detection
 * - Variant analysis
 * - Performance metrics
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createProcessMiningEngine,
  ProcessMiningEngine,
  type ProcessMiningFieldMapping,
  type ExpectedProcessModel,
} from './process-mining'
import { ObjectEvent, type BusinessEvent } from './index'

// =============================================================================
// Test Helpers
// =============================================================================

function createEvent(
  caseId: string,
  activity: string,
  timestamp: Date,
  resource?: string
): BusinessEvent {
  return new ObjectEvent({
    what: [`case:${caseId}`],
    when: timestamp,
    why: activity,
    who: resource,
    action: 'OBSERVE',
    correlationId: caseId,
  })
}

function createEventSequence(
  caseId: string,
  activities: string[],
  startTime: Date,
  intervalMs: number = 60000,
  resource?: string
): BusinessEvent[] {
  return activities.map((activity, idx) => {
    const timestamp = new Date(startTime.getTime() + idx * intervalMs)
    return createEvent(caseId, activity, timestamp, resource)
  })
}

// =============================================================================
// Process Mining Engine Tests
// =============================================================================

describe('ProcessMiningEngine', () => {
  let engine: ProcessMiningEngine

  beforeEach(() => {
    engine = createProcessMiningEngine()
  })

  describe('field extraction', () => {
    it('should extract case ID from correlationId by default', () => {
      const event = createEvent('case-123', 'activity', new Date())
      expect(engine.getCaseId(event)).toBe('case-123')
    })

    it('should extract activity from why by default', () => {
      const event = createEvent('case-123', 'submit_order', new Date())
      expect(engine.getActivity(event)).toBe('submit_order')
    })

    it('should extract timestamp from when by default', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z')
      const event = createEvent('case-123', 'activity', timestamp)
      expect(engine.getTimestamp(event)).toEqual(timestamp)
    })

    it('should extract resource from who by default', () => {
      const event = createEvent('case-123', 'activity', new Date(), 'user-1')
      expect(engine.getResource(event)).toBe('user-1')
    })

    it('should use custom field mapping functions', () => {
      const customMapping: ProcessMiningFieldMapping = {
        caseIdField: (event) => `custom-${event.correlationId}`,
        activityField: (event) => event.action || 'unknown',
        resourceField: (event) => event.channel,
      }
      const customEngine = createProcessMiningEngine(customMapping)

      const event = new ObjectEvent({
        what: ['item-1'],
        when: new Date(),
        action: 'ADD',
        correlationId: 'case-1',
        channel: 'web',
      })

      expect(customEngine.getCaseId(event)).toBe('custom-case-1')
      expect(customEngine.getActivity(event)).toBe('ADD')
      expect(customEngine.getResource(event)).toBe('web')
    })
  })

  describe('trace extraction', () => {
    it('should extract traces from events', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date('2024-01-15T10:00:00Z')),
        ...createEventSequence('case-2', ['A', 'B'], new Date('2024-01-15T11:00:00Z')),
      ]

      const traces = engine.extractTraces(events)

      expect(traces).toHaveLength(2)
      expect(traces[0].caseId).toBe('case-1')
      expect(traces[0].activities).toHaveLength(3)
      expect(traces[1].caseId).toBe('case-2')
      expect(traces[1].activities).toHaveLength(2)
    })

    it('should order activities by timestamp within traces', () => {
      const events = [
        createEvent('case-1', 'C', new Date('2024-01-15T10:02:00Z')),
        createEvent('case-1', 'A', new Date('2024-01-15T10:00:00Z')),
        createEvent('case-1', 'B', new Date('2024-01-15T10:01:00Z')),
      ]

      const traces = engine.extractTraces(events)

      expect(traces[0].activities.map((a) => a.activity)).toEqual(['A', 'B', 'C'])
    })

    it('should calculate trace duration', () => {
      const events = createEventSequence(
        'case-1',
        ['A', 'B', 'C'],
        new Date('2024-01-15T10:00:00Z'),
        60000 // 1 minute intervals
      )

      const traces = engine.extractTraces(events)

      expect(traces[0].duration).toBe(120000) // 2 minutes
    })

    it('should generate variant string', () => {
      const events = createEventSequence('case-1', ['start', 'process', 'end'], new Date())

      const traces = engine.extractTraces(events)

      expect(traces[0].variant).toBe('start -> process -> end')
    })

    it('should filter by case IDs', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date()),
        ...createEventSequence('case-2', ['A', 'C'], new Date()),
        ...createEventSequence('case-3', ['A', 'D'], new Date()),
      ]

      const traces = engine.extractTraces(events, { caseIds: ['case-1', 'case-3'] })

      expect(traces).toHaveLength(2)
      expect(traces.map((t) => t.caseId)).toEqual(['case-1', 'case-3'])
    })

    it('should filter by activities', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
      ]

      const traces = engine.extractTraces(events, { activities: ['A', 'C'] })

      expect(traces[0].activities.map((a) => a.activity)).toEqual(['A', 'C'])
    })

    it('should filter by time range', () => {
      const events = [
        createEvent('case-1', 'A', new Date('2024-01-14T10:00:00Z')),
        createEvent('case-1', 'B', new Date('2024-01-15T10:00:00Z')),
        createEvent('case-1', 'C', new Date('2024-01-16T10:00:00Z')),
      ]

      const traces = engine.extractTraces(events, {
        timeRange: {
          start: new Date('2024-01-15T00:00:00Z'),
          end: new Date('2024-01-16T00:00:00Z'),
        },
      })

      expect(traces[0].activities.map((a) => a.activity)).toEqual(['B'])
    })

    it('should filter by min trace length', () => {
      const events = [
        ...createEventSequence('case-1', ['A'], new Date()),
        ...createEventSequence('case-2', ['A', 'B'], new Date()),
        ...createEventSequence('case-3', ['A', 'B', 'C'], new Date()),
      ]

      const traces = engine.extractTraces(events, { minTraceLength: 2 })

      expect(traces).toHaveLength(2)
      expect(traces.map((t) => t.caseId)).toContain('case-2')
      expect(traces.map((t) => t.caseId)).toContain('case-3')
    })

    it('should filter by max trace length', () => {
      const events = [
        ...createEventSequence('case-1', ['A'], new Date()),
        ...createEventSequence('case-2', ['A', 'B'], new Date()),
        ...createEventSequence('case-3', ['A', 'B', 'C'], new Date()),
      ]

      const traces = engine.extractTraces(events, { maxTraceLength: 2 })

      expect(traces).toHaveLength(2)
      expect(traces.map((t) => t.caseId)).toContain('case-1')
      expect(traces.map((t) => t.caseId)).toContain('case-2')
    })
  })

  describe('process discovery', () => {
    it('should discover activities from events', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-2', ['A', 'B', 'D'], new Date()),
      ]

      const model = engine.discoverProcess(events)

      expect(model.activities.sort()).toEqual(['A', 'B', 'C', 'D'])
    })

    it('should discover start activities', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date()),
        ...createEventSequence('case-2', ['A', 'C'], new Date()),
        ...createEventSequence('case-3', ['B', 'C'], new Date()),
      ]

      const model = engine.discoverProcess(events)

      expect(model.startActivities.get('A')).toBe(2)
      expect(model.startActivities.get('B')).toBe(1)
    })

    it('should discover end activities', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date()),
        ...createEventSequence('case-2', ['A', 'C'], new Date()),
        ...createEventSequence('case-3', ['B', 'C'], new Date()),
      ]

      const model = engine.discoverProcess(events)

      expect(model.endActivities.get('B')).toBe(1)
      expect(model.endActivities.get('C')).toBe(2)
    })

    it('should discover transitions with counts', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-2', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-3', ['A', 'C'], new Date()),
      ]

      const model = engine.discoverProcess(events)

      expect(model.transitions.get('A -> B')?.count).toBe(2)
      expect(model.transitions.get('B -> C')?.count).toBe(2)
      expect(model.transitions.get('A -> C')?.count).toBe(1)
    })

    it('should calculate transition durations', () => {
      const events = createEventSequence(
        'case-1',
        ['A', 'B', 'C'],
        new Date('2024-01-15T10:00:00Z'),
        60000 // 1 minute intervals
      )

      const model = engine.discoverProcess(events)

      const transition = model.transitions.get('A -> B')
      expect(transition?.avgDuration).toBe(60000)
      expect(transition?.minDuration).toBe(60000)
      expect(transition?.maxDuration).toBe(60000)
    })

    it('should count activity frequencies', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'A', 'C'], new Date()),
        ...createEventSequence('case-2', ['A', 'B'], new Date()),
      ]

      const model = engine.discoverProcess(events)

      expect(model.activityFrequencies.get('A')).toBe(3)
      expect(model.activityFrequencies.get('B')).toBe(2)
      expect(model.activityFrequencies.get('C')).toBe(1)
    })

    it('should track trace and event counts', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-2', ['A', 'B'], new Date()),
      ]

      const model = engine.discoverProcess(events)

      expect(model.traceCount).toBe(2)
      expect(model.eventCount).toBe(5)
    })
  })

  describe('variant analysis', () => {
    it('should identify unique process variants', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-2', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-3', ['A', 'C'], new Date()),
      ]

      const variants = engine.analyzeVariants(events)

      expect(variants).toHaveLength(2)
      expect(variants[0].variant).toBe('A -> B -> C')
      expect(variants[0].count).toBe(2)
      expect(variants[1].variant).toBe('A -> C')
      expect(variants[1].count).toBe(1)
    })

    it('should calculate variant percentages', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date()),
        ...createEventSequence('case-2', ['A', 'B'], new Date()),
        ...createEventSequence('case-3', ['A', 'B'], new Date()),
        ...createEventSequence('case-4', ['A', 'C'], new Date()),
      ]

      const variants = engine.analyzeVariants(events)

      expect(variants[0].percentage).toBe(75) // 3 out of 4
      expect(variants[1].percentage).toBe(25) // 1 out of 4
    })

    it('should calculate variant duration statistics', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date('2024-01-15T10:00:00Z'), 60000),
        ...createEventSequence('case-2', ['A', 'B'], new Date('2024-01-15T11:00:00Z'), 120000),
      ]

      const variants = engine.analyzeVariants(events)

      expect(variants[0].avgDuration).toBe(90000) // (60000 + 120000) / 2
      expect(variants[0].minDuration).toBe(60000)
      expect(variants[0].maxDuration).toBe(120000)
    })

    it('should track case IDs for each variant', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date()),
        ...createEventSequence('case-2', ['A', 'B'], new Date()),
        ...createEventSequence('case-3', ['A', 'C'], new Date()),
      ]

      const variants = engine.analyzeVariants(events)

      expect(variants[0].caseIds).toContain('case-1')
      expect(variants[0].caseIds).toContain('case-2')
      expect(variants[1].caseIds).toContain('case-3')
    })

    it('should sort variants by count descending', () => {
      const events = [
        ...createEventSequence('case-1', ['A'], new Date()),
        ...createEventSequence('case-2', ['B'], new Date()),
        ...createEventSequence('case-3', ['B'], new Date()),
        ...createEventSequence('case-4', ['B'], new Date()),
        ...createEventSequence('case-5', ['C'], new Date()),
        ...createEventSequence('case-6', ['C'], new Date()),
      ]

      const variants = engine.analyzeVariants(events)

      expect(variants[0].variant).toBe('B')
      expect(variants[0].count).toBe(3)
      expect(variants[1].variant).toBe('C')
      expect(variants[1].count).toBe(2)
      expect(variants[2].variant).toBe('A')
      expect(variants[2].count).toBe(1)
    })
  })

  describe('conformance checking', () => {
    it('should check conformance against start activities', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date()),
        ...createEventSequence('case-2', ['B', 'C'], new Date()), // Invalid start
      ]

      const expectedModel: ExpectedProcessModel = {
        startActivities: ['A'],
      }

      const result = engine.checkConformance(events, expectedModel)

      expect(result.conformingTraces).toBe(1)
      expect(result.fitness).toBe(0.5)
      expect(result.deviations).toHaveLength(1)
      expect(result.deviations[0].type).toBe('unexpected_activity')
      expect(result.deviations[0].caseId).toBe('case-2')
    })

    it('should check conformance against end activities', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date()),
        ...createEventSequence('case-2', ['A', 'C'], new Date()), // Invalid end
      ]

      const expectedModel: ExpectedProcessModel = {
        endActivities: ['B'],
      }

      const result = engine.checkConformance(events, expectedModel)

      expect(result.conformingTraces).toBe(1)
      expect(result.fitness).toBe(0.5)
    })

    it('should check conformance against allowed transitions', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-2', ['A', 'C'], new Date()), // Invalid: A -> C not allowed
      ]

      const expectedModel: ExpectedProcessModel = {
        allowedTransitions: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      }

      const result = engine.checkConformance(events, expectedModel)

      expect(result.conformingTraces).toBe(1)
      expect(result.deviations.some((d) => d.type === 'invalid_transition')).toBe(true)
    })

    it('should check conformance against required activities', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-2', ['A', 'C'], new Date()), // Missing B
      ]

      const expectedModel: ExpectedProcessModel = {
        requiredActivities: ['B'],
      }

      const result = engine.checkConformance(events, expectedModel)

      expect(result.conformingTraces).toBe(1)
      expect(result.deviations.some((d) => d.type === 'missing_activity')).toBe(true)
    })

    it('should check conformance against forbidden activities', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date()),
        ...createEventSequence('case-2', ['A', 'X', 'B'], new Date()), // X is forbidden
      ]

      const expectedModel: ExpectedProcessModel = {
        forbiddenActivities: ['X'],
      }

      const result = engine.checkConformance(events, expectedModel)

      expect(result.conformingTraces).toBe(1)
      expect(result.deviations.some((d) => d.type === 'unexpected_activity')).toBe(true)
    })

    it('should check conformance against ordering constraints', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-2', ['B', 'A', 'C'], new Date()), // A must come before B
      ]

      const expectedModel: ExpectedProcessModel = {
        orderingConstraints: [{ before: 'A', after: 'B' }],
      }

      const result = engine.checkConformance(events, expectedModel)

      expect(result.conformingTraces).toBe(1)
      expect(result.deviations.some((d) => d.type === 'wrong_order')).toBe(true)
    })

    it('should group deviations by type', () => {
      const events = [
        ...createEventSequence('case-1', ['B', 'C'], new Date()), // Invalid start
        ...createEventSequence('case-2', ['A', 'C'], new Date()), // Missing B
      ]

      const expectedModel: ExpectedProcessModel = {
        startActivities: ['A'],
        requiredActivities: ['B'],
      }

      const result = engine.checkConformance(events, expectedModel)

      expect(result.deviationsByType.has('unexpected_activity')).toBe(true)
      expect(result.deviationsByType.has('missing_activity')).toBe(true)
    })

    it('should return fitness of 1 for fully conforming logs', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
        ...createEventSequence('case-2', ['A', 'B', 'C'], new Date()),
      ]

      const expectedModel: ExpectedProcessModel = {
        startActivities: ['A'],
        endActivities: ['C'],
        requiredActivities: ['B'],
      }

      const result = engine.checkConformance(events, expectedModel)

      expect(result.fitness).toBe(1)
      expect(result.deviations).toHaveLength(0)
    })
  })

  describe('bottleneck detection', () => {
    it('should detect transitions as bottlenecks', () => {
      // Create events with varying transition times
      const events = [
        createEvent('case-1', 'A', new Date('2024-01-15T10:00:00Z')),
        createEvent('case-1', 'B', new Date('2024-01-15T10:10:00Z')), // 10 min
        createEvent('case-1', 'C', new Date('2024-01-15T10:11:00Z')), // 1 min
        createEvent('case-2', 'A', new Date('2024-01-15T11:00:00Z')),
        createEvent('case-2', 'B', new Date('2024-01-15T11:08:00Z')), // 8 min
        createEvent('case-2', 'C', new Date('2024-01-15T11:09:00Z')), // 1 min
      ]

      const bottlenecks = engine.detectBottlenecks(events)

      // A -> B should be the bottleneck (avg 9 min vs B -> C avg 1 min)
      expect(bottlenecks[0].location).toBe('A -> B')
      expect(bottlenecks[0].type).toBe('transition')
    })

    it('should calculate bottleneck statistics', () => {
      const events = [
        createEvent('case-1', 'A', new Date('2024-01-15T10:00:00Z')),
        createEvent('case-1', 'B', new Date('2024-01-15T10:05:00Z')), // 5 min
        createEvent('case-2', 'A', new Date('2024-01-15T11:00:00Z')),
        createEvent('case-2', 'B', new Date('2024-01-15T11:03:00Z')), // 3 min
        createEvent('case-3', 'A', new Date('2024-01-15T12:00:00Z')),
        createEvent('case-3', 'B', new Date('2024-01-15T12:10:00Z')), // 10 min
      ]

      const bottlenecks = engine.detectBottlenecks(events)
      const bottleneck = bottlenecks.find((b) => b.location === 'A -> B')!

      expect(bottleneck.avgTime).toBe(360000) // 6 min avg
      expect(bottleneck.minTime).toBe(180000) // 3 min
      expect(bottleneck.maxTime).toBe(600000) // 10 min
      expect(bottleneck.count).toBe(3)
    })

    it('should calculate severity scores', () => {
      const events = [
        createEvent('case-1', 'A', new Date('2024-01-15T10:00:00Z')),
        createEvent('case-1', 'B', new Date('2024-01-15T10:10:00Z')), // 10 min
        createEvent('case-1', 'C', new Date('2024-01-15T10:11:00Z')), // 1 min
      ]

      const bottlenecks = engine.detectBottlenecks(events)

      // A -> B should have severity 1.0 (highest)
      expect(bottlenecks[0].location).toBe('A -> B')
      expect(bottlenecks[0].severity).toBe(1)
    })

    it('should return top N bottlenecks when specified', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C', 'D', 'E'], new Date(), 60000),
      ]

      const bottlenecks = engine.detectBottlenecks(events, { topN: 2 })

      expect(bottlenecks).toHaveLength(2)
    })

    it('should sort bottlenecks by severity descending', () => {
      const events = [
        createEvent('case-1', 'A', new Date('2024-01-15T10:00:00Z')),
        createEvent('case-1', 'B', new Date('2024-01-15T10:01:00Z')), // 1 min (fast)
        createEvent('case-1', 'C', new Date('2024-01-15T10:11:00Z')), // 10 min (slow)
      ]

      const bottlenecks = engine.detectBottlenecks(events)

      expect(bottlenecks[0].location).toBe('B -> C')
      expect(bottlenecks[1].location).toBe('A -> B')
    })
  })

  describe('performance metrics', () => {
    it('should calculate cycle time statistics', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date('2024-01-15T10:00:00Z'), 60000),
        ...createEventSequence('case-2', ['A', 'B', 'C'], new Date('2024-01-15T11:00:00Z'), 120000),
      ]

      const metrics = engine.calculatePerformance(events)

      expect(metrics.avgCycleTime).toBe(180000) // (2 min + 4 min) / 2
      expect(metrics.minCycleTime).toBe(120000) // 2 min
      expect(metrics.maxCycleTime).toBe(240000) // 4 min
    })

    it('should calculate median cycle time', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date('2024-01-15T10:00:00Z'), 60000),
        ...createEventSequence('case-2', ['A', 'B'], new Date('2024-01-15T11:00:00Z'), 120000),
        ...createEventSequence('case-3', ['A', 'B'], new Date('2024-01-15T12:00:00Z'), 180000),
      ]

      const metrics = engine.calculatePerformance(events)

      expect(metrics.medianCycleTime).toBe(120000) // Middle value
    })

    it('should calculate throughput', () => {
      // Create events spanning 24 hours with 4 cases
      const events = [
        ...createEventSequence('case-1', ['A', 'B'], new Date('2024-01-15T00:00:00Z'), 60000),
        ...createEventSequence('case-2', ['A', 'B'], new Date('2024-01-15T06:00:00Z'), 60000),
        ...createEventSequence('case-3', ['A', 'B'], new Date('2024-01-15T12:00:00Z'), 60000),
        ...createEventSequence('case-4', ['A', 'B'], new Date('2024-01-15T18:00:00Z'), 60000),
      ]

      const metrics = engine.calculatePerformance(events)

      // Time span is about 18 hours (from first event to last event)
      expect(metrics.throughput.casesPerDay).toBeGreaterThan(0)
      expect(metrics.totalCases).toBe(4)
    })

    it('should calculate activity-level performance', () => {
      const events = [
        ...createEventSequence('case-1', ['A', 'B', 'C'], new Date('2024-01-15T10:00:00Z'), 60000),
        ...createEventSequence('case-2', ['A', 'B', 'C'], new Date('2024-01-15T11:00:00Z'), 60000),
      ]

      const metrics = engine.calculatePerformance(events)

      expect(metrics.activityPerformance.get('B')?.count).toBe(2)
      expect(metrics.activityPerformance.get('B')?.avgWaitTime).toBe(60000)
    })

    it('should calculate transition-level performance', () => {
      const events = createEventSequence(
        'case-1',
        ['A', 'B', 'C'],
        new Date('2024-01-15T10:00:00Z'),
        60000
      )

      const metrics = engine.calculatePerformance(events)

      const transition = metrics.transitionPerformance.get('A -> B')
      expect(transition?.avgTime).toBe(60000)
      expect(transition?.count).toBe(1)
    })
  })

  describe('utility methods', () => {
    describe('getCaseStatistics', () => {
      it('should calculate case statistics', () => {
        const events = [
          ...createEventSequence('case-1', ['A', 'B', 'C'], new Date()),
          ...createEventSequence('case-2', ['A', 'B'], new Date()),
          ...createEventSequence('case-3', ['A'], new Date()),
        ]

        const stats = engine.getCaseStatistics(events)

        expect(stats.totalCases).toBe(3)
        expect(stats.avgActivitiesPerCase).toBe(2) // (3 + 2 + 1) / 3
        expect(stats.minActivitiesPerCase).toBe(1)
        expect(stats.maxActivitiesPerCase).toBe(3)
      })
    })

    describe('getResourceStatistics', () => {
      it('should calculate resource statistics', () => {
        const events = [
          createEvent('case-1', 'A', new Date('2024-01-15T10:00:00Z'), 'user-1'),
          createEvent('case-1', 'B', new Date('2024-01-15T10:01:00Z'), 'user-2'),
          createEvent('case-2', 'A', new Date('2024-01-15T11:00:00Z'), 'user-1'),
          createEvent('case-2', 'B', new Date('2024-01-15T11:01:00Z'), 'user-1'),
        ]

        const stats = engine.getResourceStatistics(events)

        expect(stats.resources).toContain('user-1')
        expect(stats.resources).toContain('user-2')
        expect(stats.activityByResource.get('user-1')?.get('A')).toBe(2)
        expect(stats.casesByResource.get('user-1')?.size).toBe(2)
        expect(stats.casesByResource.get('user-2')?.size).toBe(1)
      })
    })

    describe('filterEvents', () => {
      it('should filter events by activities', () => {
        const events = [
          createEvent('case-1', 'A', new Date()),
          createEvent('case-1', 'B', new Date()),
          createEvent('case-1', 'C', new Date()),
        ]

        const filtered = engine.filterEvents(events, { activities: ['A', 'C'] })

        expect(filtered).toHaveLength(2)
        expect(engine.getActivity(filtered[0])).toBe('A')
        expect(engine.getActivity(filtered[1])).toBe('C')
      })

      it('should filter events by resources', () => {
        const events = [
          createEvent('case-1', 'A', new Date(), 'user-1'),
          createEvent('case-1', 'B', new Date(), 'user-2'),
          createEvent('case-1', 'C', new Date(), 'user-1'),
        ]

        const filtered = engine.filterEvents(events, { resources: ['user-1'] })

        expect(filtered).toHaveLength(2)
      })

      it('should filter events by case IDs', () => {
        const events = [
          createEvent('case-1', 'A', new Date()),
          createEvent('case-2', 'A', new Date()),
          createEvent('case-3', 'A', new Date()),
        ]

        const filtered = engine.filterEvents(events, { caseIds: ['case-1', 'case-3'] })

        expect(filtered).toHaveLength(2)
      })

      it('should filter events by time range', () => {
        const events = [
          createEvent('case-1', 'A', new Date('2024-01-14T10:00:00Z')),
          createEvent('case-1', 'B', new Date('2024-01-15T10:00:00Z')),
          createEvent('case-1', 'C', new Date('2024-01-16T10:00:00Z')),
        ]

        const filtered = engine.filterEvents(events, {
          timeRange: {
            start: new Date('2024-01-15T00:00:00Z'),
            end: new Date('2024-01-16T00:00:00Z'),
          },
        })

        expect(filtered).toHaveLength(1)
        expect(engine.getActivity(filtered[0])).toBe('B')
      })

      it('should combine multiple filters', () => {
        const events = [
          createEvent('case-1', 'A', new Date('2024-01-15T10:00:00Z'), 'user-1'),
          createEvent('case-1', 'B', new Date('2024-01-15T11:00:00Z'), 'user-2'),
          createEvent('case-2', 'A', new Date('2024-01-15T10:00:00Z'), 'user-1'),
          createEvent('case-2', 'B', new Date('2024-01-14T10:00:00Z'), 'user-1'), // Out of range
        ]

        const filtered = engine.filterEvents(events, {
          activities: ['A'],
          resources: ['user-1'],
          timeRange: {
            start: new Date('2024-01-15T00:00:00Z'),
          },
        })

        expect(filtered).toHaveLength(2)
      })
    })
  })

  describe('integration scenarios', () => {
    it('should handle a complete order fulfillment process', () => {
      const events = [
        // Order 1: Happy path
        createEvent('order-1', 'order_placed', new Date('2024-01-15T10:00:00Z'), 'customer'),
        createEvent('order-1', 'payment_processed', new Date('2024-01-15T10:01:00Z'), 'payment_system'),
        createEvent('order-1', 'inventory_reserved', new Date('2024-01-15T10:02:00Z'), 'warehouse'),
        createEvent('order-1', 'shipped', new Date('2024-01-15T10:30:00Z'), 'shipping'),
        createEvent('order-1', 'delivered', new Date('2024-01-15T18:00:00Z'), 'shipping'),

        // Order 2: Happy path, faster
        createEvent('order-2', 'order_placed', new Date('2024-01-15T11:00:00Z'), 'customer'),
        createEvent('order-2', 'payment_processed', new Date('2024-01-15T11:00:30Z'), 'payment_system'),
        createEvent('order-2', 'inventory_reserved', new Date('2024-01-15T11:01:00Z'), 'warehouse'),
        createEvent('order-2', 'shipped', new Date('2024-01-15T11:15:00Z'), 'shipping'),
        createEvent('order-2', 'delivered', new Date('2024-01-15T15:00:00Z'), 'shipping'),

        // Order 3: Exception - refund
        createEvent('order-3', 'order_placed', new Date('2024-01-15T12:00:00Z'), 'customer'),
        createEvent('order-3', 'payment_processed', new Date('2024-01-15T12:01:00Z'), 'payment_system'),
        createEvent('order-3', 'refund_requested', new Date('2024-01-15T12:30:00Z'), 'customer'),
        createEvent('order-3', 'refund_processed', new Date('2024-01-15T12:45:00Z'), 'payment_system'),
      ]

      // Discover the process
      const model = engine.discoverProcess(events)
      expect(model.activities).toContain('order_placed')
      expect(model.activities).toContain('refund_requested')
      expect(model.startActivities.get('order_placed')).toBe(3)

      // Analyze variants
      const variants = engine.analyzeVariants(events)
      expect(variants.length).toBeGreaterThanOrEqual(2) // At least happy path and refund path

      // Check conformance against expected model
      const expectedModel: ExpectedProcessModel = {
        startActivities: ['order_placed'],
        requiredActivities: ['payment_processed'],
      }
      const conformance = engine.checkConformance(events, expectedModel)
      expect(conformance.fitness).toBe(1) // All orders have these

      // Detect bottlenecks
      const bottlenecks = engine.detectBottlenecks(events, { topN: 3 })
      expect(bottlenecks.length).toBeGreaterThan(0)

      // Calculate performance
      const performance = engine.calculatePerformance(events)
      expect(performance.totalCases).toBe(3)
      expect(performance.activityPerformance.size).toBeGreaterThan(0)
    })

    it('should handle customer support ticket workflow', () => {
      const events = [
        // Ticket 1: Quick resolution
        createEvent('ticket-1', 'ticket_created', new Date('2024-01-15T09:00:00Z'), 'customer'),
        createEvent('ticket-1', 'assigned', new Date('2024-01-15T09:05:00Z'), 'dispatcher'),
        createEvent('ticket-1', 'resolved', new Date('2024-01-15T09:30:00Z'), 'agent-1'),
        createEvent('ticket-1', 'closed', new Date('2024-01-15T10:00:00Z'), 'customer'),

        // Ticket 2: Escalation needed
        createEvent('ticket-2', 'ticket_created', new Date('2024-01-15T10:00:00Z'), 'customer'),
        createEvent('ticket-2', 'assigned', new Date('2024-01-15T10:10:00Z'), 'dispatcher'),
        createEvent('ticket-2', 'escalated', new Date('2024-01-15T11:00:00Z'), 'agent-1'),
        createEvent('ticket-2', 'resolved', new Date('2024-01-15T14:00:00Z'), 'supervisor'),
        createEvent('ticket-2', 'closed', new Date('2024-01-15T14:30:00Z'), 'customer'),

        // Ticket 3: Reopened
        createEvent('ticket-3', 'ticket_created', new Date('2024-01-15T11:00:00Z'), 'customer'),
        createEvent('ticket-3', 'assigned', new Date('2024-01-15T11:05:00Z'), 'dispatcher'),
        createEvent('ticket-3', 'resolved', new Date('2024-01-15T11:30:00Z'), 'agent-2'),
        createEvent('ticket-3', 'reopened', new Date('2024-01-15T12:00:00Z'), 'customer'),
        createEvent('ticket-3', 'resolved', new Date('2024-01-15T13:00:00Z'), 'agent-2'),
        createEvent('ticket-3', 'closed', new Date('2024-01-15T13:30:00Z'), 'customer'),
      ]

      // Get resource statistics
      const resourceStats = engine.getResourceStatistics(events)
      expect(resourceStats.resources).toContain('agent-1')
      expect(resourceStats.resources).toContain('agent-2')
      expect(resourceStats.resources).toContain('supervisor')

      // Analyze variants to find different resolution paths
      const variants = engine.analyzeVariants(events)
      expect(variants.length).toBe(3) // Three different paths

      // Calculate performance
      const performance = engine.calculatePerformance(events)
      expect(performance.totalCases).toBe(3)
    })
  })
})

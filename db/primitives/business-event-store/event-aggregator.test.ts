/**
 * EventAggregator Tests
 *
 * Tests for dimension-based roll-ups and aggregations of business events.
 * Integrates with WindowManager for time-based windows.
 *
 * Features:
 * - Aggregation by any 5W+H dimension (What, Where, When, Why, Who, How)
 * - Count, sum, avg, min, max aggregations
 * - Group-by with multiple dimensions
 * - Integration with WindowManager for time-based windows
 * - Streaming aggregation support
 *
 * @module db/primitives/business-event-store/event-aggregator.test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  EventAggregator,
  createEventAggregator,
  type AggregationResult,
  type AggregationConfig,
  type AggregationType,
  type DimensionKey,
} from './event-aggregator'
import {
  createBusinessEventStore,
  ObjectEvent,
  TransactionEvent,
  type BusinessEvent,
} from './index'
import { WindowManager, minutes, hours, seconds, EventTimeTrigger } from '../window-manager'

// ============================================================================
// Test Helpers
// ============================================================================

const BASE_TIME = 1704067200000 // 2024-01-01 00:00:00 UTC

function ts(offsetMs: number): number {
  return BASE_TIME + offsetMs
}

function createTestEvent(options: {
  id?: string
  what?: string[]
  when?: Date
  where?: string
  why?: string
  who?: string
  how?: string
  channel?: string
  value?: number
}): ObjectEvent {
  return new ObjectEvent({
    what: options.what || [`object:${options.id || 'test'}`],
    when: options.when || new Date(ts(0)),
    where: options.where,
    why: options.why,
    who: options.who,
    how: options.how,
    channel: options.channel,
    action: 'OBSERVE',
    extensions: options.value !== undefined ? { value: options.value } : undefined,
  })
}

// ============================================================================
// Factory and Configuration Tests
// ============================================================================

describe('EventAggregator', () => {
  describe('createEventAggregator()', () => {
    it('creates an EventAggregator instance', () => {
      const aggregator = createEventAggregator()
      expect(aggregator).toBeDefined()
      expect(aggregator).toBeInstanceOf(EventAggregator)
    })

    it('accepts optional configuration', () => {
      const config: AggregationConfig = {
        defaultAggregations: ['count', 'sum'],
      }
      const aggregator = createEventAggregator(config)
      expect(aggregator).toBeDefined()
    })
  })

  describe('EventAggregator class', () => {
    it('can be constructed directly', () => {
      const aggregator = new EventAggregator()
      expect(aggregator).toBeDefined()
    })

    it('accepts configuration in constructor', () => {
      const aggregator = new EventAggregator({
        defaultAggregations: ['count'],
      })
      expect(aggregator).toBeDefined()
    })
  })

  // ============================================================================
  // Basic Aggregation Tests
  // ============================================================================

  describe('Basic Aggregations', () => {
    describe('count()', () => {
      it('counts total events', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ id: '1' }),
          createTestEvent({ id: '2' }),
          createTestEvent({ id: '3' }),
        ]

        const result = aggregator.count(events)

        expect(result).toBe(3)
      })

      it('returns 0 for empty array', () => {
        const aggregator = createEventAggregator()

        const result = aggregator.count([])

        expect(result).toBe(0)
      })
    })

    describe('sum()', () => {
      it('sums numeric field values', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ id: '1', value: 100 }),
          createTestEvent({ id: '2', value: 200 }),
          createTestEvent({ id: '3', value: 150 }),
        ]

        const result = aggregator.sum(events, 'extensions.value')

        expect(result).toBe(450)
      })

      it('returns 0 for empty array', () => {
        const aggregator = createEventAggregator()

        const result = aggregator.sum([], 'extensions.value')

        expect(result).toBe(0)
      })

      it('ignores events without the specified field', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ id: '1', value: 100 }),
          createTestEvent({ id: '2' }), // No value
          createTestEvent({ id: '3', value: 150 }),
        ]

        const result = aggregator.sum(events, 'extensions.value')

        expect(result).toBe(250)
      })
    })

    describe('avg()', () => {
      it('calculates average of numeric field', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ id: '1', value: 100 }),
          createTestEvent({ id: '2', value: 200 }),
          createTestEvent({ id: '3', value: 150 }),
        ]

        const result = aggregator.avg(events, 'extensions.value')

        expect(result).toBe(150)
      })

      it('returns NaN for empty array', () => {
        const aggregator = createEventAggregator()

        const result = aggregator.avg([], 'extensions.value')

        expect(result).toBeNaN()
      })

      it('only counts events with the field when averaging', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ id: '1', value: 100 }),
          createTestEvent({ id: '2' }), // No value
          createTestEvent({ id: '3', value: 200 }),
        ]

        const result = aggregator.avg(events, 'extensions.value')

        expect(result).toBe(150) // (100 + 200) / 2
      })
    })

    describe('min()', () => {
      it('finds minimum value', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ id: '1', value: 100 }),
          createTestEvent({ id: '2', value: 50 }),
          createTestEvent({ id: '3', value: 150 }),
        ]

        const result = aggregator.min(events, 'extensions.value')

        expect(result).toBe(50)
      })

      it('returns undefined for empty array', () => {
        const aggregator = createEventAggregator()

        const result = aggregator.min([], 'extensions.value')

        expect(result).toBeUndefined()
      })
    })

    describe('max()', () => {
      it('finds maximum value', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ id: '1', value: 100 }),
          createTestEvent({ id: '2', value: 250 }),
          createTestEvent({ id: '3', value: 150 }),
        ]

        const result = aggregator.max(events, 'extensions.value')

        expect(result).toBe(250)
      })

      it('returns undefined for empty array', () => {
        const aggregator = createEventAggregator()

        const result = aggregator.max([], 'extensions.value')

        expect(result).toBeUndefined()
      })
    })
  })

  // ============================================================================
  // 5W+H Dimension Tests
  // ============================================================================

  describe('5W+H Dimension Aggregation', () => {
    describe('groupByDimension()', () => {
      it('groups events by What dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ what: ['product:A'] }),
          createTestEvent({ what: ['product:A'] }),
          createTestEvent({ what: ['product:B'] }),
        ]

        const result = aggregator.groupByDimension(events, 'what')

        expect(Object.keys(result)).toHaveLength(2)
        expect(result['product:A']).toHaveLength(2)
        expect(result['product:B']).toHaveLength(1)
      })

      it('groups events by Where dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'warehouse:NY' }),
          createTestEvent({ where: 'warehouse:NY' }),
          createTestEvent({ where: 'warehouse:LA' }),
        ]

        const result = aggregator.groupByDimension(events, 'where')

        expect(result['warehouse:NY']).toHaveLength(2)
        expect(result['warehouse:LA']).toHaveLength(1)
      })

      it('groups events by Why dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ why: 'shipping' }),
          createTestEvent({ why: 'shipping' }),
          createTestEvent({ why: 'receiving' }),
          createTestEvent({ why: 'returning' }),
        ]

        const result = aggregator.groupByDimension(events, 'why')

        expect(result['shipping']).toHaveLength(2)
        expect(result['receiving']).toHaveLength(1)
        expect(result['returning']).toHaveLength(1)
      })

      it('groups events by Who dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ who: 'user:alice' }),
          createTestEvent({ who: 'user:alice' }),
          createTestEvent({ who: 'user:bob' }),
        ]

        const result = aggregator.groupByDimension(events, 'who')

        expect(result['user:alice']).toHaveLength(2)
        expect(result['user:bob']).toHaveLength(1)
      })

      it('groups events by How dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ how: 'in_transit' }),
          createTestEvent({ how: 'in_transit' }),
          createTestEvent({ how: 'delivered' }),
        ]

        const result = aggregator.groupByDimension(events, 'how')

        expect(result['in_transit']).toHaveLength(2)
        expect(result['delivered']).toHaveLength(1)
      })

      it('groups events by Channel (How sub-dimension)', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ channel: 'web' }),
          createTestEvent({ channel: 'web' }),
          createTestEvent({ channel: 'mobile' }),
          createTestEvent({ channel: 'api' }),
        ]

        const result = aggregator.groupByDimension(events, 'channel')

        expect(result['web']).toHaveLength(2)
        expect(result['mobile']).toHaveLength(1)
        expect(result['api']).toHaveLength(1)
      })

      it('handles events with undefined dimension values', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'warehouse:NY' }),
          createTestEvent({}), // No where
          createTestEvent({ where: 'warehouse:NY' }),
        ]

        const result = aggregator.groupByDimension(events, 'where')

        expect(result['warehouse:NY']).toHaveLength(2)
        expect(result['undefined'] || result['_undefined']).toBeDefined()
      })
    })

    describe('aggregateByDimension()', () => {
      it('aggregates count by dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ why: 'shipping' }),
          createTestEvent({ why: 'shipping' }),
          createTestEvent({ why: 'receiving' }),
        ]

        const result = aggregator.aggregateByDimension(events, 'why', 'count')

        expect(result['shipping'].count).toBe(2)
        expect(result['receiving'].count).toBe(1)
      })

      it('aggregates sum by dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ why: 'shipping', value: 100 }),
          createTestEvent({ why: 'shipping', value: 150 }),
          createTestEvent({ why: 'receiving', value: 200 }),
        ]

        const result = aggregator.aggregateByDimension(events, 'why', 'sum', 'extensions.value')

        expect(result['shipping'].sum).toBe(250)
        expect(result['receiving'].sum).toBe(200)
      })

      it('aggregates avg by dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ who: 'user:alice', value: 100 }),
          createTestEvent({ who: 'user:alice', value: 200 }),
          createTestEvent({ who: 'user:bob', value: 300 }),
        ]

        const result = aggregator.aggregateByDimension(events, 'who', 'avg', 'extensions.value')

        expect(result['user:alice'].avg).toBe(150)
        expect(result['user:bob'].avg).toBe(300)
      })

      it('aggregates multiple types at once', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ channel: 'web', value: 100 }),
          createTestEvent({ channel: 'web', value: 200 }),
          createTestEvent({ channel: 'mobile', value: 150 }),
        ]

        const result = aggregator.aggregateByDimension(
          events,
          'channel',
          ['count', 'sum', 'avg', 'min', 'max'],
          'extensions.value'
        )

        expect(result['web'].count).toBe(2)
        expect(result['web'].sum).toBe(300)
        expect(result['web'].avg).toBe(150)
        expect(result['web'].min).toBe(100)
        expect(result['web'].max).toBe(200)
      })
    })
  })

  // ============================================================================
  // Multi-Dimension Group-By Tests
  // ============================================================================

  describe('Multi-Dimension Group-By', () => {
    describe('groupBy()', () => {
      it('groups by single dimension', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'NY', why: 'shipping' }),
          createTestEvent({ where: 'NY', why: 'receiving' }),
          createTestEvent({ where: 'LA', why: 'shipping' }),
        ]

        const result = aggregator.groupBy(events, ['where'])

        expect(Object.keys(result)).toHaveLength(2)
        expect(result['NY']).toHaveLength(2)
        expect(result['LA']).toHaveLength(1)
      })

      it('groups by two dimensions', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'NY', why: 'shipping' }),
          createTestEvent({ where: 'NY', why: 'shipping' }),
          createTestEvent({ where: 'NY', why: 'receiving' }),
          createTestEvent({ where: 'LA', why: 'shipping' }),
        ]

        const result = aggregator.groupBy(events, ['where', 'why'])

        expect(result['NY|shipping']).toHaveLength(2)
        expect(result['NY|receiving']).toHaveLength(1)
        expect(result['LA|shipping']).toHaveLength(1)
      })

      it('groups by three or more dimensions', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'NY', why: 'shipping', channel: 'web' }),
          createTestEvent({ where: 'NY', why: 'shipping', channel: 'web' }),
          createTestEvent({ where: 'NY', why: 'shipping', channel: 'api' }),
          createTestEvent({ where: 'LA', why: 'receiving', channel: 'mobile' }),
        ]

        const result = aggregator.groupBy(events, ['where', 'why', 'channel'])

        expect(result['NY|shipping|web']).toHaveLength(2)
        expect(result['NY|shipping|api']).toHaveLength(1)
        expect(result['LA|receiving|mobile']).toHaveLength(1)
      })

      it('uses custom key separator', () => {
        const aggregator = createEventAggregator({ keySeparator: '::' })
        const events = [
          createTestEvent({ where: 'NY', why: 'shipping' }),
          createTestEvent({ where: 'LA', why: 'receiving' }),
        ]

        const result = aggregator.groupBy(events, ['where', 'why'])

        expect(Object.keys(result)).toContain('NY::shipping')
        expect(Object.keys(result)).toContain('LA::receiving')
      })
    })

    describe('aggregate()', () => {
      it('aggregates with multiple dimensions and aggregation types', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'NY', why: 'shipping', value: 100 }),
          createTestEvent({ where: 'NY', why: 'shipping', value: 200 }),
          createTestEvent({ where: 'NY', why: 'receiving', value: 150 }),
          createTestEvent({ where: 'LA', why: 'shipping', value: 300 }),
        ]

        const result = aggregator.aggregate(events, {
          groupBy: ['where', 'why'],
          aggregations: ['count', 'sum', 'avg'],
          valueField: 'extensions.value',
        })

        expect(result['NY|shipping'].count).toBe(2)
        expect(result['NY|shipping'].sum).toBe(300)
        expect(result['NY|shipping'].avg).toBe(150)
        expect(result['LA|shipping'].count).toBe(1)
        expect(result['LA|shipping'].sum).toBe(300)
      })

      it('returns structured result with dimension values', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'NY', why: 'shipping', value: 100 }),
          createTestEvent({ where: 'LA', why: 'receiving', value: 200 }),
        ]

        const result = aggregator.aggregate(events, {
          groupBy: ['where', 'why'],
          aggregations: ['count'],
          includeKeys: true,
        })

        expect(result['NY|shipping'].keys).toEqual({ where: 'NY', why: 'shipping' })
        expect(result['LA|receiving'].keys).toEqual({ where: 'LA', why: 'receiving' })
      })
    })
  })

  // ============================================================================
  // WindowManager Integration Tests
  // ============================================================================

  describe('WindowManager Integration', () => {
    describe('withWindowManager()', () => {
      it('integrates with tumbling windows', () => {
        const aggregator = createEventAggregator()
        const windowManager = new WindowManager(WindowManager.tumbling(minutes(5)))
          .withTrigger(new EventTimeTrigger())

        const windowedAggregator = aggregator.withWindowManager(windowManager)

        expect(windowedAggregator).toBeDefined()
      })

      it('returns windowed aggregator for chaining', () => {
        const aggregator = createEventAggregator()
        const windowManager = new WindowManager(WindowManager.tumbling(minutes(5)))

        const result = aggregator.withWindowManager(windowManager)

        expect(result).toBeInstanceOf(EventAggregator)
      })
    })

    describe('processEvent()', () => {
      it('processes events into windows', () => {
        const aggregator = createEventAggregator()
        const windowManager = new WindowManager<BusinessEvent>(WindowManager.tumbling(minutes(5)))
          .withTrigger(new EventTimeTrigger())

        const windowedAggregator = aggregator.withWindowManager(windowManager)

        const event1 = createTestEvent({ when: new Date(ts(60000)), value: 100 })
        const event2 = createTestEvent({ when: new Date(ts(120000)), value: 200 })

        windowedAggregator.processEvent(event1, ts(60000))
        windowedAggregator.processEvent(event2, ts(120000))

        // Events should be in the window
        expect(windowedAggregator.getPendingEventCount()).toBe(2)
      })

      it('triggers aggregation when window fires', () => {
        const aggregator = createEventAggregator()
        const windowManager = new WindowManager<BusinessEvent>(WindowManager.tumbling(minutes(5)))
          .withTrigger(new EventTimeTrigger())

        const results: AggregationResult[] = []
        const windowedAggregator = aggregator
          .withWindowManager(windowManager)
          .onWindowComplete((result) => {
            results.push(result)
          })

        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(60000)), why: 'shipping', value: 100 }),
          ts(60000)
        )
        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(120000)), why: 'shipping', value: 200 }),
          ts(120000)
        )

        // Advance watermark to trigger window
        windowedAggregator.advanceWatermark(ts(300000))

        expect(results).toHaveLength(1)
        expect(results[0].count).toBe(2)
      })
    })

    describe('configureAggregation()', () => {
      it('configures aggregations for windowed results', () => {
        const aggregator = createEventAggregator()
        const windowManager = new WindowManager<BusinessEvent>(WindowManager.tumbling(minutes(5)))
          .withTrigger(new EventTimeTrigger())

        const results: AggregationResult[] = []
        const windowedAggregator = aggregator
          .withWindowManager(windowManager)
          .configureAggregation({
            groupBy: ['why'],
            aggregations: ['count', 'sum'],
            valueField: 'extensions.value',
          })
          .onWindowComplete((result) => {
            results.push(result)
          })

        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(60000)), why: 'shipping', value: 100 }),
          ts(60000)
        )
        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(120000)), why: 'receiving', value: 200 }),
          ts(120000)
        )

        windowedAggregator.advanceWatermark(ts(300000))

        expect(results).toHaveLength(1)
        expect(results[0].groups['shipping'].count).toBe(1)
        expect(results[0].groups['receiving'].count).toBe(1)
      })
    })

    describe('Sliding windows', () => {
      it('aggregates across sliding windows', () => {
        const aggregator = createEventAggregator()
        const windowManager = new WindowManager<BusinessEvent>(
          WindowManager.sliding(minutes(10), minutes(5))
        ).withTrigger(new EventTimeTrigger())

        const results: AggregationResult[] = []
        const windowedAggregator = aggregator
          .withWindowManager(windowManager)
          .onWindowComplete((result) => {
            results.push(result)
          })

        // Add events that will be in multiple windows
        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(3 * 60 * 1000)), value: 100 }),
          ts(3 * 60 * 1000)
        )
        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(7 * 60 * 1000)), value: 200 }),
          ts(7 * 60 * 1000)
        )

        // Advance to trigger windows
        windowedAggregator.advanceWatermark(ts(15 * 60 * 1000))

        // Should have multiple window results
        expect(results.length).toBeGreaterThan(0)
      })
    })

    describe('Session windows', () => {
      it('aggregates session-based events', () => {
        const aggregator = createEventAggregator()
        const windowManager = new WindowManager<BusinessEvent>(WindowManager.session(minutes(5)))
          .withTrigger(new EventTimeTrigger())

        const results: AggregationResult[] = []
        const windowedAggregator = aggregator
          .withWindowManager(windowManager)
          .configureAggregation({
            aggregations: ['count', 'sum'],
            valueField: 'extensions.value',
          })
          .onWindowComplete((result) => {
            results.push(result)
          })

        // First session
        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(0)), value: 100 }),
          ts(0)
        )
        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(2 * 60 * 1000)), value: 150 }),
          ts(2 * 60 * 1000)
        )

        // Gap - new session
        windowedAggregator.processEvent(
          createTestEvent({ when: new Date(ts(15 * 60 * 1000)), value: 200 }),
          ts(15 * 60 * 1000)
        )

        // Trigger all sessions
        windowedAggregator.advanceWatermark(ts(30 * 60 * 1000))

        expect(results).toHaveLength(2)
        expect(results[0].count).toBe(2)
        expect(results[0].sum).toBe(250)
        expect(results[1].count).toBe(1)
        expect(results[1].sum).toBe(200)
      })
    })
  })

  // ============================================================================
  // Streaming Aggregation Tests
  // ============================================================================

  describe('Streaming Aggregation', () => {
    describe('StreamingAggregator', () => {
      it('creates a streaming aggregator', () => {
        const aggregator = createEventAggregator()
        const streaming = aggregator.streaming()

        expect(streaming).toBeDefined()
      })

      it('incrementally updates aggregations', () => {
        const aggregator = createEventAggregator()
        const streaming = aggregator.streaming({
          aggregations: ['count', 'sum'],
          valueField: 'extensions.value',
        })

        streaming.add(createTestEvent({ value: 100 }))
        expect(streaming.getResult().count).toBe(1)
        expect(streaming.getResult().sum).toBe(100)

        streaming.add(createTestEvent({ value: 200 }))
        expect(streaming.getResult().count).toBe(2)
        expect(streaming.getResult().sum).toBe(300)

        streaming.add(createTestEvent({ value: 150 }))
        expect(streaming.getResult().count).toBe(3)
        expect(streaming.getResult().sum).toBe(450)
      })

      it('tracks running average correctly', () => {
        const aggregator = createEventAggregator()
        const streaming = aggregator.streaming({
          aggregations: ['avg'],
          valueField: 'extensions.value',
        })

        streaming.add(createTestEvent({ value: 100 }))
        expect(streaming.getResult().avg).toBe(100)

        streaming.add(createTestEvent({ value: 200 }))
        expect(streaming.getResult().avg).toBe(150)

        streaming.add(createTestEvent({ value: 300 }))
        expect(streaming.getResult().avg).toBe(200)
      })

      it('tracks running min/max correctly', () => {
        const aggregator = createEventAggregator()
        const streaming = aggregator.streaming({
          aggregations: ['min', 'max'],
          valueField: 'extensions.value',
        })

        streaming.add(createTestEvent({ value: 100 }))
        expect(streaming.getResult().min).toBe(100)
        expect(streaming.getResult().max).toBe(100)

        streaming.add(createTestEvent({ value: 50 }))
        expect(streaming.getResult().min).toBe(50)
        expect(streaming.getResult().max).toBe(100)

        streaming.add(createTestEvent({ value: 200 }))
        expect(streaming.getResult().min).toBe(50)
        expect(streaming.getResult().max).toBe(200)
      })

      it('supports grouped streaming aggregation', () => {
        const aggregator = createEventAggregator()
        const streaming = aggregator.streaming({
          groupBy: ['why'],
          aggregations: ['count', 'sum'],
          valueField: 'extensions.value',
        })

        streaming.add(createTestEvent({ why: 'shipping', value: 100 }))
        streaming.add(createTestEvent({ why: 'shipping', value: 200 }))
        streaming.add(createTestEvent({ why: 'receiving', value: 150 }))

        const result = streaming.getGroupedResult()

        expect(result['shipping'].count).toBe(2)
        expect(result['shipping'].sum).toBe(300)
        expect(result['receiving'].count).toBe(1)
        expect(result['receiving'].sum).toBe(150)
      })

      it('can reset streaming state', () => {
        const aggregator = createEventAggregator()
        const streaming = aggregator.streaming({
          aggregations: ['count', 'sum'],
          valueField: 'extensions.value',
        })

        streaming.add(createTestEvent({ value: 100 }))
        streaming.add(createTestEvent({ value: 200 }))
        expect(streaming.getResult().count).toBe(2)

        streaming.reset()

        expect(streaming.getResult().count).toBe(0)
        expect(streaming.getResult().sum).toBe(0)
      })
    })

    describe('Streaming with WindowManager', () => {
      it('emits incremental updates within windows', () => {
        const aggregator = createEventAggregator()
        const windowManager = new WindowManager<BusinessEvent>(WindowManager.tumbling(minutes(5)))

        const updates: AggregationResult[] = []
        const streaming = aggregator
          .withWindowManager(windowManager)
          .streaming({
            aggregations: ['count', 'sum'],
            valueField: 'extensions.value',
            emitOnUpdate: true,
          })
          .onUpdate((result) => {
            updates.push(result)
          })

        streaming.add(createTestEvent({ when: new Date(ts(60000)), value: 100 }), ts(60000))
        streaming.add(createTestEvent({ when: new Date(ts(120000)), value: 200 }), ts(120000))

        expect(updates).toHaveLength(2)
        expect(updates[0].count).toBe(1)
        expect(updates[1].count).toBe(2)
      })
    })
  })

  // ============================================================================
  // Time-based Aggregation Tests
  // ============================================================================

  describe('Time-based Aggregation', () => {
    describe('aggregateByTime()', () => {
      it('aggregates events by hour', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ when: new Date(ts(0)), value: 100 }),
          createTestEvent({ when: new Date(ts(30 * 60 * 1000)), value: 150 }),
          createTestEvent({ when: new Date(ts(60 * 60 * 1000)), value: 200 }),
          createTestEvent({ when: new Date(ts(90 * 60 * 1000)), value: 250 }),
        ]

        const result = aggregator.aggregateByTime(events, 'hour', ['count', 'sum'], 'extensions.value')

        expect(Object.keys(result)).toHaveLength(2) // 2 hours
        expect(result[ts(0)].count).toBe(2) // First hour
        expect(result[ts(60 * 60 * 1000)].count).toBe(2) // Second hour
      })

      it('aggregates events by day', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ when: new Date(ts(0)), value: 100 }),
          createTestEvent({ when: new Date(ts(12 * 60 * 60 * 1000)), value: 150 }),
          createTestEvent({ when: new Date(ts(24 * 60 * 60 * 1000)), value: 200 }),
        ]

        const result = aggregator.aggregateByTime(events, 'day', ['count'], 'extensions.value')

        expect(Object.keys(result)).toHaveLength(2) // 2 days
      })

      it('aggregates events by minute', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ when: new Date(ts(0)), value: 100 }),
          createTestEvent({ when: new Date(ts(30 * 1000)), value: 150 }),
          createTestEvent({ when: new Date(ts(60 * 1000)), value: 200 }),
        ]

        const result = aggregator.aggregateByTime(events, 'minute', ['count'], 'extensions.value')

        expect(Object.keys(result)).toHaveLength(2) // 2 minutes
      })
    })

    describe('aggregateByTimeRange()', () => {
      it('aggregates events within time range', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ when: new Date(ts(0)), value: 100 }),
          createTestEvent({ when: new Date(ts(5 * 60 * 1000)), value: 150 }),
          createTestEvent({ when: new Date(ts(10 * 60 * 1000)), value: 200 }),
          createTestEvent({ when: new Date(ts(20 * 60 * 1000)), value: 250 }),
        ]

        const result = aggregator.aggregateByTimeRange(
          events,
          new Date(ts(0)),
          new Date(ts(15 * 60 * 1000)),
          ['count', 'sum'],
          'extensions.value'
        )

        expect(result.count).toBe(3) // Only first 3 events
        expect(result.sum).toBe(450)
      })
    })
  })

  // ============================================================================
  // Hierarchical Aggregation Tests
  // ============================================================================

  describe('Hierarchical Aggregation', () => {
    describe('rollup()', () => {
      it('performs hierarchical rollup on dimensions', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'US:NY:NYC', why: 'shipping', value: 100 }),
          createTestEvent({ where: 'US:NY:NYC', why: 'shipping', value: 150 }),
          createTestEvent({ where: 'US:NY:Buffalo', why: 'shipping', value: 200 }),
          createTestEvent({ where: 'US:CA:LA', why: 'receiving', value: 250 }),
        ]

        const result = aggregator.rollup(events, {
          dimension: 'where',
          levels: ['country', 'state', 'city'],
          separator: ':',
          aggregations: ['count', 'sum'],
          valueField: 'extensions.value',
        })

        // Should have aggregations at each level
        expect(result.totals.count).toBe(4)
        expect(result.byLevel['country']['US'].count).toBe(4)
        expect(result.byLevel['state']['US:NY'].count).toBe(3)
        expect(result.byLevel['city']['US:NY:NYC'].count).toBe(2)
      })
    })

    describe('drillDown()', () => {
      it('drills down from higher to lower granularity', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'US:NY:NYC', value: 100 }),
          createTestEvent({ where: 'US:NY:NYC', value: 150 }),
          createTestEvent({ where: 'US:NY:Buffalo', value: 200 }),
          createTestEvent({ where: 'US:CA:LA', value: 250 }),
        ]

        // Start at country level, drill to state
        const stateResults = aggregator.drillDown(events, {
          dimension: 'where',
          currentLevel: 'country',
          currentValue: 'US',
          targetLevel: 'state',
          separator: ':',
          aggregations: ['count'],
        })

        expect(stateResults['US:NY'].count).toBe(3)
        expect(stateResults['US:CA'].count).toBe(1)
      })
    })
  })

  // ============================================================================
  // Result Formatting Tests
  // ============================================================================

  describe('Result Formatting', () => {
    describe('toTable()', () => {
      it('formats aggregation results as table rows', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ where: 'NY', why: 'shipping', value: 100 }),
          createTestEvent({ where: 'NY', why: 'shipping', value: 200 }),
          createTestEvent({ where: 'LA', why: 'receiving', value: 150 }),
        ]

        const result = aggregator.aggregate(events, {
          groupBy: ['where', 'why'],
          aggregations: ['count', 'sum'],
          valueField: 'extensions.value',
        })

        const table = aggregator.toTable(result)

        expect(table).toBeInstanceOf(Array)
        expect(table.length).toBe(2)
        expect(table[0]).toHaveProperty('where')
        expect(table[0]).toHaveProperty('why')
        expect(table[0]).toHaveProperty('count')
        expect(table[0]).toHaveProperty('sum')
      })
    })

    describe('toTimeSeries()', () => {
      it('formats time-based aggregations as time series', () => {
        const aggregator = createEventAggregator()
        const events = [
          createTestEvent({ when: new Date(ts(0)), value: 100 }),
          createTestEvent({ when: new Date(ts(60 * 60 * 1000)), value: 200 }),
        ]

        const result = aggregator.aggregateByTime(events, 'hour', ['count'], 'extensions.value')
        const timeSeries = aggregator.toTimeSeries(result)

        expect(timeSeries).toBeInstanceOf(Array)
        expect(timeSeries[0]).toHaveProperty('timestamp')
        expect(timeSeries[0]).toHaveProperty('count')
      })
    })
  })

  // ============================================================================
  // Cleanup and Disposal Tests
  // ============================================================================

  describe('Cleanup and Disposal', () => {
    it('disposes WindowManager when aggregator is disposed', () => {
      const aggregator = createEventAggregator()
      const windowManager = new WindowManager<BusinessEvent>(WindowManager.tumbling(minutes(5)))
        .withTrigger(new EventTimeTrigger())

      const windowedAggregator = aggregator.withWindowManager(windowManager)

      expect(() => windowedAggregator.dispose()).not.toThrow()
      expect(windowManager.getActiveWindowCount()).toBe(0)
    })

    it('clears streaming state on dispose', () => {
      const aggregator = createEventAggregator()
      const streaming = aggregator.streaming({
        aggregations: ['count'],
      })

      streaming.add(createTestEvent({}))
      streaming.add(createTestEvent({}))

      streaming.dispose()

      expect(streaming.getResult().count).toBe(0)
    })
  })
})

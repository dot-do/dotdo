/**
 * RED Tests for Window Primitives
 *
 * These tests define the expected API for Flink-inspired windowing.
 * They are designed to FAIL until implementation is complete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TumblingWindow,
  SlidingWindow,
  SessionWindow,
  WindowManager,
  Watermark,
  Trigger,
  EventTimeTrigger,
  ProcessingTimeTrigger,
} from '../window'

// Test data types
interface Metric {
  timestamp: number
  value: number
}

interface UserEvent {
  userId: string
  type: string
  timestamp: number
}

// =============================================================================
// TUMBLING WINDOWS
// =============================================================================

describe('TumblingWindow', () => {
  describe('creation and configuration', () => {
    it('creates a tumbling window with size string', () => {
      const window = new TumblingWindow<Metric>({
        size: '1h',
      })
      expect(window).toBeDefined()
      expect(window.size).toBe(3600000) // 1 hour in ms
    })

    it('creates a tumbling window with size in milliseconds', () => {
      const window = new TumblingWindow<Metric>({
        size: 60000, // 1 minute
      })
      expect(window.size).toBe(60000)
    })

    it('creates a tumbling window with aggregate function', () => {
      const window = new TumblingWindow<Metric>({
        size: '1h',
        aggregate: (events) => ({
          count: events.length,
          sum: events.reduce((s, e) => s + e.value, 0),
        }),
      })
      expect(window.aggregate).toBeDefined()
    })

    it('throws on invalid size format', () => {
      expect(() => new TumblingWindow<Metric>({ size: 'invalid' })).toThrow()
    })
  })

  describe('event handling', () => {
    let window: TumblingWindow<Metric>

    beforeEach(() => {
      window = new TumblingWindow<Metric>({
        size: '1h',
        aggregate: (events) => ({
          count: events.length,
          sum: events.reduce((s, e) => s + e.value, 0),
          avg: events.reduce((s, e) => s + e.value, 0) / events.length,
        }),
      })
    })

    it('adds events to the current window', async () => {
      const baseTime = Date.now()
      await window.add({ timestamp: baseTime, value: 100 })
      await window.add({ timestamp: baseTime + 1000, value: 200 })

      const current = await window.getCurrent()
      expect(current.events).toHaveLength(2)
    })

    it('returns the current window state with aggregation', async () => {
      const baseTime = Date.now()
      await window.add({ timestamp: baseTime, value: 100 })
      await window.add({ timestamp: baseTime + 1000, value: 200 })

      const current = await window.getCurrent()
      expect(current.result.count).toBe(2)
      expect(current.result.sum).toBe(300)
      expect(current.result.avg).toBe(150)
    })

    it('assigns events to the correct window based on timestamp', async () => {
      const hour1 = new Date('2024-01-14T12:00:00Z').getTime()
      const hour2 = new Date('2024-01-14T13:00:00Z').getTime()

      await window.add({ timestamp: hour1 + 1000, value: 100 })
      await window.add({ timestamp: hour2 + 1000, value: 200 })

      const windows = await window.getAll()
      expect(windows).toHaveLength(2)
    })

    it('handles rapid event ingestion', async () => {
      const baseTime = Date.now()
      const events = Array.from({ length: 1000 }, (_, i) => ({
        timestamp: baseTime + i,
        value: i,
      }))

      await Promise.all(events.map((e) => window.add(e)))

      const current = await window.getCurrent()
      expect(current.result.count).toBe(1000)
    })
  })

  describe('window lifecycle', () => {
    let window: TumblingWindow<Metric>

    beforeEach(() => {
      window = new TumblingWindow<Metric>({
        size: '1h',
        aggregate: (events) => ({ count: events.length }),
      })
    })

    it('closes windows when time advances past window end', async () => {
      const hour1Start = new Date('2024-01-14T12:00:00Z').getTime()
      const hour2Start = new Date('2024-01-14T13:00:00Z').getTime()

      await window.add({ timestamp: hour1Start + 1000, value: 100 })
      await window.add({ timestamp: hour2Start + 1000, value: 200 })

      const closed = await window.getClosed({ limit: 10 })
      expect(closed).toHaveLength(1)
      expect(closed[0].startTime).toBe(hour1Start)
    })

    it('returns closed windows with results', async () => {
      const hour1Start = new Date('2024-01-14T12:00:00Z').getTime()
      const hour2Start = new Date('2024-01-14T13:00:00Z').getTime()

      await window.add({ timestamp: hour1Start + 1000, value: 100 })
      await window.add({ timestamp: hour1Start + 2000, value: 200 })
      await window.add({ timestamp: hour2Start + 1000, value: 300 })

      const closed = await window.getClosed()
      expect(closed[0].result.count).toBe(2)
    })

    it('respects limit when returning closed windows', async () => {
      // Add events across 5 hours
      for (let h = 0; h < 5; h++) {
        const hourStart = new Date('2024-01-14T12:00:00Z').getTime() + h * 3600000
        await window.add({ timestamp: hourStart + 1000, value: 100 })
      }

      const closed = await window.getClosed({ limit: 3 })
      expect(closed).toHaveLength(3)
    })

    it('returns closed windows in chronological order', async () => {
      for (let h = 0; h < 3; h++) {
        const hourStart = new Date('2024-01-14T12:00:00Z').getTime() + h * 3600000
        await window.add({ timestamp: hourStart + 1000, value: 100 })
      }

      const closed = await window.getClosed()
      for (let i = 1; i < closed.length; i++) {
        expect(closed[i].startTime).toBeGreaterThan(closed[i - 1].startTime)
      }
    })
  })

  describe('window identification', () => {
    it('generates unique window IDs', async () => {
      const window = new TumblingWindow<Metric>({
        size: '1h',
        aggregate: (events) => ({ count: events.length }),
      })

      const hour1Start = new Date('2024-01-14T12:00:00Z').getTime()
      await window.add({ timestamp: hour1Start + 1000, value: 100 })

      const current = await window.getCurrent()
      expect(current.windowId).toMatch(/tumbling_\d+/)
    })

    it('calculates correct window boundaries', async () => {
      const window = new TumblingWindow<Metric>({
        size: '1h',
        aggregate: (events) => ({ count: events.length }),
      })

      const midHour = new Date('2024-01-14T12:30:00Z').getTime()
      await window.add({ timestamp: midHour, value: 100 })

      const current = await window.getCurrent()
      expect(current.startTime).toBe(new Date('2024-01-14T12:00:00Z').getTime())
      expect(current.endTime).toBe(new Date('2024-01-14T13:00:00Z').getTime())
    })
  })
})

// =============================================================================
// SLIDING WINDOWS
// =============================================================================

describe('SlidingWindow', () => {
  describe('creation and configuration', () => {
    it('creates a sliding window with size and slide', () => {
      const window = new SlidingWindow<Metric>({
        size: '1h',
        slide: '15m',
      })
      expect(window).toBeDefined()
      expect(window.size).toBe(3600000)
      expect(window.slide).toBe(900000)
    })

    it('throws when slide is larger than size', () => {
      expect(
        () =>
          new SlidingWindow<Metric>({
            size: '15m',
            slide: '1h',
          })
      ).toThrow()
    })

    it('creates sliding window with aggregate function', () => {
      const window = new SlidingWindow<Metric>({
        size: '1h',
        slide: '15m',
        aggregate: (events) => ({
          p50: percentile(events, 50),
          p99: percentile(events, 99),
        }),
      })
      expect(window.aggregate).toBeDefined()
    })
  })

  describe('overlapping windows', () => {
    let window: SlidingWindow<Metric>

    beforeEach(() => {
      window = new SlidingWindow<Metric>({
        size: '1h',
        slide: '15m',
        aggregate: (events) => ({
          count: events.length,
          sum: events.reduce((s, e) => s + e.value, 0),
        }),
      })
    })

    it('assigns events to multiple overlapping windows', async () => {
      const baseTime = new Date('2024-01-14T12:30:00Z').getTime()
      await window.add({ timestamp: baseTime, value: 100 })

      // Event at 12:30 should be in windows starting at:
      // 12:00, 12:15, 12:30 (size 1h, slide 15m)
      const active = await window.getActive()
      expect(active.length).toBeGreaterThanOrEqual(3)
    })

    it('returns all windows containing an event', async () => {
      const baseTime = new Date('2024-01-14T12:30:00Z').getTime()
      await window.add({ timestamp: baseTime, value: 100 })

      const windows = await window.getWindowsForEvent({ timestamp: baseTime, value: 100 })
      expect(windows.length).toBe(4) // 11:30-12:30, 11:45-12:45, 12:00-13:00, 12:15-13:15
    })

    it('calculates correct aggregates for each overlapping window', async () => {
      const baseTime = new Date('2024-01-14T12:00:00Z').getTime()

      // Add events at 12:10, 12:20, 12:40
      await window.add({ timestamp: baseTime + 10 * 60000, value: 100 })
      await window.add({ timestamp: baseTime + 20 * 60000, value: 200 })
      await window.add({ timestamp: baseTime + 40 * 60000, value: 300 })

      const active = await window.getActive()
      // Different windows should have different event counts
      const counts = active.map((w) => w.result.count)
      expect(new Set(counts).size).toBeGreaterThan(1)
    })
  })

  describe('window lifecycle', () => {
    let window: SlidingWindow<Metric>

    beforeEach(() => {
      window = new SlidingWindow<Metric>({
        size: '1h',
        slide: '15m',
        aggregate: (events) => ({ count: events.length }),
      })
    })

    it('closes windows at correct intervals', async () => {
      const baseTime = new Date('2024-01-14T12:00:00Z').getTime()
      const laterTime = baseTime + 2 * 3600000 // 2 hours later

      await window.add({ timestamp: baseTime, value: 100 })
      await window.add({ timestamp: laterTime, value: 200 })

      const closed = await window.getClosed()
      // Windows should close every 15 minutes
      const timeDiffs = closed.slice(1).map((w, i) => w.endTime - closed[i].endTime)
      timeDiffs.forEach((diff) => expect(diff).toBe(900000))
    })

    it('handles high overlap ratios correctly', async () => {
      const highOverlap = new SlidingWindow<Metric>({
        size: '1h',
        slide: '1m', // 60 windows overlap
        aggregate: (events) => ({ count: events.length }),
      })

      const baseTime = new Date('2024-01-14T12:30:00Z').getTime()
      await highOverlap.add({ timestamp: baseTime, value: 100 })

      const active = await highOverlap.getActive()
      expect(active.length).toBe(60)
    })
  })
})

// =============================================================================
// SESSION WINDOWS
// =============================================================================

describe('SessionWindow', () => {
  describe('creation and configuration', () => {
    it('creates a session window with gap', () => {
      const window = new SessionWindow<UserEvent>({
        gap: '30m',
        keyBy: (event) => event.userId,
      })
      expect(window).toBeDefined()
      expect(window.gap).toBe(1800000)
    })

    it('creates session window with string keyBy', () => {
      const window = new SessionWindow<UserEvent>({
        gap: '30m',
        keyBy: 'userId',
      })
      expect(window.keyExtractor).toBeDefined()
    })

    it('creates session window with aggregate function', () => {
      const window = new SessionWindow<UserEvent>({
        gap: '30m',
        keyBy: (event) => event.userId,
        aggregate: (events) => ({
          duration: events[events.length - 1].timestamp - events[0].timestamp,
          pageViews: events.filter((e) => e.type === 'pageView').length,
          actions: events.length,
        }),
      })
      expect(window.aggregate).toBeDefined()
    })
  })

  describe('session creation', () => {
    let window: SessionWindow<UserEvent>

    beforeEach(() => {
      window = new SessionWindow<UserEvent>({
        gap: '30m',
        keyBy: (event) => event.userId,
        aggregate: (events) => ({
          duration: events[events.length - 1].timestamp - events[0].timestamp,
          actions: events.length,
        }),
      })
    })

    it('creates a session on first event', async () => {
      const t = Date.now()
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })

      const sessions = await window.getByKey('alice')
      expect(sessions).toHaveLength(1)
    })

    it('extends session with events within gap', async () => {
      const t = Date.now()
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })
      await window.add({ userId: 'alice', type: 'click', timestamp: t + 60000 }) // 1 min later
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t + 120000 }) // 2 min later

      const sessions = await window.getByKey('alice')
      expect(sessions).toHaveLength(1)
      expect(sessions[0].result.actions).toBe(3)
    })

    it('creates new session after gap exceeded', async () => {
      const t = Date.now()
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t + 2000000 }) // 33+ min later

      const sessions = await window.getByKey('alice')
      expect(sessions).toHaveLength(2)
    })

    it('maintains separate sessions per key', async () => {
      const t = Date.now()
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })
      await window.add({ userId: 'bob', type: 'pageView', timestamp: t })
      await window.add({ userId: 'alice', type: 'click', timestamp: t + 1000 })

      const aliceSessions = await window.getByKey('alice')
      const bobSessions = await window.getByKey('bob')

      expect(aliceSessions[0].result.actions).toBe(2)
      expect(bobSessions[0].result.actions).toBe(1)
    })
  })

  describe('session aggregation', () => {
    it('calculates session duration correctly', async () => {
      const window = new SessionWindow<UserEvent>({
        gap: '30m',
        keyBy: (event) => event.userId,
        aggregate: (events) => ({
          duration: events[events.length - 1].timestamp - events[0].timestamp,
        }),
      })

      const t = Date.now()
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })
      await window.add({ userId: 'alice', type: 'click', timestamp: t + 300000 }) // 5 min

      const sessions = await window.getByKey('alice')
      expect(sessions[0].result.duration).toBe(300000)
    })

    it('updates aggregation on each event', async () => {
      const window = new SessionWindow<UserEvent>({
        gap: '30m',
        keyBy: (event) => event.userId,
        aggregate: (events) => ({ actions: events.length }),
      })

      const t = Date.now()
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })

      let sessions = await window.getByKey('alice')
      expect(sessions[0].result.actions).toBe(1)

      await window.add({ userId: 'alice', type: 'click', timestamp: t + 1000 })

      sessions = await window.getByKey('alice')
      expect(sessions[0].result.actions).toBe(2)
    })
  })

  describe('session closing', () => {
    let window: SessionWindow<UserEvent>

    beforeEach(() => {
      window = new SessionWindow<UserEvent>({
        gap: '30m',
        keyBy: (event) => event.userId,
        aggregate: (events) => ({ actions: events.length }),
      })
    })

    it('closes session after gap timeout', async () => {
      const t = Date.now()
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t + 2000000 })

      const closed = await window.getClosed()
      expect(closed).toHaveLength(1)
    })

    it('returns active sessions separately from closed', async () => {
      const t = Date.now()
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t + 2000000 })

      const active = await window.getActive()
      const closed = await window.getClosed()

      expect(active).toHaveLength(1)
      expect(closed).toHaveLength(1)
    })
  })

  describe('session merging', () => {
    it('merges overlapping sessions on late arrival', async () => {
      const window = new SessionWindow<UserEvent>({
        gap: '30m',
        keyBy: (event) => event.userId,
        aggregate: (events) => ({ actions: events.length }),
      })

      const t = Date.now()
      // Create two separate sessions
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t })
      await window.add({ userId: 'alice', type: 'pageView', timestamp: t + 3600000 }) // 1 hour later

      let sessions = await window.getByKey('alice')
      expect(sessions).toHaveLength(2)

      // Late event bridges the gap
      // For bridging: event at t+31min → Session 1 extends to t+31min
      // Gap to Session 2 at t+60min = 29min < 30min threshold → merge!
      await window.add({ userId: 'alice', type: 'click', timestamp: t + 1860000 }) // ~31 min

      sessions = await window.getByKey('alice')
      expect(sessions).toHaveLength(1) // Merged into one
      expect(sessions[0].result.actions).toBe(3)
    })
  })
})

// =============================================================================
// WATERMARKS
// =============================================================================

describe('Watermark', () => {
  describe('creation', () => {
    it('creates a watermark from timestamp', () => {
      const wm = new Watermark(Date.now())
      expect(wm).toBeDefined()
      expect(wm.timestamp).toBeDefined()
    })

    it('creates a watermark from ISO string', () => {
      const wm = new Watermark('2024-01-14T12:00:00Z')
      expect(wm.timestamp).toBe(new Date('2024-01-14T12:00:00Z').getTime())
    })
  })

  describe('comparison', () => {
    it('compares watermarks correctly', () => {
      const wm1 = new Watermark('2024-01-14T12:00:00Z')
      const wm2 = new Watermark('2024-01-14T13:00:00Z')

      expect(wm1.isBefore(wm2)).toBe(true)
      expect(wm2.isAfter(wm1)).toBe(true)
      expect(wm1.equals(new Watermark('2024-01-14T12:00:00Z'))).toBe(true)
    })
  })

  describe('advancement', () => {
    it('advances watermark correctly', () => {
      const wm = new Watermark('2024-01-14T12:00:00Z')
      const advanced = wm.advance('1h')

      expect(advanced.timestamp).toBe(new Date('2024-01-14T13:00:00Z').getTime())
    })
  })
})

// =============================================================================
// WINDOW MANAGER
// =============================================================================

describe('WindowManager', () => {
  describe('creation and configuration', () => {
    it('creates a window manager with default options', () => {
      const manager = new WindowManager()
      expect(manager).toBeDefined()
    })

    it('creates a window manager with watermark strategy', () => {
      const manager = new WindowManager({
        watermarkStrategy: 'bounded',
        maxOutOfOrder: '5m',
        allowedLateness: '1h',
      })
      expect(manager.watermarkStrategy).toBe('bounded')
    })

    it('creates a window manager with punctuated watermarks', () => {
      const manager = new WindowManager({
        watermarkStrategy: 'punctuated',
      })
      expect(manager.watermarkStrategy).toBe('punctuated')
    })
  })

  describe('window registration', () => {
    let manager: WindowManager

    beforeEach(() => {
      manager = new WindowManager()
    })

    it('registers a tumbling window', () => {
      manager.register('hourly_metrics', new TumblingWindow({ size: '1h' }))
      const window = manager.get('hourly_metrics')
      expect(window).toBeDefined()
    })

    it('registers a sliding window', () => {
      manager.register('rolling_p99', new SlidingWindow({ size: '1h', slide: '5m' }))
      const window = manager.get('rolling_p99')
      expect(window).toBeDefined()
    })

    it('registers a session window', () => {
      manager.register('user_sessions', new SessionWindow({ gap: '30m', keyBy: 'userId' }))
      const window = manager.get('user_sessions')
      expect(window).toBeDefined()
    })

    it('throws on duplicate window name', () => {
      manager.register('test', new TumblingWindow({ size: '1h' }))
      expect(() => manager.register('test', new TumblingWindow({ size: '1h' }))).toThrow()
    })

    it('returns undefined for unregistered window', () => {
      expect(manager.get('nonexistent')).toBeUndefined()
    })
  })

  describe('event routing', () => {
    let manager: WindowManager

    beforeEach(() => {
      manager = new WindowManager()
      manager.register(
        'hourly',
        new TumblingWindow({
          size: '1h',
          aggregate: (events) => ({ count: events.length }),
        })
      )
      manager.register(
        'rolling',
        new SlidingWindow({
          size: '1h',
          slide: '15m',
          aggregate: (events) => ({ count: events.length }),
        })
      )
    })

    it('routes events to all registered windows', async () => {
      await manager.add({
        timestamp: Date.now(),
        userId: 'alice',
        metric: 'latency',
        value: 150,
      })

      const hourly = await manager.get('hourly').getCurrent()
      const rolling = await manager.get('rolling').getActive()

      expect(hourly.result.count).toBe(1)
      expect(rolling.some((w) => w.result.count === 1)).toBe(true)
    })

    it('updates watermark on event addition', async () => {
      const manager = new WindowManager({
        watermarkStrategy: 'bounded',
        maxOutOfOrder: '5m',
      })

      const eventTime = Date.now()
      await manager.add({ timestamp: eventTime, value: 100 })

      expect(manager.currentWatermark.timestamp).toBe(eventTime - 5 * 60000)
    })
  })

  describe('watermark handling', () => {
    let manager: WindowManager

    beforeEach(() => {
      manager = new WindowManager({
        watermarkStrategy: 'bounded',
        maxOutOfOrder: '5m',
        allowedLateness: '1h',
      })
    })

    it('advances watermark as events arrive', async () => {
      const t1 = Date.now()
      const t2 = t1 + 60000

      await manager.add({ timestamp: t1, value: 100 })
      const wm1 = manager.currentWatermark.timestamp

      await manager.add({ timestamp: t2, value: 200 })
      const wm2 = manager.currentWatermark.timestamp

      expect(wm2).toBeGreaterThan(wm1)
    })

    it('holds watermark for out-of-order events', async () => {
      const t1 = Date.now()
      const t2 = t1 - 60000 // 1 minute earlier

      await manager.add({ timestamp: t1, value: 100 })
      const wm1 = manager.currentWatermark.timestamp

      await manager.add({ timestamp: t2, value: 200 })
      const wm2 = manager.currentWatermark.timestamp

      expect(wm2).toBe(wm1) // Watermark should not go backwards
    })
  })

  describe('late data handling', () => {
    let manager: WindowManager
    let lateDataHandler: ReturnType<typeof vi.fn>

    beforeEach(() => {
      lateDataHandler = vi.fn()
      manager = new WindowManager({
        watermarkStrategy: 'bounded',
        maxOutOfOrder: '5m',
        allowedLateness: '1h',
      })
      manager.register(
        'hourly',
        new TumblingWindow({
          size: '1h',
          aggregate: (events) => ({ count: events.length }),
        })
      )
      manager.on('lateData', lateDataHandler)
    })

    it('emits lateData event for events after watermark', async () => {
      const currentTime = Date.now()
      const lateTime = currentTime - 10 * 60000 // 10 minutes ago

      // Advance watermark
      await manager.add({ timestamp: currentTime, value: 100 })

      // Send late event
      await manager.add({ timestamp: lateTime, value: 200 })

      expect(lateDataHandler).toHaveBeenCalled()
    })

    it('includes event and target window in late data callback', async () => {
      const currentTime = Date.now()
      const lateTime = currentTime - 10 * 60000

      await manager.add({ timestamp: currentTime, value: 100 })
      await manager.add({ timestamp: lateTime, value: 200 })

      expect(lateDataHandler).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: lateTime }),
        expect.objectContaining({ windowId: expect.any(String) })
      )
    })

    it('accepts late data within allowedLateness', async () => {
      const currentTime = Date.now()
      const lateTime = currentTime - 30 * 60000 // 30 minutes ago (within 1h)

      await manager.add({ timestamp: currentTime, value: 100 })
      const result = await manager.add({ timestamp: lateTime, value: 200 })

      expect(result.accepted).toBe(true)
    })

    it('rejects late data beyond allowedLateness', async () => {
      const currentTime = Date.now()
      const tooLateTime = currentTime - 2 * 3600000 // 2 hours ago

      await manager.add({ timestamp: currentTime, value: 100 })
      const result = await manager.add({ timestamp: tooLateTime, value: 200 })

      expect(result.accepted).toBe(false)
      expect(result.reason).toBe('beyond_allowed_lateness')
    })
  })

  describe('window close events', () => {
    let manager: WindowManager
    let closeHandler: ReturnType<typeof vi.fn>

    beforeEach(() => {
      closeHandler = vi.fn()
      manager = new WindowManager()
      manager.register(
        'hourly',
        new TumblingWindow({
          size: '1h',
          aggregate: (events) => ({ count: events.length }),
        })
      )
      manager.on('windowClose', closeHandler)
    })

    it('emits windowClose event when window closes', async () => {
      const hour1 = new Date('2024-01-14T12:00:00Z').getTime()
      const hour2 = new Date('2024-01-14T13:00:00Z').getTime()

      await manager.add({ timestamp: hour1 + 1000, value: 100 })
      await manager.add({ timestamp: hour2 + 1000, value: 200 })

      expect(closeHandler).toHaveBeenCalled()
    })

    it('includes window ID and result in close event', async () => {
      const hour1 = new Date('2024-01-14T12:00:00Z').getTime()
      const hour2 = new Date('2024-01-14T13:00:00Z').getTime()

      await manager.add({ timestamp: hour1 + 1000, value: 100 })
      await manager.add({ timestamp: hour2 + 1000, value: 200 })

      expect(closeHandler).toHaveBeenCalledWith('hourly', expect.objectContaining({ count: 1 }), expect.anything())
    })

    it('emits windowClose with full window metadata', async () => {
      const hour1 = new Date('2024-01-14T12:00:00Z').getTime()
      const hour2 = new Date('2024-01-14T13:00:00Z').getTime()

      await manager.add({ timestamp: hour1 + 1000, value: 100 })
      await manager.add({ timestamp: hour2 + 1000, value: 200 })

      expect(closeHandler).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          windowType: 'tumbling',
          startTime: hour1,
          endTime: hour2,
        })
      )
    })
  })
})

// =============================================================================
// TRIGGERS
// =============================================================================

describe('Trigger', () => {
  describe('EventTimeTrigger', () => {
    it('creates an event time trigger', () => {
      const trigger = new EventTimeTrigger()
      expect(trigger).toBeDefined()
    })

    it('fires when watermark passes window end', async () => {
      const trigger = new EventTimeTrigger()
      const windowEnd = new Date('2024-01-14T13:00:00Z').getTime()
      const watermark = new Watermark('2024-01-14T13:00:01Z')

      const shouldFire = trigger.shouldFire({ windowEnd, watermark })
      expect(shouldFire).toBe(true)
    })

    it('does not fire before watermark reaches window end', async () => {
      const trigger = new EventTimeTrigger()
      const windowEnd = new Date('2024-01-14T13:00:00Z').getTime()
      const watermark = new Watermark('2024-01-14T12:30:00Z')

      const shouldFire = trigger.shouldFire({ windowEnd, watermark })
      expect(shouldFire).toBe(false)
    })
  })

  describe('ProcessingTimeTrigger', () => {
    it('creates a processing time trigger with duration', () => {
      const trigger = new ProcessingTimeTrigger('1m')
      expect(trigger).toBeDefined()
      expect(trigger.interval).toBe(60000)
    })

    it('fires after processing time duration', async () => {
      const trigger = new ProcessingTimeTrigger('1m')
      const windowCreated = Date.now() - 120000 // 2 minutes ago

      const shouldFire = trigger.shouldFire({ windowCreated, now: Date.now() })
      expect(shouldFire).toBe(true)
    })
  })

  describe('Trigger.Count', () => {
    it('creates a count trigger', () => {
      const trigger = new Trigger.Count(100)
      expect(trigger).toBeDefined()
      expect(trigger.threshold).toBe(100)
    })

    it('fires when event count reaches threshold', () => {
      const trigger = new Trigger.Count(100)
      const shouldFire = trigger.shouldFire({ eventCount: 100 })
      expect(shouldFire).toBe(true)
    })

    it('does not fire below threshold', () => {
      const trigger = new Trigger.Count(100)
      const shouldFire = trigger.shouldFire({ eventCount: 99 })
      expect(shouldFire).toBe(false)
    })
  })

  describe('Trigger.timeout', () => {
    it('creates a timeout trigger', () => {
      const trigger = Trigger.timeout('5m')
      expect(trigger).toBeDefined()
      expect(trigger.timeout).toBe(300000)
    })

    it('fires if no events for duration', () => {
      const trigger = Trigger.timeout('5m')
      const lastEventTime = Date.now() - 6 * 60000 // 6 minutes ago

      const shouldFire = trigger.shouldFire({ lastEventTime, now: Date.now() })
      expect(shouldFire).toBe(true)
    })
  })

  describe('Trigger.any', () => {
    it('combines multiple triggers with OR logic', () => {
      const combined = Trigger.any([new EventTimeTrigger(), new Trigger.Count(100), Trigger.timeout('5m')])

      expect(combined).toBeDefined()
      expect(combined.triggers).toHaveLength(3)
    })

    it('fires when any trigger fires', () => {
      const combined = Trigger.any([new EventTimeTrigger(), new Trigger.Count(100)])

      // Count trigger should fire
      const shouldFire = combined.shouldFire({
        eventCount: 100,
        windowEnd: Date.now() + 3600000,
        watermark: new Watermark(Date.now()),
      })

      expect(shouldFire).toBe(true)
    })
  })

  describe('Window with custom trigger', () => {
    it('applies custom trigger to tumbling window', async () => {
      const countTrigger = new Trigger.Count(10)
      const window = new TumblingWindow<Metric>({
        size: '1h',
        trigger: countTrigger,
        aggregate: (events) => ({ count: events.length }),
      })

      // Add 10 events
      for (let i = 0; i < 10; i++) {
        await window.add({ timestamp: Date.now(), value: i })
      }

      // Window should fire early due to count trigger
      const fired = await window.getFired()
      expect(fired).toHaveLength(1)
    })

    it('supports combined triggers on windows', async () => {
      const combinedTrigger = Trigger.any([new EventTimeTrigger(), new Trigger.Count(100), Trigger.timeout('5m')])

      const window = new TumblingWindow<Metric>({
        size: '1h',
        trigger: combinedTrigger,
        aggregate: (events) => ({ count: events.length }),
      })

      expect(window.trigger).toBe(combinedTrigger)
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Window Integration', () => {
  describe('end-to-end workflow', () => {
    it('processes events through complete window lifecycle', async () => {
      const manager = new WindowManager({
        watermarkStrategy: 'bounded',
        maxOutOfOrder: '5m',
        allowedLateness: '1h',
      })

      manager.register(
        'hourly_metrics',
        new TumblingWindow({
          size: '1h',
          aggregate: (events) => ({
            count: events.length,
            sum: events.reduce((s, e) => s + e.value, 0),
          }),
        })
      )

      const closedWindows: unknown[] = []
      manager.on('windowClose', (windowId, result) => {
        closedWindows.push({ windowId, result })
      })

      // Add events across multiple hours
      const baseTime = new Date('2024-01-14T12:00:00Z').getTime()
      for (let h = 0; h < 3; h++) {
        for (let i = 0; i < 5; i++) {
          await manager.add({
            timestamp: baseTime + h * 3600000 + i * 60000,
            value: (h + 1) * 10,
          })
        }
      }

      // Two windows should be closed
      expect(closedWindows).toHaveLength(2)
      expect(closedWindows[0]).toEqual({
        windowId: expect.any(String),
        result: { count: 5, sum: 50 },
      })
    })

    it('handles complex windowing scenarios', async () => {
      const manager = new WindowManager()

      // Register multiple window types
      manager.register(
        'tumbling_1h',
        new TumblingWindow({
          size: '1h',
          aggregate: (events) => ({ count: events.length }),
        })
      )

      manager.register(
        'sliding_1h_15m',
        new SlidingWindow({
          size: '1h',
          slide: '15m',
          aggregate: (events) => ({ count: events.length }),
        })
      )

      manager.register(
        'sessions',
        new SessionWindow({
          gap: '30m',
          keyBy: 'userId',
          aggregate: (events) => ({ actions: events.length }),
        })
      )

      // Add events
      const t = Date.now()
      await manager.add({ timestamp: t, userId: 'alice', value: 1 })
      await manager.add({ timestamp: t + 1000, userId: 'bob', value: 2 })
      await manager.add({ timestamp: t + 2000, userId: 'alice', value: 3 })

      // Query all window types
      const tumbling = await manager.get('tumbling_1h').getCurrent()
      const sliding = await manager.get('sliding_1h_15m').getActive()
      const aliceSessions = await manager.get('sessions').getByKey('alice')

      expect(tumbling.result.count).toBe(3)
      expect(sliding.length).toBeGreaterThan(0)
      expect(aliceSessions[0].result.actions).toBe(2)
    })
  })

  describe('persistence and recovery', () => {
    it('survives window restart with state intact', async () => {
      // Simulate window with persistent state
      const window1 = new TumblingWindow<Metric>({
        size: '1h',
        aggregate: (events) => ({ count: events.length }),
      })

      await window1.add({ timestamp: Date.now(), value: 100 })
      const state = await window1.getState()

      // Create new window with restored state
      const window2 = new TumblingWindow<Metric>({
        size: '1h',
        aggregate: (events) => ({ count: events.length }),
        initialState: state,
      })

      const current = await window2.getCurrent()
      expect(current.result.count).toBe(1)
    })
  })
})

// =============================================================================
// HELPERS
// =============================================================================

function percentile(events: Metric[], p: number): number {
  const sorted = [...events].sort((a, b) => a.value - b.value)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[index]?.value ?? 0
}

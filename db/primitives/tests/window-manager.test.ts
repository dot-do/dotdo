/**
 * Window Manager Tests - TDD RED Phase
 *
 * Comprehensive tests for stream windowing primitives inspired by
 * Apache Flink's windowing semantics. These tests verify:
 * - Tumbling windows (non-overlapping, fixed-size)
 * - Sliding windows (overlapping, fixed-size with slide interval)
 * - Session windows (gap-based, dynamic size)
 * - Global windows (single window for all elements)
 * - Trigger mechanisms (watermark, count-based)
 * - Late data handling and side outputs
 * - Window state management and cleanup
 *
 * Tests should FAIL until window-manager.ts is implemented.
 *
 * @see https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/windows/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// These imports should FAIL until implemented
import {
  WindowManager,
  WindowAssigner,
  Window,
  Trigger,
  TriggerResult,
  // Duration helpers
  hours,
  minutes,
  seconds,
  milliseconds,
  // Trigger types
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  // Types
  type Duration,
  type WindowState,
  type LateDataHandler,
} from '../window-manager'

// ============================================================================
// Test Fixtures
// ============================================================================

interface Event {
  id: string
  value: number
  category?: string
}

interface ClickEvent extends Event {
  userId: string
  page: string
}

interface SensorReading extends Event {
  sensorId: string
  temperature: number
}

/**
 * Helper to create timestamps relative to a base time
 */
const BASE_TIME = 1704067200000 // 2024-01-01 00:00:00 UTC

function ts(offsetMs: number): number {
  return BASE_TIME + offsetMs
}

function createEvent(id: string, value: number, timestampOffset: number): Event {
  return { id, value }
}

// ============================================================================
// Duration Helper Tests
// ============================================================================

describe('Duration Helpers', () => {
  describe('hours()', () => {
    it('converts hours to milliseconds', () => {
      const duration = hours(1)
      expect(duration.toMillis()).toBe(3600000)
    })

    it('handles fractional hours', () => {
      const duration = hours(0.5)
      expect(duration.toMillis()).toBe(1800000)
    })

    it('handles multiple hours', () => {
      const duration = hours(24)
      expect(duration.toMillis()).toBe(86400000)
    })
  })

  describe('minutes()', () => {
    it('converts minutes to milliseconds', () => {
      const duration = minutes(1)
      expect(duration.toMillis()).toBe(60000)
    })

    it('handles multiple minutes', () => {
      const duration = minutes(5)
      expect(duration.toMillis()).toBe(300000)
    })

    it('handles fractional minutes', () => {
      const duration = minutes(1.5)
      expect(duration.toMillis()).toBe(90000)
    })
  })

  describe('seconds()', () => {
    it('converts seconds to milliseconds', () => {
      const duration = seconds(1)
      expect(duration.toMillis()).toBe(1000)
    })

    it('handles multiple seconds', () => {
      const duration = seconds(30)
      expect(duration.toMillis()).toBe(30000)
    })
  })

  describe('milliseconds()', () => {
    it('returns milliseconds directly', () => {
      const duration = milliseconds(500)
      expect(duration.toMillis()).toBe(500)
    })
  })

  describe('Duration arithmetic', () => {
    it('durations can be compared', () => {
      const oneHour = hours(1)
      const sixtyMinutes = minutes(60)
      expect(oneHour.toMillis()).toBe(sixtyMinutes.toMillis())
    })
  })
})

// ============================================================================
// Tumbling Window Tests
// ============================================================================

describe('Tumbling Windows', () => {
  describe('WindowManager.tumbling() factory', () => {
    it('creates a tumbling window assigner', () => {
      const assigner = WindowManager.tumbling(minutes(5))

      expect(assigner).toBeDefined()
      expect(assigner.type).toBe('tumbling')
    })

    it('tumbling assigner has correct size', () => {
      const assigner = WindowManager.tumbling(hours(1))

      expect(assigner.size.toMillis()).toBe(3600000)
    })
  })

  describe('Element assignment', () => {
    it('assigns element to exactly one window', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      const event = createEvent('e1', 100, 0)

      const windows = manager.assign(event, ts(60000)) // 1 minute into first window

      expect(windows).toHaveLength(1)
    })

    it('window boundaries align to epoch', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      const event = createEvent('e1', 100, 0)

      const windows = manager.assign(event, ts(60000))
      const window = windows[0]

      // Window should start at aligned boundary
      expect(window.start % (5 * 60 * 1000)).toBe(0)
    })

    it('elements at window boundary go to next window', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      const event = createEvent('e1', 100, 0)

      // At exactly 5 minutes - should be in second window
      const windows = manager.assign(event, ts(300000))
      const window = windows[0]

      expect(window.start).toBe(ts(300000))
      expect(window.end).toBe(ts(600000))
    })

    it('window end is exclusive (start + size)', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      const event = createEvent('e1', 100, 0)

      const windows = manager.assign(event, ts(0))
      const window = windows[0]

      expect(window.end - window.start).toBe(300000) // 5 minutes
    })

    it('consecutive timestamps go to correct windows', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      const e1 = createEvent('e1', 100, 0)
      const e2 = createEvent('e2', 200, 0)
      const e3 = createEvent('e3', 300, 0)

      const w1 = manager.assign(e1, ts(0))[0]
      const w2 = manager.assign(e2, ts(299999))[0] // Just before 5 min
      const w3 = manager.assign(e3, ts(300000))[0] // At 5 min boundary

      expect(w1.start).toBe(w2.start) // Same window
      expect(w3.start).toBe(w1.end) // Next window
    })

    it('handles large time gaps', () => {
      const manager = new WindowManager(WindowManager.tumbling(hours(1)))

      const e1 = createEvent('e1', 100, 0)
      const e2 = createEvent('e2', 200, 0)

      const w1 = manager.assign(e1, ts(0))[0]
      const w2 = manager.assign(e2, ts(86400000))[0] // 24 hours later

      expect(w2.start - w1.start).toBe(86400000)
    })
  })

  describe('Window properties', () => {
    it('window has start, end, and optional key', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      const windows = manager.assign(createEvent('e1', 100, 0), ts(0))
      const window = windows[0]

      expect(window).toHaveProperty('start')
      expect(window).toHaveProperty('end')
      expect(typeof window.start).toBe('number')
      expect(typeof window.end).toBe('number')
    })

    it('windows are non-overlapping', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      const timestamps = [ts(0), ts(60000), ts(300000), ts(360000), ts(600000)]
      const allWindows: Window[] = []

      for (const timestamp of timestamps) {
        const windows = manager.assign(createEvent('e', 1, 0), timestamp)
        allWindows.push(...windows)
      }

      // Check no overlap between consecutive unique windows
      const uniqueWindows = [...new Map(allWindows.map((w) => [`${w.start}-${w.end}`, w])).values()]
      uniqueWindows.sort((a, b) => a.start - b.start)

      for (let i = 1; i < uniqueWindows.length; i++) {
        expect(uniqueWindows[i].start).toBeGreaterThanOrEqual(uniqueWindows[i - 1].end)
      }
    })
  })
})

// ============================================================================
// Sliding Window Tests
// ============================================================================

describe('Sliding Windows', () => {
  describe('WindowManager.sliding() factory', () => {
    it('creates a sliding window assigner', () => {
      const assigner = WindowManager.sliding(minutes(10), minutes(5))

      expect(assigner).toBeDefined()
      expect(assigner.type).toBe('sliding')
    })

    it('sliding assigner has correct size and slide', () => {
      const assigner = WindowManager.sliding(hours(1), minutes(15))

      expect(assigner.size.toMillis()).toBe(3600000)
      expect(assigner.slide.toMillis()).toBe(900000)
    })

    it('throws error if slide is larger than size', () => {
      expect(() => WindowManager.sliding(minutes(5), minutes(10))).toThrow(/slide.*size/i)
    })

    it('throws error if slide is zero or negative', () => {
      expect(() => WindowManager.sliding(minutes(5), milliseconds(0))).toThrow(/positive/i)
      expect(() => WindowManager.sliding(minutes(5), milliseconds(-1000))).toThrow(/positive/i)
    })
  })

  describe('Element assignment to multiple windows', () => {
    it('assigns element to multiple overlapping windows', () => {
      // 10-minute windows sliding every 5 minutes
      const manager = new WindowManager(WindowManager.sliding(minutes(10), minutes(5)))
      const event = createEvent('e1', 100, 0)

      // At timestamp 7 minutes: should be in window [5m, 15m) and [0m, 10m)
      const windows = manager.assign(event, ts(7 * 60 * 1000))

      expect(windows.length).toBe(2)
    })

    it('number of windows equals size/slide', () => {
      // 15-minute windows sliding every 5 minutes = 3 windows
      const manager = new WindowManager(WindowManager.sliding(minutes(15), minutes(5)))
      const event = createEvent('e1', 100, 0)

      // Element in middle of windows
      const windows = manager.assign(event, ts(10 * 60 * 1000))

      expect(windows.length).toBe(3)
    })

    it('element at boundary is in correct windows', () => {
      const manager = new WindowManager(WindowManager.sliding(minutes(10), minutes(5)))
      const event = createEvent('e1', 100, 0)

      // At exactly 10 minutes: should be in [5m, 15m) and [10m, 20m)
      const windows = manager.assign(event, ts(10 * 60 * 1000))

      expect(windows).toHaveLength(2)

      const starts = windows.map((w) => w.start).sort((a, b) => a - b)
      expect(starts).toContain(ts(5 * 60 * 1000))
      expect(starts).toContain(ts(10 * 60 * 1000))
    })

    it('all windows containing element are returned', () => {
      // 1-hour windows sliding every 15 minutes = 4 windows
      const manager = new WindowManager(WindowManager.sliding(hours(1), minutes(15)))
      const event = createEvent('e1', 100, 0)

      // At 30 minutes: should be in 4 windows
      const windows = manager.assign(event, ts(30 * 60 * 1000))

      expect(windows.length).toBe(4)
    })
  })

  describe('Window overlap verification', () => {
    it('windows properly overlap', () => {
      const manager = new WindowManager(WindowManager.sliding(minutes(10), minutes(5)))

      // Two elements 3 minutes apart should share at least one window
      const e1 = createEvent('e1', 100, 0)
      const e2 = createEvent('e2', 200, 0)

      const windows1 = manager.assign(e1, ts(7 * 60 * 1000))
      const windows2 = manager.assign(e2, ts(10 * 60 * 1000))

      // Find shared windows
      const sharedWindows = windows1.filter((w1) =>
        windows2.some((w2) => w2.start === w1.start && w2.end === w1.end)
      )

      expect(sharedWindows.length).toBeGreaterThan(0)
    })

    it('each window maintains correct size', () => {
      const manager = new WindowManager(WindowManager.sliding(minutes(10), minutes(5)))
      const event = createEvent('e1', 100, 0)

      const windows = manager.assign(event, ts(7 * 60 * 1000))

      for (const window of windows) {
        expect(window.end - window.start).toBe(10 * 60 * 1000)
      }
    })
  })
})

// ============================================================================
// Session Window Tests
// ============================================================================

describe('Session Windows', () => {
  describe('WindowManager.session() factory', () => {
    it('creates a session window assigner', () => {
      const assigner = WindowManager.session(minutes(30))

      expect(assigner).toBeDefined()
      expect(assigner.type).toBe('session')
    })

    it('session assigner has correct gap', () => {
      const assigner = WindowManager.session(hours(1))

      expect(assigner.gap.toMillis()).toBe(3600000)
    })
  })

  describe('Session window merging', () => {
    it('elements within gap create single session', () => {
      const manager = new WindowManager(WindowManager.session(minutes(5)))

      // Process elements within 5-minute gaps
      manager.process(createEvent('e1', 100, 0), ts(0))
      manager.process(createEvent('e2', 200, 0), ts(2 * 60 * 1000)) // 2 min gap
      manager.process(createEvent('e3', 300, 0), ts(4 * 60 * 1000)) // 2 min gap

      // Should all be in one session
      const state1 = manager.getWindowState({ start: ts(0), end: ts(4 * 60 * 1000 + 5 * 60 * 1000) })

      expect(state1.length).toBe(3)
    })

    it('elements beyond gap create separate sessions', () => {
      const manager = new WindowManager(WindowManager.session(minutes(5)))

      const triggered: { window: Window; elements: Event[] }[] = []
      manager.onTrigger((window, elements) => {
        triggered.push({ window, elements })
      })

      // First session
      manager.process(createEvent('e1', 100, 0), ts(0))
      manager.process(createEvent('e2', 200, 0), ts(2 * 60 * 1000))

      // Gap of 10 minutes - new session
      manager.process(createEvent('e3', 300, 0), ts(12 * 60 * 1000))

      // Advance watermark to trigger all windows
      manager.advanceWatermark(ts(30 * 60 * 1000))

      expect(triggered.length).toBe(2)
    })

    it('session windows merge when new element bridges gap', () => {
      const manager = new WindowManager(WindowManager.session(minutes(5)))

      // Two separate sessions
      manager.process(createEvent('e1', 100, 0), ts(0))
      manager.process(createEvent('e2', 200, 0), ts(10 * 60 * 1000)) // New session

      // Now add element that bridges the gap
      manager.process(createEvent('e3', 300, 0), ts(4 * 60 * 1000))

      // Should merge into single session spanning 0 to 15 min
      const windows = manager.assign(createEvent('e', 0, 0), ts(0))
      const mergedWindow = windows[0]

      expect(mergedWindow.start).toBe(ts(0))
      expect(mergedWindow.end).toBe(ts(10 * 60 * 1000 + 5 * 60 * 1000))
    })

    it('session window end is last element timestamp + gap', () => {
      const manager = new WindowManager(WindowManager.session(minutes(5)))

      manager.process(createEvent('e1', 100, 0), ts(0))
      manager.process(createEvent('e2', 200, 0), ts(2 * 60 * 1000))

      const windows = manager.assign(createEvent('e', 0, 0), ts(0))
      const window = windows[0]

      expect(window.end).toBe(ts(2 * 60 * 1000 + 5 * 60 * 1000))
    })
  })

  describe('Keyed session windows', () => {
    it('session windows are per-key when keyed', () => {
      const manager = new WindowManager<ClickEvent>(WindowManager.session(minutes(5)))

      // Add key extractor
      manager.withKeyExtractor((event) => event.userId)

      // User A activity
      manager.process({ id: 'e1', value: 1, userId: 'A', page: '/home' }, ts(0))
      manager.process({ id: 'e2', value: 2, userId: 'A', page: '/about' }, ts(2 * 60 * 1000))

      // User B activity (same time)
      manager.process({ id: 'e3', value: 3, userId: 'B', page: '/home' }, ts(0))
      manager.process({ id: 'e4', value: 4, userId: 'B', page: '/contact' }, ts(1 * 60 * 1000))

      // User A and B should have separate windows
      const windowsA = manager.assign({ id: 'e', value: 0, userId: 'A', page: '' }, ts(0))
      const windowsB = manager.assign({ id: 'e', value: 0, userId: 'B', page: '' }, ts(0))

      expect(windowsA[0].key).toBe('A')
      expect(windowsB[0].key).toBe('B')
    })
  })
})

// ============================================================================
// Global Window Tests
// ============================================================================

describe('Global Windows', () => {
  describe('WindowManager.global() factory', () => {
    it('creates a global window assigner', () => {
      const assigner = WindowManager.global()

      expect(assigner).toBeDefined()
      expect(assigner.type).toBe('global')
    })
  })

  describe('Element assignment', () => {
    it('all elements assigned to single global window', () => {
      const manager = new WindowManager(WindowManager.global())

      const windows1 = manager.assign(createEvent('e1', 100, 0), ts(0))
      const windows2 = manager.assign(createEvent('e2', 200, 0), ts(86400000)) // 24h later

      expect(windows1).toHaveLength(1)
      expect(windows2).toHaveLength(1)
      expect(windows1[0].start).toBe(windows2[0].start)
      expect(windows1[0].end).toBe(windows2[0].end)
    })

    it('global window has min/max boundaries', () => {
      const manager = new WindowManager(WindowManager.global())

      const windows = manager.assign(createEvent('e1', 100, 0), ts(0))
      const window = windows[0]

      expect(window.start).toBe(Number.MIN_SAFE_INTEGER)
      expect(window.end).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('global window requires custom trigger', () => {
      const manager = new WindowManager(WindowManager.global())

      // Without trigger, window never fires
      const triggered: Event[][] = []
      manager.onTrigger((window, elements) => {
        triggered.push(elements)
      })

      manager.process(createEvent('e1', 100, 0), ts(0))
      manager.process(createEvent('e2', 200, 0), ts(1000))
      manager.advanceWatermark(ts(2000))

      expect(triggered).toHaveLength(0)

      // With count trigger
      manager.withTrigger(new CountTrigger(2))
      manager.process(createEvent('e3', 300, 0), ts(3000))
      manager.process(createEvent('e4', 400, 0), ts(4000))

      expect(triggered.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Trigger Tests
// ============================================================================

describe('Triggers', () => {
  describe('Event Time Trigger (Watermark-based)', () => {
    it('fires when watermark crosses window end', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      manager.withTrigger(new EventTimeTrigger())

      const triggered: { window: Window; elements: Event[] }[] = []
      manager.onTrigger((window, elements) => {
        triggered.push({ window, elements })
      })

      // Add elements to first window [0, 5min)
      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.process(createEvent('e2', 200, 0), ts(120000))

      // Watermark still before window end - should not trigger
      manager.advanceWatermark(ts(240000))
      expect(triggered).toHaveLength(0)

      // Watermark crosses window end - should trigger
      manager.advanceWatermark(ts(300000))
      expect(triggered).toHaveLength(1)
      expect(triggered[0].elements).toHaveLength(2)
    })

    it('does not fire multiple times for same window', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      manager.withTrigger(new EventTimeTrigger())

      const triggered: Window[] = []
      manager.onTrigger((window) => {
        triggered.push(window)
      })

      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.advanceWatermark(ts(300000))
      manager.advanceWatermark(ts(400000))
      manager.advanceWatermark(ts(500000))

      expect(triggered).toHaveLength(1)
    })

    it('triggers multiple windows when watermark advances significantly', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      manager.withTrigger(new EventTimeTrigger())

      const triggered: Window[] = []
      manager.onTrigger((window) => {
        triggered.push(window)
      })

      // Add elements to three consecutive windows
      manager.process(createEvent('e1', 100, 0), ts(1 * 60 * 1000)) // Window 0
      manager.process(createEvent('e2', 200, 0), ts(6 * 60 * 1000)) // Window 1
      manager.process(createEvent('e3', 300, 0), ts(11 * 60 * 1000)) // Window 2

      // Advance watermark past all windows
      manager.advanceWatermark(ts(20 * 60 * 1000))

      expect(triggered).toHaveLength(3)
    })
  })

  describe('Count-based Trigger', () => {
    it('fires when element count reaches threshold', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      manager.withTrigger(new CountTrigger(3))

      const triggered: Event[][] = []
      manager.onTrigger((window, elements) => {
        triggered.push(elements)
      })

      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.process(createEvent('e2', 200, 0), ts(120000))
      expect(triggered).toHaveLength(0)

      manager.process(createEvent('e3', 300, 0), ts(180000))
      expect(triggered).toHaveLength(1)
      expect(triggered[0]).toHaveLength(3)
    })

    it('fires every N elements', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(10)))
      manager.withTrigger(new CountTrigger(2))

      let triggerCount = 0
      manager.onTrigger(() => {
        triggerCount++
      })

      // Add 6 elements - should trigger 3 times
      for (let i = 0; i < 6; i++) {
        manager.process(createEvent(`e${i}`, i * 100, 0), ts(i * 60000))
      }

      expect(triggerCount).toBe(3)
    })

    it('count resets after trigger', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(10)))
      manager.withTrigger(new CountTrigger(2))

      const triggeredElements: Event[][] = []
      manager.onTrigger((window, elements) => {
        triggeredElements.push([...elements])
      })

      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.process(createEvent('e2', 200, 0), ts(120000)) // First trigger

      manager.process(createEvent('e3', 300, 0), ts(180000))
      manager.process(createEvent('e4', 400, 0), ts(240000)) // Second trigger

      expect(triggeredElements).toHaveLength(2)
      expect(triggeredElements[0]).toHaveLength(2)
      expect(triggeredElements[1]).toHaveLength(2) // Not 4!
    })
  })

  describe('Processing Time Trigger', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('fires periodically based on processing time', () => {
      const manager = new WindowManager(WindowManager.tumbling(hours(1)))
      manager.withTrigger(new ProcessingTimeTrigger(seconds(10)))

      let triggerCount = 0
      manager.onTrigger(() => {
        triggerCount++
      })

      manager.process(createEvent('e1', 100, 0), ts(0))

      vi.advanceTimersByTime(10000)
      expect(triggerCount).toBe(1)

      vi.advanceTimersByTime(10000)
      expect(triggerCount).toBe(2)
    })
  })

  describe('Purging Trigger', () => {
    it('clears window state after trigger', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
      manager.withTrigger(new PurgingTrigger(new CountTrigger(2)))

      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.process(createEvent('e2', 200, 0), ts(120000)) // Triggers and purges

      const window: Window = { start: ts(0), end: ts(300000) }
      const state = manager.getWindowState(window)

      expect(state).toHaveLength(0)
    })
  })

  describe('Composite Triggers', () => {
    it('OR trigger: fires on any condition', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      // Fire on count=3 OR watermark
      const countTrigger = new CountTrigger(3)
      const eventTrigger = new EventTimeTrigger()
      manager.withTrigger(Trigger.or(countTrigger, eventTrigger))

      let triggerCount = 0
      manager.onTrigger(() => {
        triggerCount++
      })

      // Add 3 elements - should trigger from count
      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.process(createEvent('e2', 200, 0), ts(120000))
      manager.process(createEvent('e3', 300, 0), ts(180000))

      expect(triggerCount).toBe(1)
    })

    it('AND trigger: requires all conditions', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      // Fire only when count=2 AND watermark passes
      const countTrigger = new CountTrigger(2)
      const eventTrigger = new EventTimeTrigger()
      manager.withTrigger(Trigger.and(countTrigger, eventTrigger))

      let triggerCount = 0
      manager.onTrigger(() => {
        triggerCount++
      })

      // Add 2 elements - count satisfied
      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.process(createEvent('e2', 200, 0), ts(120000))
      expect(triggerCount).toBe(0) // Not triggered yet

      // Advance watermark - now both satisfied
      manager.advanceWatermark(ts(300000))
      expect(triggerCount).toBe(1)
    })
  })
})

// ============================================================================
// Late Data Handling Tests
// ============================================================================

describe('Late Data Handling', () => {
  describe('allowLateness()', () => {
    it('extends window retention beyond watermark', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
        .withTrigger(new EventTimeTrigger())
        .allowLateness(minutes(2))

      const triggered: { window: Window; elements: Event[] }[] = []
      manager.onTrigger((window, elements) => {
        triggered.push({ window, elements })
      })

      // Add element to window [0, 5min)
      manager.process(createEvent('e1', 100, 0), ts(60000))

      // Advance watermark past window end
      manager.advanceWatermark(ts(300000))
      expect(triggered).toHaveLength(1)

      // Late element within allowed lateness
      manager.process(createEvent('e2', 200, 0), ts(120000))

      // Should trigger again with late element
      expect(triggered).toHaveLength(2)
    })

    it('window discarded after lateness period', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
        .withTrigger(new EventTimeTrigger())
        .allowLateness(minutes(2))

      const lateData: Event[] = []
      manager.sideOutputLate((element) => {
        lateData.push(element)
      })

      // Advance watermark well past window + lateness
      manager.advanceWatermark(ts(10 * 60 * 1000))

      // Late element should go to side output
      manager.process(createEvent('e1', 100, 0), ts(60000))

      expect(lateData).toHaveLength(1)
    })

    it('returns this for chaining', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      const result = manager.allowLateness(minutes(2))

      expect(result).toBe(manager)
    })
  })

  describe('sideOutputLate()', () => {
    it('routes late data to side output handler', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
        .withTrigger(new EventTimeTrigger())

      const lateData: Event[] = []
      manager.sideOutputLate((element) => {
        lateData.push(element)
      })

      // Advance watermark past first window
      manager.advanceWatermark(ts(300000))

      // Late element for first window
      manager.process(createEvent('late1', 999, 0), ts(60000))

      expect(lateData).toHaveLength(1)
      expect(lateData[0].id).toBe('late1')
    })

    it('side output receives element and window info', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
        .withTrigger(new EventTimeTrigger())

      let capturedWindow: Window | undefined
      manager.sideOutputLate((element, window) => {
        capturedWindow = window
      })

      manager.advanceWatermark(ts(300000))
      manager.process(createEvent('late1', 999, 0), ts(60000))

      expect(capturedWindow).toBeDefined()
      expect(capturedWindow!.end).toBeLessThanOrEqual(ts(300000))
    })

    it('returns this for chaining', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      const result = manager.sideOutputLate(() => {})

      expect(result).toBe(manager)
    })
  })
})

// ============================================================================
// Window State Management Tests
// ============================================================================

describe('Window State Management', () => {
  describe('getWindowState()', () => {
    it('returns elements assigned to window', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.process(createEvent('e2', 200, 0), ts(120000))
      manager.process(createEvent('e3', 300, 0), ts(180000))

      const window: Window = { start: ts(0), end: ts(300000) }
      const state = manager.getWindowState(window)

      expect(state).toHaveLength(3)
    })

    it('returns empty array for empty window', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      const window: Window = { start: ts(0), end: ts(300000) }
      const state = manager.getWindowState(window)

      expect(state).toEqual([])
    })

    it('returns copy of state, not reference', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      manager.process(createEvent('e1', 100, 0), ts(60000))

      const window: Window = { start: ts(0), end: ts(300000) }
      const state1 = manager.getWindowState(window)
      const state2 = manager.getWindowState(window)

      expect(state1).not.toBe(state2)
      expect(state1).toEqual(state2)
    })
  })

  describe('clearWindow()', () => {
    it('removes all elements from window', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      manager.process(createEvent('e1', 100, 0), ts(60000))
      manager.process(createEvent('e2', 200, 0), ts(120000))

      const window: Window = { start: ts(0), end: ts(300000) }
      manager.clearWindow(window)

      const state = manager.getWindowState(window)
      expect(state).toHaveLength(0)
    })

    it('does not affect other windows', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      // Elements in first window
      manager.process(createEvent('e1', 100, 0), ts(60000))

      // Elements in second window
      manager.process(createEvent('e2', 200, 0), ts(360000))

      const window1: Window = { start: ts(0), end: ts(300000) }
      const window2: Window = { start: ts(300000), end: ts(600000) }

      manager.clearWindow(window1)

      expect(manager.getWindowState(window1)).toHaveLength(0)
      expect(manager.getWindowState(window2)).toHaveLength(1)
    })
  })
})

// ============================================================================
// Scalability Tests
// ============================================================================

describe('Scalability', () => {
  describe('Large number of concurrent windows', () => {
    it('handles 1000+ concurrent windows', () => {
      const manager = new WindowManager(WindowManager.tumbling(seconds(1)))

      // Create 1000 windows over 1000 seconds
      for (let i = 0; i < 1000; i++) {
        manager.process(createEvent(`e${i}`, i, 0), ts(i * 1000))
      }

      // Should have 1000 different windows
      const windows: Window[] = []
      for (let i = 0; i < 1000; i++) {
        const w = manager.assign(createEvent('', 0, 0), ts(i * 1000))
        windows.push(w[0])
      }

      const uniqueWindows = new Set(windows.map((w) => `${w.start}-${w.end}`))
      expect(uniqueWindows.size).toBe(1000)
    })

    it('handles 10000 elements in single window', () => {
      const manager = new WindowManager(WindowManager.tumbling(hours(1)))

      for (let i = 0; i < 10000; i++) {
        manager.process(createEvent(`e${i}`, i, 0), ts(i * 100)) // All within first hour
      }

      const window: Window = { start: ts(0), end: ts(3600000) }
      const state = manager.getWindowState(window)

      expect(state).toHaveLength(10000)
    })
  })

  describe('Memory leak detection', () => {
    it('window cleanup after firing prevents memory leak', () => {
      const manager = new WindowManager(WindowManager.tumbling(seconds(1)))
        .withTrigger(new EventTimeTrigger())

      // Process and trigger many windows
      for (let i = 0; i < 100; i++) {
        manager.process(createEvent(`e${i}`, i, 0), ts(i * 1000))
        manager.advanceWatermark(ts((i + 1) * 1000))
      }

      // Clear old windows
      manager.advanceWatermark(ts(200 * 1000))

      // Check internal state size (implementation detail, but important for leaks)
      const internalWindowCount = manager.getActiveWindowCount()
      expect(internalWindowCount).toBeLessThan(100)
    })

    it('session windows are cleaned up after merge and trigger', () => {
      const manager = new WindowManager(WindowManager.session(seconds(5)))
        .withTrigger(new EventTimeTrigger())

      // Create many small sessions that get merged
      for (let i = 0; i < 50; i++) {
        manager.process(createEvent(`e${i}`, i, 0), ts(i * 1000))
      }

      manager.advanceWatermark(ts(100 * 1000))

      // Should have cleaned up merged windows
      const internalWindowCount = manager.getActiveWindowCount()
      expect(internalWindowCount).toBe(0)
    })
  })

  describe('Processing performance', () => {
    it('assign() is O(1) for tumbling windows', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(1)))

      const start = performance.now()
      for (let i = 0; i < 10000; i++) {
        manager.assign(createEvent(`e${i}`, i, 0), ts(i))
      }
      const duration = performance.now() - start

      // Should complete in reasonable time (< 100ms for 10k operations)
      expect(duration).toBeLessThan(100)
    })

    it('assign() is O(size/slide) for sliding windows', () => {
      // 10 windows per element
      const manager = new WindowManager(WindowManager.sliding(minutes(10), minutes(1)))

      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        manager.assign(createEvent(`e${i}`, i, 0), ts(i * 60000))
      }
      const duration = performance.now() - start

      // Should complete in reasonable time (< 200ms for 10k window assignments)
      expect(duration).toBeLessThan(200)
    })
  })
})

// ============================================================================
// Watermark Advancement Tests
// ============================================================================

describe('Watermark Advancement', () => {
  describe('advanceWatermark()', () => {
    it('triggers all windows with end <= watermark', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
        .withTrigger(new EventTimeTrigger())

      const triggered: Window[] = []
      manager.onTrigger((window) => {
        triggered.push(window)
      })

      // Add elements to windows 0, 1, 2
      manager.process(createEvent('e0', 0, 0), ts(1 * 60 * 1000))
      manager.process(createEvent('e1', 1, 0), ts(6 * 60 * 1000))
      manager.process(createEvent('e2', 2, 0), ts(11 * 60 * 1000))

      // Advance watermark to trigger windows 0 and 1
      manager.advanceWatermark(ts(10 * 60 * 1000))

      expect(triggered).toHaveLength(2)
      expect(triggered.map((w) => w.start).sort((a, b) => a - b)).toEqual([ts(0), ts(5 * 60 * 1000)])
    })

    it('watermark cannot go backwards', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      manager.advanceWatermark(ts(10 * 60 * 1000))

      expect(() => manager.advanceWatermark(ts(5 * 60 * 1000))).toThrow(/backwards/i)
    })

    it('watermark can stay at same value', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      manager.advanceWatermark(ts(10 * 60 * 1000))
      manager.advanceWatermark(ts(10 * 60 * 1000)) // Same value - no error

      // No assertion needed - just checking it doesn't throw
    })

    it('returns list of triggered windows', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))
        .withTrigger(new EventTimeTrigger())

      manager.process(createEvent('e0', 0, 0), ts(1 * 60 * 1000))
      manager.process(createEvent('e1', 1, 0), ts(6 * 60 * 1000))

      const triggeredWindows = manager.advanceWatermark(ts(15 * 60 * 1000))

      expect(triggeredWindows).toHaveLength(2)
    })
  })

  describe('getCurrentWatermark()', () => {
    it('returns current watermark value', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      manager.advanceWatermark(ts(10 * 60 * 1000))

      expect(manager.getCurrentWatermark()).toBe(ts(10 * 60 * 1000))
    })

    it('returns initial value before first advancement', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      expect(manager.getCurrentWatermark()).toBe(Number.MIN_SAFE_INTEGER)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  describe('Click stream analytics', () => {
    it('counts clicks per user per 5-minute window', () => {
      const manager = new WindowManager<ClickEvent>(WindowManager.tumbling(minutes(5)))
        .withTrigger(new EventTimeTrigger())

      const results: { userId: string; count: number; window: Window }[] = []

      manager.withKeyExtractor((event) => event.userId)
      manager.onTrigger((window, elements) => {
        const byUser = new Map<string, number>()
        for (const el of elements) {
          byUser.set(el.userId, (byUser.get(el.userId) || 0) + 1)
        }
        for (const [userId, count] of byUser) {
          results.push({ userId, count, window })
        }
      })

      // User A clicks
      manager.process({ id: 'c1', value: 1, userId: 'A', page: '/home' }, ts(60000))
      manager.process({ id: 'c2', value: 1, userId: 'A', page: '/about' }, ts(120000))
      manager.process({ id: 'c3', value: 1, userId: 'A', page: '/contact' }, ts(180000))

      // User B clicks
      manager.process({ id: 'c4', value: 1, userId: 'B', page: '/home' }, ts(60000))
      manager.process({ id: 'c5', value: 1, userId: 'B', page: '/products' }, ts(240000))

      // Trigger window
      manager.advanceWatermark(ts(300000))

      expect(results).toHaveLength(2)
      expect(results.find((r) => r.userId === 'A')?.count).toBe(3)
      expect(results.find((r) => r.userId === 'B')?.count).toBe(2)
    })
  })

  describe('Sensor data aggregation', () => {
    it('computes sliding average temperature', () => {
      const manager = new WindowManager<SensorReading>(WindowManager.sliding(minutes(10), minutes(5)))
        .withTrigger(new EventTimeTrigger())

      const averages: { window: Window; avg: number }[] = []

      manager.onTrigger((window, elements) => {
        const sum = elements.reduce((acc, el) => acc + el.temperature, 0)
        averages.push({ window, avg: sum / elements.length })
      })

      // Temperature readings every minute
      const readings = [20, 21, 22, 23, 24, 25, 24, 23, 22, 21]
      for (let i = 0; i < readings.length; i++) {
        manager.process(
          { id: `r${i}`, value: readings[i], sensorId: 's1', temperature: readings[i] },
          ts(i * 60 * 1000)
        )
      }

      // Advance watermark to trigger windows
      manager.advanceWatermark(ts(15 * 60 * 1000))

      // Should have multiple overlapping windows
      expect(averages.length).toBeGreaterThan(1)
    })
  })

  describe('Session-based user activity', () => {
    it('tracks user sessions with activity gaps', () => {
      const manager = new WindowManager<ClickEvent>(WindowManager.session(minutes(30)))
        .withTrigger(new EventTimeTrigger())

      const sessions: { duration: number; clicks: number }[] = []

      manager.onTrigger((window, elements) => {
        sessions.push({
          duration: window.end - window.start - 30 * 60 * 1000, // Subtract gap
          clicks: elements.length,
        })
      })

      // First session
      manager.process({ id: 'c1', value: 1, userId: 'A', page: '/home' }, ts(0))
      manager.process({ id: 'c2', value: 1, userId: 'A', page: '/about' }, ts(5 * 60 * 1000))
      manager.process({ id: 'c3', value: 1, userId: 'A', page: '/contact' }, ts(10 * 60 * 1000))

      // Gap of 1 hour - new session
      manager.process({ id: 'c4', value: 1, userId: 'A', page: '/home' }, ts(70 * 60 * 1000))

      // Advance watermark to trigger all sessions
      manager.advanceWatermark(ts(120 * 60 * 1000))

      expect(sessions).toHaveLength(2)
      expect(sessions[0].clicks).toBe(3)
      expect(sessions[1].clicks).toBe(1)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Negative timestamps', () => {
    it('handles negative timestamps correctly', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      const windows = manager.assign(createEvent('e1', 100, 0), -1000)

      expect(windows).toHaveLength(1)
      expect(windows[0].start).toBeLessThan(0)
    })
  })

  describe('Zero-length elements', () => {
    it('handles elements with minimal data', () => {
      const manager = new WindowManager(WindowManager.tumbling(minutes(5)))

      const emptyEvent: Event = { id: '', value: 0 }
      const windows = manager.assign(emptyEvent, ts(0))

      expect(windows).toHaveLength(1)
    })
  })

  describe('Very small windows', () => {
    it('handles millisecond-sized windows', () => {
      const manager = new WindowManager(WindowManager.tumbling(milliseconds(100)))

      const windows = manager.assign(createEvent('e1', 100, 0), ts(50))

      expect(windows[0].end - windows[0].start).toBe(100)
    })
  })

  describe('Very large windows', () => {
    it('handles year-long windows', () => {
      const oneYear = hours(24 * 365)
      const manager = new WindowManager(WindowManager.tumbling(oneYear))

      const windows = manager.assign(createEvent('e1', 100, 0), ts(0))

      expect(windows[0].end - windows[0].start).toBe(24 * 365 * 60 * 60 * 1000)
    })
  })

  describe('Concurrent operations', () => {
    it('handles rapid process and watermark advancement', () => {
      const manager = new WindowManager(WindowManager.tumbling(milliseconds(100)))
        .withTrigger(new EventTimeTrigger())

      let triggerCount = 0
      manager.onTrigger(() => {
        triggerCount++
      })

      // Rapid interleaving of process and watermark
      for (let i = 0; i < 100; i++) {
        manager.process(createEvent(`e${i}`, i, 0), ts(i * 10))
        if (i % 10 === 0) {
          manager.advanceWatermark(ts(i * 10))
        }
      }

      manager.advanceWatermark(ts(2000))

      expect(triggerCount).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Module Exports Tests
// ============================================================================

describe('Module Exports', () => {
  it('WindowManager class is exported', () => {
    expect(WindowManager).toBeDefined()
    expect(typeof WindowManager).toBe('function')
  })

  it('WindowAssigner interface is implemented by factories', () => {
    const tumbling = WindowManager.tumbling(minutes(5))
    const sliding = WindowManager.sliding(minutes(10), minutes(5))
    const session = WindowManager.session(minutes(30))
    const global = WindowManager.global()

    // All should have type property
    expect(tumbling.type).toBe('tumbling')
    expect(sliding.type).toBe('sliding')
    expect(session.type).toBe('session')
    expect(global.type).toBe('global')
  })

  it('Duration helpers are exported', () => {
    expect(hours).toBeDefined()
    expect(minutes).toBeDefined()
    expect(seconds).toBeDefined()
    expect(milliseconds).toBeDefined()
  })

  it('Trigger classes are exported', () => {
    expect(EventTimeTrigger).toBeDefined()
    expect(CountTrigger).toBeDefined()
    expect(ProcessingTimeTrigger).toBeDefined()
    expect(PurgingTrigger).toBeDefined()
  })

  it('Trigger combinators are exported', () => {
    expect(Trigger.or).toBeDefined()
    expect(Trigger.and).toBeDefined()
  })
})

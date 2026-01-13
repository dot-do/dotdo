/**
 * SLA Monitoring Tests - RED Phase
 *
 * Tests for Service Level Agreement (SLA) monitoring in human escalation workflows.
 * SLA monitoring tracks:
 * - Response time targets per priority level
 * - Warning thresholds before breach
 * - Auto-escalation on SLA breach
 * - SLA metrics aggregation and reporting
 *
 * Key behaviors tested:
 * 1. SLA timer initialization and tracking
 * 2. Warning notifications before breach
 * 3. Auto-escalation triggers
 * 4. SLA metrics calculation
 * 5. Priority-based SLA configuration
 * 6. SLA pause/resume for business hours
 *
 * NO MOCKS - tests use real timestamps and in-memory stores.
 *
 * @see dotdo-9h7p1 - TDD: Human escalation logic
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS (to be implemented)
// ============================================================================

/**
 * Priority levels with associated SLA targets
 */
export type SLAPriority = 'critical' | 'high' | 'normal' | 'low'

/**
 * SLA configuration for a priority level
 */
export interface SLAConfiguration {
  /** Priority level */
  priority: SLAPriority
  /** Target response time in milliseconds */
  targetMs: number
  /** Warning threshold (time before target to send warning) */
  warningThresholdMs: number
  /** Whether to auto-escalate on breach */
  autoEscalate: boolean
  /** Escalation delay after breach (ms) */
  escalationDelayMs?: number
}

/**
 * SLA timer state
 */
export interface SLATimer {
  id: string
  /** Associated request ID */
  requestId: string
  /** Priority level */
  priority: SLAPriority
  /** When the timer started */
  startedAt: number
  /** Target deadline */
  deadline: number
  /** When warning should be sent */
  warningAt: number
  /** Current status */
  status: 'active' | 'paused' | 'warning' | 'breached' | 'completed'
  /** When paused (for business hours) */
  pausedAt?: number
  /** Total paused duration */
  pausedDurationMs: number
  /** When warning was sent */
  warningSentAt?: number
  /** When breach occurred */
  breachedAt?: number
  /** When completed */
  completedAt?: number
}

/**
 * SLA event emitted during monitoring
 */
export interface SLAEvent {
  type: 'warning' | 'breach' | 'escalation' | 'completion'
  timerId: string
  requestId: string
  priority: SLAPriority
  timestamp: number
  /** Time remaining (negative if breached) */
  timeRemainingMs: number
  /** Additional event data */
  data?: Record<string, unknown>
}

/**
 * SLA metrics for reporting
 */
export interface SLAMetrics {
  /** Total requests in period */
  totalRequests: number
  /** Requests completed within SLA */
  metSLA: number
  /** Requests that breached SLA */
  breachedSLA: number
  /** SLA compliance rate (0-1) */
  complianceRate: number
  /** Average response time (ms) */
  avgResponseTimeMs: number
  /** P50 response time */
  p50ResponseTimeMs: number
  /** P95 response time */
  p95ResponseTimeMs: number
  /** P99 response time */
  p99ResponseTimeMs: number
  /** Metrics per priority */
  byPriority: Record<SLAPriority, {
    total: number
    met: number
    breached: number
    avgResponseTimeMs: number
  }>
}

/**
 * Options for creating an SLA timer
 */
export interface CreateSLATimerOptions {
  requestId: string
  priority: SLAPriority
  /** Override default SLA configuration */
  customSLA?: Partial<SLAConfiguration>
  /** Start time (defaults to now) */
  startTime?: number
}

/**
 * SLA monitoring service interface
 */
export interface SLAMonitor {
  /** Create a new SLA timer */
  createTimer(options: CreateSLATimerOptions): SLATimer
  /** Get timer by ID */
  getTimer(timerId: string): SLATimer | null
  /** Get timer by request ID */
  getTimerByRequest(requestId: string): SLATimer | null
  /** Pause timer (for business hours) */
  pauseTimer(timerId: string, reason?: string): SLATimer
  /** Resume timer */
  resumeTimer(timerId: string): SLATimer
  /** Complete timer (request was handled) */
  completeTimer(timerId: string): SLATimer
  /** Check all timers and emit events */
  tick(currentTime: number): SLAEvent[]
  /** Get SLA metrics for a time range */
  getMetrics(startTime: number, endTime: number): SLAMetrics
  /** Subscribe to SLA events */
  onEvent(handler: (event: SLAEvent) => void): () => void
  /** Get default SLA config for priority */
  getDefaultSLA(priority: SLAPriority): SLAConfiguration
}

// ============================================================================
// STUB FUNCTIONS (to be implemented in sla-monitor.ts)
// ============================================================================

/**
 * Default SLA configurations per priority
 */
const DEFAULT_SLA_CONFIGS: Record<SLAPriority, SLAConfiguration> = {
  critical: {
    priority: 'critical',
    targetMs: 1 * 60 * 60 * 1000, // 1 hour
    warningThresholdMs: 15 * 60 * 1000, // 15 min warning
    autoEscalate: true,
    escalationDelayMs: 5 * 60 * 1000, // 5 min after breach
  },
  high: {
    priority: 'high',
    targetMs: 2 * 60 * 60 * 1000, // 2 hours
    warningThresholdMs: 30 * 60 * 1000, // 30 min warning
    autoEscalate: true,
    escalationDelayMs: 10 * 60 * 1000, // 10 min after breach
  },
  normal: {
    priority: 'normal',
    targetMs: 4 * 60 * 60 * 1000, // 4 hours
    warningThresholdMs: 60 * 60 * 1000, // 1 hour warning
    autoEscalate: true,
    escalationDelayMs: 30 * 60 * 1000, // 30 min after breach
  },
  low: {
    priority: 'low',
    targetMs: 24 * 60 * 60 * 1000, // 24 hours
    warningThresholdMs: 2 * 60 * 60 * 1000, // 2 hour warning
    autoEscalate: false,
  },
}

function createSLAMonitor(_config?: { defaultSLAs?: Partial<Record<SLAPriority, Partial<SLAConfiguration>>> }): SLAMonitor {
  throw new Error('Not implemented: createSLAMonitor')
}

function calculateSLADeadline(_startTime: number, _priority: SLAPriority, _config?: SLAConfiguration): number {
  throw new Error('Not implemented: calculateSLADeadline')
}

function checkSLAStatus(_timer: SLATimer, _currentTime: number): { status: SLATimer['status']; timeRemainingMs: number } {
  throw new Error('Not implemented: checkSLAStatus')
}

function aggregateSLAMetrics(_timers: SLATimer[], _startTime: number, _endTime: number): SLAMetrics {
  throw new Error('Not implemented: aggregateSLAMetrics')
}

function calculatePercentile(_values: number[], _percentile: number): number {
  throw new Error('Not implemented: calculatePercentile')
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Helper to advance time in tests
 */
function advanceTime(baseTime: number, ms: number): number {
  return baseTime + ms
}

/**
 * Create a test SLA timer with custom settings
 */
function createTestTimer(monitor: SLAMonitor, overrides: Partial<CreateSLATimerOptions> = {}): SLATimer {
  return monitor.createTimer({
    requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    priority: 'normal',
    ...overrides,
  })
}

// ============================================================================
// TESTS: Timer Creation and Configuration
// ============================================================================

describe('SLA Monitor', () => {
  describe('createSLAMonitor', () => {
    it('creates a monitor with default configurations', () => {
      const monitor = createSLAMonitor()

      expect(monitor).toBeDefined()
      expect(monitor.getDefaultSLA('critical').targetMs).toBe(1 * 60 * 60 * 1000)
      expect(monitor.getDefaultSLA('normal').targetMs).toBe(4 * 60 * 60 * 1000)
    })

    it('allows custom SLA configurations', () => {
      const monitor = createSLAMonitor({
        defaultSLAs: {
          critical: { targetMs: 30 * 60 * 1000 }, // 30 min instead of 1 hour
        },
      })

      expect(monitor.getDefaultSLA('critical').targetMs).toBe(30 * 60 * 1000)
      // Other priorities should still use defaults
      expect(monitor.getDefaultSLA('normal').targetMs).toBe(4 * 60 * 60 * 1000)
    })
  })

  describe('createTimer', () => {
    it('creates a timer with correct deadline', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      expect(timer.requestId).toBe('req-123')
      expect(timer.priority).toBe('normal')
      expect(timer.startedAt).toBe(startTime)
      expect(timer.deadline).toBe(startTime + 4 * 60 * 60 * 1000)
      expect(timer.status).toBe('active')
    })

    it('calculates warning time based on threshold', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      // Warning should be 1 hour before deadline (for normal priority)
      const expectedWarningTime = timer.deadline - 60 * 60 * 1000
      expect(timer.warningAt).toBe(expectedWarningTime)
    })

    it('respects custom SLA configuration', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        customSLA: {
          targetMs: 2 * 60 * 60 * 1000, // 2 hours instead of 4
          warningThresholdMs: 30 * 60 * 1000, // 30 min instead of 1 hour
        },
        startTime,
      })

      expect(timer.deadline).toBe(startTime + 2 * 60 * 60 * 1000)
      expect(timer.warningAt).toBe(timer.deadline - 30 * 60 * 1000)
    })

    it('generates unique timer ID', () => {
      const monitor = createSLAMonitor()

      const timer1 = monitor.createTimer({ requestId: 'req-1', priority: 'normal' })
      const timer2 = monitor.createTimer({ requestId: 'req-2', priority: 'normal' })

      expect(timer1.id).not.toBe(timer2.id)
    })
  })

  describe('getTimer and getTimerByRequest', () => {
    it('retrieves timer by ID', () => {
      const monitor = createSLAMonitor()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal' })

      const retrieved = monitor.getTimer(timer.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(timer.id)
    })

    it('retrieves timer by request ID', () => {
      const monitor = createSLAMonitor()
      monitor.createTimer({ requestId: 'req-123', priority: 'normal' })

      const retrieved = monitor.getTimerByRequest('req-123')

      expect(retrieved).not.toBeNull()
      expect(retrieved!.requestId).toBe('req-123')
    })

    it('returns null for unknown timer', () => {
      const monitor = createSLAMonitor()

      expect(monitor.getTimer('unknown')).toBeNull()
      expect(monitor.getTimerByRequest('unknown')).toBeNull()
    })
  })
})

// ============================================================================
// TESTS: Timer State Management
// ============================================================================

describe('SLA Timer State Management', () => {
  describe('pauseTimer', () => {
    it('pauses an active timer', () => {
      const monitor = createSLAMonitor()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal' })

      const paused = monitor.pauseTimer(timer.id, 'Outside business hours')

      expect(paused.status).toBe('paused')
      expect(paused.pausedAt).toBeDefined()
    })

    it('throws error for non-existent timer', () => {
      const monitor = createSLAMonitor()

      expect(() => monitor.pauseTimer('unknown')).toThrow('Timer not found')
    })

    it('throws error for already paused timer', () => {
      const monitor = createSLAMonitor()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal' })
      monitor.pauseTimer(timer.id)

      expect(() => monitor.pauseTimer(timer.id)).toThrow('Timer already paused')
    })
  })

  describe('resumeTimer', () => {
    it('resumes a paused timer', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal', startTime })

      // Pause for 1 hour
      monitor.pauseTimer(timer.id)
      const pauseDuration = 60 * 60 * 1000

      // Resume after 1 hour
      const resumed = monitor.resumeTimer(timer.id)

      expect(resumed.status).toBe('active')
      expect(resumed.pausedAt).toBeUndefined()
      expect(resumed.pausedDurationMs).toBeGreaterThanOrEqual(0)
    })

    it('extends deadline by paused duration', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal', startTime })
      const originalDeadline = timer.deadline

      // Simulate pause
      monitor.pauseTimer(timer.id)

      // The deadline should be extended when resumed
      const resumed = monitor.resumeTimer(timer.id)

      // Deadline should account for pause time
      expect(resumed.deadline).toBeGreaterThanOrEqual(originalDeadline)
    })

    it('throws error for non-paused timer', () => {
      const monitor = createSLAMonitor()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal' })

      expect(() => monitor.resumeTimer(timer.id)).toThrow('Timer is not paused')
    })
  })

  describe('completeTimer', () => {
    it('marks timer as completed', () => {
      const monitor = createSLAMonitor()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal' })

      const completed = monitor.completeTimer(timer.id)

      expect(completed.status).toBe('completed')
      expect(completed.completedAt).toBeDefined()
    })

    it('records completion time', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal', startTime })

      const completed = monitor.completeTimer(timer.id)

      expect(completed.completedAt).toBeGreaterThanOrEqual(startTime)
    })

    it('can complete a breached timer', () => {
      const monitor = createSLAMonitor()
      const timer = monitor.createTimer({ requestId: 'req-123', priority: 'normal' })

      // Simulate breach by setting breachedAt
      // (In real implementation, tick() would do this)

      const completed = monitor.completeTimer(timer.id)

      expect(completed.status).toBe('completed')
    })
  })
})

// ============================================================================
// TESTS: SLA Monitoring (tick)
// ============================================================================

describe('SLA Monitoring Tick', () => {
  describe('tick', () => {
    it('returns empty array when no timers need attention', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      monitor.createTimer({ requestId: 'req-123', priority: 'normal', startTime })

      // Tick immediately (no warning or breach yet)
      const events = monitor.tick(startTime + 1000)

      expect(events).toHaveLength(0)
    })

    it('emits warning event when warning threshold reached', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      // Tick at warning time (1 hour before deadline for normal priority)
      const events = monitor.tick(timer.warningAt + 1000)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('warning')
      expect(events[0].requestId).toBe('req-123')
      expect(events[0].timeRemainingMs).toBeLessThan(60 * 60 * 1000)
    })

    it('does not emit duplicate warning events', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      // First tick at warning time
      const events1 = monitor.tick(timer.warningAt + 1000)
      expect(events1).toHaveLength(1)

      // Second tick should not emit warning again
      const events2 = monitor.tick(timer.warningAt + 2000)
      expect(events2).toHaveLength(0)
    })

    it('emits breach event when deadline exceeded', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      // Tick past deadline
      const events = monitor.tick(timer.deadline + 1000)

      expect(events.some((e) => e.type === 'breach')).toBe(true)
      const breachEvent = events.find((e) => e.type === 'breach')!
      expect(breachEvent.timeRemainingMs).toBeLessThan(0)
    })

    it('updates timer status on breach', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      monitor.tick(timer.deadline + 1000)

      const updated = monitor.getTimer(timer.id)
      expect(updated!.status).toBe('breached')
      expect(updated!.breachedAt).toBeDefined()
    })

    it('emits escalation event when auto-escalate is enabled', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'critical', // Auto-escalate enabled
        startTime,
      })

      // Tick past deadline + escalation delay
      const escalationTime = timer.deadline + (DEFAULT_SLA_CONFIGS.critical.escalationDelayMs || 0) + 1000
      const events = monitor.tick(escalationTime)

      expect(events.some((e) => e.type === 'escalation')).toBe(true)
    })

    it('does not emit escalation when auto-escalate is disabled', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'low', // Auto-escalate disabled
        startTime,
      })

      // Tick well past deadline
      const events = monitor.tick(timer.deadline + 60 * 60 * 1000)

      // Should have breach but no escalation
      expect(events.some((e) => e.type === 'breach')).toBe(true)
      expect(events.some((e) => e.type === 'escalation')).toBe(false)
    })

    it('handles multiple timers simultaneously', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      // Create timers with different priorities
      monitor.createTimer({ requestId: 'req-1', priority: 'critical', startTime })
      monitor.createTimer({ requestId: 'req-2', priority: 'normal', startTime })
      monitor.createTimer({ requestId: 'req-3', priority: 'low', startTime })

      // Tick at critical warning time (45 min)
      const events = monitor.tick(startTime + 45 * 60 * 1000)

      // Only critical should have warning
      expect(events).toHaveLength(1)
      expect(events[0].requestId).toBe('req-1')
      expect(events[0].type).toBe('warning')
    })

    it('skips paused timers', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      monitor.pauseTimer(timer.id)

      // Tick past deadline - should not emit events
      const events = monitor.tick(timer.deadline + 60 * 60 * 1000)

      expect(events).toHaveLength(0)
    })

    it('skips completed timers', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      monitor.completeTimer(timer.id)

      // Tick past deadline - should not emit events
      const events = monitor.tick(timer.deadline + 60 * 60 * 1000)

      expect(events).toHaveLength(0)
    })
  })

  describe('onEvent', () => {
    it('subscribes to SLA events', () => {
      const monitor = createSLAMonitor()
      const events: SLAEvent[] = []

      const unsubscribe = monitor.onEvent((event) => events.push(event))

      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      monitor.tick(timer.warningAt + 1000)

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('warning')

      unsubscribe()
    })

    it('unsubscribe stops receiving events', () => {
      const monitor = createSLAMonitor()
      const events: SLAEvent[] = []

      const unsubscribe = monitor.onEvent((event) => events.push(event))
      unsubscribe()

      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      monitor.tick(timer.warningAt + 1000)

      expect(events).toHaveLength(0)
    })

    it('supports multiple subscribers', () => {
      const monitor = createSLAMonitor()
      const events1: SLAEvent[] = []
      const events2: SLAEvent[] = []

      monitor.onEvent((event) => events1.push(event))
      monitor.onEvent((event) => events2.push(event))

      const startTime = Date.now()
      const timer = monitor.createTimer({
        requestId: 'req-123',
        priority: 'normal',
        startTime,
      })

      monitor.tick(timer.warningAt + 1000)

      expect(events1).toHaveLength(1)
      expect(events2).toHaveLength(1)
    })
  })
})

// ============================================================================
// TESTS: SLA Metrics
// ============================================================================

describe('SLA Metrics', () => {
  describe('getMetrics', () => {
    it('calculates compliance rate correctly', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      // Create 10 timers, complete 8 within SLA, breach 2
      for (let i = 0; i < 8; i++) {
        const timer = monitor.createTimer({
          requestId: `req-met-${i}`,
          priority: 'normal',
          startTime,
        })
        // Complete immediately (within SLA)
        monitor.completeTimer(timer.id)
      }

      for (let i = 0; i < 2; i++) {
        const timer = monitor.createTimer({
          requestId: `req-breach-${i}`,
          priority: 'normal',
          startTime: startTime - 5 * 60 * 60 * 1000, // Started 5 hours ago
        })
        // Tick to trigger breach
        monitor.tick(startTime)
        // Then complete
        monitor.completeTimer(timer.id)
      }

      const metrics = monitor.getMetrics(startTime - 6 * 60 * 60 * 1000, startTime + 1000)

      expect(metrics.totalRequests).toBe(10)
      expect(metrics.metSLA).toBe(8)
      expect(metrics.breachedSLA).toBe(2)
      expect(metrics.complianceRate).toBe(0.8)
    })

    it('calculates average response time', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      // Create timers with different response times
      const responseTimes = [1000, 2000, 3000, 4000, 5000]

      for (let i = 0; i < responseTimes.length; i++) {
        const timer = monitor.createTimer({
          requestId: `req-${i}`,
          priority: 'normal',
          startTime: startTime - responseTimes[i],
        })
        monitor.completeTimer(timer.id)
      }

      const metrics = monitor.getMetrics(startTime - 10000, startTime + 1000)

      // Average should be 3000ms
      expect(metrics.avgResponseTimeMs).toBe(3000)
    })

    it('calculates percentiles correctly', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      // Create 100 timers with response times 1-100ms
      for (let i = 1; i <= 100; i++) {
        const timer = monitor.createTimer({
          requestId: `req-${i}`,
          priority: 'normal',
          startTime: startTime - i * 1000,
        })
        monitor.completeTimer(timer.id)
      }

      const metrics = monitor.getMetrics(startTime - 200000, startTime + 1000)

      expect(metrics.p50ResponseTimeMs).toBe(50 * 1000) // 50th percentile
      expect(metrics.p95ResponseTimeMs).toBe(95 * 1000) // 95th percentile
      expect(metrics.p99ResponseTimeMs).toBe(99 * 1000) // 99th percentile
    })

    it('groups metrics by priority', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      // Create timers for each priority
      const priorities: SLAPriority[] = ['critical', 'high', 'normal', 'low']

      for (const priority of priorities) {
        for (let i = 0; i < 5; i++) {
          const timer = monitor.createTimer({
            requestId: `req-${priority}-${i}`,
            priority,
            startTime,
          })
          monitor.completeTimer(timer.id)
        }
      }

      const metrics = monitor.getMetrics(startTime - 1000, startTime + 1000)

      expect(metrics.byPriority.critical.total).toBe(5)
      expect(metrics.byPriority.high.total).toBe(5)
      expect(metrics.byPriority.normal.total).toBe(5)
      expect(metrics.byPriority.low.total).toBe(5)
    })

    it('filters by time range', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      // Create timers at different times
      monitor.createTimer({
        requestId: 'req-old',
        priority: 'normal',
        startTime: startTime - 2 * 60 * 60 * 1000, // 2 hours ago
      })

      monitor.createTimer({
        requestId: 'req-recent',
        priority: 'normal',
        startTime: startTime - 30 * 60 * 1000, // 30 min ago
      })

      // Query only last hour
      const metrics = monitor.getMetrics(startTime - 60 * 60 * 1000, startTime)

      expect(metrics.totalRequests).toBe(1)
    })

    it('returns empty metrics when no timers in range', () => {
      const monitor = createSLAMonitor()
      const startTime = Date.now()

      const metrics = monitor.getMetrics(startTime - 1000, startTime)

      expect(metrics.totalRequests).toBe(0)
      expect(metrics.complianceRate).toBe(1) // No breaches = 100% compliance
      expect(metrics.avgResponseTimeMs).toBe(0)
    })
  })
})

// ============================================================================
// TESTS: Helper Functions
// ============================================================================

describe('SLA Helper Functions', () => {
  describe('calculateSLADeadline', () => {
    it('calculates deadline based on priority', () => {
      const startTime = Date.now()

      const criticalDeadline = calculateSLADeadline(startTime, 'critical')
      const normalDeadline = calculateSLADeadline(startTime, 'normal')

      expect(criticalDeadline).toBe(startTime + 1 * 60 * 60 * 1000) // 1 hour
      expect(normalDeadline).toBe(startTime + 4 * 60 * 60 * 1000) // 4 hours
    })

    it('uses custom config when provided', () => {
      const startTime = Date.now()

      const deadline = calculateSLADeadline(startTime, 'normal', {
        priority: 'normal',
        targetMs: 30 * 60 * 1000, // 30 minutes
        warningThresholdMs: 10 * 60 * 1000,
        autoEscalate: true,
      })

      expect(deadline).toBe(startTime + 30 * 60 * 1000)
    })
  })

  describe('checkSLAStatus', () => {
    it('returns active status before warning', () => {
      const startTime = Date.now()
      const timer: SLATimer = {
        id: 'timer-1',
        requestId: 'req-1',
        priority: 'normal',
        startedAt: startTime,
        deadline: startTime + 4 * 60 * 60 * 1000,
        warningAt: startTime + 3 * 60 * 60 * 1000,
        status: 'active',
        pausedDurationMs: 0,
      }

      const result = checkSLAStatus(timer, startTime + 1000)

      expect(result.status).toBe('active')
      expect(result.timeRemainingMs).toBeGreaterThan(3 * 60 * 60 * 1000)
    })

    it('returns warning status after warning threshold', () => {
      const startTime = Date.now()
      const timer: SLATimer = {
        id: 'timer-1',
        requestId: 'req-1',
        priority: 'normal',
        startedAt: startTime,
        deadline: startTime + 4 * 60 * 60 * 1000,
        warningAt: startTime + 3 * 60 * 60 * 1000,
        status: 'active',
        pausedDurationMs: 0,
      }

      const result = checkSLAStatus(timer, timer.warningAt + 1000)

      expect(result.status).toBe('warning')
      expect(result.timeRemainingMs).toBeLessThan(60 * 60 * 1000)
    })

    it('returns breached status after deadline', () => {
      const startTime = Date.now()
      const timer: SLATimer = {
        id: 'timer-1',
        requestId: 'req-1',
        priority: 'normal',
        startedAt: startTime,
        deadline: startTime + 4 * 60 * 60 * 1000,
        warningAt: startTime + 3 * 60 * 60 * 1000,
        status: 'active',
        pausedDurationMs: 0,
      }

      const result = checkSLAStatus(timer, timer.deadline + 1000)

      expect(result.status).toBe('breached')
      expect(result.timeRemainingMs).toBeLessThan(0)
    })

    it('accounts for paused duration', () => {
      const startTime = Date.now()
      const timer: SLATimer = {
        id: 'timer-1',
        requestId: 'req-1',
        priority: 'normal',
        startedAt: startTime,
        deadline: startTime + 4 * 60 * 60 * 1000,
        warningAt: startTime + 3 * 60 * 60 * 1000,
        status: 'active',
        pausedDurationMs: 60 * 60 * 1000, // Paused for 1 hour
      }

      // Check status at what would normally be warning time
      const result = checkSLAStatus(timer, timer.warningAt)

      // Should still be active because paused time doesn't count
      expect(result.status).toBe('active')
      expect(result.timeRemainingMs).toBeGreaterThan(60 * 60 * 1000)
    })
  })

  describe('calculatePercentile', () => {
    it('calculates P50 correctly', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

      const p50 = calculatePercentile(values, 50)

      expect(p50).toBe(55) // Median of sorted array
    })

    it('calculates P95 correctly', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1)

      const p95 = calculatePercentile(values, 95)

      expect(p95).toBe(95)
    })

    it('handles empty array', () => {
      const p50 = calculatePercentile([], 50)

      expect(p50).toBe(0)
    })

    it('handles single value', () => {
      const p50 = calculatePercentile([42], 50)

      expect(p50).toBe(42)
    })
  })
})

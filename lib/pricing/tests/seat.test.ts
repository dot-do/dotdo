/**
 * Seat-Based Pricing Tests
 *
 * Tests for SeatManager - a concurrency manager for seat-based pricing.
 * Tracks concurrent agent/human usage and handles overflow behavior.
 *
 * TDD Red-Green-Refactor methodology:
 * 1. RED: These tests are written first (failing)
 * 2. GREEN: Implement minimal code to pass
 * 3. REFACTOR: Clean up while keeping tests green
 *
 * @module lib/pricing/tests/seat.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import the implementation under test (will fail until implemented)
import {
  createSeatManager,
  type SeatManager,
  type SeatType,
  type AcquireResult,
  type SeatManagerConfig,
} from '../seat'

import type { SeatPricing } from '../types'

// ============================================================================
// Test Fixtures
// ============================================================================

const basePricing: SeatPricing = {
  model: 'seat',
  agents: { count: 5, price: 500 },
  humans: { count: 2, price: 2000 },
}

// ============================================================================
// createSeatManager() Tests
// ============================================================================

describe('createSeatManager()', () => {
  it('returns a SeatManager object', () => {
    const manager = createSeatManager({ pricing: basePricing })

    expect(manager).toBeDefined()
    expect(typeof manager.acquire).toBe('function')
    expect(typeof manager.release).toBe('function')
    expect(typeof manager.status).toBe('function')
  })

  it('accepts SeatPricing configuration', () => {
    const pricing: SeatPricing = {
      model: 'seat',
      agents: { count: 10, price: 1000 },
      humans: { count: 5, price: 5000 },
    }

    const manager = createSeatManager({ pricing })
    const status = manager.status()

    expect(status.agents.total).toBe(10)
    expect(status.humans.total).toBe(5)
  })

  it('defaults overflow to queue when not specified', () => {
    const manager = createSeatManager({ pricing: basePricing })
    const config = manager.config()

    expect(config.overflow).toBe('queue')
  })

  it('respects overflow setting from pricing config', () => {
    const pricing: SeatPricing = {
      ...basePricing,
      overflow: 'reject',
    }

    const manager = createSeatManager({ pricing })
    const config = manager.config()

    expect(config.overflow).toBe('reject')
  })
})

// ============================================================================
// status() Method Tests
// ============================================================================

describe('status()', () => {
  let manager: SeatManager

  beforeEach(() => {
    manager = createSeatManager({ pricing: basePricing })
  })

  it('returns current seat status', () => {
    const status = manager.status()

    expect(status).toBeDefined()
    expect(status.agents).toBeDefined()
    expect(status.humans).toBeDefined()
  })

  it('shows total seats from config', () => {
    const status = manager.status()

    expect(status.agents.total).toBe(5)
    expect(status.humans.total).toBe(2)
  })

  it('shows zero active seats initially', () => {
    const status = manager.status()

    expect(status.agents.active).toBe(0)
    expect(status.humans.active).toBe(0)
  })

  it('shows available seats (total - active)', () => {
    const status = manager.status()

    expect(status.agents.available).toBe(5)
    expect(status.humans.available).toBe(2)
  })

  it('shows zero queued seats initially', () => {
    const status = manager.status()

    expect(status.agents.queued).toBe(0)
    expect(status.humans.queued).toBe(0)
  })
})

// ============================================================================
// acquire() Method Tests - Basic
// ============================================================================

describe('acquire() - basic', () => {
  let manager: SeatManager

  beforeEach(() => {
    manager = createSeatManager({ pricing: basePricing })
  })

  it('acquires an agent seat when available', async () => {
    const result = await manager.acquire('agent')

    expect(result.success).toBe(true)
    expect(result.seatId).toBeDefined()
    expect(typeof result.seatId).toBe('string')
  })

  it('acquires a human seat when available', async () => {
    const result = await manager.acquire('human')

    expect(result.success).toBe(true)
    expect(result.seatId).toBeDefined()
  })

  it('increments active count after acquisition', async () => {
    await manager.acquire('agent')
    const status = manager.status()

    expect(status.agents.active).toBe(1)
    expect(status.agents.available).toBe(4)
  })

  it('allows acquiring multiple seats up to limit', async () => {
    // Acquire all 5 agent seats
    for (let i = 0; i < 5; i++) {
      const result = await manager.acquire('agent')
      expect(result.success).toBe(true)
    }

    const status = manager.status()
    expect(status.agents.active).toBe(5)
    expect(status.agents.available).toBe(0)
  })

  it('returns unique seat IDs', async () => {
    const result1 = await manager.acquire('agent')
    const result2 = await manager.acquire('agent')

    expect(result1.seatId).not.toBe(result2.seatId)
  })
})

// ============================================================================
// release() Method Tests
// ============================================================================

describe('release()', () => {
  let manager: SeatManager

  beforeEach(() => {
    manager = createSeatManager({ pricing: basePricing })
  })

  it('releases a seat by seatId', async () => {
    const { seatId } = await manager.acquire('agent')
    const released = manager.release(seatId!)

    expect(released).toBe(true)
  })

  it('decrements active count after release', async () => {
    const { seatId } = await manager.acquire('agent')
    manager.release(seatId!)

    const status = manager.status()
    expect(status.agents.active).toBe(0)
    expect(status.agents.available).toBe(5)
  })

  it('returns false for invalid seatId', () => {
    const released = manager.release('invalid-seat-id')

    expect(released).toBe(false)
  })

  it('returns false when releasing same seat twice', async () => {
    const { seatId } = await manager.acquire('agent')
    manager.release(seatId!)
    const secondRelease = manager.release(seatId!)

    expect(secondRelease).toBe(false)
  })

  it('makes seat available for next acquisition', async () => {
    // Fill all 5 agent seats
    const seats = []
    for (let i = 0; i < 5; i++) {
      const result = await manager.acquire('agent')
      seats.push(result.seatId)
    }

    // Release one
    manager.release(seats[0]!)

    // Should be able to acquire again
    const newResult = await manager.acquire('agent')
    expect(newResult.success).toBe(true)
  })
})

// ============================================================================
// Overflow: Queue Behavior
// ============================================================================

describe('overflow: queue', () => {
  let manager: SeatManager

  beforeEach(() => {
    manager = createSeatManager({
      pricing: { ...basePricing, overflow: 'queue' },
    })
  })

  it('queues request when no seats available', async () => {
    // Fill all 5 agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    // This should queue
    const queuePromise = manager.acquire('agent')

    // Check status before resolving
    const status = manager.status()
    expect(status.agents.queued).toBe(1)

    // Clean up - release a seat to let queued request complete
    manager.release((await manager.status().agents.activeSeatIds[0])!)
    await queuePromise
  })

  it('processes queue in FIFO order', async () => {
    // Fill all 2 human seats
    const seat1 = await manager.acquire('human')
    const seat2 = await manager.acquire('human')

    // Queue two more
    const order: number[] = []
    const promise1 = manager.acquire('human').then(() => order.push(1))
    const promise2 = manager.acquire('human').then(() => order.push(2))

    // Release seats in order
    manager.release(seat1.seatId!)
    await promise1
    manager.release(seat2.seatId!)
    await promise2

    expect(order).toEqual([1, 2])
  })

  it('resolves queued request when seat becomes available', async () => {
    // Fill all agent seats
    const firstSeat = await manager.acquire('agent')
    for (let i = 1; i < 5; i++) {
      await manager.acquire('agent')
    }

    // Queue a request
    const queuedPromise = manager.acquire('agent')

    // Release a seat
    manager.release(firstSeat.seatId!)

    // Queued request should resolve
    const result = await queuedPromise
    expect(result.success).toBe(true)
  })

  it('returns queued: true in result for queued acquisitions', async () => {
    // Fill all agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    // Get the first seat to release later
    const status = manager.status()
    const firstSeatId = status.agents.activeSeatIds[0]

    // Queue a request
    const queuedPromise = manager.acquire('agent')

    // Release to let it resolve
    manager.release(firstSeatId)

    const result = await queuedPromise
    expect(result.queued).toBe(true)
  })
})

// ============================================================================
// Overflow: Reject Behavior
// ============================================================================

describe('overflow: reject', () => {
  let manager: SeatManager

  beforeEach(() => {
    manager = createSeatManager({
      pricing: { ...basePricing, overflow: 'reject' },
    })
  })

  it('rejects when no seats available', async () => {
    // Fill all 5 agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    // This should be rejected
    const result = await manager.acquire('agent')

    expect(result.success).toBe(false)
    expect(result.reason).toBe('capacity-exceeded')
  })

  it('does not queue rejected requests', async () => {
    // Fill all agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    await manager.acquire('agent')

    const status = manager.status()
    expect(status.agents.queued).toBe(0)
  })

  it('succeeds again after seat is released', async () => {
    // Fill all agent seats
    const firstSeat = await manager.acquire('agent')
    for (let i = 1; i < 5; i++) {
      await manager.acquire('agent')
    }

    // Rejected
    const rejected = await manager.acquire('agent')
    expect(rejected.success).toBe(false)

    // Release one
    manager.release(firstSeat.seatId!)

    // Should succeed now
    const result = await manager.acquire('agent')
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Overflow: Burst Pricing Behavior
// ============================================================================

describe('overflow: burst-pricing', () => {
  let manager: SeatManager

  beforeEach(() => {
    manager = createSeatManager({
      pricing: {
        ...basePricing,
        overflow: 'burst-pricing',
        burstMultiplier: 1.5,
      },
    })
  })

  it('allows acquiring beyond limit with burst pricing', async () => {
    // Fill all 5 agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    // This should succeed with burst pricing
    const result = await manager.acquire('agent')

    expect(result.success).toBe(true)
    expect(result.burst).toBe(true)
  })

  it('tracks burst seats separately', async () => {
    // Fill all agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    // Add burst seat
    await manager.acquire('agent')

    const status = manager.status()
    expect(status.agents.active).toBe(6)
    expect(status.agents.burst).toBe(1)
  })

  it('includes burst multiplier in result', async () => {
    // Fill all agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    const result = await manager.acquire('agent')

    expect(result.burstMultiplier).toBe(1.5)
  })

  it('uses default burst multiplier of 2.0 when not specified', async () => {
    const managerNoMultiplier = createSeatManager({
      pricing: {
        ...basePricing,
        overflow: 'burst-pricing',
        // burstMultiplier not specified
      },
    })

    // Fill all agent seats
    for (let i = 0; i < 5; i++) {
      await managerNoMultiplier.acquire('agent')
    }

    const result = await managerNoMultiplier.acquire('agent')

    expect(result.burstMultiplier).toBe(2.0)
  })

  it('releases burst seats correctly', async () => {
    // Fill all agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    // Add burst seat
    const burstSeat = await manager.acquire('agent')

    // Release burst seat
    manager.release(burstSeat.seatId!)

    const status = manager.status()
    expect(status.agents.active).toBe(5)
    expect(status.agents.burst).toBe(0)
  })
})

// ============================================================================
// calculateCost() Method Tests
// ============================================================================

describe('calculateCost()', () => {
  let manager: SeatManager

  beforeEach(() => {
    manager = createSeatManager({
      pricing: {
        ...basePricing,
        overflow: 'burst-pricing',
        burstMultiplier: 1.5,
      },
    })
  })

  it('returns base cost for agent seats', () => {
    const cost = manager.calculateCost()

    // agents.price ($500) + humans.price ($2000) = $2500
    // Note: price is total for the tier, not per-seat
    expect(cost.base).toBe(2500)
  })

  it('returns zero burst cost when no burst seats used', () => {
    const cost = manager.calculateCost()

    expect(cost.burst).toBe(0)
  })

  it('calculates burst cost with multiplier', async () => {
    // Fill all agent seats
    for (let i = 0; i < 5; i++) {
      await manager.acquire('agent')
    }

    // Add 2 burst seats
    await manager.acquire('agent')
    await manager.acquire('agent')

    const cost = manager.calculateCost()

    // 2 burst seats * $500/5 per seat * 1.5 multiplier = $300
    // Per-seat agent cost = $500 / 5 = $100
    // Burst cost = 2 * $100 * 1.5 = $300
    expect(cost.burst).toBe(300)
  })

  it('returns total cost (base + burst)', async () => {
    // Fill all agent seats + 1 burst
    for (let i = 0; i < 6; i++) {
      await manager.acquire('agent')
    }

    const cost = manager.calculateCost()

    // Base: $2500, Burst: 1 * ($500/5) * 1.5 = $150
    // Per-agent-seat = $500/5 = $100
    expect(cost.total).toBe(2650)
  })
})

// ============================================================================
// config() Method Tests
// ============================================================================

describe('config()', () => {
  it('returns the current configuration', () => {
    const manager = createSeatManager({
      pricing: basePricing,
    })

    const config = manager.config()

    expect(config.agents.count).toBe(5)
    expect(config.agents.price).toBe(500)
    expect(config.humans.count).toBe(2)
    expect(config.humans.price).toBe(2000)
  })

  it('includes overflow setting', () => {
    const manager = createSeatManager({
      pricing: { ...basePricing, overflow: 'reject' },
    })

    const config = manager.config()

    expect(config.overflow).toBe('reject')
  })

  it('includes burst multiplier when specified', () => {
    const manager = createSeatManager({
      pricing: { ...basePricing, overflow: 'burst-pricing', burstMultiplier: 1.5 },
    })

    const config = manager.config()

    expect(config.burstMultiplier).toBe(1.5)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles zero agent seats configuration', async () => {
    const manager = createSeatManager({
      pricing: {
        model: 'seat',
        agents: { count: 0, price: 0 },
        humans: { count: 2, price: 2000 },
        overflow: 'reject',
      },
    })

    const result = await manager.acquire('agent')

    expect(result.success).toBe(false)
  })

  it('handles zero human seats configuration', async () => {
    const manager = createSeatManager({
      pricing: {
        model: 'seat',
        agents: { count: 5, price: 500 },
        humans: { count: 0, price: 0 },
        overflow: 'reject',
      },
    })

    const result = await manager.acquire('human')

    expect(result.success).toBe(false)
  })

  it('handles concurrent acquire calls correctly', async () => {
    const manager = createSeatManager({
      pricing: {
        model: 'seat',
        agents: { count: 2, price: 500 },
        humans: { count: 2, price: 2000 },
        overflow: 'reject',
      },
    })

    // Fire 5 concurrent requests for 2 seats
    const results = await Promise.all([
      manager.acquire('agent'),
      manager.acquire('agent'),
      manager.acquire('agent'),
      manager.acquire('agent'),
      manager.acquire('agent'),
    ])

    const successful = results.filter((r) => r.success)
    const rejected = results.filter((r) => !r.success)

    expect(successful.length).toBe(2)
    expect(rejected.length).toBe(3)
  })

  it('handles interleaved agent and human acquisitions', async () => {
    const manager = createSeatManager({
      pricing: basePricing,
    })

    const agentSeat = await manager.acquire('agent')
    const humanSeat = await manager.acquire('human')

    expect(agentSeat.success).toBe(true)
    expect(humanSeat.success).toBe(true)

    const status = manager.status()
    expect(status.agents.active).toBe(1)
    expect(status.humans.active).toBe(1)
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('type safety', () => {
  it('SeatType is agent or human', () => {
    const agentType: SeatType = 'agent'
    const humanType: SeatType = 'human'

    expect(agentType).toBe('agent')
    expect(humanType).toBe('human')
  })

  it('AcquireResult has required properties', async () => {
    const manager = createSeatManager({ pricing: basePricing })
    const result: AcquireResult = await manager.acquire('agent')

    expect('success' in result).toBe(true)
    expect('seatId' in result).toBe(true)
  })
})

// ============================================================================
// Seat Usage Tracking Tests (TDD: RED phase for dotdo-dswif)
// ============================================================================

describe('seat usage tracking', () => {
  let manager: SeatManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = createSeatManager({
      pricing: basePricing,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('usageHistory()', () => {
    it('returns empty history initially', () => {
      const history = manager.usageHistory()

      expect(history).toEqual([])
    })

    it('records usage when a seat is released', async () => {
      const { seatId } = await manager.acquire('agent')

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000)

      manager.release(seatId!)

      const history = manager.usageHistory()

      expect(history.length).toBe(1)
      expect(history[0].type).toBe('agent')
      expect(history[0].duration).toBe(5000)
      expect(history[0].burst).toBe(false)
    })

    it('records burst status in usage history', async () => {
      const burstManager = createSeatManager({
        pricing: { ...basePricing, overflow: 'burst-pricing', burstMultiplier: 1.5 },
      })

      // Fill all agent seats
      for (let i = 0; i < 5; i++) {
        await burstManager.acquire('agent')
      }

      // Acquire burst seat
      const { seatId } = await burstManager.acquire('agent')

      vi.advanceTimersByTime(3000)

      burstManager.release(seatId!)

      const history = burstManager.usageHistory()
      const burstUsage = history.find((u) => u.burst)

      expect(burstUsage).toBeDefined()
      expect(burstUsage!.burst).toBe(true)
      expect(burstUsage!.duration).toBe(3000)
    })

    it('records multiple usage entries', async () => {
      const seat1 = await manager.acquire('agent')
      vi.advanceTimersByTime(1000)
      manager.release(seat1.seatId!)

      const seat2 = await manager.acquire('human')
      vi.advanceTimersByTime(2000)
      manager.release(seat2.seatId!)

      const history = manager.usageHistory()

      expect(history.length).toBe(2)
      expect(history[0].duration).toBe(1000)
      expect(history[1].duration).toBe(2000)
    })
  })

  describe('usageStats()', () => {
    it('returns zero stats initially', () => {
      const stats = manager.usageStats()

      expect(stats.totalSessions).toBe(0)
      expect(stats.totalDuration).toBe(0)
      expect(stats.agentSessions).toBe(0)
      expect(stats.humanSessions).toBe(0)
      expect(stats.burstSessions).toBe(0)
      expect(stats.averageDuration).toBe(0)
    })

    it('calculates total sessions and duration', async () => {
      const seat1 = await manager.acquire('agent')
      vi.advanceTimersByTime(5000)
      manager.release(seat1.seatId!)

      const seat2 = await manager.acquire('agent')
      vi.advanceTimersByTime(3000)
      manager.release(seat2.seatId!)

      const stats = manager.usageStats()

      expect(stats.totalSessions).toBe(2)
      expect(stats.totalDuration).toBe(8000)
      expect(stats.averageDuration).toBe(4000)
    })

    it('tracks agent vs human sessions separately', async () => {
      const agentSeat = await manager.acquire('agent')
      vi.advanceTimersByTime(1000)
      manager.release(agentSeat.seatId!)

      const humanSeat = await manager.acquire('human')
      vi.advanceTimersByTime(1000)
      manager.release(humanSeat.seatId!)

      const humanSeat2 = await manager.acquire('human')
      vi.advanceTimersByTime(1000)
      manager.release(humanSeat2.seatId!)

      const stats = manager.usageStats()

      expect(stats.agentSessions).toBe(1)
      expect(stats.humanSessions).toBe(2)
    })

    it('tracks burst sessions separately', async () => {
      const burstManager = createSeatManager({
        pricing: { ...basePricing, overflow: 'burst-pricing' },
      })

      // Fill all agent seats
      for (let i = 0; i < 5; i++) {
        const { seatId } = await burstManager.acquire('agent')
        vi.advanceTimersByTime(100)
        burstManager.release(seatId!)
      }

      // Add burst seats
      for (let i = 0; i < 5; i++) {
        await burstManager.acquire('agent')
      }
      const burst1 = await burstManager.acquire('agent')
      const burst2 = await burstManager.acquire('agent')

      vi.advanceTimersByTime(500)

      burstManager.release(burst1.seatId!)
      burstManager.release(burst2.seatId!)

      const stats = burstManager.usageStats()

      expect(stats.burstSessions).toBe(2)
    })

    it('calculates peak concurrent usage', async () => {
      // Acquire 3 agent seats simultaneously
      const seat1 = await manager.acquire('agent')
      const seat2 = await manager.acquire('agent')
      const seat3 = await manager.acquire('agent')

      vi.advanceTimersByTime(1000)

      // Release one, peak should still be 3
      manager.release(seat1.seatId!)

      // Acquire more
      const seat4 = await manager.acquire('agent')
      const seat5 = await manager.acquire('agent')

      vi.advanceTimersByTime(1000)

      manager.release(seat2.seatId!)
      manager.release(seat3.seatId!)
      manager.release(seat4.seatId!)
      manager.release(seat5.seatId!)

      const stats = manager.usageStats()

      expect(stats.peakConcurrent).toBe(4) // Peak was seat2, seat3, seat4, seat5 active
    })
  })

  describe('clearHistory()', () => {
    it('clears usage history', async () => {
      const { seatId } = await manager.acquire('agent')
      vi.advanceTimersByTime(1000)
      manager.release(seatId!)

      expect(manager.usageHistory().length).toBe(1)

      manager.clearHistory()

      expect(manager.usageHistory()).toEqual([])
    })

    it('resets usage stats', async () => {
      const { seatId } = await manager.acquire('agent')
      vi.advanceTimersByTime(1000)
      manager.release(seatId!)

      manager.clearHistory()

      const stats = manager.usageStats()

      expect(stats.totalSessions).toBe(0)
      expect(stats.totalDuration).toBe(0)
    })
  })
})

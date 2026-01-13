/**
 * Seat-Based Pricing - Concurrency Manager
 *
 * Manages concurrent agent and human seat allocation for seat-based pricing.
 * Tracks active seats, handles overflow behavior (queue, reject, burst-pricing),
 * and calculates costs including burst charges.
 *
 * @example
 * const manager = createSeatManager({
 *   pricing: {
 *     model: 'seat',
 *     agents: { count: 5, price: 500 },
 *     humans: { count: 2, price: 2000 },
 *     overflow: 'burst-pricing',
 *     burstMultiplier: 1.5,
 *   },
 * })
 *
 * const result = await manager.acquire('agent')
 * if (result.success) {
 *   // Use the seat...
 *   manager.release(result.seatId!)
 * }
 *
 * @module lib/pricing/seat
 */

import type { SeatPricing, SeatOverflowBehavior, SeatConfig } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Type of seat: agent (AI) or human (escalation)
 */
export type SeatType = 'agent' | 'human'

/**
 * Result of an acquire() call
 */
export interface AcquireResult {
  /** Whether the seat was successfully acquired */
  success: boolean
  /** Unique identifier for the acquired seat (undefined if failed) */
  seatId?: string
  /** Whether this request was queued before being fulfilled */
  queued?: boolean
  /** Whether this is a burst seat (over limit) */
  burst?: boolean
  /** Burst price multiplier (only present for burst seats) */
  burstMultiplier?: number
  /** Reason for failure (only present when success is false) */
  reason?: 'capacity-exceeded'
}

/**
 * Status for a specific seat type
 */
export interface SeatTypeStatus {
  /** Total configured seats */
  total: number
  /** Currently active seats */
  active: number
  /** Available seats (total - active, minimum 0) */
  available: number
  /** Requests waiting in queue */
  queued: number
  /** Active burst seats (over limit) */
  burst: number
  /** IDs of currently active seats */
  activeSeatIds: string[]
}

/**
 * Overall seat status
 */
export interface SeatStatus {
  agents: SeatTypeStatus
  humans: SeatTypeStatus
}

/**
 * Cost breakdown for seat usage
 */
export interface SeatCost {
  /** Base cost for configured seats */
  base: number
  /** Additional cost for burst seats */
  burst: number
  /** Total cost (base + burst) */
  total: number
}

/**
 * Seat manager configuration (read-only view)
 */
export interface SeatManagerConfigView {
  agents: SeatConfig
  humans: SeatConfig
  overflow: SeatOverflowBehavior
  burstMultiplier?: number
}

/**
 * Configuration for creating a SeatManager
 */
export interface SeatManagerConfig {
  /** Seat pricing configuration */
  pricing: SeatPricing
}

/**
 * Internal seat record
 */
interface SeatRecord {
  id: string
  type: SeatType
  burst: boolean
  acquiredAt: number
}

/**
 * Queued request waiting for a seat
 */
interface QueuedRequest {
  type: SeatType
  resolve: (result: AcquireResult) => void
}

/**
 * Seat Manager interface for tracking concurrent usage
 */
export interface SeatManager {
  /**
   * Acquire a seat of the specified type.
   * Behavior when capacity exceeded depends on overflow setting.
   */
  acquire(type: SeatType): Promise<AcquireResult>

  /**
   * Release a previously acquired seat.
   * @returns true if the seat was released, false if not found
   */
  release(seatId: string): boolean

  /**
   * Get current seat status
   */
  status(): SeatStatus

  /**
   * Calculate current cost based on seat usage
   */
  calculateCost(): SeatCost

  /**
   * Get current configuration
   */
  config(): SeatManagerConfigView
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Generate a unique seat ID
 */
function generateSeatId(): string {
  return `seat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Create a SeatManager for tracking concurrent agent and human seat usage.
 *
 * @param config - Configuration with SeatPricing
 * @returns A SeatManager instance
 *
 * @example
 * const manager = createSeatManager({
 *   pricing: {
 *     model: 'seat',
 *     agents: { count: 5, price: 500 },
 *     humans: { count: 2, price: 2000 },
 *     overflow: 'queue',
 *   },
 * })
 */
export function createSeatManager(config: SeatManagerConfig): SeatManager {
  const { pricing } = config

  // Internal state
  const seats = new Map<string, SeatRecord>()
  const agentQueue: QueuedRequest[] = []
  const humanQueue: QueuedRequest[] = []

  // Derived settings
  const overflow: SeatOverflowBehavior = pricing.overflow ?? 'queue'
  const burstMultiplier = pricing.burstMultiplier ?? 2.0

  /**
   * Get counts for a specific seat type
   */
  function getTypeCounts(type: SeatType): { active: number; burst: number; seatIds: string[] } {
    let active = 0
    let burst = 0
    const seatIds: string[] = []

    seats.forEach((record, id) => {
      if (record.type === type) {
        active++
        if (record.burst) {
          burst++
        }
        seatIds.push(id)
      }
    })

    return { active, burst, seatIds }
  }

  /**
   * Get the queue for a seat type
   */
  function getQueue(type: SeatType): QueuedRequest[] {
    return type === 'agent' ? agentQueue : humanQueue
  }

  /**
   * Get seat configuration for a type
   */
  function getSeatConfig(type: SeatType): SeatConfig {
    return type === 'agent' ? pricing.agents : pricing.humans
  }

  /**
   * Process queued requests when a seat becomes available
   */
  function processQueue(type: SeatType): void {
    const queue = getQueue(type)
    if (queue.length === 0) return

    const seatConfig = getSeatConfig(type)
    const { active } = getTypeCounts(type)

    if (active < seatConfig.count) {
      const request = queue.shift()!
      const seatId = generateSeatId()

      seats.set(seatId, {
        id: seatId,
        type,
        burst: false,
        acquiredAt: Date.now(),
      })

      request.resolve({
        success: true,
        seatId,
        queued: true,
      })
    }
  }

  return {
    async acquire(type: SeatType): Promise<AcquireResult> {
      const seatConfig = getSeatConfig(type)
      const { active } = getTypeCounts(type)

      // Check if seat is available
      if (active < seatConfig.count) {
        const seatId = generateSeatId()

        seats.set(seatId, {
          id: seatId,
          type,
          burst: false,
          acquiredAt: Date.now(),
        })

        return {
          success: true,
          seatId,
        }
      }

      // Capacity exceeded - handle based on overflow behavior
      switch (overflow) {
        case 'queue': {
          // Add to queue and return a promise
          return new Promise<AcquireResult>((resolve) => {
            const queue = getQueue(type)
            queue.push({ type, resolve })
          })
        }

        case 'reject': {
          return {
            success: false,
            reason: 'capacity-exceeded',
          }
        }

        case 'burst-pricing': {
          const seatId = generateSeatId()

          seats.set(seatId, {
            id: seatId,
            type,
            burst: true,
            acquiredAt: Date.now(),
          })

          return {
            success: true,
            seatId,
            burst: true,
            burstMultiplier,
          }
        }
      }
    },

    release(seatId: string): boolean {
      const record = seats.get(seatId)
      if (!record) {
        return false
      }

      seats.delete(seatId)

      // Process queue for this seat type
      processQueue(record.type)

      return true
    },

    status(): SeatStatus {
      const agentCounts = getTypeCounts('agent')
      const humanCounts = getTypeCounts('human')

      return {
        agents: {
          total: pricing.agents.count,
          active: agentCounts.active,
          available: Math.max(0, pricing.agents.count - agentCounts.active),
          queued: agentQueue.length,
          burst: agentCounts.burst,
          activeSeatIds: agentCounts.seatIds,
        },
        humans: {
          total: pricing.humans.count,
          active: humanCounts.active,
          available: Math.max(0, pricing.humans.count - humanCounts.active),
          queued: humanQueue.length,
          burst: humanCounts.burst,
          activeSeatIds: humanCounts.seatIds,
        },
      }
    },

    calculateCost(): SeatCost {
      // Base cost is the configured seat prices
      const base = pricing.agents.price + pricing.humans.price

      // Calculate burst cost
      const agentCounts = getTypeCounts('agent')
      const humanCounts = getTypeCounts('human')

      // Per-seat costs
      const perAgentSeat = pricing.agents.count > 0 ? pricing.agents.price / pricing.agents.count : 0
      const perHumanSeat = pricing.humans.count > 0 ? pricing.humans.price / pricing.humans.count : 0

      // Burst cost = burst seats * per-seat-cost * multiplier
      const agentBurstCost = agentCounts.burst * perAgentSeat * burstMultiplier
      const humanBurstCost = humanCounts.burst * perHumanSeat * burstMultiplier
      const burst = agentBurstCost + humanBurstCost

      return {
        base,
        burst,
        total: base + burst,
      }
    },

    config(): SeatManagerConfigView {
      return {
        agents: { ...pricing.agents },
        humans: { ...pricing.humans },
        overflow,
        burstMultiplier: overflow === 'burst-pricing' ? burstMultiplier : undefined,
      }
    },
  }
}

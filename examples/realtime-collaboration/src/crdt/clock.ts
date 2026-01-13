/**
 * Lamport Clock - Logical clock for ordering events across distributed nodes
 *
 * Each client maintains its own clock that:
 * 1. Increments on local operations
 * 2. Updates to max(local, remote) + 1 on receiving remote operations
 */

export interface ClockState {
  clientId: string
  counter: number
}

export class LamportClock {
  private counter: number = 0
  public readonly clientId: string

  constructor(clientId: string, initialCounter: number = 0) {
    this.clientId = clientId
    this.counter = initialCounter
  }

  /**
   * Increment clock for local operation
   */
  tick(): number {
    return ++this.counter
  }

  /**
   * Update clock based on received timestamp
   */
  receive(remoteCounter: number): void {
    this.counter = Math.max(this.counter, remoteCounter)
  }

  /**
   * Get current counter value
   */
  getCounter(): number {
    return this.counter
  }

  /**
   * Create a new ID with current timestamp
   */
  createId(): { clientId: string; clock: number } {
    return {
      clientId: this.clientId,
      clock: this.tick(),
    }
  }

  /**
   * Serialize clock state
   */
  toJSON(): ClockState {
    return {
      clientId: this.clientId,
      counter: this.counter,
    }
  }

  /**
   * Create clock from serialized state
   */
  static fromJSON(state: ClockState): LamportClock {
    return new LamportClock(state.clientId, state.counter)
  }
}

/**
 * Vector Clock - Tracks causality across multiple clients
 */
export class VectorClock {
  private clocks: Map<string, number> = new Map()

  constructor(initial?: Record<string, number>) {
    if (initial) {
      for (const [clientId, counter] of Object.entries(initial)) {
        this.clocks.set(clientId, counter)
      }
    }
  }

  /**
   * Get counter for a specific client
   */
  get(clientId: string): number {
    return this.clocks.get(clientId) ?? 0
  }

  /**
   * Increment counter for a client
   */
  increment(clientId: string): number {
    const current = this.get(clientId)
    const next = current + 1
    this.clocks.set(clientId, next)
    return next
  }

  /**
   * Merge with another vector clock (take max of each)
   */
  merge(other: VectorClock): void {
    for (const [clientId, counter] of other.clocks) {
      const current = this.get(clientId)
      if (counter > current) {
        this.clocks.set(clientId, counter)
      }
    }
  }

  /**
   * Check if this clock is causally before or concurrent with another
   */
  happensBefore(other: VectorClock): boolean {
    let atLeastOneLess = false
    for (const [clientId, counter] of this.clocks) {
      const otherCounter = other.get(clientId)
      if (counter > otherCounter) return false
      if (counter < otherCounter) atLeastOneLess = true
    }
    // Check if other has clients we don't have
    for (const [clientId] of other.clocks) {
      if (!this.clocks.has(clientId)) {
        atLeastOneLess = true
      }
    }
    return atLeastOneLess
  }

  /**
   * Check if two clocks are concurrent (neither happens before the other)
   */
  isConcurrent(other: VectorClock): boolean {
    return !this.happensBefore(other) && !other.happensBefore(this)
  }

  /**
   * Serialize to JSON
   */
  toJSON(): Record<string, number> {
    return Object.fromEntries(this.clocks)
  }

  /**
   * Create from JSON
   */
  static fromJSON(json: Record<string, number>): VectorClock {
    return new VectorClock(json)
  }

  /**
   * Clone this vector clock
   */
  clone(): VectorClock {
    return VectorClock.fromJSON(this.toJSON())
  }
}

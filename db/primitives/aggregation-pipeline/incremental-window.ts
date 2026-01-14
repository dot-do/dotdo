/**
 * Incremental Window Aggregation Optimizations
 *
 * Provides optimized window aggregations using incremental computation
 * instead of full window recalculation. Key optimizations:
 *
 * - **Incremental Sliding Windows**: Maintain running state, update incrementally
 * - **Add/Remove Operations**: O(1) add/subtract for most aggregations
 * - **Monotonic Deque**: O(1) amortized MIN/MAX using deque data structure
 * - **Welford's Algorithm**: Numerically stable STDDEV/VARIANCE computation
 * - **TypedArray Optimizations**: Fast numeric batch operations
 *
 * ## Performance Comparison
 *
 * | Aggregation | Full Recalc | Incremental |
 * |-------------|-------------|-------------|
 * | SUM         | O(n)        | O(1)        |
 * | AVG         | O(n)        | O(1)        |
 * | COUNT       | O(n)        | O(1)        |
 * | MIN/MAX     | O(n)        | O(1) amort  |
 * | STDDEV      | O(n)        | O(1)        |
 *
 * @module db/primitives/aggregation-pipeline/incremental-window
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Interface for incremental accumulators that support add/remove operations
 */
export interface IncrementalAccumulator<T = number> {
  /** Add a value to the accumulator */
  add(value: T): void

  /** Remove a value from the accumulator (for sliding windows) */
  remove(value: T): void

  /** Get the current aggregated value */
  value(): T | null

  /** Reset the accumulator to initial state */
  reset(): void

  /** Get the count of values in the accumulator */
  count(): number

  /** Create a checkpoint for state recovery */
  checkpoint(): AccumulatorCheckpoint

  /** Restore from a checkpoint */
  restore(checkpoint: AccumulatorCheckpoint): void
}

/**
 * Checkpoint state for accumulator recovery
 */
export interface AccumulatorCheckpoint {
  type: string
  state: unknown
}

/**
 * Deque entry for MIN/MAX accumulators
 */
interface DequeEntry<T> {
  value: T
  index: number
}

// =============================================================================
// Incremental SUM Accumulator
// =============================================================================

/**
 * O(1) incremental SUM accumulator
 *
 * Maintains a running sum that can be updated by adding or removing values.
 * Uses compensated summation (Kahan) for improved numerical accuracy.
 */
export class IncrementalSum implements IncrementalAccumulator<number> {
  private sum = 0
  private compensation = 0 // Kahan summation compensation
  private _count = 0

  add(value: number): void {
    // Kahan summation for improved numerical stability
    const y = value - this.compensation
    const t = this.sum + y
    this.compensation = (t - this.sum) - y
    this.sum = t
    this._count++
  }

  remove(value: number): void {
    if (this._count === 0) return

    // Subtract with compensation
    const y = -value - this.compensation
    const t = this.sum + y
    this.compensation = (t - this.sum) - y
    this.sum = t
    this._count--

    // Reset to avoid floating point drift when empty
    if (this._count === 0) {
      this.sum = 0
      this.compensation = 0
    }
  }

  value(): number | null {
    return this._count === 0 ? null : this.sum
  }

  reset(): void {
    this.sum = 0
    this.compensation = 0
    this._count = 0
  }

  count(): number {
    return this._count
  }

  checkpoint(): AccumulatorCheckpoint {
    return {
      type: 'sum',
      state: { sum: this.sum, compensation: this.compensation, count: this._count },
    }
  }

  restore(checkpoint: AccumulatorCheckpoint): void {
    if (checkpoint.type !== 'sum') throw new Error(`Invalid checkpoint type: ${checkpoint.type}`)
    const state = checkpoint.state as { sum: number; compensation: number; count: number }
    this.sum = state.sum
    this.compensation = state.compensation
    this._count = state.count
  }
}

// =============================================================================
// Incremental COUNT Accumulator
// =============================================================================

/**
 * O(1) incremental COUNT accumulator
 *
 * Simple counter that increments on add and decrements on remove.
 */
export class IncrementalCount implements IncrementalAccumulator<number> {
  private _count = 0

  add(_value: number): void {
    this._count++
  }

  remove(_value: number): void {
    if (this._count > 0) this._count--
  }

  value(): number | null {
    return this._count === 0 ? null : this._count
  }

  reset(): void {
    this._count = 0
  }

  count(): number {
    return this._count
  }

  checkpoint(): AccumulatorCheckpoint {
    return { type: 'count', state: { count: this._count } }
  }

  restore(checkpoint: AccumulatorCheckpoint): void {
    if (checkpoint.type !== 'count') throw new Error(`Invalid checkpoint type: ${checkpoint.type}`)
    const state = checkpoint.state as { count: number }
    this._count = state.count
  }
}

// =============================================================================
// Incremental AVG Accumulator
// =============================================================================

/**
 * O(1) incremental AVG accumulator
 *
 * Tracks running sum and count, computes average on demand.
 * Uses Kahan summation for numerical stability.
 */
export class IncrementalAvg implements IncrementalAccumulator<number> {
  private sumAccumulator = new IncrementalSum()

  add(value: number): void {
    this.sumAccumulator.add(value)
  }

  remove(value: number): void {
    this.sumAccumulator.remove(value)
  }

  value(): number | null {
    const sum = this.sumAccumulator.value()
    const count = this.sumAccumulator.count()
    if (count === 0 || sum === null) return null
    return sum / count
  }

  reset(): void {
    this.sumAccumulator.reset()
  }

  count(): number {
    return this.sumAccumulator.count()
  }

  checkpoint(): AccumulatorCheckpoint {
    return {
      type: 'avg',
      state: this.sumAccumulator.checkpoint().state,
    }
  }

  restore(checkpoint: AccumulatorCheckpoint): void {
    if (checkpoint.type !== 'avg') throw new Error(`Invalid checkpoint type: ${checkpoint.type}`)
    this.sumAccumulator.restore({ type: 'sum', state: checkpoint.state })
  }
}

// =============================================================================
// Incremental MIN Accumulator (Monotonic Deque)
// =============================================================================

/**
 * O(1) amortized incremental MIN accumulator using monotonic deque
 *
 * Uses a double-ended queue that maintains values in increasing order.
 * Each element is processed at most twice (once added, once removed),
 * giving O(1) amortized time complexity.
 *
 * For sliding windows, we track element indices to handle removals correctly.
 */
export class IncrementalMin implements IncrementalAccumulator<number> {
  private deque: DequeEntry<number>[] = []
  private currentIndex = 0
  private windowStart = 0

  add(value: number): void {
    // Remove all entries from the back that are >= value
    while (this.deque.length > 0 && this.deque[this.deque.length - 1]!.value >= value) {
      this.deque.pop()
    }
    this.deque.push({ value, index: this.currentIndex++ })
  }

  remove(value: number): void {
    // Remove from front if it matches the value being removed
    if (this.deque.length > 0 && this.deque[0]!.index === this.windowStart) {
      this.deque.shift()
    }
    this.windowStart++
  }

  value(): number | null {
    return this.deque.length === 0 ? null : this.deque[0]!.value
  }

  reset(): void {
    this.deque = []
    this.currentIndex = 0
    this.windowStart = 0
  }

  count(): number {
    return this.currentIndex - this.windowStart
  }

  checkpoint(): AccumulatorCheckpoint {
    return {
      type: 'min',
      state: {
        deque: [...this.deque],
        currentIndex: this.currentIndex,
        windowStart: this.windowStart,
      },
    }
  }

  restore(checkpoint: AccumulatorCheckpoint): void {
    if (checkpoint.type !== 'min') throw new Error(`Invalid checkpoint type: ${checkpoint.type}`)
    const state = checkpoint.state as {
      deque: DequeEntry<number>[]
      currentIndex: number
      windowStart: number
    }
    this.deque = [...state.deque]
    this.currentIndex = state.currentIndex
    this.windowStart = state.windowStart
  }
}

// =============================================================================
// Incremental MAX Accumulator (Monotonic Deque)
// =============================================================================

/**
 * O(1) amortized incremental MAX accumulator using monotonic deque
 *
 * Uses a double-ended queue that maintains values in decreasing order.
 */
export class IncrementalMax implements IncrementalAccumulator<number> {
  private deque: DequeEntry<number>[] = []
  private currentIndex = 0
  private windowStart = 0

  add(value: number): void {
    // Remove all entries from the back that are <= value
    while (this.deque.length > 0 && this.deque[this.deque.length - 1]!.value <= value) {
      this.deque.pop()
    }
    this.deque.push({ value, index: this.currentIndex++ })
  }

  remove(value: number): void {
    // Remove from front if it matches the value being removed
    if (this.deque.length > 0 && this.deque[0]!.index === this.windowStart) {
      this.deque.shift()
    }
    this.windowStart++
  }

  value(): number | null {
    return this.deque.length === 0 ? null : this.deque[0]!.value
  }

  reset(): void {
    this.deque = []
    this.currentIndex = 0
    this.windowStart = 0
  }

  count(): number {
    return this.currentIndex - this.windowStart
  }

  checkpoint(): AccumulatorCheckpoint {
    return {
      type: 'max',
      state: {
        deque: [...this.deque],
        currentIndex: this.currentIndex,
        windowStart: this.windowStart,
      },
    }
  }

  restore(checkpoint: AccumulatorCheckpoint): void {
    if (checkpoint.type !== 'max') throw new Error(`Invalid checkpoint type: ${checkpoint.type}`)
    const state = checkpoint.state as {
      deque: DequeEntry<number>[]
      currentIndex: number
      windowStart: number
    }
    this.deque = [...state.deque]
    this.currentIndex = state.currentIndex
    this.windowStart = state.windowStart
  }
}

// =============================================================================
// Incremental STDDEV/VARIANCE Accumulator (Welford's Algorithm)
// =============================================================================

/**
 * O(1) incremental STDDEV accumulator using Welford's online algorithm
 *
 * Welford's algorithm computes variance in a single pass with numerical stability.
 * It can also support removals using the parallel variance combination formula.
 *
 * Reference: Welford, B. P. (1962). "Note on a Method for Calculating Corrected
 * Sums of Squares and Products"
 */
export class IncrementalStddev implements IncrementalAccumulator<number> {
  private _count = 0
  private mean = 0
  private m2 = 0 // Sum of squared differences from mean

  /**
   * Add a value using Welford's online update
   */
  add(value: number): void {
    this._count++
    const delta = value - this.mean
    this.mean += delta / this._count
    const delta2 = value - this.mean
    this.m2 += delta * delta2
  }

  /**
   * Remove a value using inverse Welford update
   *
   * This is the inverse operation that maintains numerical stability.
   */
  remove(value: number): void {
    if (this._count <= 1) {
      this.reset()
      return
    }

    const delta = value - this.mean
    const newCount = this._count - 1
    const newMean = (this.mean * this._count - value) / newCount

    // Update M2 using inverse formula
    const delta2 = value - newMean
    this.m2 -= delta * delta2

    this._count = newCount
    this.mean = newMean

    // Clamp M2 to avoid negative values due to floating point errors
    if (this.m2 < 0) this.m2 = 0
  }

  /**
   * Get standard deviation (population)
   */
  value(): number | null {
    if (this._count === 0) return null
    if (this._count === 1) return 0
    return Math.sqrt(this.m2 / this._count)
  }

  /**
   * Get sample standard deviation (n-1 denominator)
   */
  sampleStddev(): number | null {
    if (this._count < 2) return null
    return Math.sqrt(this.m2 / (this._count - 1))
  }

  /**
   * Get variance (population)
   */
  variance(): number | null {
    if (this._count === 0) return null
    if (this._count === 1) return 0
    return this.m2 / this._count
  }

  /**
   * Get sample variance (n-1 denominator)
   */
  sampleVariance(): number | null {
    if (this._count < 2) return null
    return this.m2 / (this._count - 1)
  }

  /**
   * Get the current mean
   */
  getMean(): number | null {
    return this._count === 0 ? null : this.mean
  }

  reset(): void {
    this._count = 0
    this.mean = 0
    this.m2 = 0
  }

  count(): number {
    return this._count
  }

  checkpoint(): AccumulatorCheckpoint {
    return {
      type: 'stddev',
      state: { count: this._count, mean: this.mean, m2: this.m2 },
    }
  }

  restore(checkpoint: AccumulatorCheckpoint): void {
    if (checkpoint.type !== 'stddev') throw new Error(`Invalid checkpoint type: ${checkpoint.type}`)
    const state = checkpoint.state as { count: number; mean: number; m2: number }
    this._count = state.count
    this.mean = state.mean
    this.m2 = state.m2
  }
}

// =============================================================================
// TypedArray Batch Operations (SIMD-style optimization)
// =============================================================================

/**
 * Batch accumulator for high-performance numeric operations using TypedArrays
 *
 * Uses Float64Array for optimal memory layout and potential SIMD optimization
 * by modern JavaScript engines.
 */
export class BatchNumericAccumulator {
  private buffer: Float64Array
  private size = 0
  private readonly capacity: number

  constructor(initialCapacity = 1024) {
    this.capacity = initialCapacity
    this.buffer = new Float64Array(initialCapacity)
  }

  /**
   * Add values from an array in batch
   */
  addBatch(values: number[]): void {
    const newSize = this.size + values.length
    this.ensureCapacity(newSize)

    for (let i = 0; i < values.length; i++) {
      this.buffer[this.size + i] = values[i]!
    }
    this.size = newSize
  }

  /**
   * Compute sum using vectorized-friendly loop
   */
  sum(): number {
    let sum = 0
    // Unrolled loop for better optimization
    const len = this.size
    let i = 0

    // Process 4 elements at a time
    for (; i + 3 < len; i += 4) {
      sum += this.buffer[i]! + this.buffer[i + 1]! + this.buffer[i + 2]! + this.buffer[i + 3]!
    }

    // Handle remaining elements
    for (; i < len; i++) {
      sum += this.buffer[i]!
    }

    return sum
  }

  /**
   * Compute average
   */
  avg(): number | null {
    if (this.size === 0) return null
    return this.sum() / this.size
  }

  /**
   * Find minimum using vectorized-friendly loop
   */
  min(): number | null {
    if (this.size === 0) return null

    let min = this.buffer[0]!
    for (let i = 1; i < this.size; i++) {
      const val = this.buffer[i]!
      if (val < min) min = val
    }
    return min
  }

  /**
   * Find maximum using vectorized-friendly loop
   */
  max(): number | null {
    if (this.size === 0) return null

    let max = this.buffer[0]!
    for (let i = 1; i < this.size; i++) {
      const val = this.buffer[i]!
      if (val > max) max = val
    }
    return max
  }

  /**
   * Compute variance using two-pass algorithm for accuracy
   */
  variance(): number | null {
    if (this.size === 0) return null
    if (this.size === 1) return 0

    const mean = this.sum() / this.size
    let sumSq = 0

    for (let i = 0; i < this.size; i++) {
      const diff = this.buffer[i]! - mean
      sumSq += diff * diff
    }

    return sumSq / this.size
  }

  /**
   * Compute standard deviation
   */
  stddev(): number | null {
    const v = this.variance()
    return v === null ? null : Math.sqrt(v)
  }

  /**
   * Get current size
   */
  count(): number {
    return this.size
  }

  /**
   * Clear the buffer
   */
  reset(): void {
    this.size = 0
  }

  /**
   * Get values as a regular array
   */
  toArray(): number[] {
    return Array.from(this.buffer.subarray(0, this.size))
  }

  private ensureCapacity(required: number): void {
    if (required <= this.buffer.length) return

    const newCapacity = Math.max(required, this.buffer.length * 2)
    const newBuffer = new Float64Array(newCapacity)
    newBuffer.set(this.buffer)
    this.buffer = newBuffer
  }
}

// =============================================================================
// Sliding Window Manager
// =============================================================================

/**
 * Configuration for sliding window
 */
export interface SlidingWindowConfig {
  windowSize: number
  slideSize?: number // Defaults to 1 for per-element sliding
}

/**
 * Sliding window with incremental aggregation
 *
 * Maintains a fixed-size window that slides as new elements arrive.
 * Uses the incremental accumulators for O(1) per-element operations.
 */
export class IncrementalSlidingWindow<T extends number = number> {
  private readonly windowSize: number
  private readonly slideSize: number
  private readonly buffer: T[] = []
  private windowStart = 0

  private readonly accumulators = new Map<string, IncrementalAccumulator<T>>()

  constructor(config: SlidingWindowConfig) {
    this.windowSize = config.windowSize
    this.slideSize = config.slideSize ?? 1
  }

  /**
   * Register an accumulator for a specific aggregation
   */
  registerAccumulator(name: string, accumulator: IncrementalAccumulator<T>): this {
    this.accumulators.set(name, accumulator)
    return this
  }

  /**
   * Add a new value to the window
   *
   * If the window is full, slides by removing the oldest values first.
   */
  add(value: T): void {
    this.buffer.push(value)

    // Add to all accumulators
    const accumulatorsList = Array.from(this.accumulators.values())
    for (const acc of accumulatorsList) {
      acc.add(value)
    }

    // Check if we need to slide the window
    if (this.buffer.length > this.windowSize) {
      this.slide()
    }
  }

  /**
   * Slide the window by removing oldest elements
   */
  private slide(): void {
    while (this.buffer.length > this.windowSize) {
      const removed = this.buffer.shift()!

      // Remove from all accumulators
      const accsList = Array.from(this.accumulators.values())
      for (const acc of accsList) {
        acc.remove(removed)
      }

      this.windowStart++
    }
  }

  /**
   * Get current aggregated value for a specific accumulator
   */
  getValue(name: string): T | null {
    const acc = this.accumulators.get(name)
    return acc ? acc.value() : null
  }

  /**
   * Get all current values
   */
  getValues(): Record<string, T | null> {
    const result: Record<string, T | null> = {}
    const entries = Array.from(this.accumulators.entries())
    for (const [name, acc] of entries) {
      result[name] = acc.value()
    }
    return result
  }

  /**
   * Get the current window contents
   */
  getWindow(): T[] {
    return [...this.buffer]
  }

  /**
   * Get window size
   */
  count(): number {
    return this.buffer.length
  }

  /**
   * Check if window is full
   */
  isFull(): boolean {
    return this.buffer.length >= this.windowSize
  }

  /**
   * Reset the window and all accumulators
   */
  reset(): void {
    this.buffer.length = 0
    this.windowStart = 0
    const accumulatorsList = Array.from(this.accumulators.values())
    for (const acc of accumulatorsList) {
      acc.reset()
    }
  }

  /**
   * Create checkpoint for recovery
   */
  checkpoint(): {
    buffer: T[]
    windowStart: number
    accumulators: Record<string, AccumulatorCheckpoint>
  } {
    const accCheckpoints: Record<string, AccumulatorCheckpoint> = {}
    const entries = Array.from(this.accumulators.entries())
    for (const [name, acc] of entries) {
      accCheckpoints[name] = acc.checkpoint()
    }
    return {
      buffer: [...this.buffer],
      windowStart: this.windowStart,
      accumulators: accCheckpoints,
    }
  }

  /**
   * Restore from checkpoint
   */
  restore(checkpoint: {
    buffer: T[]
    windowStart: number
    accumulators: Record<string, AccumulatorCheckpoint>
  }): void {
    this.buffer.length = 0
    this.buffer.push(...checkpoint.buffer)
    this.windowStart = checkpoint.windowStart

    for (const [name, accCheckpoint] of Object.entries(checkpoint.accumulators)) {
      const acc = this.accumulators.get(name)
      if (acc) {
        acc.restore(accCheckpoint)
      }
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an incremental accumulator by type name
 */
export function createIncrementalAccumulator(type: string): IncrementalAccumulator<number> {
  switch (type.toLowerCase()) {
    case 'sum':
    case '$sum':
      return new IncrementalSum()
    case 'count':
    case '$count':
      return new IncrementalCount()
    case 'avg':
    case '$avg':
    case 'average':
      return new IncrementalAvg()
    case 'min':
    case '$min':
      return new IncrementalMin()
    case 'max':
    case '$max':
      return new IncrementalMax()
    case 'stddev':
    case '$stddev':
    case 'stddevpop':
    case '$stddevpop':
      return new IncrementalStddev()
    default:
      throw new Error(`Unknown accumulator type: ${type}`)
  }
}

/**
 * Create a sliding window with common aggregations
 */
export function createSlidingWindow(
  windowSize: number,
  aggregations: string[] = ['sum', 'avg', 'min', 'max'],
): IncrementalSlidingWindow<number> {
  const window = new IncrementalSlidingWindow<number>({ windowSize })

  for (const agg of aggregations) {
    window.registerAccumulator(agg, createIncrementalAccumulator(agg))
  }

  return window
}

// =============================================================================
// Full Recalculation Functions (for comparison/fallback)
// =============================================================================

/**
 * Full recalculation versions for comparison and validation
 */
export const fullRecalc = {
  sum(values: number[]): number | null {
    if (values.length === 0) return null
    return values.reduce((a, b) => a + b, 0)
  },

  avg(values: number[]): number | null {
    if (values.length === 0) return null
    return values.reduce((a, b) => a + b, 0) / values.length
  },

  min(values: number[]): number | null {
    if (values.length === 0) return null
    return Math.min(...values)
  },

  max(values: number[]): number | null {
    if (values.length === 0) return null
    return Math.max(...values)
  },

  count(values: number[]): number {
    return values.length
  },

  variance(values: number[]): number | null {
    if (values.length === 0) return null
    if (values.length === 1) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const sumSq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0)
    return sumSq / values.length
  },

  stddev(values: number[]): number | null {
    const v = fullRecalc.variance(values)
    return v === null ? null : Math.sqrt(v)
  },
}

// =============================================================================
// Tumbling Window Manager
// =============================================================================

/**
 * Configuration for tumbling window
 */
export interface TumblingWindowConfig {
  /** Size of each window in milliseconds */
  windowSizeMs: number
  /** Optional function to extract timestamp from events */
  timestampExtractor?: (value: number) => number
}

/**
 * Tumbling Window with Incremental Aggregation
 *
 * Non-overlapping fixed-size windows that close when the window boundary is crossed.
 * Each element belongs to exactly one window.
 *
 * Time: |---W1---|---W2---|---W3---|
 *       ^       ^       ^
 *       0      10s     20s  (if windowSize = 10s)
 */
export class IncrementalTumblingWindow<T extends number = number> {
  private readonly windowSizeMs: number
  private readonly accumulators = new Map<string, IncrementalAccumulator<T>>()

  // Current window state
  private currentWindowStart: number | null = null
  private currentWindowEnd: number | null = null
  private readonly buffer: Array<{ value: T; timestamp: number }> = []

  // Completed windows history (for late data or lookback)
  private readonly completedWindows = new Map<
    number,
    {
      start: number
      end: number
      results: Record<string, T | null>
      count: number
    }
  >()
  private readonly maxCompletedWindows: number

  // Callback for window completion
  private onWindowComplete?: (window: {
    start: number
    end: number
    results: Record<string, T | null>
    count: number
  }) => void

  constructor(config: TumblingWindowConfig, maxCompletedWindows = 100) {
    this.windowSizeMs = config.windowSizeMs
    this.maxCompletedWindows = maxCompletedWindows
  }

  /**
   * Register an accumulator for a specific aggregation
   */
  registerAccumulator(name: string, accumulator: IncrementalAccumulator<T>): this {
    this.accumulators.set(name, accumulator)
    return this
  }

  /**
   * Set callback for when a window completes
   */
  onComplete(
    callback: (window: {
      start: number
      end: number
      results: Record<string, T | null>
      count: number
    }) => void
  ): this {
    this.onWindowComplete = callback
    return this
  }

  /**
   * Add a new value with timestamp
   *
   * Automatically handles window transitions when timestamp crosses window boundary.
   */
  add(value: T, timestamp: number): void {
    // Initialize first window
    if (this.currentWindowStart === null) {
      this.currentWindowStart = Math.floor(timestamp / this.windowSizeMs) * this.windowSizeMs
      this.currentWindowEnd = this.currentWindowStart + this.windowSizeMs
    }

    // Check if we need to close the current window
    if (timestamp >= this.currentWindowEnd!) {
      this.closeCurrentWindow()

      // Move to the new window containing this timestamp
      this.currentWindowStart = Math.floor(timestamp / this.windowSizeMs) * this.windowSizeMs
      this.currentWindowEnd = this.currentWindowStart + this.windowSizeMs

      // Reset all accumulators for new window
      for (const acc of this.accumulators.values()) {
        acc.reset()
      }
    }

    // Add to current window
    this.buffer.push({ value, timestamp })
    for (const acc of this.accumulators.values()) {
      acc.add(value)
    }
  }

  /**
   * Force close current window and emit results
   */
  closeCurrentWindow(): void {
    if (this.currentWindowStart === null) return

    const results = this.getValues()
    const completedWindow = {
      start: this.currentWindowStart,
      end: this.currentWindowEnd!,
      results,
      count: this.buffer.length,
    }

    // Store completed window
    this.completedWindows.set(this.currentWindowStart, completedWindow)

    // Trim old windows if exceeding max
    if (this.completedWindows.size > this.maxCompletedWindows) {
      const oldestKey = this.completedWindows.keys().next().value
      if (oldestKey !== undefined) {
        this.completedWindows.delete(oldestKey)
      }
    }

    // Emit callback
    if (this.onWindowComplete) {
      this.onWindowComplete(completedWindow)
    }

    // Clear buffer
    this.buffer.length = 0
  }

  /**
   * Advance time and close any windows that should be completed
   */
  advanceTime(timestamp: number): void {
    if (this.currentWindowEnd !== null && timestamp >= this.currentWindowEnd) {
      this.closeCurrentWindow()

      // Update to new window boundary
      this.currentWindowStart = Math.floor(timestamp / this.windowSizeMs) * this.windowSizeMs
      this.currentWindowEnd = this.currentWindowStart + this.windowSizeMs

      // Reset accumulators
      for (const acc of this.accumulators.values()) {
        acc.reset()
      }
    }
  }

  /**
   * Get current aggregated value for a specific accumulator
   */
  getValue(name: string): T | null {
    const acc = this.accumulators.get(name)
    return acc ? acc.value() : null
  }

  /**
   * Get all current values
   */
  getValues(): Record<string, T | null> {
    const result: Record<string, T | null> = {}
    for (const [name, acc] of this.accumulators.entries()) {
      result[name] = acc.value()
    }
    return result
  }

  /**
   * Get current window boundaries
   */
  getCurrentWindow(): { start: number; end: number } | null {
    if (this.currentWindowStart === null) return null
    return { start: this.currentWindowStart, end: this.currentWindowEnd! }
  }

  /**
   * Get count of elements in current window
   */
  count(): number {
    return this.buffer.length
  }

  /**
   * Get completed windows
   */
  getCompletedWindows(): Array<{
    start: number
    end: number
    results: Record<string, T | null>
    count: number
  }> {
    return Array.from(this.completedWindows.values())
  }

  /**
   * Get result for a specific completed window
   */
  getWindowResult(windowStart: number): {
    start: number
    end: number
    results: Record<string, T | null>
    count: number
  } | null {
    return this.completedWindows.get(windowStart) ?? null
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.currentWindowStart = null
    this.currentWindowEnd = null
    this.buffer.length = 0
    this.completedWindows.clear()
    for (const acc of this.accumulators.values()) {
      acc.reset()
    }
  }

  /**
   * Create checkpoint for recovery
   */
  checkpoint(): {
    windowStart: number | null
    windowEnd: number | null
    buffer: Array<{ value: T; timestamp: number }>
    completedWindows: Array<{
      start: number
      end: number
      results: Record<string, T | null>
      count: number
    }>
    accumulators: Record<string, AccumulatorCheckpoint>
  } {
    const accCheckpoints: Record<string, AccumulatorCheckpoint> = {}
    for (const [name, acc] of this.accumulators.entries()) {
      accCheckpoints[name] = acc.checkpoint()
    }
    return {
      windowStart: this.currentWindowStart,
      windowEnd: this.currentWindowEnd,
      buffer: [...this.buffer],
      completedWindows: Array.from(this.completedWindows.values()),
      accumulators: accCheckpoints,
    }
  }

  /**
   * Restore from checkpoint
   */
  restore(checkpoint: {
    windowStart: number | null
    windowEnd: number | null
    buffer: Array<{ value: T; timestamp: number }>
    completedWindows: Array<{
      start: number
      end: number
      results: Record<string, T | null>
      count: number
    }>
    accumulators: Record<string, AccumulatorCheckpoint>
  }): void {
    this.currentWindowStart = checkpoint.windowStart
    this.currentWindowEnd = checkpoint.windowEnd
    this.buffer.length = 0
    this.buffer.push(...checkpoint.buffer)
    this.completedWindows.clear()
    for (const w of checkpoint.completedWindows) {
      this.completedWindows.set(w.start, w)
    }
    for (const [name, accCheckpoint] of Object.entries(checkpoint.accumulators)) {
      const acc = this.accumulators.get(name)
      if (acc) {
        acc.restore(accCheckpoint)
      }
    }
  }
}

// =============================================================================
// Session Window Manager
// =============================================================================

/**
 * Configuration for session window
 */
export interface SessionWindowConfig {
  /** Gap timeout in milliseconds - sessions merge if events are within this gap */
  gapMs: number
  /** Maximum session duration (optional) */
  maxDurationMs?: number
}

/**
 * A session with its accumulated state
 */
interface Session<T> {
  start: number
  end: number
  values: T[]
  accumulators: Map<string, IncrementalAccumulator<T>>
}

/**
 * Session Window with Incremental Aggregation
 *
 * Gap-based windows that dynamically merge when events are close in time.
 * Sessions are extended when new events arrive within the gap timeout,
 * and closed when no events arrive for the gap duration.
 *
 * Time: |----Session 1----|    gap    |----Session 2----|
 *       E1    E2    E3              E4    E5
 *
 * If gap between E3 and E4 > gapMs, they're in different sessions.
 */
export class IncrementalSessionWindow<T extends number = number> {
  private readonly gapMs: number
  private readonly maxDurationMs: number | null
  private readonly accumulatorFactories = new Map<string, () => IncrementalAccumulator<T>>()

  // Active sessions keyed by their start time
  private sessions: Session<T>[] = []

  // Completed sessions
  private readonly completedSessions: Array<{
    start: number
    end: number
    results: Record<string, T | null>
    count: number
  }> = []
  private readonly maxCompletedSessions: number

  // Callback for session completion
  private onSessionComplete?: (session: {
    start: number
    end: number
    results: Record<string, T | null>
    count: number
  }) => void

  constructor(config: SessionWindowConfig, maxCompletedSessions = 100) {
    this.gapMs = config.gapMs
    this.maxDurationMs = config.maxDurationMs ?? null
    this.maxCompletedSessions = maxCompletedSessions
  }

  /**
   * Register an accumulator factory for a specific aggregation
   */
  registerAccumulator(name: string, factory: () => IncrementalAccumulator<T>): this {
    this.accumulatorFactories.set(name, factory)
    return this
  }

  /**
   * Set callback for when a session completes
   */
  onComplete(
    callback: (session: {
      start: number
      end: number
      results: Record<string, T | null>
      count: number
    }) => void
  ): this {
    this.onSessionComplete = callback
    return this
  }

  /**
   * Add a new value with timestamp
   *
   * This will either:
   * 1. Create a new session
   * 2. Extend an existing session
   * 3. Merge multiple sessions if the new event bridges them
   */
  add(value: T, timestamp: number): void {
    // Find all sessions that this event could belong to (within gap of start or end)
    const matchingSessions: number[] = []

    for (let i = 0; i < this.sessions.length; i++) {
      const session = this.sessions[i]!
      // Event is within gap of session end or start
      if (
        timestamp >= session.start - this.gapMs &&
        timestamp <= session.end + this.gapMs
      ) {
        matchingSessions.push(i)
      }
    }

    if (matchingSessions.length === 0) {
      // Create new session
      const newSession: Session<T> = {
        start: timestamp,
        end: timestamp,
        values: [value],
        accumulators: new Map(),
      }

      // Initialize accumulators
      for (const [name, factory] of this.accumulatorFactories.entries()) {
        const acc = factory()
        acc.add(value)
        newSession.accumulators.set(name, acc)
      }

      this.sessions.push(newSession)
    } else if (matchingSessions.length === 1) {
      // Extend existing session
      const session = this.sessions[matchingSessions[0]!]!
      session.start = Math.min(session.start, timestamp)
      session.end = Math.max(session.end, timestamp)
      session.values.push(value)

      // Update accumulators
      for (const acc of session.accumulators.values()) {
        acc.add(value)
      }

      // Check max duration
      if (this.maxDurationMs !== null && session.end - session.start >= this.maxDurationMs) {
        this.closeSession(matchingSessions[0]!)
      }
    } else {
      // Merge multiple sessions
      this.mergeSessions(matchingSessions, value, timestamp)
    }
  }

  /**
   * Merge multiple sessions into one
   */
  private mergeSessions(indices: number[], newValue: T, newTimestamp: number): void {
    // Sort indices in reverse order for safe removal
    indices.sort((a, b) => b - a)

    // Collect all values and find bounds
    const allValues: T[] = [newValue]
    let minStart = newTimestamp
    let maxEnd = newTimestamp
    const mergedAccumulators = new Map<string, IncrementalAccumulator<T>>()

    // Initialize merged accumulators
    for (const [name, factory] of this.accumulatorFactories.entries()) {
      const acc = factory()
      acc.add(newValue)
      mergedAccumulators.set(name, acc)
    }

    for (const idx of indices) {
      const session = this.sessions[idx]!
      allValues.push(...session.values)
      minStart = Math.min(minStart, session.start)
      maxEnd = Math.max(maxEnd, session.end)

      // Merge accumulator values
      for (const v of session.values) {
        for (const acc of mergedAccumulators.values()) {
          acc.add(v)
        }
      }

      // Remove old session
      this.sessions.splice(idx, 1)
    }

    // Create merged session
    const mergedSession: Session<T> = {
      start: minStart,
      end: maxEnd,
      values: allValues,
      accumulators: mergedAccumulators,
    }

    this.sessions.push(mergedSession)

    // Check max duration
    if (this.maxDurationMs !== null && mergedSession.end - mergedSession.start >= this.maxDurationMs) {
      this.closeSession(this.sessions.length - 1)
    }
  }

  /**
   * Close a specific session
   */
  private closeSession(index: number): void {
    const session = this.sessions[index]!
    const results: Record<string, T | null> = {}

    for (const [name, acc] of session.accumulators.entries()) {
      results[name] = acc.value()
    }

    const completedSession = {
      start: session.start,
      end: session.end,
      results,
      count: session.values.length,
    }

    this.completedSessions.push(completedSession)

    // Trim old sessions if exceeding max
    while (this.completedSessions.length > this.maxCompletedSessions) {
      this.completedSessions.shift()
    }

    // Emit callback
    if (this.onSessionComplete) {
      this.onSessionComplete(completedSession)
    }

    // Remove from active sessions
    this.sessions.splice(index, 1)
  }

  /**
   * Advance time and close sessions that have timed out
   */
  advanceTime(timestamp: number): void {
    // Find sessions that have timed out (no activity within gap)
    const timedOutIndices: number[] = []

    for (let i = 0; i < this.sessions.length; i++) {
      const session = this.sessions[i]!
      if (timestamp - session.end > this.gapMs) {
        timedOutIndices.push(i)
      }
    }

    // Close timed out sessions (in reverse order)
    timedOutIndices.sort((a, b) => b - a)
    for (const idx of timedOutIndices) {
      this.closeSession(idx)
    }
  }

  /**
   * Force close all active sessions
   */
  closeAllSessions(): void {
    while (this.sessions.length > 0) {
      this.closeSession(0)
    }
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.sessions.length
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): Array<{
    start: number
    end: number
    count: number
    values: Record<string, T | null>
  }> {
    return this.sessions.map((session) => {
      const values: Record<string, T | null> = {}
      for (const [name, acc] of session.accumulators.entries()) {
        values[name] = acc.value()
      }
      return {
        start: session.start,
        end: session.end,
        count: session.values.length,
        values,
      }
    })
  }

  /**
   * Get completed sessions
   */
  getCompletedSessions(): Array<{
    start: number
    end: number
    results: Record<string, T | null>
    count: number
  }> {
    return [...this.completedSessions]
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.sessions = []
    this.completedSessions.length = 0
  }

  /**
   * Create checkpoint for recovery
   */
  checkpoint(): {
    sessions: Array<{
      start: number
      end: number
      values: T[]
      accumulators: Record<string, AccumulatorCheckpoint>
    }>
    completedSessions: Array<{
      start: number
      end: number
      results: Record<string, T | null>
      count: number
    }>
  } {
    return {
      sessions: this.sessions.map((s) => {
        const accCheckpoints: Record<string, AccumulatorCheckpoint> = {}
        for (const [name, acc] of s.accumulators.entries()) {
          accCheckpoints[name] = acc.checkpoint()
        }
        return {
          start: s.start,
          end: s.end,
          values: [...s.values],
          accumulators: accCheckpoints,
        }
      }),
      completedSessions: [...this.completedSessions],
    }
  }

  /**
   * Restore from checkpoint
   */
  restore(checkpoint: {
    sessions: Array<{
      start: number
      end: number
      values: T[]
      accumulators: Record<string, AccumulatorCheckpoint>
    }>
    completedSessions: Array<{
      start: number
      end: number
      results: Record<string, T | null>
      count: number
    }>
  }): void {
    this.sessions = checkpoint.sessions.map((s) => {
      const accumulators = new Map<string, IncrementalAccumulator<T>>()
      for (const [name, accCheckpoint] of Object.entries(s.accumulators)) {
        const factory = this.accumulatorFactories.get(name)
        if (factory) {
          const acc = factory()
          acc.restore(accCheckpoint)
          accumulators.set(name, acc)
        }
      }
      return {
        start: s.start,
        end: s.end,
        values: [...s.values],
        accumulators,
      }
    })
    this.completedSessions.length = 0
    this.completedSessions.push(...checkpoint.completedSessions)
  }
}

// =============================================================================
// Incremental Update Types (for Stream Processing Integration)
// =============================================================================

/**
 * Result of an incremental window update
 */
export interface IncrementalWindowUpdate<T = number> {
  /** Type of update */
  type: 'add' | 'remove' | 'window_close' | 'window_merge'
  /** Window boundaries */
  window: { start: number; end: number }
  /** Current aggregated values */
  values: Record<string, T | null>
  /** Delta from previous state (if available) */
  delta?: Record<string, T | null>
  /** Number of elements in window */
  count: number
  /** Timestamp of the update */
  timestamp: number
}

/**
 * Stream processor that emits incremental updates
 */
export interface IncrementalWindowStream<T = number> {
  /** Process a value and emit update */
  process(value: T, timestamp: number): IncrementalWindowUpdate<T>
  /** Advance watermark and emit any window closures */
  advanceWatermark(timestamp: number): IncrementalWindowUpdate<T>[]
  /** Subscribe to updates */
  subscribe(callback: (update: IncrementalWindowUpdate<T>) => void): () => void
}

/**
 * Create an incremental sliding window stream processor
 */
export class IncrementalSlidingWindowStream implements IncrementalWindowStream<number> {
  private readonly window: IncrementalSlidingWindow<number>
  private readonly subscribers: Set<(update: IncrementalWindowUpdate<number>) => void> = new Set()
  private lastValues: Record<string, number | null> = {}

  constructor(windowSize: number, aggregations: string[] = ['sum', 'avg', 'min', 'max']) {
    this.window = createSlidingWindow(windowSize, aggregations)
  }

  process(value: number, timestamp: number): IncrementalWindowUpdate<number> {
    const wasFull = this.window.isFull()
    this.window.add(value)

    const newValues = this.window.getValues()
    const delta: Record<string, number | null> = {}

    // Calculate delta
    for (const [key, newVal] of Object.entries(newValues)) {
      const oldVal = this.lastValues[key]
      if (newVal !== null && oldVal !== null) {
        delta[key] = newVal - oldVal
      } else {
        delta[key] = newVal
      }
    }

    this.lastValues = { ...newValues }

    const update: IncrementalWindowUpdate<number> = {
      type: 'add',
      window: { start: timestamp - this.window.count(), end: timestamp },
      values: newValues,
      delta,
      count: this.window.count(),
      timestamp,
    }

    // Notify subscribers
    for (const callback of this.subscribers) {
      callback(update)
    }

    return update
  }

  advanceWatermark(_timestamp: number): IncrementalWindowUpdate<number>[] {
    // Sliding windows don't close based on watermark in this implementation
    return []
  }

  subscribe(callback: (update: IncrementalWindowUpdate<number>) => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }
}

/**
 * Create an incremental tumbling window stream processor
 */
export class IncrementalTumblingWindowStream implements IncrementalWindowStream<number> {
  private readonly window: IncrementalTumblingWindow<number>
  private readonly aggregations: string[]
  private readonly subscribers: Set<(update: IncrementalWindowUpdate<number>) => void> = new Set()
  private lastValues: Record<string, number | null> = {}
  private pendingCloses: IncrementalWindowUpdate<number>[] = []

  constructor(windowSizeMs: number, aggregations: string[] = ['sum', 'avg', 'min', 'max']) {
    this.window = new IncrementalTumblingWindow({ windowSizeMs })
    this.aggregations = aggregations

    for (const agg of aggregations) {
      this.window.registerAccumulator(agg, createIncrementalAccumulator(agg))
    }

    // Capture window closes
    this.window.onComplete((completed) => {
      const closeUpdate: IncrementalWindowUpdate<number> = {
        type: 'window_close',
        window: { start: completed.start, end: completed.end },
        values: completed.results,
        count: completed.count,
        timestamp: completed.end,
      }
      this.pendingCloses.push(closeUpdate)

      // Notify subscribers
      for (const callback of this.subscribers) {
        callback(closeUpdate)
      }
    })
  }

  process(value: number, timestamp: number): IncrementalWindowUpdate<number> {
    // Clear pending closes from previous calls
    this.pendingCloses = []

    this.window.add(value, timestamp)

    const newValues = this.window.getValues()
    const currentWindow = this.window.getCurrentWindow()
    const delta: Record<string, number | null> = {}

    // Calculate delta
    for (const [key, newVal] of Object.entries(newValues)) {
      const oldVal = this.lastValues[key]
      if (newVal !== null && oldVal !== null) {
        delta[key] = newVal - oldVal
      } else {
        delta[key] = newVal
      }
    }

    this.lastValues = { ...newValues }

    const update: IncrementalWindowUpdate<number> = {
      type: 'add',
      window: currentWindow ?? { start: timestamp, end: timestamp },
      values: newValues,
      delta,
      count: this.window.count(),
      timestamp,
    }

    // Notify subscribers
    for (const callback of this.subscribers) {
      callback(update)
    }

    return update
  }

  advanceWatermark(timestamp: number): IncrementalWindowUpdate<number>[] {
    this.pendingCloses = []
    this.window.advanceTime(timestamp)
    return this.pendingCloses
  }

  subscribe(callback: (update: IncrementalWindowUpdate<number>) => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }
}

/**
 * Create an incremental session window stream processor
 */
export class IncrementalSessionWindowStream implements IncrementalWindowStream<number> {
  private readonly sessionWindow: IncrementalSessionWindow<number>
  private readonly aggregations: string[]
  private readonly subscribers: Set<(update: IncrementalWindowUpdate<number>) => void> = new Set()
  private pendingCloses: IncrementalWindowUpdate<number>[] = []

  constructor(gapMs: number, aggregations: string[] = ['sum', 'avg', 'min', 'max'], maxDurationMs?: number) {
    this.sessionWindow = new IncrementalSessionWindow({ gapMs, maxDurationMs })
    this.aggregations = aggregations

    for (const agg of aggregations) {
      this.sessionWindow.registerAccumulator(agg, () => createIncrementalAccumulator(agg))
    }

    // Capture session closes
    this.sessionWindow.onComplete((completed) => {
      const closeUpdate: IncrementalWindowUpdate<number> = {
        type: 'window_close',
        window: { start: completed.start, end: completed.end },
        values: completed.results,
        count: completed.count,
        timestamp: completed.end,
      }
      this.pendingCloses.push(closeUpdate)

      // Notify subscribers
      for (const callback of this.subscribers) {
        callback(closeUpdate)
      }
    })
  }

  process(value: number, timestamp: number): IncrementalWindowUpdate<number> {
    this.pendingCloses = []

    const sessionsBefore = this.sessionWindow.getActiveSessionCount()
    this.sessionWindow.add(value, timestamp)
    const sessionsAfter = this.sessionWindow.getActiveSessionCount()

    const activeSessions = this.sessionWindow.getActiveSessions()
    const currentSession = activeSessions[activeSessions.length - 1]

    // Determine update type
    const type: 'add' | 'window_merge' =
      sessionsBefore > 1 && sessionsAfter < sessionsBefore ? 'window_merge' : 'add'

    const update: IncrementalWindowUpdate<number> = {
      type,
      window: currentSession
        ? { start: currentSession.start, end: currentSession.end }
        : { start: timestamp, end: timestamp },
      values: currentSession?.values ?? {},
      count: currentSession?.count ?? 1,
      timestamp,
    }

    // Notify subscribers
    for (const callback of this.subscribers) {
      callback(update)
    }

    return update
  }

  advanceWatermark(timestamp: number): IncrementalWindowUpdate<number>[] {
    this.pendingCloses = []
    this.sessionWindow.advanceTime(timestamp)
    return this.pendingCloses
  }

  subscribe(callback: (update: IncrementalWindowUpdate<number>) => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }
}

// =============================================================================
// Factory Functions for Window Types
// =============================================================================

/**
 * Create a tumbling window with common aggregations
 */
export function createTumblingWindow(
  windowSizeMs: number,
  aggregations: string[] = ['sum', 'avg', 'min', 'max']
): IncrementalTumblingWindow<number> {
  const window = new IncrementalTumblingWindow<number>({ windowSizeMs })

  for (const agg of aggregations) {
    window.registerAccumulator(agg, createIncrementalAccumulator(agg))
  }

  return window
}

/**
 * Create a session window with common aggregations
 */
export function createSessionWindow(
  gapMs: number,
  aggregations: string[] = ['sum', 'avg', 'min', 'max'],
  maxDurationMs?: number
): IncrementalSessionWindow<number> {
  const window = new IncrementalSessionWindow<number>({ gapMs, maxDurationMs })

  for (const agg of aggregations) {
    window.registerAccumulator(agg, () => createIncrementalAccumulator(agg))
  }

  return window
}

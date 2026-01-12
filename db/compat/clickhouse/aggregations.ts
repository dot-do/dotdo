/**
 * ClickHouse OLAP Aggregations
 *
 * Advanced aggregate functions compatible with ClickHouse's analytics capabilities.
 * Uses streaming aggregation pipeline primitives for efficient computation.
 *
 * Supported functions:
 * - Basic: count, sum, avg, min, max
 * - Distinct: uniq, uniqExact, uniqHLL12
 * - Statistical: quantile, quantiles, median, stddev, variance
 * - Ordering: argMin, argMax, first_value, last_value
 * - Array: groupArray, groupUniqArray, topK, topKWeighted
 * - Conditional: sumIf, countIf, avgIf
 * - Approximate: anyHeavy, anyLast
 *
 * @see dotdo-b80fl - Unified Analytics Compat Layer Epic
 */

// ============================================================================
// Types
// ============================================================================

/**
 * State for streaming aggregation
 */
export interface AggregatorState<T = unknown> {
  /** Aggregator type identifier */
  type: string
  /** Accumulated state */
  state: T
  /** Number of values processed */
  count: number
}

/**
 * Base aggregator interface
 */
export interface Aggregator<TInput = unknown, TOutput = unknown, TState = unknown> {
  /** Create initial state */
  init(): AggregatorState<TState>
  /** Add a value to the state */
  add(state: AggregatorState<TState>, value: TInput): void
  /** Merge two states (for parallel aggregation) */
  merge(state1: AggregatorState<TState>, state2: AggregatorState<TState>): AggregatorState<TState>
  /** Extract final result */
  finalize(state: AggregatorState<TState>): TOutput
}

// ============================================================================
// Basic Aggregators
// ============================================================================

/**
 * Count aggregator
 */
export class CountAggregator implements Aggregator<unknown, number, number> {
  init(): AggregatorState<number> {
    return { type: 'count', state: 0, count: 0 }
  }

  add(state: AggregatorState<number>, _value: unknown): void {
    state.state++
    state.count++
  }

  merge(state1: AggregatorState<number>, state2: AggregatorState<number>): AggregatorState<number> {
    return {
      type: 'count',
      state: state1.state + state2.state,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<number>): number {
    return state.state
  }
}

/**
 * Sum aggregator
 */
export class SumAggregator implements Aggregator<number, number, number> {
  init(): AggregatorState<number> {
    return { type: 'sum', state: 0, count: 0 }
  }

  add(state: AggregatorState<number>, value: number): void {
    if (typeof value === 'number' && !isNaN(value)) {
      state.state += value
      state.count++
    }
  }

  merge(state1: AggregatorState<number>, state2: AggregatorState<number>): AggregatorState<number> {
    return {
      type: 'sum',
      state: state1.state + state2.state,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<number>): number {
    return state.state
  }
}

/**
 * Average aggregator
 */
export class AvgAggregator implements Aggregator<number, number | null, { sum: number; count: number }> {
  init(): AggregatorState<{ sum: number; count: number }> {
    return { type: 'avg', state: { sum: 0, count: 0 }, count: 0 }
  }

  add(state: AggregatorState<{ sum: number; count: number }>, value: number): void {
    if (typeof value === 'number' && !isNaN(value)) {
      state.state.sum += value
      state.state.count++
      state.count++
    }
  }

  merge(
    state1: AggregatorState<{ sum: number; count: number }>,
    state2: AggregatorState<{ sum: number; count: number }>
  ): AggregatorState<{ sum: number; count: number }> {
    return {
      type: 'avg',
      state: {
        sum: state1.state.sum + state2.state.sum,
        count: state1.state.count + state2.state.count,
      },
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<{ sum: number; count: number }>): number | null {
    if (state.state.count === 0) return null
    return state.state.sum / state.state.count
  }
}

/**
 * Min aggregator
 */
export class MinAggregator implements Aggregator<number, number | null, number | null> {
  init(): AggregatorState<number | null> {
    return { type: 'min', state: null, count: 0 }
  }

  add(state: AggregatorState<number | null>, value: number): void {
    if (typeof value === 'number' && !isNaN(value)) {
      if (state.state === null || value < state.state) {
        state.state = value
      }
      state.count++
    }
  }

  merge(
    state1: AggregatorState<number | null>,
    state2: AggregatorState<number | null>
  ): AggregatorState<number | null> {
    if (state1.state === null) return state2
    if (state2.state === null) return state1
    return {
      type: 'min',
      state: Math.min(state1.state, state2.state),
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<number | null>): number | null {
    return state.state
  }
}

/**
 * Max aggregator
 */
export class MaxAggregator implements Aggregator<number, number | null, number | null> {
  init(): AggregatorState<number | null> {
    return { type: 'max', state: null, count: 0 }
  }

  add(state: AggregatorState<number | null>, value: number): void {
    if (typeof value === 'number' && !isNaN(value)) {
      if (state.state === null || value > state.state) {
        state.state = value
      }
      state.count++
    }
  }

  merge(
    state1: AggregatorState<number | null>,
    state2: AggregatorState<number | null>
  ): AggregatorState<number | null> {
    if (state1.state === null) return state2
    if (state2.state === null) return state1
    return {
      type: 'max',
      state: Math.max(state1.state, state2.state),
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<number | null>): number | null {
    return state.state
  }
}

// ============================================================================
// Distinct Count Aggregators
// ============================================================================

/**
 * Exact unique count using Set
 */
export class UniqExactAggregator implements Aggregator<unknown, number, Set<string>> {
  init(): AggregatorState<Set<string>> {
    return { type: 'uniqExact', state: new Set(), count: 0 }
  }

  add(state: AggregatorState<Set<string>>, value: unknown): void {
    if (value !== null && value !== undefined) {
      state.state.add(JSON.stringify(value))
      state.count++
    }
  }

  merge(
    state1: AggregatorState<Set<string>>,
    state2: AggregatorState<Set<string>>
  ): AggregatorState<Set<string>> {
    const merged = new Set([...state1.state, ...state2.state])
    return {
      type: 'uniqExact',
      state: merged,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<Set<string>>): number {
    return state.state.size
  }
}

/**
 * HyperLogLog for approximate unique count
 */
export class UniqHLLAggregator implements Aggregator<unknown, number, HyperLogLogState> {
  private precision: number

  constructor(precision = 14) {
    this.precision = precision
  }

  init(): AggregatorState<HyperLogLogState> {
    const numRegisters = 1 << this.precision
    return {
      type: 'uniqHLL',
      state: {
        registers: new Uint8Array(numRegisters),
        precision: this.precision,
      },
      count: 0,
    }
  }

  add(state: AggregatorState<HyperLogLogState>, value: unknown): void {
    if (value === null || value === undefined) return

    const hash = this.hash(value)
    const registerIdx = hash >>> (32 - state.state.precision)
    const remainingBits = (hash << state.state.precision) >>> 0
    const leadingZeros = this.countLeadingZeros(remainingBits, 32 - state.state.precision) + 1

    if (leadingZeros > state.state.registers[registerIdx]) {
      state.state.registers[registerIdx] = leadingZeros
    }
    state.count++
  }

  merge(
    state1: AggregatorState<HyperLogLogState>,
    state2: AggregatorState<HyperLogLogState>
  ): AggregatorState<HyperLogLogState> {
    const merged = new Uint8Array(state1.state.registers.length)
    for (let i = 0; i < merged.length; i++) {
      merged[i] = Math.max(state1.state.registers[i], state2.state.registers[i])
    }
    return {
      type: 'uniqHLL',
      state: { registers: merged, precision: state1.state.precision },
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<HyperLogLogState>): number {
    const numRegisters = state.state.registers.length
    const alpha = this.getAlpha(numRegisters)

    let sum = 0
    for (let i = 0; i < numRegisters; i++) {
      sum += Math.pow(2, -state.state.registers[i])
    }

    let estimate = (alpha * numRegisters * numRegisters) / sum

    // Small range correction
    if (estimate <= 2.5 * numRegisters) {
      let zeroCount = 0
      for (let i = 0; i < numRegisters; i++) {
        if (state.state.registers[i] === 0) zeroCount++
      }
      if (zeroCount > 0) {
        estimate = numRegisters * Math.log(numRegisters / zeroCount)
      }
    }

    return Math.round(estimate)
  }

  private hash(value: unknown): number {
    const str = JSON.stringify(value)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return hash >>> 0
  }

  private countLeadingZeros(value: number, maxBits: number): number {
    if (value === 0) return maxBits
    let count = 0
    let mask = 1 << (maxBits - 1)
    while ((value & mask) === 0 && count < maxBits) {
      count++
      mask >>>= 1
    }
    return count
  }

  private getAlpha(numRegisters: number): number {
    if (numRegisters === 16) return 0.673
    if (numRegisters === 32) return 0.697
    if (numRegisters === 64) return 0.709
    return 0.7213 / (1 + 1.079 / numRegisters)
  }
}

interface HyperLogLogState {
  registers: Uint8Array
  precision: number
}

// ============================================================================
// Statistical Aggregators
// ============================================================================

/**
 * Quantile aggregator using t-digest approximation
 */
export class QuantileAggregator implements Aggregator<number, number | null, TDigestState> {
  private level: number

  constructor(level = 0.5) {
    this.level = level
  }

  init(): AggregatorState<TDigestState> {
    return {
      type: 'quantile',
      state: { centroids: [], totalWeight: 0 },
      count: 0,
    }
  }

  add(state: AggregatorState<TDigestState>, value: number): void {
    if (typeof value !== 'number' || isNaN(value)) return

    // Simple implementation: just collect values
    // In production, would use proper t-digest algorithm
    state.state.centroids.push({ mean: value, weight: 1 })
    state.state.totalWeight++
    state.count++
  }

  merge(
    state1: AggregatorState<TDigestState>,
    state2: AggregatorState<TDigestState>
  ): AggregatorState<TDigestState> {
    return {
      type: 'quantile',
      state: {
        centroids: [...state1.state.centroids, ...state2.state.centroids],
        totalWeight: state1.state.totalWeight + state2.state.totalWeight,
      },
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<TDigestState>): number | null {
    if (state.state.centroids.length === 0) return null

    // Sort centroids by mean
    const sorted = state.state.centroids
      .map(c => c.mean)
      .sort((a, b) => a - b)

    const idx = Math.floor(this.level * (sorted.length - 1))
    return sorted[idx]
  }
}

interface TDigestState {
  centroids: { mean: number; weight: number }[]
  totalWeight: number
}

/**
 * Multiple quantiles aggregator
 */
export class QuantilesAggregator implements Aggregator<number, (number | null)[], number[]> {
  private levels: number[]

  constructor(levels: number[] = [0.25, 0.5, 0.75]) {
    this.levels = levels
  }

  init(): AggregatorState<number[]> {
    return { type: 'quantiles', state: [], count: 0 }
  }

  add(state: AggregatorState<number[]>, value: number): void {
    if (typeof value === 'number' && !isNaN(value)) {
      state.state.push(value)
      state.count++
    }
  }

  merge(
    state1: AggregatorState<number[]>,
    state2: AggregatorState<number[]>
  ): AggregatorState<number[]> {
    return {
      type: 'quantiles',
      state: [...state1.state, ...state2.state],
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<number[]>): (number | null)[] {
    if (state.state.length === 0) {
      return this.levels.map(() => null)
    }

    const sorted = [...state.state].sort((a, b) => a - b)
    return this.levels.map(level => {
      const idx = Math.floor(level * (sorted.length - 1))
      return sorted[idx]
    })
  }
}

/**
 * Standard deviation aggregator (population)
 */
export class StddevPopAggregator implements Aggregator<number, number | null, { sum: number; sumSq: number; count: number }> {
  init(): AggregatorState<{ sum: number; sumSq: number; count: number }> {
    return { type: 'stddevPop', state: { sum: 0, sumSq: 0, count: 0 }, count: 0 }
  }

  add(state: AggregatorState<{ sum: number; sumSq: number; count: number }>, value: number): void {
    if (typeof value === 'number' && !isNaN(value)) {
      state.state.sum += value
      state.state.sumSq += value * value
      state.state.count++
      state.count++
    }
  }

  merge(
    state1: AggregatorState<{ sum: number; sumSq: number; count: number }>,
    state2: AggregatorState<{ sum: number; sumSq: number; count: number }>
  ): AggregatorState<{ sum: number; sumSq: number; count: number }> {
    return {
      type: 'stddevPop',
      state: {
        sum: state1.state.sum + state2.state.sum,
        sumSq: state1.state.sumSq + state2.state.sumSq,
        count: state1.state.count + state2.state.count,
      },
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<{ sum: number; sumSq: number; count: number }>): number | null {
    if (state.state.count === 0) return null
    const mean = state.state.sum / state.state.count
    const variance = (state.state.sumSq / state.state.count) - (mean * mean)
    return Math.sqrt(variance)
  }
}

/**
 * Variance aggregator (population)
 */
export class VarPopAggregator implements Aggregator<number, number | null, { sum: number; sumSq: number; count: number }> {
  init(): AggregatorState<{ sum: number; sumSq: number; count: number }> {
    return { type: 'varPop', state: { sum: 0, sumSq: 0, count: 0 }, count: 0 }
  }

  add(state: AggregatorState<{ sum: number; sumSq: number; count: number }>, value: number): void {
    if (typeof value === 'number' && !isNaN(value)) {
      state.state.sum += value
      state.state.sumSq += value * value
      state.state.count++
      state.count++
    }
  }

  merge(
    state1: AggregatorState<{ sum: number; sumSq: number; count: number }>,
    state2: AggregatorState<{ sum: number; sumSq: number; count: number }>
  ): AggregatorState<{ sum: number; sumSq: number; count: number }> {
    return {
      type: 'varPop',
      state: {
        sum: state1.state.sum + state2.state.sum,
        sumSq: state1.state.sumSq + state2.state.sumSq,
        count: state1.state.count + state2.state.count,
      },
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<{ sum: number; sumSq: number; count: number }>): number | null {
    if (state.state.count === 0) return null
    const mean = state.state.sum / state.state.count
    return (state.state.sumSq / state.state.count) - (mean * mean)
  }
}

// ============================================================================
// Ordering Aggregators
// ============================================================================

/**
 * ArgMin - returns value of `column` for row with minimum `by`
 */
export class ArgMinAggregator<T> implements Aggregator<{ value: T; by: number }, T | null, { minBy: number | null; value: T | null }> {
  init(): AggregatorState<{ minBy: number | null; value: T | null }> {
    return { type: 'argMin', state: { minBy: null, value: null }, count: 0 }
  }

  add(state: AggregatorState<{ minBy: number | null; value: T | null }>, input: { value: T; by: number }): void {
    if (typeof input.by === 'number' && !isNaN(input.by)) {
      if (state.state.minBy === null || input.by < state.state.minBy) {
        state.state.minBy = input.by
        state.state.value = input.value
      }
      state.count++
    }
  }

  merge(
    state1: AggregatorState<{ minBy: number | null; value: T | null }>,
    state2: AggregatorState<{ minBy: number | null; value: T | null }>
  ): AggregatorState<{ minBy: number | null; value: T | null }> {
    if (state1.state.minBy === null) return state2
    if (state2.state.minBy === null) return state1
    if (state1.state.minBy <= state2.state.minBy) return state1
    return state2
  }

  finalize(state: AggregatorState<{ minBy: number | null; value: T | null }>): T | null {
    return state.state.value
  }
}

/**
 * ArgMax - returns value of `column` for row with maximum `by`
 */
export class ArgMaxAggregator<T> implements Aggregator<{ value: T; by: number }, T | null, { maxBy: number | null; value: T | null }> {
  init(): AggregatorState<{ maxBy: number | null; value: T | null }> {
    return { type: 'argMax', state: { maxBy: null, value: null }, count: 0 }
  }

  add(state: AggregatorState<{ maxBy: number | null; value: T | null }>, input: { value: T; by: number }): void {
    if (typeof input.by === 'number' && !isNaN(input.by)) {
      if (state.state.maxBy === null || input.by > state.state.maxBy) {
        state.state.maxBy = input.by
        state.state.value = input.value
      }
      state.count++
    }
  }

  merge(
    state1: AggregatorState<{ maxBy: number | null; value: T | null }>,
    state2: AggregatorState<{ maxBy: number | null; value: T | null }>
  ): AggregatorState<{ maxBy: number | null; value: T | null }> {
    if (state1.state.maxBy === null) return state2
    if (state2.state.maxBy === null) return state1
    if (state1.state.maxBy >= state2.state.maxBy) return state1
    return state2
  }

  finalize(state: AggregatorState<{ maxBy: number | null; value: T | null }>): T | null {
    return state.state.value
  }
}

/**
 * First value aggregator
 */
export class FirstValueAggregator<T> implements Aggregator<T, T | null, T | null> {
  init(): AggregatorState<T | null> {
    return { type: 'first', state: null, count: 0 }
  }

  add(state: AggregatorState<T | null>, value: T): void {
    if (state.state === null && value !== null && value !== undefined) {
      state.state = value
    }
    state.count++
  }

  merge(
    state1: AggregatorState<T | null>,
    state2: AggregatorState<T | null>
  ): AggregatorState<T | null> {
    return state1.state !== null ? state1 : state2
  }

  finalize(state: AggregatorState<T | null>): T | null {
    return state.state
  }
}

/**
 * Last value aggregator
 */
export class LastValueAggregator<T> implements Aggregator<T, T | null, T | null> {
  init(): AggregatorState<T | null> {
    return { type: 'last', state: null, count: 0 }
  }

  add(state: AggregatorState<T | null>, value: T): void {
    if (value !== null && value !== undefined) {
      state.state = value
    }
    state.count++
  }

  merge(
    state1: AggregatorState<T | null>,
    state2: AggregatorState<T | null>
  ): AggregatorState<T | null> {
    return state2.state !== null ? state2 : state1
  }

  finalize(state: AggregatorState<T | null>): T | null {
    return state.state
  }
}

// ============================================================================
// Array Aggregators
// ============================================================================

/**
 * Collect all values into array
 */
export class GroupArrayAggregator<T> implements Aggregator<T, T[], T[]> {
  private maxSize?: number

  constructor(maxSize?: number) {
    this.maxSize = maxSize
  }

  init(): AggregatorState<T[]> {
    return { type: 'groupArray', state: [], count: 0 }
  }

  add(state: AggregatorState<T[]>, value: T): void {
    if (value !== null && value !== undefined) {
      if (this.maxSize === undefined || state.state.length < this.maxSize) {
        state.state.push(value)
      }
    }
    state.count++
  }

  merge(state1: AggregatorState<T[]>, state2: AggregatorState<T[]>): AggregatorState<T[]> {
    let merged = [...state1.state, ...state2.state]
    if (this.maxSize !== undefined && merged.length > this.maxSize) {
      merged = merged.slice(0, this.maxSize)
    }
    return {
      type: 'groupArray',
      state: merged,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<T[]>): T[] {
    return state.state
  }
}

/**
 * Collect unique values into array
 */
export class GroupUniqArrayAggregator<T> implements Aggregator<T, T[], Set<string>> {
  private maxSize?: number

  constructor(maxSize?: number) {
    this.maxSize = maxSize
  }

  init(): AggregatorState<Set<string>> {
    return { type: 'groupUniqArray', state: new Set(), count: 0 }
  }

  add(state: AggregatorState<Set<string>>, value: T): void {
    if (value !== null && value !== undefined) {
      const key = JSON.stringify(value)
      if (this.maxSize === undefined || state.state.size < this.maxSize) {
        state.state.add(key)
      }
    }
    state.count++
  }

  merge(state1: AggregatorState<Set<string>>, state2: AggregatorState<Set<string>>): AggregatorState<Set<string>> {
    const merged = new Set([...state1.state, ...state2.state])
    // Trim to maxSize if needed
    if (this.maxSize !== undefined && merged.size > this.maxSize) {
      const arr = [...merged]
      return {
        type: 'groupUniqArray',
        state: new Set(arr.slice(0, this.maxSize)),
        count: state1.count + state2.count,
      }
    }
    return {
      type: 'groupUniqArray',
      state: merged,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<Set<string>>): T[] {
    return [...state.state].map(s => JSON.parse(s))
  }
}

/**
 * Top K most frequent values
 */
export class TopKAggregator<T> implements Aggregator<T, T[], Map<string, number>> {
  private k: number

  constructor(k: number = 10) {
    this.k = k
  }

  init(): AggregatorState<Map<string, number>> {
    return { type: 'topK', state: new Map(), count: 0 }
  }

  add(state: AggregatorState<Map<string, number>>, value: T): void {
    if (value !== null && value !== undefined) {
      const key = JSON.stringify(value)
      state.state.set(key, (state.state.get(key) || 0) + 1)
    }
    state.count++
  }

  merge(
    state1: AggregatorState<Map<string, number>>,
    state2: AggregatorState<Map<string, number>>
  ): AggregatorState<Map<string, number>> {
    const merged = new Map(state1.state)
    for (const [key, count] of state2.state) {
      merged.set(key, (merged.get(key) || 0) + count)
    }
    return {
      type: 'topK',
      state: merged,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<Map<string, number>>): T[] {
    const sorted = [...state.state.entries()].sort((a, b) => b[1] - a[1])
    return sorted.slice(0, this.k).map(([key, _]) => JSON.parse(key))
  }
}

// ============================================================================
// Conditional Aggregators
// ============================================================================

/**
 * Sum with condition
 */
export class SumIfAggregator implements Aggregator<{ value: number; condition: boolean }, number, number> {
  init(): AggregatorState<number> {
    return { type: 'sumIf', state: 0, count: 0 }
  }

  add(state: AggregatorState<number>, input: { value: number; condition: boolean }): void {
    if (input.condition && typeof input.value === 'number' && !isNaN(input.value)) {
      state.state += input.value
    }
    state.count++
  }

  merge(state1: AggregatorState<number>, state2: AggregatorState<number>): AggregatorState<number> {
    return {
      type: 'sumIf',
      state: state1.state + state2.state,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<number>): number {
    return state.state
  }
}

/**
 * Count with condition
 */
export class CountIfAggregator implements Aggregator<boolean, number, number> {
  init(): AggregatorState<number> {
    return { type: 'countIf', state: 0, count: 0 }
  }

  add(state: AggregatorState<number>, condition: boolean): void {
    if (condition) {
      state.state++
    }
    state.count++
  }

  merge(state1: AggregatorState<number>, state2: AggregatorState<number>): AggregatorState<number> {
    return {
      type: 'countIf',
      state: state1.state + state2.state,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<number>): number {
    return state.state
  }
}

/**
 * Average with condition
 */
export class AvgIfAggregator implements Aggregator<{ value: number; condition: boolean }, number | null, { sum: number; count: number }> {
  init(): AggregatorState<{ sum: number; count: number }> {
    return { type: 'avgIf', state: { sum: 0, count: 0 }, count: 0 }
  }

  add(state: AggregatorState<{ sum: number; count: number }>, input: { value: number; condition: boolean }): void {
    if (input.condition && typeof input.value === 'number' && !isNaN(input.value)) {
      state.state.sum += input.value
      state.state.count++
    }
    state.count++
  }

  merge(
    state1: AggregatorState<{ sum: number; count: number }>,
    state2: AggregatorState<{ sum: number; count: number }>
  ): AggregatorState<{ sum: number; count: number }> {
    return {
      type: 'avgIf',
      state: {
        sum: state1.state.sum + state2.state.sum,
        count: state1.state.count + state2.state.count,
      },
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<{ sum: number; count: number }>): number | null {
    if (state.state.count === 0) return null
    return state.state.sum / state.state.count
  }
}

// ============================================================================
// Approximate Aggregators
// ============================================================================

/**
 * Any heavy hitter (approximate mode)
 * Uses Space-Saving algorithm
 */
export class AnyHeavyAggregator<T> implements Aggregator<T, T | null, Map<string, { value: T; count: number }>> {
  private capacity: number

  constructor(capacity = 100) {
    this.capacity = capacity
  }

  init(): AggregatorState<Map<string, { value: T; count: number }>> {
    return { type: 'anyHeavy', state: new Map(), count: 0 }
  }

  add(state: AggregatorState<Map<string, { value: T; count: number }>>, value: T): void {
    if (value === null || value === undefined) {
      state.count++
      return
    }

    const key = JSON.stringify(value)

    if (state.state.has(key)) {
      const item = state.state.get(key)!
      item.count++
    } else if (state.state.size < this.capacity) {
      state.state.set(key, { value, count: 1 })
    } else {
      // Find minimum and replace
      let minKey = ''
      let minCount = Infinity
      for (const [k, v] of state.state) {
        if (v.count < minCount) {
          minCount = v.count
          minKey = k
        }
      }
      state.state.delete(minKey)
      state.state.set(key, { value, count: minCount + 1 })
    }
    state.count++
  }

  merge(
    state1: AggregatorState<Map<string, { value: T; count: number }>>,
    state2: AggregatorState<Map<string, { value: T; count: number }>>
  ): AggregatorState<Map<string, { value: T; count: number }>> {
    const merged = new Map(state1.state)
    for (const [key, item] of state2.state) {
      if (merged.has(key)) {
        merged.get(key)!.count += item.count
      } else {
        merged.set(key, { ...item })
      }
    }

    // Trim to capacity
    if (merged.size > this.capacity) {
      const sorted = [...merged.entries()].sort((a, b) => b[1].count - a[1].count)
      const trimmed = new Map(sorted.slice(0, this.capacity))
      return {
        type: 'anyHeavy',
        state: trimmed,
        count: state1.count + state2.count,
      }
    }

    return {
      type: 'anyHeavy',
      state: merged,
      count: state1.count + state2.count,
    }
  }

  finalize(state: AggregatorState<Map<string, { value: T; count: number }>>): T | null {
    let maxCount = 0
    let maxValue: T | null = null
    for (const item of state.state.values()) {
      if (item.count > maxCount) {
        maxCount = item.count
        maxValue = item.value
      }
    }
    return maxValue
  }
}

// ============================================================================
// Aggregator Factory
// ============================================================================

export type AggregatorType =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'uniq'
  | 'uniqExact'
  | 'uniqHLL12'
  | 'quantile'
  | 'quantiles'
  | 'stddevPop'
  | 'varPop'
  | 'argMin'
  | 'argMax'
  | 'first'
  | 'last'
  | 'groupArray'
  | 'groupUniqArray'
  | 'topK'
  | 'sumIf'
  | 'countIf'
  | 'avgIf'
  | 'anyHeavy'

/**
 * Create an aggregator by type
 */
export function createAggregator(type: AggregatorType, options?: Record<string, unknown>): Aggregator<any, any, any> {
  switch (type) {
    case 'count':
      return new CountAggregator()
    case 'sum':
      return new SumAggregator()
    case 'avg':
      return new AvgAggregator()
    case 'min':
      return new MinAggregator()
    case 'max':
      return new MaxAggregator()
    case 'uniq':
    case 'uniqExact':
      return new UniqExactAggregator()
    case 'uniqHLL12':
      return new UniqHLLAggregator(12)
    case 'quantile':
      return new QuantileAggregator(options?.level as number ?? 0.5)
    case 'quantiles':
      return new QuantilesAggregator(options?.levels as number[] ?? [0.25, 0.5, 0.75])
    case 'stddevPop':
      return new StddevPopAggregator()
    case 'varPop':
      return new VarPopAggregator()
    case 'argMin':
      return new ArgMinAggregator()
    case 'argMax':
      return new ArgMaxAggregator()
    case 'first':
      return new FirstValueAggregator()
    case 'last':
      return new LastValueAggregator()
    case 'groupArray':
      return new GroupArrayAggregator(options?.maxSize as number | undefined)
    case 'groupUniqArray':
      return new GroupUniqArrayAggregator(options?.maxSize as number | undefined)
    case 'topK':
      return new TopKAggregator(options?.k as number ?? 10)
    case 'sumIf':
      return new SumIfAggregator()
    case 'countIf':
      return new CountIfAggregator()
    case 'avgIf':
      return new AvgIfAggregator()
    case 'anyHeavy':
      return new AnyHeavyAggregator(options?.capacity as number ?? 100)
    default:
      throw new Error(`Unknown aggregator type: ${type}`)
  }
}

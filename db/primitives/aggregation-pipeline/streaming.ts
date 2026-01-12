/**
 * Streaming Pipeline - Continuous aggregation with WindowManager integration
 *
 * Provides:
 * - Continuous aggregation over streaming data
 * - Window-based grouping (tumbling, sliding, session, global)
 * - Watermark handling for event-time processing
 * - Late data side outputs
 * - Incremental results with delta tracking
 * - Stateful accumulator checkpointing
 */

import {
  WindowManager,
  WindowAssigner,
  Window,
  Trigger,
  TriggerResult,
  EventTimeTrigger,
  CountTrigger,
  ProcessingTimeTrigger,
  PurgingTrigger,
  Duration,
  minutes,
  seconds,
  hours,
} from '../window-manager'
import { createMatchStage, MatchPredicate } from './stages/match'
import { createProjectStage, ProjectSpec } from './stages/project'
import type { Accumulator } from './stages/group'

// Re-export for convenience
export { WindowManager, Window, EventTimeTrigger, CountTrigger, ProcessingTimeTrigger, PurgingTrigger, Trigger, TriggerResult, minutes, seconds, hours }

// ============================================================================
// Types
// ============================================================================

/**
 * Aggregation specification (MongoDB-style)
 */
export type AggregationSpec = {
  [key: string]: Accumulator | { $windowStart: boolean } | { $windowEnd: boolean }
}

/**
 * Late data handling strategy
 */
export interface LateDataStrategy<T> {
  type: 'drop' | 'sideOutput' | 'custom'
  handler?: (event: T, window: Window, context: StreamingContext) => 'drop' | 'retain'
}

/**
 * Deduplication configuration
 */
export interface DeduplicationConfig<T> {
  enabled: boolean
  keyExtractor: (event: T) => string
}

/**
 * Checkpointing configuration
 */
export interface CheckpointingConfig {
  enabled: boolean
  interval: Duration
}

/**
 * Streaming pipeline options
 */
export interface StreamingPipelineOptions<T> {
  windowAssigner: WindowAssigner<T>
  trigger: Trigger<T>
  allowedLateness?: Duration
  lateDataStrategy?: LateDataStrategy<T>
  deduplication?: DeduplicationConfig<T>
  checkpointing?: CheckpointingConfig
  emitDeltas?: boolean
}

/**
 * Windowed aggregation result
 */
export interface WindowedAggregation<T> {
  window: Window
  key: unknown
  aggregations: Record<string, unknown>
}

/**
 * Incremental result emitted on trigger
 */
export interface IncrementalResult<T> {
  window: Window
  aggregations: Map<unknown, Record<string, unknown>>
  delta?: {
    [key: string]: unknown
  }
  isRetraction?: boolean
}

/**
 * Late data output
 */
export interface LateDataOutput<T> {
  event: T
  window: Window
}

/**
 * Checkpoint state for recovery
 */
export interface CheckpointState {
  watermark: number
  windowStates: Array<{
    windowKey: string
    window: Window
    elements: unknown[]
    accumulatorStates: Record<string, unknown>
  }>
  accumulatorStates: Record<string, unknown>
}

/**
 * Streaming context provided to handlers
 */
export interface StreamingContext {
  watermark: number
  processingTime: number
}

/**
 * Memory usage estimate
 * Extends Number to allow numeric comparisons while also having properties
 */
export interface MemoryEstimate extends Number {
  windowState: number
  accumulatorState: number
  total: number
}

/**
 * Streaming pipeline interface
 */
export interface StreamingPipeline<T> {
  isStreaming: boolean
  windowType: 'tumbling' | 'sliding' | 'session' | 'global'
  windowSize?: Duration
  windowSlide?: Duration

  // Configuration methods
  groupBy(field: string | string[]): StreamingPipeline<T>
  withKeyExtractor(fn: (event: T) => string): StreamingPipeline<T>
  aggregate(spec: AggregationSpec): StreamingPipeline<T>
  match(predicate: MatchPredicate<T>): StreamingPipeline<T>
  project(spec: ProjectSpec<unknown>): StreamingPipeline<T>

  // Event processing
  process(event: T): void
  advanceWatermark(timestamp: number): void
  getCurrentWatermark(): number

  // Result handling
  onResult(callback: (result: IncrementalResult<T>) => void): void
  onLateData(callback: (event: T, window: Window) => void): StreamingPipeline<T>

  // Checkpointing
  createCheckpoint(): CheckpointState
  restoreFromCheckpoint(state: CheckpointState): void

  // Resource management
  dispose(): void
  getActiveWindowCount(): number
  estimateMemoryUsage(): MemoryEstimate
}

// ============================================================================
// Accumulator State Management
// ============================================================================

interface AccumulatorState {
  type: string
  value: unknown
  count?: number
  values?: unknown[]
  set?: Set<string>
}

function initAccumulatorState(spec: Accumulator): AccumulatorState {
  if ('$sum' in spec) return { type: '$sum', value: 0 }
  if ('$count' in spec) return { type: '$count', value: 0 }
  if ('$avg' in spec) return { type: '$avg', value: 0, count: 0 }
  if ('$min' in spec) return { type: '$min', value: undefined }
  if ('$max' in spec) return { type: '$max', value: undefined }
  if ('$first' in spec) return { type: '$first', value: undefined }
  if ('$last' in spec) return { type: '$last', value: undefined }
  if ('$push' in spec) return { type: '$push', value: [], values: [] }
  if ('$addToSet' in spec) return { type: '$addToSet', value: [], values: [], set: new Set() }
  if ('$windowStart' in spec) return { type: '$windowStart', value: 0 }
  if ('$windowEnd' in spec) return { type: '$windowEnd', value: 0 }
  return { type: 'unknown', value: null }
}

function getFieldValue(obj: unknown, field: string): unknown {
  if (obj === null || obj === undefined) return undefined
  const path = field.startsWith('$') ? field.slice(1) : field
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function evaluateExpression(expr: unknown, doc: unknown): unknown {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return getFieldValue(doc, expr)
  }
  if (typeof expr !== 'object' || expr === null) return expr

  const exprObj = expr as Record<string, unknown>

  if (exprObj.$cond) {
    const cond = exprObj.$cond as unknown[]
    if (Array.isArray(cond)) {
      const [condition, thenVal, elseVal] = cond
      const condResult = evaluateCondition(condition, doc)
      const result = condResult ? thenVal : elseVal
      // Recursively evaluate the result if it's a field reference or expression
      return evaluateExpression(result, doc)
    }
  }

  if (exprObj.$sum) return evaluateExpression(exprObj.$sum, doc)

  if (exprObj.$subtract) {
    const [a, b] = exprObj.$subtract as unknown[]
    const valA = evaluateExpression(a, doc)
    const valB = evaluateExpression(b, doc)
    return (typeof valA === 'number' ? valA : 0) - (typeof valB === 'number' ? valB : 0)
  }

  return expr
}

function evaluateCondition(condition: unknown, doc: unknown): boolean {
  if (typeof condition !== 'object' || condition === null) return Boolean(condition)

  const condObj = condition as Record<string, unknown>

  if (condObj.$eq) {
    const [a, b] = (condObj.$eq as unknown[]).map((v) =>
      typeof v === 'string' && v.startsWith('$') ? getFieldValue(doc, v) : v
    )
    return a === b
  }

  return false
}

function updateAccumulatorState(
  state: AccumulatorState,
  spec: Accumulator,
  event: unknown,
  window?: Window
): void {
  switch (state.type) {
    case '$sum': {
      const specSum = (spec as { $sum: unknown }).$sum
      let addValue: number
      if (typeof specSum === 'number') {
        addValue = specSum
      } else if (typeof specSum === 'string') {
        const val = getFieldValue(event, specSum)
        addValue = typeof val === 'number' ? val : 0
      } else {
        const val = evaluateExpression(specSum, event)
        addValue = typeof val === 'number' ? val : 0
      }
      state.value = (state.value as number) + addValue
      break
    }

    case '$count':
      state.value = (state.value as number) + 1
      break

    case '$avg': {
      const specAvg = (spec as { $avg: string }).$avg
      const val = getFieldValue(event, specAvg)
      if (val !== null && val !== undefined && typeof val === 'number') {
        state.value = (state.value as number) + val
        state.count = (state.count || 0) + 1
      }
      break
    }

    case '$min': {
      const specMin = (spec as { $min: string }).$min
      const val = getFieldValue(event, specMin)
      if (val !== null && val !== undefined) {
        if (state.value === undefined || (val as number) < (state.value as number)) {
          state.value = val
        }
      }
      break
    }

    case '$max': {
      const specMax = (spec as { $max: string }).$max
      const val = getFieldValue(event, specMax)
      if (val !== null && val !== undefined) {
        if (state.value === undefined || (val as number) > (state.value as number)) {
          state.value = val
        }
      }
      break
    }

    case '$first': {
      if (state.value === undefined) {
        const specFirst = (spec as { $first: string }).$first
        state.value = getFieldValue(event, specFirst)
      }
      break
    }

    case '$last': {
      const specLast = (spec as { $last: string }).$last
      state.value = getFieldValue(event, specLast)
      break
    }

    case '$push': {
      const specPush = (spec as { $push: string }).$push
      const val = getFieldValue(event, specPush)
      ;(state.values as unknown[]).push(val)
      state.value = state.values
      break
    }

    case '$addToSet': {
      const specAddToSet = (spec as { $addToSet: string }).$addToSet
      const val = getFieldValue(event, specAddToSet)
      const key = JSON.stringify(val)
      if (!state.set!.has(key)) {
        state.set!.add(key)
        ;(state.values as unknown[]).push(val)
        state.value = state.values
      }
      break
    }

    case '$windowStart':
      if (window) state.value = window.start
      break

    case '$windowEnd':
      if (window) state.value = window.end
      break
  }
}

function finalizeAccumulatorState(state: AccumulatorState): unknown {
  if (state.type === '$avg') {
    if (!state.count || state.count === 0) return null
    return (state.value as number) / state.count
  }
  return state.value
}

// ============================================================================
// Streaming Pipeline Implementation
// ============================================================================

class StreamingPipelineImpl<T> implements StreamingPipeline<T> {
  public readonly isStreaming = true
  public readonly windowType: 'tumbling' | 'sliding' | 'session' | 'global'
  public readonly windowSize?: Duration
  public readonly windowSlide?: Duration

  private windowManager: WindowManager<T>
  private options: StreamingPipelineOptions<T>
  private groupByFields: string[] = []
  private keyExtractor?: (event: T) => string
  private aggregationSpec?: AggregationSpec
  private matchPredicate?: MatchPredicate<T>
  private projectSpec?: ProjectSpec<unknown>
  private resultCallback?: (result: IncrementalResult<T>) => void
  private lateDataCallback?: (event: T, window: Window) => void

  // Per-window state
  private windowAccumulators = new Map<string, Map<string, Map<string, AccumulatorState>>>()
  private deduplicationKeys = new Map<string, Set<string>>()
  private lastEmittedValues = new Map<string, Map<string, Record<string, unknown>>>()

  // Processing time trigger interval
  private processingTimeInterval?: ReturnType<typeof setInterval>

  constructor(options: StreamingPipelineOptions<T>) {
    this.options = options
    this.windowManager = new WindowManager(options.windowAssigner)
    this.windowManager.withTrigger(options.trigger)

    if (options.allowedLateness) {
      this.windowManager.allowLateness(options.allowedLateness)
    }

    // Set window type and size
    this.windowType = options.windowAssigner.type as 'tumbling' | 'sliding' | 'session' | 'global'
    this.windowSize = options.windowAssigner.size
    this.windowSlide = options.windowAssigner.slide

    // Set up trigger callback
    this.windowManager.onTrigger((window, elements) => {
      this.emitWindowResults(window, elements)
    })

    // Handle late data
    this.windowManager.sideOutputLate((element, window) => {
      if (options.allowedLateness) {
        // Within allowed lateness - add to accumulator and re-emit
        if (window) {
          this.processEventInWindow(element, window)
          this.emitWindowResults(window, [element])
        }
      } else if (this.lateDataCallback && window) {
        this.lateDataCallback(element, window)
      } else if (options.lateDataStrategy?.type === 'custom' && options.lateDataStrategy.handler) {
        const context: StreamingContext = {
          watermark: this.getCurrentWatermark(),
          processingTime: Date.now(),
        }
        if (window) {
          const action = options.lateDataStrategy.handler(element, window, context)
          // Handle action if needed
        }
      }
    })

    // Set up processing time trigger if needed
    if (options.trigger instanceof ProcessingTimeTrigger) {
      ;(options.trigger as ProcessingTimeTrigger<T>).setCallback(() => {
        this.fireAllWindows()
      })
    }
  }

  groupBy(field: string | string[]): StreamingPipeline<T> {
    this.groupByFields = Array.isArray(field) ? field : [field]
    return this
  }

  withKeyExtractor(fn: (event: T) => string): StreamingPipeline<T> {
    this.keyExtractor = fn
    this.windowManager.withKeyExtractor(fn)
    return this
  }

  aggregate(spec: AggregationSpec): StreamingPipeline<T> {
    this.aggregationSpec = spec
    return this
  }

  match(predicate: MatchPredicate<T>): StreamingPipeline<T> {
    this.matchPredicate = predicate
    return this
  }

  project(spec: ProjectSpec<unknown>): StreamingPipeline<T> {
    this.projectSpec = spec
    return this
  }

  process(event: T): void {
    // Apply match filter
    if (this.matchPredicate) {
      const matchStage = createMatchStage<T>(this.matchPredicate)
      const filtered = matchStage.process([event])
      if (filtered.length === 0) return
    }

    // Get timestamp from event
    const timestamp = (event as { timestamp?: number }).timestamp || Date.now()

    // Check for late data
    const currentWatermark = this.getCurrentWatermark()
    if (timestamp < currentWatermark && this.windowType !== 'global') {
      const windows = this.windowManager.assign(event, timestamp)
      for (const window of windows) {
        // Check if window is still accepting late data
        const allowedLatenessMs = this.options.allowedLateness?.toMillis() || 0
        if (window.end <= currentWatermark - allowedLatenessMs) {
          // Too late
          if (this.lateDataCallback) {
            this.lateDataCallback(event, window)
          } else if (this.options.lateDataStrategy?.type === 'custom' && this.options.lateDataStrategy.handler) {
            const context: StreamingContext = {
              watermark: currentWatermark,
              processingTime: Date.now(),
            }
            this.options.lateDataStrategy.handler(event, window, context)
          }
          return
        }
      }
    }

    // First, update accumulators for the window BEFORE triggering
    // This ensures that when triggers fire, the data is already accumulated
    const windows = this.windowManager.assign(event, timestamp)
    for (const window of windows) {
      this.processEventInWindow(event, window)
    }

    // Then process through window manager (which may fire triggers)
    this.windowManager.process(event, timestamp)
  }

  private processEventInWindow(event: T, window: Window): void {
    const windowKey = this.getWindowKey(window)

    // For session windows, merge any overlapping accumulators
    if (this.windowType === 'session') {
      this.mergeSessionAccumulators(window)
    }

    // Apply deduplication if enabled
    if (this.options.deduplication?.enabled) {
      const dedupKey = this.options.deduplication.keyExtractor(event)
      if (!this.deduplicationKeys.has(windowKey)) {
        this.deduplicationKeys.set(windowKey, new Set())
      }
      const dedupSet = this.deduplicationKeys.get(windowKey)!
      if (dedupSet.has(dedupKey)) return
      dedupSet.add(dedupKey)
    }

    // Get group key
    const groupKey = this.getGroupKey(event)

    // Initialize accumulators for this window/group
    if (!this.windowAccumulators.has(windowKey)) {
      this.windowAccumulators.set(windowKey, new Map())
    }
    const windowAccs = this.windowAccumulators.get(windowKey)!

    if (!windowAccs.has(groupKey)) {
      windowAccs.set(groupKey, new Map())
      // Initialize accumulators
      if (this.aggregationSpec) {
        for (const [field, spec] of Object.entries(this.aggregationSpec)) {
          windowAccs.get(groupKey)!.set(field, initAccumulatorState(spec as Accumulator))
        }
      }
    }

    // Update accumulators
    const groupAccs = windowAccs.get(groupKey)!
    if (this.aggregationSpec) {
      for (const [field, spec] of Object.entries(this.aggregationSpec)) {
        const state = groupAccs.get(field)!
        updateAccumulatorState(state, spec as Accumulator, event, window)
      }
    }
  }

  /**
   * Merge accumulators from overlapping session windows into the new merged window
   */
  private mergeSessionAccumulators(mergedWindow: Window): void {
    const mergedWindowKey = this.getWindowKey(mergedWindow)
    const gapMs = this.options.windowAssigner.gap?.toMillis() || 0

    // Find all accumulators that should be merged into this window
    const keysToMerge: string[] = []

    for (const [existingKey, _] of this.windowAccumulators) {
      if (existingKey === mergedWindowKey) continue

      // Parse window from key
      const parts = existingKey.split('-')
      const existingStart = Number(parts[0])
      const existingEnd = Number(parts[1])
      const existingSessionKey = parts.slice(2).join('-')

      // Check if windows should merge (overlap or within gap)
      const shouldMerge =
        // Check key matches (if present)
        (mergedWindow.key === undefined || existingSessionKey === '' || existingSessionKey === (mergedWindow.key || '')) &&
        // Check overlap or adjacency
        (
          (mergedWindow.start <= existingEnd && mergedWindow.end >= existingStart) ||
          Math.abs(mergedWindow.start - existingEnd) <= gapMs ||
          Math.abs(existingStart - mergedWindow.end) <= gapMs
        )

      if (shouldMerge) {
        keysToMerge.push(existingKey)
      }
    }

    if (keysToMerge.length === 0) return

    // Initialize merged window accumulators if needed
    if (!this.windowAccumulators.has(mergedWindowKey)) {
      this.windowAccumulators.set(mergedWindowKey, new Map())
    }
    const mergedAccs = this.windowAccumulators.get(mergedWindowKey)!

    // Merge accumulators from old windows
    for (const oldKey of keysToMerge) {
      const oldAccs = this.windowAccumulators.get(oldKey)!

      for (const [groupKey, groupAccStates] of oldAccs) {
        if (!mergedAccs.has(groupKey)) {
          mergedAccs.set(groupKey, new Map())
          // Copy the accumulator states
          for (const [field, state] of groupAccStates) {
            mergedAccs.get(groupKey)!.set(field, { ...state })
          }
        } else {
          // Merge accumulator states
          const targetGroupAccs = mergedAccs.get(groupKey)!
          for (const [field, sourceState] of groupAccStates) {
            const targetState = targetGroupAccs.get(field)
            if (targetState) {
              this.mergeAccumulatorStates(targetState, sourceState)
            }
          }
        }
      }

      // Delete old accumulator
      this.windowAccumulators.delete(oldKey)
      this.deduplicationKeys.delete(oldKey)
    }
  }

  /**
   * Merge two accumulator states
   */
  private mergeAccumulatorStates(target: AccumulatorState, source: AccumulatorState): void {
    switch (target.type) {
      case '$sum':
      case '$count':
        target.value = (target.value as number) + (source.value as number)
        break
      case '$avg':
        target.value = (target.value as number) + (source.value as number)
        target.count = (target.count || 0) + (source.count || 0)
        break
      case '$min':
        if (source.value !== undefined && (target.value === undefined || (source.value as number) < (target.value as number))) {
          target.value = source.value
        }
        break
      case '$max':
        if (source.value !== undefined && (target.value === undefined || (source.value as number) > (target.value as number))) {
          target.value = source.value
        }
        break
      case '$first':
        // Keep target's first value
        break
      case '$last':
        // Use source's last value
        target.value = source.value
        break
      case '$push':
        target.values = [...(target.values || []), ...(source.values || [])]
        target.value = target.values
        break
      case '$addToSet':
        for (const val of source.values || []) {
          const key = JSON.stringify(val)
          if (!target.set!.has(key)) {
            target.set!.add(key)
            target.values!.push(val)
          }
        }
        target.value = target.values
        break
    }
  }

  private getGroupKey(event: T): string {
    if (this.keyExtractor) {
      return this.keyExtractor(event)
    }

    if (this.groupByFields.length === 0) {
      return 'undefined'
    }

    const keyParts: unknown[] = []
    for (const field of this.groupByFields) {
      keyParts.push(getFieldValue(event, field))
    }
    return JSON.stringify(keyParts.length === 1 ? keyParts[0] : keyParts)
  }

  private getWindowKey(window: Window): string {
    return `${window.start}-${window.end}-${window.key || ''}`
  }

  advanceWatermark(timestamp: number): void {
    const current = this.getCurrentWatermark()
    if (timestamp < current) {
      throw new Error('Watermark cannot go backwards')
    }
    this.windowManager.advanceWatermark(timestamp)
  }

  getCurrentWatermark(): number {
    return this.windowManager.getCurrentWatermark()
  }

  onResult(callback: (result: IncrementalResult<T>) => void): void {
    this.resultCallback = callback
  }

  onLateData(callback: (event: T, window: Window) => void): StreamingPipeline<T> {
    this.lateDataCallback = callback
    return this
  }

  private emitWindowResults(window: Window, elements: T[]): void {
    if (!this.resultCallback || !this.aggregationSpec) return

    const windowKey = this.getWindowKey(window)
    const windowAccs = this.windowAccumulators.get(windowKey)

    if (!windowAccs) return

    const aggregations = new Map<unknown, Record<string, unknown>>()

    for (const [groupKey, accStates] of windowAccs) {
      const result: Record<string, unknown> = {}
      for (const [field, state] of accStates) {
        result[field] = finalizeAccumulatorState(state)
      }

      // Parse group key back to original value
      let parsedKey: unknown
      try {
        parsedKey = JSON.parse(groupKey)
      } catch {
        parsedKey = groupKey === 'undefined' ? undefined : groupKey
      }

      aggregations.set(parsedKey, result)
    }

    // Calculate delta if enabled
    let delta: { [key: string]: unknown } | undefined
    if (this.options.emitDeltas) {
      const lastEmitted = this.lastEmittedValues.get(windowKey)
      if (lastEmitted) {
        delta = {}
        for (const [groupKey, result] of aggregations) {
          const lastResult = lastEmitted.get(String(groupKey))
          if (lastResult) {
            for (const [field, value] of Object.entries(result)) {
              if (typeof value === 'number' && typeof lastResult[field] === 'number') {
                delta[`${field}Delta`] = (value as number) - (lastResult[field] as number)
              }
            }
          }
        }
      }

      // Update last emitted
      const newLastEmitted = new Map<string, Record<string, unknown>>()
      for (const [groupKey, result] of aggregations) {
        newLastEmitted.set(String(groupKey), { ...result })
      }
      this.lastEmittedValues.set(windowKey, newLastEmitted)
    }

    // Apply projection if configured
    if (this.projectSpec) {
      const projectStage = createProjectStage<Record<string, unknown>>(this.projectSpec)
      for (const [groupKey, result] of aggregations) {
        const projected = projectStage.process([result])[0] as Record<string, unknown>
        aggregations.set(groupKey, projected)
      }
    }

    this.resultCallback({
      window,
      aggregations,
      delta,
    })

    // Check if trigger is purging
    if (this.options.trigger instanceof PurgingTrigger) {
      // Clear accumulator state
      this.windowAccumulators.delete(windowKey)
      this.deduplicationKeys.delete(windowKey)
    }
  }

  private fireAllWindows(): void {
    for (const [windowKey, windowAccs] of this.windowAccumulators) {
      // Parse window key - handle negative numbers properly
      // Key format: "start-end-key" where start/end can be negative
      const window = this.parseWindowKey(windowKey)
      this.emitWindowResults(window, [])
    }
  }

  /**
   * Parse a window key back into a Window object.
   * Handles negative numbers in start/end properly.
   */
  private parseWindowKey(windowKey: string): Window {
    // Find the positions of delimiters by looking for patterns like "number-number-"
    // For a key like "-9007199254740991-9007199254740991-key"
    // We need to find the second-to-last dash before the key part

    // Split and rejoin strategy: find last non-numeric part
    const parts = windowKey.split('-')

    // For global window: "-9007199254740991-9007199254740991-"
    // parts = ['', '9007199254740991', '9007199254740991', '']

    // For positive window: "100-200-"
    // parts = ['100', '200', '']

    // For keyed window: "100-200-mykey"
    // parts = ['100', '200', 'mykey']

    // We need to reconstruct start and end by looking at the numeric parts
    let start: number
    let end: number
    let key: string | undefined

    if (parts[0] === '') {
      // Start is negative
      start = -Number(parts[1])
      if (parts[2] === '' || parts[2].startsWith('-')) {
        // End is also negative
        end = -Number(parts[3] || parts[2].slice(1))
        key = parts.slice(4).join('-') || undefined
      } else {
        end = Number(parts[2])
        key = parts.slice(3).join('-') || undefined
      }
    } else {
      start = Number(parts[0])
      if (parts[1] === '' || (parts.length > 2 && parts[1] === '' )) {
        // End is negative
        end = -Number(parts[2])
        key = parts.slice(3).join('-') || undefined
      } else {
        end = Number(parts[1])
        key = parts.slice(2).join('-') || undefined
      }
    }

    return { start, end, key: key || undefined }
  }

  createCheckpoint(): CheckpointState {
    const windowStates: CheckpointState['windowStates'] = []

    for (const [windowKey, windowAccs] of this.windowAccumulators) {
      const [start, end, key] = windowKey.split('-')
      const window: Window = { start: Number(start), end: Number(end), key: key || undefined }

      const accumulatorStates: Record<string, unknown> = {}
      for (const [groupKey, accStates] of windowAccs) {
        const groupAccs: Record<string, unknown> = {}
        for (const [field, state] of accStates) {
          groupAccs[field] = {
            type: state.type,
            value: state.value,
            count: state.count,
          }
        }
        accumulatorStates[groupKey] = groupAccs
      }

      windowStates.push({
        windowKey,
        window,
        elements: [],
        accumulatorStates,
      })
    }

    return {
      watermark: this.getCurrentWatermark(),
      windowStates,
      accumulatorStates: {},
    }
  }

  restoreFromCheckpoint(state: CheckpointState): void {
    // Restore window accumulators
    for (const windowState of state.windowStates) {
      const windowAccs = new Map<string, Map<string, AccumulatorState>>()

      for (const [groupKey, groupAccs] of Object.entries(windowState.accumulatorStates)) {
        const accStates = new Map<string, AccumulatorState>()
        for (const [field, accState] of Object.entries(groupAccs as Record<string, unknown>)) {
          const acc = accState as { type: string; value: unknown; count?: number }
          accStates.set(field, {
            type: acc.type,
            value: acc.value,
            count: acc.count,
          })
        }
        windowAccs.set(groupKey, accStates)
      }

      this.windowAccumulators.set(windowState.windowKey, windowAccs)
    }

    // Restore watermark
    if (state.watermark > Number.MIN_SAFE_INTEGER) {
      try {
        this.windowManager.advanceWatermark(state.watermark)
      } catch {
        // Watermark may already be ahead
      }
    }
  }

  dispose(): void {
    if (this.processingTimeInterval) {
      clearInterval(this.processingTimeInterval)
      this.processingTimeInterval = undefined
    }

    this.windowManager.dispose()
    this.windowAccumulators.clear()
    this.deduplicationKeys.clear()
    this.lastEmittedValues.clear()
    this.resultCallback = undefined
    this.lateDataCallback = undefined
  }

  getActiveWindowCount(): number {
    return this.windowManager.getActiveWindowCount()
  }

  estimateMemoryUsage(): MemoryEstimate {
    let windowState = 0
    let accumulatorState = 0

    for (const [_, windowAccs] of this.windowAccumulators) {
      windowState += 100 // Window object overhead
      for (const [_, accStates] of windowAccs) {
        for (const [_, state] of accStates) {
          accumulatorState += 50 // Base state overhead
          if (Array.isArray(state.value)) {
            accumulatorState += state.value.length * 20
          }
          if (state.set) {
            accumulatorState += state.set.size * 30
          }
        }
      }
    }

    const total = windowState + accumulatorState
    // Create a Number object with additional properties
    // This allows numeric comparisons while also having object properties
    const result = Object.assign(new Number(total), {
      windowState,
      accumulatorState,
      total,
    })
    return result as MemoryEstimate
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a streaming pipeline
 */
export function createStreamingPipeline<T>(options: StreamingPipelineOptions<T>): StreamingPipeline<T> {
  return new StreamingPipelineImpl<T>(options)
}

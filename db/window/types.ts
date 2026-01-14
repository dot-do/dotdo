/**
 * Window Primitives - TypeScript Types
 */

/** Duration string format: '1h', '5m', '30s', etc. */
export type DurationString = string

/** Event with timestamp */
export interface TimestampedEvent {
  timestamp: number
}

/** Window state with result */
export interface WindowState<T, R> {
  windowId: string
  startTime: number
  endTime: number
  events: T[]
  result: R
  key?: string
}

/** Aggregate function type */
export type AggregateFunction<T, R> = (events: T[]) => R

/** Key extractor function type */
export type KeyExtractor<T> = ((event: T) => string) | string

/** Base window options */
export interface BaseWindowOptions<T, R = unknown> {
  aggregate?: AggregateFunction<T, R>
  trigger?: BaseTrigger
  initialState?: WindowSerializedState
}

/** Tumbling window options */
export interface TumblingWindowOptions<T, R = unknown> extends BaseWindowOptions<T, R> {
  size: DurationString | number
}

/** Sliding window options */
export interface SlidingWindowOptions<T, R = unknown> extends BaseWindowOptions<T, R> {
  size: DurationString | number
  slide: DurationString | number
}

/** Session window options */
export interface SessionWindowOptions<T, R = unknown> extends BaseWindowOptions<T, R> {
  gap: DurationString | number
  keyBy: KeyExtractor<T>
}

/** Window manager options */
export interface WindowManagerOptions {
  watermarkStrategy?: 'bounded' | 'punctuated'
  maxOutOfOrder?: DurationString | number
  allowedLateness?: DurationString | number
}

/** Base trigger interface */
export interface BaseTrigger {
  shouldFire(context: TriggerContext): boolean
}

/** Trigger context */
export interface TriggerContext {
  windowEnd?: number
  watermark?: Watermark
  eventCount?: number
  windowCreated?: number
  now?: number
  lastEventTime?: number
}

/** Closed window result */
export interface ClosedWindowResult<R> {
  windowId: string
  startTime: number
  endTime: number
  result: R
  key?: string
}

/** Add result from manager */
export interface AddResult {
  accepted: boolean
  reason?: string
}

/** Window close metadata */
export interface WindowCloseMetadata {
  windowType: 'tumbling' | 'sliding' | 'session'
  startTime: number
  endTime: number
}

/** Serialized window state for persistence */
export interface WindowSerializedState {
  windows: SerializedWindowData[]
  latestTimestamp: number
}

/** Single window data for serialization */
export interface SerializedWindowData {
  windowId: string
  startTime: number
  endTime: number
  events: unknown[]
  key?: string
  status: 'active' | 'closed' | 'fired'
}

/** Watermark type (imported separately) */
import type { Watermark } from './watermark'
export type { Watermark }

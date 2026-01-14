/**
 * Window Primitives - Main Exports
 *
 * Flink-inspired windowing with tumbling, sliding, and session windows
 */

export { TumblingWindow } from './tumbling'
export { SlidingWindow } from './sliding'
export { SessionWindow } from './session'
export { WindowManager } from './manager'
export { Watermark } from './watermark'
export { EventTimeTrigger, ProcessingTimeTrigger, Trigger } from './triggers'

export type {
  DurationString,
  TimestampedEvent,
  WindowState,
  AggregateFunction,
  KeyExtractor,
  TumblingWindowOptions,
  SlidingWindowOptions,
  SessionWindowOptions,
  WindowManagerOptions,
  BaseTrigger,
  TriggerContext,
  ClosedWindowResult,
  AddResult,
  WindowCloseMetadata,
  WindowSerializedState,
} from './types'

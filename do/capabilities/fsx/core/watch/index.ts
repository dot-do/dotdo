/**
 * Watch module - File watching with WebSocket notifications
 *
 * This module provides comprehensive file watching capabilities:
 *
 * - **WatchManager**: Core file watcher with debouncing and smart coalescing
 * - **SubscriptionManager**: WebSocket subscription management
 * - **BatchEmitter**: Batch event emission for reduced callback overhead
 * - **FSWatcherClient**: Production WebSocket client with auto-reconnect
 * - **Event types**: WatchEvent, type guards, and factory functions
 *
 * @module core/watch
 *
 * @example
 * ```typescript
 * import {
 *   WatchManager,
 *   BatchEmitter,
 *   createWatchEvent,
 *   isDeleteEvent,
 * } from '@dotdo/fsx/watch'
 *
 * // Local watching with debounce
 * const manager = new WatchManager()
 * manager.setDebounceDelay(50)
 * manager.addWatcher('/home', true, (event, filename) => {
 *   console.log(`${event}: ${filename}`)
 * })
 *
 * // Batch emission for WebSocket
 * const emitter = new BatchEmitter({ batchWindowMs: 10 })
 * emitter.onBatch((events) => {
 *   ws.send(JSON.stringify({ type: 'batch', events }))
 * })
 * ```
 */

// Event types and factory
export type {
  WatchEvent,
  WatchEventType,
  WatchEventMetadata,
} from './events.js'

export {
  createWatchEvent,
  isCreateEvent,
  isModifyEvent,
  isDeleteEvent,
  isRenameEvent,
} from './events.js'

// Watch manager with debouncing
export type {
  WatchListener,
  WatchEntry,
  DebounceMode,
} from './manager.js'

export type { WatchEventType as ManagerEventType } from './manager.js'

export { WatchManager } from './manager.js'

// WebSocket subscription management
export type {
  SubscribeMessage,
  UnsubscribeMessage,
  SubscriptionMessage,
  HandleMessageResult,
  SubscribeOptions,
  SubscriptionManagerOptions,
} from './subscription.js'

export { SubscriptionManager } from './subscription.js'

// Batch event emission
export type {
  BatchEmitterOptions,
  BatchMetrics,
  BatchCallback,
} from './batch.js'

export {
  BatchEmitter,
  EVENT_PRIORITY,
  createBatchEmitter,
} from './batch.js'

// WebSocket client
export type {
  FSWatcherClientOptions,
  ConnectionState,
  WatchCallback,
} from './client.js'

export { FSWatcherClient } from './client.js'

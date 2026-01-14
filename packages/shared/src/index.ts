/**
 * @dotdo/shared - Shared utilities for dotdo packages
 *
 * This module provides common event emitter implementations used across
 * dotdo compat SDKs and other packages. Zero external dependencies.
 */

// Export all event emitter types
export {
  EventEmitter,
  TypedEventEmitter,
  PusherEventEmitter,
  SocketIOEventEmitter,
  type EventHandler,
  type GlobalEventHandler,
} from './event-emitter'

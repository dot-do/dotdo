/**
 * @dotdo/primitives-core
 *
 * Shared utilities for dotdo primitives - hash functions, compression,
 * events, and state management.
 *
 * @packageDocumentation
 *
 * @example
 * ```typescript
 * import { sha256, compress, createEventEmitter, createStateBackend } from '@dotdo/primitives-core'
 *
 * // Hash data
 * const hash = await sha256('hello')
 *
 * // Compress data
 * const compressed = await compress('Hello, World!', 'gzip')
 *
 * // Event emitter
 * const emitter = createEventEmitter<{ message: string }>()
 * emitter.on('message', (text) => console.log(text))
 * emitter.emit('message', 'Hello!')
 *
 * // State backend
 * const backend = createStateBackend((state = { count: 0 }, action) => {
 *   if (action.type === 'INCREMENT') return { count: state.count + 1 }
 *   return state
 * })
 * backend.dispatch({ type: 'INCREMENT' })
 * ```
 */

// =============================================================================
// Hash utilities
// =============================================================================

export {
  sha1,
  sha256,
  murmurHash3,
  murmurHash3_32,
  bytesToHex,
  hexToBytes,
} from './hash.js'

// =============================================================================
// Compression utilities
// =============================================================================

export {
  compress,
  decompress,
  detectFormat,
  type CompressionFormat,
} from './compression.js'

// =============================================================================
// Event emitter
// =============================================================================

export {
  EventEmitter,
  createEventEmitter,
  type EventMap,
  type EventHandler,
  type EventSubscription,
} from './events.js'

// =============================================================================
// State backend
// =============================================================================

export {
  StateBackend,
  createStateBackend,
  type StateAction,
  type Reducer,
  type Middleware,
  type Dispatch,
  type MiddlewareAPI,
  type Subscriber,
  type StateSnapshot,
} from './state.js'

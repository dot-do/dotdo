/**
 * EventStreamDO Components
 *
 * Extracted components from EventStreamDO for better modularity and testability.
 *
 * @wave Wave 3: EventStreamDO Decomposition
 */

export {
  RateLimiter,
  type IRateLimiter,
  type RateLimitConfig,
  type RateLimitStatus,
} from './rate-limiter'

export {
  EventStore,
  type IEventStore,
  type StoredUnifiedEvent,
  type BroadcastEvent,
  type QueryResult,
  type UnifiedQueryFilters,
} from './event-store'

export {
  ConnectionManager,
  type IConnectionManager,
  type ConnectionInfo,
} from './connection-manager'

export {
  FanOutManager,
  type IFanOutManager,
  type BroadcastResult,
  type BatchMessage,
} from './fan-out-manager'

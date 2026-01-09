/**
 * Feature exports for @dotdo/client
 *
 * Import individual features for tree-shaking optimization.
 */

export { createReconnectionManager, calculateBackoffDelay, type ReconnectionState, type Reconnectable } from './reconnection'
export { createSubscriptionManager, type SubscriptionManager } from './subscriptions'
export { createOfflineQueue, type OfflineQueueManager } from './offline'
export { createBatchManager, type BatchManager, type BatchingConfig } from './batching'
export { withRetry, isRetryableHttpError, type RetryConfig } from './retry'

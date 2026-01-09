/**
 * Cloudflare Integration Layer for dotdo
 *
 * Provides typed wrappers for Cloudflare bindings:
 * - KV Store with namespacing, TTL management, and specialized methods
 *
 * @example
 * ```typescript
 * import { createKVStore } from 'lib/cloudflare'
 *
 * const store = createKVStore(env.KV, { namespace: 'tenant-123' })
 *
 * // Basic operations
 * await store.set('key', { data: 'value' }, { ttl: store.ttl.hours(1) })
 * const value = await store.get('key')
 *
 * // Session management
 * await store.setSession('sess-abc', { userId: 'user-123' }, store.ttl.days(7))
 *
 * // Rate limiting
 * const result = await store.checkRateLimit('user:123:api', 100, store.ttl.minutes(1))
 * if (!result.allowed) {
 *   throw new Error('Rate limit exceeded')
 * }
 *
 * // Caching expensive operations
 * const data = await store.cache('expensive-result', async () => {
 *   return await computeExpensiveResult()
 * }, { ttl: store.ttl.minutes(5) })
 * ```
 */

export {
  // Factory function
  createKVStore,
  // Class
  KVStore,
  // Types
  type KVNamespace,
  type KVStoreConfig,
  type SetOptions,
  type RateLimitData,
  type RateLimitCheckResult,
  type ListResult,
  type CacheOptions,
  type TTLHelpers,
} from './kv'

// ============================================================================
// QUEUES - Async Job Processing
// ============================================================================

export {
  // Message Types
  type BaseMessage,
  type RetryMetadata,
  type JobMessage,
  type EventMessage,
  type WorkflowTrigger,
  type QueueMessage,

  // Message Factory Functions
  type CreateJobMessageInput,
  type CreateEventMessageInput,
  type CreateWorkflowTriggerInput,
  createJobMessage,
  createEventMessage,
  createWorkflowTrigger,

  // Type Guards
  isJobMessage,
  isEventMessage,
  isWorkflowTrigger,

  // Retry Policies
  type RetryPolicy,
  DEFAULT_RETRY_POLICY,
  createRetryPolicy,
  calculateBackoffDelay,
  shouldSendToDLQ,

  // Queue Configuration
  type QueueConfig,
  createQueueConfig,
  QUEUE_CONFIGS,

  // Queue Client
  type SendResult,
  type BatchSendResult,
  type SendOptions,
  type QueueClient,
  createQueueClient,

  // DLQ Integration
  type DLQSendOptions,
  sendToDLQ,

  // Consumer Batch Processing
  type QueuedMessage,
  type MessageBatch,
  createMessageBatch,

  // Consumer Handler Utilities
  type JobHandler,
  type EventHandler,
  type MessageHandler,
  type BatchProcessResult,
  createJobHandler,
  createEventHandler,
  processMessageBatch,
} from './queues'

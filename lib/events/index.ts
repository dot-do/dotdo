/**
 * Events Pipeline Module
 *
 * Unified events pipeline for all event types:
 * - Routing events (request routing decisions)
 * - Usage events (API usage tracking)
 * - RPC events (Cap'n Web RPC metering)
 * - Custom events
 *
 * @example
 * ```typescript
 * import { sendEvent, initEventSink, routingEvent } from 'lib/events'
 *
 * // Initialize with env bindings (enables direct pipeline access)
 * initEventSink(env)
 *
 * // Send events
 * await sendEvent(routingEvent({
 *   requestId: 'req-123',
 *   pathname: '/api/customers',
 *   method: 'GET',
 *   targetBinding: 'DO',
 *   isReplica: false,
 *   consistencyMode: 'eventual',
 *   durationMs: 5,
 * }))
 * ```
 */

export {
  // Core functions
  createEventSink,
  initEventSink,
  sendEvents,
  sendEvent,
  hasEventsBinding,

  // Event factories
  routingEvent,
  usageEvent,
  rpcEvent,
  genericEvent,

  // Types
  type BaseEvent,
  type EventSink,
  type EventsEnv,
  type Pipeline,

  // Sink classes (for testing/extension)
  PipelineEventSink,
  HttpEventSink,

  // Constants
  EVENTS_ENDPOINT,
  MAX_BATCH_SIZE,
} from './pipeline'

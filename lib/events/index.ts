/**
 * Unified Events Pipeline
 *
 * THE universal event stream for everything:
 * - Domain events (Customer.created, Order.completed)
 * - Telemetry (Request.routed, RPC.called)
 * - Analytics (Session.started, Page.viewed)
 * - Browser insights (Vitals.measured, Error.caught)
 * - DB mutations (Thing.created, Thing.updated)
 * - Workers logs (Worker.invoked, Worker.errored)
 *
 * All events use flat fields (no nesting) for R2/SQL compatibility.
 * Uses Noun.event semantic for the verb field.
 *
 * @example
 * ```typescript
 * import { sendEvent, initEventSink, event } from 'lib/events'
 *
 * // Initialize with env bindings (enables direct pipeline access)
 * initEventSink(env)
 *
 * // Send events - flat fields, Noun.event verb
 * await sendEvent(event('Customer.created', {
 *   source: 'tenant-123',
 *   customerId: 'cust-456',
 *   name: 'Acme Corp',
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

  // Generic event factory
  event,

  // Typed event factories
  routingEvent,
  usageEvent,
  rpcEvent,
  thingCreatedEvent,
  thingUpdatedEvent,
  thingDeletedEvent,
  sessionStartedEvent,
  pageViewedEvent,
  vitalsEvent,
  errorEvent,
  workerInvokedEvent,
  browserConnectedEvent,
  browserDisconnectedEvent,
  identifyEvent,
  trackEvent,
  groupEvent,

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

/**
 * EventStream Test Worker
 *
 * Test worker that exports EventStreamDO for integration tests with real SQLite storage.
 * Used by @cloudflare/vitest-pool-workers to test event streaming with actual
 * Durable Object SQLite persistence - NO MOCKS.
 *
 * @module workers/event-stream-test-worker
 */

import { EventStreamDO, type EventStreamConfig } from '../streaming/event-stream-do'

// Re-export the EventStreamDO class for wrangler
export { EventStreamDO }

export interface EventStreamTestEnv {
  EVENT_STREAM_DO: DurableObjectNamespace
}

/**
 * Worker entry point for EventStreamDO integration tests.
 * Routes requests to the EventStreamDO based on namespace from header or subdomain.
 */
export default {
  async fetch(request: Request, env: EventStreamTestEnv): Promise<Response> {
    // Extract namespace from header or use default
    const ns = request.headers.get('X-DO-NS') || 'test-stream'

    // Get DO stub by name
    const id = env.EVENT_STREAM_DO.idFromName(ns)
    const stub = env.EVENT_STREAM_DO.get(id)

    // Forward request to DO
    return stub.fetch(request)
  },
}

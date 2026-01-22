/**
 * Test entry point for Business package
 *
 * This file is required by wrangler.jsonc for vitest-pool-workers.
 * It exports the Business class so tests can access it via env bindings.
 *
 * @module business/test-entry
 */

export { Business } from './business'

export default {
  async fetch(): Promise<Response> {
    return new Response('Business test worker')
  },
}

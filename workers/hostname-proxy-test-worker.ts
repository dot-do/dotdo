/**
 * Test Worker Entry for hostname-proxy integration tests
 *
 * This module exports the DO classes and provides a minimal worker for testing.
 * Used by vitest-pool-workers to instantiate the test environment.
 */

import { createProxyHandler, type ProxyConfig } from './hostname-proxy'
import type { CloudflareEnv } from '../types/CloudflareBindings'

// Export the Test Durable Object for miniflare
export { TestDurableObject } from '../api/test-do'

// Default worker entry - used when tests call SELF.fetch()
// This is a minimal proxy handler for testing
export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    // Default config for SELF.fetch() calls
    const config: ProxyConfig = {
      mode: 'hostname',
      hostname: { rootDomain: 'api.dotdo.dev' },
    }
    const handler = createProxyHandler(config)
    return handler(request, env)
  },
}

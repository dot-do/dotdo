/**
 * Test Worker Entry for proxy integration tests
 *
 * This module exports the DO classes and provides a minimal worker for testing.
 * Used by vitest-pool-workers to instantiate the test environment.
 */

import { createProxyHandler, type ProxyConfig } from './hostname-proxy'
import type { CloudflareEnv } from '../types/CloudflareBindings'

/**
 * Test Durable Object that echoes request info
 * Used to verify proxy routing behavior
 */
export class TestDurableObject implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    return Response.json({
      path: url.pathname,
      method: request.method,
      search: url.search,
    })
  }
}

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

/**
 * dotdo Worker - Proxies requests to the DO
 *
 * Routes all requests to the Durable Object which handles:
 * - GET / → JSON index with links to all collections
 * - POST / → Cap'n Web RPC
 * - WebSocket / → Cap'n Web RPC persistent connection
 * - GET /health → health check
 * - GET /$introspect → schema discovery
 * - GET /mcp → MCP transport
 * - GET /sync → WebSocket sync protocol
 * - REST routes /:type and /:type/:id for CRUD
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export Durable Object classes for wrangler
export { DurableObject } from 'cloudflare:workers'
export { Browser } from '../objects/Browser'
export { DO } from '../objects/DO'
export { ThingsDO } from '../objects/ThingsDO'
export { SandboxDO } from '../objects/SandboxDO'
export { ObservabilityBroadcaster } from '../objects/ObservabilityBroadcaster'

// Test DOs for development
export { TestDurableObject } from './test-do'
export { TestCollectionDO } from './test-collection-do'

export interface Env {
  DO: DurableObjectNamespace
  BASE_DO: DurableObjectNamespace
  BROWSER_DO: DurableObjectNamespace
  SANDBOX_DO: DurableObjectNamespace
  OBS_BROADCASTER: DurableObjectNamespace
  KV: KVNamespace
  TEST_KV: KVNamespace
  TEST_DO: DurableObjectNamespace
  COLLECTION_DO: DurableObjectNamespace
  AI: Ai
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

// Proxy all requests to the DO
// Namespace is derived from hostname: tenant.api.dotdo.dev → DO('tenant')
// Or use 'default' for local dev
app.all('*', async (c) => {
  const url = new URL(c.req.url)

  // Derive namespace from hostname
  // e.g., acme.api.dotdo.dev → 'acme'
  // localhost:8787 → 'default'
  const hostParts = url.hostname.split('.')
  const ns = hostParts.length > 2 ? hostParts[0] : 'default'

  // Get DO stub by namespace
  const id = c.env.BASE_DO.idFromName(ns)
  const stub = c.env.BASE_DO.get(id)

  // Forward request to DO
  const doUrl = new URL(c.req.url)
  doUrl.hostname = `${ns}.do.internal`

  return stub.fetch(new Request(doUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  }))
})

export default app

/**
 * Minimal Path-based Proxy Worker
 *
 * Routes requests to Durable Objects based on the first path segment (namespace).
 * All business logic lives in the DO - this worker only handles routing.
 *
 * Routes:
 * - /{ns}                    -> DO(ns).fetch('/')
 * - /{ns}/{path}             -> DO(ns).fetch('/{path}')
 * - /{ns}/rpc                -> DO(ns).fetch('/rpc')
 * - /{ns}/mcp                -> DO(ns).fetch('/mcp')
 * - /{ns}/sync               -> DO(ns).fetch('/sync') [WebSocket]
 * - /{ns}/{collection}/      -> DO(ns).fetch('/{collection}/')
 * - /{ns}/{collection}/{id}  -> DO(ns).fetch('/{collection}/{id}')
 *
 * This is a convenience wrapper around hostname-proxy with mode: 'path'.
 * For more control (hostname routing, basepath stripping, etc.), use
 * createProxyHandler from hostname-proxy directly.
 *
 * @module workers/proxy
 * @see workers/hostname-proxy for the full configurable implementation
 */

import { createProxyHandler } from './hostname-proxy'
export { createProxyHandler, type ProxyConfig } from './hostname-proxy'

/**
 * Path-based proxy handler
 * Extracts namespace from first path segment: /{ns}/... -> DO(ns)
 */
const pathProxyHandler = createProxyHandler({ mode: 'path' })

export default {
  fetch: pathProxyHandler,
}

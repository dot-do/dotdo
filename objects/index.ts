/**
 * Objects Layer Exports - Main Entry Point
 *
 * This module exports all DO classes required by wrangler.toml bindings.
 * This is the main entry point specified in wrangler.toml.
 *
 * @module objects
 */

// Export all DO classes for wrangler bindings
export { DOCore, type DOCoreEnv } from '../core/DOCore'
export { DOSemantic } from '../semantic/DOSemantic'
export { DOStorageClass } from '../storage/DOStorage'
export { DOWorkflowClass } from '../workflow/DOWorkflow'
export { DOFull, type DOFullEnv } from './DOFull'
export { McpServer } from '../mcp/server'
export { AdminDO, type AdminDOEnv } from '../examples/admin.example.org.ai/index'

// Default worker handler
import { DOFull, type DOFullEnv } from './DOFull'
import { AdminDO, type AdminDOEnv } from '../examples/admin.example.org.ai/index'

// Combined environment type with all DO bindings
interface WorkerEnv extends DOFullEnv, AdminDOEnv {}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url)

    // Check for Host header routing (e.g., admin.example.org.ai)
    const hostHeader = request.headers.get('Host') ?? url.hostname

    // Route to AdminDO if:
    // 1. Host header indicates admin endpoint
    // 2. URL path starts with /admin/ (path-based routing for e2e tests)
    const isAdminHost = hostHeader.startsWith('admin.') || hostHeader.includes('admin.example.com.ai')
    const isAdminPath = url.pathname.startsWith('/admin/')

    if (isAdminHost || isAdminPath) {
      const id = env.AdminDO.idFromName('admin')
      const stub = env.AdminDO.get(id)

      // If using path-based routing, strip the /admin prefix
      if (isAdminPath && !isAdminHost) {
        const newUrl = new URL(request.url)
        newUrl.pathname = url.pathname.replace('/admin', '')
        const newRequest = new Request(newUrl.toString(), request)
        return stub.fetch(newRequest)
      }

      return stub.fetch(request)
    }

    // Default routing based on subdomain
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOFull.idFromName(ns)
    const stub = env.DOFull.get(id)

    return stub.fetch(request)
  },
}

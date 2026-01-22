/**
 * example.com.ai - Parent DO Example
 *
 * This module demonstrates a hierarchical DO architecture where:
 * - Parent DO (example.com.ai) aggregates events from children
 * - Child DOs (crm.example.com.ai/:tenant) phone home to parent
 *
 * @module examples/example.com.ai
 */

// Export the main ParentDO class
export { ParentDO } from './ParentDO'

// Export types
export type {
  ParentDOEvent,
  R2BufferConfig,
  GlobalQueryOptions,
  ChildDOInfo,
  ParentContext,
  R2FlushResult,
  R2BufferStats,
  EventHandler,
  OnProxy,
  NounEventProxy,
  R2Proxy,
  QueryProxy,
  ChildrenProxy,
  ParentWorkflowContext,
} from './ParentDO'

// Export child context utilities
export {
  ChildContextManager,
  createChildContext,
} from './child-context'

export type { ChildContext, ChildEmitEvent } from './child-context'

// Export component managers for direct use
export { R2BufferManager, createR2Proxy } from './r2-buffer'
export { ChildrenManager, createChildrenProxy } from './children-manager'
export { QueryManager, createQueryProxy } from './query-manager'

/**
 * Cloudflare Worker entry point
 *
 * The worker routes requests to the appropriate DO based on hostname:
 * - example.com.ai → ParentDO
 * - *.example.com.ai/:tenant → Child DO (routes to parent)
 */
export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')

    // Determine if this is a parent or child request
    // example.com.ai → parent
    // crm.example.com.ai → child

    const PARENT_DO = env.PARENT_DO as DurableObjectNamespace | undefined

    if (!PARENT_DO) {
      return new Response('PARENT_DO binding not configured', { status: 500 })
    }

    // For the parent domain, route to parent DO
    if (hostParts.length <= 3) {
      const id = PARENT_DO.idFromName('parent')
      const stub = PARENT_DO.get(id)
      return stub.fetch(request)
    }

    // For child domains (e.g., crm.example.com.ai), still route to parent
    // but include the child subdomain info
    const childSubdomain = hostParts[0]
    const id = PARENT_DO.idFromName('parent')
    const stub = PARENT_DO.get(id)

    // Add child info to headers
    const modifiedRequest = new Request(request, {
      headers: {
        ...Object.fromEntries(request.headers),
        'X-Child-Domain': childSubdomain,
      }
    })

    return stub.fetch(modifiedRequest)
  }
}

// Scheduled Jobs Example Worker Entrypoint
// Routes requests to scheduler Durable Objects

import { SchedulerDO } from './SchedulerDO'

export { SchedulerDO }

interface Env {
  SCHEDULER: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract namespace from hostname or path
    // Format: {namespace}.scheduler.example.com or /namespace/{namespaceId}/...
    let namespaceId = 'default'

    // Check for namespace in subdomain
    const hostParts = url.hostname.split('.')
    if (hostParts.length > 2) {
      namespaceId = hostParts[0]
    }

    // Check for namespace in path
    const namespaceMatch = url.pathname.match(/^\/namespace\/([^/]+)/)
    if (namespaceMatch) {
      namespaceId = namespaceMatch[1]
      // Rewrite URL to remove /namespace/{namespaceId} prefix
      url.pathname = url.pathname.replace(/^\/namespace\/[^/]+/, '') || '/'
    }

    // Get or create Durable Object for this namespace
    // Each namespace has isolated job scheduling
    const id = env.SCHEDULER.idFromName(namespaceId)
    const stub = env.SCHEDULER.get(id)

    // Forward request to the DO
    const doUrl = new URL(url.pathname + url.search, request.url)
    return stub.fetch(new Request(doUrl, request))
  },
}

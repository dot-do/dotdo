// Real-time Collaboration Example Worker Entrypoint
// Routes requests to document-specific Durable Objects

import { CollaborationDO } from './CollaborationDO'

export { CollaborationDO }

interface Env {
  COLLABORATION: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract workspace from path or use default
    // Format: /workspace/{workspaceId}/... or just /...
    let workspaceId = 'default'

    const workspaceMatch = url.pathname.match(/^\/workspace\/([^/]+)/)
    if (workspaceMatch) {
      const matchedId = workspaceMatch[1]
      if (matchedId) {
        workspaceId = matchedId
      }
      // Rewrite URL to remove /workspace/{workspaceId} prefix
      url.pathname = url.pathname.replace(/^\/workspace\/[^/]+/, '') || '/'
    }

    // Get or create Durable Object for this workspace
    // Each workspace has its own collaborative space
    const id = env.COLLABORATION.idFromName(workspaceId)
    const stub = env.COLLABORATION.get(id)

    // Forward request to the DO
    const doUrl = new URL(url.pathname + url.search, request.url)
    return stub.fetch(new Request(doUrl, request))
  },
}

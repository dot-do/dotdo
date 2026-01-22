// REST CRUD Example Worker Entrypoint
// Routes requests to workspace-specific Durable Objects

import { TasksDO } from './TasksDO'

export { TasksDO }

interface Env {
  TASKS: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract workspace ID from hostname or path
    // Format: {workspace}.tasks.example.com or /workspace/{workspaceId}/...
    let workspaceId = 'default'

    // Check for workspace in subdomain
    const hostParts = url.hostname.split('.')
    if (hostParts.length > 2) {
      workspaceId = hostParts[0]
    }

    // Check for workspace in path
    const workspaceMatch = url.pathname.match(/^\/workspace\/([^/]+)/)
    if (workspaceMatch) {
      workspaceId = workspaceMatch[1]
      // Rewrite URL to remove /workspace/{workspaceId} prefix
      url.pathname = url.pathname.replace(/^\/workspace\/[^/]+/, '') || '/'
    }

    // Get or create Durable Object for this workspace
    const id = env.TASKS.idFromName(workspaceId)
    const stub = env.TASKS.get(id)

    // Forward request to the DO
    const doUrl = new URL(url.pathname + url.search, request.url)
    return stub.fetch(new Request(doUrl, request))
  },
}

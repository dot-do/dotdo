// Primitive Git Ops Example Worker Entrypoint
// Routes requests to the GitOpsDO

import { GitOpsDO } from './GitOpsDO'

export { GitOpsDO }

interface Env {
  GITOPS: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract repo name from hostname or use default
    // Format: {repo}.gitops.example.com
    let repoName = 'default'

    const hostParts = url.hostname.split('.')
    if (hostParts.length > 2) {
      repoName = hostParts[0]
    }

    // Get or create Durable Object for this repo
    const id = env.GITOPS.idFromName(repoName)
    const stub = env.GITOPS.get(id)

    // Forward request to the DO
    return stub.fetch(request)
  },
}

// AI Agent Example Worker Entrypoint
// Routes requests to user-specific agent instances

import { AgentDO } from './AgentDO'

export { AgentDO }

interface Env {
  AGENT: DurableObjectNamespace
  AI?: Ai
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract agent/user ID from path
    // Format: /agent/{agentId}/... or /user/{userId}/...
    let agentId = 'default'

    // Check for agent ID in path
    const agentMatch = url.pathname.match(/^\/(agent|user)\/([^/]+)/)
    if (agentMatch) {
      const matchedId = agentMatch[2]
      if (matchedId) {
        agentId = matchedId
      }
      // Rewrite URL to remove /(agent|user)/{id} prefix
      url.pathname = url.pathname.replace(/^\/(agent|user)\/[^/]+/, '') || '/'
    }

    // Check for user ID in query params
    const userIdParam = url.searchParams.get('userId')
    if (userIdParam && agentId === 'default') {
      agentId = userIdParam
    }

    // Get or create Durable Object for this agent/user
    const id = env.AGENT.idFromName(agentId)
    const stub = env.AGENT.get(id)

    // Forward request to the DO
    const doUrl = new URL(url.pathname + url.search, request.url)
    return stub.fetch(new Request(doUrl, request))
  },
}

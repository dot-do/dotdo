// WebSocket Chat Example Worker Entrypoint
// Routes requests to chat room Durable Objects

import { ChatDO } from './ChatDO'

export { ChatDO }

interface Env {
  CHAT: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract server/namespace from hostname or path
    // Format: {server}.chat.example.com or /server/{serverId}/...
    let serverId = 'default'

    // Check for server in subdomain
    const hostParts = url.hostname.split('.')
    if (hostParts.length > 2) {
      serverId = hostParts[0]
    }

    // Check for server in path
    const serverMatch = url.pathname.match(/^\/server\/([^/]+)/)
    if (serverMatch) {
      serverId = serverMatch[1]
      // Rewrite URL to remove /server/{serverId} prefix
      url.pathname = url.pathname.replace(/^\/server\/[^/]+/, '') || '/'
    }

    // Get or create Durable Object for this chat server
    // Each server has multiple rooms but shares participant state
    const id = env.CHAT.idFromName(serverId)
    const stub = env.CHAT.get(id)

    // Forward request to the DO
    const doUrl = new URL(url.pathname + url.search, request.url)
    return stub.fetch(new Request(doUrl, request))
  },
}

/**
 * Observability Dashboard Worker
 *
 * Routes requests to either:
 * - Static frontend assets (TanStack Start)
 * - EventStreamDO for real-time event streaming
 *
 * This demonstrates the unified events system with:
 * - WebSocket connections to EventStreamDO
 * - HTTP endpoints for event queries
 * - Stats and metrics endpoints
 */

import { EventStreamDO } from 'dotdo/streaming/event-stream-do'

// Re-export for Wrangler binding
export { EventStreamDO }

interface Env {
  EVENT_STREAM: DurableObjectNamespace
  ENVIRONMENT: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // API routes - proxy to EventStreamDO
    if (path.startsWith('/api/')) {
      return handleApiRoute(request, env, path.slice(4))
    }

    // Health check
    if (path === '/health') {
      return Response.json({ status: 'ok', timestamp: new Date().toISOString() })
    }

    // For non-API routes, return a simple HTML response
    // In production, this would be handled by TanStack Start's build output
    return new Response(getHtmlShell(), {
      headers: { 'Content-Type': 'text/html' },
    })
  },
}

/**
 * Handle API routes by proxying to EventStreamDO
 */
async function handleApiRoute(request: Request, env: Env, path: string): Promise<Response> {
  // Get the EventStreamDO instance (use a single instance for this example)
  const id = env.EVENT_STREAM.idFromName('default')
  const stub = env.EVENT_STREAM.get(id)

  // Rewrite the URL to the DO's internal path
  const url = new URL(request.url)
  url.pathname = path

  // Forward the request to the DO
  return stub.fetch(new Request(url.toString(), request))
}

/**
 * Simple HTML shell for development
 * In production, TanStack Start would handle this
 */
function getHtmlShell(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Observability Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 { color: #58a6ff; margin-bottom: 1rem; }
    p { color: #8b949e; margin-bottom: 2rem; }
    .links { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    a {
      color: #c9d1d9;
      text-decoration: none;
      padding: 0.75rem 1.5rem;
      background: #21262d;
      border-radius: 6px;
      border: 1px solid #30363d;
      transition: background 0.15s;
    }
    a:hover { background: #30363d; }
    .code {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 1.5rem;
      margin-top: 2rem;
      text-align: left;
      font-family: monospace;
      font-size: 0.875rem;
      overflow-x: auto;
    }
    .code pre { white-space: pre-wrap; }
    .comment { color: #8b949e; }
    .keyword { color: #ff7b72; }
    .string { color: #a5d6ff; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Observability Dashboard</h1>
    <p>Real-time event streaming with unified events</p>

    <div class="links">
      <a href="/api/stats">View Stats</a>
      <a href="/health">Health Check</a>
    </div>

    <div class="code">
      <pre><span class="comment">// Send a unified event</span>
<span class="keyword">await</span> fetch(<span class="string">'/api/broadcast'</span>, {
  method: <span class="string">'POST'</span>,
  headers: { <span class="string">'Content-Type'</span>: <span class="string">'application/json'</span> },
  body: JSON.stringify({
    id: crypto.randomUUID(),
    event_type: <span class="string">'trace'</span>,
    event_name: <span class="string">'http.request'</span>,
    ns: <span class="string">'https://api.example.com'</span>,
    service_name: <span class="string">'api-gateway'</span>,
    duration_ms: 42,
    outcome: <span class="string">'success'</span>
  })
})</pre>
    </div>

    <div class="code">
      <pre><span class="comment">// Connect to event stream via WebSocket</span>
<span class="keyword">const</span> ws = <span class="keyword">new</span> WebSocket(<span class="string">'wss://your-worker.workers.dev/api/events?topic=*'</span>)
ws.onmessage = (event) => {
  console.log(<span class="string">'Event:'</span>, JSON.parse(event.data))
}</pre>
    </div>
  </div>
</body>
</html>`
}

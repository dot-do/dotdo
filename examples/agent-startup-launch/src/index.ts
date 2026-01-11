/**
 * Agent Startup Launch - Worker Entry Point
 *
 * Routes requests to the StartupLaunchDO Durable Object where
 * 6 AI agents orchestrate the complete startup launch lifecycle.
 *
 * @see https://platform.do
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the DO class for Cloudflare
export { StartupLaunchDO } from './StartupLaunchDO'

// Environment bindings
interface Env {
  STARTUP_LAUNCH_DO: DurableObjectNamespace
  AI: Ai
}

const app = new Hono<{ Bindings: Env }>()

// Enable CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Landing page
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Startup Launch</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #10b981; --muted: #71717a; --code: #1f1f1f; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.7; max-width: 900px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 2.5rem; }
    h2 { color: var(--fg); margin-top: 3rem; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    .tagline { color: var(--muted); font-size: 1.25rem; margin-bottom: 2rem; }
    code { background: var(--code); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: var(--code); padding: 1.5rem; border-radius: 8px; overflow-x: auto; border: 1px solid #333; }
    pre code { padding: 0; background: none; }
    .agents { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .agent { background: var(--code); padding: 1rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .agent h3 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .agent p { margin: 0; color: var(--muted); font-size: 0.9rem; }
    .endpoints { display: grid; gap: 1rem; margin: 2rem 0; }
    .endpoint { background: var(--code); padding: 1rem; border-radius: 8px; }
    .endpoint h4 { margin: 0 0 0.5rem 0; color: var(--accent); font-family: monospace; }
    .endpoint p { margin: 0; color: var(--muted); }
    .try-it { display: inline-block; margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--accent); color: #0a0a0a; text-decoration: none; border-radius: 4px; font-size: 0.875rem; font-weight: 500; }
    a { color: var(--accent); }
    footer { margin-top: 4rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem; text-align: center; }
    .phase { display: inline-block; padding: 0.25rem 0.5rem; background: #333; border-radius: 4px; font-size: 0.75rem; margin-right: 0.5rem; }
  </style>
</head>
<body>
  <h1>Agent Startup Launch</h1>
  <p class="tagline">From hypothesis to revenue in one file.</p>

  <pre><code>import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally, quinn } from 'agents.do'
import { ceo, legal } from 'humans.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = priya\`define the MVP for \${this.hypothesis}\`
    let app = ralph\`build \${spec}\`

    do {
      app = ralph\`improve \${app} per \${tom}\`
    } while (!await tom.approve(app))

    await quinn\`test \${app} thoroughly\`
    await legal\`review for compliance\`
    await ceo\`approve the launch\`

    mark\`announce the launch\`
    sally\`start selling\`

    // Your business is running. Go back to bed.
  }
}</code></pre>

  <p>You just launched a startup. It took 47 lines of code.</p>

  <hr style="border: none; border-top: 1px solid #333; margin: 3rem 0;">

  <h2>How It Works</h2>

  <p>This example demonstrates <strong>Business-as-Code</strong>: your entire startup launch process defined in TypeScript, executed by AI agents, with human oversight for critical decisions.</p>

  <p>The launch workflow progresses through phases:</p>
  <p>
    <span class="phase">Hypothesis</span>
    <span class="phase">Specification</span>
    <span class="phase">Development</span>
    <span class="phase">Review</span>
    <span class="phase">QA</span>
    <span class="phase">Legal</span>
    <span class="phase">CEO Approval</span>
    <span class="phase">Marketing</span>
    <span class="phase">Sales</span>
    <span class="phase">Launched!</span>
  </p>

  <p>Key patterns demonstrated:</p>
  <ul>
    <li><strong>Promise pipelining</strong> - Multiple agent calls in one network round trip</li>
    <li><strong>do/while refinement</strong> - Iterate until Tom approves</li>
    <li><strong>Human escalation</strong> - Legal and CEO approval gates</li>
    <li><strong>Event handlers</strong> - React to Customer.signup, Payment.failed, etc.</li>
    <li><strong>Scheduled jobs</strong> - Daily standups, weekly retros, monthly investor updates</li>
  </ul>

  <h2>The Team</h2>

  <div class="agents">
    <div class="agent">
      <h3>Priya</h3>
      <p>Product - specs, roadmaps, MVPs. She defines what to build and why.</p>
    </div>
    <div class="agent">
      <h3>Ralph</h3>
      <p>Engineering - builds code. He implements features from specifications.</p>
    </div>
    <div class="agent">
      <h3>Tom</h3>
      <p>Tech Lead - architecture, review. He ensures quality and approves merges.</p>
    </div>
    <div class="agent">
      <h3>Quinn</h3>
      <p>QA - testing, quality. She finds bugs before users do.</p>
    </div>
    <div class="agent">
      <h3>Mark</h3>
      <p>Marketing - content, launches. He announces and promotes.</p>
    </div>
    <div class="agent">
      <h3>Sally</h3>
      <p>Sales - outreach, closing. She turns leads into customers.</p>
    </div>
  </div>

  <h2>API Endpoints</h2>

  <div class="endpoints">
    <div class="endpoint">
      <h4>POST /api/launch</h4>
      <p>Start a new startup launch with your hypothesis</p>
      <pre style="margin-top: 0.5rem; font-size: 0.85rem;"><code>{
  "customer": "Freelance developers",
  "problem": "Tax season takes 20+ hours",
  "solution": "AI-powered tax automation",
  "differentiator": "AI does 95%, CPA reviews edge cases"
}</code></pre>
    </div>

    <div class="endpoint">
      <h4>GET /api/state</h4>
      <p>Get current launch state (phase, iterations, events, metrics)</p>
      <a href="/api/state" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h4>GET /api/metrics</h4>
      <p>Get business metrics (signups, MRR, customers, churn)</p>
      <a href="/api/metrics" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h4>GET /api/events</h4>
      <p>Get event history for the launch</p>
      <a href="/api/events" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h4>POST /api/emit</h4>
      <p>Emit a business event (triggers handlers)</p>
      <pre style="margin-top: 0.5rem; font-size: 0.85rem;"><code>{ "event": "Customer.signup", "data": { "email": "alice@example.com", "plan": "pro" } }</code></pre>
    </div>
  </div>

  <h2>Running This Example</h2>

  <pre><code># Clone and navigate
cd examples/agent-startup-launch

# Install dependencies
npm install

# Start development server
npm run dev

# In another terminal, start a launch
curl -X POST http://localhost:8787/api/launch \\
  -H "Content-Type: application/json" \\
  -d '{"customer": "Freelance developers", "problem": "Tax season takes 20+ hours", "solution": "AI-powered tax automation", "differentiator": "AI does 95%, CPA reviews edge cases"}'

# Watch the launch progress
curl http://localhost:8787/api/state</code></pre>

  <footer>
    <p><a href="https://platform.do">platform.do</a> - MIT License</p>
  </footer>
</body>
</html>
  `)
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper to get DO stub
// ─────────────────────────────────────────────────────────────────────────────

function getDO(c: { env: Env }): DurableObjectStub {
  const id = c.env.STARTUP_LAUNCH_DO.idFromName('default')
  return c.env.STARTUP_LAUNCH_DO.get(id)
}

async function callDO(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<Response> {
  const response = await stub.fetch('https://startup/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: args }),
  })

  const result = await response.json() as { result?: unknown; error?: { message: string } }

  if (result.error) {
    return Response.json({ error: result.error.message }, { status: 400 })
  }

  return Response.json(result.result)
}

// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────

// Launch a startup
app.post('/api/launch', async (c) => {
  const hypothesis = await c.req.json()
  const stub = getDO(c)
  return callDO(stub, 'launch', [hypothesis])
})

// Get current state
app.get('/api/state', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getState')
})

// Get metrics
app.get('/api/metrics', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getMetrics')
})

// Get events
app.get('/api/events', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getEvents')
})

// Emit an event
app.post('/api/emit', async (c) => {
  const { event, data } = await c.req.json()
  const stub = getDO(c)
  return callDO(stub, 'emit', [event, data])
})

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'agent-startup-launch' })
})

// Forward RPC requests
app.all('/rpc', async (c) => {
  const stub = getDO(c)
  return stub.fetch(c.req.raw)
})

export default app

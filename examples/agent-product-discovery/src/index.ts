/**
 * agent-product-discovery Worker Entry Point
 *
 * Routes requests to the ProductDiscoveryDO for AI-powered product discovery.
 * From idea to roadmap in minutes.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the ProductDiscoveryDO class for Cloudflare to instantiate
export { ProductDiscoveryDO } from './ProductDiscoveryDO'

// Define environment bindings
interface Env {
  DISCOVERY_DO: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for demo access
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
  <title>Product Discovery - From Idea to Roadmap</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #8b5cf6; --muted: #71717a; --success: #22c55e; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; max-width: 900px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.5rem; font-size: 2.5rem; }
    .tagline { font-size: 1.5rem; color: var(--fg); margin-bottom: 2rem; font-weight: 300; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; }
    code { background: #1f1f1f; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: #1f1f1f; padding: 1.5rem; border-radius: 8px; overflow-x: auto; font-size: 0.875rem; }
    .code-header { background: #2d2d2d; padding: 0.5rem 1rem; border-radius: 8px 8px 0 0; margin-bottom: -8px; font-size: 0.75rem; color: var(--muted); }
    .endpoints { display: grid; gap: 1rem; margin: 2rem 0; }
    .endpoint { background: #1f1f1f; padding: 1rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .endpoint h3 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .endpoint p { margin: 0; color: var(--muted); }
    a { color: var(--accent); }
    .try-it { display: inline-block; margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--accent); color: white; text-decoration: none; border-radius: 4px; font-size: 0.875rem; }
    .workflow { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.5rem; margin: 1.5rem 0; }
    .workflow-step { background: #1f1f1f; padding: 0.75rem; border-radius: 8px; text-align: center; }
    .workflow-step .number { font-size: 1.5rem; color: var(--accent); }
    .workflow-step .label { font-size: 0.875rem; color: var(--muted); }
    .agent-tag { display: inline-block; background: var(--accent); color: white; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.75rem; margin-left: 0.25rem; }
    .highlight { color: var(--success); }
    section { margin: 3rem 0; }
    h2 { color: var(--fg); border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>Product Discovery</h1>
  <p class="tagline"><strong>From idea to roadmap in minutes.</strong></p>
  <p class="subtitle">AI-powered product discovery with Priya (Product) and Quinn (QA)</p>

  <div class="code-header">discovery.ts</div>
  <pre><code>import { priya, quinn } from 'agents.do'

// Your coffee is still hot...
const hypothesis = 'Freelancers waste 20+ hours on taxes'

// Priya defines the MVP
const mvp = await priya\`define MVP for: \${hypothesis}\`

// Generate user stories with acceptance criteria
const stories = await priya\`break \${mvp} into user stories\`

// Prioritize by impact
const prioritized = await priya\`prioritize \${stories} by impact\`

// Quinn validates specs are testable
const specs = prioritized.map(story =>
  priya\`write acceptance criteria for \${story}\`
)

const validated = specs.map(spec =>
  quinn\`validate \${spec} is testable\`
)

// Plan the quarter
const roadmap = await priya\`create quarterly roadmap from \${validated}\`

// ...and your coffee is STILL hot.</code></pre>

  <p class="highlight">You just planned your next quarter. Coffee's still hot.</p>

  <section>
    <h2>How it Works</h2>
    <div class="workflow">
      <div class="workflow-step">
        <div class="number">1</div>
        <div class="label">Hypothesis</div>
      </div>
      <div class="workflow-step">
        <div class="number">2</div>
        <div class="label">MVP <span class="agent-tag">Priya</span></div>
      </div>
      <div class="workflow-step">
        <div class="number">3</div>
        <div class="label">Stories <span class="agent-tag">Priya</span></div>
      </div>
      <div class="workflow-step">
        <div class="number">4</div>
        <div class="label">Prioritize <span class="agent-tag">Priya</span></div>
      </div>
      <div class="workflow-step">
        <div class="number">5</div>
        <div class="label">Validate <span class="agent-tag">Quinn</span></div>
      </div>
      <div class="workflow-step">
        <div class="number">6</div>
        <div class="label">Roadmap</div>
      </div>
    </div>
  </section>

  <section>
    <h2>API Endpoints</h2>
    <div class="endpoints">
      <div class="endpoint">
        <h3>POST /api/discover</h3>
        <p>Run complete discovery: hypothesis to roadmap</p>
        <code>{ "hypothesis": "Your idea", "mode": "tactical|strategic" }</code>
      </div>

      <div class="endpoint">
        <h3>POST /api/mvp</h3>
        <p>Define MVP from hypothesis</p>
        <code>{ "hypothesis": "Your idea" }</code>
      </div>

      <div class="endpoint">
        <h3>POST /api/stories</h3>
        <p>Generate user stories from MVP</p>
        <code>{ "mvpId": "mvp-xxx" }</code>
      </div>

      <div class="endpoint">
        <h3>POST /api/prioritize</h3>
        <p>Prioritize backlog with AI reasoning</p>
        <code>{ "mvpId": "mvp-xxx" }</code>
      </div>

      <div class="endpoint">
        <h3>POST /api/validate</h3>
        <p>Validate specs with Quinn</p>
        <code>{ "storyId": "story-xxx" }</code>
      </div>

      <div class="endpoint">
        <h3>POST /api/roadmap</h3>
        <p>Create quarterly roadmap</p>
        <code>{ "mvpId": "mvp-xxx", "year": 2026, "mode": "tactical" }</code>
      </div>

      <div class="endpoint">
        <h3>GET /api/mvps</h3>
        <p>List all MVPs</p>
        <a href="/api/mvps" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>GET /api/sessions/:id</h3>
        <p>Get discovery session details</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Planning Modes</h2>
    <div class="endpoints">
      <div class="endpoint">
        <h3>Tactical Mode</h3>
        <p>Focus on quick wins, user feedback loops, and iterative delivery. Best for validating hypotheses fast.</p>
      </div>
      <div class="endpoint">
        <h3>Strategic Mode</h3>
        <p>Focus on long-term vision, market positioning, and competitive advantage. Best for roadmap planning.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Running Locally</h2>
    <pre><code># Clone and install
git clone https://github.com/dotdo-dev/dotdo
cd examples/agent-product-discovery
npm install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start development server
npm run dev

# Open http://localhost:8787</code></pre>
  </section>

  <footer style="margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem;">
    <p>Powered by <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
  </footer>
</body>
</html>
  `)
})

// Helper to get DO stub
function getDO(c: { env: Env }, namespace = 'default'): DurableObjectStub {
  const id = c.env.DISCOVERY_DO.idFromName(namespace)
  return c.env.DISCOVERY_DO.get(id)
}

// Proxy RPC call to DO
async function callDO(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<Response> {
  const response = await stub.fetch('https://discovery.do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: args,
    }),
  })

  const result = await response.json() as { result?: unknown; error?: { message: string } }

  if (result.error) {
    return Response.json({ error: result.error.message }, { status: 400 })
  }

  return Response.json(result.result)
}

// ═══════════════════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// Complete discovery flow
app.post('/api/discover', async (c) => {
  const body = await c.req.json() as { hypothesis: string; mode?: 'tactical' | 'strategic' }
  if (!body.hypothesis) {
    return c.json({ error: 'hypothesis is required' }, 400)
  }
  const stub = getDO(c)
  return callDO(stub, 'runDiscovery', [body.hypothesis, body.mode || 'tactical'])
})

// Define MVP
app.post('/api/mvp', async (c) => {
  const body = await c.req.json() as { hypothesis: string; mode?: 'tactical' | 'strategic' }
  if (!body.hypothesis) {
    return c.json({ error: 'hypothesis is required' }, 400)
  }
  const stub = getDO(c)
  return callDO(stub, 'defineMVP', [body.hypothesis, body.mode || 'tactical'])
})

// Generate stories
app.post('/api/stories', async (c) => {
  const body = await c.req.json() as { mvpId: string }
  if (!body.mvpId) {
    return c.json({ error: 'mvpId is required' }, 400)
  }
  const stub = getDO(c)
  return callDO(stub, 'generateStories', [body.mvpId])
})

// Prioritize backlog
app.post('/api/prioritize', async (c) => {
  const body = await c.req.json() as { mvpId: string }
  if (!body.mvpId) {
    return c.json({ error: 'mvpId is required' }, 400)
  }
  const stub = getDO(c)
  return callDO(stub, 'prioritizeBacklog', [body.mvpId])
})

// Validate spec (single story)
app.post('/api/validate', async (c) => {
  const body = await c.req.json() as { storyId: string }
  if (!body.storyId) {
    return c.json({ error: 'storyId is required' }, 400)
  }
  const stub = getDO(c)
  return callDO(stub, 'validateSpec', [body.storyId])
})

// Validate all specs
app.post('/api/validate-all', async (c) => {
  const body = await c.req.json() as { mvpId: string }
  if (!body.mvpId) {
    return c.json({ error: 'mvpId is required' }, 400)
  }
  const stub = getDO(c)
  return callDO(stub, 'validateAllSpecs', [body.mvpId])
})

// Create roadmap
app.post('/api/roadmap', async (c) => {
  const body = await c.req.json() as { mvpId: string; year?: number; mode?: 'tactical' | 'strategic' }
  if (!body.mvpId) {
    return c.json({ error: 'mvpId is required' }, 400)
  }
  const stub = getDO(c)
  return callDO(stub, 'createRoadmap', [body.mvpId, body.year, body.mode])
})

// Get MVPs
app.get('/api/mvps', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getMVPs')
})

// Get MVP by ID
app.get('/api/mvps/:id', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getMVP', [c.req.param('id')])
})

// Get stories for MVP
app.get('/api/mvps/:id/stories', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getStories', [c.req.param('id')])
})

// Get session by ID
app.get('/api/sessions/:id', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getSession', [c.req.param('id')])
})

// Get story by ID
app.get('/api/stories/:id', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getStory', [c.req.param('id')])
})

// Get roadmap by ID
app.get('/api/roadmaps/:id', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getRoadmap', [c.req.param('id')])
})

// Forward RPC requests to DO
app.all('/rpc', async (c) => {
  const stub = getDO(c)
  return stub.fetch(c.req.raw)
})

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'agent-product-discovery' })
})

export default app

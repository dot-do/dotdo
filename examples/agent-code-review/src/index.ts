/**
 * Agent Code Review - Worker Entry Point
 *
 * AI-powered code review with Ralph (Engineering) and Tom (Tech Lead).
 * Routes requests to the CodeReviewDO Durable Object.
 *
 * @module agent-code-review
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the CodeReviewDO class for Cloudflare to instantiate
export { CodeReviewDO } from './CodeReviewDO'

// Types
import type { CodeSpec, ReviewSession, CodeArtifact, CodeReview } from './CodeReviewDO'

// Define environment bindings
interface Env {
  CODE_REVIEW_DO: DurableObjectNamespace
  AI: Ai
}

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for public access
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ============================================================================
// Landing Page
// ============================================================================

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Code Review - Ralph + Tom</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #10b981; --accent2: #6366f1; --muted: #71717a; --code-bg: #1f1f1f; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.8; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 2.5rem; margin-bottom: 0; }
    .tagline { font-size: 1.5rem; color: var(--accent); margin: 0.5rem 0 2rem 0; font-weight: 600; }
    .hero { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 2rem; border-radius: 12px; margin: 2rem 0; border: 1px solid #333; }
    .hero pre { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; overflow-x: auto; font-size: 0.9rem; line-height: 1.6; }
    .hero code { color: #e2e8f0; }
    .comment { color: #6b7280; }
    .keyword { color: #c084fc; }
    .string { color: #86efac; }
    .variable { color: #93c5fd; }
    .function { color: #fbbf24; }
    .result { margin-top: 1.5rem; padding: 1rem; background: rgba(16, 185, 129, 0.1); border-left: 4px solid var(--accent); border-radius: 4px; }
    .result-text { font-size: 1.25rem; font-weight: 600; color: var(--accent); }
    h2 { color: var(--accent2); margin-top: 3rem; }
    .flow { display: grid; gap: 1.5rem; margin: 2rem 0; }
    .step { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; display: flex; align-items: flex-start; gap: 1rem; }
    .step-num { background: var(--accent); color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
    .step-content h3 { margin: 0 0 0.5rem 0; color: var(--fg); }
    .step-content p { margin: 0; color: var(--muted); }
    .agents { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 2rem 0; }
    .agent { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; border-top: 3px solid; }
    .agent.ralph { border-color: var(--accent); }
    .agent.tom { border-color: var(--accent2); }
    .agent h3 { margin: 0 0 0.5rem 0; }
    .agent p { margin: 0; color: var(--muted); font-size: 0.9rem; }
    .endpoints { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; margin: 2rem 0; }
    .endpoint { padding: 0.75rem 0; border-bottom: 1px solid #333; }
    .endpoint:last-child { border-bottom: none; }
    .endpoint code { background: #2a2a2a; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.85rem; }
    .endpoint .method { color: var(--accent); font-weight: 600; margin-right: 0.5rem; }
    pre.install { background: var(--code-bg); padding: 1rem; border-radius: 8px; overflow-x: auto; }
    footer { margin-top: 4rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem; text-align: center; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <h1>Agent Code Review</h1>
  <p class="tagline">AI-powered code review that actually helps.</p>

  <div class="hero">
    <pre><code><span class="comment">// Ralph generates code. Tom reviews. Repeat until perfect.</span>
<span class="keyword">const</span> <span class="variable">spec</span> = priya<span class="string">\`create user authentication flow\`</span>
<span class="keyword">let</span> <span class="variable">code</span> = <span class="keyword">await</span> ralph<span class="string">\`implement \${spec}\`</span>

<span class="keyword">let</span> <span class="variable">review</span> = <span class="keyword">await</span> tom<span class="string">\`review \${code}\`</span>
<span class="keyword">while</span> (!review.<span class="function">approved</span>) {
  <span class="variable">code</span> = <span class="keyword">await</span> ralph<span class="string">\`address feedback: \${review.comments}\`</span>
  <span class="variable">review</span> = <span class="keyword">await</span> tom<span class="string">\`review \${code}\`</span>
}

<span class="keyword">await</span> $.<span class="function">git.commit</span>(<span class="variable">code</span>, <span class="variable">review</span>.<span class="function">summary</span>)</code></pre>
    <div class="result">
      <span class="result-text">Your code just got better. 23 seconds.</span>
    </div>
  </div>

  <h2>How It Works</h2>
  <div class="flow">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-content">
        <h3>Specify</h3>
        <p>Describe what you want to build with requirements and constraints. The clearer the spec, the better the code.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-content">
        <h3>Generate</h3>
        <p>Ralph generates production-ready TypeScript with proper types, error handling, and documentation.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-content">
        <h3>Review</h3>
        <p>Tom reviews for architecture, security, performance, style, and correctness. Line-level feedback with suggestions.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-content">
        <h3>Refine</h3>
        <p>Ralph addresses all feedback automatically. The loop continues until Tom approves or max iterations reached.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">5</div>
      <div class="step-content">
        <h3>Ship</h3>
        <p>Auto-generated PR description and commit message. Ready for human review or direct merge.</p>
      </div>
    </div>
  </div>

  <h2>The Agents</h2>
  <div class="agents">
    <div class="agent ralph">
      <h3>Ralph - Engineering</h3>
      <p>Senior software engineer. Generates clean, production-ready code. Addresses feedback precisely. Never argues, just improves.</p>
    </div>
    <div class="agent tom">
      <h3>Tom - Tech Lead</h3>
      <p>Technical architect. Reviews for quality, security, and correctness. Provides actionable feedback. Approves only when ready.</p>
    </div>
  </div>

  <h2>API Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint">
      <span class="method">POST</span><code>/api/review</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Start a new code review session with a specification</p>
    </div>
    <div class="endpoint">
      <span class="method">GET</span><code>/api/sessions</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">List all review sessions</p>
    </div>
    <div class="endpoint">
      <span class="method">GET</span><code>/api/sessions/:id</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Get a specific review session with all artifacts and reviews</p>
    </div>
    <div class="endpoint">
      <span class="method">GET</span><code>/api/demo</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Run a demo review session with sample spec</p>
    </div>
  </div>

  <h2>Try It</h2>
  <pre class="install"><code># Start a review session
curl -X POST https://agent-code-review.workers.dev/api/review \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Add User Authentication",
    "description": "Implement JWT-based authentication",
    "requirements": [
      "Support email/password login",
      "Generate and validate JWT tokens",
      "Include refresh token mechanism"
    ]
  }'</code></pre>

  <footer>
    <p>Part of <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
    <p>Powered by Ralph + Tom from <a href="https://agents.do">agents.do</a></p>
  </footer>
</body>
</html>
  `)
})

// ============================================================================
// Helper Functions
// ============================================================================

function getDO(c: { env: Env }): DurableObjectStub {
  const id = c.env.CODE_REVIEW_DO.idFromName('main')
  return c.env.CODE_REVIEW_DO.get(id)
}

async function callDO(
  stub: DurableObjectStub,
  method: string,
  args: unknown[] = []
): Promise<Response> {
  const response = await stub.fetch('https://internal/rpc', {
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

// ============================================================================
// API Routes
// ============================================================================

// Start a new review session
app.post('/api/review', async (c) => {
  const body = await c.req.json() as {
    title: string
    description: string
    requirements: string[]
    constraints?: string[]
    examples?: string[]
    maxIterations?: number
  }

  const spec: CodeSpec = {
    id: `spec-${Date.now().toString(36)}`,
    title: body.title,
    description: body.description,
    requirements: body.requirements,
    constraints: body.constraints,
    examples: body.examples,
  }

  const stub = getDO(c)
  return callDO(stub, 'startReviewSession', [spec, { maxIterations: body.maxIterations }])
})

// List all sessions
app.get('/api/sessions', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'listSessions')
})

// Get a specific session
app.get('/api/sessions/:id', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getSession', [c.req.param('id')])
})

// Demo endpoint - run a sample review
app.get('/api/demo', async (c) => {
  const demoSpec: CodeSpec = {
    id: `demo-${Date.now().toString(36)}`,
    title: 'User Authentication Service',
    description: 'A service for handling user authentication with JWT tokens',
    requirements: [
      'Validate email format and password strength',
      'Generate JWT access tokens with 15-minute expiry',
      'Include refresh token mechanism with 7-day expiry',
      'Hash passwords using bcrypt',
      'Return appropriate error messages for invalid credentials',
    ],
    constraints: [
      'Use TypeScript with strict mode',
      'No external dependencies except bcrypt and jsonwebtoken',
      'Include JSDoc documentation',
    ],
  }

  const stub = getDO(c)
  return callDO(stub, 'startReviewSession', [demoSpec, { maxIterations: 3 }])
})

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'agent-code-review' })
})

// Forward RPC requests to DO
app.all('/rpc', async (c) => {
  const stub = getDO(c)
  return stub.fetch(c.req.raw)
})

export default app

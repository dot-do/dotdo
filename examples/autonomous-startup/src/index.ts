/**
 * Autonomous Startup Example - Entry Point
 *
 * Demonstrates the complete Business-as-Code pattern from CLAUDE.md:
 * ```typescript
 * export class MyStartup extends Startup {
 *   async launch() {
 *     const spec = priya`define the MVP for ${this.hypothesis}`
 *     let app = ralph`build ${spec}`
 *
 *     do {
 *       app = ralph`improve ${app} per ${tom}`
 *     } while (!await tom.approve(app))
 *
 *     mark`announce the launch`
 *     sally`start selling`
 *   }
 * }
 * ```
 *
 * @see https://platform.do
 * @module examples/autonomous-startup
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Export the DO class for Cloudflare
export { AutonomousStartup } from './AutonomousStartup'

// Re-export types
export type {
  Hypothesis,
  ProductSpec,
  Application,
  CodeReview,
  QAResult,
  LaunchMaterials,
  SalesStrategy,
  LaunchPhase,
  StartupState,
} from './AutonomousStartup'

// Re-export schemas
export {
  HypothesisSchema,
  ProductSpecSchema,
  ApplicationSchema,
  CodeReviewSchema,
  QAResultSchema,
  LaunchMaterialsSchema,
  SalesStrategySchema,
} from './AutonomousStartup'

// ============================================================================
// Environment Bindings
// ============================================================================

interface Env {
  AUTONOMOUS_STARTUP_DO: DurableObjectNamespace
  AI?: Ai
}

// ============================================================================
// HTTP API
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Landing page with documentation
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autonomous Startup Example</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #10b981; --muted: #71717a; --code: #1f1f1f; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.7; max-width: 900px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 2.5rem; }
    h2 { color: var(--fg); margin-top: 3rem; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    .tagline { color: var(--muted); font-size: 1.25rem; margin-bottom: 2rem; }
    code { background: var(--code); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: var(--code); padding: 1.5rem; border-radius: 8px; overflow-x: auto; border: 1px solid #333; }
    pre code { padding: 0; background: none; }
    .feature { background: var(--code); padding: 1rem; border-radius: 8px; margin: 0.5rem 0; border-left: 3px solid var(--accent); }
    .feature h3 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .feature p { margin: 0; color: var(--muted); }
    a { color: var(--accent); }
    footer { margin-top: 4rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem; text-align: center; }
  </style>
</head>
<body>
  <h1>Autonomous Startup</h1>
  <p class="tagline">Build your 1-Person Unicorn with Business-as-Code.</p>

  <pre><code>import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally } from 'agents.do'
import { ceo, legal } from 'humans.do'

export class MyStartup extends Startup {
  async launch() {
    // Priya defines the MVP
    const spec = await priya.as(SpecSchema)\`define the MVP for \${this.hypothesis}\`

    // Ralph builds it
    let app = await ralph.as(AppSchema)\`build \${spec.content}\`

    // Tom reviews in a loop until approved
    do {
      const review = await tom.as(ReviewSchema)\`review \${app.content}\`
      if (!review.content.approved) {
        app = await ralph.as(AppSchema)\`improve \${app} per \${review}\`
      }
    } while (!review.content.approved)

    // Human approvals
    await legal\`review for compliance\`.timeout('4 hours')
    await ceo\`approve the launch\`.timeout('24 hours')

    // Launch!
    mark\`announce the launch\`
    sally\`start selling\`
  }
}
</code></pre>

  <h2>Features Demonstrated</h2>

  <div class="feature">
    <h3>Typed Agent Results (agent.as(Schema))</h3>
    <p>Get structured, validated outputs from AI agents using Zod schemas.</p>
  </div>

  <div class="feature">
    <h3>Do/While Review Loop</h3>
    <p>Iterate development with Tom's code reviews until approval.</p>
  </div>

  <div class="feature">
    <h3>Human Escalation (humans.do)</h3>
    <p>Await human approval for critical decisions with timeout and channel routing.</p>
  </div>

  <div class="feature">
    <h3>Event Handlers ($.on.Noun.verb)</h3>
    <p>React to business events like Customer.signup and Payment.failed.</p>
  </div>

  <div class="feature">
    <h3>Scheduling ($.every)</h3>
    <p>Schedule recurring tasks with natural language: every.Monday.at9am</p>
  </div>

  <h2>API Endpoints</h2>

  <div class="feature">
    <h3>POST /api/launch</h3>
    <p>Start a new startup launch with your hypothesis</p>
  </div>

  <div class="feature">
    <h3>GET /api/state</h3>
    <p>Get current launch state</p>
  </div>

  <div class="feature">
    <h3>GET /api/metrics</h3>
    <p>Get business metrics (signups, MRR, customers, churn)</p>
  </div>

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
  const id = c.env.AUTONOMOUS_STARTUP_DO.idFromName('default')
  return c.env.AUTONOMOUS_STARTUP_DO.get(id)
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
  const body = await c.req.json()
  const stub = getDO(c)

  const options = {
    maxIterations: body.maxIterations ?? 5,
    skipHumanApproval: body.skipHumanApproval ?? true, // Default skip for API
    mockMode: body.mockMode ?? true, // Default mock for API
  }

  return callDO(stub, 'launch', [body.hypothesis, options])
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

// Get errors
app.get('/api/errors', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getErrors')
})

// Emit an event
app.post('/api/emit', async (c) => {
  const { event, data } = await c.req.json()
  const stub = getDO(c)
  return callDO(stub, 'emit', [event, data])
})

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'autonomous-startup' })
})

// Forward RPC requests
app.all('/rpc', async (c) => {
  const stub = getDO(c)
  return stub.fetch(c.req.raw)
})

export default app

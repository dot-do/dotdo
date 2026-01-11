/**
 * primitive-multi-tools Worker Entry Point
 *
 * Git + Shell + Files. One isolate. Zero infrastructure.
 *
 * Complete DevOps environment inside a Durable Object:
 * - Clone repos, modify files, run builds
 * - Commit changes, push to remote
 * - Deploy with blue-green strategy
 * - Rollback in milliseconds
 *
 * All in a single V8 isolate. No VMs. No containers. No cold starts.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the DO classes for Cloudflare to instantiate
export { DevOpsDO } from './DevOpsDO'
export { DevWorkspaceDO } from './DevWorkspaceDO'

// ============================================================================
// ENVIRONMENT BINDINGS
// ============================================================================

interface Env {
  DEVOPS_DO: DurableObjectNamespace
  R2_BUCKET: R2Bucket
  GITHUB_TOKEN?: string
  NPM_TOKEN?: string
  DEPLOY_KEY?: string
  ENVIRONMENT: string
}

// ============================================================================
// HTTP API
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for API access
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ============================================================================
// LANDING PAGE
// ============================================================================

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>primitive-multi-tools | Git + Shell + Files</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #10b981; --muted: #71717a; --code-bg: #1a1a2e; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.7; max-width: 900px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.5rem; font-size: 2.5rem; }
    .tagline { font-size: 1.5rem; color: var(--muted); margin-bottom: 2rem; }
    .hero-stat { display: flex; gap: 2rem; margin: 2rem 0; }
    .stat { text-align: center; padding: 1.5rem; background: var(--code-bg); border-radius: 12px; flex: 1; }
    .stat-value { font-size: 2rem; font-weight: bold; color: var(--accent); }
    .stat-label { color: var(--muted); font-size: 0.9rem; }
    code { background: var(--code-bg); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: var(--code-bg); padding: 1.5rem; border-radius: 12px; overflow-x: auto; border: 1px solid #333; }
    pre code { background: none; padding: 0; }
    .keyword { color: #c792ea; }
    .function { color: #82aaff; }
    .string { color: #c3e88d; }
    .comment { color: #676e95; }
    .endpoints { display: grid; gap: 1rem; margin: 2rem 0; }
    .endpoint { background: var(--code-bg); padding: 1.25rem; border-radius: 12px; border-left: 4px solid var(--accent); }
    .endpoint h3 { margin: 0 0 0.5rem 0; color: var(--accent); font-family: monospace; }
    .endpoint p { margin: 0; color: var(--muted); }
    .primitives { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .primitive { background: var(--code-bg); padding: 1.25rem; border-radius: 12px; }
    .primitive h4 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .primitive p { margin: 0; color: var(--muted); font-size: 0.9rem; }
    a { color: var(--accent); }
    footer { margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>primitive-multi-tools</h1>
  <p class="tagline">Git + Shell + Files. One isolate. Zero infrastructure.</p>

  <div class="hero-stat">
    <div class="stat">
      <div class="stat-value">3s</div>
      <div class="stat-label">Clone. Build. Deploy.</div>
    </div>
    <div class="stat">
      <div class="stat-value">$0.001</div>
      <div class="stat-label">Per deployment</div>
    </div>
    <div class="stat">
      <div class="stat-value">0ms</div>
      <div class="stat-label">Cold starts</div>
    </div>
  </div>

  <h2>The Complete CI/CD Pipeline</h2>
  <pre><code><span class="keyword">import</span> { DOWithPrimitives } <span class="keyword">from</span> <span class="string">'dotdo/presets'</span>

<span class="keyword">export class</span> <span class="function">DevOpsDO</span> <span class="keyword">extends</span> DOWithPrimitives {
  <span class="keyword">async</span> <span class="function">deployWithHotfix</span>(issueId: string, fix: string) {
    <span class="comment">// 1. Clone repo</span>
    <span class="keyword">await</span> <span class="keyword">this</span>.$.git.<span class="function">sync</span>()

    <span class="comment">// 2. Apply fix</span>
    <span class="keyword">const</span> file = <span class="keyword">await</span> <span class="keyword">this</span>.<span class="function">findFileForIssue</span>(issueId)
    <span class="keyword">const</span> content = <span class="keyword">await</span> <span class="keyword">this</span>.$.fs.<span class="function">read</span>(file)
    <span class="keyword">await</span> <span class="keyword">this</span>.$.fs.<span class="function">write</span>(file, <span class="function">applyFix</span>(content, fix))

    <span class="comment">// 3. Build and test</span>
    <span class="keyword">await</span> <span class="keyword">this</span>.$.bash\`npm install\`
    <span class="keyword">const</span> test = <span class="keyword">await</span> <span class="keyword">this</span>.$.bash\`npm test\`
    <span class="keyword">if</span> (test.exitCode !== 0) <span class="keyword">throw new</span> Error(<span class="string">'Tests failed'</span>)

    <span class="comment">// 4. Commit and push</span>
    <span class="keyword">await</span> <span class="keyword">this</span>.$.git.<span class="function">add</span>(<span class="string">'.'</span>)
    <span class="keyword">await</span> <span class="keyword">this</span>.$.git.<span class="function">commit</span>(\`fix(\${issueId}): \${fix}\`)
    <span class="keyword">await</span> <span class="keyword">this</span>.$.git.<span class="function">push</span>()

    <span class="comment">// 5. Deploy</span>
    <span class="keyword">await</span> <span class="keyword">this</span>.$.bash\`npm run deploy:production\`

    <span class="keyword">return</span> { deployed: <span class="keyword">true</span>, commit: <span class="keyword">await</span> <span class="keyword">this</span>.$.git.binding.commit }
  }
}</code></pre>

  <h2>Extended Primitives</h2>
  <div class="primitives">
    <div class="primitive">
      <h4>$.fs</h4>
      <p>SQLite-backed filesystem with R2 tiering. Read, write, list, mkdir - all persistent.</p>
    </div>
    <div class="primitive">
      <h4>$.git</h4>
      <p>Full git implementation. Clone, commit, push, sync. R2 object storage.</p>
    </div>
    <div class="primitive">
      <h4>$.bash</h4>
      <p>Safe shell execution with command analysis. Native fs ops are Tier 1 fast.</p>
    </div>
    <div class="primitive">
      <h4>$.npm</h4>
      <p>Package management. Install, update, run scripts. Registry resolution.</p>
    </div>
  </div>

  <h2>API Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint">
      <h3>POST /api/initialize</h3>
      <p>Initialize DevOps environment with repo configuration</p>
    </div>
    <div class="endpoint">
      <h3>POST /api/hotfix</h3>
      <p>Deploy a hotfix: find file, apply fix, test, commit, push, deploy</p>
    </div>
    <div class="endpoint">
      <h3>POST /api/deploy</h3>
      <p>Blue-green deployment with zero downtime</p>
    </div>
    <div class="endpoint">
      <h3>POST /api/rollback</h3>
      <p>Instant rollback to previous deployment slot</p>
    </div>
    <div class="endpoint">
      <h3>POST /api/build</h3>
      <p>Run complete build pipeline: install, lint, typecheck, build</p>
    </div>
    <div class="endpoint">
      <h3>GET /api/status</h3>
      <p>Current git status, deployment slots, and audit log</p>
    </div>
  </div>

  <h2>Why This Matters</h2>
  <p>
    Traditional CI/CD requires VMs, containers, cold starts, and complex infrastructure.
    With dotdo primitives, your entire DevOps pipeline runs in a single V8 isolate -
    the same technology that powers Chrome's JavaScript engine.
  </p>
  <p>
    <strong>No VMs.</strong> No container orchestration. No cold starts.
    Just code running at the edge in 300+ cities worldwide.
  </p>

  <footer>
    <p>Powered by <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
    <p>Part of the extended primitives: <a href="/fsx">fsx</a> | <a href="/gitx">gitx</a> | <a href="/bashx">bashx</a> | <a href="/npmx">npmx</a></p>
  </footer>
</body>
</html>
  `)
})

// ============================================================================
// HELPER: Get DO stub
// ============================================================================

function getDO(c: { env: Env }, namespace: string = 'default'): DurableObjectStub {
  const id = c.env.DEVOPS_DO.idFromName(namespace)
  return c.env.DEVOPS_DO.get(id)
}

// ============================================================================
// API ROUTES
// ============================================================================

// Initialize DevOps environment
app.post('/api/initialize', async (c) => {
  try {
    const body = await c.req.json() as { repo: string; branch?: string; namespace?: string }
    const stub = getDO(c, body.namespace)

    const response = await stub.fetch('https://internal/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: [{ repo: body.repo, branch: body.branch }],
      }),
    })

    const result = await response.json()
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
})

// Deploy hotfix
app.post('/api/hotfix', async (c) => {
  try {
    const body = await c.req.json() as { issueId: string; fix: string; namespace?: string }
    const stub = getDO(c, body.namespace)

    const response = await stub.fetch('https://internal/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deployWithHotfix',
        params: [body.issueId, body.fix],
      }),
    })

    const result = await response.json()
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
})

// Blue-green deploy
app.post('/api/deploy', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { namespace?: string }
    const stub = getDO(c, body.namespace)

    const response = await stub.fetch('https://internal/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'deployBlueGreen',
        params: [],
      }),
    })

    const result = await response.json()
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
})

// Rollback
app.post('/api/rollback', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { namespace?: string }
    const stub = getDO(c, body.namespace)

    const response = await stub.fetch('https://internal/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'rollback',
        params: [],
      }),
    })

    const result = await response.json()
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
})

// Build
app.post('/api/build', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { namespace?: string }
    const stub = getDO(c, body.namespace)

    const response = await stub.fetch('https://internal/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'build',
        params: [],
      }),
    })

    const result = await response.json()
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
})

// Update dependencies
app.post('/api/update-deps', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({})) as { namespace?: string }
    const stub = getDO(c, body.namespace)

    const response = await stub.fetch('https://internal/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'updateDependencies',
        params: [],
      }),
    })

    const result = await response.json()
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
})

// Get status
app.get('/api/status', async (c) => {
  try {
    const namespace = c.req.query('namespace') || 'default'
    const stub = getDO(c, namespace)

    const response = await stub.fetch('https://internal/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getStatus',
        params: [],
      }),
    })

    const result = await response.json()
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 500)
  }
})

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'primitive-multi-tools',
    primitives: ['fs', 'git', 'bash', 'npm'],
  })
})

export default app

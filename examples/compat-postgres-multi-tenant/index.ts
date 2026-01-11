/**
 * Multi-Tenant Postgres/Supabase Replacement
 *
 * Drop-in replacement for Supabase/Postgres with automatic multi-tenant isolation.
 * Each tenant gets a dedicated Durable Object with SQLite storage.
 *
 * Features:
 * - Supabase SDK compatibility (same API, same queries)
 * - Physical tenant isolation (no RLS policies needed)
 * - Connection pooling not needed (each tenant has isolated state)
 * - PostgREST-compatible REST API
 * - Row-Level Security patterns
 *
 * Routing:
 * - Path: /tenant/:tenantId/* -> DO(tenantId)
 * - Subdomain: acme.api.example.com -> DO(acme)
 *
 * @example
 * ```bash
 * # Seed data for tenant
 * curl -X POST http://localhost:8787/tenant/acme/seed
 *
 * # Query data
 * curl http://localhost:8787/tenant/acme/users
 * curl http://localhost:8787/tenant/acme/stats
 *
 * # PostgREST-style queries
 * curl "http://localhost:8787/tenant/acme/rest/v1/tasks?status=eq.in_progress"
 * ```
 */

import { Hono } from 'hono'
import { restAPI, type Env } from './api/rest'

// Re-export the TenantDB class for Cloudflare to register
export { TenantDB } from './objects/TenantDB'

// ============================================================================
// MAIN APP
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Mount the REST API
app.route('/', restAPI)

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
  <title>Multi-Tenant Postgres - dotdo</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #10b981; --muted: #71717a; --code-bg: #1f1f1f; --warning: #f59e0b; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.7; max-width: 1000px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 2.5rem; }
    .tagline { font-size: 1.5rem; color: var(--fg); margin-bottom: 2rem; font-weight: 300; }
    .highlight { color: var(--accent); }
    code { background: var(--code-bg); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; overflow-x: auto; line-height: 1.5; }
    pre code { background: none; padding: 0; }
    .section { margin: 3rem 0; }
    .section h2 { color: var(--accent); border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin: 1.5rem 0; }
    .card { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .card h3 { margin: 0 0 0.5rem 0; color: var(--fg); }
    .card p { margin: 0; color: var(--muted); font-size: 0.95rem; }
    .endpoints { display: grid; gap: 0.75rem; margin: 1.5rem 0; }
    .endpoint { background: var(--code-bg); padding: 1rem 1.5rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
    .endpoint-method { color: var(--accent); font-weight: bold; min-width: 60px; }
    .endpoint-path { color: var(--fg); flex: 1; font-family: monospace; }
    .endpoint-desc { color: var(--muted); font-size: 0.85rem; }
    .try-btn { background: var(--accent); color: white; padding: 0.4rem 0.8rem; border-radius: 4px; text-decoration: none; font-size: 0.85rem; }
    .try-btn:hover { opacity: 0.9; }
    a { color: var(--accent); }
    .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin: 2rem 0; }
    .comparison > div { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; }
    .comparison h4 { margin: 0 0 1rem 0; color: var(--muted); font-size: 0.9rem; text-transform: uppercase; }
    @media (max-width: 768px) { .comparison { grid-template-columns: 1fr; } }
    .strikethrough { text-decoration: line-through; opacity: 0.5; }
    footer { margin-top: 4rem; padding-top: 2rem; border-top: 1px solid #333; color: var(--muted); }
    .badge { background: var(--accent); color: white; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; text-transform: uppercase; margin-left: 0.5rem; }
    .warning { background: rgba(245, 158, 11, 0.1); border-left: 3px solid var(--warning); padding: 1rem; border-radius: 4px; margin: 1rem 0; }
    .warning-title { color: var(--warning); font-weight: bold; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <h1>@dotdo/postgres</h1>
  <p class="tagline"><strong>Your Supabase code. Now scales to millions.</strong></p>

  <div class="section">
    <p>
      Same API. Same queries. <span class="highlight">Unlimited tenants.</span>
    </p>
    <p>
      Drop-in replacement for <code>@supabase/supabase-js</code> backed by Durable Objects.
      Each tenant gets a dedicated SQLite database with automatic isolation.
      No connection limits. No RLS policy bugs. No cold starts.
    </p>
  </div>

  <div class="section">
    <h2>Key Features</h2>
    <div class="grid">
      <div class="card">
        <h3>Physical Isolation</h3>
        <p>Each tenant gets a dedicated DO with SQLite. Data can't leak between tenants by design.</p>
      </div>
      <div class="card">
        <h3>RLS Patterns</h3>
        <p>Row-Level Security policies work just like Postgres, but are impossible to misconfigure.</p>
      </div>
      <div class="card">
        <h3>No Connection Limits</h3>
        <p>Postgres maxes at ~10K connections. DOs have no shared state - unlimited scale.</p>
      </div>
      <div class="card">
        <h3>Edge Latency</h3>
        <p>DOs run in 300+ cities. Your data is at the edge, not in a central database.</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>The Migration</h2>
    <div class="comparison">
      <div>
        <h4>Before (Supabase)</h4>
        <pre><code>import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Hope RLS policies are correct...
const { data } = await supabase
  .from('users')
  .select('*, orders(*)')
  .eq('tenant_id', tenantId)</code></pre>
      </div>
      <div>
        <h4>After (dotdo)</h4>
        <pre><code>import { createClient } from '@dotdo/supabase'

// Context injected via DO
const supabase = createClient(this.ctx, tenantId)


// Tenant isolation is physical, not logical
const { data } = await supabase
  .from('users')
  .select('*, orders(*)')
  <span class="strikethrough">.eq('tenant_id', tenantId)</span></code></pre>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Try It</h2>
    <div class="endpoints">
      <div class="endpoint">
        <span class="endpoint-method">POST</span>
        <span class="endpoint-path">/tenant/acme/seed</span>
        <span class="endpoint-desc">Seed demo data</span>
        <a href="/tenant/acme/seed" class="try-btn">Seed</a>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/tenant/acme/stats</span>
        <span class="endpoint-desc">Dashboard statistics</span>
        <a href="/tenant/acme/stats" class="try-btn">Try</a>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/tenant/acme/users</span>
        <span class="endpoint-desc">List users</span>
        <a href="/tenant/acme/users" class="try-btn">Try</a>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/tenant/acme/projects</span>
        <span class="endpoint-desc">List projects</span>
        <a href="/tenant/acme/projects" class="try-btn">Try</a>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/tenant/acme/tasks</span>
        <span class="endpoint-desc">List tasks</span>
        <a href="/tenant/acme/tasks" class="try-btn">Try</a>
      </div>
      <div class="endpoint">
        <span class="endpoint-method">GET</span>
        <span class="endpoint-path">/tenant/acme/pool</span>
        <span class="endpoint-desc">Connection pool stats</span>
        <a href="/tenant/acme/pool" class="try-btn">Try</a>
      </div>
    </div>
    <p style="color: var(--muted); font-size: 0.9rem;">
      Try different tenant IDs: <code>acme</code>, <code>globex</code>, <code>initech</code> - each is completely isolated.
    </p>
  </div>

  <div class="section">
    <h2>PostgREST-Compatible API</h2>
    <pre><code># Select with filters
curl "/tenant/acme/rest/v1/tasks?status=eq.in_progress&priority=eq.high"

# Insert
curl -X POST "/tenant/acme/rest/v1/users" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "new@example.com", "name": "New User", "role": "member"}'

# Update
curl -X PATCH "/tenant/acme/rest/v1/tasks?id=eq.task-123" \\
  -H "Content-Type: application/json" \\
  -d '{"status": "done"}'

# Delete
curl -X DELETE "/tenant/acme/rest/v1/users?id=eq.user-456"</code></pre>
  </div>

  <div class="section">
    <h2>RLS Policy Example</h2>
    <pre><code>// In TenantDB.ts - policies are defined in code, not SQL
this.supabase.addPolicy({
  name: 'users_own_profile',
  table: 'users',
  operation: 'SELECT',
  check: (row, ctx) => row.tenant_id === ctx.tenantId,
  using: (row, ctx) => {
    // Admins can see all users, others only themselves
    if (ctx.role === 'admin') return row.tenant_id === ctx.tenantId
    return row.id === ctx.userId
  },
})

// Policies are enforced automatically on all queries
const { data } = await supabase.from('users').select('*')
// Returns only rows the current user can see</code></pre>
  </div>

  <div class="section">
    <h2>Running Locally</h2>
    <pre><code># Clone and install
git clone https://github.com/drivly/dotdo
cd dotdo/examples/compat-postgres-multi-tenant
npm install

# Start dev server
npm run dev

# In another terminal
curl -X POST http://localhost:8787/tenant/acme/seed
curl http://localhost:8787/tenant/acme/stats</code></pre>
  </div>

  <div class="section">
    <h2>Architecture</h2>
    <pre><code>
Request with Tenant ID
         |
         v
+-------------------+
|    Hono Router    |  Extracts tenant from path/header/subdomain
+-------------------+
         |
         | env.TENANT_DO.idFromName(tenantId)
         v
+-------------------+
|    TenantDB DO    |  Isolated instance per tenant
|   (Durable Object)|
+-------------------+
         |
         | SQLite storage (ctx.storage)
         v
+-------------------+
|  Tenant's Data    |  Physically isolated
|   (SQLite DB)     |  No cross-tenant access possible
+-------------------+
    </code></pre>
  </div>

  <footer>
    <p>Part of <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
    <p>
      <a href="https://github.com/drivly/dotdo">GitHub</a> |
      <a href="https://dotdo.dev/docs/compat">38 Compat SDKs</a> |
      <a href="/tenant/acme/stats">Demo API</a>
    </p>
  </footer>
</body>
</html>
  `)
})

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'compat-postgres-multi-tenant',
    environment: c.env.ENVIRONMENT ?? 'unknown',
    timestamp: new Date().toISOString(),
  })
})

// ============================================================================
// API DOCUMENTATION
// ============================================================================

app.get('/api', (c) => {
  return c.json({
    name: 'compat-postgres-multi-tenant',
    description: 'Multi-tenant Postgres/Supabase replacement on Durable Objects',
    version: '1.0.0',
    endpoints: {
      // PostgREST-compatible
      'GET /tenant/:id/rest/v1/:table': 'Query table with PostgREST-style filters',
      'POST /tenant/:id/rest/v1/:table': 'Insert rows',
      'PATCH /tenant/:id/rest/v1/:table': 'Update rows',
      'DELETE /tenant/:id/rest/v1/:table': 'Delete rows',

      // Convenience endpoints
      'POST /tenant/:id/seed': 'Seed demo data',
      'GET /tenant/:id/stats': 'Dashboard statistics',
      'GET /tenant/:id/pool': 'Connection pool stats',
      'GET /tenant/:id/users': 'List users',
      'POST /tenant/:id/users': 'Create user',
      'GET /tenant/:id/users/:userId': 'Get user with relations',
      'PATCH /tenant/:id/users/:userId': 'Update user',
      'DELETE /tenant/:id/users/:userId': 'Delete user',
      'GET /tenant/:id/teams': 'List teams',
      'POST /tenant/:id/teams': 'Create team',
      'GET /tenant/:id/projects': 'List projects',
      'POST /tenant/:id/projects': 'Create project',
      'POST /tenant/:id/projects/:projectId/archive': 'Archive project',
      'GET /tenant/:id/tasks': 'List tasks (with filters)',
      'POST /tenant/:id/tasks': 'Create task',
      'PATCH /tenant/:id/tasks/:taskId/status': 'Update task status',
      'PATCH /tenant/:id/tasks/bulk': 'Bulk update tasks',
      'GET /tenant/:id/audit': 'Audit logs',
      'POST /tenant/:id/rpc/:function': 'Call RPC function',
    },
    documentation: 'https://github.com/drivly/dotdo/tree/main/examples/compat-postgres-multi-tenant',
  })
})

export default app

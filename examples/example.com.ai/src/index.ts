/**
 * example.com.ai Worker Entry Point
 *
 * Routes requests to the ExampleDO Durable Object for live demo.
 * All documentation examples at example.com.ai are runnable here.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the ExampleDO class for Cloudflare to instantiate
export { ExampleDO } from './ExampleDO'

// Define environment bindings
interface Env {
  EXAMPLE_DO: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for public demo access
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
  <title>example.com.ai - Live Demo</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #3b82f6; --muted: #71717a; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; }
    h1 { color: var(--accent); margin-bottom: 0.5rem; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; }
    code { background: #1f1f1f; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: #1f1f1f; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .endpoints { display: grid; gap: 1rem; margin: 2rem 0; }
    .endpoint { background: #1f1f1f; padding: 1rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .endpoint h3 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .endpoint p { margin: 0; color: var(--muted); }
    a { color: var(--accent); }
    .try-it { display: inline-block; margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--accent); color: white; text-decoration: none; border-radius: 4px; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>example.com.ai</h1>
  <p class="subtitle">Live Demo Durable Object for dotdo documentation</p>

  <p>All code examples in the dotdo documentation are runnable here. Try the endpoints below!</p>

  <div class="endpoints">
    <div class="endpoint">
      <h3>GET /api/stats</h3>
      <p>Dashboard statistics - customers, orders, revenue</p>
      <a href="/api/stats" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h3>GET /api/customers</h3>
      <p>List all demo customers (alice, bob, jane...)</p>
      <a href="/api/customers" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h3>GET /api/customers/:id</h3>
      <p>Get customer by ID</p>
      <a href="/api/customers/alice" class="try-it">Try: /api/customers/alice</a>
    </div>

    <div class="endpoint">
      <h3>GET /api/orders</h3>
      <p>List all demo orders</p>
      <a href="/api/orders" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h3>GET /api/orders/:id</h3>
      <p>Get order by ID</p>
      <a href="/api/orders/ord-123" class="try-it">Try: /api/orders/ord-123</a>
    </div>

    <div class="endpoint">
      <h3>GET /api/invoices</h3>
      <p>List all demo invoices</p>
      <a href="/api/invoices" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h3>GET /api/invoices/overdue</h3>
      <p>Get overdue invoices</p>
      <a href="/api/invoices/overdue" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h3>GET /api/products</h3>
      <p>List all demo products</p>
      <a href="/api/products" class="try-it">Try it</a>
    </div>

    <div class="endpoint">
      <h3>GET /api/inventory/:sku</h3>
      <p>Check inventory for a product SKU</p>
      <a href="/api/inventory/WIDGET-001" class="try-it">Try: /api/inventory/WIDGET-001</a>
    </div>
  </div>

  <h2>Cap'n Web RPC</h2>
  <p>You can also use the RPC endpoint for more advanced interactions:</p>
  <pre><code>// Using @dotdo/client
import { $Context } from '@dotdo/client'

const $ = $Context('https://example.com.ai')

// Get customer alice
const alice = await $.Customer('alice')

// Get dashboard stats
const stats = await $.getStats()

// Check inventory
const inventory = await $.checkInventory('WIDGET-001')</code></pre>

  <h2>Data Reset</h2>
  <p>Demo data is reset every hour to keep the examples fresh.</p>

  <footer style="margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem;">
    <p>Powered by <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
  </footer>
</body>
</html>
  `)
})

// Helper to get DO stub
function getDO(c: { env: Env }): DurableObjectStub {
  // Use a single namespace for the demo
  const id = c.env.EXAMPLE_DO.idFromName('demo')
  return c.env.EXAMPLE_DO.get(id)
}

// Proxy RPC call to DO
async function callDO(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<Response> {
  const response = await stub.fetch('https://example.com.ai/rpc', {
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

// API Routes
app.get('/api/stats', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getStats')
})

app.get('/api/customers', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'Customers')
})

app.get('/api/customers/:id', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'Customer', [c.req.param('id')])
})

app.get('/api/customers/:id/profile', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getProfile', [c.req.param('id')])
})

app.get('/api/orders', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'Orders')
})

app.get('/api/orders/:id', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'Order', [c.req.param('id')])
})

app.get('/api/invoices', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'Invoices')
})

app.get('/api/invoices/overdue', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getOverdueInvoices')
})

app.get('/api/products', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'Products')
})

app.get('/api/products/:sku', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'Product', [c.req.param('sku')])
})

app.get('/api/inventory/:sku', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'checkInventory', [c.req.param('sku')])
})

app.get('/api/expenses', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'Expenses')
})

app.get('/api/expenses/pending', async (c) => {
  const stub = getDO(c)
  return callDO(stub, 'getPendingExpenses')
})

// Forward all other requests to the DO
app.all('/rpc', async (c) => {
  const stub = getDO(c)
  return stub.fetch(c.req.raw)
})

app.all('/mcp', async (c) => {
  const stub = getDO(c)
  return stub.fetch(c.req.raw)
})

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'example.com.ai' })
})

export default app

/**
 * Error Handling Patterns Example
 *
 * Demonstrates robust error handling with dotdo:
 * - Custom error types with retry semantics
 * - $.try() - Single attempt with timeout
 * - $.do() - Durable execution with retries and exponential backoff
 * - Circuit breakers for failing dependencies
 * - Dead letter queues for failed events
 * - Error aggregation and compensation patterns
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Export DO classes
export { RetryDO } from './objects/RetryDO'
export { CircuitDO } from './objects/CircuitDO'
export { ErrorsDO } from './objects/ErrorsDO'

// Export error types
export * from './errors'

// ============================================================================
// ENVIRONMENT TYPES
// ============================================================================

interface Env {
  RETRY_DO: DurableObjectNamespace
  CIRCUIT_DO: DurableObjectNamespace
  ERRORS_DO: DurableObjectNamespace
}

// ============================================================================
// HONO APPLICATION
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// Helper to get DO stubs
function getRetryDO(env: Env): DurableObjectStub {
  return env.RETRY_DO.get(env.RETRY_DO.idFromName('main'))
}

function getCircuitDO(env: Env): DurableObjectStub {
  return env.CIRCUIT_DO.get(env.CIRCUIT_DO.idFromName('main'))
}

function getErrorsDO(env: Env): DurableObjectStub {
  return env.ERRORS_DO.get(env.ERRORS_DO.idFromName('main'))
}

// RPC helper
async function rpc(stub: DurableObjectStub, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await stub.fetch('http://internal/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params,
    }),
  })
  const result = await response.json() as { result?: unknown; error?: { message: string } }
  if (result.error) {
    throw new Error(result.error.message)
  }
  return result.result
}

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
  <title>Error Handling Patterns</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #ef4444; --success: #22c55e; --warning: #f59e0b; --muted: #71717a; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; }
    h1 { color: var(--accent); margin-bottom: 0.5rem; }
    h2 { color: var(--fg); margin-top: 2rem; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; font-size: 1.25rem; }
    code { background: #1f1f1f; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: #1f1f1f; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .endpoints { display: grid; gap: 1rem; margin: 2rem 0; }
    .endpoint { background: #1f1f1f; padding: 1rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .endpoint h3 { margin: 0 0 0.5rem 0; }
    .endpoint .method { color: var(--success); font-weight: bold; margin-right: 0.5rem; }
    .endpoint .path { color: var(--accent); }
    .endpoint p { margin: 0.5rem 0 0 0; color: var(--muted); }
    a { color: var(--accent); }
    .try-it { display: inline-block; margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--accent); color: white; text-decoration: none; border-radius: 4px; font-size: 0.875rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #333; }
    th { color: var(--muted); }
    .badge { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; }
    .badge-green { background: #166534; color: #86efac; }
    .badge-yellow { background: #854d0e; color: #fef08a; }
    .badge-red { background: #991b1b; color: #fecaca; }
  </style>
</head>
<body>
  <h1>Error Handling Patterns</h1>
  <p class="subtitle">Build resilient systems that handle failures gracefully.</p>

  <pre><code>// Custom error types
throw new RetryableError('Service unavailable', { retryAfterMs: 5000 })
throw new NonRetryableError('Invalid input')

// Three execution modes
$.send('Email.queued', payload)                    // Fire-and-forget
const result = await $.try('Cache.get', key)       // Single attempt
const tx = await $.do('Payment.charge', amount)    // Durable with retries</code></pre>

  <h2>Architecture</h2>
  <table>
    <tr><th>Component</th><th>Purpose</th></tr>
    <tr><td><code>RetryDO</code></td><td>Retry pattern with exponential backoff, retry budgets</td></tr>
    <tr><td><code>CircuitDO</code></td><td>Circuit breaker pattern, service isolation</td></tr>
    <tr><td><code>ErrorsDO</code></td><td>Dead letter queue, error aggregation, compensation</td></tr>
  </table>

  <h2>Retry Pattern Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/retry/stats</span></h3>
      <p>Get retry statistics for all operations</p>
      <a href="/retry/stats" class="try-it">View Stats</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/retry/budget</span></h3>
      <p>View retry budget status per operation type</p>
      <a href="/retry/budget" class="try-it">View Budget</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/retry/execute</span></h3>
      <p>Execute an operation with retry (body: { operationType, data, config? })</p>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/retry/try</span></h3>
      <p>Execute single attempt with timeout (body: { operation, data, timeout? })</p>
    </div>
  </div>

  <h2>Circuit Breaker Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/circuit/status</span></h3>
      <p>Get status of all circuit breakers</p>
      <a href="/circuit/status" class="try-it">View Status</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/circuit/health</span></h3>
      <p>Health check for all services</p>
      <a href="/circuit/health" class="try-it">Check Health</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/circuit/:service/configure</span></h3>
      <p>Configure circuit breaker for a service</p>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/circuit/:service/reset</span></h3>
      <p>Reset circuit breaker for a service</p>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/circuit/:service/trip</span></h3>
      <p>Force trip (open) circuit for testing</p>
    </div>
  </div>

  <h2>Error Tracking Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/errors/summary</span></h3>
      <p>Get error summary and top errors</p>
      <a href="/errors/summary" class="try-it">View Summary</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/errors/health</span></h3>
      <p>Overall error system health</p>
      <a href="/errors/health" class="try-it">Check Health</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/errors/metrics</span></h3>
      <p>Detailed error metrics</p>
      <a href="/errors/metrics" class="try-it">View Metrics</a>
    </div>
  </div>

  <h2>Dead Letter Queue Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/dlq/stats</span></h3>
      <p>Get DLQ statistics</p>
      <a href="/dlq/stats" class="try-it">View Stats</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/dlq/entries</span></h3>
      <p>List DLQ entries (query: status, event, limit)</p>
      <a href="/dlq/entries?status=pending&limit=10" class="try-it">View Pending</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/dlq/add</span></h3>
      <p>Add entry to DLQ (body: { event, source, data, error })</p>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/dlq/:id/replay</span></h3>
      <p>Replay a specific DLQ entry</p>
    </div>
    <div class="endpoint">
      <h3><span class="method">DELETE</span><span class="path">/dlq/:id</span></h3>
      <p>Remove a DLQ entry</p>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/dlq/purge</span></h3>
      <p>Purge resolved/exhausted entries (query: status)</p>
    </div>
  </div>

  <h2>Compensation Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint">
      <h3><span class="method">GET</span><span class="path">/compensation/pending</span></h3>
      <p>List pending compensations</p>
      <a href="/compensation/pending" class="try-it">View Pending</a>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/compensation/register</span></h3>
      <p>Register compensation (body: { operation, compensatingOperation, data })</p>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/compensation/:id/execute</span></h3>
      <p>Execute a pending compensation</p>
    </div>
    <div class="endpoint">
      <h3><span class="method">POST</span><span class="path">/compensation/rollback</span></h3>
      <p>Execute all pending compensations (saga rollback)</p>
    </div>
  </div>

  <h2>Execution Modes</h2>
  <table>
    <tr>
      <th>Mode</th>
      <th>Blocking</th>
      <th>Durable</th>
      <th>Retries</th>
      <th>Use Case</th>
    </tr>
    <tr>
      <td><code>$.send()</code></td>
      <td><span class="badge badge-red">No</span></td>
      <td><span class="badge badge-red">No</span></td>
      <td><span class="badge badge-red">No</span></td>
      <td>Notifications, analytics, fire-and-forget</td>
    </tr>
    <tr>
      <td><code>$.try()</code></td>
      <td><span class="badge badge-green">Yes</span></td>
      <td><span class="badge badge-red">No</span></td>
      <td><span class="badge badge-red">No</span></td>
      <td>Cache reads, quick checks, non-critical ops</td>
    </tr>
    <tr>
      <td><code>$.do()</code></td>
      <td><span class="badge badge-green">Yes</span></td>
      <td><span class="badge badge-green">Yes</span></td>
      <td><span class="badge badge-green">Yes</span></td>
      <td>Payments, critical operations, must-succeed</td>
    </tr>
  </table>

  <footer style="margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem;">
    <p>Built with <a href="https://dotdo.dev">dotdo</a> | Powered by <a href="https://workers.do">workers.do</a></p>
  </footer>
</body>
</html>
  `)
})

// ============================================================================
// RETRY ENDPOINTS
// ============================================================================

app.get('/retry/stats', async (c) => {
  try {
    const result = await rpc(getRetryDO(c.env), 'getRetryStats')
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.get('/retry/budget', async (c) => {
  try {
    const result = await rpc(getRetryDO(c.env), 'getRetryBudgetStatus')
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.post('/retry/execute', async (c) => {
  try {
    const { operationId, operationType, data, config } = await c.req.json()
    const id = operationId ?? `op:${crypto.randomUUID().slice(0, 8)}`
    const result = await rpc(getRetryDO(c.env), 'executeWithRetry', [id, operationType, data, config])
    return c.json({ operationId: id, result })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/retry/try', async (c) => {
  try {
    const { operation, data, timeout } = await c.req.json()
    const result = await rpc(getRetryDO(c.env), 'tryOnce', [operation, data, { timeout }])
    return c.json({ result })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/retry/reset', async (c) => {
  try {
    await rpc(getRetryDO(c.env), 'resetStats')
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

// ============================================================================
// CIRCUIT BREAKER ENDPOINTS
// ============================================================================

app.get('/circuit/status', async (c) => {
  try {
    const result = await rpc(getCircuitDO(c.env), 'getAllCircuitStatus')
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.get('/circuit/health', async (c) => {
  try {
    const result = await rpc(getCircuitDO(c.env), 'getHealthStatus')
    const health = result as { healthy: boolean }
    return c.json(result, health.healthy ? 200 : 503)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.get('/circuit/stats', async (c) => {
  try {
    const result = await rpc(getCircuitDO(c.env), 'getStats')
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.get('/circuit/:service/status', async (c) => {
  try {
    const service = c.req.param('service')
    const result = await rpc(getCircuitDO(c.env), 'getCircuitStatus', [service])
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/circuit/:service/configure', async (c) => {
  try {
    const service = c.req.param('service')
    const config = await c.req.json()
    await rpc(getCircuitDO(c.env), 'configureCircuit', [service, config])
    return c.json({ success: true, service, config })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/circuit/:service/reset', async (c) => {
  try {
    const service = c.req.param('service')
    await rpc(getCircuitDO(c.env), 'resetCircuit', [service])
    return c.json({ success: true, service })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/circuit/:service/trip', async (c) => {
  try {
    const service = c.req.param('service')
    await rpc(getCircuitDO(c.env), 'forceOpen', [service])
    return c.json({ success: true, service, state: 'open' })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/circuit/reset-all', async (c) => {
  try {
    await rpc(getCircuitDO(c.env), 'resetAllCircuits')
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

// ============================================================================
// ERROR TRACKING ENDPOINTS
// ============================================================================

app.get('/errors/summary', async (c) => {
  try {
    const result = await rpc(getErrorsDO(c.env), 'getErrorSummary')
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.get('/errors/health', async (c) => {
  try {
    const result = await rpc(getErrorsDO(c.env), 'getHealthStatus')
    const health = result as { healthy: boolean }
    return c.json(result, health.healthy ? 200 : 503)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.get('/errors/metrics', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') ?? '10')
    const result = await rpc(getErrorsDO(c.env), 'getErrorMetrics', [{ limit }])
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.post('/errors/reset', async (c) => {
  try {
    await rpc(getErrorsDO(c.env), 'resetErrorMetrics')
    return c.json({ success: true })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

// ============================================================================
// DEAD LETTER QUEUE ENDPOINTS
// ============================================================================

app.get('/dlq/stats', async (c) => {
  try {
    const result = await rpc(getErrorsDO(c.env), 'getDLQStats')
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.get('/dlq/entries', async (c) => {
  try {
    const status = c.req.query('status')
    const event = c.req.query('event')
    const limit = parseInt(c.req.query('limit') ?? '20')
    const result = await rpc(getErrorsDO(c.env), 'getDLQEntries', [{ status, event, limit }])
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.post('/dlq/add', async (c) => {
  try {
    const { event, source, data, error, errorCode, maxRetries, metadata } = await c.req.json()
    const result = await rpc(getErrorsDO(c.env), 'addToDeadLetter', [{
      event,
      source,
      data,
      error,
      errorCode,
      maxRetries,
      metadata,
    }])
    return c.json(result, 201)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/dlq/:id/replay', async (c) => {
  try {
    const id = c.req.param('id')
    const success = await rpc(getErrorsDO(c.env), 'replayEntry', [id])
    return c.json({ id, success })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.delete('/dlq/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const deleted = await rpc(getErrorsDO(c.env), 'removeDLQEntry', [id])
    return c.json({ id, deleted })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/dlq/purge', async (c) => {
  try {
    const status = c.req.query('status') as 'resolved' | 'exhausted' | undefined
    const purged = await rpc(getErrorsDO(c.env), 'purgeDLQ', [status])
    return c.json({ purged })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

// ============================================================================
// COMPENSATION ENDPOINTS
// ============================================================================

app.get('/compensation/pending', async (c) => {
  try {
    const result = await rpc(getErrorsDO(c.env), 'getPendingCompensations')
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

app.post('/compensation/register', async (c) => {
  try {
    const { operation, compensatingOperation, data } = await c.req.json()
    const id = await rpc(getErrorsDO(c.env), 'registerCompensation', [operation, compensatingOperation, data])
    return c.json({ id, operation, compensatingOperation }, 201)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/compensation/:id/execute', async (c) => {
  try {
    const id = c.req.param('id')
    const success = await rpc(getErrorsDO(c.env), 'executeCompensation', [id])
    return c.json({ id, success })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.delete('/compensation/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const cancelled = await rpc(getErrorsDO(c.env), 'cancelCompensation', [id])
    return c.json({ id, cancelled })
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

app.post('/compensation/rollback', async (c) => {
  try {
    const { operationPrefix } = await c.req.json().catch(() => ({}))
    const result = await rpc(getErrorsDO(c.env), 'executeAllCompensations', [operationPrefix])
    return c.json(result)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500)
  }
})

// ============================================================================
// COMBINED HEALTH CHECK
// ============================================================================

app.get('/health', async (c) => {
  try {
    const [retryStats, circuitHealth, errorHealth] = await Promise.all([
      rpc(getRetryDO(c.env), 'getRetryStats'),
      rpc(getCircuitDO(c.env), 'getHealthStatus'),
      rpc(getErrorsDO(c.env), 'getHealthStatus'),
    ])

    const circuit = circuitHealth as { healthy: boolean }
    const errors = errorHealth as { healthy: boolean }

    const healthy = circuit.healthy && errors.healthy

    return c.json({
      healthy,
      retry: retryStats,
      circuit: circuitHealth,
      errors: errorHealth,
      timestamp: new Date().toISOString(),
    }, healthy ? 200 : 503)
  } catch (e) {
    return c.json({ error: (e as Error).message, healthy: false }, 500)
  }
})

export default app

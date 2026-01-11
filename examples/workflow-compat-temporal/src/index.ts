/**
 * Temporal-Compatible Workflows on Durable Objects
 *
 * This example demonstrates how to run Temporal-compatible workflows
 * on dotdo's edge infrastructure. Same API, zero infrastructure.
 *
 * Key features demonstrated:
 * - Workflow definition with activities
 * - Signals and queries
 * - Durable timers (sleep)
 * - Human-in-the-loop approval
 * - Child workflows
 * - Activity retries and timeouts
 * - Workflow versioning (patched)
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Import Temporal-compatible APIs from dotdo
import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  sleep,
  condition,
  workflowInfo,
  uuid4,
  startChild,
  executeChild,
  patched,
  CancellationScope,
} from 'dotdo/workflows/compat/temporal'

// ============================================================================
// ACTIVITIES - External operations (I/O, API calls, etc.)
// ============================================================================

// Define activity interface
interface OrderActivities {
  validateOrder(orderId: string, items: OrderItem[]): Promise<ValidationResult>
  reserveInventory(orderId: string, items: OrderItem[]): Promise<ReservationResult>
  chargePayment(orderId: string, paymentInfo: PaymentInfo): Promise<PaymentResult>
  sendEmail(to: string, template: string, data: Record<string, unknown>): Promise<void>
  releaseInventory(orderId: string, reservationId: string): Promise<void>
  refundPayment(orderId: string, chargeId: string): Promise<void>
  notifyWarehouse(orderId: string, items: OrderItem[]): Promise<ShipmentInfo>
}

// Create activity proxies with retry configuration
const activities = proxyActivities<OrderActivities>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    nonRetryableErrorTypes: ['ValidationError', 'InsufficientFundsError'],
  },
})

// ============================================================================
// SIGNALS & QUERIES - Interact with running workflows
// ============================================================================

// Signals: Fire-and-forget messages to workflows
const approveSignal = defineSignal<[boolean, string?]>('approve')
const cancelSignal = defineSignal<[string]>('cancel')
const updateShippingSignal = defineSignal<[ShippingAddress]>('updateShipping')

// Queries: Read workflow state without mutation
const getStatusQuery = defineQuery<OrderStatus>('getStatus')
const getItemsQuery = defineQuery<OrderItem[]>('getItems')
const getApprovalInfoQuery = defineQuery<ApprovalInfo>('getApprovalInfo')

// ============================================================================
// MAIN WORKFLOW - Order processing with human approval
// ============================================================================

/**
 * Order Workflow - Full lifecycle management
 *
 * Demonstrates:
 * - Activity execution with retries
 * - Signal handlers for human interaction
 * - Query handlers for status checks
 * - Durable timers for approval timeout
 * - Cancellation scopes for cleanup
 * - Versioning for safe migrations
 */
export async function orderWorkflow(input: OrderInput): Promise<OrderResult> {
  const info = workflowInfo()
  const orderId = uuid4() // Deterministic UUID for replay

  // Workflow state
  let status: OrderStatus = 'pending'
  let items = input.items
  let approvalDecision: { approved: boolean; reason?: string } | null = null
  let reservationId: string | null = null
  let chargeId: string | null = null
  let shipmentInfo: ShipmentInfo | null = null
  let shippingAddress = input.shippingAddress

  // Register signal handlers
  setHandler(approveSignal, (approved, reason) => {
    approvalDecision = { approved, reason }
  })

  setHandler(cancelSignal, (reason) => {
    approvalDecision = { approved: false, reason }
    status = 'cancelled'
  })

  setHandler(updateShippingSignal, (newAddress) => {
    if (status === 'pending' || status === 'approved') {
      shippingAddress = newAddress
    }
  })

  // Register query handlers
  setHandler(getStatusQuery, () => status)
  setHandler(getItemsQuery, () => items)
  setHandler(getApprovalInfoQuery, () => ({
    status,
    decision: approvalDecision,
    requiresApproval: input.totalAmount > 1000,
    timeoutAt: input.totalAmount > 1000
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : null,
  }))

  try {
    // Step 1: Validate order
    const validation = await activities.validateOrder(orderId, items)
    if (!validation.valid) {
      status = 'failed'
      return { orderId, status, error: validation.error }
    }

    // Step 2: Reserve inventory
    const reservation = await activities.reserveInventory(orderId, items)
    reservationId = reservation.reservationId

    // Step 3: Human approval for high-value orders (Temporal pattern)
    if (input.totalAmount > 1000) {
      status = 'awaiting_approval'

      // Send approval request email
      await activities.sendEmail(input.approverEmail!, 'approval-request', {
        orderId,
        amount: input.totalAmount,
        items,
        workflowId: info.workflowId,
      })

      // Wait for approval with 24h timeout (durable timer)
      const wasApproved = await condition(
        () => approvalDecision !== null,
        '24h'
      )

      if (!wasApproved || !approvalDecision?.approved) {
        status = 'rejected'
        // Cleanup: Release inventory
        await activities.releaseInventory(orderId, reservationId)
        return {
          orderId,
          status,
          error: approvalDecision?.reason ?? 'Approval timeout',
        }
      }
    }

    status = 'approved'

    // Step 4: Charge payment
    const payment = await activities.chargePayment(orderId, input.paymentInfo)
    chargeId = payment.chargeId

    // Step 5: Versioning example - safely add new features
    if (patched('v2-warehouse-notification')) {
      // New code path: Notify warehouse for fulfillment
      shipmentInfo = await activities.notifyWarehouse(orderId, items)
    }

    // Step 6: Send confirmation
    await activities.sendEmail(input.customerEmail, 'order-confirmation', {
      orderId,
      items,
      shipmentInfo,
      shippingAddress,
    })

    status = 'completed'
    return {
      orderId,
      status,
      chargeId,
      shipmentInfo,
    }

  } catch (error) {
    status = 'failed'

    // Cleanup in non-cancellable scope (always runs)
    await CancellationScope.nonCancellable(async () => {
      if (chargeId) {
        await activities.refundPayment(orderId, chargeId)
      }
      if (reservationId) {
        await activities.releaseInventory(orderId, reservationId)
      }
    })

    throw error
  }
}

// ============================================================================
// SUBSCRIPTION WORKFLOW - Long-running with child workflows
// ============================================================================

/**
 * Subscription Workflow - Monthly billing cycle
 *
 * Demonstrates:
 * - Infinite loop with durable sleep
 * - Child workflow execution
 * - Signals for lifecycle control
 */
export async function subscriptionWorkflow(input: SubscriptionInput): Promise<void> {
  const cancelRequested = defineSignal('cancelSubscription')
  let isCancelled = false

  setHandler(cancelRequested, () => {
    isCancelled = true
  })

  // Run billing cycle monthly
  while (!isCancelled) {
    // Execute billing as child workflow
    await executeChild(billingWorkflow, {
      workflowId: `billing-${input.subscriptionId}-${Date.now()}`,
      args: [{
        subscriptionId: input.subscriptionId,
        customerId: input.customerId,
        amount: input.monthlyAmount,
      }],
    })

    // Sleep for 30 days (durable - survives restarts)
    await sleep('30d')
  }
}

/**
 * Billing Workflow - Process monthly charge
 */
async function billingWorkflow(input: BillingInput): Promise<BillingResult> {
  const billingActivities = proxyActivities<{
    createInvoice(input: BillingInput): Promise<{ invoiceId: string }>
    chargeCard(invoiceId: string, amount: number): Promise<{ chargeId: string }>
    sendReceipt(customerId: string, invoiceId: string): Promise<void>
  }>({
    startToCloseTimeout: '60s',
    retry: { maximumAttempts: 5 },
  })

  const invoice = await billingActivities.createInvoice(input)
  const charge = await billingActivities.chargeCard(invoice.invoiceId, input.amount)
  await billingActivities.sendReceipt(input.customerId, invoice.invoiceId)

  return {
    invoiceId: invoice.invoiceId,
    chargeId: charge.chargeId,
    success: true,
  }
}

// ============================================================================
// DURABLE OBJECT - Workflow execution engine
// ============================================================================

export class WorkflowDO implements DurableObject {
  private state: DurableObjectState
  private workflows: Map<string, WorkflowExecution> = new Map()

  constructor(state: DurableObjectState) {
    this.state = state
    // Restore workflow state from storage
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Map<string, WorkflowExecution>>('workflows')
      if (stored) {
        this.workflows = stored
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Start new workflow
    if (url.pathname === '/start' && request.method === 'POST') {
      const body = await request.json() as { workflowType: string; input: unknown; workflowId?: string }
      const workflowId = body.workflowId ?? crypto.randomUUID()

      this.workflows.set(workflowId, {
        id: workflowId,
        type: body.workflowType,
        status: 'running',
        input: body.input,
        startedAt: new Date().toISOString(),
      })

      await this.state.storage.put('workflows', this.workflows)

      return Response.json({
        workflowId,
        status: 'started',
        message: `Workflow ${body.workflowType} started`,
      })
    }

    // Get workflow status
    if (url.pathname.startsWith('/workflow/') && request.method === 'GET') {
      const workflowId = url.pathname.split('/')[2]
      const workflow = this.workflows.get(workflowId)

      if (!workflow) {
        return Response.json({ error: 'Workflow not found' }, { status: 404 })
      }

      return Response.json(workflow)
    }

    // Send signal to workflow
    if (url.pathname.startsWith('/signal/') && request.method === 'POST') {
      const parts = url.pathname.split('/')
      const workflowId = parts[2]
      const signalName = parts[3]
      const body = await request.json() as { args: unknown[] }

      const workflow = this.workflows.get(workflowId)
      if (!workflow) {
        return Response.json({ error: 'Workflow not found' }, { status: 404 })
      }

      // In production, this would dispatch to the workflow's signal handlers
      workflow.lastSignal = { name: signalName, args: body.args, at: new Date().toISOString() }
      await this.state.storage.put('workflows', this.workflows)

      return Response.json({ success: true, signal: signalName })
    }

    // Query workflow
    if (url.pathname.startsWith('/query/') && request.method === 'GET') {
      const parts = url.pathname.split('/')
      const workflowId = parts[2]
      const queryName = parts[3]

      const workflow = this.workflows.get(workflowId)
      if (!workflow) {
        return Response.json({ error: 'Workflow not found' }, { status: 404 })
      }

      // In production, this would invoke the query handler
      return Response.json({
        workflowId,
        query: queryName,
        result: workflow.status,
      })
    }

    // List workflows
    if (url.pathname === '/workflows' && request.method === 'GET') {
      return Response.json(Array.from(this.workflows.values()))
    }

    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

// ============================================================================
// HONO APP - HTTP routing to WorkflowDO
// ============================================================================

interface Env {
  WORKFLOW_DO: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({ origin: '*' }))

// Landing page with documentation
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Temporal-Compatible Workflows on Edge</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #10b981; --muted: #71717a; --code-bg: #1f1f1f; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; max-width: 800px; margin: 0 auto; }
    h1 { color: var(--accent); }
    h2 { color: var(--fg); border-bottom: 1px solid #333; padding-bottom: 0.5rem; margin-top: 2rem; }
    code { background: var(--code-bg); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: var(--code-bg); padding: 1rem; border-radius: 8px; overflow-x: auto; }
    pre code { padding: 0; background: none; }
    .hero { background: linear-gradient(135deg, #065f46 0%, #0a0a0a 100%); padding: 2rem; border-radius: 12px; margin-bottom: 2rem; }
    .hero h1 { margin: 0; font-size: 2rem; }
    .hero .tagline { color: #6ee7b7; font-size: 1.25rem; margin: 0.5rem 0; }
    .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
    .comparison > div { background: var(--code-bg); padding: 1rem; border-radius: 8px; }
    .comparison h3 { margin: 0 0 0.5rem 0; color: var(--muted); font-size: 0.875rem; }
    .endpoint { background: var(--code-bg); padding: 1rem; border-radius: 8px; margin: 0.5rem 0; }
    .endpoint code { color: var(--accent); }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Temporal Workflows. Edge Deployment. Zero Infrastructure.</h1>
    <p class="tagline">Drop-in replacement for @temporalio/workflow that runs on Cloudflare's global network.</p>
  </div>

  <h2>The Problem</h2>
  <p>Temporal is the gold standard for durable execution, but running it requires:</p>
  <ul>
    <li>A Temporal cluster (self-hosted or Temporal Cloud)</li>
    <li>Worker processes that must run 24/7</li>
    <li>Complex infrastructure for high availability</li>
  </ul>

  <h2>The Solution</h2>
  <p>Same API. Zero ops. Runs on 300+ edge cities with &lt;1ms cold starts.</p>

  <div class="comparison">
    <div>
      <h3>Before (Temporal SDK)</h3>
      <pre><code>import {
  proxyActivities,
  defineSignal,
  sleep,
  condition
} from '@temporalio/workflow'</code></pre>
    </div>
    <div>
      <h3>After (dotdo)</h3>
      <pre><code>import {
  proxyActivities,
  defineSignal,
  sleep,
  condition
} from 'dotdo/workflows/compat/temporal'</code></pre>
    </div>
  </div>

  <h2>Demo Endpoints</h2>

  <div class="endpoint">
    <strong>POST /start</strong> - Start a new workflow<br>
    <code>{"workflowType": "orderWorkflow", "input": {...}}</code>
  </div>

  <div class="endpoint">
    <strong>GET /workflow/:id</strong> - Get workflow status
  </div>

  <div class="endpoint">
    <strong>POST /signal/:id/:signal</strong> - Send signal to workflow<br>
    <code>{"args": [true, "Approved by manager"]}</code>
  </div>

  <div class="endpoint">
    <strong>GET /query/:id/:query</strong> - Query workflow state
  </div>

  <div class="endpoint">
    <strong>GET /workflows</strong> - List all workflows
  </div>

  <h2>Features Demonstrated</h2>
  <ul>
    <li><strong>Activities</strong> - External operations with automatic retries</li>
    <li><strong>Signals</strong> - Human-in-the-loop approval flow</li>
    <li><strong>Queries</strong> - Read workflow state anytime</li>
    <li><strong>Durable Sleep</strong> - Wait days without consuming resources</li>
    <li><strong>Child Workflows</strong> - Compose complex flows</li>
    <li><strong>Versioning</strong> - Safe migrations with patched()</li>
    <li><strong>Cancellation</strong> - Proper cleanup on failure</li>
  </ul>

  <h2>How It Works</h2>
  <pre><code>Your Temporal Code
        |
        v
+----------------------+
| @dotdo/temporal      |  <- Same API as @temporalio/workflow
| Compatibility Layer  |
+----------------------+
        |
        v
+----------------------+
| Durable Objects      |  <- Persistent, globally distributed
| SQLite Storage       |     state with automatic replication
+----------------------+
        |
        v
+----------------------+
| Cloudflare Edge      |  <- 300+ cities, &lt;50ms global
| 300+ Cities          |     latency, zero cold starts
+----------------------+</code></pre>

  <footer style="margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem;">
    <p>Part of <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
    <p>See also: <a href="https://temporal.do">temporal.do</a> | <a href="https://workflows.do">workflows.do</a></p>
  </footer>
</body>
</html>
  `)
})

// Get DO stub
function getDO(c: { env: Env }, namespace: string = 'default'): DurableObjectStub {
  const id = c.env.WORKFLOW_DO.idFromName(namespace)
  return c.env.WORKFLOW_DO.get(id)
}

// Workflow routes
app.post('/start', async (c) => {
  const stub = getDO(c)
  return stub.fetch(new Request('https://workflow/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await c.req.text(),
  }))
})

app.get('/workflow/:id', async (c) => {
  const stub = getDO(c)
  return stub.fetch(new Request(`https://workflow/workflow/${c.req.param('id')}`))
})

app.post('/signal/:id/:signal', async (c) => {
  const stub = getDO(c)
  return stub.fetch(new Request(`https://workflow/signal/${c.req.param('id')}/${c.req.param('signal')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await c.req.text(),
  }))
})

app.get('/query/:id/:query', async (c) => {
  const stub = getDO(c)
  return stub.fetch(new Request(`https://workflow/query/${c.req.param('id')}/${c.req.param('query')}`))
})

app.get('/workflows', async (c) => {
  const stub = getDO(c)
  return stub.fetch(new Request('https://workflow/workflows'))
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'workflow-compat-temporal' })
})

export default app

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface OrderItem {
  sku: string
  quantity: number
  price: number
}

interface OrderInput {
  items: OrderItem[]
  totalAmount: number
  customerEmail: string
  approverEmail?: string
  paymentInfo: PaymentInfo
  shippingAddress: ShippingAddress
}

interface PaymentInfo {
  cardToken: string
  amount: number
}

interface ShippingAddress {
  street: string
  city: string
  state: string
  zip: string
  country: string
}

interface ValidationResult {
  valid: boolean
  error?: string
}

interface ReservationResult {
  reservationId: string
  items: OrderItem[]
}

interface PaymentResult {
  chargeId: string
  status: string
}

interface ShipmentInfo {
  trackingNumber: string
  carrier: string
  estimatedDelivery: string
}

type OrderStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface OrderResult {
  orderId: string
  status: OrderStatus
  error?: string
  chargeId?: string
  shipmentInfo?: ShipmentInfo | null
}

interface ApprovalInfo {
  status: OrderStatus
  decision: { approved: boolean; reason?: string } | null
  requiresApproval: boolean
  timeoutAt: string | null
}

interface SubscriptionInput {
  subscriptionId: string
  customerId: string
  monthlyAmount: number
}

interface BillingInput {
  subscriptionId: string
  customerId: string
  amount: number
}

interface BillingResult {
  invoiceId: string
  chargeId: string
  success: boolean
}

interface WorkflowExecution {
  id: string
  type: string
  status: string
  input: unknown
  startedAt: string
  completedAt?: string
  result?: unknown
  error?: string
  lastSignal?: { name: string; args: unknown[]; at: string }
}

# saas.example.com.ai

A multi-tenant SaaS template for dotdo v2.

## The Problem

Building multi-tenant SaaS is hard:

- **Isolation**: One tenant's data must never leak to another
- **Scaling**: Traditional databases become bottlenecks
- **Complexity**: Custom sharding, connection pooling, tenant routing

## The Solution

dotdo gives you a Durable Object per tenant. Each tenant gets isolated SQLite, dedicated compute, and automatic scaling to millions of tenants.

## URL Pattern

```
https://saas.example.com.ai/:tenant/:type/:id
```

## Quick Start

### 1. Worker

```typescript
// worker.ts
import { DO } from 'dotdo'

export { DO as TenantDO }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const tenant = new URL(request.url).pathname.split('/')[1]
    if (!tenant) return new Response('Tenant required', { status: 400 })

    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenant))
    return stub.fetch(request)
  }
}
```

### 2. RPC Client

```typescript
import { createRPCClient } from 'dotdo'

const client = createRPCClient<TenantAPI>({
  target: 'https://saas.example.com.ai/acme',
  auth: 'Bearer eyJ...'
})

const customer = await client.customers.create({
  name: 'Alice',
  email: 'alice@acme.com'
})
```

## Auth Pattern

```typescript
import { verify } from 'jose'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401 })
    }

    try {
      const { payload } = await verify(auth.slice(7), env.JWT_SECRET)
      const tenant = payload.tenant as string

      const headers = new Headers(request.headers)
      headers.set('X-Tenant-ID', tenant)
      headers.set('X-User-ID', payload.sub as string)

      const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenant))
      return stub.fetch(new Request(request.url, {
        method: request.method,
        headers,
        body: request.body
      }))
    } catch {
      return new Response('Invalid token', { status: 401 })
    }
  }
}
```

## Billing Webhooks with $.on

```typescript
import { DO, $ } from 'dotdo'

export class TenantDO extends DO {

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    $.on.Customer.signup(async (event) => {
      await this.sendWelcomeEmail(event.data)
    })

    $.on.Payment.succeeded(async (event) => {
      await this.updateSubscription(event.data)
    })

    $.on.Payment.failed(async (event) => {
      await this.notifyBillingFailure(event.data)
    })

    $.on.Webhook.stripe(async (event) => {
      const { type, data } = event.data
      if (type === 'invoice.paid') $.send('Payment.succeeded', data)
      if (type === 'invoice.payment_failed') $.send('Payment.failed', data)
    })
  }
}
```

## Stripe Webhook Endpoint

```typescript
app.post('/webhooks/stripe', async (c) => {
  const event = stripe.webhooks.constructEvent(
    await c.req.text(),
    c.req.header('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET
  )

  const tenant = event.data.object.metadata.tenant_id
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenant))
  await stub.dispatch('Webhook.stripe', event)

  return c.json({ received: true })
})
```

## Scheduling

```typescript
$.every.day.at('3am')(() => this.cleanupExpiredSessions())
$.every.Monday.at9am(() => this.generateWeeklyReport())
$.every(15).minutes(() => this.checkPendingRenewals())
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips per tenant
for (const tenant of tenants) {
  await $.Tenant(tenant.id).notify(announcement)
}

// ✅ Pipelined - fire and forget (no await needed for side effects)
tenants.forEach(t => $.Tenant(t.id).notify(announcement))

// ✅ Pipelined - single round-trip for chained calls
const plan = await $.Tenant(id).getSubscription().plan
```

Only `await` at exit points when you actually need the result. For broadcast notifications, billing webhooks, or cross-tenant events—fire and move on.

## Tenant Provisioning

```typescript
app.post('/signup', async (c) => {
  const { email, company } = await c.req.json()
  const tenant = slugify(company)

  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenant))
  await stub.initialize({ name: company, owner: { email } })

  return c.json({
    tenant,
    url: `https://${tenant}.saas.example.com.ai`
  })
})
```

## Cost Model

| Tenants | Traditional DB | dotdo |
|---------|---------------|-------|
| 100 | $50/mo | ~$5/mo |
| 10,000 | $2,000/mo | ~$100/mo |
| 100,000 | Custom sharding | ~$500/mo |

Each DO costs ~$0.001/mo when idle.

## Deploy

```bash
npx wrangler deploy
```

Your SaaS is live. Each signup creates an isolated tenant in milliseconds.

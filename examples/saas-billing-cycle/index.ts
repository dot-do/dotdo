// SaaS Billing Cycle Example Worker Entrypoint
// Routes requests to the BillingDO

import { BillingDO } from './BillingDO'

export { BillingDO }

interface Env {
  BILLING: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract tenant from hostname or use default
    // Format: {tenant}.billing.example.com
    let tenant = 'default'

    const hostParts = url.hostname.split('.')
    if (hostParts.length > 2) {
      tenant = hostParts[0]
    }

    // Get or create Durable Object for this tenant
    const id = env.BILLING.idFromName(tenant)
    const stub = env.BILLING.get(id)

    // Forward request to the DO
    return stub.fetch(request)
  },
}

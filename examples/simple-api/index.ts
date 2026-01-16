/**
 * Simple API Example
 *
 * The simplest possible dotdo example - just export DOFull.
 * All CRUD operations and REST API are built-in.
 *
 * @example
 * ```bash
 * # Deploy
 * npm run deploy
 *
 * # Create a customer
 * curl -X POST https://your-worker.dev/api/items \
 *   -H "Content-Type: application/json" \
 *   -d '{"$type": "Customer", "name": "Alice"}'
 *
 * # List customers
 * curl https://your-worker.dev/Customer
 *
 * # Use RPC client
 * import { createRPCClient } from '@dotdo/core'
 * const api = createRPCClient({ target: 'https://your-worker.dev' })
 * const customers = await api.Customer.list()
 * ```
 */

// That's it. DOFull includes everything:
// - REST API routes (GET/POST/PUT/PATCH/DELETE)
// - Thing CRUD (create, list, get, update, delete)
// - WebSocket support
// - RPC pipelining
// - AI template literals
export { DOFull as SimpleAPI } from '../../objects/DOFull'

// Worker entry - route by subdomain
import { DOFull, type DOFullEnv } from '../../objects/DOFull'

export default {
  async fetch(request: Request, env: DOFullEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOFull.idFromName(ns)
    const stub = env.DOFull.get(id)

    return stub.fetch(request)
  },
}

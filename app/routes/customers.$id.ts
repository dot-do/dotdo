/**
 * Customer Item Route
 *
 * Returns an item response with linked data properties for /customers/:id endpoints.
 * Uses content negotiation to serve JSON for API requests.
 */
import { createFileRoute } from '@tanstack/react-router'
import { buildResponse } from '../../lib/response/linked-data'
import { buildItemLinks } from '../../lib/response/links'
import { buildItemActions } from '../../lib/response/actions'

// Mock customer data for testing
const mockCustomers: Record<string, { id: string; name: string; email: string }> = {
  alice: { id: 'alice', name: 'Alice Smith', email: 'alice@example.com' },
  bob: { id: 'bob', name: 'Bob Jones', email: 'bob@example.com' },
  carol: { id: 'carol', name: 'Carol White', email: 'carol@example.com' },
  'test-customer-1': { id: 'test-customer-1', name: 'Test Customer', email: 'test@example.com' },
}

export const Route = createFileRoute('/customers/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const customerId = params.id
        const url = new URL(request.url)
        const baseNs = `${url.protocol}//${url.host}`

        // Look up customer or use the ID for test customers
        const customer = mockCustomers[customerId] || {
          id: customerId,
          name: `Customer ${customerId}`,
          email: `${customerId}@example.com`,
        }

        // Build linked data response
        const linkedData = buildResponse(customer, {
          ns: baseNs,
          type: 'Customer',
          id: customerId,
        })

        // Build links
        const links = buildItemLinks({
          ns: baseNs,
          type: 'Customer',
          id: customerId,
        })

        // Add home and self links
        links.home = baseNs
        links.self = `${baseNs}/customers/${customerId}`

        // Build actions with method and href structure
        const rawActions = buildItemActions({
          ns: baseNs,
          type: 'Customer',
          id: customerId,
        })

        const enhancedActions: Record<string, { method: string; href: string; type?: string }> = {
          update: {
            method: 'PUT',
            href: rawActions.update,
            type: 'application/json',
          },
          delete: {
            method: 'DELETE',
            href: rawActions.delete,
          },
        }

        return Response.json({
          ...linkedData,
          links,
          actions: enhancedActions,
        })
      },
    },
  },
})

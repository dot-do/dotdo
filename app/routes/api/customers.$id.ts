/**
 * API Customer Item Route
 *
 * Returns an item response with linked data properties for /api/customers/:id endpoints.
 */
import { createFileRoute } from '@tanstack/react-router'
import { buildResponse } from '../../../lib/response/linked-data'

// Mock customer data for testing
const mockCustomers: Record<string, { name: string; email: string }> = {
  alice: { name: 'Alice Smith', email: 'alice@example.com' },
  bob: { name: 'Bob Jones', email: 'bob@example.com' },
  charlie: { name: 'Charlie Brown', email: 'charlie@example.com' },
}

export const Route = createFileRoute('/api/customers/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const customerId = params.id
        const url = new URL(request.url)
        const baseNs = `${url.protocol}//${url.host}`

        // Look up customer
        const customerData = mockCustomers[customerId]
        if (!customerData) {
          return Response.json(
            { error: { code: 'NOT_FOUND', message: 'Customer not found' } },
            { status: 404 }
          )
        }

        // Build linked data response
        const response = buildResponse(
          { id: customerId, ...customerData },
          {
            ns: baseNs,
            type: 'Customer',
            id: customerId,
          }
        )

        return Response.json(response)
      },
    },
  },
})

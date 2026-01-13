/**
 * Customers Collection Route
 *
 * Returns a collection response with linked data properties for the /customers endpoint.
 * Uses content negotiation to serve JSON for API requests.
 */
import { createFileRoute } from '@tanstack/react-router'
import { buildCollectionResponse } from '../../lib/response/collection'

// Mock customer data for testing
const mockCustomers = [
  { id: 'alice', name: 'Alice Smith', email: 'alice@example.com' },
  { id: 'bob', name: 'Bob Jones', email: 'bob@example.com' },
  { id: 'carol', name: 'Carol White', email: 'carol@example.com' },
]

export const Route = createFileRoute('/customers/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const baseNs = `${url.protocol}//${url.host}`

        const response = buildCollectionResponse(mockCustomers, mockCustomers.length, {
          ns: baseNs,
          type: 'Customer',
        })

        // Add self link which buildCollectionResponse doesn't add by default
        response.links.self = `${baseNs}/customers`

        // Enhance actions with method and href structure
        const enhancedActions: Record<string, { method: string; href: string; type?: string }> = {
          create: {
            method: 'POST',
            href: `${baseNs}/customers`,
            type: 'application/json',
          },
        }

        return Response.json({
          ...response,
          actions: enhancedActions,
        })
      },
    },
  },
})

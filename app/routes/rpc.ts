/**
 * RPC Route - JSON-RPC 2.0 endpoint for Clickable API
 *
 * This route handles JSON-RPC requests and returns responses with
 * JSON-LD style linked data properties ($context, $type, $id).
 *
 * Supports:
 * - JSON-RPC 2.0 single requests
 * - JSON-RPC 2.0 batch requests
 * - Cap'n Web RPC format for promise pipelining
 */
import { createFileRoute } from '@tanstack/react-router'
import { buildResponse } from '../../lib/response/linked-data'

// Types
interface JSONRPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: JSONRPCError
  id: string | number | null
}

interface JSONRPCError {
  code: number
  message: string
  data?: unknown
}

interface CapnwebRequest {
  id: string
  type: 'call' | 'batch' | 'resolve' | 'dispose'
  calls?: CapnwebCall[]
}

interface CapnwebCall {
  promiseId: string
  target: { type: 'root' } | { type: 'promise'; promiseId: string }
  method: string
  args: Array<{ type: 'value'; value: unknown } | { type: 'promise'; promiseId: string }>
}

interface CapnwebResponse {
  id: string
  type: 'result' | 'error' | 'batch'
  results?: CapnwebResult[]
  error?: { code: string; message: string }
}

interface CapnwebResult {
  promiseId: string
  type: 'value' | 'promise' | 'error'
  value?: unknown
  error?: { code: string; message: string }
}

// Standard JSON-RPC error codes
const JSON_RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
}

// Sample customer data for RPC tests
const SAMPLE_CUSTOMERS: Record<string, { name: string; email: string }> = {
  alice: { name: 'Alice Smith', email: 'alice@example.com' },
  bob: { name: 'Bob Jones', email: 'bob@example.com' },
  charlie: { name: 'Charlie Brown', email: 'charlie@example.com' },
}

// Helper to build linked data responses
function buildCustomerResponse(id: string, data: { name: string; email: string }, baseNs: string) {
  return buildResponse(
    { id, ...data },
    {
      ns: baseNs,
      type: 'Customer',
      id: id,
    }
  )
}

function buildOrdersResponse(customerId: string, baseNs: string) {
  const orders = [
    { id: `${customerId}-order-1`, product: 'Widget', amount: 99.99, customerId },
    { id: `${customerId}-order-2`, product: 'Gadget', amount: 149.99, customerId },
  ]

  const items = orders.map((order) =>
    buildResponse(order, {
      ns: baseNs,
      type: 'Order',
      id: order.id,
    })
  )

  return buildResponse(
    { items, count: items.length },
    {
      ns: baseNs,
      type: 'Order',
      isCollection: true,
    }
  )
}

function buildCustomersListResponse(baseNs: string) {
  const items = Object.entries(SAMPLE_CUSTOMERS).map(([id, data]) =>
    buildResponse(
      { id, ...data },
      {
        ns: baseNs,
        type: 'Customer',
        id: id,
      }
    )
  )

  return buildResponse(
    { items, count: items.length },
    {
      ns: baseNs,
      type: 'Customer',
      isCollection: true,
    }
  )
}

function buildEmptyCollectionResponse(baseNs: string) {
  return buildResponse(
    { items: [], count: 0 },
    {
      ns: baseNs,
      type: 'Empty',
      isCollection: true,
    }
  )
}

// Promise store for Cap'n Web pipelining
class PromiseStore {
  private promises = new Map<string, unknown>()

  set(id: string, value: unknown): void {
    this.promises.set(id, value)
  }

  get(id: string): unknown {
    return this.promises.get(id)
  }

  has(id: string): boolean {
    return this.promises.has(id)
  }
}

// Type guards
function isJSONRPCRequest(data: unknown): data is JSONRPCRequest {
  return data !== null && typeof data === 'object' && 'jsonrpc' in data && (data as JSONRPCRequest).jsonrpc === '2.0'
}

function isJSONRPCBatch(data: unknown): data is JSONRPCRequest[] {
  return Array.isArray(data) && data.length > 0 && data.every((item) => isJSONRPCRequest(item))
}

function isCapnwebRequest(data: unknown): data is CapnwebRequest {
  return data !== null && typeof data === 'object' && 'type' in data && typeof (data as CapnwebRequest).type === 'string'
}

// Handle JSON-RPC request
async function handleJSONRPCRequest(request: JSONRPCRequest, baseNs: string, promiseStore: PromiseStore): Promise<JSONRPCResponse | null> {
  const { method, params, id } = request
  const isNotification = id === undefined

  try {
    let result: unknown

    // Parse method - could be "Customer" or "Customers.list"
    const parts = method.split('.')
    const rootMethod = parts[0]
    const subMethod = parts[1]

    switch (rootMethod) {
      case 'Customer': {
        const customerId = Array.isArray(params) ? params[0] : params
        if (typeof customerId !== 'string') {
          if (isNotification) return null
          return { jsonrpc: '2.0', error: JSON_RPC_ERRORS.INVALID_PARAMS, id: id ?? null }
        }
        const customerData = SAMPLE_CUSTOMERS[customerId]
        if (!customerData) {
          if (isNotification) return null
          return { jsonrpc: '2.0', result: null, id: id ?? null }
        }
        result = buildCustomerResponse(customerId, customerData, baseNs)
        // Add Orders method for promise pipelining
        ;(result as Record<string, unknown>).Orders = () => buildOrdersResponse(customerId, baseNs)
        break
      }

      case 'Customers': {
        if (subMethod === 'list') {
          result = buildCustomersListResponse(baseNs)
        } else {
          if (isNotification) return null
          return { jsonrpc: '2.0', error: { ...JSON_RPC_ERRORS.METHOD_NOT_FOUND, message: `Method '${method}' not found` }, id: id ?? null }
        }
        break
      }

      case 'EmptyCollection': {
        if (subMethod === 'list') {
          result = buildEmptyCollectionResponse(baseNs)
        } else {
          if (isNotification) return null
          return { jsonrpc: '2.0', error: { ...JSON_RPC_ERRORS.METHOD_NOT_FOUND, message: `Method '${method}' not found` }, id: id ?? null }
        }
        break
      }

      default:
        if (isNotification) return null
        return { jsonrpc: '2.0', error: { ...JSON_RPC_ERRORS.METHOD_NOT_FOUND, message: `Method '${method}' not found` }, id: id ?? null }
    }

    if (isNotification) return null
    return { jsonrpc: '2.0', result, id: id ?? null }
  } catch (error) {
    if (isNotification) return null
    return { jsonrpc: '2.0', error: JSON_RPC_ERRORS.INTERNAL_ERROR, id: id ?? null }
  }
}

// Handle Cap'n Web request
async function handleCapnwebRequest(request: CapnwebRequest, baseNs: string): Promise<CapnwebResponse> {
  const promiseStore = new PromiseStore()
  const results: CapnwebResult[] = []

  if (request.type === 'call' || request.type === 'batch') {
    if (!request.calls || request.calls.length === 0) {
      return {
        id: request.id,
        type: 'error',
        error: { code: 'INVALID_REQUEST', message: 'No calls provided' },
      }
    }

    for (const call of request.calls) {
      try {
        let targetValue: unknown

        // Resolve target
        if (call.target.type === 'root') {
          targetValue = { Customer: true, Customers: true } // Root object placeholder
        } else if (call.target.type === 'promise') {
          targetValue = promiseStore.get(call.target.promiseId)
          if (targetValue === undefined) {
            results.push({
              promiseId: call.promiseId,
              type: 'error',
              error: { code: 'INVALID_PROMISE', message: `Promise ${call.target.promiseId} not found` },
            })
            continue
          }
        }

        // Resolve args
        const args: unknown[] = call.args.map((arg) => {
          if (arg.type === 'value') return arg.value
          if (arg.type === 'promise') return promiseStore.get(arg.promiseId)
          return undefined
        })

        let result: unknown

        // Execute method
        if (call.target.type === 'root') {
          // Root methods
          if (call.method === 'Customer') {
            const customerId = args[0] as string
            const customerData = SAMPLE_CUSTOMERS[customerId]
            if (customerData) {
              result = buildCustomerResponse(customerId, customerData, baseNs)
              // Add Orders method for promise pipelining
              ;(result as Record<string, unknown>).Orders = () => buildOrdersResponse(customerId, baseNs)
            } else {
              result = null
            }
          } else if (call.method === 'Customers') {
            result = { list: () => buildCustomersListResponse(baseNs) }
          } else {
            results.push({
              promiseId: call.promiseId,
              type: 'error',
              error: { code: 'METHOD_NOT_FOUND', message: `Method ${call.method} not found` },
            })
            continue
          }
        } else {
          // Method on promise result
          if (targetValue && typeof targetValue === 'object' && call.method in targetValue) {
            const method = (targetValue as Record<string, unknown>)[call.method]
            if (typeof method === 'function') {
              result = await (method as (...args: unknown[]) => unknown)(...args)
            } else {
              result = method
            }
          } else {
            results.push({
              promiseId: call.promiseId,
              type: 'error',
              error: { code: 'METHOD_NOT_FOUND', message: `Method ${call.method} not found on target` },
            })
            continue
          }
        }

        promiseStore.set(call.promiseId, result)
        results.push({
          promiseId: call.promiseId,
          type: 'value',
          value: result,
        })
      } catch (error) {
        results.push({
          promiseId: call.promiseId,
          type: 'error',
          error: { code: 'EXECUTION_ERROR', message: String(error) },
        })
      }
    }
  }

  return {
    id: request.id,
    type: 'batch',
    results,
  }
}

export const Route = createFileRoute('/rpc')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url)
        const baseNs = `${url.protocol}//${url.host}`
        const promiseStore = new PromiseStore()

        // Parse request body
        let data: unknown
        try {
          data = await request.json()
        } catch {
          return Response.json(
            { jsonrpc: '2.0', error: JSON_RPC_ERRORS.PARSE_ERROR, id: null } as JSONRPCResponse,
            { status: 400 }
          )
        }

        // Handle JSON-RPC batch
        if (isJSONRPCBatch(data)) {
          const responses: JSONRPCResponse[] = []
          for (const req of data) {
            const response = await handleJSONRPCRequest(req, baseNs, promiseStore)
            if (response) {
              responses.push(response)
            }
          }
          return Response.json(responses)
        }

        // Handle single JSON-RPC request
        if (isJSONRPCRequest(data)) {
          const response = await handleJSONRPCRequest(data, baseNs, promiseStore)
          return Response.json(response)
        }

        // Handle Cap'n Web request
        if (isCapnwebRequest(data)) {
          const response = await handleCapnwebRequest(data, baseNs)
          return Response.json(response)
        }

        // Invalid request
        return Response.json(
          { jsonrpc: '2.0', error: JSON_RPC_ERRORS.INVALID_REQUEST, id: null } as JSONRPCResponse,
          { status: 400 }
        )
      },
    },
  },
})

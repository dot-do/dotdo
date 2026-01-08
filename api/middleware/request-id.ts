import type { MiddlewareHandler } from 'hono'

/**
 * Request ID Middleware
 *
 * Handles X-Request-ID header tracking:
 * - Echoes the X-Request-ID header if provided in the request
 * - Generates a new UUID if no X-Request-ID is provided
 *
 * This enables distributed tracing and request correlation across services.
 */
export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  // Get the request ID from header or generate a new one
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID()

  // Store in context for potential logging/tracing use
  c.set('requestId', requestId)

  // Process the request
  await next()

  // Set the X-Request-ID header on the response
  c.header('X-Request-ID', requestId)
}

export default requestIdMiddleware

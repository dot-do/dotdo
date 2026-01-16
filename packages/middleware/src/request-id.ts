/**
 * Request ID middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { MiddlewareHandler } from 'hono'

// TDD RED: Stub - will fail tests
export const requestId: MiddlewareHandler = async (_c, _next) => {
  throw new Error('requestId middleware not implemented')
}

export default requestId

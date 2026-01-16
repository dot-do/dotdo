/**
 * API Key middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { MiddlewareHandler } from 'hono'

export interface ApiKeyConfig {
  userId: string
  role: 'admin' | 'user'
  permissions?: string[]
  name?: string
}

export interface ApiKeyMiddlewareConfig {
  keys?: Map<string, ApiKeyConfig>
  header?: string
  loadFromEnv?: boolean
}

// TDD RED: Stub - will fail tests
export function apiKeyMiddleware(_config?: ApiKeyMiddlewareConfig): MiddlewareHandler {
  throw new Error('apiKeyMiddleware not implemented')
}

// TDD RED: Stub - will fail tests
export function loadApiKeysFromEnv(_env: Record<string, unknown>): Map<string, ApiKeyConfig> {
  throw new Error('loadApiKeysFromEnv not implemented')
}

export default apiKeyMiddleware

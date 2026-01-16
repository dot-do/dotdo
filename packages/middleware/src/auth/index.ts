/**
 * Auth middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { MiddlewareHandler } from 'hono'

export interface AuthContext {
  userId: string
  email?: string
  role: 'admin' | 'user'
  permissions?: string[]
  method: 'jwt' | 'session' | 'apikey'
}

export interface User {
  id: string
  email?: string
  name?: string
  role: 'admin' | 'user'
  permissions?: string[]
}

export interface Session {
  id: string
  userId: string
  expiresAt: Date
}

export interface ApiKeyConfig {
  userId: string
  role: 'admin' | 'user'
  permissions?: string[]
  name?: string
}

export interface AuthConfig {
  jwtSecret?: string
  jwksUrl?: string
  apiKeys?: Map<string, ApiKeyConfig>
  publicPaths?: string[]
  cookieName?: string
  validateSession?: (token: string) => Promise<{
    userId: string
    email?: string
    role?: 'admin' | 'user'
    expiresAt?: Date
  } | null>
  sessionCache?: KVNamespace
  sessionCacheTtl?: number
}

// TDD RED: Stub - will fail tests
export function authMiddleware(_config?: AuthConfig): MiddlewareHandler {
  throw new Error('authMiddleware not implemented')
}

// TDD RED: Stub - will fail tests
export function requireAuth(): MiddlewareHandler {
  throw new Error('requireAuth not implemented')
}

// TDD RED: Stub - will fail tests
export function requireRole(_role: 'admin' | 'user'): MiddlewareHandler {
  throw new Error('requireRole not implemented')
}

// TDD RED: Stub - will fail tests
export function requirePermission(_permission: string): MiddlewareHandler {
  throw new Error('requirePermission not implemented')
}

// TDD RED: Stub - will fail tests
export function registerApiKey(_key: string, _config: ApiKeyConfig): void {
  throw new Error('registerApiKey not implemented')
}

// TDD RED: Stub - will fail tests
export function revokeApiKey(_key: string): boolean {
  throw new Error('revokeApiKey not implemented')
}

export default authMiddleware

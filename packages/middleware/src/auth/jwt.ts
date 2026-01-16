/**
 * JWT middleware
 *
 * TDD RED PHASE: Stub implementation that will fail tests.
 */

import type { MiddlewareHandler } from 'hono'

export interface JWTPayload {
  sub: string
  email?: string
  role?: 'admin' | 'user'
  permissions?: string[]
  iat?: number
  exp?: number
}

export interface JWTConfig {
  secret?: string
  jwksUrl?: string
  algorithms?: string[]
}

// TDD RED: Stub - will fail tests
export function jwtMiddleware(_config?: JWTConfig): MiddlewareHandler {
  throw new Error('jwtMiddleware not implemented')
}

// TDD RED: Stub - will fail tests
export async function generateJWT(
  _payload: Omit<JWTPayload, 'iat' | 'exp'>,
  _secret: string,
  _expiresIn?: string,
): Promise<string> {
  throw new Error('generateJWT not implemented')
}

// TDD RED: Stub - will fail tests
export async function verifyJWT(_token: string, _config: JWTConfig): Promise<JWTPayload> {
  throw new Error('verifyJWT not implemented')
}

export default jwtMiddleware

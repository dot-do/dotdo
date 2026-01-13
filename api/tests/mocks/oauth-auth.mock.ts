/**
 * OAuth Auth Middleware Test Mocks
 *
 * This file provides test utilities for mocking oauth.do authentication.
 * These should ONLY be used in tests, never in production code.
 *
 * Usage:
 * ```typescript
 * import { mockAuthState, resetMockAuth } from '../mocks/oauth-auth.mock'
 *
 * beforeEach(() => {
 *   resetMockAuth()
 * })
 *
 * it('should handle invalid session', async () => {
 *   mockAuthState.sessionInvalid = true
 *   // ... test code
 * })
 * ```
 */

import type { AuthUser } from '../../../app/types/auth'

// ============================================================================
// Mock State - Test-only
// ============================================================================

/**
 * Mock authentication state for testing.
 * Modify these properties to control mock behavior in tests.
 */
export const mockAuthState = {
  sessionInvalid: false,
  bearerTokenInvalid: false,
  serviceError: null as Error | null,
  validationCalls: [] as string[],
}

/**
 * Reset all mock state to defaults.
 * Call this in beforeEach to ensure clean test isolation.
 */
export function resetMockAuth(): void {
  mockAuthState.sessionInvalid = false
  mockAuthState.bearerTokenInvalid = false
  mockAuthState.serviceError = null
  mockAuthState.validationCalls = []
}

// ============================================================================
// Legacy Compatibility Functions
// ============================================================================

/**
 * Set mock session invalid state for testing.
 * @deprecated Use mockAuthState.sessionInvalid = true directly
 */
export async function setMockSessionInvalid(invalid: boolean): Promise<void> {
  resetMockAuth()
  mockAuthState.sessionInvalid = invalid
}

/**
 * Set mock bearer token invalid state for testing.
 * @deprecated Use mockAuthState.bearerTokenInvalid = true directly
 */
export async function setMockBearerTokenInvalid(invalid: boolean): Promise<void> {
  resetMockAuth()
  mockAuthState.bearerTokenInvalid = invalid
}

/**
 * Set mock service error for testing.
 * @deprecated Use mockAuthState.serviceError = error directly
 */
export async function setMockServiceError(error: Error | null): Promise<void> {
  resetMockAuth()
  mockAuthState.serviceError = error
}

/**
 * Get mock validation calls for testing.
 * @deprecated Use mockAuthState.validationCalls directly
 */
export async function getMockValidationCalls(): Promise<string[]> {
  return [...mockAuthState.validationCalls]
}

/**
 * Reset all mocks to default state.
 * @deprecated Use resetMockAuth() directly
 */
export function resetMocks(): void {
  resetMockAuth()
}

// ============================================================================
// Mock User Data
// ============================================================================

/**
 * Default mock user returned for valid session tokens.
 */
export const mockSessionUser: AuthUser = {
  id: 'session-user',
  email: 'session@example.com',
  name: 'Session User',
  role: 'user',
}

/**
 * Default mock user returned for valid bearer tokens.
 */
export const mockBearerUser: AuthUser = {
  id: 'bearer-user',
  email: 'bearer@example.com',
  name: 'Bearer User',
  role: 'user',
}

/**
 * Default mock user returned for valid API keys.
 */
export const mockApiKeyUser: AuthUser = {
  id: 'apikey-user',
  email: 'apikey@example.com',
  name: 'API Key User',
  role: 'user',
}

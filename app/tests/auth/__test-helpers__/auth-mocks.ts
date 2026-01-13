/**
 * Auth Test Mocks
 *
 * Centralized test helpers for auth module testing.
 * Import these helpers in tests instead of using module-level setters.
 *
 * Note: The production code still maintains the mock setters for backwards
 * compatibility with existing tests. These helpers provide a cleaner API.
 */

// Re-export all test helpers from the production modules
// This provides a single import point for tests

export {
  setMockAuthenticated,
  setMockOAuthError,
  resetMocks as resetLoginMocks,
} from '../../../routes/login'

export {
  setExpectedState,
  setMockTokenError,
  setMockUserError,
  getSessionStore,
  resetMocks as resetCallbackMocks,
} from '../../../routes/auth-callback'

export {
  setMockRevokeError,
  setMockSessionToken,
  getRevokeCalls,
  resetMocks as resetLogoutMocks,
} from '../../../routes/auth-logout'

// Middleware mocks are imported directly in api tests
// export {
//   setMockSessionInvalid,
//   setMockBearerTokenInvalid,
//   setMockServiceError,
//   getMockValidationCalls,
//   resetMocks as resetMiddlewareMocks,
// } from '../../../../api/middleware/oauth-auth'

/**
 * Reset all auth mocks at once.
 * Call this in beforeEach/afterEach for clean test isolation.
 */
export async function resetAllAuthMocks(): Promise<void> {
  const { resetMocks: resetLogin } = await import('../../../routes/login')
  const { resetMocks: resetCallback } = await import('../../../routes/auth-callback')
  const { resetMocks: resetLogout } = await import('../../../routes/auth-logout')

  resetLogin()
  resetCallback()
  resetLogout()
}

/**
 * Create a mock authenticated session for testing.
 * Returns a session token and sets up the mock state.
 */
export async function createMockSession(): Promise<string> {
  const { setMockSessionToken } = await import('../../../routes/auth-logout')
  const token = `test-session-${Date.now()}`
  await setMockSessionToken(token)
  return token
}

/**
 * Mock request helper with cookies
 */
export function createMockRequest(
  url: string,
  options: RequestInit & { cookies?: Record<string, string> } = {},
): Request {
  const { cookies, ...init } = options
  const headers = new Headers(init.headers)

  if (cookies) {
    const cookieString = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
    headers.set('Cookie', cookieString)
  }

  return new Request(url, {
    ...init,
    headers,
  })
}

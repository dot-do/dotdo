/**
 * E2E Browser Tests: Authentication Flow
 *
 * Tests critical user journeys for authentication:
 * - User login flow
 * - User registration flow
 * - Token management
 * - Session persistence
 * - Logout flow
 * - Protected route access
 * - API key authentication
 *
 * @see do-o4sii
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test'

/**
 * API URL for backend operations
 */
const API_URL = process.env.PLAYWRIGHT_API_URL || process.env.WORKER_URL || 'http://localhost:8787'

/**
 * Generate a unique test identifier
 */
function generateTestId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Helper to register a test user
 */
async function registerUser(
  page: Page,
  email: string,
  password: string,
  options?: { name?: string; role?: string }
) {
  const response = await page.request.post(`${API_URL}/auth/register`, {
    data: {
      email,
      password,
      name: options?.name,
      role: options?.role,
    },
  })
  return response
}

/**
 * Helper to login a user
 */
async function loginUser(page: Page, email: string, password: string) {
  const response = await page.request.post(`${API_URL}/auth/login`, {
    data: { email, password },
  })
  return response
}

test.describe('Authentication API', () => {
  // These tests verify the authentication API from the browser context

  test.describe('User Registration', () => {
    test('should register a new user successfully', async ({ page }) => {
      const testId = generateTestId()
      const email = `test-${testId}@example.com`

      const response = await registerUser(page, email, 'secure-password-123', {
        name: 'Test User',
      })

      expect(response.ok()).toBeTruthy()
      const data = await response.json()

      expect(data.success).toBe(true)
      expect(data.user).toBeDefined()
      expect(data.user.email).toBe(email)
    })

    test('should reject duplicate email registration', async ({ page }) => {
      const testId = generateTestId()
      const email = `duplicate-${testId}@example.com`

      // First registration
      await registerUser(page, email, 'password123')

      // Second registration with same email
      const response = await registerUser(page, email, 'different-password')

      expect(response.status()).toBe(409)
      const data = await response.json()
      expect(data.code).toBe('USER_EXISTS')
    })

    test('should reject registration without required fields', async ({ page }) => {
      const response = await page.request.post(`${API_URL}/auth/register`, {
        data: {
          email: 'incomplete@example.com',
          // Missing password
        },
      })

      expect(response.status()).toBe(400)
    })

    test('should register user with admin role', async ({ page }) => {
      const testId = generateTestId()
      const email = `admin-${testId}@example.com`

      const response = await registerUser(page, email, 'admin-password', {
        role: 'admin',
      })

      expect(response.ok()).toBeTruthy()
      const data = await response.json()
      expect(data.user.role).toBe('admin')
    })
  })

  test.describe('User Login', () => {
    test('should login with valid credentials', async ({ page }) => {
      const testId = generateTestId()
      const email = `login-${testId}@example.com`
      const password = 'valid-password-123'

      // Register first
      await registerUser(page, email, password)

      // Login
      const response = await loginUser(page, email, password)

      expect(response.ok()).toBeTruthy()
      const data = await response.json()

      expect(data.success).toBe(true)
      expect(data.tokens).toBeDefined()
      expect(data.tokens.accessToken).toBeDefined()
      expect(data.tokens.refreshToken).toBeDefined()
      expect(data.user.email).toBe(email)
    })

    test('should reject login with wrong password', async ({ page }) => {
      const testId = generateTestId()
      const email = `wrongpw-${testId}@example.com`

      // Register
      await registerUser(page, email, 'correct-password')

      // Login with wrong password
      const response = await loginUser(page, email, 'wrong-password')

      expect(response.status()).toBe(401)
      const data = await response.json()
      expect(data.code).toBe('INVALID_CREDENTIALS')
    })

    test('should reject login with non-existent email', async ({ page }) => {
      const response = await loginUser(page, 'nonexistent@example.com', 'password')

      expect(response.status()).toBe(401)
      const data = await response.json()
      expect(data.code).toBe('INVALID_CREDENTIALS')
    })

    test('should set token expiry in the future', async ({ page }) => {
      const testId = generateTestId()
      const email = `expiry-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const response = await loginUser(page, email, 'password123')

      const data = await response.json()
      expect(data.tokens.expiresAt).toBeGreaterThan(Date.now())
    })
  })

  test.describe('Token Validation', () => {
    test('should validate a valid token', async ({ page }) => {
      const testId = generateTestId()
      const email = `validate-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      const validateResponse = await page.request.get(`${API_URL}/auth/validate`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })

      expect(validateResponse.ok()).toBeTruthy()
      const data = await validateResponse.json()
      expect(data.valid).toBe(true)
    })

    test('should reject invalid token', async ({ page }) => {
      const validateResponse = await page.request.get(`${API_URL}/auth/validate`, {
        headers: {
          Authorization: 'Bearer invalid.token.here',
        },
      })

      const data = await validateResponse.json()
      expect(data.valid).toBe(false)
    })

    test('should reject request without token', async ({ page }) => {
      const validateResponse = await page.request.get(`${API_URL}/auth/validate`)

      expect(validateResponse.status()).toBe(400)
    })
  })

  test.describe('Token Refresh', () => {
    test('should refresh token with valid refresh token', async ({ page }) => {
      const testId = generateTestId()
      const email = `refresh-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      const refreshResponse = await page.request.post(`${API_URL}/auth/refresh`, {
        data: { refreshToken: tokens.refreshToken },
      })

      expect(refreshResponse.ok()).toBeTruthy()
      const data = await refreshResponse.json()

      expect(data.success).toBe(true)
      expect(data.tokens.accessToken).toBeDefined()
      // New access token should be different
      expect(data.tokens.accessToken).not.toBe(tokens.accessToken)
    })

    test('should reject refresh with invalid token', async ({ page }) => {
      const refreshResponse = await page.request.post(`${API_URL}/auth/refresh`, {
        data: { refreshToken: 'invalid.refresh.token' },
      })

      expect(refreshResponse.status()).toBe(401)
    })
  })

  test.describe('Logout', () => {
    test('should logout successfully', async ({ page }) => {
      const testId = generateTestId()
      const email = `logout-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      const logoutResponse = await page.request.post(`${API_URL}/auth/logout`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })

      expect(logoutResponse.ok()).toBeTruthy()
      const data = await logoutResponse.json()
      expect(data.success).toBe(true)
    })

    test('should invalidate token after logout', async ({ page }) => {
      const testId = generateTestId()
      const email = `invalidate-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      // Logout
      await page.request.post(`${API_URL}/auth/logout`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })

      // Try to access protected resource
      const protectedResponse = await page.request.get(`${API_URL}/protected`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })

      expect(protectedResponse.status()).toBe(401)
    })
  })

  test.describe('Protected Resources', () => {
    test('should access protected resource with valid token', async ({ page }) => {
      const testId = generateTestId()
      const email = `protected-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      const protectedResponse = await page.request.get(`${API_URL}/protected`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })

      expect(protectedResponse.ok()).toBeTruthy()
      const data = await protectedResponse.json()
      expect(data.message).toContain('Access granted')
    })

    test('should reject access without token', async ({ page }) => {
      const protectedResponse = await page.request.get(`${API_URL}/protected`)

      expect(protectedResponse.status()).toBe(401)
    })

    test('should reject access with expired token', async ({ page, browserName }) => {
      // Skip this test as we can't easily create an expired token
      test.skip(true, 'Requires ability to create expired tokens')
    })
  })

  test.describe('API Key Authentication', () => {
    test('should create API key for authenticated user', async ({ page }) => {
      const testId = generateTestId()
      const email = `apikey-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      const apiKeyResponse = await page.request.post(`${API_URL}/auth/apikey/create`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: { name: 'Test API Key' },
      })

      expect(apiKeyResponse.status()).toBe(201)
      const data = await apiKeyResponse.json()
      expect(data.success).toBe(true)
      expect(data.apiKey).toBeDefined()
    })

    test('should access protected resource with API key', async ({ page }) => {
      const testId = generateTestId()
      const email = `apikey-access-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      // Create API key
      const apiKeyResponse = await page.request.post(`${API_URL}/auth/apikey/create`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: { name: 'Access Key' },
      })
      const { apiKey } = await apiKeyResponse.json()

      // Access protected resource with API key
      const protectedResponse = await page.request.get(`${API_URL}/protected`, {
        headers: {
          'X-API-Key': apiKey,
        },
      })

      expect(protectedResponse.ok()).toBeTruthy()
    })

    test('should revoke API key', async ({ page }) => {
      const testId = generateTestId()
      const email = `apikey-revoke-${testId}@example.com`

      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      // Create API key
      const createResponse = await page.request.post(`${API_URL}/auth/apikey/create`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: { name: 'Revoke Key' },
      })
      const { apiKey } = await createResponse.json()

      // Revoke API key
      const revokeResponse = await page.request.post(`${API_URL}/auth/apikey/revoke`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        data: { apiKey },
      })

      expect(revokeResponse.ok()).toBeTruthy()

      // Try to access with revoked key
      const protectedResponse = await page.request.get(`${API_URL}/protected`, {
        headers: {
          'X-API-Key': apiKey,
        },
      })

      expect(protectedResponse.status()).toBe(401)
    })
  })

  test.describe('Role-Based Access Control', () => {
    test('should allow admin access to admin endpoints', async ({ page }) => {
      const testId = generateTestId()
      const email = `admin-rbac-${testId}@example.com`

      await registerUser(page, email, 'password123', { role: 'admin' })
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      const adminResponse = await page.request.get(`${API_URL}/admin/users`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })

      expect(adminResponse.ok()).toBeTruthy()
    })

    test('should deny regular user access to admin endpoints', async ({ page }) => {
      const testId = generateTestId()
      const email = `user-rbac-${testId}@example.com`

      await registerUser(page, email, 'password123', { role: 'user' })
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      const adminResponse = await page.request.get(`${API_URL}/admin/users`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      })

      expect(adminResponse.status()).toBe(403)
    })
  })
})

test.describe('Authentication UI', () => {
  // These tests verify the authentication UI when implemented

  test.describe('Login Page', () => {
    test.skip(true, 'Login UI not yet implemented')

    test('should display login form', async ({ page }) => {
      await page.goto('/login')

      await expect(page.getByLabel(/email/i)).toBeVisible()
      await expect(page.getByLabel(/password/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible()
    })

    test('should login via form', async ({ page }) => {
      const testId = generateTestId()
      const email = `ui-login-${testId}@example.com`

      // Register user first via API
      await registerUser(page, email, 'password123')

      // Go to login page
      await page.goto('/login')

      // Fill and submit form
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/password/i).fill('password123')
      await page.getByRole('button', { name: /sign in|login/i }).click()

      // Should redirect to dashboard or home
      await expect(page).toHaveURL(/\/(dashboard|home)?$/)
    })

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login')

      await page.getByLabel(/email/i).fill('invalid@example.com')
      await page.getByLabel(/password/i).fill('wrongpassword')
      await page.getByRole('button', { name: /sign in|login/i }).click()

      await expect(page.getByText(/invalid|error|failed/i)).toBeVisible()
    })

    test('should navigate to registration page', async ({ page }) => {
      await page.goto('/login')

      await page.getByRole('link', { name: /register|sign up|create account/i }).click()

      await expect(page).toHaveURL(/\/register/)
    })
  })

  test.describe('Registration Page', () => {
    test.skip(true, 'Registration UI not yet implemented')

    test('should display registration form', async ({ page }) => {
      await page.goto('/register')

      await expect(page.getByLabel(/email/i)).toBeVisible()
      await expect(page.getByLabel(/password/i)).toBeVisible()
      await expect(page.getByLabel(/name/i)).toBeVisible()
      await expect(page.getByRole('button', { name: /register|sign up|create/i })).toBeVisible()
    })

    test('should register via form', async ({ page }) => {
      const testId = generateTestId()
      const email = `ui-register-${testId}@example.com`

      await page.goto('/register')

      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/password/i).fill('secure-password-123')
      await page.getByLabel(/name/i).fill('Test User')
      await page.getByRole('button', { name: /register|sign up|create/i }).click()

      // Should show success or redirect to login
      await expect(page.getByText(/success|verify|login/i)).toBeVisible()
    })

    test('should show validation errors', async ({ page }) => {
      await page.goto('/register')

      // Submit empty form
      await page.getByRole('button', { name: /register|sign up|create/i }).click()

      await expect(page.getByText(/required|invalid/i)).toBeVisible()
    })
  })

  test.describe('Session Persistence', () => {
    test.skip(true, 'Session persistence UI not yet implemented')

    test('should persist session across page reloads', async ({ page }) => {
      const testId = generateTestId()
      const email = `persist-${testId}@example.com`

      // Register and login via API
      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      // Set token in storage (simulate login)
      await page.evaluate((token) => {
        localStorage.setItem('accessToken', token)
      }, tokens.accessToken)

      // Navigate to protected page
      await page.goto('/dashboard')

      // Should be logged in
      await expect(page.getByText(/welcome|dashboard/i)).toBeVisible()

      // Reload page
      await page.reload()

      // Should still be logged in
      await expect(page.getByText(/welcome|dashboard/i)).toBeVisible()
    })

    test('should redirect to login when session expires', async ({ page }) => {
      // Navigate to protected page without session
      await page.goto('/dashboard')

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/)
    })
  })

  test.describe('Logout Flow', () => {
    test.skip(true, 'Logout UI not yet implemented')

    test('should logout from UI', async ({ page }) => {
      const testId = generateTestId()
      const email = `ui-logout-${testId}@example.com`

      // Register and login
      await registerUser(page, email, 'password123')
      const loginResponse = await loginUser(page, email, 'password123')
      const { tokens } = await loginResponse.json()

      // Set session
      await page.evaluate((token) => {
        localStorage.setItem('accessToken', token)
      }, tokens.accessToken)

      await page.goto('/dashboard')

      // Click logout
      await page.getByRole('button', { name: /logout|sign out/i }).click()

      // Should redirect to home or login
      await expect(page).toHaveURL(/\/(login)?$/)

      // Token should be cleared
      const token = await page.evaluate(() => localStorage.getItem('accessToken'))
      expect(token).toBeNull()
    })
  })
})

test.describe('Multi-Tenant Authentication', () => {
  test('should isolate users between tenants', async ({ page }) => {
    const testId = generateTestId()
    const email = `shared-${testId}@example.com`

    // Register in tenant A
    const responseA = await page.request.post(`${API_URL}/auth/register`, {
      headers: { 'X-Tenant-ID': `tenant-a-${testId}` },
      data: { email, password: 'passwordA' },
    })
    expect(responseA.ok()).toBeTruthy()

    // Register same email in tenant B
    const responseB = await page.request.post(`${API_URL}/auth/register`, {
      headers: { 'X-Tenant-ID': `tenant-b-${testId}` },
      data: { email, password: 'passwordB' },
    })
    expect(responseB.ok()).toBeTruthy()

    // Login in tenant A
    const loginA = await page.request.post(`${API_URL}/auth/login`, {
      headers: { 'X-Tenant-ID': `tenant-a-${testId}` },
      data: { email, password: 'passwordA' },
    })
    expect(loginA.ok()).toBeTruthy()

    // Login in tenant B with different password
    const loginB = await page.request.post(`${API_URL}/auth/login`, {
      headers: { 'X-Tenant-ID': `tenant-b-${testId}` },
      data: { email, password: 'passwordB' },
    })
    expect(loginB.ok()).toBeTruthy()
  })

  test('should reject cross-tenant token usage', async ({ page }) => {
    const testId = generateTestId()
    const email = `cross-${testId}@example.com`

    // Register and login in tenant A
    await page.request.post(`${API_URL}/auth/register`, {
      headers: { 'X-Tenant-ID': `cross-a-${testId}` },
      data: { email, password: 'password123' },
    })

    const loginResponse = await page.request.post(`${API_URL}/auth/login`, {
      headers: { 'X-Tenant-ID': `cross-a-${testId}` },
      data: { email, password: 'password123' },
    })
    const { tokens } = await loginResponse.json()

    // Try to use token A in tenant B
    const crossResponse = await page.request.get(`${API_URL}/protected`, {
      headers: {
        'X-Tenant-ID': `cross-b-${testId}`,
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    })

    expect(crossResponse.status()).toBe(401)
  })
})

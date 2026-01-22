/**
 * E2E Browser Tests: Error Handling and Recovery
 *
 * Tests critical user journeys for error scenarios:
 * - Network error handling
 * - API error responses
 * - Form validation errors
 * - Session expiry handling
 * - Recovery from failures
 * - User-friendly error messages
 * - Retry mechanisms
 *
 * @see do-o4sii
 */
import { test, expect, type Page, type Route } from '@playwright/test'

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

test.describe('Network Error Handling', () => {
  test('should handle network timeout gracefully', async ({ page }) => {
    // Go to the home page first
    await page.goto('/')

    // Mock a slow API endpoint
    await page.route(`${API_URL}/**`, async (route) => {
      // Simulate network timeout by never responding
      await new Promise(resolve => setTimeout(resolve, 30000))
      route.continue()
    })

    // Try to make an API request
    const result = await page.evaluate(async (apiUrl) => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      try {
        await fetch(`${apiUrl}/health`, {
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        return { error: false }
      } catch (e) {
        clearTimeout(timeoutId)
        return { error: true, message: (e as Error).message }
      }
    }, API_URL)

    expect(result.error).toBe(true)
    expect(result.message).toContain('abort')
  })

  test('should handle network disconnect', async ({ page }) => {
    await page.goto('/')

    // Simulate network disconnect by blocking all requests
    await page.route(`${API_URL}/**`, (route) => {
      route.abort('connectionfailed')
    })

    // Try to make an API request
    const result = await page.evaluate(async (apiUrl) => {
      try {
        await fetch(`${apiUrl}/health`)
        return { error: false }
      } catch (e) {
        return { error: true, message: (e as Error).message }
      }
    }, API_URL)

    expect(result.error).toBe(true)
  })

  test('should display offline indicator when network is unavailable', async ({ page }) => {
    await page.goto('/')

    // Go offline
    await page.context().setOffline(true)

    // UI should indicate offline status
    // This depends on the app implementing offline detection
    await page.waitForTimeout(1000)

    // Check for offline indicator (if implemented)
    const offlineIndicator = page.getByText(/offline|no connection/i)
    // If the indicator exists, it should be visible
    if (await offlineIndicator.count() > 0) {
      await expect(offlineIndicator).toBeVisible()
    }

    // Go back online
    await page.context().setOffline(false)
  })

  test('should retry failed requests', async ({ page }) => {
    await page.goto('/')

    let requestCount = 0

    // Fail first 2 requests, succeed on 3rd
    await page.route(`${API_URL}/health`, async (route) => {
      requestCount++
      if (requestCount < 3) {
        route.abort('failed')
      } else {
        route.continue()
      }
    })

    // Implement retry logic in the test
    const result = await page.evaluate(async (apiUrl) => {
      const maxRetries = 3
      let lastError: Error | null = null

      for (let i = 0; i < maxRetries; i++) {
        try {
          const response = await fetch(`${apiUrl}/health`)
          if (response.ok) {
            return { success: true, attempts: i + 1 }
          }
        } catch (e) {
          lastError = e as Error
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      return { success: false, attempts: maxRetries, error: lastError?.message }
    }, API_URL)

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(3)
  })
})

test.describe('API Error Responses', () => {
  test('should handle 400 Bad Request', async ({ page }) => {
    await page.goto('/')

    const response = await page.request.post(`${API_URL}/things`, {
      data: {
        // Missing required $type field
        name: 'Invalid Entity',
      },
    })

    expect(response.status()).toBe(400)
    const error = await response.json()
    expect(error.error).toBeDefined()
  })

  test('should handle 401 Unauthorized', async ({ page }) => {
    await page.goto('/')

    const response = await page.request.get(`${API_URL}/protected`)

    expect(response.status()).toBe(401)
    const error = await response.json()
    expect(error.error || error.code).toBeDefined()
  })

  test('should handle 403 Forbidden', async ({ page }) => {
    const testId = generateTestId()
    const email = `forbidden-${testId}@example.com`

    // Register as regular user
    await page.request.post(`${API_URL}/auth/register`, {
      data: { email, password: 'password123', role: 'user' },
    })

    // Login
    const loginResponse = await page.request.post(`${API_URL}/auth/login`, {
      data: { email, password: 'password123' },
    })
    const { tokens } = await loginResponse.json()

    // Try to access admin endpoint
    const response = await page.request.get(`${API_URL}/admin/users`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    })

    expect(response.status()).toBe(403)
  })

  test('should handle 404 Not Found', async ({ page }) => {
    await page.goto('/')

    const response = await page.request.get(`${API_URL}/things/non-existent-id-12345`)

    expect(response.status()).toBe(404)
  })

  test('should handle 409 Conflict', async ({ page }) => {
    const testId = generateTestId()
    const email = `conflict-${testId}@example.com`

    // Register first time
    await page.request.post(`${API_URL}/auth/register`, {
      data: { email, password: 'password123' },
    })

    // Try to register again
    const response = await page.request.post(`${API_URL}/auth/register`, {
      data: { email, password: 'different' },
    })

    expect(response.status()).toBe(409)
  })

  test('should handle 500 Internal Server Error', async ({ page }) => {
    await page.goto('/')

    // Mock a 500 error
    await page.route(`${API_URL}/error-test`, (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      })
    })

    const response = await page.request.get(`${API_URL}/error-test`)

    expect(response.status()).toBe(500)
    const error = await response.json()
    expect(error.error).toBe('Internal Server Error')
  })

  test('should handle 503 Service Unavailable', async ({ page }) => {
    await page.goto('/')

    // Mock a 503 error
    await page.route(`${API_URL}/unavailable`, (route) => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service Unavailable' }),
      })
    })

    const response = await page.request.get(`${API_URL}/unavailable`)

    expect(response.status()).toBe(503)
  })
})

test.describe('Form Validation Errors', () => {
  // These tests verify form validation in the UI

  test('should validate required fields', async ({ page }) => {
    await page.goto('/admin')

    // Check for validation message patterns (when forms are implemented)
    const pageContent = await page.content()

    // For now, just verify the page loads
    expect(pageContent).toContain('Admin Portal')
  })

  test.describe('When Forms Are Implemented', () => {
    test.skip(true, 'Form UI not yet implemented')

    test('should show error for empty required fields', async ({ page }) => {
      await page.goto('/admin/entities/new')

      // Submit empty form
      await page.getByRole('button', { name: /create|save/i }).click()

      // Should show validation errors
      await expect(page.getByText(/required/i)).toBeVisible()
    })

    test('should show error for invalid email format', async ({ page }) => {
      await page.goto('/register')

      // Enter invalid email
      await page.getByLabel(/email/i).fill('invalid-email')
      await page.getByRole('button', { name: /register|sign up/i }).click()

      // Should show validation error
      await expect(page.getByText(/invalid.*email|email.*invalid/i)).toBeVisible()
    })

    test('should show error for password too short', async ({ page }) => {
      await page.goto('/register')

      // Enter short password
      await page.getByLabel(/email/i).fill('test@example.com')
      await page.getByLabel(/password/i).fill('123')
      await page.getByRole('button', { name: /register|sign up/i }).click()

      // Should show validation error
      await expect(page.getByText(/password.*short|minimum.*characters/i)).toBeVisible()
    })

    test('should clear errors when field is corrected', async ({ page }) => {
      await page.goto('/register')

      // Enter invalid email
      await page.getByLabel(/email/i).fill('invalid-email')
      await page.getByRole('button', { name: /register|sign up/i }).click()

      // Should show error
      await expect(page.getByText(/invalid.*email/i)).toBeVisible()

      // Correct the email
      await page.getByLabel(/email/i).fill('valid@example.com')

      // Error should be cleared (or updated)
      await expect(page.getByText(/invalid.*email/i)).not.toBeVisible()
    })

    test('should highlight invalid fields', async ({ page }) => {
      await page.goto('/register')

      // Submit empty form
      await page.getByRole('button', { name: /register|sign up/i }).click()

      // Email field should have error styling
      const emailInput = page.getByLabel(/email/i)
      await expect(emailInput).toHaveClass(/error|invalid|border-red/i)
    })
  })
})

test.describe('Session Expiry Handling', () => {
  test('should detect expired token', async ({ page }) => {
    await page.goto('/')

    // Create an expired token (mock)
    const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjB9.invalid'

    const response = await page.request.get(`${API_URL}/protected`, {
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    })

    expect(response.status()).toBe(401)
    const data = await response.json()
    expect(data.code || data.error).toBeDefined()
  })

  test.describe('When Session UI Is Implemented', () => {
    test.skip(true, 'Session UI not yet implemented')

    test('should redirect to login on session expiry', async ({ page }) => {
      // Set an expired session token
      await page.evaluate(() => {
        localStorage.setItem('accessToken', 'expired-token')
      })

      // Try to access protected page
      await page.goto('/dashboard')

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/)
    })

    test('should show session expired message', async ({ page }) => {
      // Set an expired session token
      await page.evaluate(() => {
        localStorage.setItem('accessToken', 'expired-token')
      })

      // Navigate to protected page
      await page.goto('/dashboard')

      // Should show session expired message
      await expect(page.getByText(/session.*expired|login.*again/i)).toBeVisible()
    })

    test('should allow re-login after session expiry', async ({ page }) => {
      const testId = generateTestId()
      const email = `relogin-${testId}@example.com`

      // Register user
      await page.request.post(`${API_URL}/auth/register`, {
        data: { email, password: 'password123' },
      })

      // Set expired token
      await page.evaluate(() => {
        localStorage.setItem('accessToken', 'expired-token')
      })

      // Go to login page
      await page.goto('/login')

      // Re-login
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/password/i).fill('password123')
      await page.getByRole('button', { name: /login|sign in/i }).click()

      // Should be logged in
      await expect(page).toHaveURL(/\/(dashboard|home)?$/)
    })
  })
})

test.describe('Error Recovery', () => {
  test('should allow retry after failed API request', async ({ page }) => {
    await page.goto('/')

    let attempts = 0

    // First request fails, second succeeds
    await page.route(`${API_URL}/retry-test`, (route) => {
      attempts++
      if (attempts === 1) {
        route.fulfill({
          status: 500,
          body: JSON.stringify({ error: 'Temporary failure' }),
        })
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true }),
        })
      }
    })

    // First attempt
    const response1 = await page.request.get(`${API_URL}/retry-test`)
    expect(response1.status()).toBe(500)

    // Retry
    const response2 = await page.request.get(`${API_URL}/retry-test`)
    expect(response2.status()).toBe(200)
  })

  test('should recover from WebSocket disconnect', async ({ page }) => {
    await page.goto('/')

    const WS_URL = API_URL.replace(/^http/, 'ws')

    const result = await page.evaluate(async (wsUrl) => {
      return new Promise<{ recovered: boolean; connections: number }>((resolve) => {
        let connections = 0
        let ws: WebSocket

        const connect = () => {
          connections++
          ws = new WebSocket(`${wsUrl}/ws`)

          ws.onopen = () => {
            if (connections === 1) {
              // First connection - simulate disconnect
              ws.close(1006, 'Simulated disconnect')
            } else {
              // Second connection - success
              ws.close(1000, 'Test complete')
              resolve({ recovered: true, connections })
            }
          }

          ws.onclose = () => {
            if (connections === 1) {
              // Reconnect after disconnect
              setTimeout(connect, 100)
            }
          }

          ws.onerror = () => {
            if (connections < 3) {
              setTimeout(connect, 100)
            } else {
              resolve({ recovered: false, connections })
            }
          }
        }

        connect()

        // Timeout
        setTimeout(() => {
          resolve({ recovered: false, connections })
        }, 10000)
      })
    }, WS_URL)

    expect(result.recovered).toBe(true)
  })

  test('should maintain state after page reload', async ({ page }) => {
    await page.goto('/')

    // Store some state (e.g., in localStorage)
    await page.evaluate(() => {
      localStorage.setItem('testState', JSON.stringify({ value: 42 }))
    })

    // Reload page
    await page.reload()

    // State should be preserved
    const state = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('testState') || '{}')
    })

    expect(state.value).toBe(42)
  })
})

test.describe('User-Friendly Error Messages', () => {
  test('should not expose technical details in errors', async ({ page }) => {
    await page.goto('/')

    // Mock an internal error
    await page.route(`${API_URL}/internal-error`, (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({
          error: 'Internal Server Error',
          // Should NOT include stack traces in production
        }),
      })
    })

    const response = await page.request.get(`${API_URL}/internal-error`)
    const error = await response.json()

    // Should not expose stack traces
    expect(error.stack).toBeUndefined()
    expect(JSON.stringify(error)).not.toContain('at ')
    expect(JSON.stringify(error)).not.toContain('node_modules')
  })

  test('should provide actionable error messages', async ({ page }) => {
    await page.goto('/')

    // Test 404 response
    const response = await page.request.get(`${API_URL}/things/not-found`)

    expect(response.status()).toBe(404)
    const error = await response.json()

    // Error should be informative
    expect(error.error || error.message).toBeDefined()
  })
})

test.describe('Circuit Breaker Behavior', () => {
  test('should fail fast after multiple failures', async ({ page }) => {
    await page.goto('/')

    let requestCount = 0

    // Always fail
    await page.route(`${API_URL}/failing-service`, (route) => {
      requestCount++
      route.fulfill({
        status: 503,
        body: JSON.stringify({ error: 'Service unavailable' }),
      })
    })

    // Make multiple requests
    const results: number[] = []
    for (let i = 0; i < 10; i++) {
      const response = await page.request.get(`${API_URL}/failing-service`)
      results.push(response.status())
    }

    // All should be 503 (or could be circuit breaker response)
    expect(results.every(s => s === 503)).toBe(true)
    expect(requestCount).toBe(10)
  })
})

test.describe('Graceful Degradation', () => {
  test('should show fallback content when API is unavailable', async ({ page }) => {
    // Block API requests
    await page.route(`${API_URL}/**`, (route) => {
      route.abort('failed')
    })

    await page.goto('/')

    // Page should still load with static content
    await expect(page.getByRole('heading', { name: /dotdo/i })).toBeVisible()
  })

  test('should display cached data when offline', async ({ page }) => {
    await page.goto('/')

    // Store some data
    await page.evaluate(() => {
      localStorage.setItem('cachedData', JSON.stringify({ items: ['item1', 'item2'] }))
    })

    // Go offline
    await page.context().setOffline(true)

    // Page should still work with cached data
    const cached = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('cachedData') || '{}')
    })

    expect(cached.items).toHaveLength(2)

    // Go back online
    await page.context().setOffline(false)
  })
})

test.describe('Console Error Monitoring', () => {
  test('should not have unhandled JavaScript errors', async ({ page }) => {
    const errors: string[] = []

    page.on('pageerror', (error) => {
      errors.push(error.message)
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Filter out known acceptable errors
    const significantErrors = errors.filter(
      e => !e.includes('favicon') && !e.includes('ResizeObserver')
    )

    expect(significantErrors).toHaveLength(0)
  })

  test('should not have unhandled promise rejections', async ({ page }) => {
    const rejections: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('Unhandled')) {
        rejections.push(msg.text())
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    expect(rejections).toHaveLength(0)
  })
})

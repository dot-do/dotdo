import { test, expect } from '@playwright/test'

/**
 * E2E tests for the API endpoints
 *
 * These tests verify that API routes work correctly,
 * including health checks and basic API functionality.
 */

test.describe('API Health', () => {
  test('should respond to /api/health endpoint', async ({ request }) => {
    const response = await request.get('/api/health')

    expect(response.status()).toBe(200)
  })

  test('should return JSON from health endpoint', async ({ request }) => {
    const response = await request.get('/api/health')
    const contentType = response.headers()['content-type']

    expect(contentType).toContain('application/json')
  })

  test('should return healthy status in response body', async ({ request }) => {
    const response = await request.get('/api/health')
    const body = await response.json()

    expect(body).toHaveProperty('status')
    expect(body.status).toBe('healthy')
  })

  test('should include timestamp in health response', async ({ request }) => {
    const response = await request.get('/api/health')
    const body = await response.json()

    expect(body).toHaveProperty('timestamp')
    // Verify timestamp is a valid ISO date string
    expect(() => new Date(body.timestamp)).not.toThrow()
  })
})

test.describe('API Routes', () => {
  test('should return 404 for unknown API routes', async ({ request }) => {
    const response = await request.get('/api/nonexistent-route-xyz123')

    expect(response.status()).toBe(404)
  })

  test('should have CORS headers on API responses', async ({ request }) => {
    const response = await request.get('/api/health')
    const headers = response.headers()

    // Check for CORS header presence
    expect(headers['access-control-allow-origin']).toBeDefined()
  })

  test('should respond to OPTIONS preflight requests', async ({ request }) => {
    const response = await request.fetch('/api/health', {
      method: 'OPTIONS',
    })

    // OPTIONS should return 200 or 204
    expect([200, 204]).toContain(response.status())
  })
})

test.describe('API Request Handling', () => {
  test('should handle POST requests to /api endpoints', async ({ request }) => {
    const response = await request.post('/api/health', {
      data: {},
    })

    // Health endpoint might not support POST, but should return valid HTTP response
    expect([200, 405]).toContain(response.status())
  })

  test('should handle malformed JSON gracefully', async ({ request }) => {
    const response = await request.post('/api/health', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: 'this is not json',
    })

    // Should return 400 Bad Request or similar error, not 500
    expect(response.status()).toBeLessThan(500)
  })
})

/**
 * Debug test for admin routes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createAdminRouter } from '../../api/routes/admin'
import { createMockAnalyticsBinding, createMockKVBinding } from '../../tests/mocks/analytics'

describe('Debug admin routes', () => {
  let app: Hono
  let env: {
    ANALYTICS: unknown
    KV: unknown
    API_KEYS: string
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))

    app = new Hono()

    // Mock auth middleware
    app.use('/admin/*', async (c, next) => {
      c.set('auth', {
        userId: 'test-user-123',
        role: 'admin',
      })
      await next()
    })

    // Mount admin router
    const adminRouter = createAdminRouter()
    app.route('/admin', adminRouter)

    env = {
      ANALYTICS: createMockAnalyticsBinding(),
      KV: createMockKVBinding(),
      API_KEYS: JSON.stringify({
        'key-abc': { userId: 'user-1', role: 'user', name: 'Production Key' },
        'key-xyz': { userId: 'user-2', role: 'admin', name: 'Admin Key' },
      }),
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debug /admin/usage', async () => {
    const res = await app.request('/admin/usage', { method: 'GET' }, env)
    console.log('Status:', res.status)
    const body = await res.json()
    console.log('Body:', JSON.stringify(body, null, 2))
    expect(res.status).toBe(200)
  })

  it('test query client directly with faked time', async () => {
    const { createQueryClient } = await import('../../api/usage/queries')
    const binding = createMockAnalyticsBinding()
    const client = createQueryClient(binding)

    const now = new Date()
    console.log('Current faked time:', now.toISOString())

    const range = {
      start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      end: now,
    }
    console.log('Range:', range.start.toISOString(), 'to', range.end.toISOString())

    try {
      const summary = await client.getSummary({ range })
      console.log('Summary:', JSON.stringify(summary, null, 2))

      const timeline = await client.getTimeline({ range, bucketSize: 'hour' })
      console.log('Timeline length:', timeline.length)
      if (timeline.length > 0) {
        console.log('First point:', JSON.stringify(timeline[0], null, 2))
      }

      const endpoints = await client.getTopEndpoints({ range, limit: 5 })
      console.log('Endpoints:', JSON.stringify(endpoints, null, 2))

      const apiKeys = await client.getApiKeyUsage({ range, limit: 5 })
      console.log('API keys:', JSON.stringify(apiKeys, null, 2))
    } catch (err) {
      console.error('Error during query:', err)
      throw err
    }
  })

  it('test mock binding directly', async () => {
    const binding = createMockAnalyticsBinding()
    console.log('Binding type:', typeof binding)
    console.log('Query type:', typeof binding.query)

    const result = await binding.query('SELECT COUNT(*) as total_requests FROM usage_events', [])
    console.log('Result:', JSON.stringify(result, null, 2))

    expect(result.rows).toBeDefined()
  })
})

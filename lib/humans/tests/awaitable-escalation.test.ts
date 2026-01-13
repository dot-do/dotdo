/**
 * Awaitable Human Escalation Tests
 *
 * Tests for the blocking approval pattern where:
 * - `await ceo\`approve partnership\`` blocks until human responds
 * - Returns ApprovalResult with { approved, reason, approver }
 * - Supports timeout/SLA via .timeout() method
 * - Integrates with Human DO for persistence
 *
 * @see dotdo-8hf0b - Make human escalation awaitable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  HumanRequest,
  HumanClient,
  HumanTimeoutError,
  configureHumanClient,
  parseDuration,
  createHumanTemplate,
  ceo,
  legal,
  cfo,
  type ApprovalResult,
  type PendingApprovalRecord,
} from '../templates'

// ============================================================================
// Mock Fetch for Testing
// ============================================================================

interface MockRequest {
  requestId: string
  role: string
  message: string
  sla?: number
  channel?: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  result?: ApprovalResult
}

function createMockFetch(responses: Map<string, MockRequest> = new Map()) {
  return vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
    const urlObj = new URL(url)
    const path = urlObj.pathname

    // POST /request - Submit new request
    if (path === '/request' && options?.method === 'POST') {
      const body = JSON.parse(options.body as string)
      const record: MockRequest = {
        requestId: body.requestId,
        role: body.role,
        message: body.message,
        sla: body.sla,
        channel: body.channel,
        status: 'pending',
      }
      responses.set(body.requestId, record)
      return new Response(JSON.stringify(record), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /request/:id - Get status
    const getMatch = path.match(/^\/request\/([^/]+)$/)
    if (getMatch && (!options?.method || options?.method === 'GET')) {
      const requestId = getMatch[1]!
      const record = responses.get(requestId)
      if (!record) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(record), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /request/:id/respond - Submit response
    const respondMatch = path.match(/^\/request\/([^/]+)\/respond$/)
    if (respondMatch && options?.method === 'POST') {
      const requestId = respondMatch[1]!
      const body = JSON.parse(options.body as string)
      const record = responses.get(requestId)
      if (!record) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      record.status = body.approved ? 'approved' : 'rejected'
      record.result = {
        approved: body.approved,
        approver: body.approver || 'test-user',
        reason: body.reason,
        respondedAt: new Date(),
      }
      return new Response(JSON.stringify(record), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  })
}

// ============================================================================
// parseDuration Tests
// ============================================================================

describe('parseDuration()', () => {
  it('parses seconds', () => {
    expect(parseDuration('30 seconds')).toBe(30000)
    expect(parseDuration('1 second')).toBe(1000)
  })

  it('parses minutes', () => {
    expect(parseDuration('5 minutes')).toBe(300000)
    expect(parseDuration('1 minute')).toBe(60000)
  })

  it('parses hours', () => {
    expect(parseDuration('4 hours')).toBe(14400000)
    expect(parseDuration('1 hour')).toBe(3600000)
  })

  it('parses days', () => {
    expect(parseDuration('2 days')).toBe(172800000)
    expect(parseDuration('1 day')).toBe(86400000)
  })

  it('parses weeks', () => {
    expect(parseDuration('1 week')).toBe(604800000)
    expect(parseDuration('2 weeks')).toBe(1209600000)
  })

  it('throws on invalid format', () => {
    expect(() => parseDuration('invalid')).toThrow('Invalid duration format')
    expect(() => parseDuration('5 years')).toThrow('Invalid duration format')
    expect(() => parseDuration('')).toThrow('Invalid duration format')
  })
})

// ============================================================================
// HumanClient Tests
// ============================================================================

describe('HumanClient', () => {
  let mockFetch: ReturnType<typeof createMockFetch>
  let responses: Map<string, MockRequest>

  beforeEach(() => {
    responses = new Map()
    mockFetch = createMockFetch(responses)
  })

  it('submits request and polls until approved', async () => {
    const client = new HumanClient({
      baseUrl: 'https://human.do',
      defaultTimeout: 10000,
      fetch: mockFetch,
    })

    // Simulate approval after 2 polls
    let pollCount = 0
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string)
        responses.set(body.requestId, {
          requestId: body.requestId,
          role: body.role,
          message: body.message,
          status: 'pending',
        })
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        pollCount++
        const record = responses.get(getMatch[1]!)!
        if (pollCount >= 2) {
          record.status = 'approved'
          record.result = {
            approved: true,
            approver: 'ceo@company.com',
            reason: 'Approved for strategic partnership',
          }
        }
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await client.requestApproval({
      requestId: 'test-123',
      role: 'ceo',
      message: 'approve partnership',
    })

    expect(result.approved).toBe(true)
    expect(result.approver).toBe('ceo@company.com')
    expect(result.reason).toBe('Approved for strategic partnership')
    expect(pollCount).toBeGreaterThanOrEqual(2)
  })

  it('returns rejection result', async () => {
    const client = new HumanClient({
      baseUrl: 'https://human.do',
      fetch: mockFetch,
    })

    // Immediately reject
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        return new Response(JSON.stringify({
          requestId: getMatch[1],
          status: 'rejected',
          result: {
            approved: false,
            approver: 'ceo@company.com',
            reason: 'Budget constraints',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    const result = await client.requestApproval({
      requestId: 'test-456',
      role: 'ceo',
      message: 'approve large expense',
    })

    expect(result.approved).toBe(false)
    expect(result.reason).toBe('Budget constraints')
  })

  it('throws HumanTimeoutError when request expires', async () => {
    const client = new HumanClient({
      baseUrl: 'https://human.do',
      defaultTimeout: 100, // Very short timeout
      fetch: mockFetch,
    })

    // Always return pending status
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        return new Response(JSON.stringify({
          requestId: getMatch[1],
          status: 'pending',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    await expect(
      client.requestApproval({
        requestId: 'test-timeout',
        role: 'ceo',
        message: 'approve something',
        sla: 100,
      })
    ).rejects.toThrow(HumanTimeoutError)
  })

  it('throws HumanTimeoutError when server returns expired status', async () => {
    const client = new HumanClient({
      baseUrl: 'https://human.do',
      fetch: mockFetch,
    })

    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        return new Response(JSON.stringify({
          requestId: getMatch[1],
          status: 'expired',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    await expect(
      client.requestApproval({
        requestId: 'test-expired',
        role: 'ceo',
        message: 'approve something',
      })
    ).rejects.toThrow(HumanTimeoutError)
  })
})

// ============================================================================
// HumanRequest Tests
// ============================================================================

describe('HumanRequest', () => {
  let mockFetch: ReturnType<typeof createMockFetch>
  let responses: Map<string, MockRequest>

  beforeEach(() => {
    responses = new Map()
    mockFetch = createMockFetch(responses)

    // Configure global client with mock
    configureHumanClient({
      baseUrl: 'https://human.do',
      defaultTimeout: 5000,
      fetch: mockFetch,
    })
  })

  it('implements PromiseLike<ApprovalResult>', () => {
    const request = new HumanRequest('ceo', 'test message')
    // Should have .then() method (PromiseLike)
    expect(typeof request.then).toBe('function')
    expect(typeof request.catch).toBe('function')
    expect(typeof request.finally).toBe('function')
  })

  it('has role property', () => {
    const request = new HumanRequest('ceo', 'test')
    expect(request.role).toBe('ceo')
  })

  it('has message property', () => {
    const request = new HumanRequest('ceo', 'approve partnership')
    expect(request.message).toBe('approve partnership')
  })

  it('has requestId property', () => {
    const request = new HumanRequest('ceo', 'test')
    expect(request.requestId).toMatch(/^hr-/)
  })

  it('chains .timeout() and preserves properties', () => {
    const request = new HumanRequest('ceo', 'test')
    const withTimeout = request.timeout('4 hours')

    expect(withTimeout.role).toBe('ceo')
    expect(withTimeout.message).toBe('test')
    expect(withTimeout.sla).toBe(14400000)
  })

  it('chains .via() and preserves properties', () => {
    const request = new HumanRequest('ceo', 'test')
    const withChannel = request.via('slack')

    expect(withChannel.role).toBe('ceo')
    expect(withChannel.message).toBe('test')
    expect(withChannel.channel).toBe('slack')
  })

  it('chains .timeout().via() together', () => {
    const request = new HumanRequest('ceo', 'test')
    const configured = request.timeout('1 hour').via('email')

    expect(configured.sla).toBe(3600000)
    expect(configured.channel).toBe('email')
  })
})

// ============================================================================
// Template Literal Integration Tests
// ============================================================================

describe('Template Literal Pattern', () => {
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch()

    // Configure to immediately approve
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        return new Response(JSON.stringify({
          requestId: getMatch[1],
          status: 'approved',
          result: {
            approved: true,
            approver: 'test@company.com',
            reason: 'Approved',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not found', { status: 404 })
    })

    configureHumanClient({
      baseUrl: 'https://human.do',
      fetch: mockFetch,
    })
  })

  it('ceo`approve partnership` returns HumanRequest', () => {
    const request = ceo`approve the partnership`
    expect(request).toBeInstanceOf(HumanRequest)
    expect(request.role).toBe('ceo')
    expect(request.message).toBe('approve the partnership')
  })

  it('legal`review contract` returns HumanRequest', () => {
    const request = legal`review this contract`
    expect(request.role).toBe('legal')
    expect(request.message).toBe('review this contract')
  })

  it('supports interpolation in template', () => {
    const amount = '$50,000'
    const request = cfo`approve expense of ${amount}`
    expect(request.message).toBe('approve expense of $50,000')
  })

  it('createHumanTemplate works for custom roles', () => {
    const seniorAccountant = createHumanTemplate('senior-accountant')
    const request = seniorAccountant`approve refund over $10000`
    expect(request.role).toBe('senior-accountant')
  })

  it('can be awaited for ApprovalResult', async () => {
    const result = await ceo`approve partnership`

    expect(result).toHaveProperty('approved')
    expect(result.approved).toBe(true)
    expect(result.approver).toBe('test@company.com')
  })

  it('result has reason field', async () => {
    const result = await ceo`approve partnership`
    expect(result.reason).toBe('Approved')
  })

  it('matches CLAUDE.md pattern: const approved = await ceo`approve partnership`', async () => {
    // This is the exact pattern from CLAUDE.md
    const { approved, reason } = await ceo`approve the partnership`

    expect(typeof approved).toBe('boolean')
    expect(approved).toBe(true)
  })

  it('matches CLAUDE.md pattern: destructured result with conditional', async () => {
    // From CLAUDE.md:
    // const { approved, reason } = await legal`review this contract`
    // if (!approved) throw new Error(`Rejected: ${reason}`)

    const { approved, reason } = await legal`review this contract`

    if (!approved) {
      throw new Error(`Rejected: ${reason}`)
    }

    expect(approved).toBe(true)
  })
})

// ============================================================================
// HumanTimeoutError Tests
// ============================================================================

describe('HumanTimeoutError', () => {
  it('has correct name', () => {
    const error = new HumanTimeoutError(5000, 'test-123')
    expect(error.name).toBe('HumanTimeoutError')
  })

  it('has timeout property', () => {
    const error = new HumanTimeoutError(5000, 'test-123')
    expect(error.timeout).toBe(5000)
  })

  it('has requestId property', () => {
    const error = new HumanTimeoutError(5000, 'test-123')
    expect(error.requestId).toBe('test-123')
  })

  it('has descriptive message', () => {
    const error = new HumanTimeoutError(5000, 'test-123')
    expect(error.message).toContain('5000ms')
    expect(error.message).toContain('test-123')
  })
})

// ============================================================================
// Vision Compliance Tests (from CLAUDE.md)
// ============================================================================

describe('Vision Compliance - CLAUDE.md Examples', () => {
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    mockFetch = createMockFetch()
    configureHumanClient({
      baseUrl: 'https://human.do',
      fetch: mockFetch,
    })
  })

  it('Example 1: const approved = await ceo`approve the partnership`', async () => {
    // Configure approved response
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        return new Response(JSON.stringify({
          requestId: getMatch[1],
          status: 'approved',
          result: { approved: true },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      return new Response('Not found', { status: 404 })
    })

    // THE VISION: This must work
    const { approved } = await ceo`approve the partnership`
    expect(approved).toBe(true)
  })

  it('Example 2: const { approved, reason } = await legal`review this contract`', async () => {
    // Configure rejected response with reason
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        return new Response(JSON.stringify({
          requestId: getMatch[1],
          status: 'rejected',
          result: {
            approved: false,
            reason: 'Contract has liability concerns in section 4.2',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      return new Response('Not found', { status: 404 })
    })

    // THE VISION: This must work
    const { approved, reason } = await legal`review this contract`
    expect(approved).toBe(false)
    expect(reason).toBe('Contract has liability concerns in section 4.2')
  })

  it('Example 3: if (!approved) throw new Error(`Rejected: ${reason}`)', async () => {
    // Configure rejection
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        return new Response(JSON.stringify({
          requestId: getMatch[1],
          status: 'rejected',
          result: {
            approved: false,
            reason: 'Not aligned with company strategy',
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      return new Response('Not found', { status: 404 })
    })

    // THE VISION: This pattern must work
    const { approved, reason } = await legal`review this contract`
    expect(() => {
      if (!approved) throw new Error(`Rejected: ${reason}`)
    }).toThrow('Rejected: Not aligned with company strategy')
  })

  it('Example 4: HumanFunction with trigger and SLA', async () => {
    // From CLAUDE.md:
    // escalation = this.HumanFunction({
    //   trigger: 'refund > $10000',
    //   role: 'senior-accountant',
    //   sla: '4 hours',
    // })

    // Track the SLA value that was submitted
    let capturedSla: number | undefined

    // Configure response
    mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const urlObj = new URL(url)
      const path = urlObj.pathname

      if (path === '/request' && options?.method === 'POST') {
        const body = JSON.parse(options.body as string)
        capturedSla = body.sla
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }

      const getMatch = path.match(/^\/request\/([^/]+)$/)
      if (getMatch) {
        return new Response(JSON.stringify({
          requestId: getMatch[1],
          status: 'approved',
          result: { approved: true },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }

      return new Response('Not found', { status: 404 })
    })

    // Using template literal with SLA
    const seniorAccountant = createHumanTemplate('senior-accountant')
    const { approved } = await seniorAccountant`approve refund of $15000`.timeout('4 hours')

    expect(approved).toBe(true)
    expect(capturedSla).toBe(14400000) // 4 hours in ms
  })
})

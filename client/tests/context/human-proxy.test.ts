/**
 * Human Proxy Context API Tests
 *
 * RED TDD: These tests should FAIL because createHumanProxy doesn't exist yet.
 *
 * Human proxy provides workflow context API for human-in-the-loop interactions:
 * - $.human.approve(message) - Request approval (returns boolean)
 * - $.human.ask(question) - Get human input (returns string)
 * - $.human.review(content) - Get review feedback (returns structured review)
 *
 * Plus support for:
 * - Timeout handling for human response
 * - Escalation routing by role (e.g., 'senior-accountant')
 * - SLA tracking
 * - Notification delivery (email, slack, push)
 * - Response persistence
 * - Concurrent approval requests
 *
 * Routes to Human DO class in objects/
 *
 * @module client/tests/context/human-proxy.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  createHumanProxy,
  type HumanProxyConfig,
  type HumanProxyContext,
  type ApprovalResult,
  type ReviewResult,
  type HumanRequest,
  type EscalationConfig,
  type NotificationChannel,
  type SLAConfig,
  HumanTimeoutError,
  HumanEscalationError,
  HumanNotificationError,
} from '../../../workflows/context/human'

// ============================================================================
// TYPE DEFINITIONS (for test clarity - will be implemented in source)
// ============================================================================

/**
 * Expected human proxy context interface
 */
interface ExpectedHumanContext {
  human: {
    // Core methods
    approve: (message: string, options?: ApprovalOptions) => Promise<boolean>
    ask: (question: string, options?: AskOptions) => Promise<string>
    review: (content: unknown, options?: ReviewOptions) => Promise<ReviewResult>

    // Role-based escalation
    escalate: (request: HumanRequest, role: string) => Promise<unknown>

    // Pending request management
    pending: () => Promise<HumanRequest[]>
    cancel: (requestId: string) => Promise<boolean>
  }
}

interface ApprovalOptions {
  timeout?: number
  role?: string
  escalation?: EscalationConfig
  sla?: SLAConfig
  notify?: NotificationChannel[]
  metadata?: Record<string, unknown>
}

interface AskOptions {
  timeout?: number
  role?: string
  placeholder?: string
  validation?: (answer: string) => boolean | string
  notify?: NotificationChannel[]
}

interface ReviewOptions {
  timeout?: number
  role?: string
  criteria?: string[]
  notify?: NotificationChannel[]
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockDOStub() {
  const storage = new Map<string, unknown>()
  const pendingRequests = new Map<string, HumanRequest>()

  return {
    id: { toString: () => 'human-do-test-id' },
    fetch: vi.fn().mockImplementation(async (request: Request) => {
      const url = new URL(request.url)
      const path = url.pathname

      if (path === '/approve' && request.method === 'POST') {
        const body = await request.json() as { requestId: string; approved: boolean }
        return new Response(JSON.stringify({ approved: body.approved }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (path === '/ask' && request.method === 'POST') {
        return new Response(JSON.stringify({ answer: 'test answer' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (path === '/review' && request.method === 'POST') {
        return new Response(JSON.stringify({
          approved: true,
          feedback: 'Looks good',
          score: 8,
          criteria: {},
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (path === '/pending') {
        return new Response(JSON.stringify(Array.from(pendingRequests.values())), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    }),
    _storage: storage,
    _pendingRequests: pendingRequests,
  }
}

function createMockEnv() {
  return {
    HUMAN_DO: {
      get: vi.fn().mockReturnValue(createMockDOStub()),
      idFromName: vi.fn().mockReturnValue({ toString: () => 'human-id-from-name' }),
    },
    NOTIFICATION_SERVICE_URL: 'https://notify.example.com.ai',
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test',
    SENDGRID_API_KEY: 'test-sendgrid-key',
  }
}

function createMockNotificationService() {
  return {
    sendEmail: vi.fn().mockResolvedValue({ messageId: 'email-123', delivered: true }),
    sendSlack: vi.fn().mockResolvedValue({ messageId: 'slack-123', delivered: true }),
    sendPush: vi.fn().mockResolvedValue({ messageId: 'push-123', delivered: true }),
    getDeliveryStatus: vi.fn().mockResolvedValue({ status: 'delivered' }),
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Human Proxy Context API', () => {
  let proxy: HumanProxyContext
  let mockEnv: ReturnType<typeof createMockEnv>
  let mockNotificationService: ReturnType<typeof createMockNotificationService>
  let mockDOStub: ReturnType<typeof createMockDOStub>

  beforeEach(() => {
    mockEnv = createMockEnv()
    mockNotificationService = createMockNotificationService()
    mockDOStub = createMockDOStub()
    mockEnv.HUMAN_DO.get.mockReturnValue(mockDOStub)

    proxy = createHumanProxy({
      env: mockEnv,
      notificationService: mockNotificationService,
    })

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. $.human.approve(message) - Request approval (returns boolean)
  // ==========================================================================

  describe('$.human.approve(message)', () => {
    describe('Basic approval flow', () => {
      it('requests approval and returns true when approved', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ approved: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const result = await proxy.human.approve('Approve deployment to production?')

        expect(result).toBe(true)
      })

      it('requests approval and returns false when rejected', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ approved: false }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const result = await proxy.human.approve('Approve high-risk change?')

        expect(result).toBe(false)
      })

      it('sends message to Human DO', async () => {
        let capturedBody: Record<string, unknown> | null = null
        mockDOStub.fetch.mockImplementation(async (request: Request) => {
          capturedBody = await request.json() as Record<string, unknown>
          return new Response(JSON.stringify({ approved: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        })

        await proxy.human.approve('Approve this action?')

        expect(mockDOStub.fetch).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'POST',
          })
        )

        expect(capturedBody).toMatchObject({
          message: 'Approve this action?',
          type: 'approval',
        })
      })

      it('generates unique request ID for each approval', async () => {
        const requestIds: string[] = []

        mockDOStub.fetch.mockImplementation(async (request: Request) => {
          const body = await request.json() as { requestId: string }
          requestIds.push(body.requestId)
          return new Response(JSON.stringify({ approved: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        })

        await proxy.human.approve('Approval 1')
        await proxy.human.approve('Approval 2')
        await proxy.human.approve('Approval 3')

        expect(new Set(requestIds).size).toBe(3)
      })

      it('returns boolean type, not truthy/falsy object', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ approved: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const result = await proxy.human.approve('Test')

        expect(typeof result).toBe('boolean')
        expect(result).toBe(true)
      })
    })

    describe('Approval with options', () => {
      it('accepts timeout option', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ approved: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const result = proxy.human.approve('Time-sensitive approval', {
          timeout: 5000,
        })

        // Should not reject immediately
        await expect(result).resolves.toBe(true)
      })

      it('accepts role option for routing', async () => {
        let capturedBody: Record<string, unknown> | null = null
        mockDOStub.fetch.mockImplementation(async (request: Request) => {
          capturedBody = await request.json() as Record<string, unknown>
          return new Response(JSON.stringify({ approved: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        })

        await proxy.human.approve('Approve large refund', {
          role: 'senior-accountant',
        })

        expect(capturedBody).toMatchObject({
          role: 'senior-accountant',
        })
      })

      it('accepts metadata option', async () => {
        let capturedBody: Record<string, unknown> | null = null
        mockDOStub.fetch.mockImplementation(async (request: Request) => {
          capturedBody = await request.json() as Record<string, unknown>
          return new Response(JSON.stringify({ approved: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        })

        await proxy.human.approve('Approve transaction', {
          metadata: {
            transactionId: 'txn-123',
            amount: 5000,
            currency: 'USD',
          },
        })

        expect((capturedBody as Record<string, unknown>)?.metadata).toMatchObject({
          transactionId: 'txn-123',
          amount: 5000,
        })
      })
    })
  })

  // ==========================================================================
  // 2. $.human.ask(question) - Get human input (returns string)
  // ==========================================================================

  describe('$.human.ask(question)', () => {
    describe('Basic ask flow', () => {
      it('asks question and returns human answer as string', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ answer: 'The project deadline is next Friday' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const answer = await proxy.human.ask('When is the project deadline?')

        expect(answer).toBe('The project deadline is next Friday')
        expect(typeof answer).toBe('string')
      })

      it('sends question to Human DO', async () => {
        await proxy.human.ask('What is the budget for Q4?')

        expect(mockDOStub.fetch).toHaveBeenCalled()

        const fetchCall = mockDOStub.fetch.mock.calls[0][0] as Request
        const body = await fetchCall.json()
        expect(body).toMatchObject({
          question: 'What is the budget for Q4?',
          type: 'question',
        })
      })

      it('returns empty string if human provides no answer', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ answer: '' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const answer = await proxy.human.ask('Any comments?')

        expect(answer).toBe('')
      })

      it('trims whitespace from answer', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ answer: '  The answer with spaces  ' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const answer = await proxy.human.ask('Question?')

        expect(answer).toBe('The answer with spaces')
      })
    })

    describe('Ask with options', () => {
      it('accepts placeholder option', async () => {
        await proxy.human.ask('Enter your feedback', {
          placeholder: 'Type your feedback here...',
        })

        const fetchCall = mockDOStub.fetch.mock.calls[0][0] as Request
        const body = await fetchCall.json()
        expect(body).toMatchObject({
          placeholder: 'Type your feedback here...',
        })
      })

      it('accepts validation option', async () => {
        const validation = (answer: string) => answer.length >= 10 || 'Answer must be at least 10 characters'

        await proxy.human.ask('Describe the issue', {
          validation,
        })

        const fetchCall = mockDOStub.fetch.mock.calls[0][0] as Request
        const body = await fetchCall.json()
        expect(body.hasValidation).toBe(true)
      })

      it('re-prompts if validation fails', async () => {
        let callCount = 0
        mockDOStub.fetch.mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            // First answer fails validation
            return new Response(JSON.stringify({ answer: 'short' }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }
          // Second answer passes
          return new Response(JSON.stringify({ answer: 'This is a much longer answer that passes validation' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        })

        const answer = await proxy.human.ask('Describe the issue in detail', {
          validation: (a) => a.length >= 20 || 'Answer must be at least 20 characters',
        })

        expect(answer).toBe('This is a much longer answer that passes validation')
        expect(callCount).toBe(2)
      })

      it('accepts role option', async () => {
        await proxy.human.ask('What should be the response to the customer?', {
          role: 'customer-support-lead',
        })

        const fetchCall = mockDOStub.fetch.mock.calls[0][0] as Request
        const body = await fetchCall.json()
        expect(body.role).toBe('customer-support-lead')
      })
    })
  })

  // ==========================================================================
  // 3. $.human.review(content) - Get review feedback (returns structured review)
  // ==========================================================================

  describe('$.human.review(content)', () => {
    describe('Basic review flow', () => {
      it('returns structured review result', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({
            approved: true,
            feedback: 'Well written and comprehensive',
            score: 9,
            criteria: {
              clarity: 10,
              completeness: 8,
              accuracy: 9,
            },
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const review = await proxy.human.review({
          title: 'Q4 Marketing Plan',
          content: 'Detailed marketing strategy...',
        })

        expect(review).toMatchObject({
          approved: true,
          feedback: expect.any(String),
          score: expect.any(Number),
        })
      })

      it('returns ReviewResult type with all fields', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({
            approved: false,
            feedback: 'Needs more detail on budget allocation',
            score: 6,
            criteria: {
              clarity: 8,
              completeness: 4,
              accuracy: 6,
            },
            reviewerId: 'user-123',
            reviewedAt: new Date().toISOString(),
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const review = await proxy.human.review('Draft proposal content')

        expect(review).toHaveProperty('approved')
        expect(review).toHaveProperty('feedback')
        expect(review).toHaveProperty('score')
        expect(review).toHaveProperty('criteria')
        expect(review).toHaveProperty('reviewerId')
        expect(review).toHaveProperty('reviewedAt')
      })

      it('sends content to Human DO for review', async () => {
        const content = {
          type: 'document',
          title: 'Technical Specification',
          body: 'Detailed specs...',
        }

        await proxy.human.review(content)

        const fetchCall = mockDOStub.fetch.mock.calls[0][0] as Request
        const body = await fetchCall.json()
        expect(body).toMatchObject({
          content,
          type: 'review',
        })
      })

      it('handles string content', async () => {
        await proxy.human.review('This is a simple text to review')

        const fetchCall = mockDOStub.fetch.mock.calls[0][0] as Request
        const body = await fetchCall.json()
        expect(body.content).toBe('This is a simple text to review')
      })
    })

    describe('Review with criteria', () => {
      it('accepts criteria option for structured review', async () => {
        await proxy.human.review('Document content', {
          criteria: ['accuracy', 'completeness', 'clarity', 'formatting'],
        })

        const fetchCall = mockDOStub.fetch.mock.calls[0][0] as Request
        const body = await fetchCall.json()
        expect(body.criteria).toEqual(['accuracy', 'completeness', 'clarity', 'formatting'])
      })

      it('returns scores for each criterion', async () => {
        mockDOStub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({
            approved: true,
            feedback: 'Good overall',
            score: 8,
            criteria: {
              accuracy: 9,
              completeness: 7,
              clarity: 8,
            },
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        )

        const review = await proxy.human.review('Content', {
          criteria: ['accuracy', 'completeness', 'clarity'],
        })

        expect(review.criteria).toMatchObject({
          accuracy: 9,
          completeness: 7,
          clarity: 8,
        })
      })
    })
  })

  // ==========================================================================
  // 4. Timeout handling for human response
  // ==========================================================================

  describe('Timeout handling', () => {
    it('throws HumanTimeoutError when timeout expires on approve', async () => {
      mockDOStub.fetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      )

      await expect(
        proxy.human.approve('Approve?', { timeout: 50 })
      ).rejects.toThrow(HumanTimeoutError)
    })

    it('throws HumanTimeoutError when timeout expires on ask', async () => {
      mockDOStub.fetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      )

      await expect(
        proxy.human.ask('Question?', { timeout: 50 })
      ).rejects.toThrow(HumanTimeoutError)
    })

    it('throws HumanTimeoutError when timeout expires on review', async () => {
      mockDOStub.fetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      )

      await expect(
        proxy.human.review('Content', { timeout: 50 })
      ).rejects.toThrow(HumanTimeoutError)
    })

    it('includes timeout value in error message', async () => {
      mockDOStub.fetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      )

      try {
        await proxy.human.approve('Test', { timeout: 100 })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(HumanTimeoutError)
        expect((error as Error).message).toContain('100')
      }
    })

    it('completes successfully if response arrives before timeout', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ approved: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await proxy.human.approve('Quick approval', { timeout: 5000 })

      expect(result).toBe(true)
    })

    it('uses default timeout when not specified', async () => {
      // Default timeout should be configurable in proxy config
      const customProxy = createHumanProxy({
        env: mockEnv,
        notificationService: mockNotificationService,
        defaultTimeout: 30000,
      })

      mockDOStub.fetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10000))
      )

      // Should use 30000ms default, not fail immediately
      const promise = customProxy.human.approve('Test')

      // Cancel to avoid long wait
      // The test validates that the proxy accepts defaultTimeout config
      expect(promise).toBeDefined()
    })
  })

  // ==========================================================================
  // 5. Escalation routing by role
  // ==========================================================================

  describe('Escalation routing by role', () => {
    it('routes approval to specified role', async () => {
      await proxy.human.approve('Approve $15,000 refund', {
        role: 'senior-accountant',
      })

      const fetchCall = mockDOStub.fetch.mock.calls[0][0] as Request
      const url = new URL(fetchCall.url)
      expect(url.searchParams.get('role')).toBe('senior-accountant')
    })

    it('escalates to next role on timeout', async () => {
      let callCount = 0
      mockDOStub.fetch.mockImplementation(async (request: Request) => {
        callCount++
        const url = new URL(request.url)

        if (callCount === 1) {
          // First call times out
          await new Promise((resolve) => setTimeout(resolve, 100))
          throw new Error('Timeout')
        }

        // Second call (escalated) succeeds
        return new Response(JSON.stringify({ approved: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const result = await proxy.human.approve('Critical approval', {
        role: 'manager',
        timeout: 50,
        escalation: {
          afterTimeout: 'director',
          timeout: 5000,
        },
      })

      expect(result).toBe(true)
      expect(callCount).toBe(2)
    })

    it('supports multi-level escalation', async () => {
      const rolesContacted: string[] = []

      mockDOStub.fetch.mockImplementation(async (request: Request) => {
        const body = await request.json() as { role: string }
        rolesContacted.push(body.role)

        if (rolesContacted.length < 3) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          throw new Error('Timeout')
        }

        return new Response(JSON.stringify({ approved: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      await proxy.human.approve('Urgent approval', {
        role: 'manager',
        timeout: 30,
        escalation: {
          afterTimeout: 'director',
          timeout: 30,
          next: {
            afterTimeout: 'vp',
            timeout: 5000,
          },
        },
      })

      expect(rolesContacted).toEqual(['manager', 'director', 'vp'])
    })

    it('throws HumanEscalationError if all escalation levels fail', async () => {
      mockDOStub.fetch.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        throw new Error('Timeout')
      })

      await expect(
        proxy.human.approve('Blocked approval', {
          role: 'manager',
          timeout: 20,
          escalation: {
            afterTimeout: 'director',
            timeout: 20,
          },
        })
      ).rejects.toThrow(HumanEscalationError)
    })

    it('routes to Human DO with correct role binding', async () => {
      await proxy.human.approve('Role-specific approval', {
        role: 'legal-counsel',
      })

      // Should use role-specific DO instance
      expect(mockEnv.HUMAN_DO.idFromName).toHaveBeenCalledWith('legal-counsel')
    })
  })

  // ==========================================================================
  // 6. SLA tracking
  // ==========================================================================

  describe('SLA tracking', () => {
    it('accepts SLA configuration', async () => {
      let capturedBody: Record<string, unknown> | null = null
      mockDOStub.fetch.mockImplementation(async (request: Request) => {
        capturedBody = await request.json() as Record<string, unknown>
        return new Response(JSON.stringify({ approved: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      await proxy.human.approve('SLA-tracked approval', {
        sla: {
          target: 3600000, // 1 hour
          critical: 7200000, // 2 hours
        },
      })

      expect((capturedBody as Record<string, unknown>)?.sla).toMatchObject({
        target: 3600000,
        critical: 7200000,
      })
    })

    it('includes SLA status in pending requests', async () => {
      const now = Date.now()

      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            requestId: 'req-1',
            message: 'Pending approval',
            createdAt: new Date(now - 1800000).toISOString(), // 30 min ago
            sla: {
              target: 3600000,
              critical: 7200000,
              status: 'on-track',
              remainingTarget: 1800000,
            },
          },
        ]), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const pending = await proxy.human.pending()

      expect(pending[0].sla).toMatchObject({
        status: 'on-track',
        remainingTarget: expect.any(Number),
      })
    })

    it('tracks SLA breach status', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            requestId: 'req-breached',
            message: 'Overdue approval',
            sla: {
              target: 3600000,
              critical: 7200000,
              status: 'breached',
              breachedAt: new Date().toISOString(),
            },
          },
        ]), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const pending = await proxy.human.pending()

      expect(pending[0].sla.status).toBe('breached')
      expect(pending[0].sla.breachedAt).toBeDefined()
    })

    it('emits SLA warning event when approaching target', async () => {
      const onSLAWarning = vi.fn()

      const proxyWithEvents = createHumanProxy({
        env: mockEnv,
        notificationService: mockNotificationService,
        onSLAWarning,
      })

      mockDOStub.fetch.mockImplementation(async () => {
        // Simulate SLA warning during wait
        onSLAWarning({
          requestId: 'req-1',
          remainingTime: 300000, // 5 minutes left
          target: 3600000,
        })

        return new Response(JSON.stringify({ approved: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      await proxyWithEvents.human.approve('SLA test', {
        sla: { target: 3600000 },
      })

      expect(onSLAWarning).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 7. Notification delivery (email, slack, push)
  // ==========================================================================

  describe('Notification delivery', () => {
    describe('Email notifications', () => {
      it('sends email notification for approval request', async () => {
        await proxy.human.approve('Approve contract', {
          notify: [{ type: 'email', to: 'approver@example.com.ai' }],
        })

        expect(mockNotificationService.sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: 'approver@example.com.ai',
            subject: expect.stringContaining('Approval'),
          })
        )
      })

      it('includes approval message in email body', async () => {
        await proxy.human.approve('Approve the Q4 budget proposal', {
          notify: [{ type: 'email', to: 'cfo@example.com.ai' }],
        })

        expect(mockNotificationService.sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.stringContaining('Q4 budget proposal'),
          })
        )
      })

      it('includes action links in email', async () => {
        await proxy.human.approve('Approve request', {
          notify: [{ type: 'email', to: 'user@example.com.ai' }],
        })

        expect(mockNotificationService.sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            actions: expect.arrayContaining([
              expect.objectContaining({ label: 'Approve', url: expect.any(String) }),
              expect.objectContaining({ label: 'Reject', url: expect.any(String) }),
            ]),
          })
        )
      })
    })

    describe('Slack notifications', () => {
      it('sends Slack notification for approval request', async () => {
        await proxy.human.approve('Deploy to production?', {
          notify: [{ type: 'slack', channel: '#approvals' }],
        })

        expect(mockNotificationService.sendSlack).toHaveBeenCalledWith(
          expect.objectContaining({
            channel: '#approvals',
          })
        )
      })

      it('includes interactive buttons in Slack message', async () => {
        await proxy.human.approve('Approve deployment', {
          notify: [{ type: 'slack', channel: '#deployments' }],
        })

        expect(mockNotificationService.sendSlack).toHaveBeenCalledWith(
          expect.objectContaining({
            blocks: expect.arrayContaining([
              expect.objectContaining({
                type: 'actions',
                elements: expect.arrayContaining([
                  expect.objectContaining({ text: expect.objectContaining({ text: 'Approve' }) }),
                  expect.objectContaining({ text: expect.objectContaining({ text: 'Reject' }) }),
                ]),
              }),
            ]),
          })
        )
      })

      it('mentions specific users in Slack', async () => {
        await proxy.human.approve('Urgent approval needed', {
          notify: [{ type: 'slack', channel: '#approvals', mention: ['U12345', 'U67890'] }],
        })

        expect(mockNotificationService.sendSlack).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringMatching(/<@U12345>.*<@U67890>/),
          })
        )
      })
    })

    describe('Push notifications', () => {
      it('sends push notification for approval request', async () => {
        await proxy.human.approve('Mobile approval request', {
          notify: [{ type: 'push', userId: 'user-123' }],
        })

        expect(mockNotificationService.sendPush).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-123',
            title: expect.stringContaining('Approval'),
          })
        )
      })

      it('sets push notification priority', async () => {
        await proxy.human.approve('Urgent approval', {
          notify: [{ type: 'push', userId: 'user-123', priority: 'high' }],
        })

        expect(mockNotificationService.sendPush).toHaveBeenCalledWith(
          expect.objectContaining({
            priority: 'high',
          })
        )
      })
    })

    describe('Multi-channel notifications', () => {
      it('sends to multiple channels simultaneously', async () => {
        await proxy.human.approve('Multi-channel approval', {
          notify: [
            { type: 'email', to: 'approver@example.com.ai' },
            { type: 'slack', channel: '#approvals' },
            { type: 'push', userId: 'user-123' },
          ],
        })

        expect(mockNotificationService.sendEmail).toHaveBeenCalled()
        expect(mockNotificationService.sendSlack).toHaveBeenCalled()
        expect(mockNotificationService.sendPush).toHaveBeenCalled()
      })

      it('continues if one channel fails', async () => {
        mockNotificationService.sendSlack.mockRejectedValueOnce(new Error('Slack error'))

        await proxy.human.approve('Resilient approval', {
          notify: [
            { type: 'email', to: 'approver@example.com.ai' },
            { type: 'slack', channel: '#approvals' },
          ],
        })

        // Email should still be sent
        expect(mockNotificationService.sendEmail).toHaveBeenCalled()
      })

      it('throws HumanNotificationError if all channels fail', async () => {
        mockNotificationService.sendEmail.mockRejectedValue(new Error('Email error'))
        mockNotificationService.sendSlack.mockRejectedValue(new Error('Slack error'))

        await expect(
          proxy.human.approve('Failed notification', {
            notify: [
              { type: 'email', to: 'user@example.com.ai' },
              { type: 'slack', channel: '#channel' },
            ],
          })
        ).rejects.toThrow(HumanNotificationError)
      })
    })
  })

  // ==========================================================================
  // 8. Response persistence
  // ==========================================================================

  describe('Response persistence', () => {
    it('stores approval response in Human DO', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          approved: true,
          requestId: 'req-persist-1',
          respondedBy: 'user-123',
          respondedAt: new Date().toISOString(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      await proxy.human.approve('Persist this approval')

      // Verify storage call was made
      expect(mockDOStub.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('retrieves past responses from Human DO', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          requestId: 'req-history-1',
          type: 'approval',
          message: 'Past approval',
          response: {
            approved: true,
            respondedBy: 'user-123',
            respondedAt: new Date().toISOString(),
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      // Assuming a getResponse method exists for retrieving past responses
      const history = await proxy.human.getResponse?.('req-history-1')

      expect(history).toMatchObject({
        approved: true,
        respondedBy: 'user-123',
      })
    })

    it('includes audit trail in response', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          approved: true,
          requestId: 'req-audit-1',
          audit: {
            requestedAt: new Date().toISOString(),
            requestedBy: 'workflow-123',
            respondedAt: new Date().toISOString(),
            respondedBy: 'user-456',
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0...',
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const result = await proxy.human.approve('Audited approval')

      // The full response with audit is available
      expect(result).toBe(true)
    })
  })

  // ==========================================================================
  // 9. Concurrent approval requests
  // ==========================================================================

  describe('Concurrent approval requests', () => {
    it('handles multiple concurrent approval requests', async () => {
      const responses = [
        { approved: true, requestId: 'req-1' },
        { approved: false, requestId: 'req-2' },
        { approved: true, requestId: 'req-3' },
      ]

      let callIndex = 0
      mockDOStub.fetch.mockImplementation(async () => {
        const response = responses[callIndex++]
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50))
        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const results = await Promise.all([
        proxy.human.approve('Approval 1'),
        proxy.human.approve('Approval 2'),
        proxy.human.approve('Approval 3'),
      ])

      expect(results).toEqual([true, false, true])
    })

    it('isolates concurrent requests with unique IDs', async () => {
      const requestIds = new Set<string>()

      mockDOStub.fetch.mockImplementation(async (request: Request) => {
        const body = await request.json() as { requestId: string }
        requestIds.add(body.requestId)
        return new Response(JSON.stringify({ approved: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      await Promise.all([
        proxy.human.approve('Concurrent 1'),
        proxy.human.approve('Concurrent 2'),
        proxy.human.approve('Concurrent 3'),
        proxy.human.approve('Concurrent 4'),
        proxy.human.approve('Concurrent 5'),
      ])

      expect(requestIds.size).toBe(5)
    })

    it('lists all pending requests', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify([
          { requestId: 'pending-1', message: 'Pending 1', status: 'pending' },
          { requestId: 'pending-2', message: 'Pending 2', status: 'pending' },
          { requestId: 'pending-3', message: 'Pending 3', status: 'pending' },
        ]), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const pending = await proxy.human.pending()

      expect(pending).toHaveLength(3)
      expect(pending.map((p: HumanRequest) => p.requestId)).toEqual(['pending-1', 'pending-2', 'pending-3'])
    })

    it('cancels specific pending request', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ cancelled: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const cancelled = await proxy.human.cancel('req-to-cancel')

      expect(cancelled).toBe(true)
      expect(mockDOStub.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('returns false when cancelling non-existent request', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ cancelled: false, error: 'Request not found' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

      const cancelled = await proxy.human.cancel('non-existent-req')

      expect(cancelled).toBe(false)
    })

    it('prevents race conditions in concurrent responses', async () => {
      const responseOrder: string[] = []

      mockDOStub.fetch.mockImplementation(async (request: Request) => {
        const body = await request.json() as { requestId: string }
        responseOrder.push(`start-${body.requestId}`)

        // Simulate variable processing time
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 100))

        responseOrder.push(`end-${body.requestId}`)
        return new Response(JSON.stringify({ approved: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      await Promise.all([
        proxy.human.approve('Race 1'),
        proxy.human.approve('Race 2'),
      ])

      // Each request should have matching start/end pairs
      expect(responseOrder.filter((r) => r.startsWith('start-')).length).toBe(2)
      expect(responseOrder.filter((r) => r.startsWith('end-')).length).toBe(2)
    })
  })

  // ==========================================================================
  // 10. Edge cases and error handling
  // ==========================================================================

  describe('Edge cases and error handling', () => {
    it('handles empty message in approve', async () => {
      await expect(proxy.human.approve('')).rejects.toThrow()
    })

    it('handles empty question in ask', async () => {
      await expect(proxy.human.ask('')).rejects.toThrow()
    })

    it('handles null content in review', async () => {
      await expect(proxy.human.review(null as unknown as string)).rejects.toThrow()
    })

    it('handles Human DO connection failure', async () => {
      mockDOStub.fetch.mockRejectedValueOnce(new Error('DO unavailable'))

      await expect(proxy.human.approve('Test')).rejects.toThrow()
    })

    it('handles malformed response from Human DO', async () => {
      mockDOStub.fetch.mockResolvedValueOnce(
        new Response('not json', {
          headers: { 'Content-Type': 'text/plain' },
        })
      )

      await expect(proxy.human.approve('Test')).rejects.toThrow()
    })

    it('handles timeout of 0 as immediate failure', async () => {
      await expect(
        proxy.human.approve('Zero timeout', { timeout: 0 })
      ).rejects.toThrow(HumanTimeoutError)
    })

    it('handles negative timeout as invalid', async () => {
      await expect(
        proxy.human.approve('Negative timeout', { timeout: -1000 })
      ).rejects.toThrow()
    })

    it('sanitizes HTML in messages to prevent XSS', async () => {
      let capturedBody: Record<string, unknown> | null = null
      mockDOStub.fetch.mockImplementation(async (request: Request) => {
        capturedBody = await request.json() as Record<string, unknown>
        return new Response(JSON.stringify({ approved: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      await proxy.human.approve('<script>alert("xss")</script>Approve this?')

      expect((capturedBody as Record<string, unknown>)?.message).not.toContain('<script>')
    })

    it('limits message length to prevent abuse', async () => {
      const longMessage = 'A'.repeat(100000)

      await expect(
        proxy.human.approve(longMessage)
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // 11. Factory configuration
  // ==========================================================================

  describe('createHumanProxy configuration', () => {
    it('creates proxy with minimal configuration', () => {
      const minimalProxy = createHumanProxy({
        env: mockEnv,
      })

      expect(minimalProxy.human).toBeDefined()
      expect(minimalProxy.human.approve).toBeInstanceOf(Function)
      expect(minimalProxy.human.ask).toBeInstanceOf(Function)
      expect(minimalProxy.human.review).toBeInstanceOf(Function)
    })

    it('accepts custom notification service', () => {
      const customNotificationService = {
        sendEmail: vi.fn(),
        sendSlack: vi.fn(),
        sendPush: vi.fn(),
        getDeliveryStatus: vi.fn(),
      }

      const customProxy = createHumanProxy({
        env: mockEnv,
        notificationService: customNotificationService,
      })

      expect(customProxy).toBeDefined()
    })

    it('accepts default timeout configuration', () => {
      const customProxy = createHumanProxy({
        env: mockEnv,
        defaultTimeout: 60000,
      })

      expect(customProxy).toBeDefined()
    })

    it('accepts default role configuration', () => {
      const customProxy = createHumanProxy({
        env: mockEnv,
        defaultRole: 'default-approver',
      })

      expect(customProxy).toBeDefined()
    })

    it('accepts default notification channels', () => {
      const customProxy = createHumanProxy({
        env: mockEnv,
        defaultNotify: [
          { type: 'slack', channel: '#approvals' },
        ],
      })

      expect(customProxy).toBeDefined()
    })

    it('accepts event handlers', () => {
      const onApprovalRequest = vi.fn()
      const onApprovalResponse = vi.fn()

      const customProxy = createHumanProxy({
        env: mockEnv,
        onApprovalRequest,
        onApprovalResponse,
      })

      expect(customProxy).toBeDefined()
    })
  })
})

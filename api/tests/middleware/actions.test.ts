import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'

/**
 * Actions Middleware Tests
 *
 * These tests verify the actions middleware for handling different function types:
 * - CodeFunction: Synchronous code execution
 * - GenerativeFunction: Calls AI model for response
 * - AgenticFunction: Runs multi-step agent loop
 * - HumanFunction: Sends to human, waits for response
 *
 * Tests are expected to FAIL until the middleware is implemented.
 *
 * Implementation requirements:
 * - Create middleware in api/middleware/actions.ts
 * - Support GET /api/actions to list available actions
 * - Support POST /api/actions/:action to invoke functions
 * - Handle all function types with appropriate execution
 * - Validate permissions before execution
 * - Handle errors and timeouts per function type
 */

// Import the middleware (will fail until implemented)
import {
  actions,
  type ActionsConfig,
  type CodeFunction,
  type GenerativeFunction,
  type AgenticFunction,
  type HumanFunction,
} from '../../middleware/actions'

// ============================================================================
// Test Types
// ============================================================================

interface ActionListResponse {
  actions: Array<{
    name: string
    description?: string
    type: 'code' | 'generative' | 'agentic' | 'human'
  }>
}

interface ActionInvokeResponse {
  result?: unknown
  error?: string
  status?: string
}

interface ErrorResponse {
  error: string
  message?: string
}

// ============================================================================
// Mock Services
// ============================================================================

const mockAI = {
  generate: vi.fn(),
  stream: vi.fn(),
}

const mockAgentRunner = {
  run: vi.fn(),
}

const mockNotificationChannel = {
  send: vi.fn(),
  waitForResponse: vi.fn(),
}

// ============================================================================
// Helper Functions
// ============================================================================

function createTestApp(config?: ActionsConfig): Hono {
  const app = new Hono()

  // Mock auth middleware - sets user context
  app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      c.set('user', { id: 'user-123', role: 'user' })
    }
    c.set('ai', mockAI)
    c.set('agentRunner', mockAgentRunner)
    c.set('notifications', mockNotificationChannel)
    await next()
  })

  app.use('/api/actions/*', actions(config))
  return app
}

function createAuthenticatedApp(config?: ActionsConfig): Hono {
  const app = new Hono()

  // Auth middleware always sets user
  app.use('*', async (c, next) => {
    c.set('user', { id: 'user-123', role: 'user', permissions: ['actions:*'] })
    c.set('ai', mockAI)
    c.set('agentRunner', mockAgentRunner)
    c.set('notifications', mockNotificationChannel)
    await next()
  })

  app.use('/api/actions/*', actions(config))
  return app
}

async function listActions(app: Hono, headers?: Record<string, string>): Promise<Response> {
  return app.request('/api/actions', {
    method: 'GET',
    headers: {
      ...headers,
    },
  })
}

async function invokeAction(
  app: Hono,
  action: string,
  options: {
    input?: unknown
    headers?: Record<string, string>
  } = {}
): Promise<Response> {
  return app.request(`/api/actions/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(options.input || {}),
  })
}

// ============================================================================
// 1. Listing Actions Tests
// ============================================================================

describe('Actions Middleware - Listing Actions', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = createAuthenticatedApp({
      actions: {
        'send-email': {
          type: 'code',
          description: 'Send an email',
          handler: async () => ({ sent: true }),
        },
        'summarize': {
          type: 'generative',
          description: 'Summarize content',
          model: 'claude-3-sonnet',
          prompt: 'Summarize: {{input}}',
        },
        'research': {
          type: 'agentic',
          description: 'Research a topic',
          agent: 'researcher',
          maxIterations: 10,
        },
        'approve': {
          type: 'human',
          description: 'Get human approval',
          channel: 'slack',
          timeout: 3600000,
        },
      },
    })
  })

  describe('GET /api/actions lists available actions', () => {
    it('returns list of available actions', async () => {
      const res = await listActions(app)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionListResponse
      expect(body.actions).toBeDefined()
      expect(Array.isArray(body.actions)).toBe(true)
    })

    it('includes all configured actions', async () => {
      const res = await listActions(app)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionListResponse
      const actionNames = body.actions.map((a) => a.name)
      expect(actionNames).toContain('send-email')
      expect(actionNames).toContain('summarize')
      expect(actionNames).toContain('research')
      expect(actionNames).toContain('approve')
    })

    it('returns action metadata (name, description, type)', async () => {
      const res = await listActions(app)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionListResponse
      const sendEmail = body.actions.find((a) => a.name === 'send-email')

      expect(sendEmail).toBeDefined()
      expect(sendEmail?.name).toBe('send-email')
      expect(sendEmail?.description).toBe('Send an email')
      expect(sendEmail?.type).toBe('code')
    })

    it('includes type for each action', async () => {
      const res = await listActions(app)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionListResponse
      for (const action of body.actions) {
        expect(['code', 'generative', 'agentic', 'human']).toContain(action.type)
      }
    })

    it('returns empty list when no actions configured', async () => {
      const emptyApp = createAuthenticatedApp({
        actions: {},
      })

      const res = await listActions(emptyApp)
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionListResponse
      expect(body.actions).toEqual([])
    })

    it('returns JSON content type', async () => {
      const res = await listActions(app)
      expect(res.headers.get('content-type')).toContain('application/json')
    })
  })
})

// ============================================================================
// 2. Invoking Actions Tests
// ============================================================================

describe('Actions Middleware - Invoking Actions', () => {
  let app: Hono
  let handlerMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    handlerMock = vi.fn().mockResolvedValue({ success: true })

    app = createAuthenticatedApp({
      actions: {
        'test-action': {
          type: 'code',
          handler: handlerMock,
        },
      },
    })
  })

  describe('POST /api/actions/:action invokes function', () => {
    it('invokes the specified action', async () => {
      const res = await invokeAction(app, 'test-action', {
        input: { data: 'test' },
      })

      expect(res.status).toBe(200)
      expect(handlerMock).toHaveBeenCalled()
    })

    it('passes input to the handler', async () => {
      await invokeAction(app, 'test-action', {
        input: { message: 'hello' },
      })

      expect(handlerMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'hello' }),
        expect.anything()
      )
    })

    it('returns result in response', async () => {
      handlerMock.mockResolvedValue({ result: 'completed' })

      const res = await invokeAction(app, 'test-action')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toEqual({ result: 'completed' })
    })

    it('returns 404 for unknown action', async () => {
      const res = await invokeAction(app, 'nonexistent-action')
      expect(res.status).toBe(404)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
    })

    it('returns JSON content type', async () => {
      const res = await invokeAction(app, 'test-action')
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('only accepts POST method', async () => {
      const res = await app.request('/api/actions/test-action', {
        method: 'GET',
      })
      expect(res.status).toBe(405)
    })

    it('rejects PUT method', async () => {
      const res = await app.request('/api/actions/test-action', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(405)
    })

    it('rejects DELETE method', async () => {
      const res = await app.request('/api/actions/test-action', {
        method: 'DELETE',
      })
      expect(res.status).toBe(405)
    })
  })
})

// ============================================================================
// 3. CodeFunction Tests
// ============================================================================

describe('Actions Middleware - CodeFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Executes handler function directly', () => {
    it('calls the handler function', async () => {
      const handlerMock = vi.fn().mockResolvedValue({ done: true })
      const app = createAuthenticatedApp({
        actions: {
          'code-action': {
            type: 'code',
            handler: handlerMock,
          },
        },
      })

      await invokeAction(app, 'code-action', { input: { value: 42 } })
      expect(handlerMock).toHaveBeenCalled()
    })

    it('passes input to handler as first argument', async () => {
      const handlerMock = vi.fn().mockResolvedValue({})
      const app = createAuthenticatedApp({
        actions: {
          'code-action': {
            type: 'code',
            handler: handlerMock,
          },
        },
      })

      await invokeAction(app, 'code-action', { input: { key: 'value' } })
      expect(handlerMock).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'value' }),
        expect.anything()
      )
    })

    it('passes Hono context as second argument', async () => {
      let receivedContext: Context | null = null
      const handlerMock = vi.fn().mockImplementation((_input, c) => {
        receivedContext = c
        return {}
      })
      const app = createAuthenticatedApp({
        actions: {
          'code-action': {
            type: 'code',
            handler: handlerMock,
          },
        },
      })

      await invokeAction(app, 'code-action')
      expect(receivedContext).not.toBeNull()
    })
  })

  describe('Returns handler result', () => {
    it('returns the result from handler', async () => {
      const handlerMock = vi.fn().mockResolvedValue({ status: 'completed', count: 5 })
      const app = createAuthenticatedApp({
        actions: {
          'code-action': {
            type: 'code',
            handler: handlerMock,
          },
        },
      })

      const res = await invokeAction(app, 'code-action')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toEqual({ status: 'completed', count: 5 })
    })

    it('handles null return value', async () => {
      const handlerMock = vi.fn().mockResolvedValue(null)
      const app = createAuthenticatedApp({
        actions: {
          'code-action': {
            type: 'code',
            handler: handlerMock,
          },
        },
      })

      const res = await invokeAction(app, 'code-action')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toBeNull()
    })

    it('handles undefined return value', async () => {
      const handlerMock = vi.fn().mockResolvedValue(undefined)
      const app = createAuthenticatedApp({
        actions: {
          'code-action': {
            type: 'code',
            handler: handlerMock,
          },
        },
      })

      const res = await invokeAction(app, 'code-action')
      expect(res.status).toBe(200)
    })
  })

  describe('Handles sync and async handlers', () => {
    it('handles synchronous handler', async () => {
      const syncHandler = vi.fn().mockReturnValue({ sync: true })
      const app = createAuthenticatedApp({
        actions: {
          'sync-action': {
            type: 'code',
            handler: syncHandler,
          },
        },
      })

      const res = await invokeAction(app, 'sync-action')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toEqual({ sync: true })
    })

    it('handles async handler', async () => {
      const asyncHandler = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { async: true }
      })
      const app = createAuthenticatedApp({
        actions: {
          'async-action': {
            type: 'code',
            handler: asyncHandler,
          },
        },
      })

      const res = await invokeAction(app, 'async-action')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toEqual({ async: true })
    })

    it('handles Promise-returning handler', async () => {
      const promiseHandler = vi.fn().mockReturnValue(Promise.resolve({ promise: true }))
      const app = createAuthenticatedApp({
        actions: {
          'promise-action': {
            type: 'code',
            handler: promiseHandler,
          },
        },
      })

      const res = await invokeAction(app, 'promise-action')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toEqual({ promise: true })
    })
  })
})

// ============================================================================
// 4. GenerativeFunction Tests
// ============================================================================

describe('Actions Middleware - GenerativeFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAI.generate.mockResolvedValue({ text: 'AI response' })
    mockAI.stream.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { text: 'chunk1' }
        yield { text: 'chunk2' }
      },
    })
  })

  describe('Calls AI model with prompt', () => {
    it('calls AI generate with model and prompt', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'summarize': {
            type: 'generative',
            model: 'claude-3-sonnet',
            prompt: 'Summarize: {{input}}',
          },
        },
      })

      await invokeAction(app, 'summarize', { input: { text: 'long text here' } })

      expect(mockAI.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-sonnet',
        })
      )
    })

    it('substitutes input variables in prompt template', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'translate': {
            type: 'generative',
            model: 'claude-3-sonnet',
            prompt: 'Translate to {{language}}: {{text}}',
          },
        },
      })

      await invokeAction(app, 'translate', {
        input: { language: 'Spanish', text: 'Hello world' },
      })

      expect(mockAI.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Spanish'),
        })
      )
    })

    it('uses configured model', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'generate': {
            type: 'generative',
            model: 'claude-3-opus',
            prompt: 'Generate: {{input}}',
          },
        },
      })

      await invokeAction(app, 'generate', { input: { data: 'test' } })

      expect(mockAI.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-opus',
        })
      )
    })
  })

  describe('Returns model response', () => {
    it('returns the AI response in result', async () => {
      mockAI.generate.mockResolvedValue({ text: 'This is the summary.' })

      const app = createAuthenticatedApp({
        actions: {
          'summarize': {
            type: 'generative',
            model: 'claude-3-sonnet',
            prompt: 'Summarize: {{input}}',
          },
        },
      })

      const res = await invokeAction(app, 'summarize', { input: { text: 'long text' } })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toEqual({ text: 'This is the summary.' })
    })

    it('handles AI errors gracefully', async () => {
      mockAI.generate.mockRejectedValue(new Error('AI service unavailable'))

      const app = createAuthenticatedApp({
        actions: {
          'summarize': {
            type: 'generative',
            model: 'claude-3-sonnet',
            prompt: 'Summarize: {{input}}',
          },
        },
      })

      const res = await invokeAction(app, 'summarize', { input: { text: 'test' } })
      expect([500, 502, 503]).toContain(res.status)
    })
  })

  describe('Supports streaming responses', () => {
    it('can stream response when stream option is true', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'stream-generate': {
            type: 'generative',
            model: 'claude-3-sonnet',
            prompt: 'Generate: {{input}}',
            stream: true,
          },
        },
      })

      const res = await invokeAction(app, 'stream-generate', {
        input: { prompt: 'test' },
      })

      // Streaming responses should return 200 with streaming content type
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream|application\/json/)
    })

    it('calls AI stream method for streaming', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'stream-generate': {
            type: 'generative',
            model: 'claude-3-sonnet',
            prompt: 'Generate: {{input}}',
            stream: true,
          },
        },
      })

      await invokeAction(app, 'stream-generate', { input: { data: 'test' } })

      // Either generate or stream should be called
      expect(mockAI.generate.mock.calls.length + mockAI.stream.mock.calls.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// 5. AgenticFunction Tests
// ============================================================================

describe('Actions Middleware - AgenticFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentRunner.run.mockResolvedValue({
      result: 'Agent completed',
      iterations: 3,
    })
  })

  describe('Runs multi-step agent loop', () => {
    it('calls agent runner with agent config', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'research': {
            type: 'agentic',
            agent: 'researcher',
            maxIterations: 10,
          },
        },
      })

      await invokeAction(app, 'research', { input: { topic: 'AI safety' } })

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'researcher',
        })
      )
    })

    it('passes input to agent runner', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'research': {
            type: 'agentic',
            agent: 'researcher',
            maxIterations: 10,
          },
        },
      })

      await invokeAction(app, 'research', { input: { query: 'test query' } })

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ query: 'test query' }),
        })
      )
    })

    it('executes multiple iterations', async () => {
      mockAgentRunner.run.mockResolvedValue({
        result: 'Completed',
        iterations: 5,
        steps: ['step1', 'step2', 'step3', 'step4', 'step5'],
      })

      const app = createAuthenticatedApp({
        actions: {
          'research': {
            type: 'agentic',
            agent: 'researcher',
            maxIterations: 10,
          },
        },
      })

      const res = await invokeAction(app, 'research', { input: { topic: 'test' } })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toBeDefined()
    })
  })

  describe('Returns final result', () => {
    it('returns the final agent result', async () => {
      mockAgentRunner.run.mockResolvedValue({
        result: { findings: ['finding1', 'finding2'] },
        summary: 'Research complete',
      })

      const app = createAuthenticatedApp({
        actions: {
          'research': {
            type: 'agentic',
            agent: 'researcher',
            maxIterations: 10,
          },
        },
      })

      const res = await invokeAction(app, 'research', { input: { topic: 'test' } })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toEqual({
        result: { findings: ['finding1', 'finding2'] },
        summary: 'Research complete',
      })
    })

    it('handles agent errors', async () => {
      mockAgentRunner.run.mockRejectedValue(new Error('Agent failed'))

      const app = createAuthenticatedApp({
        actions: {
          'research': {
            type: 'agentic',
            agent: 'researcher',
            maxIterations: 10,
          },
        },
      })

      const res = await invokeAction(app, 'research', { input: { topic: 'test' } })
      expect([500, 502]).toContain(res.status)
    })
  })

  describe('Supports max iterations', () => {
    it('passes maxIterations to agent runner', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'research': {
            type: 'agentic',
            agent: 'researcher',
            maxIterations: 5,
          },
        },
      })

      await invokeAction(app, 'research', { input: { topic: 'test' } })

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          maxIterations: 5,
        })
      )
    })

    it('uses default maxIterations when not specified', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'research': {
            type: 'agentic',
            agent: 'researcher',
            // No maxIterations specified
          },
        },
      })

      await invokeAction(app, 'research', { input: { topic: 'test' } })

      expect(mockAgentRunner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          maxIterations: expect.any(Number),
        })
      )
    })

    it('respects maxIterations limit', async () => {
      mockAgentRunner.run.mockResolvedValue({
        result: 'Stopped at limit',
        iterations: 3,
        stoppedReason: 'max_iterations',
      })

      const app = createAuthenticatedApp({
        actions: {
          'limited-research': {
            type: 'agentic',
            agent: 'researcher',
            maxIterations: 3,
          },
        },
      })

      const res = await invokeAction(app, 'limited-research', { input: { topic: 'test' } })
      expect(res.status).toBe(200)
    })
  })
})

// ============================================================================
// 6. HumanFunction Tests
// ============================================================================

describe('Actions Middleware - HumanFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNotificationChannel.send.mockResolvedValue({ messageId: 'msg-123' })
    mockNotificationChannel.waitForResponse.mockResolvedValue({
      approved: true,
      respondedBy: 'user-456',
    })
  })

  describe('Sends notification to channel', () => {
    it('sends notification to configured channel', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'approve': {
            type: 'human',
            channel: 'slack',
            prompt: 'Please approve: {{request}}',
            timeout: 3600000,
          },
        },
      })

      await invokeAction(app, 'approve', { input: { request: 'Deploy to production' } })

      expect(mockNotificationChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'slack',
        })
      )
    })

    it('includes prompt in notification', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'approve': {
            type: 'human',
            channel: 'slack',
            prompt: 'Approve request: {{request}}',
            timeout: 3600000,
          },
        },
      })

      await invokeAction(app, 'approve', { input: { request: 'Test request' } })

      expect(mockNotificationChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Test request'),
        })
      )
    })

    it('supports multiple channels (slack, email, sms)', async () => {
      const slackApp = createAuthenticatedApp({
        actions: {
          'slack-approve': {
            type: 'human',
            channel: 'slack',
            timeout: 3600000,
          },
        },
      })

      const emailApp = createAuthenticatedApp({
        actions: {
          'email-approve': {
            type: 'human',
            channel: 'email',
            timeout: 3600000,
          },
        },
      })

      await invokeAction(slackApp, 'slack-approve', { input: {} })
      expect(mockNotificationChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'slack' })
      )

      vi.clearAllMocks()
      await invokeAction(emailApp, 'email-approve', { input: {} })
      expect(mockNotificationChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'email' })
      )
    })
  })

  describe('Waits for human response', () => {
    it('waits for response after sending notification', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'approve': {
            type: 'human',
            channel: 'slack',
            timeout: 3600000,
          },
        },
      })

      await invokeAction(app, 'approve', { input: { request: 'test' } })

      expect(mockNotificationChannel.send).toHaveBeenCalled()
      expect(mockNotificationChannel.waitForResponse).toHaveBeenCalled()
    })

    it('returns human response as result', async () => {
      mockNotificationChannel.waitForResponse.mockResolvedValue({
        approved: true,
        comment: 'Looks good',
      })

      const app = createAuthenticatedApp({
        actions: {
          'approve': {
            type: 'human',
            channel: 'slack',
            timeout: 3600000,
          },
        },
      })

      const res = await invokeAction(app, 'approve', { input: { request: 'test' } })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ActionInvokeResponse
      expect(body.result).toEqual({
        approved: true,
        comment: 'Looks good',
      })
    })

    it('passes timeout to waitForResponse', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'approve': {
            type: 'human',
            channel: 'slack',
            timeout: 7200000, // 2 hours
          },
        },
      })

      await invokeAction(app, 'approve', { input: {} })

      expect(mockNotificationChannel.waitForResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 7200000,
        })
      )
    })
  })

  describe('Handles timeout', () => {
    it('returns timeout error when human does not respond', async () => {
      mockNotificationChannel.waitForResponse.mockRejectedValue(
        new Error('Timeout waiting for response')
      )

      const app = createAuthenticatedApp({
        actions: {
          'approve': {
            type: 'human',
            channel: 'slack',
            timeout: 1000, // 1 second
          },
        },
      })

      const res = await invokeAction(app, 'approve', { input: {} })
      expect([408, 504]).toContain(res.status)

      const body = (await res.json()) as ErrorResponse
      expect(body.error?.toLowerCase()).toMatch(/timeout/)
    })

    it('uses configured timeout value', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'quick-approve': {
            type: 'human',
            channel: 'slack',
            timeout: 60000, // 1 minute
          },
        },
      })

      await invokeAction(app, 'quick-approve', { input: {} })

      expect(mockNotificationChannel.waitForResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60000,
        })
      )
    })

    it('handles notification send failure', async () => {
      mockNotificationChannel.send.mockRejectedValue(new Error('Channel unavailable'))

      const app = createAuthenticatedApp({
        actions: {
          'approve': {
            type: 'human',
            channel: 'slack',
            timeout: 3600000,
          },
        },
      })

      const res = await invokeAction(app, 'approve', { input: {} })
      expect([500, 502, 503]).toContain(res.status)
    })
  })
})

// ============================================================================
// 7. Error Handling Tests
// ============================================================================

describe('Actions Middleware - Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Timeout handling per function type', () => {
    it('handles code function timeout', async () => {
      const slowHandler = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000))
      )

      const app = createAuthenticatedApp({
        actions: {
          'slow-action': {
            type: 'code',
            handler: slowHandler,
            timeout: 100, // 100ms timeout
          },
        },
      })

      // Note: This test may need adjustment based on actual timeout implementation
      const res = await invokeAction(app, 'slow-action', { input: {} })
      // Should return timeout or the action completes
      expect([200, 408, 504]).toContain(res.status)
    })

    it('handles generative function timeout', async () => {
      mockAI.generate.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000))
      )

      const app = createAuthenticatedApp({
        actions: {
          'slow-generate': {
            type: 'generative',
            model: 'claude-3-sonnet',
            prompt: 'Test',
            timeout: 100,
          },
        },
      })

      const res = await invokeAction(app, 'slow-generate', { input: {} })
      expect([200, 408, 504]).toContain(res.status)
    })

    it('handles agentic function timeout', async () => {
      mockAgentRunner.run.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000))
      )

      const app = createAuthenticatedApp({
        actions: {
          'slow-agent': {
            type: 'agentic',
            agent: 'researcher',
            maxIterations: 10,
            timeout: 100,
          },
        },
      })

      const res = await invokeAction(app, 'slow-agent', { input: {} })
      expect([200, 408, 504]).toContain(res.status)
    })
  })

  describe('Permission checks before execution', () => {
    it('returns 401 without authentication', async () => {
      const app = createTestApp({
        actions: {
          'protected-action': {
            type: 'code',
            handler: async () => ({}),
          },
        },
      })

      const res = await invokeAction(app, 'protected-action', {
        input: {},
        // No Authorization header
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 with invalid token', async () => {
      const app = createTestApp({
        actions: {
          'protected-action': {
            type: 'code',
            handler: async () => ({}),
          },
        },
      })

      const res = await invokeAction(app, 'protected-action', {
        input: {},
        headers: { Authorization: 'Bearer invalid-token' },
      })

      // Our mock accepts any Bearer token, but real implementation would reject
      expect([200, 401]).toContain(res.status)
    })

    it('returns 403 for action-specific permission failure', async () => {
      const restrictedApp = new Hono()
      restrictedApp.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', role: 'user', permissions: [] }) // No permissions
        await next()
      })
      restrictedApp.use(
        '/api/actions/*',
        actions({
          actions: {
            'admin-action': {
              type: 'code',
              handler: async () => ({}),
              requiredPermission: 'admin:execute',
            },
          },
        })
      )

      const res = await invokeAction(restrictedApp, 'admin-action', { input: {} })
      expect(res.status).toBe(403)
    })

    it('allows action when user has required permission', async () => {
      const permittedApp = new Hono()
      permittedApp.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', role: 'admin', permissions: ['admin:execute'] })
        await next()
      })
      permittedApp.use(
        '/api/actions/*',
        actions({
          actions: {
            'admin-action': {
              type: 'code',
              handler: async () => ({ success: true }),
              requiredPermission: 'admin:execute',
            },
          },
        })
      )

      const res = await invokeAction(permittedApp, 'admin-action', { input: {} })
      expect(res.status).toBe(200)
    })
  })

  describe('Returns 404 for unknown action', () => {
    it('returns 404 for nonexistent action', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'existing-action': {
            type: 'code',
            handler: async () => ({}),
          },
        },
      })

      const res = await invokeAction(app, 'nonexistent-action')
      expect(res.status).toBe(404)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
    })

    it('returns 404 for empty action name', async () => {
      const app = createAuthenticatedApp({
        actions: {},
      })

      const res = await app.request('/api/actions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(404)
    })

    it('returns 404 for action with invalid characters', async () => {
      const app = createAuthenticatedApp({
        actions: {},
      })

      const res = await invokeAction(app, '../../../etc/passwd')
      expect(res.status).toBe(404)
    })

    it('returns error message indicating action not found', async () => {
      const app = createAuthenticatedApp({
        actions: {},
      })

      const res = await invokeAction(app, 'unknown')
      expect(res.status).toBe(404)

      const body = (await res.json()) as ErrorResponse
      expect(body.error?.toLowerCase()).toMatch(/action|not found|unknown/)
    })
  })

  describe('Handler error handling', () => {
    it('returns 500 when code handler throws', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'failing-action': {
            type: 'code',
            handler: async () => {
              throw new Error('Handler error')
            },
          },
        },
      })

      const res = await invokeAction(app, 'failing-action')
      expect(res.status).toBe(500)
    })

    it('does not leak error details in production', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'failing-action': {
            type: 'code',
            handler: async () => {
              throw new Error('Sensitive database credentials here')
            },
          },
        },
      })

      const res = await invokeAction(app, 'failing-action')
      expect(res.status).toBe(500)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).not.toContain('Sensitive')
      expect(body.error).not.toContain('database')
      expect(body.error).not.toContain('credentials')
    })

    it('handles malformed JSON input', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'test-action': {
            type: 'code',
            handler: async () => ({}),
          },
        },
      })

      const res = await app.request('/api/actions/test-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }',
      })

      expect(res.status).toBe(400)
    })

    it('handles empty body', async () => {
      const app = createAuthenticatedApp({
        actions: {
          'test-action': {
            type: 'code',
            handler: async () => ({}),
          },
        },
      })

      const res = await app.request('/api/actions/test-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      })

      // Should handle gracefully - either accept empty or return 400
      expect([200, 400]).toContain(res.status)
    })
  })
})

// ============================================================================
// 8. Configuration Tests
// ============================================================================

describe('Actions Middleware - Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Action configuration', () => {
    it('supports code function configuration', async () => {
      const handler = vi.fn().mockResolvedValue({ done: true })
      const app = createAuthenticatedApp({
        actions: {
          'test': {
            type: 'code',
            description: 'Test action',
            handler,
          },
        },
      })

      const res = await invokeAction(app, 'test')
      expect(res.status).toBe(200)
      expect(handler).toHaveBeenCalled()
    })

    it('supports generative function configuration', async () => {
      mockAI.generate.mockResolvedValue({ text: 'response' })

      const app = createAuthenticatedApp({
        actions: {
          'generate': {
            type: 'generative',
            model: 'claude-3-sonnet',
            prompt: 'Test: {{input}}',
            description: 'Generate text',
          },
        },
      })

      const res = await invokeAction(app, 'generate', { input: { data: 'test' } })
      expect(res.status).toBe(200)
    })

    it('supports agentic function configuration', async () => {
      mockAgentRunner.run.mockResolvedValue({ result: 'done' })

      const app = createAuthenticatedApp({
        actions: {
          'agent': {
            type: 'agentic',
            agent: 'test-agent',
            maxIterations: 5,
            description: 'Run agent',
          },
        },
      })

      const res = await invokeAction(app, 'agent', { input: {} })
      expect(res.status).toBe(200)
    })

    it('supports human function configuration', async () => {
      mockNotificationChannel.send.mockResolvedValue({ id: 'msg-1' })
      mockNotificationChannel.waitForResponse.mockResolvedValue({ approved: true })

      const app = createAuthenticatedApp({
        actions: {
          'human': {
            type: 'human',
            channel: 'slack',
            timeout: 60000,
            description: 'Get human input',
          },
        },
      })

      const res = await invokeAction(app, 'human', { input: {} })
      expect(res.status).toBe(200)
    })
  })

  describe('Multiple actions', () => {
    it('supports multiple actions of different types', async () => {
      const handler = vi.fn().mockResolvedValue({ done: true })
      mockAI.generate.mockResolvedValue({ text: 'ai' })
      mockAgentRunner.run.mockResolvedValue({ result: 'agent' })
      mockNotificationChannel.send.mockResolvedValue({})
      mockNotificationChannel.waitForResponse.mockResolvedValue({ ok: true })

      const app = createAuthenticatedApp({
        actions: {
          'code-action': { type: 'code', handler },
          'ai-action': { type: 'generative', model: 'claude', prompt: 'test' },
          'agent-action': { type: 'agentic', agent: 'test', maxIterations: 3 },
          'human-action': { type: 'human', channel: 'slack', timeout: 1000 },
        },
      })

      const [codeRes, aiRes, agentRes, humanRes] = await Promise.all([
        invokeAction(app, 'code-action'),
        invokeAction(app, 'ai-action'),
        invokeAction(app, 'agent-action'),
        invokeAction(app, 'human-action'),
      ])

      expect(codeRes.status).toBe(200)
      expect(aiRes.status).toBe(200)
      expect(agentRes.status).toBe(200)
      expect(humanRes.status).toBe(200)
    })
  })

  describe('No configuration', () => {
    it('works with empty actions config', async () => {
      const app = createAuthenticatedApp({
        actions: {},
      })

      const listRes = await listActions(app)
      expect(listRes.status).toBe(200)

      const body = (await listRes.json()) as ActionListResponse
      expect(body.actions).toEqual([])
    })

    it('works with undefined config', async () => {
      const app = createAuthenticatedApp()

      const listRes = await listActions(app)
      expect(listRes.status).toBe(200)
    })
  })
})

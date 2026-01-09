/**
 * Browse Tools Tests
 *
 * RED TDD: These tests should FAIL because the browse tools don't exist yet.
 *
 * These tests verify the browser automation tools that integrate with
 * the Browser DO for web automation tasks via Stagehand primitives.
 *
 * Tests cover:
 * 1. browseTool.execute() navigates to URL via Browser DO
 * 2. actTool.execute() sends instruction to Browser DO
 * 3. extractTool.execute() returns structured data from Browser DO
 * 4. observeTool.execute() returns available actions
 * 5. screenshotTool.execute() returns base64 image
 * 6. closeBrowserTool.execute() stops browser session
 * 7. Tools reuse browser session from AgentContext.state
 * 8. Tools create new session if none exists
 * 9. Tool parameters validate correctly
 * 10. Tool errors propagate with context
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  browseTool,
  actTool,
  extractTool,
  observeTool,
  screenshotTool,
  closeBrowserTool,
} from '../../tools/browse'

import type { AgentContext, ToolDefinition } from '../AgenticFunctionExecutor'

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockAgentContext(overrides?: Partial<AgentContext>): AgentContext {
  const storage = new Map<string, unknown>()

  return {
    agentId: 'test-agent-id',
    invocationId: 'test-invocation-id',
    currentIteration: 1,
    maxIterations: 10,
    state: {
      get: vi.fn(async <T>(key: string) => storage.get(key) as T | null),
      set: vi.fn(async <T>(key: string, value: T) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      getAll: vi.fn(async () => {
        const result: Record<string, unknown> = {}
        for (const [key, value] of storage) {
          result[key] = value
        }
        return result
      }),
    },
    ai: {
      complete: vi.fn().mockResolvedValue({
        text: 'AI response',
        stopReason: 'end_turn' as const,
      }),
    },
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    emit: vi.fn().mockResolvedValue(undefined),
    signal: new AbortController().signal,
    ...overrides,
  }
}

// Mock fetch for Browser DO calls
let mockFetch: ReturnType<typeof vi.fn>

// ============================================================================
// TESTS
// ============================================================================

describe('Browse Tools for AgenticFunctionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mock fetch for Browser DO API calls
    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. browseTool.execute() navigates to URL via Browser DO
  // ==========================================================================

  describe('1. browseTool - Navigate to URL', () => {
    it('has correct tool definition', () => {
      expect(browseTool).toBeDefined()
      expect(browseTool.name).toBe('browse')
      expect(browseTool.description).toContain('navigate')
      expect(browseTool.parameters.type).toBe('object')
      expect(browseTool.parameters.properties).toHaveProperty('url')
      expect(browseTool.parameters.required).toContain('url')
    })

    it('navigates to URL via Browser DO', async () => {
      const ctx = createMockAgentContext()

      // Mock Browser DO /start response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            sessionId: 'browser-session-123',
            liveViewUrl: 'https://live.example.com/session-123',
          }),
        })
        // Mock Browser DO /navigate response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            currentUrl: 'https://example.com',
            title: 'Example Domain',
          }),
        })

      const result = await browseTool.execute({ url: 'https://example.com' }, ctx)

      expect(result).toMatchObject({
        success: true,
        currentUrl: 'https://example.com',
        title: 'Example Domain',
      })
    })

    it('stores session ID in context state', async () => {
      const ctx = createMockAgentContext()

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            sessionId: 'browser-session-456',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            currentUrl: 'https://example.com',
          }),
        })

      await browseTool.execute({ url: 'https://example.com' }, ctx)

      expect(ctx.state.set).toHaveBeenCalledWith(
        'browser:sessionId',
        'browser-session-456'
      )
    })
  })

  // ==========================================================================
  // 2. actTool.execute() sends instruction to Browser DO
  // ==========================================================================

  describe('2. actTool - Execute natural language action', () => {
    it('has correct tool definition', () => {
      expect(actTool).toBeDefined()
      expect(actTool.name).toBe('act')
      expect(actTool.description).toContain('action')
      expect(actTool.parameters.properties).toHaveProperty('instruction')
      expect(actTool.parameters.required).toContain('instruction')
    })

    it('sends instruction to Browser DO', async () => {
      const ctx = createMockAgentContext()
      // Pre-set session ID
      await ctx.state.set('browser:sessionId', 'existing-session-123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          action: 'clicked',
          element: 'button[type="submit"]',
        }),
      })

      const result = await actTool.execute(
        { instruction: 'Click the submit button' },
        ctx
      )

      expect(result).toMatchObject({
        success: true,
        action: 'clicked',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/act'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Click the submit button'),
        })
      )
    })

    it('returns action details from Browser DO response', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          action: 'typed',
          element: 'input[name="email"]',
          text: 'test@example.com',
        }),
      })

      const result = await actTool.execute(
        { instruction: 'Type test@example.com in the email field' },
        ctx
      )

      expect(result).toMatchObject({
        success: true,
        action: 'typed',
        element: 'input[name="email"]',
        text: 'test@example.com',
      })
    })
  })

  // ==========================================================================
  // 3. extractTool.execute() returns structured data from Browser DO
  // ==========================================================================

  describe('3. extractTool - Pull structured data', () => {
    it('has correct tool definition', () => {
      expect(extractTool).toBeDefined()
      expect(extractTool.name).toBe('extract')
      expect(extractTool.description).toContain('extract')
      expect(extractTool.parameters.properties).toHaveProperty('instruction')
    })

    it('returns structured data from Browser DO', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            products: [
              { name: 'Product A', price: '$10.00' },
              { name: 'Product B', price: '$20.00' },
            ],
          },
        }),
      })

      const result = await extractTool.execute(
        {
          instruction: 'Extract all product names and prices',
          schema: {
            type: 'object',
            properties: {
              products: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    price: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        ctx
      )

      expect(result).toMatchObject({
        success: true,
        data: {
          products: expect.arrayContaining([
            expect.objectContaining({ name: 'Product A' }),
          ]),
        },
      })
    })

    it('sends schema to Browser DO for extraction', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      const schema = {
        type: 'object',
        properties: { title: { type: 'string' } },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { title: 'Page Title' },
        }),
      })

      await extractTool.execute(
        { instruction: 'Extract the page title', schema },
        ctx
      )

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/extract'),
        expect.objectContaining({
          body: expect.stringContaining('"schema"'),
        })
      )
    })
  })

  // ==========================================================================
  // 4. observeTool.execute() returns available actions
  // ==========================================================================

  describe('4. observeTool - Discover available actions', () => {
    it('has correct tool definition', () => {
      expect(observeTool).toBeDefined()
      expect(observeTool.name).toBe('observe')
      expect(observeTool.description).toContain('observe')
    })

    it('returns available actions from Browser DO', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          actions: [
            { type: 'click', selector: 'button.submit', description: 'Submit form' },
            { type: 'input', selector: 'input[name="search"]', description: 'Search field' },
            { type: 'navigate', selector: 'a.nav-link', description: 'Navigation link' },
          ],
        }),
      })

      const result = await observeTool.execute({}, ctx)

      expect(result).toMatchObject({
        success: true,
        actions: expect.arrayContaining([
          expect.objectContaining({ type: 'click', selector: 'button.submit' }),
          expect.objectContaining({ type: 'input' }),
        ]),
      })
    })

    it('can filter observations by instruction', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          actions: [
            { type: 'click', selector: 'button.login', description: 'Login button' },
          ],
        }),
      })

      const result = await observeTool.execute(
        { instruction: 'Find login related elements' },
        ctx
      )

      expect(result.actions).toContainEqual(
        expect.objectContaining({ description: expect.stringContaining('Login') })
      )
    })
  })

  // ==========================================================================
  // 5. screenshotTool.execute() returns base64 image
  // ==========================================================================

  describe('5. screenshotTool - Capture page', () => {
    it('has correct tool definition', () => {
      expect(screenshotTool).toBeDefined()
      expect(screenshotTool.name).toBe('screenshot')
      expect(screenshotTool.description).toContain('screenshot')
    })

    it('returns base64 image from Browser DO', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      const mockBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ...'

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          screenshot: mockBase64,
          format: 'png',
        }),
      })

      const result = await screenshotTool.execute({}, ctx)

      expect(result).toMatchObject({
        success: true,
        screenshot: mockBase64,
        format: 'png',
      })
    })

    it('supports fullPage option', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          screenshot: 'base64data',
          fullPage: true,
        }),
      })

      await screenshotTool.execute({ fullPage: true }, ctx)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/screenshot'),
        expect.objectContaining({
          body: expect.stringContaining('"fullPage":true'),
        })
      )
    })

    it('supports selector option for element screenshot', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          screenshot: 'element-base64',
          selector: '#main-content',
        }),
      })

      await screenshotTool.execute({ selector: '#main-content' }, ctx)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('#main-content'),
        })
      )
    })
  })

  // ==========================================================================
  // 6. closeBrowserTool.execute() stops browser session
  // ==========================================================================

  describe('6. closeBrowserTool - End session', () => {
    it('has correct tool definition', () => {
      expect(closeBrowserTool).toBeDefined()
      expect(closeBrowserTool.name).toBe('closeBrowser')
      expect(closeBrowserTool.description).toContain('close')
    })

    it('stops browser session via Browser DO', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-to-close')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          sessionId: 'session-to-close',
          status: 'stopped',
        }),
      })

      const result = await closeBrowserTool.execute({}, ctx)

      expect(result).toMatchObject({
        success: true,
        status: 'stopped',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/stop'),
        expect.any(Object)
      )
    })

    it('clears session ID from context state', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-to-clear')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, status: 'stopped' }),
      })

      await closeBrowserTool.execute({}, ctx)

      expect(ctx.state.delete).toHaveBeenCalledWith('browser:sessionId')
    })

    it('returns success even if no session exists', async () => {
      const ctx = createMockAgentContext()
      // No session set

      const result = await closeBrowserTool.execute({}, ctx)

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining('no active'),
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // 7. Tools reuse browser session from AgentContext.state
  // ==========================================================================

  describe('7. Session Reuse', () => {
    it('reuses existing session from AgentContext.state', async () => {
      const ctx = createMockAgentContext()
      // Pre-set existing session
      await ctx.state.set('browser:sessionId', 'existing-session-789')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          currentUrl: 'https://newpage.com',
        }),
      })

      await browseTool.execute({ url: 'https://newpage.com' }, ctx)

      // Should NOT call /start - should reuse session
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/start'),
        expect.any(Object)
      )
    })

    it('passes existing session ID in requests', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'reuse-session-id')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, actions: [] }),
      })

      await observeTool.execute({}, ctx)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('reuse-session-id'),
        expect.any(Object)
      )
    })

    it('multiple tools share the same session', async () => {
      const ctx = createMockAgentContext()

      // First tool creates session
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            sessionId: 'shared-session-id',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, currentUrl: 'https://example.com' }),
        })

      await browseTool.execute({ url: 'https://example.com' }, ctx)

      // Second tool reuses session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, actions: [] }),
      })

      await observeTool.execute({}, ctx)

      // Third tool also reuses
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, screenshot: 'data' }),
      })

      await screenshotTool.execute({}, ctx)

      // Session should only be created once
      const startCalls = mockFetch.mock.calls.filter(
        (call) => call[0].includes('/start')
      )
      expect(startCalls).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 8. Tools create new session if none exists
  // ==========================================================================

  describe('8. Session Creation', () => {
    it('creates new session if none exists', async () => {
      const ctx = createMockAgentContext()
      // No session in state

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            sessionId: 'new-session-created',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, currentUrl: 'https://example.com' }),
        })

      await browseTool.execute({ url: 'https://example.com' }, ctx)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/start'),
        expect.any(Object)
      )
    })

    it('actTool creates session if needed', async () => {
      const ctx = createMockAgentContext()

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            sessionId: 'act-session',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, action: 'clicked' }),
        })

      await actTool.execute({ instruction: 'Click button' }, ctx)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/start'),
        expect.any(Object)
      )
    })

    it('extractTool creates session if needed', async () => {
      const ctx = createMockAgentContext()

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            sessionId: 'extract-session',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: {} }),
        })

      await extractTool.execute({ instruction: 'Get data' }, ctx)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/start'),
        expect.any(Object)
      )
    })

    it('observeTool creates session if needed', async () => {
      const ctx = createMockAgentContext()

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            sessionId: 'observe-session',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, actions: [] }),
        })

      await observeTool.execute({}, ctx)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/start'),
        expect.any(Object)
      )
    })

    it('screenshotTool creates session if needed', async () => {
      const ctx = createMockAgentContext()

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            sessionId: 'screenshot-session',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, screenshot: 'data' }),
        })

      await screenshotTool.execute({}, ctx)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/start'),
        expect.any(Object)
      )
    })
  })

  // ==========================================================================
  // 9. Tool parameters validate correctly
  // ==========================================================================

  describe('9. Parameter Validation', () => {
    it('browseTool validates url is required', async () => {
      const ctx = createMockAgentContext()

      await expect(browseTool.execute({}, ctx)).rejects.toThrow(/url.*required/i)
    })

    it('browseTool validates url format', async () => {
      const ctx = createMockAgentContext()

      await expect(
        browseTool.execute({ url: 'not-a-valid-url' }, ctx)
      ).rejects.toThrow(/url.*valid/i)
    })

    it('actTool validates instruction is required', async () => {
      const ctx = createMockAgentContext()

      await expect(actTool.execute({}, ctx)).rejects.toThrow(/instruction.*required/i)
    })

    it('actTool validates instruction is not empty', async () => {
      const ctx = createMockAgentContext()

      await expect(
        actTool.execute({ instruction: '' }, ctx)
      ).rejects.toThrow(/instruction.*empty/i)
    })

    it('extractTool validates instruction is required', async () => {
      const ctx = createMockAgentContext()

      await expect(extractTool.execute({}, ctx)).rejects.toThrow(/instruction.*required/i)
    })

    it('screenshotTool validates selector when provided', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      // Empty selector should fail
      await expect(
        screenshotTool.execute({ selector: '' }, ctx)
      ).rejects.toThrow(/selector.*empty/i)
    })

    it('tools have correct parameter schemas', () => {
      // Verify all tools implement ToolDefinition correctly
      const tools = [browseTool, actTool, extractTool, observeTool, screenshotTool, closeBrowserTool]

      for (const tool of tools) {
        expect(tool.name).toBeTypeOf('string')
        expect(tool.description).toBeTypeOf('string')
        expect(tool.parameters.type).toBe('object')
        expect(tool.execute).toBeTypeOf('function')
      }
    })
  })

  // ==========================================================================
  // 10. Tool errors propagate with context
  // ==========================================================================

  describe('10. Error Propagation', () => {
    it('propagates Browser DO HTTP errors', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Browser crashed' }),
      })

      await expect(browseTool.execute({ url: 'https://example.com' }, ctx)).rejects.toThrow(
        /Browser.*error|500|Internal Server/i
      )
    })

    it('propagates Browser DO operation errors', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: false,
          error: 'Element not found: #nonexistent',
        }),
      })

      const result = await actTool.execute(
        { instruction: 'Click on #nonexistent' },
        ctx
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Element not found')
    })

    it('includes tool name in error context', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      try {
        await browseTool.execute({ url: 'https://example.com' }, ctx)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toContain('browse')
      }
    })

    it('includes session context in errors', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'error-session-id')

      mockFetch.mockRejectedValueOnce(new Error('Connection lost'))

      try {
        await actTool.execute({ instruction: 'Click' }, ctx)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toMatch(/error-session-id|session/i)
      }
    })

    it('handles session creation failures', async () => {
      const ctx = createMockAgentContext()

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: () => Promise.resolve({ error: 'Browser pool exhausted' }),
      })

      await expect(browseTool.execute({ url: 'https://example.com' }, ctx)).rejects.toThrow(
        /session|unavailable|exhausted/i
      )
    })

    it('handles timeout errors', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockRejectedValueOnce(new Error('Request timeout'))

      await expect(actTool.execute({ instruction: 'Click slow button' }, ctx)).rejects.toThrow(
        /timeout/i
      )
    })

    it('logs errors via context.log', async () => {
      const ctx = createMockAgentContext()
      await ctx.state.set('browser:sessionId', 'session-123')

      mockFetch.mockRejectedValueOnce(new Error('Test error for logging'))

      try {
        await browseTool.execute({ url: 'https://example.com' }, ctx)
      } catch {
        // Expected
      }

      expect(ctx.log.error).toHaveBeenCalledWith(
        expect.stringContaining('browse'),
        expect.anything()
      )
    })
  })

  // ==========================================================================
  // Additional Tool Behavior Tests
  // ==========================================================================

  describe('Tool Integration Behavior', () => {
    it('all tools conform to ToolDefinition interface', () => {
      const tools: ToolDefinition[] = [
        browseTool,
        actTool,
        extractTool,
        observeTool,
        screenshotTool,
        closeBrowserTool,
      ]

      for (const tool of tools) {
        expect(tool).toMatchObject({
          name: expect.any(String),
          description: expect.any(String),
          parameters: {
            type: 'object',
          },
          execute: expect.any(Function),
        })
      }
    })

    it('browseTool can be registered with executor', () => {
      // Verifies the tool can be used with AgenticFunctionExecutor
      expect(browseTool.name).toBe('browse')
      expect(typeof browseTool.execute).toBe('function')
    })
  })
})

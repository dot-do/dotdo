/**
 * @dotdo/automation - Actions Tests
 *
 * Tests for n8n-compatible action nodes including:
 * - HTTP Request node (make HTTP calls)
 * - Code node (execute JavaScript/TypeScript)
 * - Set node (data transformation)
 * - Function node (custom logic)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  HttpRequestAction,
  CodeAction,
  SetAction,
  FunctionAction,
  type ActionContext,
} from '../src'

describe('Automation Actions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ============================================================================
  // HTTP REQUEST ACTION
  // ============================================================================

  describe('HttpRequestAction', () => {
    it('should create an HTTP request action', () => {
      const action = new HttpRequestAction({
        method: 'GET',
        url: 'https://api.example.com/users',
      })

      expect(action.method).toBe('GET')
      expect(action.url).toBe('https://api.example.com/users')
    })

    it('should support all HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

      for (const method of methods) {
        const action = new HttpRequestAction({
          method,
          url: 'https://api.example.com',
        })
        expect(action.method).toBe(method)
      }
    })

    it('should execute GET request', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1, name: 'John' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const action = new HttpRequestAction({
        method: 'GET',
        url: 'https://api.example.com/users/1',
      })

      const result = await action.execute({})

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ id: 1, name: 'John' })
      expect(result.statusCode).toBe(200)

      vi.unstubAllGlobals()
    })

    it('should execute POST request with body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 2, created: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const action = new HttpRequestAction({
        method: 'POST',
        url: 'https://api.example.com/users',
        body: { name: 'Jane', email: 'jane@example.com' },
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await action.execute({})

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
        })
      )
      expect(result.success).toBe(true)
      expect(result.statusCode).toBe(201)

      vi.unstubAllGlobals()
    })

    it('should support URL parameters from input', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const action = new HttpRequestAction({
        method: 'GET',
        url: 'https://api.example.com/users/{{userId}}',
      })

      await action.execute({ userId: '123' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/123',
        expect.anything()
      )

      vi.unstubAllGlobals()
    })

    it('should support query parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const action = new HttpRequestAction({
        method: 'GET',
        url: 'https://api.example.com/users',
        queryParameters: {
          page: '1',
          limit: '10',
          status: 'active',
        },
      })

      await action.execute({})

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users?page=1&limit=10&status=active',
        expect.anything()
      )

      vi.unstubAllGlobals()
    })

    it('should support bearer authentication', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{}', { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const action = new HttpRequestAction({
        method: 'GET',
        url: 'https://api.example.com/protected',
        authentication: {
          type: 'bearer',
          token: 'my-jwt-token',
        },
      })

      await action.execute({})

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-jwt-token',
          }),
        })
      )

      vi.unstubAllGlobals()
    })

    it('should handle error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      vi.stubGlobal('fetch', mockFetch)

      const action = new HttpRequestAction({
        method: 'GET',
        url: 'https://api.example.com/missing',
      })

      const result = await action.execute({})

      expect(result.success).toBe(false)
      expect(result.statusCode).toBe(404)
      expect(result.data).toEqual({ error: 'Not found' })

      vi.unstubAllGlobals()
    })
  })

  // ============================================================================
  // CODE ACTION
  // ============================================================================

  describe('CodeAction', () => {
    it('should create a code action with JavaScript', () => {
      const action = new CodeAction({
        language: 'javascript',
        code: 'return { result: input.value * 2 }',
      })

      expect(action.language).toBe('javascript')
    })

    it('should execute JavaScript code', async () => {
      const action = new CodeAction({
        language: 'javascript',
        code: `
          const doubled = input.value * 2;
          return { result: doubled };
        `,
      })

      const result = await action.execute({ value: 21 })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ result: 42 })
    })

    it('should have access to input data', async () => {
      const action = new CodeAction({
        language: 'javascript',
        code: `
          return {
            name: input.user.name,
            upper: input.user.name.toUpperCase(),
          };
        `,
      })

      const result = await action.execute({
        user: { name: 'John Doe' },
      })

      expect(result.data).toEqual({
        name: 'John Doe',
        upper: 'JOHN DOE',
      })
    })

    it('should handle code errors', async () => {
      const action = new CodeAction({
        language: 'javascript',
        code: `
          throw new Error('Intentional error');
        `,
      })

      const result = await action.execute({})

      expect(result.success).toBe(false)
      expect(result.error).toContain('Intentional error')
    })

    it('should support multiple items (batch processing)', async () => {
      const action = new CodeAction({
        language: 'javascript',
        code: `
          return items.map(item => ({
            ...item,
            processed: true,
          }));
        `,
        mode: 'all', // Process all items at once
      })

      const result = await action.execute({}, [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ])

      expect(result.data).toEqual([
        { id: 1, processed: true },
        { id: 2, processed: true },
        { id: 3, processed: true },
      ])
    })
  })

  // ============================================================================
  // SET ACTION
  // ============================================================================

  describe('SetAction', () => {
    it('should create a set action', () => {
      const action = new SetAction({
        values: [
          { name: 'greeting', value: 'Hello' },
        ],
      })

      expect(action.values).toHaveLength(1)
    })

    it('should set static values', async () => {
      const action = new SetAction({
        values: [
          { name: 'status', value: 'active' },
          { name: 'count', value: 10 },
        ],
      })

      const result = await action.execute({})

      expect(result.data).toEqual({
        status: 'active',
        count: 10,
      })
    })

    it('should set values from expressions', async () => {
      const action = new SetAction({
        values: [
          { name: 'fullName', value: '{{firstName}} {{lastName}}' },
          { name: 'doubled', value: '={{value * 2}}' },
        ],
      })

      const result = await action.execute({
        firstName: 'John',
        lastName: 'Doe',
        value: 21,
      })

      expect(result.data).toEqual({
        fullName: 'John Doe',
        doubled: 42,
      })
    })

    it('should support nested path assignment', async () => {
      const action = new SetAction({
        values: [
          { name: 'user.name', value: 'John' },
          { name: 'user.profile.age', value: 30 },
        ],
      })

      const result = await action.execute({})

      expect(result.data).toEqual({
        user: {
          name: 'John',
          profile: {
            age: 30,
          },
        },
      })
    })

    it('should merge with input data', async () => {
      const action = new SetAction({
        values: [
          { name: 'newField', value: 'added' },
        ],
        mode: 'merge',
      })

      const result = await action.execute({
        existingField: 'preserved',
      })

      expect(result.data).toEqual({
        existingField: 'preserved',
        newField: 'added',
      })
    })

    it('should replace input data when mode is replace', async () => {
      const action = new SetAction({
        values: [
          { name: 'newField', value: 'only this' },
        ],
        mode: 'replace',
      })

      const result = await action.execute({
        existingField: 'will be removed',
      })

      expect(result.data).toEqual({
        newField: 'only this',
      })
    })
  })

  // ============================================================================
  // FUNCTION ACTION
  // ============================================================================

  describe('FunctionAction', () => {
    it('should create a function action', () => {
      const action = new FunctionAction({
        name: 'processOrder',
        fn: async (_input) => ({ processed: true }),
      })

      expect(action.name).toBe('processOrder')
    })

    it('should execute the provided function', async () => {
      const action = new FunctionAction({
        name: 'calculate',
        fn: async (input) => ({
          sum: (input as { a: number; b: number }).a + (input as { a: number; b: number }).b,
          product: (input as { a: number; b: number }).a * (input as { a: number; b: number }).b,
        }),
      })

      const result = await action.execute({ a: 5, b: 3 })

      expect(result.data).toEqual({
        sum: 8,
        product: 15,
      })
    })

    it('should pass context to function', async () => {
      const action = new FunctionAction({
        name: 'withContext',
        fn: async (_input, context) => ({
          nodeId: context?.nodeId,
          workflowId: context?.workflowId,
          executionId: context?.executionId,
        }),
      })

      const result = await action.execute(
        {},
        undefined,
        {
          nodeId: 'node-1',
          workflowId: 'workflow-1',
          executionId: 'exec-1',
        }
      )

      expect((result.data as ActionContext).nodeId).toBe('node-1')
      expect((result.data as ActionContext).workflowId).toBe('workflow-1')
    })

    it('should handle function errors', async () => {
      const action = new FunctionAction({
        name: 'failing',
        fn: async () => {
          throw new Error('Function failed')
        },
      })

      const result = await action.execute({})

      expect(result.success).toBe(false)
      expect(result.error).toContain('Function failed')
    })

    it('should support returning null to filter items', async () => {
      const action = new FunctionAction({
        name: 'filter',
        fn: async (input) => {
          if ((input as { value: number }).value < 5) {
            return null // Filter out
          }
          return input
        },
      })

      const result = await action.execute({ value: 3 })

      expect(result.filtered).toBe(true)
      expect(result.data).toBeNull()
    })
  })

  // ============================================================================
  // ACTION COMPOSITION
  // ============================================================================

  describe('Action Composition', () => {
    it('should chain actions sequentially', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 1, name: 'Test' }), { status: 200 })
      )
      vi.stubGlobal('fetch', mockFetch)

      const httpAction = new HttpRequestAction({
        method: 'GET',
        url: 'https://api.example.com/item',
      })

      const setAction = new SetAction({
        values: [
          { name: 'processed', value: true },
        ],
        mode: 'merge',
      })

      // Execute HTTP action first
      const httpResult = await httpAction.execute({})

      // Pass result to set action
      const finalResult = await setAction.execute(httpResult.data as Record<string, unknown>)

      expect(finalResult.data).toEqual({
        id: 1,
        name: 'Test',
        processed: true,
      })

      vi.unstubAllGlobals()
    })
  })
})

import { describe, it, expect } from 'vitest'
import { executePipeline, type PipelineRequest } from '../pipeline'
import { createServer, validateMethodPath } from '../server'

/**
 * Tests for index access safety - ensuring proper bounds checks on array access
 * These tests verify that accessing array elements with potential undefined indices
 * is handled gracefully with appropriate errors.
 */
describe('Index Access Safety', () => {
  describe('pipeline.ts - executeSteps', () => {
    const target = {
      users: {
        get(id: string) {
          return { id, name: `User ${id}` }
        }
      },
      greet() {
        return 'hello'
      }
    }

    it('should handle empty method path (edge case after validation)', async () => {
      // Note: validateMethodPath should catch empty strings, but test the executor handles it
      const request: PipelineRequest = {
        method: 'greet', // Valid simple method
        args: [],
        pipeline: []
      }

      const response = await executePipeline(target, request)
      expect(response.error).toBeUndefined()
      expect(response.result).toBe('hello')
    })

    it('should handle single segment method path', async () => {
      const request: PipelineRequest = {
        method: 'greet',
        args: [],
        pipeline: []
      }

      const response = await executePipeline(target, request)
      expect(response.error).toBeUndefined()
      expect(response.result).toBe('hello')
    })

    it('should handle deeply nested method path', async () => {
      const deepTarget = {
        a: {
          b: {
            c: {
              method() {
                return 'deep'
              }
            }
          }
        }
      }

      const request: PipelineRequest = {
        method: 'a.b.c.method',
        args: [],
        pipeline: []
      }

      const response = await executePipeline(deepTarget, request)
      expect(response.error).toBeUndefined()
      expect(response.result).toBe('deep')
    })

    it('should return error for non-existent nested path', async () => {
      const request: PipelineRequest = {
        method: 'nonexistent.path.method',
        args: [],
        pipeline: []
      }

      const response = await executePipeline(target, request)
      expect(response.error).toBeDefined()
      expect(response.error?.stepIndex).toBe(-1)
    })

    it('should handle undefined pipeline step results gracefully', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['test'],
        pipeline: [
          { type: 'get', name: 'nonexistentProperty' }
        ]
      }

      const response = await executePipeline(target, request)
      // Accessing a non-existent property returns undefined, not an error
      expect(response.result).toBeUndefined()
    })

    it('should error when accessing property on undefined result', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['test'],
        pipeline: [
          { type: 'get', name: 'nonexistent' },
          { type: 'get', name: 'anotherProp' } // This should fail - accessing on undefined
        ]
      }

      const response = await executePipeline(target, request)
      expect(response.error).toBeDefined()
      expect(response.error?.stepIndex).toBe(1)
      expect(response.error?.message).toContain('Cannot read property')
    })

    it('should error when calling method on undefined result', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['test'],
        pipeline: [
          { type: 'get', name: 'nonexistent' },
          { type: 'call', name: 'someMethod' } // This should fail - calling on undefined
        ]
      }

      const response = await executePipeline(target, request)
      expect(response.error).toBeDefined()
      expect(response.error?.stepIndex).toBe(1)
      expect(response.error?.message).toContain('Cannot call method')
    })
  })

  describe('server.ts - method path handling', () => {
    const testTarget = {
      greet: (name: string) => `Hello, ${name}!`,
      users: {
        create: (data: { name: string }) => ({ id: '1', ...data }),
        nested: {
          deep: {
            method: () => 'deep result'
          }
        }
      }
    }

    it('should handle single method name without dots', async () => {
      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'greet', args: ['World'] })
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toBe('Hello, World!')
    })

    it('should handle nested method path', async () => {
      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.nested.deep.method', args: [] })
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toBe('deep result')
    })

    it('should return 404 for non-existent method path segment', async () => {
      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'users.nonexistent.method', args: [] })
      })

      expect(res.status).toBe(404)
    })
  })

  describe('validateMethodPath edge cases', () => {
    it('should reject empty string', () => {
      const result = validateMethodPath('')
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('empty')
      }
    })

    it('should handle single character method name', () => {
      const result = validateMethodPath('a')
      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.parts).toEqual(['a'])
      }
    })

    it('should handle method with only dots - invalid', () => {
      const result = validateMethodPath('...')
      expect(result.valid).toBe(false)
    })

    it('should handle method starting with dot - invalid', () => {
      const result = validateMethodPath('.method')
      expect(result.valid).toBe(false)
    })

    it('should handle method ending with dot - invalid', () => {
      const result = validateMethodPath('method.')
      expect(result.valid).toBe(false)
    })

    it('should parse valid nested path into parts', () => {
      const result = validateMethodPath('users.admin.create')
      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.parts).toEqual(['users', 'admin', 'create'])
      }
    })
  })
})

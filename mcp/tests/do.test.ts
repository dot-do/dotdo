import { describe, it, expect, beforeEach } from 'vitest'
import { createMCPServer, type MCPServer } from '../server'
import { doTool } from '../do'

describe('do tool', () => {
  let server: MCPServer

  beforeEach(() => {
    server = createMCPServer({ name: 'test-mcp', version: '1.0.0' })
    server.addTool(doTool)
  })

  describe('schema validation', () => {
    it('should have correct tool metadata', () => {
      const tool = server.tools.find(t => t.name === 'do')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('do')
      expect(tool?.description).toContain('sandbox')
      expect(tool?.inputSchema).toBeDefined()
    })

    it('should require code parameter', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'do', arguments: {} })
      })

      const response = await server.fetch(request)
      const json = await response.json()

      expect(json.isError).toBe(true)
      expect(json.content[0].text).toContain('code')
    })
  })

  describe('code execution', () => {
    it('should execute simple JavaScript code', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: { code: 'return 1 + 1' }
        })
      })

      const response = await server.fetch(request)
      expect(response.status).toBe(200)

      const json = await response.json()
      expect(json.isError).toBeUndefined()

      const result = json.content[0].data
      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    it('should execute code with console logs', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: `
              console.log('test message');
              return 42;
            `
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(true)
      expect(result.value).toBe(42)
      expect(result.logs).toBeDefined()
      expect(result.logs.length).toBeGreaterThan(0)
      expect(result.logs[0].message).toBe('test message')
    })

    it('should handle async code', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            // Return a promise directly, which the async wrapper will await
            code: `return Promise.resolve('async result');`
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(true)
      expect(result.value).toBe('async result')
    })
  })

  describe('sandbox isolation', () => {
    it('should not have access to process', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: 'return typeof process'
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should not have access to require', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: 'return typeof require'
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should block network access by default', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: `
              // In Cloudflare Workers sandbox, fetch is blocked when fetch: null
              // This test verifies that network access fails (either blocked or error)
              try {
                const response = await fetch('https://example.com');
                return 'fetch succeeded: ' + response.status;
              } catch (e) {
                return 'blocked: ' + e.message;
              }
            `
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      // Either succeeds with a blocked/error message, or fails
      if (result.success) {
        expect(result.value).toContain('blocked')
      } else {
        // If it errors out, that's also acceptable
        expect(result.error).toBeDefined()
      }
    })
  })

  describe('timeout enforcement', () => {
    it('should pass timeout parameter to sandbox', async () => {
      // Note: Actual timeout enforcement depends on the sandbox implementation
      // This test just verifies the timeout parameter is accepted
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: 'return "quick"',
            timeout: 100
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(true)
      expect(result.value).toBe('quick')
    })

    it('should respect custom timeout parameter', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: `return Promise.resolve('completed');`,
            timeout: 5000
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(true)
      expect(result.value).toBe('completed')
    })
  })

  describe('error handling', () => {
    it('should capture runtime errors', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: 'throw new Error("test error")'
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(false)
      expect(result.error).toContain('test error')
    })

    it('should capture syntax errors', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: 'const x = {' // Invalid syntax
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('execution metrics', () => {
    it('should return duration in result', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: 'return "test"'
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.duration).toBeDefined()
      expect(typeof result.duration).toBe('number')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('result serialization', () => {
    it('should serialize objects correctly', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: 'return { foo: "bar", num: 42 }'
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(true)
      expect(result.value).toEqual({ foo: 'bar', num: 42 })
    })

    it('should serialize arrays correctly', async () => {
      const request = new Request('http://localhost/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'do',
          arguments: {
            code: 'return [1, 2, 3]'
          }
        })
      })

      const response = await server.fetch(request)
      const json = await response.json()
      const result = json.content[0].data

      expect(result.success).toBe(true)
      expect(result.value).toEqual([1, 2, 3])
    })
  })
})

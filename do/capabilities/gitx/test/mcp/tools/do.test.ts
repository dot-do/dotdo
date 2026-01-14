import { describe, it, expect, beforeEach, vi } from 'vitest'
import { executeDo, doToolDefinition, DoToolInput, DoToolOutput } from '../../../src/mcp/tools/do'
import { ObjectStoreProxy } from '../../../src/mcp/sandbox/object-store-proxy'

describe('MCP do Tool', () => {
  let mockObjectStore: ObjectStoreProxy

  beforeEach(() => {
    // Create a mock ObjectStoreProxy for testing
    mockObjectStore = new ObjectStoreProxy({
      getObject: vi.fn().mockResolvedValue({ type: 'blob', data: new Uint8Array([1, 2, 3]) }),
      putObject: vi.fn().mockResolvedValue('abc123def456'),
      listObjects: vi.fn().mockResolvedValue(['sha1', 'sha2', 'sha3']),
    })
  })

  describe('executeDo', () => {
    describe('basic execution', () => {
      it('should execute simple code and return result', async () => {
        const input: DoToolInput = {
          code: 'return 2 + 2'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.result).toBe(4)
        expect(output.error).toBeUndefined()
        expect(output.logs).toEqual([])
        expect(typeof output.duration).toBe('number')
        expect(output.duration).toBeGreaterThanOrEqual(0)
      })

      it('should execute code that returns objects', async () => {
        const input: DoToolInput = {
          code: 'return { foo: "bar", count: 42 }'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.result).toEqual({ foo: 'bar', count: 42 })
      })

      it('should execute code that returns arrays', async () => {
        const input: DoToolInput = {
          code: 'return [1, 2, 3].map(x => x * 2)'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.result).toEqual([2, 4, 6])
      })

      it('should execute async code', async () => {
        const input: DoToolInput = {
          code: 'return await Promise.resolve("async result")'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.result).toBe('async result')
      })
    })

    describe('store access', () => {
      // Note: With workerd sandbox, store operations are not available inside the sandbox
      // for security reasons. Store operations should be performed outside the sandbox.
      it('should fail when trying to access store.getObject in sandbox', async () => {
        const input: DoToolInput = {
          code: `
            const obj = await store.getObject('abc123')
            return obj
          `
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toContain('store.getObject is not available in sandbox')
      })

      it('should fail when trying to access store.putObject in sandbox', async () => {
        const input: DoToolInput = {
          code: `
            const sha = await store.putObject('blob', new Uint8Array([4, 5, 6]))
            return sha
          `
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toContain('store.putObject is not available in sandbox')
      })

      it('should fail when trying to access store.listObjects in sandbox', async () => {
        const input: DoToolInput = {
          code: `
            const objects = await store.listObjects({ type: 'blob' })
            return objects
          `
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toContain('store.listObjects is not available in sandbox')
      })
    })

    describe('code validation', () => {
      it('should validate code before execution', async () => {
        const input: DoToolInput = {
          code: ''
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/empty|invalid|code required/i)
      })

      it('should reject code with syntax errors', async () => {
        const input: DoToolInput = {
          code: 'return { unclosed: '
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/syntax|parse|unexpected/i)
      })
    })

    describe('security', () => {
      it('should reject dangerous code patterns - eval', async () => {
        const input: DoToolInput = {
          code: 'return eval("1 + 1")'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/forbidden|not allowed|dangerous|security/i)
      })

      it('should reject dangerous code patterns - Function constructor', async () => {
        const input: DoToolInput = {
          code: 'return new Function("return 42")()'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/forbidden|not allowed|dangerous|security/i)
      })

      it('should reject dangerous code patterns - require', async () => {
        const input: DoToolInput = {
          code: 'const fs = require("fs"); return fs.readFileSync("/etc/passwd")'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/forbidden|not allowed|dangerous|security/i)
      })

      it('should reject dangerous code patterns - import', async () => {
        const input: DoToolInput = {
          code: 'const m = await import("child_process"); return m'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/forbidden|not allowed|dangerous|security/i)
      })

      it('should reject dangerous code patterns - process access', async () => {
        const input: DoToolInput = {
          code: 'return process.env'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/forbidden|not allowed|dangerous|security|undefined/i)
      })

      it('should reject dangerous code patterns - globalThis manipulation', async () => {
        const input: DoToolInput = {
          code: 'globalThis.malicious = true; return globalThis'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/forbidden|not allowed|dangerous|security/i)
      })
    })

    describe('timeout handling', () => {
      it('should respect timeout configuration', async () => {
        const input: DoToolInput = {
          code: 'while(true) {}', // Infinite loop
          timeout: 100
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/timeout|exceeded|limit/i)
        expect(output.duration).toBeLessThan(500) // Should fail quickly due to timeout
      })

      it('should use default timeout when not specified', async () => {
        const input: DoToolInput = {
          code: 'while(true) {}' // Infinite loop
          // No timeout specified, should use default (5000ms)
        }

        const startTime = Date.now()
        const output = await executeDo(input, mockObjectStore)
        const elapsed = Date.now() - startTime

        expect(output.success).toBe(false)
        expect(output.error).toMatch(/timeout|exceeded|limit/i)
        // Default timeout is 5000ms, allow some tolerance
        expect(elapsed).toBeLessThan(6000)
        expect(elapsed).toBeGreaterThanOrEqual(4000)
      })

      it('should complete fast code before timeout', async () => {
        const input: DoToolInput = {
          code: 'return "fast"',
          timeout: 5000
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.result).toBe('fast')
        expect(output.duration).toBeLessThan(100) // Should be very fast
      })
    })

    describe('console output capture', () => {
      it('should capture console.log output in logs', async () => {
        const input: DoToolInput = {
          code: `
            console.log('Hello')
            console.log('World')
            return 'done'
          `
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.logs).toContain('Hello')
        expect(output.logs).toContain('World')
        expect(output.result).toBe('done')
      })

      it('should capture console.warn output in logs', async () => {
        const input: DoToolInput = {
          code: `
            console.warn('Warning message')
            return 'done'
          `
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.logs.some(log => log.includes('Warning message'))).toBe(true)
      })

      it('should capture console.error output in logs', async () => {
        const input: DoToolInput = {
          code: `
            console.error('Error message')
            return 'done'
          `
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.logs.some(log => log.includes('Error message'))).toBe(true)
      })

      it('should stringify objects in console output', async () => {
        const input: DoToolInput = {
          code: `
            console.log({ key: 'value', num: 123 })
            return 'done'
          `
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.logs.some(log => log.includes('key') && log.includes('value'))).toBe(true)
      })
    })

    describe('error handling', () => {
      it('should handle execution errors gracefully', async () => {
        const input: DoToolInput = {
          code: 'throw new Error("Test error")'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toContain('Test error')
        expect(output.result).toBeUndefined()
      })

      it('should handle TypeError gracefully', async () => {
        const input: DoToolInput = {
          code: 'null.property'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toBeDefined()
        expect(output.error).toMatch(/TypeError|Cannot read|null/i)
      })

      it('should handle ReferenceError gracefully', async () => {
        const input: DoToolInput = {
          code: 'return undefinedVariable'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toBeDefined()
        expect(output.error).toMatch(/ReferenceError|not defined/i)
      })

      it('should preserve stack trace in error', async () => {
        const input: DoToolInput = {
          code: `
            function innerFunction() {
              throw new Error("Inner error")
            }
            innerFunction()
          `
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(output.error).toContain('Inner error')
      })
    })

    describe('duration tracking', () => {
      it('should return duration of execution', async () => {
        const input: DoToolInput = {
          code: 'return 42'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(typeof output.duration).toBe('number')
        expect(output.duration).toBeGreaterThanOrEqual(0)
      })

      it('should measure duration accurately for slow code', async () => {
        const input: DoToolInput = {
          code: `
            const start = Date.now()
            while (Date.now() - start < 50) {} // Wait 50ms
            return 'done'
          `,
          timeout: 1000
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(true)
        expect(output.duration).toBeGreaterThanOrEqual(50)
        expect(output.duration).toBeLessThan(200)
      })

      it('should include duration even on failure', async () => {
        const input: DoToolInput = {
          code: 'throw new Error("fail")'
        }

        const output = await executeDo(input, mockObjectStore)

        expect(output.success).toBe(false)
        expect(typeof output.duration).toBe('number')
        expect(output.duration).toBeGreaterThanOrEqual(0)
      })
    })
  })

  describe('doToolDefinition', () => {
    it('should have correct name', () => {
      expect(doToolDefinition.name).toBe('do')
    })

    it('should have correct description', () => {
      expect(doToolDefinition.description).toContain('Execute')
      expect(doToolDefinition.description).toContain('JavaScript')
      expect(doToolDefinition.description.toLowerCase()).toContain('git')
    })

    it('should have correct schema type', () => {
      expect(doToolDefinition.inputSchema.type).toBe('object')
    })

    it('should have code property in schema', () => {
      expect(doToolDefinition.inputSchema.properties).toHaveProperty('code')
      expect(doToolDefinition.inputSchema.properties.code.type).toBe('string')
      expect(doToolDefinition.inputSchema.properties.code.description).toBeDefined()
    })

    it('should have timeout property in schema', () => {
      expect(doToolDefinition.inputSchema.properties).toHaveProperty('timeout')
      expect(doToolDefinition.inputSchema.properties.timeout.type).toBe('number')
      expect(doToolDefinition.inputSchema.properties.timeout.description).toContain('milliseconds')
    })

    it('should require code parameter', () => {
      expect(doToolDefinition.inputSchema.required).toContain('code')
    })

    it('should not require timeout parameter', () => {
      expect(doToolDefinition.inputSchema.required).not.toContain('timeout')
    })

    it('doToolDefinition should have correct schema', () => {
      // Comprehensive schema check
      expect(doToolDefinition).toEqual({
        name: 'do',
        description: expect.stringContaining('Execute'),
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: expect.any(String)
            },
            timeout: {
              type: 'number',
              description: expect.stringContaining('milliseconds')
            }
          },
          required: ['code']
        }
      })
    })
  })
})

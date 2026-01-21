import { describe, it, expect, beforeEach } from 'vitest'
import { createSandbox, DEFAULT_RESOURCE_LIMITS, type SandboxOptions } from '../sandbox'
import type { WorkflowContext } from '@dotdo/do'
import { createTestContext, createEventCapture } from './test-helpers'

describe('Sandbox with $ context', () => {
  let context: WorkflowContext
  let capturedEvents: Array<{ type: string; payload?: unknown }>

  beforeEach(() => {
    // Create a real WorkflowContext using the test helper (NO MOCKS philosophy)
    const baseContext = createTestContext('sandbox-test')
    const capture = createEventCapture(baseContext)
    context = capture.wrappedContext
    capturedEvents = capture.capturedEvents
  })

  describe('Red: Failing Tests - $ availability', () => {
    it('should make $ available in sandbox global scope', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return typeof $')

      expect(result.success).toBe(true)
      expect(result.value).toBe('object')
    })

    it('should have $ with send method', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return typeof $.send')

      expect(result.success).toBe(true)
      expect(result.value).toBe('function')
    })

    it('should have $ with try method', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return typeof $.try')

      expect(result.success).toBe(true)
      expect(result.value).toBe('function')
    })

    it('should have $ with do method', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return typeof $.do')

      expect(result.success).toBe(true)
      expect(result.value).toBe('function')
    })

    it('should have $ with on proxy', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return typeof $.on')

      expect(result.success).toBe(true)
      expect(result.value).toBe('object')
    })

    it('should have $ with every proxy', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return typeof $.every')

      expect(result.success).toBe(true)
      expect(result.value).toBe('object')
    })
  })

  describe('Red: Failing Tests - $.send() emits events', () => {
    it('should emit events via $.send()', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.send({ type: 'Customer.signup', payload: { email: 'test@example.com' } })
        return 'sent'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('sent')
      // Using capturedEvents array instead of vi.fn() mock assertions (NO MOCKS philosophy)
      expect(capturedEvents).toContainEqual({
        type: 'Customer.signup',
        payload: { email: 'test@example.com' }
      })
    })

    it('should capture multiple events', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.send({ type: 'User.created', payload: { id: 1 } })
        $.send({ type: 'User.updated', payload: { id: 1, name: 'Alice' } })
        return 'sent'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('sent')
      // Using capturedEvents array instead of vi.fn() mock assertions (NO MOCKS philosophy)
      expect(capturedEvents.length).toBe(2)
    })

    it('should emit events with complex payloads', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.send({
          type: 'Order.placed',
          payload: {
            orderId: 'ord-123',
            items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }],
            total: 99.99
          }
        })
        return 'done'
      `)

      expect(result.success).toBe(true)
      // Using capturedEvents array instead of vi.fn() mock assertions (NO MOCKS philosophy)
      expect(capturedEvents).toContainEqual({
        type: 'Order.placed',
        payload: {
          orderId: 'ord-123',
          items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }],
          total: 99.99
        }
      })
    })
  })

  describe('Red: Failing Tests - $.try() executes actions', () => {
    it('should execute actions via $.try()', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        const result = await $.try(async () => {
          return 42
        })
        return result
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe(42)
      // Real WorkflowContext doesn't need mock call count verification (NO MOCKS philosophy)
      // The correct return value (42) proves $.try() was called and executed
    })

    it('should handle $.try() errors', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        try {
          await $.try(async () => {
            throw new Error('test error')
          })
          return 'should not reach'
        } catch (e) {
          return e.message
        }
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('test error')
    })

    it('should execute async operations in $.try()', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        const result = await $.try(async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return 'delayed'
        })
        return result
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('delayed')
    })
  })

  describe('Red: Failing Tests - $.do() with retry semantics', () => {
    it('should execute actions via $.do()', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        const result = await $.do(async () => {
          return 'success'
        })
        return result
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('success')
      // Real WorkflowContext doesn't need mock call count verification (NO MOCKS philosophy)
      // The correct return value proves $.do() was called and executed
    })

    it('should pass options to $.do()', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        const result = await $.do(
          async () => 'done',
          { retries: 5, backoff: 'linear', timeout: 10000 }
        )
        return result
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('done')
      // Real WorkflowContext - options are passed to the real implementation (NO MOCKS philosophy)
      // The correct return value proves $.do() executed successfully
    })

    it('should handle $.do() with default options', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        const result = await $.do(async () => 'default')
        return result
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('default')
    })
  })

  describe('Red: Failing Tests - $.on event handlers', () => {
    it('should register event handlers via $.on.Noun.verb', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.on.Customer.signup(async (event) => {
          console.log('handler called')
        })
        return 'registered'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('registered')
    })

    it('should support wildcard handlers $.on.*.created', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.on['*'].created(async (event) => {
          console.log('wildcard handler')
        })
        return 'registered'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('registered')
    })

    it('should allow multiple handlers for same event', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.on.User.created(async (e) => console.log('handler 1'))
        $.on.User.created(async (e) => console.log('handler 2'))
        return 'registered'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('registered')
    })
  })

  describe('Red: Failing Tests - $.every scheduling DSL', () => {
    it('should support $.every.day scheduling', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.every.day(async () => {
          console.log('daily task')
        })
        return 'scheduled'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('scheduled')
    })

    it('should support $.every.Monday.at9am', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.every.Monday.at9am(async () => {
          console.log('Monday morning')
        })
        return 'scheduled'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('scheduled')
    })

    it('should support $.every.hour scheduling', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.every.hour(async () => {
          console.log('hourly')
        })
        return 'scheduled'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('scheduled')
    })

    it('should support $.every.day.at("6pm")', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        $.every.day.at('6pm')(async () => {
          console.log('evening task')
        })
        return 'scheduled'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('scheduled')
    })
  })

  describe('Red: Failing Tests - Sandbox isolation', () => {
    it('should prevent access to raw DO state', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        return typeof $._events
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should prevent access to internal handlers map', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        return typeof $._handlers
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should prevent access to internal schedules map', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        return typeof $._schedules
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should only expose safe $ methods', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        const keys = Object.keys($)
        return keys.sort()
      `)

      expect(result.success).toBe(true)
      expect(result.value).toEqual(['do', 'every', 'on', 'send', 'try'])
    })
  })

  describe('Red: Failing Tests - Sandbox safety features', () => {
    it('should enforce timeout', async () => {
      const sandbox = createSandbox({ context: context, timeout: 100 })
      const result = await sandbox.execute('while(true) {}')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    // TODO(do-uyc5): fetch blocking requires globalOutbound support in Miniflare fallback
    // The worker_loaders binding correctly blocks fetch via globalOutbound: null
    // but Miniflare fallback in ai-evaluate/node.ts doesn't pass this option
    // Fix: Pass globalOutbound: null option in ai-evaluate's Miniflare configuration
    it.skip('should block network access', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        try {
          await fetch('https://example.com')
          return 'should not reach'
        } catch (e) {
          return 'blocked'
        }
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('blocked')
    })

    it('should not have access to process', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return typeof process')

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })

    it('should not have access to require', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return typeof require')

      expect(result.success).toBe(true)
      expect(result.value).toBe('undefined')
    })
  })

  describe('Red: Failing Tests - Result serialization', () => {
    it('should serialize primitive values', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return 42')

      expect(result.success).toBe(true)
      expect(result.value).toBe(42)
    })

    it('should serialize objects', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return { foo: "bar", num: 123 }')

      expect(result.success).toBe(true)
      expect(result.value).toEqual({ foo: 'bar', num: 123 })
    })

    it('should serialize arrays', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return [1, 2, 3]')

      expect(result.success).toBe(true)
      expect(result.value).toEqual([1, 2, 3])
    })

    it('should include execution duration', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return "test"')

      expect(result.duration).toBeDefined()
      expect(typeof result.duration).toBe('number')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('should capture console logs', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        console.log('test message')
        return 'done'
      `)

      expect(result.success).toBe(true)
      expect(result.logs).toBeDefined()
      expect(result.logs?.length).toBeGreaterThan(0)
      expect(result.logs?.[0].message).toBe('test message')
    })
  })

  describe('Red: Failing Tests - Error handling', () => {
    it('should capture runtime errors', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('throw new Error("test error")')

      expect(result.success).toBe(false)
      expect(result.error).toContain('test error')
    })

    it('should capture syntax errors', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('const x = {')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle errors in $.send()', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute(`
        try {
          $.send(null)
          return 'should not reach'
        } catch (e) {
          return 'error caught'
        }
      `)

      expect(result.success).toBe(true)
    })
  })

  describe('Red: Failing Tests - Audit logging', () => {
    it('should log $ operations when audit enabled', async () => {
      const auditLog: unknown[] = []
      const sandbox = createSandbox({
        context: context,
        audit: true,
        onAudit: (log) => auditLog.push(log)
      })

      await sandbox.execute(`
        $.send({ type: 'Test.event', payload: { id: 1 } })
        return 'done'
      `)

      expect(auditLog.length).toBeGreaterThan(0)
      expect(auditLog[0]).toMatchObject({
        operation: 'send',
        type: 'Test.event'
      })
    })

    it('should not log when audit disabled', async () => {
      const auditLog: unknown[] = []
      const sandbox = createSandbox({
        context: context,
        audit: false,
        onAudit: (log) => auditLog.push(log)
      })

      await sandbox.execute(`
        $.send({ type: 'Test.event' })
        return 'done'
      `)

      expect(auditLog.length).toBe(0)
    })
  })

  describe('Red: Failing Tests - Permission model', () => {
    it('should restrict operations when permissions specified', async () => {
      const sandbox = createSandbox({
        context: context,
        permissions: {
          allowSend: false,
          allowTry: true,
          allowDo: true,
          allowOn: true,
          allowEvery: true
        }
      })

      const result = await sandbox.execute(`
        try {
          $.send({ type: 'Test.event' })
          return 'should not reach'
        } catch (e) {
          return 'blocked'
        }
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('blocked')
    })

    it('should allow all operations by default', async () => {
      const sandbox = createSandbox({ context: context })

      const result = await sandbox.execute(`
        $.send({ type: 'Test.event' })
        await $.try(async () => 'test')
        await $.do(async () => 'test')
        return 'all allowed'
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe('all allowed')
    })
  })

  describe('Resource limits', () => {
    it('should include resource usage in result', async () => {
      const sandbox = createSandbox({ context: context })
      const result = await sandbox.execute('return 42')

      expect(result.success).toBe(true)
      expect(result.resourceUsage).toBeDefined()
      expect(result.resourceUsage?.executionTime).toBeGreaterThanOrEqual(0)
      expect(result.resourceUsage?.codeSize).toBeGreaterThan(0)
      expect(result.resourceUsage?.timedOut).toBe(false)
      expect(result.resourceUsage?.outputTruncated).toBe(false)
    })

    it('should reject code exceeding size limit', async () => {
      const sandbox = createSandbox({
        context: context,
        resourceLimits: {
          maxCodeSize: 50 // Very small limit
        }
      })

      const largeCode = 'return "' + 'x'.repeat(100) + '"'
      const result = await sandbox.execute(largeCode)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Code size')
      expect(result.error).toContain('exceeds maximum')
    })

    it('should use custom timeout from resourceLimits', async () => {
      const sandbox = createSandbox({
        context: context,
        resourceLimits: {
          timeout: 50 // Very short timeout
        }
      })

      const result = await sandbox.execute(`
        await new Promise(resolve => setTimeout(resolve, 200))
        return 'done'
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
      expect(result.resourceUsage?.timedOut).toBe(true)
    })

    it('should truncate large output', async () => {
      const sandbox = createSandbox({
        context: context,
        resourceLimits: {
          maxOutputSize: 100
        }
      })

      const result = await sandbox.execute(`
        return 'x'.repeat(1000)
      `)

      expect(result.success).toBe(true)
      expect(result.resourceUsage?.outputTruncated).toBe(true)
      expect(typeof result.value).toBe('string')
      expect((result.value as string).includes('[truncated]')).toBe(true)
    })

    it('should have default resource limits', () => {
      expect(DEFAULT_RESOURCE_LIMITS.timeout).toBe(5000)
      expect(DEFAULT_RESOURCE_LIMITS.maxCodeSize).toBe(100 * 1024)
      expect(DEFAULT_RESOURCE_LIMITS.maxOutputSize).toBe(1024 * 1024)
      expect(DEFAULT_RESOURCE_LIMITS.memoryLimitMB).toBe(128)
    })

    it('should support legacy timeout option', async () => {
      const sandbox = createSandbox({
        context: context,
        timeout: 50 // Legacy option
      })

      const result = await sandbox.execute(`
        await new Promise(resolve => setTimeout(resolve, 200))
        return 'done'
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
    })

    it('should report code size in resource usage', async () => {
      const sandbox = createSandbox({ context: context })
      const code = 'return "hello world"'
      const result = await sandbox.execute(code)

      expect(result.success).toBe(true)
      expect(result.resourceUsage?.codeSize).toBeGreaterThanOrEqual(code.length)
    })
  })
})

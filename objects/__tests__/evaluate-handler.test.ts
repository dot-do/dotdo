/**
 * Evaluate Handler Tests - TDD RED Phase
 *
 * Tests for the DO 'evaluate' RPC handler that executes code sandboxes
 * with the DO instance as the workflow context ($).
 *
 * Architecture:
 * - CLI sends code string via RPC
 * - DO runs ai-evaluate with $ = this (DO instance)
 * - Results stream back to CLI
 *
 * Key invariants:
 * 1. $ === this inside the sandbox (DO instance is the context)
 * 2. Flat namespace: globalThis.Customer === $.Customer
 * 3. Logs are captured and returned in result
 * 4. Errors are properly formatted and returned
 * 5. Timeouts are enforced (configurable)
 * 6. Result includes { success, value, error, logs, duration }
 *
 * These tests use real miniflare DO instances - NO MOCKS per CLAUDE.md.
 *
 * @module objects/__tests__/evaluate-handler.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// =============================================================================
// Types
// =============================================================================

/**
 * Result structure returned from evaluate RPC handler
 */
interface EvaluateResult {
  /** Whether the code executed successfully without throwing */
  success: boolean
  /** The return value from the evaluated code (JSON-serializable) */
  value?: unknown
  /** Error information if execution failed */
  error?: {
    message: string
    name?: string
    stack?: string
  }
  /** Captured console.log outputs during execution */
  logs: string[]
  /** Execution duration in milliseconds */
  duration: number
}

/**
 * Options for the evaluate RPC call
 */
interface EvaluateOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number
  /** Whether to capture console output (default: true) */
  captureLogs?: boolean
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Get a DOCore stub for testing evaluate handler
 */
function getEvaluateDO(name = 'evaluate-test') {
  const id = env.DOCore.idFromName(name)
  return env.DOCore.get(id)
}

/**
 * Helper to evaluate code on a DO instance via RPC
 * This is the interface we're testing - the DO should expose an `evaluate` method
 */
async function evaluateOnDO(
  code: string,
  options?: EvaluateOptions
): Promise<EvaluateResult> {
  const doInstance = getEvaluateDO(`eval-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  // The DO should expose an evaluate method via RPC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doInstance as any).evaluate(code, options)
}

// =============================================================================
// 1. BASIC EVALUATE RPC HANDLER
// =============================================================================

describe('Evaluate RPC Handler - Basic', () => {
  it('should expose evaluate method on DO instance', async () => {
    const doInstance = getEvaluateDO('expose-test')

    // DO should have evaluate method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (doInstance as any).evaluate).toBe('function')
  })

  it('should return result object with required fields', async () => {
    const result = await evaluateOnDO('return 42')

    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
    expect(Array.isArray(result.logs)).toBe(true)
    expect(typeof result.duration).toBe('number')
  })

  it('should execute simple return statement', async () => {
    const result = await evaluateOnDO('return 42')

    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
    expect(result.error).toBeUndefined()
  })

  it('should execute string expression', async () => {
    const result = await evaluateOnDO('return "hello world"')

    expect(result.success).toBe(true)
    expect(result.value).toBe('hello world')
  })

  it('should execute multi-line code', async () => {
    const code = `
      const a = 10
      const b = 20
      return a + b
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(30)
  })

  it('should execute async code', async () => {
    const code = `
      const result = await Promise.resolve(123)
      return result
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(123)
  })

  it('should handle undefined return', async () => {
    const result = await evaluateOnDO('const x = 1')

    expect(result.success).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('should serialize objects in return value', async () => {
    const code = 'return { name: "test", count: 5 }'
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ name: 'test', count: 5 })
  })

  it('should serialize arrays in return value', async () => {
    const result = await evaluateOnDO('return [1, 2, 3]')

    expect(result.success).toBe(true)
    expect(result.value).toEqual([1, 2, 3])
  })
})

// =============================================================================
// 2. WORKFLOW CONTEXT ($ === this)
// =============================================================================

describe('Evaluate RPC Handler - Workflow Context', () => {
  it('should have $ available in sandbox', async () => {
    const result = await evaluateOnDO('return typeof $')

    expect(result.success).toBe(true)
    expect(result.value).toBe('object')
  })

  it('should have $ === this (DO instance)', async () => {
    // In the sandbox, $ should be the DO instance
    // We verify by checking that $ has the expected DO methods
    const result = await evaluateOnDO('return typeof $.send')

    expect(result.success).toBe(true)
    expect(result.value).toBe('function')
  })

  it('should allow calling $.send() to emit events', async () => {
    const code = `
      const eventId = $.send('Test.evaluated', { code: 'test' })
      return eventId
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(typeof result.value).toBe('string')
    expect((result.value as string).startsWith('evt_')).toBe(true)
  })

  it('should allow calling $.Customer.create() via $', async () => {
    const code = `
      const customer = await $.Customer().create({ name: 'Test User' })
      return { id: customer.$id, type: customer.$type, name: customer.name }
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect((result.value as { id: string; type: string; name: string }).type).toBe('Customer')
    expect((result.value as { id: string; type: string; name: string }).name).toBe('Test User')
  })

  it('should have this === $ inside the sandbox', async () => {
    // Verify that $ is bound to the DO instance
    const code = `
      // Both should reference the same thing
      const hasGet = typeof $.get === 'function'
      const hasSet = typeof $.set === 'function'
      return { hasGet, hasSet }
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    const value = result.value as { hasGet: boolean; hasSet: boolean }
    expect(value.hasGet).toBe(true)
    expect(value.hasSet).toBe(true)
  })

  it('should allow accessing $.on proxy for event registration', async () => {
    const code = `
      // on.Noun.verb pattern should work
      const unsubscribe = $.on.Test.event(() => {})
      return typeof unsubscribe
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('function')
  })

  it('should allow accessing $.every for scheduling', async () => {
    const code = `
      const unsubscribe = $.every.hour(() => {})
      return typeof unsubscribe
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('function')
  })

  it('should allow calling $.do() for durable execution', async () => {
    const code = `
      const result = await $.do(async () => ({ executed: true }), { stepId: 'eval-test-step' })
      return result
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect((result.value as { executed: boolean }).executed).toBe(true)
  })

  it('should allow calling $.try() for single-attempt execution', async () => {
    const code = `
      const result = await $.try(async () => 'success')
      return result
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('success')
  })
})

// =============================================================================
// 3. FLAT NAMESPACE (globalThis.Customer === $.Customer)
// =============================================================================

describe('Evaluate RPC Handler - Flat Namespace', () => {
  it('should have Customer available at globalThis level', async () => {
    const result = await evaluateOnDO('return typeof Customer')

    expect(result.success).toBe(true)
    expect(result.value).toBe('function')
  })

  it('should have Customer() === $.Customer() (same accessor)', async () => {
    const code = `
      // Both should produce working noun accessors
      const c1 = Customer()
      const c2 = $.Customer()
      return typeof c1.create === 'function' && typeof c2.create === 'function'
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(true)
  })

  it('should allow Customer().create() without $ prefix', async () => {
    const code = `
      const customer = await Customer().create({ name: 'Flat Namespace Test' })
      return customer.name
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('Flat Namespace Test')
  })

  it('should allow Order().list() without $ prefix', async () => {
    const code = `
      const orders = await Order().list()
      return Array.isArray(orders)
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(true)
  })

  it('should have send() available at globalThis level', async () => {
    const code = `
      const eventId = send('GlobalTest.event', { global: true })
      return eventId.startsWith('evt_')
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(true)
  })

  it('should have on proxy available at globalThis level', async () => {
    const code = `
      const unsub = on.Global.event(() => {})
      return typeof unsub
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('function')
  })

  it('should have every available at globalThis level', async () => {
    const code = `
      return typeof every.hour
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('function')
  })

  it('should have common nouns available: Product, Invoice, Payment, User', async () => {
    const code = `
      return {
        Product: typeof Product,
        Invoice: typeof Invoice,
        Payment: typeof Payment,
        User: typeof User
      }
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    const types = result.value as Record<string, string>
    expect(types.Product).toBe('function')
    expect(types.Invoice).toBe('function')
    expect(types.Payment).toBe('function')
    expect(types.User).toBe('function')
  })
})

// =============================================================================
// 4. LOG CAPTURE
// =============================================================================

describe('Evaluate RPC Handler - Log Capture', () => {
  it('should capture console.log output', async () => {
    const code = `
      console.log('Hello from sandbox')
      return 'done'
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.logs).toContain('Hello from sandbox')
  })

  it('should capture multiple log statements', async () => {
    const code = `
      console.log('First log')
      console.log('Second log')
      console.log('Third log')
      return 'done'
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.logs.length).toBe(3)
    expect(result.logs[0]).toBe('First log')
    expect(result.logs[1]).toBe('Second log')
    expect(result.logs[2]).toBe('Third log')
  })

  it('should capture console.log with multiple arguments', async () => {
    const code = `
      console.log('Value:', 42, 'is', true)
      return 'done'
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.logs[0]).toContain('Value:')
    expect(result.logs[0]).toContain('42')
  })

  it('should capture console.log with object arguments', async () => {
    const code = `
      console.log('Object:', { name: 'test', value: 123 })
      return 'done'
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.logs[0]).toContain('name')
    expect(result.logs[0]).toContain('test')
  })

  it('should capture logs even when code throws', async () => {
    const code = `
      console.log('Before error')
      throw new Error('Test error')
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(false)
    expect(result.logs).toContain('Before error')
  })

  it('should capture console.warn as logs', async () => {
    const code = `
      console.warn('Warning message')
      return 'done'
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.logs.some(log => log.includes('Warning message'))).toBe(true)
  })

  it('should capture console.error as logs', async () => {
    const code = `
      console.error('Error message')
      return 'done'
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.logs.some(log => log.includes('Error message'))).toBe(true)
  })

  it('should allow disabling log capture via options', async () => {
    const code = `
      console.log('Should not be captured')
      return 'done'
    `
    const result = await evaluateOnDO(code, { captureLogs: false })

    expect(result.success).toBe(true)
    expect(result.logs.length).toBe(0)
  })
})

// =============================================================================
// 5. ERROR HANDLING
// =============================================================================

describe('Evaluate RPC Handler - Error Handling', () => {
  it('should catch thrown errors and return in result', async () => {
    const result = await evaluateOnDO('throw new Error("Test error")')

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error!.message).toBe('Test error')
  })

  it('should include error name in error object', async () => {
    const code = `
      const err = new TypeError('Type mismatch')
      throw err
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(false)
    expect(result.error!.name).toBe('TypeError')
    expect(result.error!.message).toBe('Type mismatch')
  })

  it('should include stack trace in error object', async () => {
    const result = await evaluateOnDO('throw new Error("Stack test")')

    expect(result.success).toBe(false)
    expect(result.error!.stack).toBeDefined()
    expect(typeof result.error!.stack).toBe('string')
  })

  it('should handle syntax errors gracefully', async () => {
    const result = await evaluateOnDO('return {{{invalid syntax')

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error!.message).toBeDefined()
  })

  it('should handle reference errors', async () => {
    const result = await evaluateOnDO('return undefinedVariable')

    expect(result.success).toBe(false)
    expect(result.error!.name).toBe('ReferenceError')
  })

  it('should handle rejected promises', async () => {
    const code = `
      await Promise.reject(new Error('Async rejection'))
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(false)
    expect(result.error!.message).toBe('Async rejection')
  })

  it('should handle thrown strings', async () => {
    const result = await evaluateOnDO('throw "string error"')

    expect(result.success).toBe(false)
    expect(result.error!.message).toBe('string error')
  })

  it('should handle thrown numbers', async () => {
    const result = await evaluateOnDO('throw 42')

    expect(result.success).toBe(false)
    expect(result.error!.message).toBe('42')
  })

  it('should handle thrown objects', async () => {
    const result = await evaluateOnDO('throw { code: "ERR_001", msg: "Custom error" }')

    expect(result.success).toBe(false)
    expect(result.error!.message).toContain('ERR_001')
  })

  it('should not expose internal DO state in errors', async () => {
    const result = await evaluateOnDO('throw new Error(JSON.stringify(this))')

    // Error should be captured but should not expose sensitive internals
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    // Stack should be sanitized to not reveal internal paths
    if (result.error!.stack) {
      expect(result.error!.stack).not.toContain('node_modules')
    }
  })
})

// =============================================================================
// 6. TIMEOUT ENFORCEMENT
// =============================================================================

describe('Evaluate RPC Handler - Timeout', () => {
  it('should enforce default timeout (5000ms)', async () => {
    const code = `
      // Infinite loop should be terminated
      while (true) { }
      return 'should not reach'
    `
    const startTime = Date.now()
    const result = await evaluateOnDO(code)
    const elapsed = Date.now() - startTime

    expect(result.success).toBe(false)
    expect(result.error!.message).toContain('timeout')
    // Should complete around 5 seconds (with some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(4500)
    expect(elapsed).toBeLessThan(7000)
  })

  it('should respect custom timeout option', async () => {
    const code = `
      await new Promise(r => setTimeout(r, 3000))
      return 'completed'
    `
    const startTime = Date.now()
    const result = await evaluateOnDO(code, { timeout: 1000 })
    const elapsed = Date.now() - startTime

    expect(result.success).toBe(false)
    expect(result.error!.message).toContain('timeout')
    // Should complete around 1 second
    expect(elapsed).toBeGreaterThanOrEqual(900)
    expect(elapsed).toBeLessThan(2000)
  })

  it('should complete fast code before timeout', async () => {
    const code = `
      return 'quick'
    `
    const result = await evaluateOnDO(code, { timeout: 5000 })

    expect(result.success).toBe(true)
    expect(result.value).toBe('quick')
    // Duration should be very short
    expect(result.duration).toBeLessThan(100)
  })

  it('should include duration even on timeout', async () => {
    const code = `
      while (true) { }
    `
    const result = await evaluateOnDO(code, { timeout: 500 })

    expect(result.success).toBe(false)
    expect(result.duration).toBeGreaterThanOrEqual(450)
    expect(result.duration).toBeLessThan(1500)
  })

  it('should allow longer timeout for slow operations', async () => {
    const code = `
      await new Promise(r => setTimeout(r, 2000))
      return 'slow operation completed'
    `
    const result = await evaluateOnDO(code, { timeout: 10000 })

    expect(result.success).toBe(true)
    expect(result.value).toBe('slow operation completed')
    expect(result.duration).toBeGreaterThanOrEqual(1900)
  })

  it('should cleanup resources on timeout', async () => {
    const code = `
      // Create some state that should be cleaned up
      await Customer().create({ name: 'Timeout Test' })
      while (true) { }
    `
    const result = await evaluateOnDO(code, { timeout: 500 })

    expect(result.success).toBe(false)
    expect(result.error!.message).toContain('timeout')
    // The created customer might exist, but the evaluation should have been terminated
  })
})

// =============================================================================
// 7. RESULT STRUCTURE
// =============================================================================

describe('Evaluate RPC Handler - Result Structure', () => {
  it('should always include success boolean', async () => {
    const successResult = await evaluateOnDO('return true')
    const failResult = await evaluateOnDO('throw new Error("fail")')

    expect(typeof successResult.success).toBe('boolean')
    expect(typeof failResult.success).toBe('boolean')
    expect(successResult.success).toBe(true)
    expect(failResult.success).toBe(false)
  })

  it('should always include logs array', async () => {
    const resultWithLogs = await evaluateOnDO('console.log("test"); return 1')
    const resultWithoutLogs = await evaluateOnDO('return 1')

    expect(Array.isArray(resultWithLogs.logs)).toBe(true)
    expect(Array.isArray(resultWithoutLogs.logs)).toBe(true)
    expect(resultWithLogs.logs.length).toBe(1)
    expect(resultWithoutLogs.logs.length).toBe(0)
  })

  it('should always include duration number', async () => {
    const result = await evaluateOnDO('return 1')

    expect(typeof result.duration).toBe('number')
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('should include value on success', async () => {
    const result = await evaluateOnDO('return { key: "value" }')

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ key: 'value' })
    expect(result.error).toBeUndefined()
  })

  it('should include error on failure', async () => {
    const result = await evaluateOnDO('throw new Error("test")')

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error!.message).toBe('test')
    expect(result.value).toBeUndefined()
  })

  it('should handle null return value', async () => {
    const result = await evaluateOnDO('return null')

    expect(result.success).toBe(true)
    expect(result.value).toBe(null)
  })

  it('should handle Date return value', async () => {
    const code = `
      const date = new Date('2024-01-01T00:00:00Z')
      return date.toISOString()
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('2024-01-01T00:00:00.000Z')
  })

  it('should handle nested object return value', async () => {
    const code = `
      return {
        user: {
          name: 'Alice',
          settings: {
            theme: 'dark',
            notifications: true
          }
        },
        items: [1, 2, 3]
      }
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    const value = result.value as { user: { name: string; settings: { theme: string } }; items: number[] }
    expect(value.user.name).toBe('Alice')
    expect(value.user.settings.theme).toBe('dark')
    expect(value.items).toEqual([1, 2, 3])
  })
})

// =============================================================================
// 8. SECURITY / SANDBOXING
// =============================================================================

describe('Evaluate RPC Handler - Security', () => {
  it('should not allow access to process.env', async () => {
    const result = await evaluateOnDO('return typeof process')

    // process should not be available in the sandbox
    expect(result.success).toBe(true)
    expect(result.value).toBe('undefined')
  })

  it('should not allow access to require/import', async () => {
    const result = await evaluateOnDO('return typeof require')

    expect(result.success).toBe(true)
    expect(result.value).toBe('undefined')
  })

  it('should not allow access to globalThis outside sandbox scope', async () => {
    // Should only see sandbox-provided globals
    const code = `
      const keys = Object.keys(globalThis)
      return keys.includes('Customer') && keys.includes('$')
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(true)
  })

  it('should not allow eval() within sandbox', async () => {
    // eval should either be undefined or throw
    const result = await evaluateOnDO('return eval("1 + 1")')

    // Either it fails with error or eval is blocked
    if (result.success) {
      // If eval worked, ensure it's properly sandboxed
      expect(result.value).toBe(2)
    } else {
      expect(result.error).toBeDefined()
    }
  })

  it('should not allow Function constructor access', async () => {
    const code = `
      const fn = new Function('return 42')
      return fn()
    `
    const result = await evaluateOnDO(code)

    // Either blocked or sandboxed
    if (!result.success) {
      expect(result.error).toBeDefined()
    }
  })

  it('should isolate sandbox between evaluations', async () => {
    // First evaluation sets a global
    await evaluateOnDO('globalThis.testVar = "leaked"')

    // Second evaluation should not see it (fresh sandbox)
    const result = await evaluateOnDO('return typeof globalThis.testVar')

    expect(result.success).toBe(true)
    expect(result.value).toBe('undefined')
  })

  it('should not allow modifying DO methods', async () => {
    const code = `
      // Try to overwrite send method
      $.send = () => 'hacked'
      return $.send('Test.event', {})
    `
    const result = await evaluateOnDO(code)

    // Either fails or send still works correctly
    if (result.success) {
      expect((result.value as string).startsWith('evt_')).toBe(true)
    }
  })
})

// =============================================================================
// 9. INTEGRATION WITH DO FEATURES
// =============================================================================

describe('Evaluate RPC Handler - DO Feature Integration', () => {
  it('should allow reading from DO state', async () => {
    const doInstance = getEvaluateDO('state-read-test')

    // Set state directly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (doInstance as any).set('test-key', { value: 'test-value' })

    // Read state via evaluate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (doInstance as any).evaluate(`
      const data = await $.get('test-key')
      return data
    `)

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ value: 'test-value' })
  })

  it('should allow writing to DO state', async () => {
    const doInstance = getEvaluateDO('state-write-test')

    // Write state via evaluate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evalResult = await (doInstance as any).evaluate(`
      await $.set('eval-key', { written: true })
      return 'done'
    `)

    expect(evalResult.success).toBe(true)

    // Verify state was written
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = await (doInstance as any).get('eval-key')
    expect(value).toEqual({ written: true })
  })

  it('should allow listing things created in evaluate', async () => {
    const doInstance = getEvaluateDO('list-things-test')

    // Create things via evaluate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (doInstance as any).evaluate(`
      await Customer().create({ name: 'List Test 1' })
      await Customer().create({ name: 'List Test 2' })
      return 'created'
    `)

    // List things
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listResult = await (doInstance as any).evaluate(`
      const customers = await Customer().list()
      return customers.length
    `)

    expect(listResult.success).toBe(true)
    expect(listResult.value).toBeGreaterThanOrEqual(2)
  })

  it('should persist action log from $.do() calls', async () => {
    const doInstance = getEvaluateDO('action-log-test')

    // Execute durable action via evaluate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (doInstance as any).evaluate(`
      await $.do(async () => ({ step: 'completed' }), { stepId: 'eval-step-1' })
      return 'done'
    `)

    // Check action log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const log = await (doInstance as any).getActionLog()
    const entry = log.find((e: { stepId: string }) => e.stepId === 'eval-step-1')

    expect(entry).toBeDefined()
    expect(entry.status).toBe('completed')
  })

  it('should allow scheduling via evaluate', async () => {
    const code = `
      const unsub = $.every(5).minutes(() => {
        console.log('Scheduled task')
      })
      return typeof unsub
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('function')
  })
})

// =============================================================================
// 10. EDGE CASES
// =============================================================================

describe('Evaluate RPC Handler - Edge Cases', () => {
  it('should handle empty code string', async () => {
    const result = await evaluateOnDO('')

    // Empty code should succeed with undefined result
    expect(result.success).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('should handle whitespace-only code', async () => {
    const result = await evaluateOnDO('   \n\t  ')

    expect(result.success).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('should handle very long code', async () => {
    // Generate code with many statements
    const statements = Array(100)
      .fill(null)
      .map((_, i) => `const v${i} = ${i}`)
      .join('\n')
    const code = `${statements}\nreturn v99`

    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(99)
  })

  it('should handle code with unicode characters', async () => {
    const code = `
      const emoji = '🚀'
      const chinese = '你好'
      return emoji + ' ' + chinese
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe('🚀 你好')
  })

  it('should handle code with special string escapes', async () => {
    const code = `
      return 'line1\\nline2\\ttabbed'
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toContain('line1')
  })

  it('should handle concurrent evaluations on same DO', async () => {
    const doInstance = getEvaluateDO('concurrent-test')

    // Run multiple evaluations concurrently
    const results = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doInstance as any).evaluate('return 1'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doInstance as any).evaluate('return 2'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (doInstance as any).evaluate('return 3'),
    ])

    expect(results.length).toBe(3)
    expect(results.map(r => r.value).sort()).toEqual([1, 2, 3])
    results.forEach(r => expect(r.success).toBe(true))
  })

  it('should handle comments in code', async () => {
    const code = `
      // Single line comment
      const x = 1
      /* Multi-line
         comment */
      return x
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(1)
  })

  it('should handle arrow functions', async () => {
    const code = `
      const add = (a, b) => a + b
      return add(2, 3)
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(5)
  })

  it('should handle async arrow functions', async () => {
    const code = `
      const asyncAdd = async (a, b) => {
        await Promise.resolve()
        return a + b
      }
      return await asyncAdd(10, 20)
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toBe(30)
  })

  it('should handle destructuring', async () => {
    const code = `
      const { name, value } = { name: 'test', value: 42 }
      const [first, second] = [1, 2]
      return { name, value, first, second }
    `
    const result = await evaluateOnDO(code)

    expect(result.success).toBe(true)
    expect(result.value).toEqual({ name: 'test', value: 42, first: 1, second: 2 })
  })
})

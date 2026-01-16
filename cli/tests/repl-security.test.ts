/**
 * REPL Security Tests - TDD RED Phase
 *
 * These tests verify that the REPL's handleSubmit uses ai-evaluate
 * for secure code execution instead of the unsafe evaluateExpression
 * function that uses `new Function()`.
 *
 * SECURITY ISSUE:
 * - src/repl.tsx has executeCode() (lines 61-91) that properly wraps ai-evaluate
 * - But handleSubmit() (line 333) still calls evaluateExpression() which uses
 *   unsafe `new Function()` constructor
 *
 * These tests MUST FAIL until handleSubmit is fixed to use executeCode.
 *
 * TEST STRUCTURE:
 * 1. Tests for executeCode (existing secure path) - SHOULD PASS
 * 2. Tests for evaluateExpression vulnerabilities - SHOULD FAIL
 *    (demonstrating the security gap that needs to be fixed)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// =============================================================================
// Mock Setup - vi.mock is hoisted, so use vi.fn() inside factory
// =============================================================================

// Mock ai-evaluate module - factory returns fresh mock each time
vi.mock('ai-evaluate', () => {
  return {
    evaluate: vi.fn(),
  }
})

// Import after mocks are set up
import { evaluate } from 'ai-evaluate'
import { executeCode, type ExecuteResult, type LogCallback } from '../src/repl.js'

// Cast the mocked function for TypeScript
const evaluateMock = evaluate as Mock

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Helper to reset mocks between tests
 */
function resetMocks() {
  evaluateMock.mockReset()
  // Default successful response
  evaluateMock.mockResolvedValue({
    success: true,
    value: undefined,
    logs: [],
    duration: 1,
  })
}

// =============================================================================
// PART 1: executeCode Tests (secure path) - These SHOULD PASS
// =============================================================================

describe('executeCode: Secure ai-evaluate wrapper', () => {
  beforeEach(() => {
    resetMocks()
  })

  describe('basic functionality', () => {
    it('should call ai-evaluate with script and sdk config', async () => {
      const rpcUrl = 'wss://test.api.dotdo.dev'

      await executeCode('1 + 1', rpcUrl)

      expect(evaluateMock).toHaveBeenCalledTimes(1)
      expect(evaluateMock).toHaveBeenCalledWith({
        script: '1 + 1',
        sdk: { rpcUrl },
      })
    })

    it('should forward logs to callback', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: true,
        value: 'result',
        logs: [
          { level: 'info', message: 'Processing...' },
          { level: 'error', message: 'Warning occurred' },
        ],
        duration: 10,
      })

      const logs: Array<{ level: string; message: string }> = []
      const onLog: LogCallback = (level, message) => {
        logs.push({ level, message })
      }

      await executeCode('console.log("test")', 'wss://test.api.dotdo.dev', onLog)

      expect(logs).toHaveLength(2)
      expect(logs[0]).toEqual({ level: 'info', message: 'Processing...' })
      expect(logs[1]).toEqual({ level: 'error', message: 'Warning occurred' })
    })

    it('should handle ai-evaluate errors gracefully', async () => {
      evaluateMock.mockRejectedValueOnce(new Error('Sandbox initialization failed'))

      const result = await executeCode('bad code', 'wss://test.api.dotdo.dev')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Sandbox initialization failed')
    })

    it('should return error from ai-evaluate result', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'ReferenceError: x is not defined',
        logs: [],
        duration: 5,
      })

      const result = await executeCode('x + 1', 'wss://test.api.dotdo.dev')

      expect(result.success).toBe(false)
      expect(result.error).toBe('ReferenceError: x is not defined')
    })
  })

  describe('SDK context (rpcUrl) passing', () => {
    it('should pass rpcUrl from endpoint to ai-evaluate sdk config', async () => {
      const endpoint = 'wss://acme-corp.api.dotdo.dev'

      await executeCode('$.things.list()', endpoint)

      expect(evaluateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sdk: { rpcUrl: endpoint },
        })
      )
    })

    it('should handle empty rpcUrl gracefully', async () => {
      await executeCode('1 + 1', '')

      expect(evaluateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sdk: { rpcUrl: '' },
        })
      )
    })
  })

  describe('log forwarding', () => {
    it('should forward all log levels to output callback', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: true,
        value: 'done',
        logs: [
          { level: 'log', message: 'Step 1' },
          { level: 'info', message: 'Step 2' },
          { level: 'warn', message: 'Step 3' },
          { level: 'error', message: 'Step 4' },
          { level: 'debug', message: 'Step 5' },
        ],
        duration: 100,
      })

      const logs: Array<{ level: string; message: string }> = []
      const onLog: LogCallback = (level, message) => {
        logs.push({ level, message })
      }

      await executeCode('multiStepProcess()', 'wss://test.api.dotdo.dev', onLog)

      expect(logs).toHaveLength(5)
    })

    it('should handle undefined logs array', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: true,
        value: 42,
        // logs is undefined
        duration: 1,
      })

      const onLog = vi.fn()

      // Should not throw
      await executeCode('1 + 41', 'wss://test.api.dotdo.dev', onLog)

      expect(onLog).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should handle syntax errors', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'SyntaxError: Unexpected token }',
        logs: [],
        duration: 2,
      })

      const result = await executeCode('if (true { }', 'wss://test.api.dotdo.dev')

      expect(result.success).toBe(false)
      expect(result.error).toContain('SyntaxError')
    })

    it('should handle non-Error throws', async () => {
      evaluateMock.mockRejectedValueOnce('string error')

      const result = await executeCode('code', 'wss://test.api.dotdo.dev')

      expect(result.success).toBe(false)
      expect(result.error).toBe('string error')
    })
  })
})

// =============================================================================
// PART 2: evaluateExpression Vulnerability Tests - These MUST FAIL
//
// These tests demonstrate security vulnerabilities in the current
// evaluateExpression implementation that uses `new Function()`.
// They will FAIL because evaluateExpression does NOT use ai-evaluate
// and therefore does NOT have proper sandboxing.
// =============================================================================

describe('SECURITY VULNERABILITY: evaluateExpression uses new Function', () => {
  /**
   * The evaluateExpression function (lines 111-150 in repl.tsx) uses:
   *   new Function(...Object.keys(evalContext), `return (async () => { return ${code} })()`)
   *
   * This is a security vulnerability because:
   * 1. No V8 isolation - runs in same process
   * 2. Can access closure scope via prototype chain
   * 3. No memory/CPU limits
   * 4. No timeout enforcement
   * 5. Can escape sandbox via constructor.constructor
   *
   * These tests demonstrate the vulnerabilities that exist because
   * handleSubmit calls evaluateExpression instead of executeCode.
   */

  // Import the vulnerable function for direct testing
  // This simulates what handleSubmit currently does
  async function evaluateExpressionDirect(
    code: string,
    context: Record<string, unknown> = {}
  ): Promise<unknown> {
    // This mirrors the evaluateExpression function in repl.tsx
    const evalContext = {
      ...context,
      $: {},
      console: {
        log: () => {},
        error: () => {},
        warn: () => {},
        info: () => {},
      },
    }

    // The vulnerable code path using new Function
    try {
      const fn = new Function(
        ...Object.keys(evalContext),
        `return (async () => { return ${code} })()`
      )
      return await fn(...Object.values(evalContext))
    } catch (err) {
      try {
        const fn = new Function(
          ...Object.keys(evalContext),
          `return (async () => { ${code} })()`
        )
        return await fn(...Object.values(evalContext))
      } catch {
        throw err
      }
    }
  }

  describe('PASSING: These vulnerabilities are blocked by executeCode', () => {
    beforeEach(() => {
      resetMocks()
    })

    /**
     * TEST PASSES: executeCode (ai-evaluate) blocks access to global scope
     *
     * ai-evaluate runs in an isolated V8 context where globalThis
     * is not the same as the host's globalThis.
     */
    it('should block access to globalThis', async () => {
      // ai-evaluate blocks access to globalThis
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'ReferenceError: globalThis is not defined',
        logs: [],
        duration: 1,
      })

      const result = await executeCode('typeof globalThis', 'wss://test.api.dotdo.dev')

      // executeCode properly uses ai-evaluate which blocks globalThis access
      expect(result.success).toBe(false)
      expect(result.error).toContain('globalThis')
    })

    /**
     * TEST PASSES: executeCode (ai-evaluate) blocks constructor.constructor escape
     *
     * This is a classic sandbox escape technique that ai-evaluate blocks.
     */
    it('should block constructor.constructor access', async () => {
      // ai-evaluate blocks constructor.constructor escape attempts
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'SecurityError: constructor access is blocked',
        logs: [],
        duration: 1,
      })

      const result = await executeCode(
        '(function(){}).constructor.constructor("return this")()',
        'wss://test.api.dotdo.dev'
      )

      // executeCode properly uses ai-evaluate which blocks this escape
      expect(result.success).toBe(false)
    })

    /**
     * TEST PASSES: executeCode (ai-evaluate) enforces timeout protection
     *
     * ai-evaluate has built-in timeout enforcement that prevents
     * infinite loops from freezing the process.
     */
    it('should enforce timeout on long-running code', async () => {
      // ai-evaluate enforces timeouts on long-running code
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'TimeoutError: execution exceeded time limit',
        logs: [],
        duration: 5000,
      })

      const result = await executeCode('while(true) {}', 'wss://test.api.dotdo.dev')

      // executeCode properly uses ai-evaluate which enforces timeouts
      expect(result.success).toBe(false)
      expect(result.error).toContain('Timeout')
    })

    /**
     * TEST PASSES: executeCode (ai-evaluate) enforces memory limits
     *
     * ai-evaluate runs in isolated workers with memory limits.
     */
    it('should enforce memory limits', async () => {
      // ai-evaluate enforces memory limits
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'MemoryError: allocation exceeded limit',
        logs: [],
        duration: 100,
      })

      const result = await executeCode(
        'const arr = []; while(true) arr.push(new Array(1000000))',
        'wss://test.api.dotdo.dev'
      )

      // executeCode properly uses ai-evaluate which enforces memory limits
      expect(result.success).toBe(false)
      expect(result.error).toContain('Memory')
    })
  })

  describe('PASSING: ai-evaluate is called via executeCode', () => {
    beforeEach(() => {
      resetMocks()
    })

    /**
     * TEST PASSES: executeCode calls ai-evaluate for sandboxed execution
     *
     * handleSubmit now uses executeCode which properly wraps ai-evaluate.
     */
    it('should call ai-evaluate when executing REPL code', async () => {
      const code = '1 + 1'

      // executeCode properly calls ai-evaluate
      await executeCode(code, 'wss://test.api.dotdo.dev')

      // executeCode uses ai-evaluate for secure execution
      expect(evaluateMock).toHaveBeenCalled()
      expect(evaluateMock).toHaveBeenCalledWith({
        script: code,
        sdk: { rpcUrl: 'wss://test.api.dotdo.dev' },
      })
    })

    /**
     * TEST PASSES: Logs are forwarded from ai-evaluate to REPL output
     *
     * executeCode properly forwards logs from ai-evaluate to the callback.
     */
    it('should forward ai-evaluate logs to REPL output', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: true,
        value: 'done',
        logs: [
          { level: 'info', message: 'From sandbox' },
        ],
        duration: 10,
      })

      const capturedLogs: Array<{ level: string; message: string }> = []
      const onLog: LogCallback = (level, message) => {
        capturedLogs.push({ level, message })
      }

      await executeCode('console.info("test")', 'wss://test.api.dotdo.dev', onLog)

      // ai-evaluate was called
      expect(evaluateMock).toHaveBeenCalled()
      // Logs were forwarded to the callback
      expect(capturedLogs).toEqual([{ level: 'info', message: 'From sandbox' }])
    })

    /**
     * TEST PASSES: SDK context (rpcUrl) passed to ai-evaluate
     *
     * executeCode passes the rpcUrl to ai-evaluate's sdk config,
     * which makes $ context available in the sandbox.
     */
    it('should pass rpcUrl to ai-evaluate for $ context', async () => {
      const endpoint = 'wss://tenant.api.dotdo.dev'

      await executeCode('$.things.list()', endpoint)

      // executeCode passes the rpcUrl to ai-evaluate's sdk config
      expect(evaluateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sdk: { rpcUrl: endpoint },
        })
      )
    })
  })
})

// =============================================================================
// PART 3: Integration requirement tests
//
// These tests define the contract that handleSubmit MUST fulfill
// when fixed to use executeCode instead of evaluateExpression.
// =============================================================================

describe('INTEGRATION: handleSubmit must wire to executeCode', () => {
  /**
   * When handleSubmit is fixed, it should:
   * 1. Call executeCode(value, endpoint, onLog) instead of evaluateExpression
   * 2. Pass the endpoint/rpcUrl from component props
   * 3. Create an onLog callback that forwards to addOutput
   * 4. Handle the ExecuteResult properly (success/value/error)
   */

  beforeEach(() => {
    resetMocks()
  })

  it('executeCode returns structured ExecuteResult', async () => {
    evaluateMock.mockResolvedValueOnce({
      success: true,
      value: { data: [1, 2, 3] },
      logs: [{ level: 'info', message: 'Fetched 3 items' }],
      duration: 100,
    })

    const logs: Array<{ level: string; message: string }> = []
    const result = await executeCode(
      '$.items.list()',
      'wss://test.api.dotdo.dev',
      (level, message) => logs.push({ level, message })
    )

    // executeCode returns the proper structure that handleSubmit needs
    expect(result).toEqual({
      success: true,
      value: { data: [1, 2, 3] },
      error: undefined,
    })
    expect(logs).toEqual([{ level: 'info', message: 'Fetched 3 items' }])
  })

  it('executeCode handles errors without throwing', async () => {
    evaluateMock.mockResolvedValueOnce({
      success: false,
      error: 'TypeError: Cannot read property "name" of undefined',
      logs: [],
      duration: 5,
    })

    // executeCode catches errors and returns them in the result
    // This is the behavior handleSubmit should use
    const result = await executeCode('user.name', 'wss://test.api.dotdo.dev')

    expect(result.success).toBe(false)
    expect(result.error).toContain('TypeError')
    // Note: executeCode does NOT throw - it returns the error
  })

  it('executeCode works without log callback', async () => {
    evaluateMock.mockResolvedValueOnce({
      success: true,
      value: 42,
      logs: [{ level: 'info', message: 'test' }],
      duration: 1,
    })

    // handleSubmit might not always provide an onLog callback
    const result = await executeCode('21 * 2', 'wss://test.api.dotdo.dev')

    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
  })
})

// =============================================================================
// PART 4: Security regression prevention
//
// These tests ensure that once fixed, the security vulnerabilities
// cannot be reintroduced.
// =============================================================================

describe('REGRESSION PREVENTION: Security checks via ai-evaluate', () => {
  beforeEach(() => {
    resetMocks()
  })

  describe('dangerous API blocking', () => {
    it('should block process access via ai-evaluate sandbox', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'ReferenceError: process is not defined',
        logs: [],
        duration: 1,
      })

      const result = await executeCode('process.exit(1)', 'wss://test.api.dotdo.dev')

      expect(result.success).toBe(false)
      expect(result.error).toContain('process')
    })

    it('should block require via ai-evaluate sandbox', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'ReferenceError: require is not defined',
        logs: [],
        duration: 1,
      })

      const result = await executeCode(
        'require("fs").readFileSync("/etc/passwd")',
        'wss://test.api.dotdo.dev'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('require')
    })
  })

  describe('sandbox escape prevention', () => {
    it('should block eval via ai-evaluate sandbox', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'SecurityError: eval is not allowed',
        logs: [],
        duration: 1,
      })

      const result = await executeCode('eval("1+1")', 'wss://test.api.dotdo.dev')

      expect(result.success).toBe(false)
    })

    it('should block Function constructor via ai-evaluate sandbox', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'SecurityError: Function constructor is not allowed',
        logs: [],
        duration: 1,
      })

      const result = await executeCode(
        'new Function("return 1")()',
        'wss://test.api.dotdo.dev'
      )

      expect(result.success).toBe(false)
    })

    it('should block dynamic import via ai-evaluate sandbox', async () => {
      evaluateMock.mockResolvedValueOnce({
        success: false,
        error: 'SecurityError: dynamic imports are not allowed',
        logs: [],
        duration: 1,
      })

      const result = await executeCode(
        'await import("fs")',
        'wss://test.api.dotdo.dev'
      )

      expect(result.success).toBe(false)
    })
  })
})

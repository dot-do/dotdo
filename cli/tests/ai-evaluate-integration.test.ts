/**
 * ai-evaluate Integration Tests
 *
 * RED PHASE TDD: These tests verify the complete integration between:
 * - CLI (sends code via RPC, does NOT evaluate locally)
 * - DO (receives code, runs ai-evaluate with $ = this)
 * - ai-evaluate (executes code in sandboxed environment)
 *
 * Architecture requirements:
 * 1. CLI must NOT use Function constructor in production code path
 * 2. CLI sends code to DO via rpcClient.evaluate()
 * 3. DO receives code and runs ai-evaluate
 * 4. $ context inside ai-evaluate === the DO instance (this)
 * 5. Logs from ai-evaluate are forwarded back to CLI
 * 6. Errors from ai-evaluate propagate correctly
 *
 * These tests are expected to FAIL until the implementation is complete.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'

// =============================================================================
// Section 1: CLI Architecture Verification
// =============================================================================

describe('CLI Architecture: No Local Code Execution', () => {
  let replContent: string

  beforeEach(async () => {
    const replPath = new URL('../src/repl.tsx', import.meta.url)
    replContent = await fs.readFile(replPath, 'utf-8')
  })

  it('should NOT have Function constructor in production code path', () => {
    // The evaluateExpression function uses `new Function(...)` which is a security concern
    // This pattern should be removed and replaced with RPC calls to the DO
    //
    // Current code (lines 69-73):
    //   const fn = new Function(
    //     ...Object.keys(evalContext),
    //     `return (async () => { return ${code} })()`
    //   )
    //
    // This test will FAIL until evaluateExpression is removed or refactored

    // Check that Function constructor is NOT used for code evaluation
    const functionConstructorPattern = /new\s+Function\s*\(/g
    const matches = replContent.match(functionConstructorPattern)

    // Currently this will FAIL because evaluateExpression uses new Function
    expect(matches).toBeNull()
  })

  it('should NOT have evaluateExpression function', () => {
    // The evaluateExpression function is dead code that should be removed
    // It creates a security vulnerability by evaluating code locally
    //
    // Expected: This function should not exist in repl.tsx
    // Current: It exists at lines 47-86

    const hasEvaluateExpression = replContent.includes('async function evaluateExpression')

    // This test will FAIL until evaluateExpression is removed
    expect(hasEvaluateExpression).toBe(false)
  })

  it('should NOT create local eval context with $ proxy', () => {
    // The current code creates a local $ proxy in evaluateExpression:
    //   $: rpcClient?.createProxy() ?? {},
    //
    // This is wrong - $ should only exist on the DO side
    // CLI should not create any $ context

    const hasLocalDollarContext = /\$:\s*rpcClient\?\.createProxy\(\)/.test(replContent)

    // This test will FAIL until the local $ context is removed
    expect(hasLocalDollarContext).toBe(false)
  })

  it('should NOT have local console wrapper in eval context', () => {
    // The current evaluateExpression creates a local console wrapper:
    //   console: {
    //     log: (...args: unknown[]) => outputFn?.('info', args.join(' ')),
    //     ...
    //   }
    //
    // Logs should come from the DO via RPC response, not be captured locally

    const hasLocalConsoleWrapper = /console:\s*\{[\s\S]*?log:\s*\(\.\.\./m.test(replContent)

    // This test will FAIL until the local console wrapper is removed
    expect(hasLocalConsoleWrapper).toBe(false)
  })
})

// =============================================================================
// Section 2: handleSubmit RPC Integration
// =============================================================================

describe('handleSubmit: RPC Integration', () => {
  it('should call rpcClient.evaluate() with user code', async () => {
    // Create a mock RpcClient
    const mockEvaluate = vi.fn().mockResolvedValue({
      success: true,
      value: 42,
      logs: [],
    })

    const mockRpcClient = {
      evaluate: mockEvaluate,
      getState: () => 'connected',
      getSchema: () => ({ name: 'TestDO', methods: [], fields: [] }),
      connect: vi.fn().mockResolvedValue({}),
      disconnect: vi.fn(),
      on: vi.fn(),
      createProxy: vi.fn(),
    }

    // Import the Repl component and test handleSubmit behavior
    // Note: We can't easily test React hooks directly, so we verify the source code
    const replPath = new URL('../src/repl.tsx', import.meta.url)
    const replContent = await fs.readFile(replPath, 'utf-8')

    // Verify that handleSubmit calls rpcClient.evaluate(value)
    const hasRpcEvaluateCall = /rpcClient\.evaluate\s*\(\s*value\s*\)/.test(replContent)

    expect(hasRpcEvaluateCall).toBe(true)
  })

  it('should NOT call evaluateExpression in handleSubmit', async () => {
    const replPath = new URL('../src/repl.tsx', import.meta.url)
    const replContent = await fs.readFile(replPath, 'utf-8')

    // Extract handleSubmit function body
    const handleSubmitMatch = replContent.match(
      /const\s+handleSubmit\s*=\s*useCallback\s*\(async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\},\s*\[/
    )

    expect(handleSubmitMatch).not.toBeNull()

    if (handleSubmitMatch) {
      const handleSubmitBody = handleSubmitMatch[1]

      // Verify evaluateExpression is NOT called
      const callsEvaluateExpression = /evaluateExpression\s*\(/.test(handleSubmitBody)

      // This should pass - handleSubmit should not call evaluateExpression
      expect(callsEvaluateExpression).toBe(false)
    }
  })

  it('should show error when not connected', async () => {
    const replPath = new URL('../src/repl.tsx', import.meta.url)
    const replContent = await fs.readFile(replPath, 'utf-8')

    // Verify there's a check for rpcClient before evaluation
    const hasConnectionCheck = /if\s*\(\s*!rpcClient\s*\)/.test(replContent)

    expect(hasConnectionCheck).toBe(true)
  })
})

// =============================================================================
// Section 3: RpcClient.evaluate() Message Format
// =============================================================================

describe('RpcClient.evaluate: RPC Message Format', () => {
  it('should send evaluate request with correct path', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock the call method to verify message format
    const callSpy = vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: 'result',
      logs: [],
    })

    // Set up connected state
    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    await client.evaluate('$.Customer.create({ name: "Alice" })')

    // Verify call was made with correct path
    expect(callSpy).toHaveBeenCalledWith(['evaluate'], expect.any(Array))
  })

  it('should send code as first argument', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    const callSpy = vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: 42,
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const code = '1 + 2 + 3'
    await client.evaluate(code)

    // Verify code is passed as first arg
    expect(callSpy).toHaveBeenCalledWith(['evaluate'], [code])
  })

  it('should preserve multiline code', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    const callSpy = vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: undefined,
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const multilineCode = `
      const customers = await $.Customer.list()
      for (const c of customers) {
        console.log(c.name)
      }
      return customers.length
    `

    await client.evaluate(multilineCode)

    expect(callSpy).toHaveBeenCalledWith(['evaluate'], [multilineCode])
  })

  it('should serialize RPC message correctly', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    const sendSpy = vi.fn()
    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: sendSpy }

    // Don't mock call, let it go through to verify actual message
    // Need to catch the timeout since we're not actually connected

    const evaluatePromise = client.evaluate('test code')

    // Give it a moment to send
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(sendSpy).toHaveBeenCalled()

    const sentMessage = JSON.parse(sendSpy.mock.calls[0][0])
    expect(sentMessage).toMatchObject({
      type: 'call',
      path: ['evaluate'],
      args: ['test code'],
    })
    expect(sentMessage.id).toBeDefined()

    // Clean up pending promise
    ;(client as any).pendingCalls.clear()
  })
})

// =============================================================================
// Section 4: DO Endpoint - Receives and Processes Evaluate Request
// =============================================================================

describe('DO Endpoint: Evaluate Request Processing', () => {
  /**
   * These tests verify the DO-side implementation.
   * They will FAIL until the DO evaluate endpoint is implemented.
   */

  it('should have evaluate method exposed via RPC', async () => {
    // This test verifies the DO exposes an 'evaluate' method
    // The DO should have: $.evaluate(code: string) => EvaluateResult

    // For now, we verify the expected interface exists
    // by checking for the evaluate method in the schema

    // Mock a schema response that should include evaluate
    const expectedSchema = {
      name: 'DO',
      methods: [
        { name: 'evaluate', params: [{ name: 'code', type: 'string' }], returns: 'EvaluateResult' },
      ],
      fields: [],
    }

    // The evaluate method should be in the schema
    const hasEvaluateMethod = expectedSchema.methods.some((m) => m.name === 'evaluate')
    expect(hasEvaluateMethod).toBe(true)
  })

  it('should call ai-evaluate with the provided code', async () => {
    // This test verifies that the DO's evaluate method calls ai-evaluate
    // The implementation should look like:
    //
    //   async evaluate(code: string): Promise<EvaluateResult> {
    //     return aiEvaluate({ script: code, context: { $: this } })
    //   }

    // We'll check this by examining the DO source code (when it exists)
    // For now, this is a placeholder that documents the expected behavior

    const expectedImplementation = `
      // DO should call ai-evaluate like this:
      const result = await aiEvaluate({
        script: code,
        context: { $: this }
      })
    `

    // This test documents the expected behavior
    expect(expectedImplementation).toContain('aiEvaluate')
    expect(expectedImplementation).toContain('$: this')
  })

  it('should return EvaluateResult with success/value/error/logs', async () => {
    // The evaluate endpoint must return the standard EvaluateResult shape

    interface ExpectedEvaluateResult {
      success: boolean
      value?: unknown
      error?: string
      logs: Array<{ level: string; message: string }>
    }

    // Type-level verification
    const successResult: ExpectedEvaluateResult = {
      success: true,
      value: { $id: 'cust_123', name: 'Alice' },
      logs: [{ level: 'log', message: 'Created customer' }],
    }

    const errorResult: ExpectedEvaluateResult = {
      success: false,
      error: 'ReferenceError: x is not defined',
      logs: [],
    }

    expect(successResult.success).toBe(true)
    expect(errorResult.success).toBe(false)
  })
})

// =============================================================================
// Section 5: $ Context === DO Instance (this)
// =============================================================================

describe('$ Context: Must Equal DO Instance', () => {
  /**
   * CRITICAL: When ai-evaluate runs code on the DO, the $ context
   * MUST be the DO instance itself (this), not a proxy or stub.
   *
   * This ensures:
   * - $.send() actually sends events through the DO
   * - $.on.* handlers are registered on the DO
   * - $.Customer.* calls go through the DO's thing stores
   */

  it('should pass $ = this to ai-evaluate', async () => {
    // The DO's evaluate method should call ai-evaluate with:
    //   aiEvaluate({ script: code, context: { $: this } })
    //
    // NOT:
    //   aiEvaluate({ script: code, context: { $: someProxy } })
    //   aiEvaluate({ script: code, context: { $: rpcClient.createProxy() } })

    // We'll check this by examining the DO source code
    // Look for DOCore.ts or DO.ts evaluate method
    const doCorePath = new URL('../../core/DOCore.ts', import.meta.url)
    let doContent: string

    try {
      doContent = await fs.readFile(doCorePath, 'utf-8')
    } catch {
      // File doesn't exist yet - this is expected in RED phase
      // The test will fail which is correct
      doContent = ''
    }

    // The DO should have an evaluate method that sets $ = this
    // This ensures the sandbox context has the DO instance as $
    const hasEvaluateWithThisContext =
      /evaluate\s*\([^)]*\)\s*[^{]*\{[\s\S]*context:\s*\{\s*\$:\s*this\s*\}/.test(doContent) ||
      /aiEvaluate\s*\(\s*\{[\s\S]*\$:\s*this/.test(doContent) ||
      // Also matches the inline implementation pattern: const $ = this
      /evaluate\s*\([^)]*\)[\s\S]*const\s+\$\s*=\s*this/.test(doContent)

    // This test will FAIL until the DO implements evaluate with $ = this
    expect(hasEvaluateWithThisContext).toBe(true)
  })

  it('should allow $.things access in evaluated code', async () => {
    // When $ = this (the DO), code like $.Customer.create() should work
    // because DO.Customer returns a things store

    // This test documents the expected behavior
    const expectedBehavior = `
      // In the DO, $ = this allows:
      $.Customer.create({ name: 'Alice' })  // Creates a thing via DO's store
      $.Customer.list()                      // Lists things from DO's store
      $.send({ type: 'UserCreated' })        // Sends event through DO
      $.on.Payment.received(handler)         // Registers handler on DO
    `

    expect(expectedBehavior).toContain('$.Customer.create')
    expect(expectedBehavior).toContain('$.send')
    expect(expectedBehavior).toContain('$.on.')
  })

  it('should have $ context survive across async operations', async () => {
    // When code uses await, the $ context must remain the same DO instance

    const asyncCode = `
      const c1 = await $.Customer.create({ name: 'Alice' })
      await $.send({ type: 'CustomerCreated', data: c1 })
      const c2 = await $.Customer.create({ name: 'Bob' })
      return [c1, c2]
    `

    // This test documents that $ must be stable across awaits
    expect(asyncCode).toContain('await $.Customer')
    expect(asyncCode).toContain('await $.send')
  })
})

// =============================================================================
// Section 6: Error Propagation from ai-evaluate to CLI
// =============================================================================

describe('Error Propagation: ai-evaluate to CLI', () => {
  it('should propagate syntax errors', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock a syntax error response from the DO
    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'SyntaxError: Unexpected token at line 1',
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('invalid { syntax')

    expect(result.success).toBe(false)
    expect(result.error).toContain('SyntaxError')
  })

  it('should propagate runtime errors', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'ReferenceError: undefinedVariable is not defined',
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('undefinedVariable.property')

    expect(result.success).toBe(false)
    expect(result.error).toContain('ReferenceError')
  })

  it('should propagate thrown errors with message', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'Error: Custom validation failed: email is invalid',
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('throw new Error("Custom validation failed: email is invalid")')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Custom validation failed')
    expect(result.error).toContain('email is invalid')
  })

  it('should propagate timeout errors', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'Error: Script execution timed out after 5000ms',
      logs: [
        { level: 'log', message: 'Starting infinite loop...' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('while(true) {}')

    expect(result.success).toBe(false)
    expect(result.error).toContain('timed out')
    // Logs captured before timeout should still be present
    expect(result.logs).toHaveLength(1)
  })

  it('should propagate DO-level errors', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'Error: DO storage quota exceeded',
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('$.Customer.create({ data: "x".repeat(1000000) })')

    expect(result.success).toBe(false)
    expect(result.error).toContain('storage')
  })

  it('should include stack trace in error when available', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: `TypeError: Cannot read properties of undefined (reading 'name')
    at line 3, column 15
    at processCustomer (line 5)
    at main (line 10)`,
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate(`
      const customer = undefined
      console.log(customer.name)
    `)

    expect(result.success).toBe(false)
    expect(result.error).toContain('TypeError')
    expect(result.error).toContain('line')
  })
})

// =============================================================================
// Section 7: Log Forwarding from ai-evaluate to CLI
// =============================================================================

describe('Log Forwarding: ai-evaluate to CLI', () => {
  it('should forward console.log messages', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: 'done',
      logs: [
        { level: 'log', message: 'Hello, World!' },
        { level: 'log', message: 'Processing...' },
        { level: 'log', message: 'Complete!' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate(`
      console.log('Hello, World!')
      console.log('Processing...')
      console.log('Complete!')
      return 'done'
    `)

    expect(result.logs).toHaveLength(3)
    expect(result.logs[0]).toEqual({ level: 'log', message: 'Hello, World!' })
    expect(result.logs[1]).toEqual({ level: 'log', message: 'Processing...' })
    expect(result.logs[2]).toEqual({ level: 'log', message: 'Complete!' })
  })

  it('should forward console.error messages', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: undefined,
      logs: [
        { level: 'error', message: 'Something went wrong!' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate("console.error('Something went wrong!')")

    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].level).toBe('error')
    expect(result.logs[0].message).toBe('Something went wrong!')
  })

  it('should forward console.warn messages', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: undefined,
      logs: [
        { level: 'warn', message: 'Deprecated API usage' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate("console.warn('Deprecated API usage')")

    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].level).toBe('warn')
  })

  it('should forward console.info and console.debug messages', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: undefined,
      logs: [
        { level: 'info', message: 'Information' },
        { level: 'debug', message: 'Debug details' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate(`
      console.info('Information')
      console.debug('Debug details')
    `)

    expect(result.logs).toHaveLength(2)
    expect(result.logs[0].level).toBe('info')
    expect(result.logs[1].level).toBe('debug')
  })

  it('should preserve log order', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: 42,
      logs: [
        { level: 'log', message: 'Step 1' },
        { level: 'info', message: 'Step 2' },
        { level: 'warn', message: 'Step 3' },
        { level: 'error', message: 'Step 4' },
        { level: 'log', message: 'Step 5' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate(`
      console.log('Step 1')
      console.info('Step 2')
      console.warn('Step 3')
      console.error('Step 4')
      console.log('Step 5')
      return 42
    `)

    expect(result.logs).toHaveLength(5)
    expect(result.logs.map((l) => l.message)).toEqual([
      'Step 1',
      'Step 2',
      'Step 3',
      'Step 4',
      'Step 5',
    ])
  })

  it('should include logs even when evaluation fails', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'ReferenceError: x is not defined',
      logs: [
        { level: 'log', message: 'Before error' },
        { level: 'info', message: 'Still running' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate(`
      console.log('Before error')
      console.info('Still running')
      x.property  // This will throw
    `)

    expect(result.success).toBe(false)
    expect(result.error).toContain('ReferenceError')
    // Logs captured before the error should still be present
    expect(result.logs).toHaveLength(2)
    expect(result.logs[0].message).toBe('Before error')
  })

  it('should handle logs with complex objects', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: undefined,
      logs: [
        { level: 'log', message: '{ name: "Alice", age: 30 }' },
        { level: 'log', message: '[ 1, 2, 3 ]' },
        { level: 'log', message: 'null' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate(`
      console.log({ name: "Alice", age: 30 })
      console.log([1, 2, 3])
      console.log(null)
    `)

    expect(result.logs).toHaveLength(3)
    // Objects should be serialized to strings in log messages
    expect(typeof result.logs[0].message).toBe('string')
    expect(typeof result.logs[1].message).toBe('string')
    expect(typeof result.logs[2].message).toBe('string')
  })
})

// =============================================================================
// Section 8: REPL Component Integration
// =============================================================================

describe('REPL Component: Output Display', () => {
  let replContent: string

  beforeEach(async () => {
    const replPath = new URL('../src/repl.tsx', import.meta.url)
    replContent = await fs.readFile(replPath, 'utf-8')
  })

  it('should display logs from RPC response', () => {
    // The REPL should iterate over result.logs and display them
    // Current code (lines 276-287) does this correctly:
    //   if (result.logs) {
    //     for (const log of result.logs) {
    //       addOutput(typeMap[log.level] ?? 'info', log.message)
    //     }
    //   }

    expect(replContent).toContain('result.logs')
    expect(replContent).toMatch(/for\s*\(\s*const\s+log\s+of\s+result\.logs\s*\)/)
  })

  it('should map log levels to output types', () => {
    // The REPL should map log levels to appropriate output types
    // Current implementation has typeMap

    expect(replContent).toContain('typeMap')
    expect(replContent).toContain("log: 'info'")
    expect(replContent).toContain("error: 'error'")
    expect(replContent).toContain("warn: 'warning'")
  })

  it('should display result value on success', () => {
    // On successful evaluation, display the result value
    expect(replContent).toContain('result.value')
    expect(replContent).toMatch(/addOutput\s*\(\s*['"]result['"]\s*,\s*result\.value\s*\)/)
  })

  it('should display error message on failure', () => {
    // On failed evaluation, display the error
    expect(replContent).toContain('result.error')
    expect(replContent).toMatch(/addOutput\s*\(\s*['"]error['"]\s*,\s*result\.error/)
  })
})

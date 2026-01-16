/**
 * RPC Evaluate Tests
 *
 * Tests for the CLI using RPC to evaluate code instead of local ai-evaluate.
 *
 * Architecture:
 * - CLI does NOT run ai-evaluate locally
 * - CLI sends 'evaluate' message via RPC to the DO
 * - DO runs ai-evaluate and returns results
 * - CLI displays results from RPC response
 *
 * RED PHASE: These tests define the expected behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Test: CLI does NOT import ai-evaluate
// =============================================================================

describe('CLI architecture', () => {
  it('should NOT import ai-evaluate in repl.tsx', async () => {
    // Read the repl.tsx file and verify it does NOT import ai-evaluate
    const fs = await import('fs/promises')
    const replContent = await fs.readFile(
      new URL('../src/repl.tsx', import.meta.url),
      'utf-8'
    )

    // Should NOT have ai-evaluate import
    expect(replContent).not.toMatch(/import.*from\s+['"]ai-evaluate['"]/)
    expect(replContent).not.toMatch(/require\s*\(\s*['"]ai-evaluate['"]\s*\)/)
  })

  it('should NOT have local executeCode function that uses ai-evaluate', async () => {
    const fs = await import('fs/promises')
    const replContent = await fs.readFile(
      new URL('../src/repl.tsx', import.meta.url),
      'utf-8'
    )

    // Should NOT have the executeCode function that calls evaluate directly
    // The function signature we're looking for to NOT exist:
    // export async function executeCode(code: string, rpcUrl: string, onLog?: LogCallback)
    expect(replContent).not.toMatch(/export\s+async\s+function\s+executeCode/)
  })
})

// =============================================================================
// Test: RpcClient has evaluate method
// =============================================================================

describe('RpcClient.evaluate', () => {
  it('should have an evaluate method', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    expect(typeof client.evaluate).toBe('function')
  })

  it('should call RPC with correct path and args', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock the call method
    const callSpy = vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: 42,
      logs: [],
    })

    // Manually set connected state for testing
    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    await client.evaluate('1 + 1')

    expect(callSpy).toHaveBeenCalledWith(['evaluate'], ['1 + 1'])
  })
})

// =============================================================================
// Test: Evaluate result handling
// =============================================================================

describe('Evaluate result handling', () => {
  /**
   * Expected EvaluateResult type from RPC
   */
  interface EvaluateResult {
    success: boolean
    value?: unknown
    error?: string
    logs: Array<{ level: string; message: string }>
  }

  it('should return success result with value', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock successful evaluation
    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: { name: 'Alice', $id: 'cust_123' },
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('$.Customer.create({ name: "Alice" })')

    expect(result).toEqual({
      success: true,
      value: { name: 'Alice', $id: 'cust_123' },
      logs: [],
    })
  })

  it('should return error result on failure', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock evaluation error
    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'ReferenceError: undefinedVar is not defined',
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('undefinedVar.property')

    expect(result.success).toBe(false)
    expect(result.error).toContain('ReferenceError')
  })

  it('should include logs in result', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock evaluation with logs
    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: 'done',
      logs: [
        { level: 'log', message: 'Starting...' },
        { level: 'info', message: 'Processing...' },
        { level: 'log', message: 'Complete!' },
      ],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate(`
      console.log('Starting...')
      console.info('Processing...')
      console.log('Complete!')
      return 'done'
    `)

    expect(result.logs).toHaveLength(3)
    expect(result.logs[0]).toEqual({ level: 'log', message: 'Starting...' })
    expect(result.logs[1]).toEqual({ level: 'info', message: 'Processing...' })
    expect(result.logs[2]).toEqual({ level: 'log', message: 'Complete!' })
  })
})

// =============================================================================
// Test: Error handling
// =============================================================================

describe('Evaluate error handling', () => {
  it('should handle connection errors', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Client is not connected
    ;(client as any).state = 'disconnected'

    await expect(client.evaluate('1 + 1')).rejects.toThrow('Not connected')
  })

  it('should handle RPC call errors', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock RPC error
    vi.spyOn(client, 'call').mockRejectedValue(new Error('RPC call timeout'))

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    await expect(client.evaluate('1 + 1')).rejects.toThrow('RPC call timeout')
  })

  it('should handle syntax errors from evaluation', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock syntax error result
    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'SyntaxError: Unexpected token',
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('invalid syntax {{{')

    expect(result.success).toBe(false)
    expect(result.error).toContain('SyntaxError')
  })

  it('should handle timeout errors from evaluation', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    // Mock timeout error result
    vi.spyOn(client, 'call').mockResolvedValue({
      success: false,
      error: 'Script timeout after 5000ms',
      logs: [],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('while(true) {}')

    expect(result.success).toBe(false)
    expect(result.error).toContain('timeout')
  })
})

// =============================================================================
// Test: EvaluateResult type
// =============================================================================

describe('EvaluateResult type', () => {
  it('should export EvaluateResult type from rpc-client', async () => {
    // This is a compile-time check - if EvaluateResult is not exported,
    // this import will fail
    const module = await import('../src/rpc-client.js')

    // The type should be usable (this is really a compile-time check)
    // We can verify the module exports what we expect
    expect(module.RpcClient).toBeDefined()
    // EvaluateResult is a type, so we can't check it at runtime
    // but we can check that evaluate returns the expected shape
  })

  it('should match expected EvaluateResult shape', async () => {
    const { RpcClient } = await import('../src/rpc-client.js')
    const client = new RpcClient({ url: 'wss://test.api.dotdo.dev' })

    vi.spyOn(client, 'call').mockResolvedValue({
      success: true,
      value: 123,
      logs: [{ level: 'log', message: 'test' }],
    })

    ;(client as any).state = 'connected'
    ;(client as any).ws = { send: vi.fn() }

    const result = await client.evaluate('123')

    // Verify shape
    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('logs')
    expect(typeof result.success).toBe('boolean')
    expect(Array.isArray(result.logs)).toBe(true)
  })
})

// =============================================================================
// Test: Integration with REPL handleSubmit
// =============================================================================

describe('REPL integration', () => {
  it('handleSubmit should use rpcClient.evaluate instead of local executeCode', async () => {
    // This test verifies the REPL component uses RPC evaluation
    // We check the source code structure since we can't easily render React components
    const fs = await import('fs/promises')
    const replContent = await fs.readFile(
      new URL('../src/repl.tsx', import.meta.url),
      'utf-8'
    )

    // Should have rpcClient.evaluate call
    expect(replContent).toMatch(/rpcClient\.evaluate\s*\(/)

    // Should NOT have executeCode call for evaluation
    expect(replContent).not.toMatch(/executeCode\s*\(\s*value/)
  })
})

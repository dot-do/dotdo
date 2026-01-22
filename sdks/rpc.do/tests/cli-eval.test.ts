// CLI Eval/Run Command Tests - TDD for rpc.do CLI
// Tests the `rpc.do eval` and `rpc.do run` commands for executing code against endpoints

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Modules under test (will be created in GREEN phase)
import { evalCommand, runCommand, type EvalOptions, type RunOptions } from '../src/cli/eval'

// ============================================================================
// Helper: Create temp directory for testing file operations
// ============================================================================

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpc-do-cli-eval-test-'))
})

afterEach(async () => {
  // Clean up temp directory
  await fs.rm(tempDir, { recursive: true, force: true })
})

// ============================================================================
// `rpc.do eval <endpoint> <code>` - Basic functionality
// ============================================================================

describe('rpc.do eval <endpoint> <code>', () => {
  it('evaluates simple expression and returns result', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const output: string[] = []

    // Mock fetch to return eval result
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })
    globalThis.fetch = mockFetch

    const result = await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
    })

    expect(mockFetch).toHaveBeenCalledWith(
      `${endpoint}/rpc`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ method: '_eval', args: [code] }),
      })
    )
    expect(result.success).toBe(true)
    expect(result.value).toBe(2)
  })

  it('evaluates RPC call like $.things.list()', async () => {
    const endpoint = 'https://api.test.com'
    const code = '$.things.list()'
    const expectedResult = [{ $id: '1', name: 'Thing 1' }, { $id: '2', name: 'Thing 2' }]

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: expectedResult }),
    })
    globalThis.fetch = mockFetch

    const result = await evalCommand(endpoint, code, {})

    expect(mockFetch).toHaveBeenCalledWith(
      `${endpoint}/rpc`,
      expect.objectContaining({
        body: JSON.stringify({ method: '_eval', args: [code] }),
      })
    )
    expect(result.success).toBe(true)
    expect(result.value).toEqual(expectedResult)
  })

  it('evaluates complex expressions with await', async () => {
    const endpoint = 'https://api.test.com'
    const code = 'await $.Customer("cust-123").getProfile()'
    const expectedResult = { id: 'cust-123', name: 'Alice' }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: expectedResult }),
    })
    globalThis.fetch = mockFetch

    const result = await evalCommand(endpoint, code, {})

    expect(result.success).toBe(true)
    expect(result.value).toEqual(expectedResult)
  })
})

// ============================================================================
// Output formatting
// ============================================================================

describe('Output formatting', () => {
  it('returns JSON by default', async () => {
    const endpoint = 'https://api.test.com'
    const code = '{ a: 1, b: 2 }'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { a: 1, b: 2 } }),
    })

    const result = await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
    })

    expect(result.success).toBe(true)
    // Default output should be compact JSON
    expect(output.some((o) => o === '{"a":1,"b":2}')).toBe(true)
  })

  it('uses --pretty for formatted JSON output', async () => {
    const endpoint = 'https://api.test.com'
    const code = '{ a: 1, b: 2 }'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { a: 1, b: 2 } }),
    })

    const result = await evalCommand(endpoint, code, {
      pretty: true,
      onOutput: (msg) => output.push(msg),
    })

    expect(result.success).toBe(true)
    // Pretty output should have newlines/indentation
    const outputStr = output.join('\n')
    expect(outputStr).toContain('\n')
    expect(outputStr).toContain('"a"')
    expect(outputStr).toContain('"b"')
  })
})

// ============================================================================
// Timeout handling
// ============================================================================

describe('Timeout handling', () => {
  it('respects --timeout option', async () => {
    const endpoint = 'https://api.test.com'
    const code = '$.longRunningTask()'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'done' }),
    })
    globalThis.fetch = mockFetch

    await evalCommand(endpoint, code, { timeout: 10000 })

    // Verify fetch was called with AbortSignal
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('uses default timeout of 5000ms', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })
    globalThis.fetch = mockFetch

    await evalCommand(endpoint, code, {})

    // The default timeout should be 5000ms
    expect(mockFetch).toHaveBeenCalled()
  })

  it('handles timeout error gracefully', async () => {
    const endpoint = 'https://api.test.com'
    const code = '$.slowOperation()'

    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'))

    const result = await evalCommand(endpoint, code, { timeout: 100 })

    expect(result.success).toBe(false)
    expect(result.error).toContain('timeout')
  })
})

// ============================================================================
// Error handling
// ============================================================================

describe('Error handling', () => {
  it('handles network errors gracefully', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await evalCommand(endpoint, code, {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('Network error')
  })

  it('handles HTTP 500 errors', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    const result = await evalCommand(endpoint, code, {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('500')
  })

  it('handles RPC-level errors', async () => {
    const endpoint = 'https://api.test.com'
    const code = 'invalidSyntax(('

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        error: {
          code: 'EVAL_ERROR',
          message: 'SyntaxError: Unexpected token',
        },
      }),
    })

    const result = await evalCommand(endpoint, code, {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('SyntaxError')
  })

  it('formats error messages nicely', async () => {
    const endpoint = 'https://api.test.com'
    const code = '$.nonExistent()'
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        error: {
          code: 'NOT_FOUND',
          message: 'Method nonExistent not found',
          stack: 'Error: Method not found\n    at eval (<anonymous>:1:1)',
        },
      }),
    })

    const result = await evalCommand(endpoint, code, {
      onOutput: (msg) => output.push(msg),
    })

    expect(result.success).toBe(false)
    // Error output should be formatted nicely
    expect(output.some((o) => o.includes('Error') || o.includes('error'))).toBe(true)
  })
})

// ============================================================================
// `rpc.do run <endpoint> <file>` - Execute script files
// ============================================================================

describe('rpc.do run <endpoint> <file>', () => {
  it('executes TypeScript file content', async () => {
    const endpoint = 'https://api.test.com'
    const scriptContent = `
const items = await $.things.list()
return items.length
`
    const scriptPath = path.join(tempDir, 'script.ts')
    await fs.writeFile(scriptPath, scriptContent)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 5 }),
    })
    globalThis.fetch = mockFetch

    const result = await runCommand(endpoint, scriptPath, {})

    expect(mockFetch).toHaveBeenCalledWith(
      `${endpoint}/rpc`,
      expect.objectContaining({
        body: JSON.stringify({ method: '_eval', args: [scriptContent] }),
      })
    )
    expect(result.success).toBe(true)
    expect(result.value).toBe(5)
  })

  it('executes JavaScript file content', async () => {
    const endpoint = 'https://api.test.com'
    const scriptContent = 'return 42'
    const scriptPath = path.join(tempDir, 'script.js')
    await fs.writeFile(scriptPath, scriptContent)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 42 }),
    })

    const result = await runCommand(endpoint, scriptPath, {})

    expect(result.success).toBe(true)
    expect(result.value).toBe(42)
  })

  it('handles file not found error', async () => {
    const endpoint = 'https://api.test.com'
    const nonExistentPath = path.join(tempDir, 'does-not-exist.ts')

    const result = await runCommand(endpoint, nonExistentPath, {})

    expect(result.success).toBe(false)
    expect(result.error).toContain('ENOENT')
  })

  it('supports --timeout for script execution', async () => {
    const endpoint = 'https://api.test.com'
    const scriptPath = path.join(tempDir, 'slow.ts')
    await fs.writeFile(scriptPath, 'await $.slowOperation()')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'done' }),
    })
    globalThis.fetch = mockFetch

    await runCommand(endpoint, scriptPath, { timeout: 60000 })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('supports --pretty for output formatting', async () => {
    const endpoint = 'https://api.test.com'
    const scriptPath = path.join(tempDir, 'object.ts')
    await fs.writeFile(scriptPath, 'return { foo: "bar" }')
    const output: string[] = []

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { foo: 'bar' } }),
    })

    const result = await runCommand(endpoint, scriptPath, {
      pretty: true,
      onOutput: (msg) => output.push(msg),
    })

    expect(result.success).toBe(true)
    const outputStr = output.join('\n')
    expect(outputStr).toContain('"foo"')
  })
})

// ============================================================================
// `rpc.do run --watch` - Watch mode for script files
// ============================================================================

describe('rpc.do run --watch', () => {
  it('re-runs script when file changes', async () => {
    const endpoint = 'https://api.test.com'
    const scriptPath = path.join(tempDir, 'watch-script.ts')
    await fs.writeFile(scriptPath, 'return 1')

    let callCount = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: callCount }),
      })
    })
    globalThis.fetch = mockFetch

    // Start watch mode
    const controller = new AbortController()
    const watchPromise = runCommand(endpoint, scriptPath, {
      watch: true,
      signal: controller.signal,
      onOutput: () => {},
    })

    // Wait for initial execution
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Modify the file
    await fs.writeFile(scriptPath, 'return 2')

    // Wait for the watcher to detect change and re-run
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Stop watching
    controller.abort()

    // Wait for watch to clean up
    await watchPromise.catch(() => {}) // May reject on abort

    // Should have been called at least twice (initial + file change)
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('reports file change events', async () => {
    const endpoint = 'https://api.test.com'
    const scriptPath = path.join(tempDir, 'watch-report.ts')
    await fs.writeFile(scriptPath, 'return "test"')

    const output: string[] = []
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'test' }),
    })
    globalThis.fetch = mockFetch

    const controller = new AbortController()
    const watchPromise = runCommand(endpoint, scriptPath, {
      watch: true,
      signal: controller.signal,
      onOutput: (msg) => output.push(msg),
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    await fs.writeFile(scriptPath, 'return "changed"')
    await new Promise((resolve) => setTimeout(resolve, 200))

    controller.abort()
    await watchPromise.catch(() => {})

    // Should report the file change
    expect(output.some((o) => o.includes('change') || o.includes('reloading') || o.includes('Watching'))).toBe(true)
  })

  it('handles watch on non-existent file', async () => {
    const endpoint = 'https://api.test.com'
    const nonExistentPath = path.join(tempDir, 'watch-nonexistent.ts')

    const result = await runCommand(endpoint, nonExistentPath, { watch: true })

    expect(result.success).toBe(false)
    expect(result.error).toContain('ENOENT')
  })
})

// ============================================================================
// Authentication integration
// ============================================================================

describe('Authentication', () => {
  it('includes Authorization header when auth token is provided', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'
    const token = 'test-auth-token'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })
    globalThis.fetch = mockFetch

    await evalCommand(endpoint, code, { authToken: token })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': `Bearer ${token}`,
        }),
      })
    )
  })

  it('works without auth token (anonymous)', async () => {
    const endpoint = 'https://api.test.com'
    const code = '1+1'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })
    globalThis.fetch = mockFetch

    const result = await evalCommand(endpoint, code, {})

    expect(result.success).toBe(true)
    // Should not have Authorization header
    const callArgs = mockFetch.mock.calls[0]?.[1] as { headers?: Record<string, string> }
    expect(callArgs?.headers?.['Authorization']).toBeUndefined()
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('Edge cases', () => {
  it('handles undefined result', async () => {
    const endpoint = 'https://api.test.com'
    const code = 'undefined'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: undefined }),
    })

    const result = await evalCommand(endpoint, code, {})

    expect(result.success).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('handles null result', async () => {
    const endpoint = 'https://api.test.com'
    const code = 'null'

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: null }),
    })

    const result = await evalCommand(endpoint, code, {})

    expect(result.success).toBe(true)
    expect(result.value).toBeNull()
  })

  it('handles multiline code', async () => {
    const endpoint = 'https://api.test.com'
    const code = `
const a = 1
const b = 2
return a + b
`
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 3 }),
    })

    const result = await evalCommand(endpoint, code, {})

    expect(result.success).toBe(true)
    expect(result.value).toBe(3)
  })

  it('handles endpoint with trailing slash', async () => {
    const endpoint = 'https://api.test.com/'
    const code = '1+1'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })
    globalThis.fetch = mockFetch

    await evalCommand(endpoint, code, {})

    // Should normalize trailing slash
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test.com/rpc',
      expect.anything()
    )
  })

  it('handles endpoint with port number', async () => {
    const endpoint = 'http://localhost:8787'
    const code = '1+1'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 2 }),
    })
    globalThis.fetch = mockFetch

    await evalCommand(endpoint, code, {})

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8787/rpc',
      expect.anything()
    )
  })

  it('handles empty script file', async () => {
    const endpoint = 'https://api.test.com'
    const scriptPath = path.join(tempDir, 'empty.ts')
    await fs.writeFile(scriptPath, '')

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: undefined }),
    })

    const result = await runCommand(endpoint, scriptPath, {})

    // Empty script should still succeed
    expect(result.success).toBe(true)
  })
})

/**
 * PolyglotExecutor Module Tests (RED)
 *
 * Tests for the PolyglotExecutor module that routes commands to
 * language-specific warm runtime workers via RPC.
 *
 * This executor serves as the bridge between bashx and language-specific
 * execution environments like:
 * - pyx.do for Python
 * - ruby.do for Ruby
 * - node.do for Node.js
 * - go.do for Go
 * - rust.do for Rust
 *
 * Tests are written to FAIL until the module is implemented (TDD RED phase).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// Import types and classes
import type {
  PolyglotExecutorConfig,
  LanguageBinding,
  PolyglotRequestPayload,
  PolyglotResponsePayload,
} from '../../../src/do/executors/polyglot-executor.js'

import {
  PolyglotExecutor,
  createPolyglotExecutor,
  DEFAULT_LANGUAGE_SERVICES,
} from '../../../src/do/executors/polyglot-executor.js'

import type { BashResult, ExecOptions } from '../../../src/types.js'
import type { SupportedLanguage } from '../../../core/classify/language-detector.js'

// ============================================================================
// Mock Bindings for Testing
// ============================================================================

function createMockBinding(responses?: Partial<PolyglotResponsePayload>): LanguageBinding {
  const defaultResponse: PolyglotResponsePayload = {
    stdout: 'mock output',
    stderr: '',
    exitCode: 0,
    ...responses,
  }

  return {
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      return new Response(JSON.stringify(defaultResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  }
}

function createErrorBinding(statusCode: number, errorMessage: string): LanguageBinding {
  return {
    fetch: vi.fn(async () => {
      return new Response(errorMessage, {
        status: statusCode,
        headers: { 'Content-Type': 'text/plain' },
      })
    }),
  }
}

function createTimeoutBinding(delayMs: number): LanguageBinding {
  return {
    fetch: vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      return new Response(JSON.stringify({ stdout: '', stderr: '', exitCode: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  }
}

// ============================================================================
// PolyglotExecutor Class Tests
// ============================================================================

describe('PolyglotExecutor', () => {
  // --------------------------------------------------------------------------
  // Construction Tests
  // --------------------------------------------------------------------------

  describe('Construction', () => {
    it('should create an instance with bindings', () => {
      const pythonBinding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: pythonBinding },
      })

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(PolyglotExecutor)
    })

    it('should create an instance with multiple bindings', () => {
      const executor = new PolyglotExecutor({
        bindings: {
          python: createMockBinding(),
          ruby: createMockBinding(),
          node: createMockBinding(),
        },
      })

      expect(executor).toBeDefined()
    })

    it('should create an instance with custom timeout', () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding() },
        defaultTimeout: 60000,
      })

      expect(executor).toBeDefined()
    })

    it('should create an instance via factory function', () => {
      const executor = createPolyglotExecutor({
        bindings: { python: createMockBinding() },
      })

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(PolyglotExecutor)
    })

    it('should create an instance with empty bindings', () => {
      const executor = new PolyglotExecutor({
        bindings: {},
      })

      expect(executor).toBeDefined()
    })
  })

  // --------------------------------------------------------------------------
  // canExecute Tests
  // --------------------------------------------------------------------------

  describe('canExecute', () => {
    it('canExecute returns true when binding exists', () => {
      const executor = new PolyglotExecutor({
        bindings: {
          python: createMockBinding(),
          ruby: createMockBinding(),
        },
      })

      expect(executor.canExecute('python')).toBe(true)
      expect(executor.canExecute('ruby')).toBe(true)
    })

    it('canExecute returns false when binding missing', () => {
      const executor = new PolyglotExecutor({
        bindings: {
          python: createMockBinding(),
        },
      })

      expect(executor.canExecute('ruby')).toBe(false)
      expect(executor.canExecute('go')).toBe(false)
      expect(executor.canExecute('rust')).toBe(false)
    })

    it('canExecute returns false for all languages with empty bindings', () => {
      const executor = new PolyglotExecutor({
        bindings: {},
      })

      expect(executor.canExecute('python')).toBe(false)
      expect(executor.canExecute('ruby')).toBe(false)
      expect(executor.canExecute('node')).toBe(false)
      expect(executor.canExecute('go')).toBe(false)
      expect(executor.canExecute('rust')).toBe(false)
      expect(executor.canExecute('bash')).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // Routing Tests
  // --------------------------------------------------------------------------

  describe('Routing', () => {
    it('routes Python to PYTHON binding', async () => {
      const pythonBinding = createMockBinding({ stdout: 'Hello from Python' })
      const executor = new PolyglotExecutor({
        bindings: { python: pythonBinding },
      })

      const result = await executor.execute('print("Hello")', 'python')

      expect(pythonBinding.fetch).toHaveBeenCalled()
      expect(result.stdout).toBe('Hello from Python')
    })

    it('routes Ruby to RUBY binding', async () => {
      const rubyBinding = createMockBinding({ stdout: 'Hello from Ruby' })
      const executor = new PolyglotExecutor({
        bindings: { ruby: rubyBinding },
      })

      const result = await executor.execute('puts "Hello"', 'ruby')

      expect(rubyBinding.fetch).toHaveBeenCalled()
      expect(result.stdout).toBe('Hello from Ruby')
    })

    it('routes Node to NODE binding', async () => {
      const nodeBinding = createMockBinding({ stdout: 'Hello from Node' })
      const executor = new PolyglotExecutor({
        bindings: { node: nodeBinding },
      })

      const result = await executor.execute('console.log("Hello")', 'node')

      expect(nodeBinding.fetch).toHaveBeenCalled()
      expect(result.stdout).toBe('Hello from Node')
    })

    it('routes Go to GO binding', async () => {
      const goBinding = createMockBinding({ stdout: 'Hello from Go' })
      const executor = new PolyglotExecutor({
        bindings: { go: goBinding },
      })

      const result = await executor.execute('go run main.go', 'go')

      expect(goBinding.fetch).toHaveBeenCalled()
      expect(result.stdout).toBe('Hello from Go')
    })

    it('routes Rust to RUST binding', async () => {
      const rustBinding = createMockBinding({ stdout: 'Hello from Rust' })
      const executor = new PolyglotExecutor({
        bindings: { rust: rustBinding },
      })

      const result = await executor.execute('cargo run', 'rust')

      expect(rustBinding.fetch).toHaveBeenCalled()
      expect(result.stdout).toBe('Hello from Rust')
    })

    it('routes to correct binding when multiple are configured', async () => {
      const pythonBinding = createMockBinding({ stdout: 'Python output' })
      const rubyBinding = createMockBinding({ stdout: 'Ruby output' })
      const nodeBinding = createMockBinding({ stdout: 'Node output' })

      const executor = new PolyglotExecutor({
        bindings: {
          python: pythonBinding,
          ruby: rubyBinding,
          node: nodeBinding,
        },
      })

      const pythonResult = await executor.execute('print("test")', 'python')
      const rubyResult = await executor.execute('puts "test"', 'ruby')
      const nodeResult = await executor.execute('console.log("test")', 'node')

      expect(pythonResult.stdout).toBe('Python output')
      expect(rubyResult.stdout).toBe('Ruby output')
      expect(nodeResult.stdout).toBe('Node output')
    })
  })

  // --------------------------------------------------------------------------
  // Error Handling Tests
  // --------------------------------------------------------------------------

  describe('Error handling', () => {
    it('returns blocked result when binding unavailable', async () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding() },
      })

      const result = await executor.execute('puts "Hello"', 'ruby')

      expect(result.blocked).toBe(true)
      expect(result.exitCode).not.toBe(0)
      expect(result.blockReason).toContain('ruby')
    })

    it('handles RPC timeout gracefully', async () => {
      const slowBinding = createTimeoutBinding(5000)
      const executor = new PolyglotExecutor({
        bindings: { python: slowBinding },
        defaultTimeout: 100,
      })

      const result = await executor.execute('import time; time.sleep(10)', 'python', {
        timeout: 50,
      })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('timeout')
    })

    it('handles RPC error gracefully', async () => {
      const errorBinding = createErrorBinding(500, 'Internal server error')
      const executor = new PolyglotExecutor({
        bindings: { python: errorBinding },
      })

      const result = await executor.execute('print("test")', 'python')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('error')
    })

    it('handles network errors gracefully', async () => {
      const networkErrorBinding: LanguageBinding = {
        fetch: vi.fn(async () => {
          throw new Error('Network error: connection refused')
        }),
      }
      const executor = new PolyglotExecutor({
        bindings: { python: networkErrorBinding },
      })

      const result = await executor.execute('print("test")', 'python')

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('error')
    })

    it('handles malformed JSON response gracefully', async () => {
      const badJsonBinding: LanguageBinding = {
        fetch: vi.fn(async () => {
          return new Response('not valid json', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }),
      }
      const executor = new PolyglotExecutor({
        bindings: { python: badJsonBinding },
      })

      const result = await executor.execute('print("test")', 'python')

      expect(result.exitCode).not.toBe(0)
    })
  })

  // --------------------------------------------------------------------------
  // Result Format Tests
  // --------------------------------------------------------------------------

  describe('Result format', () => {
    it('returns proper BashResult structure', async () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding({ stdout: 'test output', exitCode: 0 }) },
      })

      const result = await executor.execute('print("test")', 'python')

      // Check all required BashResult fields
      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('stdout')
      expect(result).toHaveProperty('stderr')
      expect(result).toHaveProperty('exitCode')
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('generated')
      expect(result).toHaveProperty('intent')
      expect(result).toHaveProperty('classification')
    })

    it('includes language in result', async () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding() },
      })

      const result = await executor.execute('print("test")', 'python')

      // Language should be reflected in classification or intent
      expect(result.classification.reason).toContain('python')
    })

    it('preserves stdout from RPC response', async () => {
      const expectedOutput = 'Hello, World!\nLine 2\n'
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding({ stdout: expectedOutput }) },
      })

      const result = await executor.execute('print("Hello, World!")', 'python')

      expect(result.stdout).toBe(expectedOutput)
    })

    it('preserves stderr from RPC response', async () => {
      const expectedError = 'Warning: deprecated function\n'
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding({ stderr: expectedError, exitCode: 0 }) },
      })

      const result = await executor.execute('import warnings', 'python')

      expect(result.stderr).toBe(expectedError)
    })

    it('preserves exitCode from RPC response', async () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding({ exitCode: 42 }) },
      })

      const result = await executor.execute('exit(42)', 'python')

      expect(result.exitCode).toBe(42)
    })
  })

  // --------------------------------------------------------------------------
  // Timeout Tests
  // --------------------------------------------------------------------------

  describe('Timeout', () => {
    it('uses default timeout when not specified', async () => {
      const binding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: binding },
        defaultTimeout: 30000,
      })

      await executor.execute('print("test")', 'python')

      // Check that the request includes the default timeout
      const fetchCall = (binding.fetch as Mock).mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as PolyglotRequestPayload
      expect(requestBody.timeout).toBe(30000)
    })

    it('uses custom timeout from options', async () => {
      const binding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: binding },
        defaultTimeout: 30000,
      })

      await executor.execute('print("test")', 'python', { timeout: 5000 })

      // Check that the request uses the custom timeout
      const fetchCall = (binding.fetch as Mock).mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as PolyglotRequestPayload
      expect(requestBody.timeout).toBe(5000)
    })

    it('options timeout overrides default timeout', async () => {
      const binding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: binding },
        defaultTimeout: 60000,
      })

      await executor.execute('print("test")', 'python', { timeout: 1000 })

      const fetchCall = (binding.fetch as Mock).mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as PolyglotRequestPayload
      expect(requestBody.timeout).toBe(1000)
    })
  })

  // --------------------------------------------------------------------------
  // Request Payload Tests
  // --------------------------------------------------------------------------

  describe('Request payload', () => {
    it('sends command in request payload', async () => {
      const binding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: binding },
      })

      await executor.execute('print("Hello, World!")', 'python')

      const fetchCall = (binding.fetch as Mock).mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as PolyglotRequestPayload
      expect(requestBody.command).toBe('print("Hello, World!")')
    })

    it('sends cwd in request payload when provided', async () => {
      const binding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: binding },
      })

      await executor.execute('print("test")', 'python', { cwd: '/app/src' })

      const fetchCall = (binding.fetch as Mock).mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as PolyglotRequestPayload
      expect(requestBody.cwd).toBe('/app/src')
    })

    it('sends env in request payload when provided', async () => {
      const binding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: binding },
      })

      await executor.execute('print(os.environ["MY_VAR"])', 'python', {
        env: { MY_VAR: 'test_value', OTHER_VAR: '123' },
      })

      const fetchCall = (binding.fetch as Mock).mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as PolyglotRequestPayload
      expect(requestBody.env).toEqual({ MY_VAR: 'test_value', OTHER_VAR: '123' })
    })

    it('sends stdin in request payload when provided', async () => {
      const binding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: binding },
      })

      await executor.execute('import sys; print(sys.stdin.read())', 'python', {
        stdin: 'input data from stdin',
      })

      const fetchCall = (binding.fetch as Mock).mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as PolyglotRequestPayload
      expect(requestBody.stdin).toBe('input data from stdin')
    })
  })

  // --------------------------------------------------------------------------
  // Utility Methods Tests
  // --------------------------------------------------------------------------

  describe('Utility methods', () => {
    it('getBinding returns binding when available', () => {
      const pythonBinding = createMockBinding()
      const executor = new PolyglotExecutor({
        bindings: { python: pythonBinding },
      })

      expect(executor.getBinding('python')).toBe(pythonBinding)
    })

    it('getBinding returns undefined when binding not available', () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding() },
      })

      expect(executor.getBinding('ruby')).toBeUndefined()
    })

    it('getAvailableLanguages returns list of configured languages', () => {
      const executor = new PolyglotExecutor({
        bindings: {
          python: createMockBinding(),
          ruby: createMockBinding(),
          node: createMockBinding(),
        },
      })

      const languages = executor.getAvailableLanguages()

      expect(languages).toContain('python')
      expect(languages).toContain('ruby')
      expect(languages).toContain('node')
      expect(languages).not.toContain('go')
      expect(languages).not.toContain('rust')
    })

    it('getAvailableLanguages returns empty array when no bindings', () => {
      const executor = new PolyglotExecutor({
        bindings: {},
      })

      const languages = executor.getAvailableLanguages()

      expect(languages).toEqual([])
    })
  })

  // --------------------------------------------------------------------------
  // Classification Tests
  // --------------------------------------------------------------------------

  describe('Classification', () => {
    it('includes polyglot tier in classification reason', async () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding() },
      })

      const result = await executor.execute('print("test")', 'python')

      expect(result.classification.reason.toLowerCase()).toContain('polyglot')
    })

    it('sets network to true in intent (RPC call)', async () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding() },
      })

      const result = await executor.execute('print("test")', 'python')

      expect(result.intent.network).toBe(true)
    })

    it('sets type to execute in classification', async () => {
      const executor = new PolyglotExecutor({
        bindings: { python: createMockBinding() },
      })

      const result = await executor.execute('print("test")', 'python')

      expect(result.classification.type).toBe('execute')
    })
  })
})

// ============================================================================
// DEFAULT_LANGUAGE_SERVICES Tests
// ============================================================================

describe('DEFAULT_LANGUAGE_SERVICES', () => {
  it('should export DEFAULT_LANGUAGE_SERVICES', () => {
    expect(DEFAULT_LANGUAGE_SERVICES).toBeDefined()
    expect(typeof DEFAULT_LANGUAGE_SERVICES).toBe('object')
  })

  it('should have Python service URL', () => {
    expect(DEFAULT_LANGUAGE_SERVICES.python).toBe('https://pyx.do')
  })

  it('should have Ruby service URL', () => {
    expect(DEFAULT_LANGUAGE_SERVICES.ruby).toBe('https://ruby.do')
  })

  it('should have Node service URL', () => {
    expect(DEFAULT_LANGUAGE_SERVICES.node).toBe('https://node.do')
  })

  it('should have Go service URL', () => {
    expect(DEFAULT_LANGUAGE_SERVICES.go).toBe('https://go.do')
  })

  it('should have Rust service URL', () => {
    expect(DEFAULT_LANGUAGE_SERVICES.rust).toBe('https://rust.do')
  })

  it('should have Bash service URL', () => {
    expect(DEFAULT_LANGUAGE_SERVICES.bash).toBe('https://bash.do')
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createPolyglotExecutor', () => {
  it('should create executor with bindings', () => {
    const executor = createPolyglotExecutor({
      bindings: { python: createMockBinding() },
    })

    expect(executor).toBeInstanceOf(PolyglotExecutor)
  })

  it('should create executor with timeout config', () => {
    const executor = createPolyglotExecutor({
      bindings: { python: createMockBinding() },
      defaultTimeout: 45000,
    })

    expect(executor).toBeInstanceOf(PolyglotExecutor)
  })
})

// ============================================================================
// Type Tests
// ============================================================================

describe('PolyglotExecutor Type Definitions', () => {
  it('should have correct PolyglotExecutorConfig shape', () => {
    const config: PolyglotExecutorConfig = {
      bindings: {
        python: createMockBinding(),
        ruby: createMockBinding(),
      },
      defaultTimeout: 30000,
    }

    expect(config).toBeDefined()
    expect(config.bindings.python).toBeDefined()
    expect(config.bindings.ruby).toBeDefined()
    expect(config.defaultTimeout).toBe(30000)
  })

  it('should allow partial bindings', () => {
    const config: PolyglotExecutorConfig = {
      bindings: {
        python: createMockBinding(),
        // Other languages not specified
      },
    }

    expect(config).toBeDefined()
    expect(config.bindings.python).toBeDefined()
    expect(config.bindings.ruby).toBeUndefined()
  })

  it('should have correct LanguageBinding shape', () => {
    const binding: LanguageBinding = {
      fetch: vi.fn(),
    }

    expect(binding).toBeDefined()
    expect(typeof binding.fetch).toBe('function')
  })

  it('should have correct PolyglotRequestPayload shape', () => {
    const payload: PolyglotRequestPayload = {
      command: 'print("hello")',
      cwd: '/app',
      env: { VAR: 'value' },
      timeout: 5000,
      stdin: 'input',
    }

    expect(payload).toBeDefined()
    expect(payload.command).toBe('print("hello")')
    expect(payload.cwd).toBe('/app')
    expect(payload.env).toEqual({ VAR: 'value' })
    expect(payload.timeout).toBe(5000)
    expect(payload.stdin).toBe('input')
  })

  it('should have correct PolyglotResponsePayload shape', () => {
    const response: PolyglotResponsePayload = {
      stdout: 'output',
      stderr: 'error',
      exitCode: 0,
    }

    expect(response).toBeDefined()
    expect(response.stdout).toBe('output')
    expect(response.stderr).toBe('error')
    expect(response.exitCode).toBe(0)
  })
})

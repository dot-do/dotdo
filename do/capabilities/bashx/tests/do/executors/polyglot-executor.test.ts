/**
 * Tests for PolyglotExecutor Interface Compliance
 *
 * This test file verifies that PolyglotExecutor properly implements
 * the LanguageExecutor interface (NOT TierExecutor) to fix the Liskov
 * Substitution Principle violation.
 *
 * The PolyglotExecutor has a different interface contract:
 * - canExecute(language: SupportedLanguage) - checks if language binding exists
 * - execute(command, language, options) - executes in a specific language runtime
 *
 * This is fundamentally different from TierExecutor which uses:
 * - canExecute(command: string) - checks if command can be handled
 * - execute(command, options) - executes a bash command
 *
 * The solution is to create a separate LanguageExecutor interface that
 * properly captures the polyglot execution contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PolyglotExecutor,
  createPolyglotExecutor,
  type PolyglotExecutorConfig,
  type LanguageBinding,
} from '../../../src/do/executors/polyglot-executor.js'
import type { LanguageExecutor } from '../../../src/do/executors/types.js'
import type { SupportedLanguage } from '../../../core/classify/language-detector.js'

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockLanguageBinding(
  language: string,
  output: string = 'output\n'
): LanguageBinding {
  return {
    fetch: vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      return new Response(
        JSON.stringify({
          stdout: output,
          stderr: '',
          exitCode: 0,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }),
  }
}

function createMockBindings(): Partial<Record<SupportedLanguage, LanguageBinding>> {
  return {
    python: createMockLanguageBinding('python', 'Hello from Python\n'),
    ruby: createMockLanguageBinding('ruby', 'Hello from Ruby\n'),
    node: createMockLanguageBinding('node', 'Hello from Node\n'),
  }
}

// ============================================================================
// INTERFACE COMPLIANCE TESTS
// ============================================================================

describe('PolyglotExecutor Interface Compliance', () => {
  describe('LanguageExecutor Interface', () => {
    it('implements LanguageExecutor interface', () => {
      const config: PolyglotExecutorConfig = {
        bindings: createMockBindings(),
      }
      const executor = new PolyglotExecutor(config)

      // The executor should be assignable to LanguageExecutor
      // This is a compile-time check - if it compiles, the interface is implemented
      const languageExecutor: LanguageExecutor = executor
      expect(languageExecutor).toBeDefined()
    })

    it('has canExecute method that accepts SupportedLanguage', () => {
      const executor = new PolyglotExecutor({
        bindings: createMockBindings(),
      })

      // canExecute should accept a language parameter
      expect(typeof executor.canExecute).toBe('function')

      // Should return true for configured languages
      expect(executor.canExecute('python')).toBe(true)
      expect(executor.canExecute('ruby')).toBe(true)
      expect(executor.canExecute('node')).toBe(true)

      // Should return false for unconfigured languages
      expect(executor.canExecute('go')).toBe(false)
      expect(executor.canExecute('rust')).toBe(false)
    })

    it('has execute method that accepts command, language, and options', async () => {
      const executor = new PolyglotExecutor({
        bindings: createMockBindings(),
      })

      // execute should accept command, language, and optional options
      expect(typeof executor.execute).toBe('function')

      const result = await executor.execute('print("hello")', 'python', {})
      expect(result).toBeDefined()
      expect(result.stdout).toBe('Hello from Python\n')
    })

    it('returns BashResult from execute', async () => {
      const executor = new PolyglotExecutor({
        bindings: createMockBindings(),
      })

      const result = await executor.execute('puts "hello"', 'ruby')

      // Should return a proper BashResult
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
  })

  describe('NOT a TierExecutor', () => {
    /**
     * PolyglotExecutor should NOT implement TierExecutor because:
     * 1. canExecute has different signature (language vs command)
     * 2. execute has different signature (extra language param)
     *
     * These tests verify the interface is properly separated.
     */

    it('canExecute signature differs from TierExecutor', () => {
      const executor = new PolyglotExecutor({
        bindings: createMockBindings(),
      })

      // PolyglotExecutor.canExecute takes a SupportedLanguage, not a command string
      // This verifies the signature is correct for LanguageExecutor
      const result = executor.canExecute('python')
      expect(typeof result).toBe('boolean')
    })

    it('execute signature includes language parameter', async () => {
      const pythonBinding = createMockLanguageBinding('python', 'python output\n')
      const executor = new PolyglotExecutor({
        bindings: { python: pythonBinding },
      })

      // The execute method requires a language parameter
      // This is different from TierExecutor.execute(command, options)
      const result = await executor.execute('code', 'python')
      expect(result.stdout).toBe('python output\n')

      // Verify the binding was called
      expect(pythonBinding.fetch).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// FUNCTIONALITY TESTS
// ============================================================================

describe('PolyglotExecutor Functionality', () => {
  let executor: PolyglotExecutor
  let bindings: Partial<Record<SupportedLanguage, LanguageBinding>>

  beforeEach(() => {
    bindings = createMockBindings()
    executor = new PolyglotExecutor({ bindings })
  })

  describe('canExecute', () => {
    it('returns true for languages with bindings', () => {
      expect(executor.canExecute('python')).toBe(true)
      expect(executor.canExecute('ruby')).toBe(true)
      expect(executor.canExecute('node')).toBe(true)
    })

    it('returns false for languages without bindings', () => {
      expect(executor.canExecute('go')).toBe(false)
      expect(executor.canExecute('rust')).toBe(false)
      expect(executor.canExecute('bash')).toBe(false)
    })
  })

  describe('execute', () => {
    it('executes Python command via binding', async () => {
      const result = await executor.execute('print("hello")', 'python')

      expect(result.stdout).toBe('Hello from Python\n')
      expect(result.exitCode).toBe(0)
      expect(bindings.python!.fetch).toHaveBeenCalled()
    })

    it('executes Ruby command via binding', async () => {
      const result = await executor.execute('puts "hello"', 'ruby')

      expect(result.stdout).toBe('Hello from Ruby\n')
      expect(result.exitCode).toBe(0)
      expect(bindings.ruby!.fetch).toHaveBeenCalled()
    })

    it('executes Node command via binding', async () => {
      const result = await executor.execute('console.log("hello")', 'node')

      expect(result.stdout).toBe('Hello from Node\n')
      expect(result.exitCode).toBe(0)
      expect(bindings.node!.fetch).toHaveBeenCalled()
    })

    it('returns blocked result when binding unavailable', async () => {
      const result = await executor.execute('go run main.go', 'go')

      expect(result.blocked).toBe(true)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No binding available')
    })

    it('passes execution options to binding', async () => {
      await executor.execute('print("test")', 'python', {
        cwd: '/app',
        env: { DEBUG: 'true' },
        timeout: 5000,
      })

      // Verify the fetch call included the options
      const fetchCall = (bindings.python!.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.cwd).toBe('/app')
      expect(requestBody.env).toEqual({ DEBUG: 'true' })
      expect(requestBody.timeout).toBe(5000)
    })
  })

  describe('getAvailableLanguages', () => {
    it('returns list of configured languages', () => {
      const languages = executor.getAvailableLanguages()

      expect(languages).toContain('python')
      expect(languages).toContain('ruby')
      expect(languages).toContain('node')
      expect(languages).not.toContain('go')
      expect(languages).not.toContain('rust')
    })

    it('returns empty array when no bindings configured', () => {
      const emptyExecutor = new PolyglotExecutor({ bindings: {} })
      const languages = emptyExecutor.getAvailableLanguages()

      expect(languages).toEqual([])
    })
  })

  describe('getBinding', () => {
    it('returns binding for configured language', () => {
      const binding = executor.getBinding('python')
      expect(binding).toBeDefined()
      expect(binding).toBe(bindings.python)
    })

    it('returns undefined for unconfigured language', () => {
      const binding = executor.getBinding('go')
      expect(binding).toBeUndefined()
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('PolyglotExecutor Error Handling', () => {
  it('handles RPC error gracefully', async () => {
    const failingBinding: LanguageBinding = {
      fetch: vi.fn(async () => {
        return new Response('Service Error', { status: 500 })
      }),
    }

    const executor = new PolyglotExecutor({
      bindings: { python: failingBinding },
    })

    const result = await executor.execute('print(1)', 'python')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('RPC error')
  })

  it('handles network error gracefully', async () => {
    const errorBinding: LanguageBinding = {
      fetch: vi.fn(async () => {
        throw new Error('Network failure')
      }),
    }

    const executor = new PolyglotExecutor({
      bindings: { python: errorBinding },
    })

    const result = await executor.execute('print(1)', 'python')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Network error')
  })

  it('handles timeout', async () => {
    const slowBinding: LanguageBinding = {
      fetch: vi.fn(async () => {
        // Simulate slow response
        await new Promise((resolve) => setTimeout(resolve, 200))
        return new Response(JSON.stringify({ stdout: '', stderr: '', exitCode: 0 }))
      }),
    }

    const executor = new PolyglotExecutor({
      bindings: { python: slowBinding },
      defaultTimeout: 100, // 100ms timeout
    })

    const result = await executor.execute('import time; time.sleep(10)', 'python')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('timeout')
  })
})

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createPolyglotExecutor', () => {
  it('creates executor with provided config', () => {
    const executor = createPolyglotExecutor({
      bindings: createMockBindings(),
      defaultTimeout: 60000,
    })

    expect(executor).toBeInstanceOf(PolyglotExecutor)
    expect(executor.canExecute('python')).toBe(true)
  })

  it('creates executor with empty bindings', () => {
    const executor = createPolyglotExecutor({ bindings: {} })

    expect(executor).toBeInstanceOf(PolyglotExecutor)
    expect(executor.getAvailableLanguages()).toEqual([])
  })
})

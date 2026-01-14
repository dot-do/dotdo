/**
 * JsExecutor Module Tests (RED)
 *
 * Tests for the JsExecutor module that provides native JavaScript/TypeScript
 * execution using ai-evaluate (V8 isolate sandbox).
 *
 * This executor handles:
 * - node -e "code" - Execute inline JavaScript
 * - bun -e "code" - Execute inline JavaScript (bun syntax)
 * - tsx "code" - Execute TypeScript
 * - esm run @scope/module - Execute esm.do module
 *
 * Security guarantees:
 * - V8 isolate sandbox (ai-evaluate)
 * - No filesystem access
 * - No network by default
 * - CPU/memory limits
 *
 * Tests are written to FAIL until the module is implemented.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// Import types and classes that don't exist yet - this will cause compilation errors
import type {
  JsExecutorConfig,
  JsEvaluator,
  JsEvaluationResult,
} from '../../../src/do/executors/js-executor.js'

import {
  JsExecutor,
  createJsExecutor,
  JS_COMMANDS,
} from '../../../src/do/executors/js-executor.js'

import type { BashResult, ExecOptions } from '../../../src/types.js'

// ============================================================================
// Mock Evaluator for Testing
// ============================================================================

function createMockEvaluator(): JsEvaluator {
  return {
    evaluate: vi.fn(async (code: string, options?: { timeout?: number; env?: Record<string, string> }) => {
      return {
        result: undefined,
        stdout: '',
        stderr: '',
        exitCode: 0,
        duration: 10,
      }
    }),
    evaluateModule: vi.fn(async (moduleName: string, args?: string[]) => {
      return {
        result: undefined,
        stdout: `Module ${moduleName} executed`,
        stderr: '',
        exitCode: 0,
        duration: 10,
      }
    }),
  }
}

function createMockEvaluatorWithOutput(stdout: string, exitCode = 0): JsEvaluator {
  return {
    evaluate: vi.fn(async () => ({
      result: undefined,
      stdout,
      stderr: '',
      exitCode,
      duration: 10,
    })),
    evaluateModule: vi.fn(async () => ({
      result: undefined,
      stdout,
      stderr: '',
      exitCode,
      duration: 10,
    })),
  }
}

function createMockEvaluatorWithError(stderr: string, exitCode = 1): JsEvaluator {
  return {
    evaluate: vi.fn(async () => ({
      result: undefined,
      stdout: '',
      stderr,
      exitCode,
      duration: 10,
    })),
    evaluateModule: vi.fn(async () => ({
      result: undefined,
      stdout: '',
      stderr,
      exitCode,
      duration: 10,
    })),
  }
}

// ============================================================================
// JsExecutor Class Tests
// ============================================================================

describe('JsExecutor', () => {
  describe('Construction', () => {
    it('should create an instance with no config', () => {
      const executor = new JsExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(JsExecutor)
    })

    it('should create an instance with custom evaluator', () => {
      const mockEvaluator = createMockEvaluator()
      const executor = new JsExecutor({
        evaluator: mockEvaluator,
      })

      expect(executor).toBeDefined()
      expect(executor.hasEvaluator).toBe(true)
    })

    it('should create an instance via factory function', () => {
      const executor = createJsExecutor()

      expect(executor).toBeDefined()
      expect(executor).toBeInstanceOf(JsExecutor)
    })

    it('should accept timeout configuration', () => {
      const executor = new JsExecutor({
        defaultTimeout: 5000,
      })

      expect(executor).toBeDefined()
    })

    it('should accept memory limit configuration', () => {
      const executor = new JsExecutor({
        maxMemoryMB: 128,
      })

      expect(executor).toBeDefined()
    })
  })

  describe('Command Classification', () => {
    let executor: JsExecutor

    beforeEach(() => {
      executor = new JsExecutor()
    })

    it('should identify node -e commands', () => {
      expect(executor.canExecute('node -e "console.log(1)"')).toBe(true)
      expect(executor.canExecute('node -e \'console.log(1)\'')).toBe(true)
      expect(executor.canExecute('node --eval "console.log(1)"')).toBe(true)
    })

    it('should identify bun -e commands', () => {
      expect(executor.canExecute('bun -e "console.log(1)"')).toBe(true)
      expect(executor.canExecute('bun -e \'console.log(1)\'')).toBe(true)
      expect(executor.canExecute('bun --eval "console.log(1)"')).toBe(true)
    })

    it('should identify tsx commands', () => {
      expect(executor.canExecute('tsx -e "const x: number = 1"')).toBe(true)
      expect(executor.canExecute('tsx --eval "console.log(1)"')).toBe(true)
    })

    it('should identify esm run commands', () => {
      expect(executor.canExecute('esm run @scope/module')).toBe(true)
      expect(executor.canExecute('esm run lodash')).toBe(true)
    })

    it('should NOT match node without -e flag', () => {
      expect(executor.canExecute('node script.js')).toBe(false)
      expect(executor.canExecute('node')).toBe(false)
      expect(executor.canExecute('node --version')).toBe(false)
    })

    it('should NOT match bun without -e flag', () => {
      expect(executor.canExecute('bun install')).toBe(false)
      expect(executor.canExecute('bun run script.js')).toBe(false)
      expect(executor.canExecute('bun')).toBe(false)
    })

    it('should NOT match unrelated commands', () => {
      expect(executor.canExecute('ls -la')).toBe(false)
      expect(executor.canExecute('npm install')).toBe(false)
      expect(executor.canExecute('python -c "print(1)"')).toBe(false)
    })
  })

  describe('Code Extraction', () => {
    let executor: JsExecutor

    beforeEach(() => {
      executor = new JsExecutor()
    })

    it('should extract code from node -e "code"', () => {
      const code = executor.extractCode('node -e "console.log(1)"')
      expect(code).toBe('console.log(1)')
    })

    it('should extract code from node -e \'code\'', () => {
      const code = executor.extractCode("node -e 'console.log(1)'")
      expect(code).toBe('console.log(1)')
    })

    it('should extract code with complex quotes', () => {
      const code = executor.extractCode('node -e "console.log(\\"hello\\")"')
      expect(code).toBe('console.log("hello")')
    })

    it('should extract code from bun -e', () => {
      const code = executor.extractCode('bun -e "const x = 1; console.log(x)"')
      expect(code).toBe('const x = 1; console.log(x)')
    })

    it('should extract module name from esm run', () => {
      const code = executor.extractCode('esm run @scope/module')
      expect(code).toBe('@scope/module')
    })

    it('should handle esm run with arguments', () => {
      const code = executor.extractCode('esm run lodash --method=get')
      expect(code).toBe('lodash')
    })
  })

  describe('JavaScript Execution', () => {
    it('should execute simple console.log', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('hello world\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "console.log(\'hello world\')"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello world\n')
      expect(mockEvaluator.evaluate).toHaveBeenCalled()
    })

    it('should execute arithmetic expressions', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('6\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "console.log(2 * 3)"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('6\n')
    })

    it('should execute JSON operations', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('{"a":1}\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "console.log(JSON.stringify({a: 1}))"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('{"a":1}\n')
    })

    it('should handle runtime errors gracefully', async () => {
      const mockEvaluator = createMockEvaluatorWithError('ReferenceError: x is not defined', 1)
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "console.log(x)"')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ReferenceError')
    })

    it('should handle syntax errors gracefully', async () => {
      const mockEvaluator = createMockEvaluatorWithError('SyntaxError: Unexpected token', 1)
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "console.log({"')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('SyntaxError')
    })

    it('should pass environment variables', async () => {
      const mockEvaluator = createMockEvaluator()
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      await executor.execute('node -e "console.log(process.env.FOO)"', {
        env: { FOO: 'bar' },
      })

      expect(mockEvaluator.evaluate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: { FOO: 'bar' } })
      )
    })

    it('should respect timeout option', async () => {
      const mockEvaluator = createMockEvaluator()
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      await executor.execute('node -e "while(true){}"', { timeout: 1000 })

      expect(mockEvaluator.evaluate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: 1000 })
      )
    })
  })

  describe('Bun Execution', () => {
    it('should execute bun -e commands', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('bun output\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('bun -e "console.log(\'bun output\')"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('bun output\n')
    })

    it('should handle bun-specific APIs (mocked)', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('1.0.0\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('bun -e "console.log(Bun.version)"')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('TypeScript Execution', () => {
    it('should execute tsx -e commands with type annotations', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('42\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('tsx -e "const x: number = 42; console.log(x)"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('42\n')
    })

    it('should handle TypeScript interfaces (mocked)', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('{"name":"test"}\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('tsx -e "interface User { name: string }; const u: User = {name: \'test\'}; console.log(JSON.stringify(u))"')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('test')
    })

    it('should transpile TypeScript to JavaScript before execution', async () => {
      const mockEvaluator = createMockEvaluator()
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      await executor.execute('tsx -e "const x: string = \'hello\'"')

      // The evaluator should receive transpiled JavaScript
      expect(mockEvaluator.evaluate).toHaveBeenCalled()
      const [code] = (mockEvaluator.evaluate as Mock).mock.calls[0]
      // TypeScript type annotations should be stripped
      expect(code).not.toContain(': string')
    })
  })

  describe('ESM Module Execution', () => {
    it('should execute esm run commands', async () => {
      const mockEvaluator = createMockEvaluator()
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('esm run lodash')

      expect(result.exitCode).toBe(0)
      expect(mockEvaluator.evaluateModule).toHaveBeenCalledWith('lodash', [])
    })

    it('should pass arguments to module', async () => {
      const mockEvaluator = createMockEvaluator()
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      await executor.execute('esm run @scope/module arg1 arg2')

      expect(mockEvaluator.evaluateModule).toHaveBeenCalledWith('@scope/module', ['arg1', 'arg2'])
    })

    it('should handle module not found errors', async () => {
      const mockEvaluator = createMockEvaluatorWithError('Module not found: nonexistent', 1)
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('esm run nonexistent-module')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('not found')
    })
  })

  describe('Stdin Handling', () => {
    it('should make stdin available to code', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('HELLO\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "console.log(stdin.toUpperCase())"', {
        stdin: 'hello',
      })

      expect(result.exitCode).toBe(0)
    })

    it('should parse JSON stdin when requested', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('1\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "console.log(JSON.parse(stdin).value)"', {
        stdin: '{"value": 1}',
      })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('Security Constraints', () => {
    it('should NOT have access to require/import by default', async () => {
      const mockEvaluator = createMockEvaluatorWithError('require is not defined', 1)
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "require(\'fs\')"')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('not defined')
    })

    it('should NOT have access to process.exit', async () => {
      const mockEvaluator = createMockEvaluatorWithError('process.exit is not a function', 1)
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "process.exit(0)"')

      expect(result.exitCode).toBe(1)
    })

    it('should have limited process.env access', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('bar\n')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      // Only explicitly passed env vars should be accessible
      const result = await executor.execute('node -e "console.log(process.env.FOO)"', {
        env: { FOO: 'bar' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('bar\n')
    })

    it('should enforce memory limits', async () => {
      const mockEvaluator = createMockEvaluatorWithError('Memory limit exceeded', 1)
      const executor = new JsExecutor({
        evaluator: mockEvaluator,
        maxMemoryMB: 64,
      })

      const result = await executor.execute('node -e "const a = new Array(1e9).fill(1)"')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Memory')
    })

    it('should enforce CPU time limits', async () => {
      const mockEvaluator: JsEvaluator = {
        evaluate: vi.fn(async () => {
          throw new Error('Execution timed out')
        }),
        evaluateModule: vi.fn(),
      }
      const executor = new JsExecutor({
        evaluator: mockEvaluator,
        defaultTimeout: 100,
      })

      const result = await executor.execute('node -e "while(true){}"')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('timed out')
    })
  })

  describe('Result Formatting', () => {
    it('should return valid BashResult structure', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('test')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "console.log(\'test\')"')

      expect(result).toMatchObject({
        input: 'node -e "console.log(\'test\')"',
        command: 'node -e "console.log(\'test\')"',
        valid: true,
        generated: false,
        stdout: expect.any(String),
        stderr: expect.any(String),
        exitCode: expect.any(Number),
        intent: expect.objectContaining({
          commands: expect.any(Array),
          reads: [],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        }),
        classification: expect.objectContaining({
          type: 'execute',
          impact: 'none',
          reversible: true,
        }),
      })
    })

    it('should include classification with js-executor capability', async () => {
      const mockEvaluator = createMockEvaluatorWithOutput('test')
      const executor = new JsExecutor({ evaluator: mockEvaluator })

      const result = await executor.execute('node -e "1+1"')

      expect(result.classification.capability).toBe('js-executor')
      expect(result.classification.reason).toContain('Tier 3')
    })
  })

  describe('Error Without Evaluator', () => {
    it('should return error when no evaluator is configured', async () => {
      const executor = new JsExecutor()

      const result = await executor.execute('node -e "console.log(1)"')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No JavaScript evaluator available')
    })
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createJsExecutor', () => {
  it('should create executor with default config', () => {
    const executor = createJsExecutor()

    expect(executor).toBeInstanceOf(JsExecutor)
  })

  it('should create executor with custom config', () => {
    const mockEvaluator = createMockEvaluator()
    const executor = createJsExecutor({
      evaluator: mockEvaluator,
      defaultTimeout: 10000,
      maxMemoryMB: 256,
    })

    expect(executor).toBeInstanceOf(JsExecutor)
    expect(executor.hasEvaluator).toBe(true)
  })
})

// ============================================================================
// JS_COMMANDS Constant Tests
// ============================================================================

describe('JS_COMMANDS', () => {
  it('should include node', () => {
    expect(JS_COMMANDS.has('node')).toBe(true)
  })

  it('should include bun', () => {
    expect(JS_COMMANDS.has('bun')).toBe(true)
  })

  it('should include tsx', () => {
    expect(JS_COMMANDS.has('tsx')).toBe(true)
  })

  it('should include esm', () => {
    expect(JS_COMMANDS.has('esm')).toBe(true)
  })
})

// ============================================================================
// TierExecutor Interface Compliance Tests
// ============================================================================

describe('TierExecutor Interface', () => {
  it('should implement canExecute method', () => {
    const executor = new JsExecutor()

    expect(typeof executor.canExecute).toBe('function')
    expect(executor.canExecute('node -e "1"')).toBe(true)
    expect(executor.canExecute('ls')).toBe(false)
  })

  it('should implement execute method', async () => {
    const mockEvaluator = createMockEvaluatorWithOutput('ok')
    const executor = new JsExecutor({ evaluator: mockEvaluator })

    expect(typeof executor.execute).toBe('function')
    const result = await executor.execute('node -e "1"')
    expect(result).toBeDefined()
    expect(result.exitCode).toBeDefined()
  })
})

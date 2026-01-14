/**
 * Security Tests: new Function() Elimination in bashx/math-control.ts
 *
 * RED PHASE TDD: These tests verify that the dangerous `new Function()`
 * pattern is NOT used in the ExpressionEngine for arithmetic evaluation.
 * Instead, a safe parser-based approach or ai-evaluate should be used.
 *
 * SECURITY VULNERABILITY:
 * - File: do/capabilities/bashx/src/do/commands/math-control.ts
 * - Line: 303 (ExpressionEngine.evaluate method)
 * - Issue: Uses `new Function()` which allows arbitrary code execution
 *
 * MITIGATION OPTIONS:
 * 1. Use the safe expression parser from safe-expr.ts
 * 2. Use ai-evaluate for Worker-based sandboxed execution
 * 3. Implement a proper recursive descent parser
 *
 * @module bashx/tests/math-control-security.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Path to the source file we're testing
const MATH_CONTROL_PATH = path.resolve(
  import.meta.dirname,
  '../src/do/commands/math-control.ts'
)

describe('Security: new Function() Elimination in ExpressionEngine', () => {
  describe('Source Code Analysis', () => {
    let sourceCode: string

    beforeEach(() => {
      sourceCode = fs.readFileSync(MATH_CONTROL_PATH, 'utf-8')
    })

    it('should NOT contain new Function() in actual code (comments allowed)', () => {
      // Remove comments before checking for the dangerous pattern
      const codeWithoutComments = sourceCode
        .replace(/\/\/.*$/gm, '') // Remove // comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* */ comments

      const hasDangerousPattern = /\bnew\s+Function\s*\(/.test(codeWithoutComments)

      expect(hasDangerousPattern).toBe(false)
    })

    it('should NOT use Function constructor in ExpressionEngine.evaluate', () => {
      // Find the evaluate method in ExpressionEngine class
      const classMatch = sourceCode.match(
        /class\s+ExpressionEngine\s*\{([\s\S]*?)^\}/m
      )

      expect(classMatch).not.toBeNull()

      if (classMatch) {
        const classBody = classMatch[1]

        // Remove comments from class body before checking
        const classBodyNoComments = classBody
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')

        // Should not contain new Function in actual code
        expect(classBodyNoComments).not.toMatch(/new\s+Function/)
      }
    })

    it('should use safe-expr parser instead of new Function', () => {
      // The code should either import safe-expr or implement a safe parser
      const usesSafeParser =
        sourceCode.includes("from './safe-expr") ||
        sourceCode.includes('from "./safe-expr') ||
        sourceCode.includes("from '../commands/safe-expr") ||
        sourceCode.includes('from "../commands/safe-expr') ||
        sourceCode.includes('safeEval') ||
        sourceCode.includes('tokenize') ||
        sourceCode.includes('parse(')

      // Or it should use ai-evaluate
      const usesAiEvaluate =
        sourceCode.includes("from 'ai-evaluate'") ||
        sourceCode.includes('from "ai-evaluate"') ||
        sourceCode.includes("from '@primitives/ai-evaluate'") ||
        sourceCode.includes('ai/primitives/packages/ai-evaluate')

      expect(usesSafeParser || usesAiEvaluate).toBe(true)
    })

    it('should have the comment about safe evaluation removed', () => {
      // The current code has a misleading comment "Evaluate using safe Function constructor"
      // at line 301. This comment should be removed when the vulnerability is fixed.
      const hasMisleadingComment = sourceCode.includes(
        'safe Function constructor'
      )

      expect(hasMisleadingComment).toBe(false)
    })
  })

  describe('Runtime Behavior', () => {
    it('should evaluate expressions without using new Function()', async () => {
      const { ExpressionEngine } = await import(
        '../src/do/commands/math-control.js'
      )

      const engine = new ExpressionEngine()

      // Mock the global Function constructor to detect if it's called
      const originalFunction = global.Function
      let functionConstructorCalled = false

      // @ts-expect-error - We're intentionally replacing Function for testing
      global.Function = function (...args: unknown[]) {
        functionConstructorCalled = true
        return new originalFunction(...(args as [string]))
      }

      try {
        // Evaluate a simple expression
        engine.evaluate('2+2')

        // The function constructor should NOT have been called
        // This test will FAIL in RED phase because new Function IS used
        expect(functionConstructorCalled).toBe(false)
      } finally {
        global.Function = originalFunction
      }
    })

    it('should evaluate expressions safely with proper parser', async () => {
      const { ExpressionEngine } = await import(
        '../src/do/commands/math-control.js'
      )

      const engine = new ExpressionEngine()

      // Test basic arithmetic
      // Note: bc uses ^ for exponentiation (not **), and / is integer division
      expect(engine.evaluate('2+2')).toBe(4)
      expect(engine.evaluate('10-3')).toBe(7)
      expect(engine.evaluate('6*7')).toBe(42)
      expect(engine.evaluate('10/3')).toBe(3) // Integer division
      expect(engine.evaluate('2^10')).toBe(1024) // bc uses ^ for power
    })

    it('should reject code injection attempts', async () => {
      const { ExpressionEngine } = await import(
        '../src/do/commands/math-control.js'
      )

      const engine = new ExpressionEngine()

      // These should all throw errors, not execute
      const maliciousInputs = [
        'process.exit()',
        'require("fs").readFileSync("/etc/passwd")',
        '(function(){return this})().process.exit()',
        '(()=>this)().constructor.constructor("return process")()',
        'eval("process.exit()")',
        'Function("return process")()',
      ]

      for (const input of maliciousInputs) {
        // Current implementation will execute these via new Function
        // After fix, they should throw syntax errors or be rejected
        expect(() => engine.evaluate(input)).toThrow()
      }
    })

    it('should not allow arbitrary JavaScript execution', async () => {
      const { ExpressionEngine } = await import(
        '../src/do/commands/math-control.js'
      )

      const engine = new ExpressionEngine()

      // This tests that the evaluator only handles math, not arbitrary JS
      const javascriptPatterns = [
        'console.log("pwned")',
        'alert("xss")',
        'fetch("http://evil.com")',
        'new XMLHttpRequest()',
        'document.cookie',
        'window.location',
        'globalThis.process',
      ]

      for (const pattern of javascriptPatterns) {
        // These should throw, not return values
        expect(() => engine.evaluate(pattern)).toThrow()
      }
    })
  })

  describe('executeBc Security', () => {
    it('should reject injection via bc expression', async () => {
      const { executeBc } = await import('../src/do/commands/math-control.js')

      // These injection attempts should fail safely
      const result1 = executeBc('$(cat /etc/passwd)')
      expect(result1.exitCode).not.toBe(0)

      const result2 = executeBc('`whoami`')
      expect(result2.exitCode).not.toBe(0)

      const result3 = executeBc('process.exit(1)')
      expect(result3.exitCode).not.toBe(0)
    })

    it('should not execute arbitrary code via variable names', async () => {
      const { executeBc } = await import('../src/do/commands/math-control.js')

      // Attempt to inject via variable assignment
      // In current vulnerable code, this could execute
      const result = executeBc('x=process.exit(1);x')

      // Should either error or return a safe value, not exit the process
      expect(result.exitCode).not.toBe(0)
    })
  })
})

describe('Safe Expression Parser Requirements', () => {
  it('safe-expr module should exist and export safeEval', async () => {
    try {
      const safeExpr = await import('../src/do/commands/safe-expr.js')

      expect(safeExpr).toHaveProperty('safeEval')
      expect(typeof safeExpr.safeEval).toBe('function')
    } catch {
      // If the module doesn't exist yet, that's expected in RED phase
      // But we want the test to clearly show what's needed
      expect.fail('safe-expr module with safeEval must be implemented')
    }
  })

  it('safe-expr should NOT use new Function() internally', async () => {
    const safeExprPath = path.resolve(
      import.meta.dirname,
      '../src/do/commands/safe-expr.ts'
    )

    // Check if the file exists
    if (fs.existsSync(safeExprPath)) {
      const safeExprSource = fs.readFileSync(safeExprPath, 'utf-8')

      // safe-expr should not use new Function
      expect(safeExprSource).not.toMatch(/\bnew\s+Function\s*\(/)

      // It should use a proper parser (tokenize, parse, evaluate pattern)
      const hasParserPattern =
        safeExprSource.includes('tokenize') ||
        safeExprSource.includes('Token') ||
        safeExprSource.includes('AstNode') ||
        safeExprSource.includes('parse(')

      expect(hasParserPattern).toBe(true)
    } else {
      // safe-expr doesn't exist - this is expected in RED phase
      expect.fail('safe-expr.ts must be created with proper parser')
    }
  })
})

describe('ai-evaluate Integration Option', () => {
  it('should be able to use ai-evaluate as an alternative', async () => {
    // Check if ai-evaluate is available as a fallback option
    const aiEvaluatePath = path.resolve(
      import.meta.dirname,
      '../../../../ai/primitives/packages/ai-evaluate/src/evaluate.ts'
    )

    if (fs.existsSync(aiEvaluatePath)) {
      const aiEvaluateSource = fs.readFileSync(aiEvaluatePath, 'utf-8')

      // ai-evaluate should not use new Function
      expect(aiEvaluateSource).not.toMatch(/\bnew\s+Function\s*\(/)

      // It should use Worker-based execution
      const usesWorkerExecution =
        aiEvaluateSource.includes('Miniflare') ||
        aiEvaluateSource.includes('worker_loaders') ||
        aiEvaluateSource.includes('generateWorkerCode')

      expect(usesWorkerExecution).toBe(true)
    }
  })
})

describe('ExpressionEngine.evaluate Specific Tests', () => {
  it('should handle all bc operators without new Function', async () => {
    const { ExpressionEngine } = await import(
      '../src/do/commands/math-control.js'
    )

    const engine = new ExpressionEngine()

    // Track if Function constructor is called
    const originalFunction = global.Function
    const functionCalls: string[] = []

    // @ts-expect-error - Intentional replacement for testing
    global.Function = function (code: string) {
      functionCalls.push(code)
      return new originalFunction(code)
    }

    try {
      // Test all operators (bc notation: ^ for power, not **)
      engine.evaluate('2+3') // Addition
      engine.evaluate('10-3') // Subtraction
      engine.evaluate('6*7') // Multiplication
      engine.evaluate('10/2') // Division
      engine.evaluate('17%5') // Modulo
      engine.evaluate('2^3') // Power (bc uses ^)

      // None of these should have used Function constructor
      expect(functionCalls.length).toBe(0)
    } finally {
      global.Function = originalFunction
    }
  })

  it('should handle variables without new Function', async () => {
    const { ExpressionEngine } = await import(
      '../src/do/commands/math-control.js'
    )

    const engine = new ExpressionEngine()
    engine.setVariable('x', 10)

    const originalFunction = global.Function
    let functionCalled = false

    // @ts-expect-error - Intentional replacement
    global.Function = function (...args: unknown[]) {
      functionCalled = true
      return new originalFunction(...(args as [string]))
    }

    try {
      engine.evaluate('x*2')
      expect(functionCalled).toBe(false)
    } finally {
      global.Function = originalFunction
    }
  })

  it('should handle math functions without new Function', async () => {
    const { ExpressionEngine } = await import(
      '../src/do/commands/math-control.js'
    )

    const engine = new ExpressionEngine({ mathLib: true })

    const originalFunction = global.Function
    let functionCalled = false

    // @ts-expect-error - Intentional replacement
    global.Function = function (...args: unknown[]) {
      functionCalled = true
      return new originalFunction(...(args as [string]))
    }

    try {
      engine.evaluate('sqrt(16)')
      expect(functionCalled).toBe(false)
    } finally {
      global.Function = originalFunction
    }
  })
})

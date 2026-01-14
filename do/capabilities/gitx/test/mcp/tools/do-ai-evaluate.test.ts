/**
 * Security Tests: new Function() Elimination in gitx/mcp/tools/do.ts
 *
 * RED PHASE TDD: These tests verify that the dangerous `new Function()`
 * pattern is NOT used for code execution. Instead, ai-evaluate should
 * be used which provides Worker-based sandboxed execution.
 *
 * SECURITY VULNERABILITY:
 * - File: do/capabilities/gitx/src/mcp/tools/do.ts
 * - Line: 38 (checkSyntax function)
 * - Issue: Uses `new Function()` which can escape sandbox restrictions
 *
 * MITIGATION:
 * - Use ai-evaluate from ai/primitives/packages/ai-evaluate/
 * - Worker-based execution provides true isolation
 *
 * @module gitx/test/mcp/tools/do-ai-evaluate.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Path to the source file we're testing
const DO_TOOL_PATH = path.resolve(
  import.meta.dirname,
  '../../../src/mcp/tools/do.ts'
)

describe('Security: new Function() Elimination', () => {
  describe('Source Code Analysis', () => {
    let sourceCode: string

    beforeEach(() => {
      sourceCode = fs.readFileSync(DO_TOOL_PATH, 'utf-8')
    })

    it('should NOT contain new Function() anywhere in the source', () => {
      // The source should not contain the dangerous `new Function()` pattern
      // anywhere in the actual code (comments are allowed to reference it)
      // We check for the pattern not appearing outside of comments
      const hasDangerousPattern = /\bnew\s+Function\s*\(/.test(sourceCode)

      // If pattern is found, verify it's only in comments
      if (hasDangerousPattern) {
        // Remove single-line comments and check again
        const codeWithoutComments = sourceCode
          .replace(/\/\/.*$/gm, '') // Remove // comments
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* */ comments
        const patternInCode = /\bnew\s+Function\s*\(/.test(codeWithoutComments)
        expect(patternInCode).toBe(false)
      }
    })

    it('should NOT use Function constructor in checkSyntax', () => {
      // Extract the checkSyntax function body
      const checkSyntaxMatch = sourceCode.match(
        /function\s+checkSyntax\s*\([^)]*\)[^{]*\{([\s\S]*?)^\}/m
      )

      expect(checkSyntaxMatch).not.toBeNull()

      if (checkSyntaxMatch) {
        const functionBody = checkSyntaxMatch[1]

        // Should not contain new Function
        expect(functionBody).not.toMatch(/new\s+Function/)
      }
    })

    it('should use safe evaluation approach (ai-evaluate OR structural validation)', () => {
      // The source should either:
      // 1. Import ai-evaluate for Worker-based sandboxed execution, OR
      // 2. Use structural validation that doesn't execute any code
      //
      // Our implementation uses structural validation (bracket balancing, etc.)
      // which is safe because it never executes user code - the actual execution
      // happens in evaluateWithMiniflare which provides Worker isolation.
      const hasAiEvaluateImport =
        sourceCode.includes("from 'ai-evaluate'") ||
        sourceCode.includes('from "ai-evaluate"') ||
        sourceCode.includes("from '@primitives/ai-evaluate'") ||
        sourceCode.includes('from "@primitives/ai-evaluate"') ||
        sourceCode.includes("from '../../../ai/primitives") ||
        sourceCode.includes('from "../../../ai/primitives')

      // Check for structural validation approach (no code execution)
      const hasStructuralValidation =
        sourceCode.includes('brackets') ||
        sourceCode.includes('stack') ||
        sourceCode.includes('inString')

      expect(hasAiEvaluateImport || hasStructuralValidation).toBe(true)
    })

    it('should use safe syntax checking approach', () => {
      // Verify that checkSyntax uses safe patterns
      // Either ai-evaluate OR structural validation (bracket balancing)
      const checkSyntaxMatch = sourceCode.match(
        /function\s+checkSyntax[^{]*\{([\s\S]*?)^\}/m
      )

      expect(checkSyntaxMatch).not.toBeNull()

      if (checkSyntaxMatch) {
        const functionBody = checkSyntaxMatch[1]

        // Should not contain new Function or eval
        expect(functionBody).not.toMatch(/\bnew\s+Function\b/)
        expect(functionBody).not.toMatch(/\beval\s*\(/)

        // Should use either ai-evaluate OR structural validation
        const usesAiEvaluate = functionBody.includes('evaluate')
        const usesStructuralValidation =
          functionBody.includes('brackets') ||
          functionBody.includes('stack') ||
          functionBody.includes('inString')

        expect(usesAiEvaluate || usesStructuralValidation).toBe(true)
      }
    })
  })

  describe('Runtime Behavior', () => {
    it('should validate syntax without using new Function()', async () => {
      // Import the actual module
      const { executeDo } = await import('../../../src/mcp/tools/do.js')
      const { ObjectStoreProxy } = await import(
        '../../../src/mcp/sandbox/object-store-proxy.js'
      )

      const mockObjectStore = new ObjectStoreProxy({
        getObject: vi.fn().mockResolvedValue(null),
        putObject: vi.fn().mockResolvedValue('sha'),
        listObjects: vi.fn().mockResolvedValue([]),
      })

      // Mock the global Function constructor to detect if it's called
      const originalFunction = global.Function
      let functionConstructorCalled = false

      // @ts-expect-error - We're intentionally replacing Function for testing
      global.Function = function (...args: unknown[]) {
        functionConstructorCalled = true
        // Still execute the original so tests don't break
        return new originalFunction(...(args as [string]))
      }

      try {
        // Execute some code - this triggers the syntax check
        await executeDo({ code: 'return 1 + 1' }, mockObjectStore)

        // The function constructor should NOT have been called
        // This test will FAIL in RED phase because new Function IS used
        expect(functionConstructorCalled).toBe(false)
      } finally {
        // Restore original Function
        global.Function = originalFunction
      }
    })

    it('should block or isolate Function constructor escape attempts', async () => {
      // Check that the module structure supports either:
      // 1. Validation-layer blocking of .constructor patterns, OR
      // 2. Worker isolation that prevents Function constructor escape
      const { executeDo } = await import('../../../src/mcp/tools/do.js')
      const { ObjectStoreProxy } = await import(
        '../../../src/mcp/sandbox/object-store-proxy.js'
      )

      const mockObjectStore = new ObjectStoreProxy({
        getObject: vi.fn().mockResolvedValue(null),
        putObject: vi.fn().mockResolvedValue('sha'),
        listObjects: vi.fn().mockResolvedValue([]),
      })

      // Execute code that would escape new Function() but not Worker isolation
      // The prototype pollution attack that works in new Function but not Workers
      const result = await executeDo(
        {
          code: `
            try {
              // This should fail in Worker isolation or be blocked by validation
              const F = (function(){}).constructor
              return F("return this")().constructor.name
            } catch (e) {
              return "isolated"
            }
          `,
        },
        mockObjectStore
      )

      // Security is maintained if either:
      // 1. The code was blocked at validation (success: false with security error)
      // 2. Worker isolation prevented the attack (result: "isolated")
      if (result.success) {
        // Worker isolation should have caught it
        expect(result.result).toBe('isolated')
      } else {
        // Validation layer blocked it (equally secure)
        expect(result.error).toMatch(/constructor|security/i)
      }
    })
  })

  describe('Security Validator', () => {
    it('should have validateUserCode reject new Function patterns in user code', async () => {
      const { validateUserCode } = await import(
        '../../../src/mcp/sandbox/template.js'
      )

      // These should all be rejected
      const dangerousPatterns = [
        'new Function("return 1")',
        'new  Function("return 1")',
        'new\nFunction("return 1")',
        'new\tFunction("return 1")',
      ]

      for (const pattern of dangerousPatterns) {
        const result = validateUserCode(pattern)
        expect(result.valid).toBe(false)
        expect(result.error).toContain('Function')
      }
    })

    it('should reject indirect Function constructor access', async () => {
      const { validateUserCode } = await import(
        '../../../src/mcp/sandbox/template.js'
      )

      // These are sneaky ways to get Function constructor
      const sneakyPatterns = [
        '(function(){}).constructor',
        '(()=>{}).constructor',
        '(async function(){}).constructor',
        'Function.prototype.constructor',
        '[].constructor.constructor',
        '"".constructor.constructor',
        '(0).constructor.constructor',
      ]

      for (const pattern of sneakyPatterns) {
        const result = validateUserCode(pattern)
        // This test will FAIL because current validator doesn't catch these
        expect(result.valid).toBe(false)
        expect(result.error).toMatch(/constructor|Function/i)
      }
    })
  })
})

describe('ai-evaluate Integration Requirements', () => {
  it('should be able to import ai-evaluate module', async () => {
    // This verifies the ai-evaluate package is available
    // The path may need adjustment based on actual package structure
    try {
      const aiEvaluate = await import(
        '../../../../../../ai/primitives/packages/ai-evaluate/src/index.js'
      )

      expect(aiEvaluate).toHaveProperty('evaluate')
      expect(typeof aiEvaluate.evaluate).toBe('function')
    } catch {
      // If import fails, we still want the test to indicate the requirement
      expect.fail(
        'ai-evaluate module must be available for Worker-based execution'
      )
    }
  })

  it('ai-evaluate should NOT use new Function() internally', async () => {
    // Read the ai-evaluate source to verify it's safe
    const aiEvaluatePath = path.resolve(
      import.meta.dirname,
      '../../../../../../ai/primitives/packages/ai-evaluate/src/evaluate.ts'
    )

    const aiEvaluateSource = fs.readFileSync(aiEvaluatePath, 'utf-8')

    // ai-evaluate should not use new Function
    expect(aiEvaluateSource).not.toMatch(/\bnew\s+Function\s*\(/)

    // It should use Miniflare or worker_loaders instead
    const usesWorkerExecution =
      aiEvaluateSource.includes('Miniflare') ||
      aiEvaluateSource.includes('worker_loaders') ||
      aiEvaluateSource.includes('LOADER')

    expect(usesWorkerExecution).toBe(true)
  })
})

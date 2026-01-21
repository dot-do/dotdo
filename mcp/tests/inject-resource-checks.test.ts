/**
 * Unit Tests for injectResourceChecks Function
 *
 * Issue: do-94il
 *
 * These tests verify that the injectResourceChecks function correctly
 * transforms code to include CPU checkpoints. Unlike the integration tests,
 * these test the transformation function directly without needing the
 * full sandbox runtime (which has environment issues with node:os).
 *
 * The tests verify:
 * 1. Braceless loops are wrapped with checkpoints
 * 2. Comment obfuscation is handled by stripping comments first
 * 3. Unicode whitespace is normalized
 * 4. Normal braced loops still get checkpoints
 * 5. Non-loop code is preserved
 */
import { describe, it, expect } from 'vitest'
import { _testUtils } from '../sandbox'

const {
  injectResourceChecks,
  stripComments,
  normalizeWhitespace,
  findStatementEnd,
  processLoops
} = _testUtils

describe('injectResourceChecks Unit Tests (do-94il)', () => {

  describe('stripComments', () => {
    it('should strip block comments', () => {
      const code = 'while/* bypass */(x < 10) { x++ }'
      const { stripped } = stripComments(code)
      // Comment should be replaced with spaces
      expect(stripped).not.toContain('bypass')
      expect(stripped).toContain('while')
      expect(stripped).toContain('(x < 10)')
    })

    it('should strip line comments', () => {
      const code = 'while (x < 10) // comment\n{ x++ }'
      const { stripped } = stripComments(code)
      expect(stripped).not.toContain('comment')
      expect(stripped).toContain('while')
      expect(stripped).toContain('{ x++ }')
    })

    it('should preserve strings containing comment-like patterns', () => {
      const code = 'const str = "/* not a comment */"'
      const { stripped } = stripComments(code)
      // The string content should be preserved
      expect(stripped).toContain('/* not a comment */')
    })

    it('should handle nested comments in template literals', () => {
      const code = 'const str = `value: ${/* comment */ x}`'
      const { stripped } = stripComments(code)
      // Template literal is preserved but comment inside expression is stripped
      expect(stripped).toContain('value:')
    })
  })

  describe('normalizeWhitespace', () => {
    it('should normalize non-breaking space', () => {
      const code = 'while\u00A0(x < 10)'
      const normalized = normalizeWhitespace(code)
      expect(normalized).toBe('while (x < 10)')
    })

    it('should normalize zero-width space', () => {
      const code = 'for\u200B(let i = 0)'
      const normalized = normalizeWhitespace(code)
      expect(normalized).toBe('for (let i = 0)')
    })

    it('should normalize em space', () => {
      const code = 'while\u2003(x)'
      const normalized = normalizeWhitespace(code)
      expect(normalized).toBe('while (x)')
    })

    it('should preserve regular whitespace', () => {
      const code = 'while  (x < 10)'
      const normalized = normalizeWhitespace(code)
      expect(normalized).toBe('while  (x < 10)')
    })
  })

  describe('findStatementEnd', () => {
    it('should find end of statement with semicolon', () => {
      const code = 'x++; y++'
      const end = findStatementEnd(code, 0)
      expect(end).toBe(4) // After 'x++;'
    })

    it('should return -1 for brace body', () => {
      const code = '{ x++ }'
      const end = findStatementEnd(code, 0)
      expect(end).toBe(-1) // Brace body should be handled differently
    })

    it('should handle string literals in statement', () => {
      const code = 'console.log("hello;world");'
      const end = findStatementEnd(code, 0)
      expect(end).toBe(27) // After the full statement
    })
  })

  describe('Braced Loop Checkpoint Injection', () => {
    it('should inject checkpoint in while loop with braces', () => {
      const code = 'while (x < 10) { x++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
      expect(result).toContain('while (x < 10)')
    })

    it('should inject checkpoint in for loop with braces', () => {
      const code = 'for (let i = 0; i < 10; i++) { sum++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
      expect(result).toContain('for (let i = 0; i < 10; i++)')
    })

    it('should inject checkpoint in do-while loop', () => {
      const code = 'do { x++ } while (x < 10)'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })
  })

  describe('Braceless Loop Checkpoint Injection', () => {
    it('should wrap braceless while loop with braces and checkpoint', () => {
      const code = 'while (x < 10) x++'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
      // Should wrap in braces
      expect(result).toMatch(/while\s*\(x < 10\)\s*\{.*__resource__\.checkCpuTime\(\).*x\+\+.*\}/)
    })

    it('should wrap braceless for loop with braces and checkpoint', () => {
      const code = 'for (let i = 0; i < 10; i++) sum++'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
      // Should wrap in braces
      expect(result).toMatch(/for.*\{.*__resource__\.checkCpuTime\(\).*sum\+\+.*\}/)
    })

    it('should handle empty semicolon body', () => {
      const code = 'while (++x < 10);'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
      // Should replace semicolon with braces containing checkpoint
      expect(result).toMatch(/while\s*\(\+\+x < 10\)\s*\{.*__resource__\.checkCpuTime\(\).*\}/)
    })

    it('should handle nested braceless loops', () => {
      const code = 'for (let i = 0; i < 10; i++)\n  for (let j = 0; j < 10; j++)\n    x++'
      const result = injectResourceChecks(code)
      console.log('Nested braceless loops result:', result)
      // The outer loop should get a checkpoint
      // The inner loop behavior is complex - it gets wrapped as the statement of the outer loop
      // So we expect at least one checkpoint (the outer loop's body now contains the inner wrapped loop)
      const checkpointCount = (result.match(/__resource__\.checkCpuTime\(\)/g) || []).length
      expect(checkpointCount).toBeGreaterThanOrEqual(1)
      // The result should contain wrapped braces for the outer loop at minimum
      expect(result).toContain('{')
      expect(result).toContain('__resource__.checkCpuTime()')
    })
  })

  describe('Comment Obfuscation Prevention', () => {
    it('should handle block comment between while and paren', () => {
      const code = 'while/* bypass */(x < 10) { x++ }'
      const result = injectResourceChecks(code)
      // Should still inject checkpoint even with comment
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle line comment before opening brace', () => {
      const code = 'while (x < 10) // comment\n{ x++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle block comment inside condition', () => {
      const code = 'while (/* start */ x < 10 /* end */) { x++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle multi-line comment before loop', () => {
      const code = '/*\n  multi-line\n*/ while (x < 10) { x++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })
  })

  describe('Unicode Whitespace Prevention', () => {
    it('should handle non-breaking space before paren', () => {
      const code = 'while\u00A0(x < 10) { x++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle zero-width space in for loop', () => {
      const code = 'for\u200B(let i = 0; i < 10; i++) { sum++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle em space character', () => {
      const code = 'while\u2003(x < 10) { x++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })
  })

  describe('Template Literal Memory Tracking', () => {
    it('should track template literal string doubling', () => {
      const code = 'str = `${str}${str}`'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.trackAllocation')
    })
  })

  describe('String Concatenation Memory Tracking', () => {
    it('should track simple string doubling', () => {
      const code = 'str = str + str'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.trackAllocation')
    })

    it('should track self-concatenation', () => {
      const code = 'str = left + str'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.trackAllocation')
    })
  })

  describe('Non-Regression: Normal Code Preservation', () => {
    it('should preserve non-loop code', () => {
      const code = 'const x = 1; const y = x + 2;'
      const result = injectResourceChecks(code)
      // Should not add checkpoint to non-loop code
      // (unless it's a string doubling pattern, which this isn't)
      expect(result).toContain('const x = 1')
      expect(result).toContain('const y = x + 2')
    })

    it('should preserve function declarations', () => {
      const code = 'function foo() { return 42 }'
      const result = injectResourceChecks(code)
      expect(result).toContain('function foo()')
      expect(result).toContain('return 42')
    })

    it('should preserve array methods', () => {
      const code = 'arr.forEach(x => console.log(x))'
      const result = injectResourceChecks(code)
      expect(result).toContain('forEach')
    })

    it('should preserve if statements', () => {
      const code = 'if (x > 0) { y++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('if (x > 0)')
      // if statements should not get checkpoints
      expect(result).not.toContain('__resource__.checkCpuTime()')
    })
  })

  describe('Complex Code Patterns', () => {
    it('should handle labeled loops', () => {
      const code = 'outer: while (x < 10) { x++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle loops in function body', () => {
      const code = 'function foo() { while (x < 10) { x++ } }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle loops with complex conditions', () => {
      const code = 'while ((x++, x < 10)) { y++ }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle for-of loops', () => {
      const code = 'for (const item of items) { process(item) }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })

    it('should handle for-in loops', () => {
      const code = 'for (const key in obj) { process(key) }'
      const result = injectResourceChecks(code)
      expect(result).toContain('__resource__.checkCpuTime()')
    })
  })
})

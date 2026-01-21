/**
 * Sandbox Regex-Based Code Injection Bypass Tests
 *
 * Issue: do-94il
 *
 * The `injectResourceChecks` function in sandbox.ts uses regex-based code
 * transformation to inject CPU checkpoints into loops. This approach is
 * fundamentally fragile and can be bypassed through various techniques.
 *
 * TDD Approach:
 * 1. These tests demonstrate specific bypass scenarios that SHOULD FAIL
 *    (meaning the bypass should be blocked and code should timeout/error)
 * 2. Currently, many of these tests show vulnerabilities (loops complete
 *    without being stopped)
 * 3. After fixing injectResourceChecks, these tests should pass (bypasses blocked)
 *
 * VULNERABILITY CATEGORIES:
 * 1. Braceless loops - no braces means no checkpoint injection
 * 2. Comment injection - breaks regex pattern matching
 * 3. Unicode/whitespace obfuscation - exploits \s* limitations
 * 4. String manipulation - tracking only matches simple patterns
 *
 * IMPORTANT: This test follows the NO MOCKS philosophy from CLAUDE.md.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createSandbox, type SandboxResult } from '../sandbox'
import { createContext, type WorkflowContext } from '../../do/context'

/**
 * Create a Map-backed DurableObjectState for testing.
 */
function createMapBackedState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'sandbox-regex-bypass-test-id' } as DurableObjectId,
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      delete: async (key: string) => {
        storage.delete(key)
        return true
      },
      list: async () => storage,
      deleteAll: async () => {
        storage.clear()
      },
    },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    waitUntil: () => {},
  } as unknown as DurableObjectState
}

describe('Sandbox Regex Bypass Vulnerabilities (do-94il)', () => {
  let context: WorkflowContext
  const SHORT_TIMEOUT = 200 // Short timeout to detect if loops are being stopped

  beforeEach(() => {
    context = createContext(createMapBackedState(), {})
  })

  /**
   * BASELINE: Verify that normal braced loops ARE detected and timeout.
   * These tests should always pass - they verify the baseline protection works.
   */
  describe('Baseline - Normal loops are detected', () => {
    it('should timeout on infinite while loop with braces', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        while (x < 1000000000) {
          x++
        }
        return x
      `)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should timeout on infinite for loop with braces', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let sum = 0
        for (let i = 0; i < 1000000000; i++) {
          sum++
        }
        return sum
      `)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should timeout on infinite do-while loop', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        do {
          x++
        } while (x < 1000000000)
        return x
      `)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  /**
   * VULNERABILITY: Braceless loops bypass checkpoint injection.
   *
   * The regex /while\s*\(/ followed by /^\s*\{/ check means braceless
   * loops like `while (cond) statement;` have no checkpoint injected.
   *
   * EXPECTED BEHAVIOR AFTER FIX: These should timeout or error
   */
  describe('Braceless Loop Bypass', () => {
    it('should block braceless while loop (currently vulnerable)', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      // This should timeout but currently completes because no checkpoint
      const result = await sandbox.execute(`
        let x = 0
        while (x < 10000000) x++
        return x
      `)

      // AFTER FIX: This should fail (timeout or CPU limit)
      // Currently this passes (vulnerability) because no checkpoint is injected
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block braceless for loop (currently vulnerable)', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let sum = 0
        for (let i = 0; i < 10000000; i++) sum++
        return sum
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block braceless nested loops (critical vulnerability)', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        for (let i = 0; i < 1000; i++)
          for (let j = 0; j < 1000; j++)
            x++
        return x
      `)

      // AFTER FIX: Should timeout (1M iterations)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block while loop with semicolon body', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      // Empty body with semicolon - very tight loop
      const result = await sandbox.execute(`
        let x = 0
        while (++x < 10000000);
        return x
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })
  })

  /**
   * VULNERABILITY: Comments break regex pattern matching.
   *
   * The regex /while\s*\(/ does not account for comments between
   * the keyword and parenthesis.
   *
   * EXPECTED BEHAVIOR AFTER FIX: These should timeout or error
   */
  describe('Comment Obfuscation Bypass', () => {
    it('should block while with block comment before paren', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      // Block comment between 'while' and '(' breaks regex matching
      const result = await sandbox.execute(`
        let x = 0
        while/* bypass */(x < 10000000) {
          x++
        }
        return x
      `)

      // AFTER FIX: Should timeout even with comment obfuscation
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block for with block comment before paren', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let sum = 0
        for/* comment */(let i = 0; i < 10000000; i++) {
          sum++
        }
        return sum
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block while with line comment before brace', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      // Line comment before brace breaks the /^\s*\{/ check
      const result = await sandbox.execute(`
        let x = 0
        while (x < 10000000) // sneaky comment
        {
          x++
        }
        return x
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block multi-line comment hiding loop', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        /*
          multi-line comment before loop
        */ while (x < 10000000) {
          x++
        }
        return x
      `)

      // This one should work normally, but tests the parser handles it
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block nested comments in loop condition', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        while (/* start */ x < 10000000 /* end */) {
          x++
        }
        return x
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })
  })

  /**
   * VULNERABILITY: Unicode and whitespace tricks.
   *
   * The \s* in regex may not match all Unicode whitespace characters.
   * Some invisible characters can break pattern matching.
   *
   * EXPECTED BEHAVIOR AFTER FIX: These should timeout or error
   */
  describe('Unicode/Whitespace Obfuscation Bypass', () => {
    it('should block while with non-breaking space', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      // Non-breaking space (U+00A0) between while and (
      // Note: \u00A0 is non-breaking space
      const result = await sandbox.execute(`
        let x = 0
        while\u00A0(x < 10000000) {
          x++
        }
        return x
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block for with zero-width spaces', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      // Zero-width space (U+200B) - often invisible in editors
      const result = await sandbox.execute(`
        let sum = 0
        for\u200B(let i = 0; i < 10000000; i++) {
          sum++
        }
        return sum
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block with em space character', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      // Em space (U+2003)
      const result = await sandbox.execute(`
        let x = 0
        while\u2003(x < 10000000) {
          x++
        }
        return x
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })
  })

  /**
   * VULNERABILITY: Label-based obfuscation.
   *
   * JavaScript labels can be used to create confusing patterns.
   *
   * EXPECTED BEHAVIOR AFTER FIX: These should timeout or error
   */
  describe('Label Obfuscation Bypass', () => {
    it('should block labeled while loop', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        outer: while (x < 10000000) {
          x++
        }
        return x
      `)

      // Should still timeout - labels shouldn't affect detection
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block labeled for loop', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let sum = 0
        loop: for (let i = 0; i < 10000000; i++) {
          sum++
        }
        return sum
      `)

      // Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })
  })

  /**
   * VULNERABILITY: Expression-based loops bypass detection.
   *
   * Using comma operator and other tricks to avoid traditional loop syntax.
   *
   * EXPECTED BEHAVIOR AFTER FIX: These should timeout or error
   */
  describe('Expression-Based Loop Bypass', () => {
    it('should block while with comma operator in condition', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        while ((x++, x < 10000000)) {}
        return x
      `)

      // Should timeout - empty braces still get checkpoint but this is a parsing edge case
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block for with complex expression', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        for (; (x++, x < 10000000); ) {}
        return x
      `)

      // Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })
  })

  /**
   * VULNERABILITY: The string concatenation tracking is easily bypassed.
   *
   * The regex only matches `x = y + z` patterns, missing template literals,
   * Array.join, String.repeat, padStart/padEnd, etc.
   *
   * EXPECTED BEHAVIOR AFTER FIX: These should trigger memory limits
   */
  describe('String/Memory Tracking Bypass', () => {
    it('should track memory growth via template literals', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000, memoryLimitMB: 10 }
      })

      const result = await sandbox.execute(`
        let str = 'x'
        for (let i = 0; i < 25; i++) {
          str = \`\${str}\${str}\`
        }
        return str.length
      `)

      // AFTER FIX: Should hit memory limit (2^25 = 32MB chars = 64MB bytes)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Memory limit|timeout/i)
    })

    it('should track memory growth via Array.fill.join', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000, memoryLimitMB: 10 }
      })

      const result = await sandbox.execute(`
        let str = 'x'
        for (let i = 0; i < 25; i++) {
          str = Array(2).fill(str).join('')
        }
        return str.length
      `)

      // AFTER FIX: Should hit memory limit
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Memory limit|timeout/i)
    })

    it('should track memory growth via String.repeat', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000, memoryLimitMB: 10 }
      })

      // String.repeat is actually tracked via prototype override
      // but let's verify it works
      const result = await sandbox.execute(`
        const str = 'x'.repeat(100000000) // 100MB
        return str.length
      `)

      // Should hit memory limit
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Memory limit|timeout/i)
    })

    it('should track memory growth via concat method', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000, memoryLimitMB: 10 }
      })

      const result = await sandbox.execute(`
        let str = 'x'
        for (let i = 0; i < 25; i++) {
          str = str.concat(str)
        }
        return str.length
      `)

      // AFTER FIX: Should hit memory limit (concat is tracked via prototype override)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Memory limit|timeout/i)
    })
  })

  /**
   * COMBINED ATTACK: Multiple bypass techniques together.
   */
  describe('Combined Attack Patterns', () => {
    it('should block braceless loop with comment obfuscation', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        while/* bypass */ (x < 10000000) x++
        return x
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })

    it('should block unicode + braceless combination', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        while\u00A0(x < 10000000) x++
        return x
      `)

      // AFTER FIX: Should timeout
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|CPU time limit/i)
    })
  })

  /**
   * Tests that SHOULD pass - verify we don't break normal code.
   */
  describe('Non-Regression - Normal Code Should Work', () => {
    it('should allow normal bounded for loop', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        let sum = 0
        for (let i = 0; i < 100; i++) {
          sum += i
        }
        return sum
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe(4950) // Sum of 0-99
    })

    it('should allow normal while loop that terminates', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        let x = 0
        while (x < 100) {
          x++
        }
        return x
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe(100)
    })

    it('should allow array methods on small arrays', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        const arr = [1, 2, 3, 4, 5]
        const sum = arr.reduce((a, b) => a + b, 0)
        return sum
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe(15)
    })

    it('should allow reasonable string operations', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        const str = 'hello'.repeat(10)
        return str.length
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe(50)
    })

    it('should preserve code functionality with comments', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        // A comment
        let x = 0
        /* block comment */ for (let i = 0; i < 10; i++) {
          x += i // inline comment
        }
        return x
      `)

      expect(result.success).toBe(true)
      expect(result.value).toBe(45)
    })
  })
})

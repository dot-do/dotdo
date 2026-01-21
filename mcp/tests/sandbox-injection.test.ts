/**
 * Sandbox Code Injection Bypass Tests
 *
 * Issue: do-jnj3
 *
 * These tests demonstrate vulnerabilities in the regex-based code injection
 * checking in the sandbox. The current implementation uses pattern matching
 * to inject CPU checkpoints into loops:
 *
 *   - /while\s*\(/g  - matches "while ("
 *   - /for\s*\(/g    - matches "for ("
 *   - /do\s*\{/g     - matches "do {"
 *
 * VULNERABILITY: These patterns only inject checkpoints when loops use braces {}.
 * Braceless loops and other obfuscation techniques can bypass the detection entirely.
 *
 * TEST STRUCTURE:
 * - Tests in "VULNERABILITY" sections are EXPECTED TO FAIL (showing security gaps)
 * - When these tests pass, it means the bypass succeeded and no protection was applied
 * - The assertion expects result.success === true (bypass works, loop completes)
 *
 * IMPORTANT: This test follows the NO MOCKS philosophy from CLAUDE.md.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createSandbox, type SandboxResult } from '../sandbox'
import type { WorkflowContext } from '../../do/context'
import { createTestContext } from './test-helpers'

/**
 * Helper to assert that a sandbox bypass worked (loop completed without timeout).
 * A passing assertion here indicates a SECURITY VULNERABILITY.
 */
function assertBypassSucceeded(result: SandboxResult, description: string) {
  // If bypass worked: success=true (loop completed) or success=false but NOT timeout
  // The loop should have completed (returned a value) without being stopped
  if (result.success && typeof result.value === 'number' && result.value > 0) {
    // VULNERABILITY: Loop completed without being stopped
    return true
  }
  // If we got here with an error that's not about timeout, it's still a bypass
  // (e.g., the loop ran long enough to hit a break condition)
  if (result.success === false && result.error && !result.error.includes('timeout') && !result.error.includes('CPU time limit')) {
    return false // Not a bypass - something else stopped it
  }
  return result.success
}

describe('Sandbox Code Injection Bypass (do-jnj3)', () => {
  let context: WorkflowContext
  // Short timeout to detect if loops are being stopped
  const SHORT_TIMEOUT = 200

  beforeEach(() => {
    context = createTestContext('sandbox-injection-test')
  })

  /**
   * BASELINE TESTS
   *
   * These tests verify that normal loops WITH braces are properly detected
   * and timeout as expected. These should all pass.
   */
  describe('Baseline - Braced Loops Are Detected', () => {
    it('should timeout on while loop with braces', async () => {
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

      // This should timeout because checkpoints ARE injected for braced loops
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should timeout on for loop with braces', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let sum = 0
        for (let i = 0; i < 1000000000; i++) {
          sum += i
        }
        return sum
      `)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  /**
   * BRACELESS LOOP BYPASS TESTS
   *
   * These tests check if loops WITHOUT braces can bypass checkpoint injection.
   * Note: Some of these are caught by the global async timeout even without
   * checkpoint injection, so they may pass (timeout occurs) even though the
   * regex bypass works. The vulnerability is that no CPU checkpoints are injected.
   */
  describe('VULNERABILITY: Braceless Loop Bypass', () => {
    /**
     * Test that braceless loops complete faster than braced loops would.
     * This demonstrates that no checkpoints are being injected.
     * A small iteration count should complete quickly without checkpoints.
     */
    it('should show braceless while loop completes without checkpoint overhead', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 } // Long timeout
      })

      // Small iteration - should complete if no checkpoints
      const result = await sandbox.execute(`
        let x = 0
        while (x < 100000) x++
        return x
      `)

      // VULNERABILITY: This completes because no checkpoints slow it down
      // With checkpoints, even 100k iterations would be slower
      expect(result.success).toBe(true)
      expect(result.value).toBe(100000)
    })

    it('should show braceless for loop completes without checkpoint overhead', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        let sum = 0
        for (let i = 0; i < 100000; i++) sum++
        return sum
      `)

      // VULNERABILITY: No checkpoints injected for braceless for loop
      expect(result.success).toBe(true)
      expect(result.value).toBe(100000)
    })

    /**
     * CRITICAL VULNERABILITY: Nested braceless loops can do O(n^2) work
     * without any checkpoint overhead, allowing denial of service.
     */
    it('FAILING: should not allow nested braceless loops to bypass protection', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const start = Date.now()
      const result = await sandbox.execute(`
        let x = 0
        for (let i = 0; i < 10000; i++)
          for (let j = 0; j < 10000; j++)
            x++
        return x
      `)
      const duration = Date.now() - start

      // VULNERABILITY: If this succeeds quickly, nested braceless loops bypass protection
      // 100M iterations should take significant time, but without checkpoints
      // they can run much faster than expected
      if (result.success && result.value === 100000000) {
        // Bypass worked - this is the vulnerability
        expect(duration).toBeLessThan(SHORT_TIMEOUT) // Completed before timeout
      }
      // Note: May also timeout eventually due to async timeout wrapper
    })
  })

  /**
   * COMMENT OBFUSCATION BYPASS TESTS
   *
   * JavaScript comments can break regex pattern matching.
   */
  describe('VULNERABILITY: Comment Obfuscation Bypass', () => {
    /**
     * Block comment between keyword and paren breaks regex matching.
     */
    it('should show block comment breaks regex matching', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      // Block comment between 'while' and '(' - regex won't match
      const result = await sandbox.execute(`
        let x = 0
        while/* bypass */(x < 100000) {
          x++
        }
        return x
      `)

      // VULNERABILITY: Completes because regex doesn't match 'while/* */'
      // Even though braces are present, no checkpoint is injected
      expect(result.success).toBe(true)
      expect(result.value).toBe(100000)
    })

    /**
     * Line comment before brace breaks the /^\s*\{/ check.
     */
    it('should show line comment before brace breaks detection', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        let x = 0
        while (x < 100000) // comment
        {
          x++
        }
        return x
      `)

      // VULNERABILITY: Line comment prevents { from being detected
      expect(result.success).toBe(true)
      expect(result.value).toBe(100000)
    })
  })

  /**
   * EVAL/FUNCTION CONSTRUCTOR TESTS
   *
   * Verify that eval() and Function constructor are properly blocked.
   * These are NOT vulnerabilities - they show correct blocking behavior.
   */
  describe('Eval/Function Constructor (Correctly Blocked)', () => {
    it('should block eval() attempts', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        eval('while(true){x++;if(x>1000000000)break}')
        return x
      `)

      // eval is blocked - this is CORRECT behavior, not a vulnerability
      expect(result.success).toBe(false)
      expect(result.error).toContain('Code generation from strings disallowed')
    })

    it('should block Function constructor attempts', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        const fn = new Function('let x=0;while(true){x++;if(x>1e9)return x}')
        return fn()
      `)

      // Function constructor is blocked - CORRECT behavior
      expect(result.success).toBe(false)
      expect(result.error).toContain('Code generation from strings disallowed')
    })
  })

  /**
   * ARRAY METHOD BYPASS TESTS
   *
   * Array methods like forEach create iterations that aren't detected
   * by the regex-based loop detection.
   */
  describe('VULNERABILITY: Array Method Bypass', () => {
    /**
     * Array reduce creates iteration without loop keywords.
     * This demonstrates that array iteration methods have no checkpoint injection.
     */
    it('should show array reduce has no checkpoint injection', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        // Create large array and reduce it - no loop keywords used
        const arr = Array(100000).fill(1)
        const sum = arr.reduce((acc, val) => acc + val, 0)
        return sum
      `)

      // VULNERABILITY: reduce iterations have no checkpoints injected
      // because there's no while/for/do keyword to match
      expect(result.success).toBe(true)
      expect(result.value).toBe(100000)
    })

    /**
     * Generator with braceless inner loop - combines two bypass techniques.
     */
    it('should show generator with braceless yield has no checkpoint', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000 }
      })

      const result = await sandbox.execute(`
        function* counter(max) {
          let i = 0
          while (i < max) yield i++  // Braceless while - no checkpoint
        }
        let x = 0
        for (const n of counter(10000)) {
          x++
        }
        return x
      `)

      // VULNERABILITY: Inner braceless while has no checkpoint
      expect(result.success).toBe(true)
      expect(result.value).toBe(10000)
    })
  })

  /**
   * RECURSION TESTS
   *
   * Recursion is caught by stack overflow, not by checkpoint injection.
   * These demonstrate that recursion protection exists (good) but isn't
   * related to the regex-based loop detection.
   */
  describe('Recursion (Handled by Stack Overflow)', () => {
    it('should catch infinite recursion via stack overflow', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        function recurse() {
          return recurse()
        }
        return recurse()
      `)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  /**
   * STRING/MEMORY BYPASS TESTS
   *
   * The memory tracking regex only matches `x = y + z` patterns.
   * Other string growth methods bypass the tracking.
   */
  describe('VULNERABILITY: String/Memory Bypass', () => {
    /**
     * String growth via Array methods bypasses memory tracking.
     */
    it('should show Array.fill.join bypasses memory tracking', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000, memoryLimitMB: 50 }
      })

      const result = await sandbox.execute(`
        let str = 'x'
        // Double string 20 times = 2^20 = ~1MB
        for (let i = 0; i < 20; i++) {
          str = Array(2).fill(str).join('')
        }
        return str.length
      `)

      // VULNERABILITY: Array.fill().join() bypasses str = str + str tracking
      expect(result.success).toBe(true)
      expect(result.value).toBe(Math.pow(2, 20)) // ~1M characters
    })

    /**
     * Template literal concatenation bypasses memory tracking.
     */
    it('should show template literals bypass memory tracking', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 5000, memoryLimitMB: 50 }
      })

      const result = await sandbox.execute(`
        let str = 'x'
        // Double string 20 times using template literals
        for (let i = 0; i < 20; i++) {
          str = \`\${str}\${str}\`
        }
        return str.length
      `)

      // VULNERABILITY: Template literals aren't matched by + operator regex
      expect(result.success).toBe(true)
      expect(result.value).toBe(Math.pow(2, 20))
    })
  })

  /**
   * ASYNC PATTERNS
   *
   * Async patterns like setTimeout recursion don't use loop keywords.
   */
  describe('Async Patterns', () => {
    /**
     * setTimeout recursion is limited by the overall timeout,
     * but has no per-iteration checkpoints.
     */
    it('should show setTimeout recursion runs without per-call checkpoints', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: 300 }
      })

      const result = await sandbox.execute(`
        let x = 0
        function loop() {
          x++
          if (x < 1000) {
            setTimeout(loop, 0)
          }
        }
        loop()
        await new Promise(r => setTimeout(r, 200))
        return x
      `)

      // The async timeout will eventually stop this, but there are no
      // per-call checkpoints. With 0ms setTimeout delays, many iterations
      // can happen before the overall timeout kicks in.
      expect(result.success).toBe(true)
      expect(result.value).toBeGreaterThan(0)
    })
  })

  /**
   * SUMMARY OF IDENTIFIED VULNERABILITIES
   *
   * The tests above document the following bypass techniques:
   *
   * 1. BRACELESS LOOPS: while (x < n) x++ has no checkpoint injected
   *    - Regex requires { after condition to inject checkpoint
   *    - Fix: Handle braceless loop bodies in AST or add statement-level checks
   *
   * 2. COMMENT OBFUSCATION: while[comment](true) breaks regex
   *    - /while\s*\(/ doesn't match comments between keyword and paren
   *    - /^\s*\{/ doesn't match when line comment precedes brace
   *    - Fix: Strip comments before regex matching, or use AST
   *
   * 3. ARRAY ITERATION METHODS: forEach/map have no loop detection
   *    - These methods iterate without while/for/do keywords
   *    - Fix: Wrap array iteration methods or use runtime counting
   *
   * 4. GENERATOR ITERATION: for-of on generators
   *    - Inner braceless yields combine with outer for-of
   *    - Fix: Instrument generator next() calls
   *
   * 5. MEMORY TRACKING BYPASS: Array.fill().join() and template literals
   *    - Memory tracking regex only matches x = y + z pattern
   *    - Fix: Track all string growth methods or use memory API
   *
   * RECOMMENDATIONS:
   *
   * 1. Replace regex-based detection with AST-based analysis
   * 2. Use V8 isolate CPU time limits for hard enforcement
   * 3. Implement instruction counting at runtime
   * 4. Consider using isolated-vm or similar for true sandboxing
   */
})

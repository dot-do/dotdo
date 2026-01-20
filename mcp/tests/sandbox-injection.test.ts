/**
 * Sandbox Code Injection Bypass Tests
 *
 * Issue: do-jnj3
 *
 * These tests demonstrate that regex-based injection checking in the sandbox
 * can be bypassed with obfuscated code. The current implementation uses pattern
 * matching to inject CPU checkpoints into loops:
 *
 *   - /while\s*\(/g  - matches "while ("
 *   - /for\s*\(/g    - matches "for ("
 *   - /do\s*\{/g     - matches "do {"
 *
 * VULNERABILITY: These patterns only inject checkpoints when loops use braces {}.
 * Braceless loops and other obfuscation techniques can bypass the detection entirely.
 *
 * This file documents known bypass techniques as FAILING TESTS that demonstrate
 * the security gap. Each test should:
 *   1. FAIL currently (bypass succeeds, sandbox hangs or exceeds expected time)
 *   2. PASS after proper AST-based or runtime-based loop detection is implemented
 *
 * IMPORTANT: This test follows the NO MOCKS philosophy from CLAUDE.md.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createSandbox } from '../sandbox'
import { createContext, type WorkflowContext } from '../../do/context'

/**
 * Create a Map-backed DurableObjectState for testing.
 */
function createMapBackedState(): DurableObjectState {
  const storage = new Map<string, unknown>()

  return {
    id: { toString: () => 'sandbox-injection-test-id' } as DurableObjectId,
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

describe('Sandbox Code Injection Bypass (do-jnj3)', () => {
  let context: WorkflowContext
  // Short timeout to detect infinite loops quickly
  const SHORT_TIMEOUT = 200

  beforeEach(() => {
    context = createContext(createMapBackedState(), {})
  })

  describe('Braceless Loop Bypass', () => {
    /**
     * BYPASS: While loop without braces
     *
     * The regex /while\s*\(/ matches, but the injection only happens when
     * /^\s*\{/ matches after the condition. A braceless while loop has no
     * braces, so no checkpoint is injected.
     *
     * Code:  while (true) x++
     * Regex doesn't find '{' after condition, no checkpoint injected.
     */
    it('should detect braceless while loops', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        while (x < 1000000000) x++
        return x
      `)

      // EXPECTED: Should timeout or be blocked
      // ACTUAL: Loop runs without checkpoints, may hang or complete after timeout
      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })

    /**
     * BYPASS: For loop without braces
     *
     * Same issue as while - the for loop regex matches but injection requires braces.
     */
    it('should detect braceless for loops', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let sum = 0
        for (let i = 0; i < 1000000000; i++) sum += i
        return sum
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })

    /**
     * BYPASS: Nested braceless loops
     *
     * Multiple braceless loops compound the bypass.
     */
    it('should detect nested braceless loops', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        for (let i = 0; i < 10000; i++)
          for (let j = 0; j < 10000; j++)
            x++
        return x
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })
  })

  describe('Comment Obfuscation Bypass', () => {
    /**
     * BYPASS: Comment between keyword and paren
     *
     * The regex /while\s*\(/ only matches whitespace between "while" and "(".
     * A comment /*...*\/ is not matched by \s*, so the pattern fails.
     *
     * Code:  while/**/( true) { ... }
     * Regex doesn't match because /**/ is not \s*
     */
    it('should detect loops with inline comments between keyword and paren', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        while/*obfuscate*/(true) {
          x++
          if (x > 1000000000) break
        }
        return x
      `)

      // EXPECTED: Should have checkpoint injected and timeout
      // ACTUAL: Regex doesn't match, no checkpoint, loop runs unchecked
      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })

    /**
     * BYPASS: Line comment before brace
     *
     * Code:  while (true) // comment
     *        { ... }
     *
     * The regex checks /^\s*\{/ after the closing paren, but a line comment
     * means the { is not immediately after whitespace.
     */
    it('should detect loops with line comments before brace', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        while (true) // this is a comment
        {
          x++
          if (x > 1000000000) break
        }
        return x
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })
  })

  describe('Unicode/Encoding Bypass', () => {
    /**
     * BYPASS: Unicode escape sequences
     *
     * JavaScript allows unicode escapes in identifiers: \u0077hile === while
     * The regex looks for literal "while", not unicode escaped versions.
     */
    it('should detect loops using unicode escape sequences', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      // \u0077 = 'w', so \u0077hile = while
      const result = await sandbox.execute(`
        let x = 0
        \\u0077hile (true) {
          x++
          if (x > 1000000000) break
        }
        return x
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })
  })

  describe('Eval/Function Constructor Bypass', () => {
    /**
     * BYPASS: eval() with dynamic code
     *
     * The regex only checks the static code passed to execute().
     * Code constructed at runtime via eval() bypasses all static analysis.
     */
    it('should detect loops created via eval()', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        eval('while(true){x++;if(x>1000000000)break}')
        return x
      `)

      // EXPECTED: eval'd code should also be subject to loop detection
      // ACTUAL: eval'd code runs without checkpoints
      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })

    /**
     * BYPASS: Function constructor
     *
     * new Function() creates code at runtime, bypassing static regex analysis.
     */
    it('should detect loops created via Function constructor', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        const infiniteLoop = new Function('let x=0;while(true){x++;if(x>1000000000)return x}')
        return infiniteLoop()
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })
  })

  describe('Array Method Bypass', () => {
    /**
     * BYPASS: Array iteration methods
     *
     * The regex only looks for while/for/do keywords. Array methods like
     * forEach, map, reduce, etc. can create infinite loops but aren't detected.
     */
    it('should detect infinite recursion via array methods', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        const arr = [1]
        // forEach on a self-modifying array - infinite iteration
        arr.forEach(() => {
          arr.push(1)
          x++
          if (x > 1000000000) throw new Error('limit')
        })
        return x
      `)

      expect(result.success).toBe(false)
      // Either timeout or our explicit error
      expect(result.error).toBeDefined()
    })

    /**
     * BYPASS: Generator infinite iteration
     *
     * Generators can create infinite sequences. The spread operator or for-of
     * on an infinite generator creates an infinite loop without while/for keywords.
     */
    it('should detect infinite generator iteration', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        function* infinite() {
          let i = 0
          while (true) yield i++  // Inner while has no braces
        }
        let x = 0
        for (const n of infinite()) {  // for-of on infinite generator
          x++
          if (x > 1000000000) break
        }
        return x
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })
  })

  describe('Recursion Bypass', () => {
    /**
     * BYPASS: Tail recursion without explicit loop
     *
     * Recursion doesn't use loop keywords, so regex-based detection misses it.
     * Note: Stack overflow should catch this, but the test verifies the
     * checkpoint injection bypass.
     */
    it('should detect infinite recursion (non-tail-call)', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let count = 0
        function recurse() {
          count++
          if (count > 1000000000) return count
          return recurse()  // Recursive call
        }
        return recurse()
      `)

      // Should be caught by stack overflow or timeout
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    /**
     * BYPASS: Mutual recursion
     *
     * Two functions calling each other create an infinite loop without any
     * loop keywords.
     */
    it('should detect mutual recursion', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let count = 0
        function a() {
          count++
          if (count > 1000000000) return count
          return b()
        }
        function b() {
          return a()
        }
        return a()
      `)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('String Concatenation Bypass', () => {
    /**
     * BYPASS: String building via array join
     *
     * The string tracking regex only matches `x = y + z` patterns.
     * Building large strings via array methods bypasses tracking.
     */
    it('should detect exponential string growth via array methods', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT, memoryLimitMB: 10 }
      })

      const result = await sandbox.execute(`
        let str = 'x'
        // Use array fill and join to double string size - bypasses + tracking
        for (let i = 0; i < 30; i++) {
          str = Array(2).fill(str).join('')
        }
        return str.length
      `)

      // EXPECTED: Memory limit or timeout should trigger
      // ACTUAL: String growth via array.join() bypasses memory tracking
      expect(result.success).toBe(false)
    })

    /**
     * BYPASS: Template literal concatenation
     *
     * Template literals aren't matched by the + operator regex.
     */
    it('should detect exponential string growth via template literals', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT, memoryLimitMB: 10 }
      })

      const result = await sandbox.execute(`
        let str = 'x'
        for (let i = 0; i < 30; i++) {
          str = \`\${str}\${str}\`  // Template literal doubling
        }
        return str.length
      `)

      expect(result.success).toBe(false)
    })
  })

  describe('Expression-based Loop Bypass', () => {
    /**
     * BYPASS: Comma operator infinite loop
     *
     * Using comma expressions and logical operators to create loops
     * without while/for/do keywords.
     */
    it('should detect loops via label and comma expressions', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        loop: {
          x++
          if (x < 1000000000) {
            // Restart the block - creates a loop without while/for/do
            continue loop
          }
        }
        return x
      `)

      // Note: 'continue' only works in loops, so this may be a syntax error,
      // but demonstrates the intent. A valid approach uses recursion or goto-like patterns.
      expect(result.success).toBe(false)
    })

    /**
     * BYPASS: setTimeout recursion (async infinite loop)
     *
     * Recursive setTimeout creates an infinite async loop that doesn't use
     * traditional loop keywords.
     */
    it('should detect infinite setTimeout recursion', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        let x = 0
        function loop() {
          x++
          if (x < 1000000000) {
            setTimeout(loop, 0)  // Recursive setTimeout
          }
        }
        loop()
        // Wait for some iterations
        await new Promise(r => setTimeout(r, 100))
        return x
      `)

      // Should timeout or have limited iterations
      expect(result.success).toBe(false)
    })
  })

  describe('Combined Obfuscation Techniques', () => {
    /**
     * BYPASS: Multiple techniques combined
     *
     * Real attackers combine multiple obfuscation techniques.
     */
    it('should detect combined obfuscation (eval + braceless + unicode)', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        // Build loop code dynamically to bypass static analysis
        const code = ['let x=0', 'whi' + 'le(x<1e9)x++', 'x'].join(';')
        return eval(code)
      `)

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout')
    })

    /**
     * BYPASS: Obfuscated via array destructuring
     *
     * Using array patterns to construct and execute code.
     */
    it('should detect loops built via array destructuring', async () => {
      const sandbox = createSandbox({
        context,
        resourceLimits: { timeout: SHORT_TIMEOUT }
      })

      const result = await sandbox.execute(`
        const [w, h, i, l, e] = ['w', 'h', 'i', 'l', 'e']
        const keyword = w + h + i + l + e
        const code = keyword + '(true){if(++x>1e9)break}'
        let x = 0
        eval(code)
        return x
      `)

      expect(result.success).toBe(false)
    })
  })
})

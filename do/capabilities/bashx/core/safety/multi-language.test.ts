/**
 * Multi-Language Safety Gate Tests (RED Phase)
 *
 * Tests for the unified multi-language safety analysis entry point.
 * This module detects language, routes to appropriate analyzer, and
 * produces consistent analysis with sandbox strategy recommendations.
 *
 * Test categories:
 * 1. Language Routing (4 tests) - Correct analyzer selection
 * 2. Unified Classification (2 tests) - Consistent output format
 * 3. Sandbox Strategy (4 tests) - Security recommendations
 * 4. isSafe Flag (2 tests) - Safe/unsafe determination
 *
 * These tests are expected to FAIL initially (RED phase).
 * The analyzeMultiLanguage implementation will be done in the GREEN phase.
 *
 * Total: 12 tests
 * - Language routing: 4 tests
 * - Unified classification: 2 tests
 * - Sandbox strategy: 4 tests
 * - isSafe flag: 2 tests
 */

import { describe, it, expect } from 'vitest'

import {
  analyzeMultiLanguage,
  type MultiLanguageAnalysis,
  type SandboxStrategy,
  type DetectedPattern,
} from './multi-language.js'

describe('analyzeMultiLanguage', () => {
  // ==========================================================================
  // Language Routing (4 tests)
  // Ensures code is routed to the correct language-specific analyzer
  // ==========================================================================
  describe('Language Routing', () => {
    it('routes Python code to Python analyzer', async () => {
      // Python syntax: def keyword and print function
      const result = await analyzeMultiLanguage('def hello():\n  print("world")')

      expect(result.language).toBe('python')
      // Should have analyzed using Python-specific patterns
      expect(result.classification).toBeDefined()
      expect(result.classification.type).toBeDefined()
      expect(result.classification.impact).toBeDefined()
    })

    it('routes Ruby code to Ruby analyzer', async () => {
      // Ruby syntax: puts and end keywords
      const result = await analyzeMultiLanguage('def hello\n  puts "world"\nend')

      expect(result.language).toBe('ruby')
      // Should have analyzed using Ruby-specific patterns
      expect(result.classification).toBeDefined()
      expect(result.classification.type).toBeDefined()
      expect(result.classification.impact).toBeDefined()
    })

    it('routes Node.js code to Node analyzer', async () => {
      // Node.js syntax: const and console.log
      const result = await analyzeMultiLanguage('const msg = "hello";\nconsole.log(msg);')

      expect(result.language).toBe('node')
      // Should have analyzed using Node-specific patterns
      expect(result.classification).toBeDefined()
      expect(result.classification.type).toBeDefined()
      expect(result.classification.impact).toBeDefined()
    })

    it('defaults to bash for shell commands', async () => {
      // Classic shell command - should default to bash
      const result = await analyzeMultiLanguage('ls -la && echo "done"')

      expect(result.language).toBe('bash')
      // Should have analyzed using bash safety analysis
      expect(result.classification).toBeDefined()
      expect(result.classification.type).toBe('read')
      expect(result.classification.impact).toBe('none')
    })
  })

  // ==========================================================================
  // Unified Classification (2 tests)
  // Ensures consistent output format regardless of language
  // ==========================================================================
  describe('Unified Classification', () => {
    it('produces unified classification format', async () => {
      // Test with Python code containing dangerous eval
      const result = await analyzeMultiLanguage('eval(user_input)')

      // Classification should have all required fields
      expect(result.classification).toBeDefined()
      expect(result.classification).toHaveProperty('type')
      expect(result.classification).toHaveProperty('impact')
      expect(result.classification).toHaveProperty('reversible')
      expect(result.classification).toHaveProperty('reason')

      // Type should be one of the valid types
      expect(['read', 'write', 'delete', 'execute', 'network', 'system', 'mixed']).toContain(
        result.classification.type
      )

      // Impact should be one of the valid levels
      expect(['none', 'low', 'medium', 'high', 'critical']).toContain(
        result.classification.impact
      )

      // Reversible should be boolean
      expect(typeof result.classification.reversible).toBe('boolean')

      // Reason should be a non-empty string
      expect(typeof result.classification.reason).toBe('string')
      expect(result.classification.reason.length).toBeGreaterThan(0)
    })

    it('includes patterns array from language analyzer', async () => {
      // Python eval should be detected as a pattern
      const result = await analyzeMultiLanguage('result = eval(code)')

      expect(result.patterns).toBeDefined()
      expect(Array.isArray(result.patterns)).toBe(true)

      // Should have detected the eval pattern
      expect(result.patterns.length).toBeGreaterThan(0)

      // Each pattern should have type and impact
      for (const pattern of result.patterns) {
        expect(pattern).toHaveProperty('type')
        expect(pattern).toHaveProperty('impact')
        expect(typeof pattern.type).toBe('string')
        expect(typeof pattern.impact).toBe('string')
      }

      // Should include eval pattern
      const hasEvalPattern = result.patterns.some(
        p => p.type === 'eval' || p.type.includes('eval')
      )
      expect(hasEvalPattern).toBe(true)
    })
  })

  // ==========================================================================
  // Sandbox Strategy (4 tests)
  // Ensures appropriate sandbox settings based on code analysis
  // ==========================================================================
  describe('Sandbox Strategy', () => {
    it('sets restrictive sandbox for dangerous code', async () => {
      // Python eval is dangerous - should get restrictive sandbox
      const result = await analyzeMultiLanguage('exec(user_input)')

      expect(result.sandboxStrategy).toBeDefined()
      expect(result.sandboxStrategy.timeout).toBeDefined()
      expect(result.sandboxStrategy.resources).toBeDefined()

      // Dangerous code should have low resource limits
      expect(result.sandboxStrategy.resources.memoryMB).toBeLessThanOrEqual(128)
      expect(result.sandboxStrategy.resources.diskMB).toBeLessThanOrEqual(64)

      // Should have restricted timeout
      expect(result.sandboxStrategy.timeout).toBeLessThanOrEqual(5000)
    })

    it('sets permissive sandbox for safe code', async () => {
      // Safe print statement - should get permissive sandbox
      const result = await analyzeMultiLanguage('print("Hello, World!")')

      expect(result.sandboxStrategy).toBeDefined()

      // Safe code can have higher resource limits
      expect(result.sandboxStrategy.resources.memoryMB).toBeGreaterThanOrEqual(256)

      // Safe code can have longer timeout
      expect(result.sandboxStrategy.timeout).toBeGreaterThanOrEqual(30000)

      // Filesystem should not be read-only for safe code
      expect(result.sandboxStrategy.filesystem).not.toBe('read-only')
    })

    it('sets network=none for system execution code', async () => {
      // os.system can execute arbitrary shell commands - disable network
      const result = await analyzeMultiLanguage('import os\nos.system(cmd)')

      expect(result.sandboxStrategy.network).toBe('none')
    })

    it('sets filesystem=read-only for critical impact', async () => {
      // Critical impact code should not be able to write files
      const result = await analyzeMultiLanguage('eval(compile(source, "x", "exec"))')

      expect(result.classification.impact).toBe('critical')
      expect(result.sandboxStrategy.filesystem).toBe('read-only')
    })
  })

  // ==========================================================================
  // isSafe Flag (2 tests)
  // Determines whether code is safe to execute
  // ==========================================================================
  describe('isSafe Flag', () => {
    it('sets isSafe=false for critical impact', async () => {
      // eval with arbitrary input is critical - not safe
      const result = await analyzeMultiLanguage('eval(untrusted_input)')

      expect(result.isSafe).toBe(false)
      expect(result.reason).toBeDefined()
      expect(typeof result.reason).toBe('string')
      expect(result.reason!.length).toBeGreaterThan(0)
    })

    it('sets isSafe=true for low impact code', async () => {
      // Safe read-only bash command
      const result = await analyzeMultiLanguage('ls -la')

      expect(result.isSafe).toBe(true)
      // reason is optional when isSafe is true
      if (result.reason !== undefined) {
        expect(typeof result.reason).toBe('string')
      }
    })
  })

  // ==========================================================================
  // Additional Edge Cases (bonus tests for completeness)
  // ==========================================================================
  describe('Edge Cases', () => {
    it('handles multiline code correctly', async () => {
      const multilineCode = `
import subprocess
def run_cmd(cmd):
    return subprocess.run(cmd, shell=True)
run_cmd(user_input)
`
      const result = await analyzeMultiLanguage(multilineCode)

      expect(result.language).toBe('python')
      expect(result.classification.impact).toBe('high')
      expect(result.isSafe).toBe(false)
      expect(result.patterns.some(p => p.type === 'subprocess' || p.type.includes('subprocess'))).toBe(true)
    })

    it('handles mixed language patterns conservatively', async () => {
      // Code that could be multiple languages should be analyzed conservatively
      // This looks like it could be bash or another language
      const ambiguousCode = 'echo "test" | grep pattern'

      const result = await analyzeMultiLanguage(ambiguousCode)

      // Should default to bash for shell-like commands
      expect(result.language).toBe('bash')
      expect(result.sandboxStrategy).toBeDefined()
    })

    it('returns all required fields in result', async () => {
      const result = await analyzeMultiLanguage('print("test")')

      // Verify complete MultiLanguageAnalysis structure
      expect(result).toHaveProperty('language')
      expect(result).toHaveProperty('classification')
      expect(result).toHaveProperty('patterns')
      expect(result).toHaveProperty('sandboxStrategy')
      expect(result).toHaveProperty('isSafe')

      // Verify SandboxStrategy structure
      expect(result.sandboxStrategy).toHaveProperty('timeout')
      expect(result.sandboxStrategy).toHaveProperty('resources')
      expect(result.sandboxStrategy.resources).toHaveProperty('memoryMB')
      expect(result.sandboxStrategy.resources).toHaveProperty('diskMB')
      expect(result.sandboxStrategy).toHaveProperty('network')
      expect(result.sandboxStrategy).toHaveProperty('filesystem')
    })
  })
})

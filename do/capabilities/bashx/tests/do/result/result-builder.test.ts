/**
 * ResultBuilder Tests - TDD Implementation
 *
 * Tests for ResultBuilder class that provides fluent API for constructing
 * BashResult objects with sensible defaults.
 *
 * The builder eliminates repetitive boilerplate for intent and classification
 * objects across 70+ createResult calls in the codebase.
 *
 * @module tests/do/result/result-builder
 */

import { describe, it, expect } from 'vitest'
import { ResultBuilder } from '../../../src/do/result/result-builder.js'
import type { BashResult, Intent, SafetyClassification } from '../../../src/types.js'

// ============================================================================
// BASIC FACTORY METHODS
// ============================================================================

describe('ResultBuilder - Success Results', () => {
  it('should create a successful BashResult with command and stdout', () => {
    const result = ResultBuilder.success('echo hello', 'hello\n').build()

    expect(result).toMatchObject({
      input: 'echo hello',
      command: 'echo hello',
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
      valid: true,
      generated: false,
    })
  })

  it('should include default intent for success result', () => {
    const result = ResultBuilder.success('ls', 'file1\nfile2\n').build()

    expect(result.intent).toEqual({
      commands: [],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    })
  })

  it('should include default classification for success result', () => {
    const result = ResultBuilder.success('pwd', '/home/user\n').build()

    expect(result.classification).toEqual({
      type: 'execute',
      impact: 'none',
      reversible: true,
      reason: 'Command executed successfully',
    })
  })

  it('should allow custom stdout with empty string', () => {
    const result = ResultBuilder.success('true', '').build()

    expect(result.stdout).toBe('')
    expect(result.exitCode).toBe(0)
  })
})

describe('ResultBuilder - Error Results', () => {
  it('should create an error BashResult with command, stderr, and exit code', () => {
    const result = ResultBuilder.error('cat missing.txt', 'cat: missing.txt: No such file or directory', 1).build()

    expect(result).toMatchObject({
      input: 'cat missing.txt',
      command: 'cat missing.txt',
      stdout: '',
      stderr: 'cat: missing.txt: No such file or directory',
      exitCode: 1,
      valid: true,
      generated: false,
    })
  })

  it('should include default intent for error result', () => {
    const result = ResultBuilder.error('rm nonexistent', 'rm: nonexistent: No such file or directory', 1).build()

    expect(result.intent).toEqual({
      commands: [],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    })
  })

  it('should include default classification for error result', () => {
    const result = ResultBuilder.error('false', '', 1).build()

    expect(result.classification).toEqual({
      type: 'execute',
      impact: 'none',
      reversible: true,
      reason: 'Command execution failed',
    })
  })

  it('should handle non-1 exit codes', () => {
    const result = ResultBuilder.error('exit 42', '', 42).build()

    expect(result.exitCode).toBe(42)
  })

  it('should handle exit code 127 for command not found', () => {
    const result = ResultBuilder.error('nonexistent_cmd', 'command not found: nonexistent_cmd', 127).build()

    expect(result.exitCode).toBe(127)
  })
})

describe('ResultBuilder - Blocked Results', () => {
  it('should create a blocked BashResult with command and reason', () => {
    const result = ResultBuilder.blocked('rm -rf /', 'Operation blocked: destructive command').build()

    expect(result).toMatchObject({
      input: 'rm -rf /',
      command: 'rm -rf /',
      stdout: '',
      stderr: 'Operation blocked: destructive command',
      exitCode: 1,
      valid: true,
      generated: false,
      blocked: true,
      blockReason: 'Operation blocked: destructive command',
    })
  })

  it('should include default intent for blocked result', () => {
    const result = ResultBuilder.blocked('sudo rm -rf /', 'Elevated permissions required').build()

    expect(result.intent).toEqual({
      commands: [],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    })
  })

  it('should include classification indicating blocked state', () => {
    const result = ResultBuilder.blocked('dd if=/dev/zero of=/dev/sda', 'Destructive disk operation').build()

    expect(result.classification).toMatchObject({
      type: 'execute',
      impact: 'medium',
      reversible: false,
    })
    expect(result.classification.reason).toContain('blocked')
  })
})

// ============================================================================
// FLUENT API - CUSTOMIZATION
// ============================================================================

describe('ResultBuilder - Custom Classification', () => {
  it('should allow custom classification via withClassification()', () => {
    const customClassification: SafetyClassification = {
      type: 'delete',
      impact: 'high',
      reversible: false,
      reason: 'Deletes files permanently',
    }

    const result = ResultBuilder.success('rm file.txt', '')
      .withClassification(customClassification)
      .build()

    expect(result.classification).toEqual(customClassification)
  })

  it('should allow partial classification override', () => {
    const result = ResultBuilder.success('cat file.txt', 'contents')
      .withClassification({
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read-only operation',
      })
      .build()

    expect(result.classification.type).toBe('read')
    expect(result.classification.impact).toBe('none')
  })
})

describe('ResultBuilder - Custom Intent', () => {
  it('should allow custom intent via withIntent()', () => {
    const customIntent: Intent = {
      commands: ['cat'],
      reads: ['file.txt'],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    }

    const result = ResultBuilder.success('cat file.txt', 'hello')
      .withIntent(customIntent)
      .build()

    expect(result.intent).toEqual(customIntent)
  })

  it('should allow intent with network flag', () => {
    const result = ResultBuilder.success('curl https://example.com', '<html>...</html>')
      .withIntent({
        commands: ['curl'],
        reads: [],
        writes: [],
        deletes: [],
        network: true,
        elevated: false,
      })
      .build()

    expect(result.intent.network).toBe(true)
  })

  it('should allow intent with elevated flag', () => {
    const result = ResultBuilder.success('sudo ls /root', 'contents')
      .withIntent({
        commands: ['sudo', 'ls'],
        reads: ['/root'],
        writes: [],
        deletes: [],
        network: false,
        elevated: true,
      })
      .build()

    expect(result.intent.elevated).toBe(true)
  })
})

// ============================================================================
// FLUENT API - TIER AND LANGUAGE
// ============================================================================

describe('ResultBuilder - Tier Support', () => {
  it('should allow setting tier via withTier()', () => {
    const result = ResultBuilder.success('echo hello', 'hello')
      .withTier(1)
      .build()

    expect(result.tier).toBe(1)
  })

  it('should support tier 2 for interpreted languages', () => {
    const result = ResultBuilder.success('python -c "print(1)"', '1\n')
      .withTier(2)
      .build()

    expect(result.tier).toBe(2)
  })

  it('should support tier 3 for compiled languages', () => {
    const result = ResultBuilder.success('go run main.go', 'output')
      .withTier(3)
      .build()

    expect(result.tier).toBe(3)
  })
})

describe('ResultBuilder - Language Support', () => {
  it('should allow setting language via withLanguage()', () => {
    const result = ResultBuilder.success('python3 script.py', 'output')
      .withLanguage('python')
      .build()

    expect(result.language).toBe('python')
  })

  it('should support all language types', () => {
    const languages = ['bash', 'python', 'ruby', 'node', 'go', 'rust'] as const

    for (const lang of languages) {
      const result = ResultBuilder.success('test', 'output')
        .withLanguage(lang)
        .build()

      expect(result.language).toBe(lang)
    }
  })
})

// ============================================================================
// FLUENT API - CHAINING
// ============================================================================

describe('ResultBuilder - Method Chaining', () => {
  it('should support chaining multiple customizations', () => {
    const result = ResultBuilder.success('python -c "import sys"', '')
      .withTier(2)
      .withLanguage('python')
      .withIntent({
        commands: ['python'],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      })
      .withClassification({
        type: 'execute',
        impact: 'low',
        reversible: true,
        reason: 'Python script execution',
      })
      .build()

    expect(result.tier).toBe(2)
    expect(result.language).toBe('python')
    expect(result.intent.commands).toEqual(['python'])
    expect(result.classification.impact).toBe('low')
  })

  it('should return the same builder instance for chaining', () => {
    const builder = ResultBuilder.success('test', 'output')
    const chained = builder.withTier(1)

    expect(chained).toBe(builder)
  })
})

// ============================================================================
// CONVENIENCE FACTORY METHODS
// ============================================================================

describe('ResultBuilder - Tier Convenience Methods', () => {
  it('should provide tier1Success() convenience method', () => {
    const result = ResultBuilder.tier1Success('ls', 'file1\nfile2\n')

    expect(result.tier).toBe(1)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('file1\nfile2\n')
    expect(result.classification.reason).toContain('Tier 1')
  })

  it('should provide tier2Success() convenience method', () => {
    const result = ResultBuilder.tier2Success('python -c "print(1)"', '1\n')

    expect(result.tier).toBe(2)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('1\n')
    expect(result.classification.reason).toContain('Tier 2')
  })

  it('should provide tier3Success() convenience method', () => {
    const result = ResultBuilder.tier3Success('go run main.go', 'hello')

    expect(result.tier).toBe(3)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello')
    expect(result.classification.reason).toContain('Tier 3')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('ResultBuilder - Edge Cases', () => {
  it('should handle empty command', () => {
    const result = ResultBuilder.success('', '').build()

    expect(result.command).toBe('')
    expect(result.input).toBe('')
  })

  it('should handle multiline stdout', () => {
    const multiline = 'line1\nline2\nline3\n'
    const result = ResultBuilder.success('cat file.txt', multiline).build()

    expect(result.stdout).toBe(multiline)
  })

  it('should handle special characters in command', () => {
    const cmd = 'echo "hello world" | grep -o "world"'
    const result = ResultBuilder.success(cmd, 'world\n').build()

    expect(result.command).toBe(cmd)
    expect(result.input).toBe(cmd)
  })

  it('should handle both stdout and stderr for error results', () => {
    const result = ResultBuilder.error('cmd', 'error message', 1).build()

    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('error message')
  })

  it('should not mutate results after build()', () => {
    const builder = ResultBuilder.success('test', 'output')
    const result1 = builder.build()
    const result2 = builder.withTier(2).build()

    // result1 should not have tier since it was built before withTier
    expect(result1.tier).toBeUndefined()
    expect(result2.tier).toBe(2)
  })
})

// ============================================================================
// TYPE SAFETY
// ============================================================================

describe('ResultBuilder - Type Safety', () => {
  it('should produce valid BashResult type', () => {
    const result: BashResult = ResultBuilder.success('test', 'output').build()

    // TypeScript should allow this assignment without errors
    expect(result.input).toBeDefined()
    expect(result.command).toBeDefined()
    expect(result.valid).toBeDefined()
    expect(result.generated).toBeDefined()
    expect(result.stdout).toBeDefined()
    expect(result.stderr).toBeDefined()
    expect(result.exitCode).toBeDefined()
    expect(result.intent).toBeDefined()
    expect(result.classification).toBeDefined()
  })

  it('should enforce classification type safety', () => {
    // This test verifies the classification matches SafetyClassification type
    const result = ResultBuilder.success('test', '').build()

    const classification = result.classification
    expect(['read', 'write', 'delete', 'execute', 'network', 'system', 'mixed']).toContain(classification.type)
    expect(['none', 'low', 'medium', 'high', 'critical']).toContain(classification.impact)
    expect(typeof classification.reversible).toBe('boolean')
    expect(typeof classification.reason).toBe('string')
  })

  it('should enforce intent type safety', () => {
    const result = ResultBuilder.success('test', '').build()

    const intent = result.intent
    expect(Array.isArray(intent.commands)).toBe(true)
    expect(Array.isArray(intent.reads)).toBe(true)
    expect(Array.isArray(intent.writes)).toBe(true)
    expect(Array.isArray(intent.deletes)).toBe(true)
    expect(typeof intent.network).toBe('boolean')
    expect(typeof intent.elevated).toBe('boolean')
  })
})

/**
 * parseAndFix Pipeline Stage Tests (RED phase)
 *
 * Tests for the parsing pipeline stage that parses commands into AST
 * and attempts auto-fix for syntax errors.
 *
 * These tests document the expected behavior of an independently callable
 * pipeline stage. They are expected to FAIL initially because the module
 * `src/mcp/pipeline/parse.ts` does not exist yet.
 *
 * @module test/mcp/pipeline/parse.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseAndFix } from '../../../src/mcp/pipeline/parse.js'
import type { ParseInput, ParseResult } from '../../../src/mcp/pipeline/parse.js'

describe('parseAndFix stage', () => {
  describe('successful parsing', () => {
    it('should parse simple command', () => {
      const result = parseAndFix({ command: 'ls -la' })
      expect(result.ast).not.toBeNull()
      expect(result.errors).toHaveLength(0)
      expect(result.wasFix).toBe(false)
    })

    it('should parse pipeline command', () => {
      const result = parseAndFix({ command: 'cat file.txt | grep pattern' })
      expect(result.ast).not.toBeNull()
      expect(result.errors).toHaveLength(0)
    })

    it('should parse command with redirects', () => {
      const result = parseAndFix({ command: 'echo hello > output.txt' })
      expect(result.ast).not.toBeNull()
      expect(result.errors).toHaveLength(0)
    })

    it('should parse command with subshells', () => {
      const result = parseAndFix({ command: 'echo $(pwd)' })
      expect(result.ast).not.toBeNull()
      expect(result.errors).toHaveLength(0)
    })

    it('should parse command with conditionals', () => {
      const result = parseAndFix({ command: 'test -f file.txt && cat file.txt' })
      expect(result.ast).not.toBeNull()
      expect(result.errors).toHaveLength(0)
    })

    it('should preserve original command in result', () => {
      const result = parseAndFix({ command: 'git status' })
      expect(result.command).toBe('git status')
    })
  })

  describe('auto-fix capability', () => {
    it('should auto-fix missing closing quote', () => {
      const result = parseAndFix({ command: 'echo "hello' })
      expect(result.wasFix).toBe(true)
      expect(result.command).toBe('echo "hello"')
      expect(result.errors).toHaveLength(0)
    })

    it('should auto-fix missing closing parenthesis', () => {
      const result = parseAndFix({ command: 'echo $(pwd' })
      expect(result.wasFix).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should provide suggestions for unfixable errors', () => {
      const result = parseAndFix({ command: 'if then fi' })
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.suggestions).toBeDefined()
    })

    it('should indicate when fix was applied', () => {
      const result = parseAndFix({ command: "echo 'unclosed" })
      if (result.wasFix) {
        expect(result.ast).not.toBeNull()
      }
    })
  })

  describe('stage independence', () => {
    it('should be callable without other pipeline stages', () => {
      const result = parseAndFix({ command: 'pwd' })
      expect(result).toBeDefined()
      expect(result).toHaveProperty('command')
      expect(result).toHaveProperty('ast')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('wasFix')
      expect(result).toHaveProperty('suggestions')
    })

    it('should have correct type exports', () => {
      const input: ParseInput = { command: 'ls' }
      expect(input).toBeDefined()
    })

    it('should return consistent result structure', () => {
      const commands = ['ls', 'pwd', 'date', 'echo hello']
      for (const cmd of commands) {
        const result = parseAndFix({ command: cmd })
        expect(result).toMatchObject({
          command: expect.any(String),
          ast: expect.anything(),
          errors: expect.any(Array),
          wasFix: expect.any(Boolean),
          suggestions: expect.any(Array),
        })
      }
    })
  })

  describe('AST structure', () => {
    it('should return Program node as AST root', () => {
      const result = parseAndFix({ command: 'ls -la' })
      expect(result.ast?.type).toBe('Program')
    })

    it('should have body array in AST', () => {
      const result = parseAndFix({ command: 'ls; pwd' })
      expect(result.ast?.body).toBeInstanceOf(Array)
    })
  })

  describe('edge cases', () => {
    it('should handle empty command', () => {
      const result = parseAndFix({ command: '' })
      expect(result.errors).toHaveLength(0)
      expect(result.ast).not.toBeNull()
    })

    it('should handle comment-only command', () => {
      const result = parseAndFix({ command: '# comment' })
      expect(result.errors).toHaveLength(0)
    })

    it('should handle whitespace-only command', () => {
      const result = parseAndFix({ command: '   ' })
      expect(result.errors).toHaveLength(0)
    })
  })
})

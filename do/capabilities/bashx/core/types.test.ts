/**
 * Extended Types - Backward Compatibility Tests
 *
 * Tests to verify that type extensions for multi-language support
 * maintain backward compatibility with existing code.
 *
 * All new fields added to Intent, BashResult, etc. are OPTIONAL,
 * ensuring existing code that uses these types continues to work.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import type {
  Intent,
  SupportedLanguage,
  LanguageContext,
} from './types.js'

// Import BashResult from src/types for completeness
import type { BashResult } from '../src/types.js'

describe('Extended Types - Backward Compatibility', () => {
  // ==========================================================================
  // Intent Backward Compatibility (4 tests)
  // ==========================================================================
  describe('Intent Backward Compatibility', () => {
    it('Intent works without language fields', () => {
      // Original Intent interface - all required fields only
      const intent: Intent = {
        commands: ['ls', 'grep'],
        reads: ['/home/user'],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      }

      // Verify all required fields are present and typed correctly
      expect(intent.commands).toEqual(['ls', 'grep'])
      expect(intent.reads).toEqual(['/home/user'])
      expect(intent.writes).toEqual([])
      expect(intent.deletes).toEqual([])
      expect(intent.network).toBe(false)
      expect(intent.elevated).toBe(false)

      // Verify optional fields are undefined (not required)
      expect(intent.languages).toBeUndefined()
      expect(intent.inlineCode).toBeUndefined()
      expect(intent.targetScripts).toBeUndefined()
    })

    it('Intent accepts optional languages array', () => {
      const intent: Intent = {
        commands: ['python', 'pip'],
        reads: [],
        writes: ['output.txt'],
        deletes: [],
        network: false,
        elevated: false,
        languages: ['python'],
      }

      expect(intent.languages).toEqual(['python'])
      expect(intent.languages).toHaveLength(1)
      expect(intent.languages![0]).toBe('python')
    })

    it('Intent accepts optional inlineCode boolean', () => {
      const intent: Intent = {
        commands: ['python'],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
        inlineCode: true,
      }

      expect(intent.inlineCode).toBe(true)
    })

    it('Intent accepts optional targetScripts array', () => {
      const intent: Intent = {
        commands: ['python', 'node'],
        reads: ['script.py', 'app.js'],
        writes: [],
        deletes: [],
        network: true,
        elevated: false,
        targetScripts: ['script.py', 'app.js'],
      }

      expect(intent.targetScripts).toEqual(['script.py', 'app.js'])
      expect(intent.targetScripts).toHaveLength(2)
    })
  })

  // ==========================================================================
  // BashResult Backward Compatibility (3 tests)
  // ==========================================================================
  describe('BashResult Backward Compatibility', () => {
    it('BashResult works without language field', () => {
      // Create minimal BashResult with required fields only
      const result: BashResult = {
        input: 'ls -la',
        valid: true,
        intent: {
          commands: ['ls'],
          reads: ['.'],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        },
        classification: {
          type: 'read',
          impact: 'none',
          reversible: true,
          reason: 'List directory contents',
        },
        command: 'ls -la',
        generated: false,
        stdout: 'file1.txt\nfile2.txt',
        stderr: '',
        exitCode: 0,
      }

      // Verify required fields work
      expect(result.input).toBe('ls -la')
      expect(result.valid).toBe(true)
      expect(result.exitCode).toBe(0)

      // Verify optional language fields are undefined
      expect(result.language).toBeUndefined()
      expect(result.tier).toBeUndefined()
    })

    it('BashResult accepts optional language field', () => {
      const result: BashResult = {
        input: 'python -c "print(42)"',
        valid: true,
        intent: {
          commands: ['python'],
          reads: [],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        },
        classification: {
          type: 'execute',
          impact: 'low',
          reversible: true,
          reason: 'Execute Python code',
        },
        command: 'python -c "print(42)"',
        generated: false,
        stdout: '42',
        stderr: '',
        exitCode: 0,
        language: 'python',
      }

      expect(result.language).toBe('python')
    })

    it('BashResult accepts optional tier field', () => {
      const result: BashResult = {
        input: 'cargo run',
        valid: true,
        intent: {
          commands: ['cargo'],
          reads: ['src/main.rs'],
          writes: ['target/'],
          deletes: [],
          network: false,
          elevated: false,
        },
        classification: {
          type: 'execute',
          impact: 'medium',
          reversible: true,
          reason: 'Compile and run Rust code',
        },
        command: 'cargo run',
        generated: false,
        stdout: 'Hello, world!',
        stderr: '',
        exitCode: 0,
        language: 'rust',
        tier: 3,
      }

      expect(result.tier).toBe(3)
      expect(result.language).toBe('rust')
    })
  })

  // ==========================================================================
  // SupportedLanguage Type (1 test)
  // ==========================================================================
  describe('SupportedLanguage Type', () => {
    it('SupportedLanguage includes all 6 languages', () => {
      // Test that all 6 language strings are valid SupportedLanguage values
      const languages: SupportedLanguage[] = [
        'bash',
        'python',
        'ruby',
        'node',
        'go',
        'rust',
      ]

      expect(languages).toHaveLength(6)

      // Type checking ensures these are all valid SupportedLanguage values
      // If any value wasn't in the union, TypeScript would error at compile time
      expect(languages).toContain('bash')
      expect(languages).toContain('python')
      expect(languages).toContain('ruby')
      expect(languages).toContain('node')
      expect(languages).toContain('go')
      expect(languages).toContain('rust')
    })
  })

  // ==========================================================================
  // LanguageContext Type (2 tests)
  // ==========================================================================
  describe('LanguageContext Type', () => {
    it('LanguageContext requires language, confidence, and method', () => {
      // Minimal LanguageContext with only required fields
      const context: LanguageContext = {
        language: 'python',
        confidence: 0.95,
        method: 'shebang',
      }

      expect(context.language).toBe('python')
      expect(context.confidence).toBe(0.95)
      expect(context.method).toBe('shebang')

      // Optional fields should be undefined
      expect(context.runtime).toBeUndefined()
      expect(context.inline).toBeUndefined()
      expect(context.file).toBeUndefined()
    })

    it('LanguageContext accepts optional runtime/inline/file', () => {
      const context: LanguageContext = {
        language: 'python',
        confidence: 0.90,
        method: 'interpreter',
        runtime: 'python3.11',
        inline: true,
        file: undefined, // explicitly undefined when inline
      }

      expect(context.runtime).toBe('python3.11')
      expect(context.inline).toBe(true)
      expect(context.file).toBeUndefined()

      // Different scenario with file but not inline
      const fileContext: LanguageContext = {
        language: 'ruby',
        confidence: 0.90,
        method: 'interpreter',
        runtime: 'ruby',
        inline: false,
        file: 'script.rb',
      }

      expect(fileContext.file).toBe('script.rb')
      expect(fileContext.inline).toBe(false)
    })
  })
})

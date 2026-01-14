/**
 * formatResult Pipeline Stage Tests (RED phase)
 *
 * Tests for the result formatting pipeline stage that assembles the final
 * BashResult from all previous pipeline stage outputs.
 *
 * These tests document the expected behavior of an independently callable
 * pipeline stage. They are expected to FAIL initially because the module
 * `src/mcp/pipeline/format.ts` does not exist yet.
 *
 * @module test/mcp/pipeline/format.test.ts
 */

import { describe, it, expect } from 'vitest'
import { formatResult } from '../../../src/mcp/pipeline/format.js'
import type { FormatInput, FormatResult } from '../../../src/mcp/pipeline/format.js'
import type { BashResult } from '../../../src/types.js'

describe('formatResult stage', () => {
  describe('successful execution formatting', () => {
    it('should format successful execution result', () => {
      const input: FormatInput = {
        originalInput: 'ls -la',
        classifyResult: {
          type: 'command',
          command: 'ls -la',
          originalInput: 'ls -la',
          wasGenerated: false,
        },
        parseResult: {
          command: 'ls -la',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'read',
            impact: 'none',
            reversible: true,
            reason: 'Directory listing',
          },
          intent: {
            commands: ['ls'],
            reads: ['.'],
            writes: [],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: true,
          stdout: 'file1.txt\nfile2.txt',
          stderr: '',
          exitCode: 0,
        },
      }

      const result = formatResult(input)

      expect(result.valid).toBe(true)
      expect(result.input).toBe('ls -la')
      expect(result.command).toBe('ls -la')
      expect(result.stdout).toBe('file1.txt\nfile2.txt')
      expect(result.exitCode).toBe(0)
      expect(result.generated).toBe(false)
    })

    it('should include classification in result', () => {
      const input: FormatInput = {
        originalInput: 'echo hello',
        classifyResult: {
          type: 'command',
          command: 'echo hello',
          originalInput: 'echo hello',
          wasGenerated: false,
        },
        parseResult: {
          command: 'echo hello',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'read',
            impact: 'none',
            reversible: true,
            reason: 'Echo command',
          },
          intent: {
            commands: ['echo'],
            reads: [],
            writes: [],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: true,
          stdout: 'hello',
          stderr: '',
          exitCode: 0,
        },
      }

      const result = formatResult(input)

      expect(result.classification).toEqual({
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Echo command',
      })
    })

    it('should include intent in result', () => {
      const input: FormatInput = {
        originalInput: 'cat file.txt',
        classifyResult: {
          type: 'command',
          command: 'cat file.txt',
          originalInput: 'cat file.txt',
          wasGenerated: false,
        },
        parseResult: {
          command: 'cat file.txt',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'read',
            impact: 'none',
            reversible: true,
            reason: 'File read',
          },
          intent: {
            commands: ['cat'],
            reads: ['file.txt'],
            writes: [],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: true,
          stdout: 'file content',
          stderr: '',
          exitCode: 0,
        },
      }

      const result = formatResult(input)

      expect(result.intent.reads).toContain('file.txt')
      expect(result.intent.commands).toContain('cat')
    })
  })

  describe('blocked execution formatting', () => {
    it('should format blocked result', () => {
      const input: FormatInput = {
        originalInput: 'rm -rf /',
        classifyResult: {
          type: 'command',
          command: 'rm -rf /',
          originalInput: 'rm -rf /',
          wasGenerated: false,
        },
        parseResult: {
          command: 'rm -rf /',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'delete',
            impact: 'critical',
            reversible: false,
            reason: 'Root filesystem deletion',
          },
          intent: {
            commands: ['rm'],
            reads: [],
            writes: [],
            deletes: ['/'],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: false,
          blocked: true,
          blockReason: 'Critical operation blocked',
        },
      }

      const result = formatResult(input)

      expect(result.valid).toBe(true) // Command is syntactically valid
      expect(result.blocked).toBe(true)
      expect(result.classification.impact).toBe('critical')
    })

    it('should include block reason in result', () => {
      const input: FormatInput = {
        originalInput: 'dd if=/dev/zero of=/dev/sda',
        classifyResult: {
          type: 'command',
          command: 'dd if=/dev/zero of=/dev/sda',
          originalInput: 'dd if=/dev/zero of=/dev/sda',
          wasGenerated: false,
        },
        parseResult: {
          command: 'dd if=/dev/zero of=/dev/sda',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'system',
            impact: 'critical',
            reversible: false,
            reason: 'Disk overwrite',
            suggestion: 'Use a file instead of device',
          },
          intent: {
            commands: ['dd'],
            reads: ['/dev/zero'],
            writes: ['/dev/sda'],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: false,
          blocked: true,
          blockReason: 'Dangerous disk operation blocked',
        },
      }

      const result = formatResult(input)

      expect(result.errors?.[0]?.message).toContain('blocked')
      expect(result.suggestion).toBeDefined()
    })
  })

  describe('generated command formatting', () => {
    it('should mark generated commands', () => {
      const input: FormatInput = {
        originalInput: 'list all files',
        classifyResult: {
          type: 'intent',
          command: 'ls -la',
          originalInput: 'list all files',
          wasGenerated: true,
        },
        parseResult: {
          command: 'ls -la',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'read',
            impact: 'none',
            reversible: true,
            reason: 'Directory listing',
          },
          intent: {
            commands: ['ls'],
            reads: ['.'],
            writes: [],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: true,
          stdout: 'file list',
          stderr: '',
          exitCode: 0,
        },
      }

      const result = formatResult(input)

      expect(result.generated).toBe(true)
      expect(result.input).toBe('list all files')
      expect(result.command).toBe('ls -la')
    })
  })

  describe('parse error formatting', () => {
    it('should include parse errors in result', () => {
      const input: FormatInput = {
        originalInput: 'if then fi',
        classifyResult: {
          type: 'command',
          command: 'if then fi',
          originalInput: 'if then fi',
          wasGenerated: false,
        },
        parseResult: {
          command: 'if then fi',
          ast: null,
          errors: ['Syntax error: unexpected then'],
          wasFix: false,
          suggestions: ['Check if-then-else syntax'],
        },
        safetyResult: {
          classification: {
            type: 'read',
            impact: 'none',
            reversible: true,
            reason: 'Parse failed',
          },
          intent: {
            commands: [],
            reads: [],
            writes: [],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: false,
          blocked: true,
          blockReason: 'Syntax error',
        },
      }

      const result = formatResult(input)

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.length).toBeGreaterThan(0)
    })

    it('should include fix suggestions', () => {
      const input: FormatInput = {
        originalInput: 'echo "unclosed',
        classifyResult: {
          type: 'command',
          command: 'echo "unclosed',
          originalInput: 'echo "unclosed',
          wasGenerated: false,
        },
        parseResult: {
          command: 'echo "unclosed"',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: true,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'read',
            impact: 'none',
            reversible: true,
            reason: 'Echo command',
          },
          intent: {
            commands: ['echo'],
            reads: [],
            writes: [],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: true,
          stdout: 'unclosed',
          stderr: '',
          exitCode: 0,
        },
      }

      const result = formatResult(input)

      expect(result.fixed).toBe(true)
      expect(result.command).toBe('echo "unclosed"')
    })
  })

  describe('stage independence', () => {
    it('should be callable without other pipeline stages', () => {
      const input: FormatInput = {
        originalInput: 'pwd',
        classifyResult: {
          type: 'command',
          command: 'pwd',
          originalInput: 'pwd',
          wasGenerated: false,
        },
        parseResult: {
          command: 'pwd',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'read',
            impact: 'none',
            reversible: true,
            reason: 'Working directory',
          },
          intent: {
            commands: ['pwd'],
            reads: [],
            writes: [],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: true,
          stdout: '/home/user',
          stderr: '',
          exitCode: 0,
        },
      }

      const result = formatResult(input)

      expect(result).toBeDefined()
      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('command')
    })

    it('should have correct type exports', () => {
      const minimalInput: FormatInput = {
        originalInput: 'test',
        classifyResult: {
          type: 'command',
          command: 'test',
          originalInput: 'test',
          wasGenerated: false,
        },
        parseResult: {
          command: 'test',
          ast: null,
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: { type: 'read', impact: 'none', reversible: true, reason: '' },
          intent: { commands: [], reads: [], writes: [], deletes: [], network: false, elevated: false },
        },
        executeResult: { executed: true, stdout: '', stderr: '', exitCode: 0 },
      }
      expect(minimalInput).toBeDefined()
    })

    it('should return BashResult type', () => {
      const input: FormatInput = {
        originalInput: 'date',
        classifyResult: {
          type: 'command',
          command: 'date',
          originalInput: 'date',
          wasGenerated: false,
        },
        parseResult: {
          command: 'date',
          ast: { type: 'Program', body: [] },
          errors: [],
          wasFix: false,
          suggestions: [],
        },
        safetyResult: {
          classification: {
            type: 'read',
            impact: 'none',
            reversible: true,
            reason: 'Date command',
          },
          intent: {
            commands: ['date'],
            reads: [],
            writes: [],
            deletes: [],
            network: false,
            elevated: false,
          },
        },
        executeResult: {
          executed: true,
          stdout: '2024-01-01',
          stderr: '',
          exitCode: 0,
        },
      }

      const result: BashResult = formatResult(input)

      expect(result.input).toBe('date')
      expect(result.valid).toBe(true)
      expect(result.classification).toBeDefined()
      expect(result.intent).toBeDefined()
    })
  })
})

/**
 * isExecError Type Guard Tests
 *
 * Tests to verify the isExecError type guard correctly identifies
 * ExecError objects from child_process exec.
 *
 * An ExecError extends Error with additional properties:
 * - code?: number (exit code from the process)
 * - killed?: boolean (whether the process was killed)
 * - stdout?: Buffer | string (standard output captured before error)
 * - stderr?: Buffer | string (standard error captured)
 */

import { describe, it, expect } from 'vitest'
import { isExecError, type ExecError } from '../../src/execute.js'

describe('isExecError Type Guard', () => {
  describe('Valid ExecError objects', () => {
    it('should return true for Error with code, stdout, stderr properties', () => {
      const execError = Object.assign(new Error('Command failed: ls'), {
        code: 1,
        killed: false,
        stdout: 'partial output',
        stderr: 'ls: invalid option\n',
      })

      expect(isExecError(execError)).toBe(true)
    })

    it('should return true for Error with Buffer stdout/stderr', () => {
      const execError = Object.assign(new Error('Command failed'), {
        code: 127,
        killed: false,
        stdout: Buffer.from('output'),
        stderr: Buffer.from('command not found'),
      })

      expect(isExecError(execError)).toBe(true)
    })

    it('should return true for killed process (code undefined)', () => {
      const killedError = Object.assign(new Error('Process killed'), {
        code: undefined,
        killed: true,
        stdout: '',
        stderr: '',
      })

      expect(isExecError(killedError)).toBe(true)
    })

    it('should return true for timeout error with killed=true', () => {
      const timeoutError = Object.assign(new Error('Command timed out'), {
        code: undefined,
        killed: true,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      })

      expect(isExecError(timeoutError)).toBe(true)
    })

    it('should return true for Error with only required exec properties', () => {
      // Minimal ExecError - just needs to be Error with at least one exec property
      const minimalError = Object.assign(new Error('exec error'), {
        code: 1,
      })

      expect(isExecError(minimalError)).toBe(true)
    })

    it('should return true for Error with killed property only', () => {
      const killedOnlyError = Object.assign(new Error('killed'), {
        killed: true,
      })

      expect(isExecError(killedOnlyError)).toBe(true)
    })
  })

  describe('Invalid inputs - should return false', () => {
    it('should return false for plain Error without exec properties', () => {
      const plainError = new Error('Something went wrong')

      expect(isExecError(plainError)).toBe(false)
    })

    it('should return false for TypeError', () => {
      const typeError = new TypeError('Invalid type')

      expect(isExecError(typeError)).toBe(false)
    })

    it('should return false for RangeError', () => {
      const rangeError = new RangeError('Value out of range')

      expect(isExecError(rangeError)).toBe(false)
    })

    it('should return false for SyntaxError', () => {
      const syntaxError = new SyntaxError('Invalid syntax')

      expect(isExecError(syntaxError)).toBe(false)
    })

    it('should return false for null', () => {
      expect(isExecError(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isExecError(undefined)).toBe(false)
    })

    it('should return false for strings', () => {
      expect(isExecError('error message')).toBe(false)
    })

    it('should return false for numbers', () => {
      expect(isExecError(42)).toBe(false)
      expect(isExecError(1)).toBe(false)
    })

    it('should return false for plain objects (not Error instances)', () => {
      const fakeExecError = {
        code: 1,
        stdout: 'output',
        stderr: 'error',
        message: 'fake error',
        name: 'Error',
      }

      expect(isExecError(fakeExecError)).toBe(false)
    })

    it('should return false for objects with only message property', () => {
      const messageOnly = { message: 'just a message' }

      expect(isExecError(messageOnly)).toBe(false)
    })

    it('should return false for arrays', () => {
      expect(isExecError([])).toBe(false)
      expect(isExecError([new Error('in array')])).toBe(false)
    })

    it('should return false for functions', () => {
      expect(isExecError(() => {})).toBe(false)
    })

    it('should return false for boolean values', () => {
      expect(isExecError(true)).toBe(false)
      expect(isExecError(false)).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('should return false for Error with wrong property types', () => {
      // code should be number, not string
      const wrongTypeError = Object.assign(new Error('wrong types'), {
        code: 'not a number',
        killed: 'not a boolean',
      })

      expect(isExecError(wrongTypeError)).toBe(false)
    })

    it('should return true for Error with code=0 (success case in error context)', () => {
      // This can happen with exec when there's stderr output but exit code 0
      const exitZeroError = Object.assign(new Error('Has stderr but succeeded'), {
        code: 0,
        killed: false,
        stdout: 'output',
        stderr: 'warning message',
      })

      expect(isExecError(exitZeroError)).toBe(true)
    })

    it('should return true for Error with negative exit code', () => {
      // Some systems can return negative exit codes
      const negativeCodeError = Object.assign(new Error('Negative exit'), {
        code: -1,
        killed: false,
        stdout: '',
        stderr: 'error',
      })

      expect(isExecError(negativeCodeError)).toBe(true)
    })

    it('should return false for Error subclass without exec properties', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }

      const customError = new CustomError('custom')
      expect(isExecError(customError)).toBe(false)
    })

    it('should return true for Error subclass with exec properties', () => {
      class CustomError extends Error {
        code: number
        killed: boolean
        stdout: string
        stderr: string

        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
          this.code = 1
          this.killed = false
          this.stdout = ''
          this.stderr = 'error output'
        }
      }

      const customExecError = new CustomError('custom exec error')
      expect(isExecError(customExecError)).toBe(true)
    })

    it('should return true for empty string stdout/stderr', () => {
      const emptyOutputError = Object.assign(new Error('Empty output'), {
        code: 1,
        killed: false,
        stdout: '',
        stderr: '',
      })

      expect(isExecError(emptyOutputError)).toBe(true)
    })

    it('should return true for empty Buffer stdout/stderr', () => {
      const emptyBufferError = Object.assign(new Error('Empty buffers'), {
        code: 1,
        killed: false,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      })

      expect(isExecError(emptyBufferError)).toBe(true)
    })
  })

  describe('Type narrowing', () => {
    it('should allow accessing ExecError properties after type guard', () => {
      const error: unknown = Object.assign(new Error('Test'), {
        code: 42,
        killed: false,
        stdout: 'output',
        stderr: 'error',
      })

      if (isExecError(error)) {
        // TypeScript should now know error is ExecError
        expect(error.code).toBe(42)
        expect(error.killed).toBe(false)
        expect(error.stdout).toBe('output')
        expect(error.stderr).toBe('error')
        expect(error.message).toBe('Test')
      } else {
        throw new Error('Should have been identified as ExecError')
      }
    })

    it('should correctly narrow type for conditional handling', () => {
      const maybeExecError: unknown = new Error('Plain error')

      if (isExecError(maybeExecError)) {
        // Should not reach here
        expect.fail('Plain error should not be identified as ExecError')
      } else {
        // Should reach here
        expect(maybeExecError).toBeInstanceOf(Error)
      }
    })
  })
})

describe('isExecError in execute() context', () => {
  it('should properly extract exec error properties in catch blocks', async () => {
    // This tests the real-world usage pattern in execute()
    const simulatedExecError = Object.assign(new Error('Command failed: invalid'), {
      code: 127,
      killed: false,
      stdout: '',
      stderr: 'command not found',
    })

    // Simulate the pattern used in execute.ts
    const handleError = (error: unknown): { exitCode: number; stderr: string } => {
      const execError = isExecError(error) ? error : null

      return {
        exitCode: execError?.code ?? 1,
        stderr: execError?.stderr?.toString() ?? (error instanceof Error ? error.message : 'Unknown error'),
      }
    }

    const result = handleError(simulatedExecError)
    expect(result.exitCode).toBe(127)
    expect(result.stderr).toBe('command not found')
  })

  it('should handle non-exec errors gracefully', () => {
    const regularError = new Error('Network timeout')

    const handleError = (error: unknown): { exitCode: number; stderr: string } => {
      const execError = isExecError(error) ? error : null

      return {
        exitCode: execError?.code ?? 1,
        stderr: execError?.stderr?.toString() ?? (error instanceof Error ? error.message : 'Unknown error'),
      }
    }

    const result = handleError(regularError)
    expect(result.exitCode).toBe(1) // Default exit code
    expect(result.stderr).toBe('Network timeout') // Falls back to error.message
  })
})

/**
 * System Utility Commands Tests
 *
 * Comprehensive tests for system utility commands:
 * - sleep: Delay execution
 * - yes: Output string repeatedly
 * - seq: Generate number sequences
 * - pwd: Print working directory
 * - whoami: Print current username
 * - hostname: Print system hostname
 * - printenv: Print environment variables
 *
 * @module bashx/do/commands/system-utils.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  executeSleep,
  executeYes,
  executeSeq,
  executePwd,
  executeWhoami,
  executeHostname,
  executePrintenv,
  executeSystemUtils,
  parseDuration,
  SYSTEM_UTILS_COMMANDS,
  isSystemUtilsCommand,
} from './system-utils.js'

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

describe('parseDuration', () => {
  it('parses seconds (default unit)', () => {
    expect(parseDuration('5')).toBe(5000)
    expect(parseDuration('5s')).toBe(5000)
  })

  it('parses fractional seconds', () => {
    expect(parseDuration('0.5')).toBe(500)
    expect(parseDuration('1.5s')).toBe(1500)
    expect(parseDuration('0.001s')).toBe(1)
  })

  it('parses minutes', () => {
    expect(parseDuration('1m')).toBe(60000)
    expect(parseDuration('2m')).toBe(120000)
  })

  it('parses hours', () => {
    expect(parseDuration('1h')).toBe(3600000)
    expect(parseDuration('2h')).toBe(7200000)
  })

  it('parses days', () => {
    expect(parseDuration('1d')).toBe(86400000)
  })

  it('parses infinity', () => {
    expect(parseDuration('infinity')).toBe(Infinity)
    expect(parseDuration('INFINITY')).toBe(Infinity)
  })

  it('throws on invalid duration', () => {
    expect(() => parseDuration('abc')).toThrow('Invalid duration')
    expect(() => parseDuration('')).toThrow('Invalid duration')
    expect(() => parseDuration('-5')).toThrow('Invalid duration')
    expect(() => parseDuration('5x')).toThrow('Invalid duration')
  })
})

describe('SYSTEM_UTILS_COMMANDS', () => {
  it('contains all expected commands', () => {
    const expected = ['sleep', 'yes', 'seq', 'pwd', 'whoami', 'hostname', 'printenv']
    for (const cmd of expected) {
      expect(SYSTEM_UTILS_COMMANDS.has(cmd)).toBe(true)
    }
  })

  it('isSystemUtilsCommand returns true for valid commands', () => {
    expect(isSystemUtilsCommand('sleep')).toBe(true)
    expect(isSystemUtilsCommand('yes')).toBe(true)
    expect(isSystemUtilsCommand('seq')).toBe(true)
    expect(isSystemUtilsCommand('pwd')).toBe(true)
    expect(isSystemUtilsCommand('whoami')).toBe(true)
    expect(isSystemUtilsCommand('hostname')).toBe(true)
    expect(isSystemUtilsCommand('printenv')).toBe(true)
  })

  it('isSystemUtilsCommand returns false for invalid commands', () => {
    expect(isSystemUtilsCommand('cat')).toBe(false)
    expect(isSystemUtilsCommand('ls')).toBe(false)
    expect(isSystemUtilsCommand('unknown')).toBe(false)
  })
})

// ============================================================================
// SLEEP COMMAND TESTS
// ============================================================================

describe('sleep command', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sleeps for the specified duration in seconds', async () => {
    const promise = executeSleep(['0.1'])
    vi.advanceTimersByTime(100)
    const result = await promise

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('sleeps with fractional seconds', async () => {
    const promise = executeSleep(['0.05'])
    vi.advanceTimersByTime(50)
    const result = await promise

    expect(result.exitCode).toBe(0)
  })

  it('sleeps with minute suffix', async () => {
    const promise = executeSleep(['0.001m']) // 0.06 seconds
    vi.advanceTimersByTime(60)
    const result = await promise

    expect(result.exitCode).toBe(0)
  })

  it('sums multiple duration arguments', async () => {
    const promise = executeSleep(['0.05', '0.05'])
    vi.advanceTimersByTime(100)
    const result = await promise

    expect(result.exitCode).toBe(0)
  })

  it('returns error for missing operand', async () => {
    const result = await executeSleep([])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('sleep: missing operand')
  })

  it('returns error for invalid duration', async () => {
    const result = await executeSleep(['invalid'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('sleep:')
  })

  it('returns error for infinity (not supported)', async () => {
    const result = await executeSleep(['infinity'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('cannot sleep indefinitely')
  })

  it('applies maxDuration safety limit', async () => {
    const promise = executeSleep(['10'], { maxDuration: 100 })
    vi.advanceTimersByTime(100)
    const result = await promise

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// YES COMMAND TESTS
// ============================================================================

describe('yes command', () => {
  it('outputs "y" repeatedly by default', () => {
    const result = executeYes([])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.split('\n').filter(l => l === 'y').length).toBe(1000)
  })

  it('outputs specified string repeatedly', () => {
    const result = executeYes(['hello'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.split('\n').filter(l => l === 'hello').length).toBe(1000)
  })

  it('joins multiple arguments with space', () => {
    const result = executeYes(['hello', 'world'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.split('\n').filter(l => l === 'hello world').length).toBe(1000)
  })

  it('respects maxLines option', () => {
    const result = executeYes(['test'], { maxLines: 5 })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('test\ntest\ntest\ntest\ntest\n')
  })

  it('handles empty string argument', () => {
    const result = executeYes([''], { maxLines: 3 })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('\n\n\n')
  })
})

// ============================================================================
// SEQ COMMAND TESTS
// ============================================================================

describe('seq command', () => {
  describe('basic sequences', () => {
    it('generates sequence from 1 to N', () => {
      const result = executeSeq(['5'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('1\n2\n3\n4\n5\n')
    })

    it('generates sequence from first to last', () => {
      const result = executeSeq(['3', '7'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('3\n4\n5\n6\n7\n')
    })

    it('generates sequence with custom increment', () => {
      const result = executeSeq(['1', '2', '10'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('1\n3\n5\n7\n9\n')
    })

    it('generates descending sequence', () => {
      const result = executeSeq(['5', '-1', '1'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('5\n4\n3\n2\n1\n')
    })

    it('handles negative numbers', () => {
      const result = executeSeq(['-3', '3'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('-3\n-2\n-1\n0\n1\n2\n3\n')
    })
  })

  describe('floating point', () => {
    it('generates sequence with floating point numbers', () => {
      const result = executeSeq(['0.5', '0.5', '2.0'])

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines).toEqual(['0.5', '1.0', '1.5', '2.0'])
    })

    it('handles small increments', () => {
      const result = executeSeq(['0', '0.5', '1.5'])

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      // 0, 0.5, 1.0, 1.5 = 4 numbers
      expect(lines.length).toBe(4)
      expect(lines).toEqual(['0.0', '0.5', '1.0', '1.5'])
    })
  })

  describe('options', () => {
    it('uses custom separator', () => {
      const result = executeSeq(['1', '3'], { separator: ', ' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('1, 2, 3\n')
    })

    it('uses equal-width padding', () => {
      const result = executeSeq(['8', '11'], { equalWidth: true })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('08\n09\n10\n11\n')
    })

    it('uses format string', () => {
      const result = executeSeq(['1', '3'], { format: '%02.0f' })

      expect(result.exitCode).toBe(0)
      // Format string support is basic
      const lines = result.stdout.trim().split('\n')
      expect(lines.length).toBe(3)
    })
  })

  describe('error handling', () => {
    it('returns error for missing operand', () => {
      const result = executeSeq([])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('seq: missing operand')
    })

    it('returns error for zero increment', () => {
      const result = executeSeq(['1', '0', '5'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Zero increment')
    })

    it('returns error for invalid number', () => {
      const result = executeSeq(['abc'])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('invalid')
    })

    it('returns empty output for impossible range', () => {
      const result = executeSeq(['5', '1', '1']) // Can't go from 5 to 1 with positive increment

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    })
  })
})

// ============================================================================
// PWD COMMAND TESTS
// ============================================================================

describe('pwd command', () => {
  it('returns current working directory from context', () => {
    const result = executePwd([], { cwd: '/home/user' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('/home/user\n')
  })

  it('returns root when no cwd specified', () => {
    const result = executePwd([], {})

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('/\n')
  })

  it('handles -L flag (logical path)', () => {
    const result = executePwd(['-L'], { cwd: '/home/user/../user' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('/home/user/../user\n')
  })

  it('handles -P flag (physical path)', () => {
    const result = executePwd(['-P'], { cwd: '/home/user/../user' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('/home/user\n')
  })

  it('normalizes path with -P flag', () => {
    const result = executePwd(['-P'], { cwd: '/home/./user/../admin' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('/home/admin\n')
  })

  it('handles multiple flags (last wins)', () => {
    const result = executePwd(['-P', '-L'], { cwd: '/home/user/../user' })

    expect(result.exitCode).toBe(0)
    // -L wins as it's last
    expect(result.stdout).toBe('/home/user/../user\n')
  })

  it('returns error for invalid option', () => {
    const result = executePwd(['-x'], { cwd: '/home/user' })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('invalid option')
  })
})

// ============================================================================
// WHOAMI COMMAND TESTS
// ============================================================================

describe('whoami command', () => {
  it('returns user from context', () => {
    const result = executeWhoami([], { user: 'alice' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('alice\n')
  })

  it('returns USER from environment', () => {
    const result = executeWhoami([], { env: { USER: 'bob' } })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('bob\n')
  })

  it('returns LOGNAME from environment when USER not set', () => {
    const result = executeWhoami([], { env: { LOGNAME: 'charlie' } })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('charlie\n')
  })

  it('returns USERNAME from environment (Windows compatibility)', () => {
    const result = executeWhoami([], { env: { USERNAME: 'dave' } })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('dave\n')
  })

  it('prefers context.user over environment', () => {
    const result = executeWhoami([], { user: 'context', env: { USER: 'env' } })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('context\n')
  })

  it('returns default "worker" when no user found', () => {
    const result = executeWhoami([], {})

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('worker\n')
  })

  it('ignores arguments', () => {
    const result = executeWhoami(['ignored', 'args'], { user: 'alice' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('alice\n')
  })
})

// ============================================================================
// HOSTNAME COMMAND TESTS
// ============================================================================

describe('hostname command', () => {
  it('returns hostname from context', () => {
    const result = executeHostname([], { hostname: 'server.example.com.ai' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('server.example.com.ai\n')
  })

  it('returns HOSTNAME from environment', () => {
    const result = executeHostname([], { env: { HOSTNAME: 'env-host.local' } })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('env-host.local\n')
  })

  it('returns HOST from environment when HOSTNAME not set', () => {
    const result = executeHostname([], { env: { HOST: 'alt-host.local' } })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('alt-host.local\n')
  })

  it('returns default hostname when none set', () => {
    const result = executeHostname([], {})

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('worker.local\n')
  })

  it('handles -s flag for short hostname', () => {
    const result = executeHostname(['-s'], { hostname: 'server.example.com.ai' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('server\n')
  })

  it('handles --short flag', () => {
    const result = executeHostname(['--short'], { hostname: 'server.example.com.ai' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('server\n')
  })

  it('handles -f flag for full hostname', () => {
    const result = executeHostname(['-f'], { hostname: 'server.example.com.ai' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('server.example.com.ai\n')
  })

  it('handles --fqdn flag', () => {
    const result = executeHostname(['--fqdn'], { hostname: 'server.example.com.ai' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('server.example.com.ai\n')
  })

  it('handles --long flag', () => {
    const result = executeHostname(['--long'], { hostname: 'server.example.com.ai' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('server.example.com.ai\n')
  })

  it('returns full hostname when no dots present with -s', () => {
    const result = executeHostname(['-s'], { hostname: 'localhost' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('localhost\n')
  })

  it('returns error for invalid option', () => {
    const result = executeHostname(['-x'], { hostname: 'server.local' })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('invalid option')
  })
})

// ============================================================================
// PRINTENV COMMAND TESTS
// ============================================================================

describe('printenv command', () => {
  describe('printing all variables', () => {
    it('prints all environment variables', () => {
      const result = executePrintenv([], {
        env: { FOO: 'bar', BAZ: 'qux', ABC: '123' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('FOO=bar')
      expect(result.stdout).toContain('BAZ=qux')
      expect(result.stdout).toContain('ABC=123')
    })

    it('sorts variables alphabetically', () => {
      const result = executePrintenv([], {
        env: { ZZZ: '1', AAA: '2', MMM: '3' },
      })

      expect(result.exitCode).toBe(0)
      const lines = result.stdout.trim().split('\n')
      expect(lines[0]).toBe('AAA=2')
      expect(lines[1]).toBe('MMM=3')
      expect(lines[2]).toBe('ZZZ=1')
    })

    it('returns empty output when no variables', () => {
      const result = executePrintenv([], { env: {} })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
    })

    it('skips undefined values', () => {
      const result = executePrintenv([], {
        env: { FOO: 'bar', BAZ: undefined, QUX: 'test' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('FOO=bar')
      expect(result.stdout).toContain('QUX=test')
      expect(result.stdout).not.toContain('BAZ')
    })
  })

  describe('printing specific variables', () => {
    it('prints single variable value', () => {
      const result = executePrintenv(['FOO'], {
        env: { FOO: 'bar', BAZ: 'qux' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('bar\n')
    })

    it('prints multiple variable values', () => {
      const result = executePrintenv(['FOO', 'BAZ'], {
        env: { FOO: 'bar', BAZ: 'qux', OTHER: 'test' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('bar\nqux\n')
    })

    it('returns exit code 1 when variable not found', () => {
      const result = executePrintenv(['MISSING'], {
        env: { FOO: 'bar' },
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
    })

    it('returns exit code 1 when any variable not found', () => {
      const result = executePrintenv(['FOO', 'MISSING'], {
        env: { FOO: 'bar' },
      })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('bar\n')
    })

    it('handles empty string values', () => {
      const result = executePrintenv(['EMPTY'], {
        env: { EMPTY: '' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('\n')
    })
  })

  describe('options', () => {
    it('handles -0 flag for null separator', () => {
      const result = executePrintenv(['FOO', 'BAZ'], {
        env: { FOO: 'bar', BAZ: 'qux' },
      }, { null: true })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('bar\0qux\0')
    })

    it('handles --null flag', () => {
      const result = executePrintenv([], {
        env: { FOO: 'bar' },
      }, { null: true })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('FOO=bar\0')
    })
  })
})

// ============================================================================
// UNIFIED EXECUTOR TESTS
// ============================================================================

describe('executeSystemUtils', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null for unknown commands', async () => {
    const result = await executeSystemUtils('unknown', [], {})
    expect(result).toBeNull()
  })

  it('executes sleep command', async () => {
    const promise = executeSystemUtils('sleep', ['0.01'], {})
    vi.advanceTimersByTime(10)
    const result = await promise

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
  })

  it('executes yes command', async () => {
    const result = await executeSystemUtils('yes', ['test'], {})

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toContain('test')
  })

  it('executes seq command', async () => {
    const result = await executeSystemUtils('seq', ['3'], {})

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toBe('1\n2\n3\n')
  })

  it('executes seq with options via unified executor', async () => {
    const result = await executeSystemUtils('seq', ['-s', ' ', '3'], {})

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toBe('1 2 3\n')
  })

  it('executes seq with -w option', async () => {
    const result = await executeSystemUtils('seq', ['-w', '8', '11'], {})

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toBe('08\n09\n10\n11\n')
  })

  it('executes pwd command', async () => {
    const result = await executeSystemUtils('pwd', [], { cwd: '/test/dir' })

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toBe('/test/dir\n')
  })

  it('executes whoami command', async () => {
    const result = await executeSystemUtils('whoami', [], { user: 'testuser' })

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toBe('testuser\n')
  })

  it('executes hostname command', async () => {
    const result = await executeSystemUtils('hostname', [], { hostname: 'test.local' })

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toBe('test.local\n')
  })

  it('executes printenv command', async () => {
    const result = await executeSystemUtils('printenv', ['TEST'], {
      env: { TEST: 'value' },
    })

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toBe('value\n')
  })
})

// ============================================================================
// EDGE CASES AND INTEGRATION
// ============================================================================

describe('edge cases', () => {
  describe('seq edge cases', () => {
    it('handles very large sequences with safety limit', () => {
      // This would normally create 1 million numbers
      const result = executeSeq(['1', '1000000'])

      expect(result.exitCode).toBe(0)
      // Should be limited to 100000 by safety
      const lines = result.stdout.trim().split('\n')
      expect(lines.length).toBeLessThanOrEqual(100000)
    })

    it('handles single number 1', () => {
      const result = executeSeq(['1'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('1\n')
    })

    it('handles negative increment', () => {
      const result = executeSeq(['10', '-2', '2'])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('10\n8\n6\n4\n2\n')
    })
  })

  describe('printenv edge cases', () => {
    it('handles variables with equals sign in value', () => {
      const result = executePrintenv([], {
        env: { FOO: 'bar=baz' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('FOO=bar=baz\n')
    })

    it('handles variables with newlines in value', () => {
      const result = executePrintenv(['MULTI'], {
        env: { MULTI: 'line1\nline2' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('line1\nline2\n')
    })

    it('handles variables with special characters', () => {
      const result = executePrintenv(['SPECIAL'], {
        env: { SPECIAL: '!@#$%^&*()' },
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('!@#$%^&*()\n')
    })
  })

  describe('pwd edge cases', () => {
    it('handles root directory', () => {
      const result = executePwd([], { cwd: '/' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('/\n')
    })

    it('handles complex path normalization', () => {
      const result = executePwd(['-P'], { cwd: '/a/b/../c/./d/../e' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('/a/c/e\n')
    })
  })

  describe('hostname edge cases', () => {
    it('handles hostname with multiple dots', () => {
      const result = executeHostname(['-s'], { hostname: 'host.sub.domain.tld' })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('host\n')
    })
  })
})

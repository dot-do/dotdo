/**
 * POSIX Shell Utilities Tests
 *
 * Comprehensive POSIX compliance tests for shell utility commands.
 * Tests cover basic operations, common flags per POSIX spec, error cases, and exit codes.
 *
 * Reference: POSIX.1-2024 (IEEE Std 1003.1-2024)
 * https://pubs.opengroup.org/onlinepubs/9799919799/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestContext, type TestContext } from '../helpers/index'

describe('POSIX Shell Utilities', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  // ============================================================================
  // basename - Return non-directory portion of a pathname
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/basename.html
  // ============================================================================
  describe('basename', () => {
    it('extracts filename from path', async () => {
      const result = await ctx.exec('basename /usr/local/bin/script.sh')
      expect(result.stdout.trim()).toBe('script.sh')
      expect(result.exitCode).toBe(0)
    })

    it('handles path with no directory component', async () => {
      const result = await ctx.exec('basename file.txt')
      expect(result.stdout.trim()).toBe('file.txt')
      expect(result.exitCode).toBe(0)
    })

    it('removes trailing slashes before processing', async () => {
      const result = await ctx.exec('basename /path/to/dir/')
      expect(result.stdout.trim()).toBe('dir')
      expect(result.exitCode).toBe(0)
    })

    it('removes suffix when provided', async () => {
      const result = await ctx.exec('basename /path/to/file.txt .txt')
      expect(result.stdout.trim()).toBe('file')
      expect(result.exitCode).toBe(0)
    })

    it('does not remove suffix if it does not match', async () => {
      const result = await ctx.exec('basename /path/to/file.txt .sh')
      expect(result.stdout.trim()).toBe('file.txt')
      expect(result.exitCode).toBe(0)
    })

    it('handles root path', async () => {
      const result = await ctx.exec('basename /')
      expect(result.stdout.trim()).toBe('/')
      expect(result.exitCode).toBe(0)
    })

    it('handles relative paths', async () => {
      const result = await ctx.exec('basename ./relative/path/file.txt')
      expect(result.stdout.trim()).toBe('file.txt')
      expect(result.exitCode).toBe(0)
    })

    it('handles paths with only slashes', async () => {
      const result = await ctx.exec('basename ///')
      expect(result.stdout.trim()).toBe('/')
      expect(result.exitCode).toBe(0)
    })

    it('handles dot paths', async () => {
      const result = await ctx.exec('basename .')
      expect(result.stdout.trim()).toBe('.')
      expect(result.exitCode).toBe(0)
    })

    it('handles double dot paths', async () => {
      const result = await ctx.exec('basename ..')
      expect(result.stdout.trim()).toBe('..')
      expect(result.exitCode).toBe(0)
    })

    it('handles hidden files', async () => {
      const result = await ctx.exec('basename /path/to/.hidden')
      expect(result.stdout.trim()).toBe('.hidden')
      expect(result.exitCode).toBe(0)
    })

    it('does not remove suffix that equals entire basename', async () => {
      const result = await ctx.exec('basename /path/to/file file')
      expect(result.stdout.trim()).toBe('file')
      expect(result.exitCode).toBe(0)
    })

    it('handles path with multiple slashes', async () => {
      const result = await ctx.exec('basename /path//to///file.txt')
      expect(result.stdout.trim()).toBe('file.txt')
      expect(result.exitCode).toBe(0)
    })

    it('handles empty suffix', async () => {
      const result = await ctx.exec('basename /path/to/file.txt ""')
      expect(result.stdout.trim()).toBe('file.txt')
      expect(result.exitCode).toBe(0)
    })
  })

  // ============================================================================
  // dirname - Return the directory portion of a pathname
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/dirname.html
  // ============================================================================
  describe('dirname', () => {
    it('extracts directory from path', async () => {
      const result = await ctx.exec('dirname /usr/local/bin/script.sh')
      expect(result.stdout.trim()).toBe('/usr/local/bin')
      expect(result.exitCode).toBe(0)
    })

    it('returns dot for path with no directory component', async () => {
      const result = await ctx.exec('dirname file.txt')
      expect(result.stdout.trim()).toBe('.')
      expect(result.exitCode).toBe(0)
    })

    it('removes trailing slashes from path', async () => {
      const result = await ctx.exec('dirname /path/to/dir/')
      expect(result.stdout.trim()).toBe('/path/to')
      expect(result.exitCode).toBe(0)
    })

    it('handles root path', async () => {
      const result = await ctx.exec('dirname /')
      expect(result.stdout.trim()).toBe('/')
      expect(result.exitCode).toBe(0)
    })

    it('handles paths with only slashes', async () => {
      const result = await ctx.exec('dirname ///')
      expect(result.stdout.trim()).toBe('/')
      expect(result.exitCode).toBe(0)
    })

    it('handles relative paths', async () => {
      const result = await ctx.exec('dirname ./relative/path/file.txt')
      expect(result.stdout.trim()).toBe('./relative/path')
      expect(result.exitCode).toBe(0)
    })

    it('handles single component path', async () => {
      const result = await ctx.exec('dirname usr')
      expect(result.stdout.trim()).toBe('.')
      expect(result.exitCode).toBe(0)
    })

    it('handles dot path', async () => {
      const result = await ctx.exec('dirname .')
      expect(result.stdout.trim()).toBe('.')
      expect(result.exitCode).toBe(0)
    })

    it('handles double dot path', async () => {
      const result = await ctx.exec('dirname ..')
      expect(result.stdout.trim()).toBe('.')
      expect(result.exitCode).toBe(0)
    })

    it('handles path with multiple slashes', async () => {
      const result = await ctx.exec('dirname /path//to///file.txt')
      expect(result.stdout.trim()).toBe('/path//to')
      expect(result.exitCode).toBe(0)
    })

    it('handles /usr path', async () => {
      const result = await ctx.exec('dirname /usr')
      expect(result.stdout.trim()).toBe('/')
      expect(result.exitCode).toBe(0)
    })

    it('handles //usr path (implementation-defined)', async () => {
      // POSIX says // at start may be treated specially
      const result = await ctx.exec('dirname //usr')
      // Result may be / or // depending on implementation
      expect(['/', '//']).toContain(result.stdout.trim())
      expect(result.exitCode).toBe(0)
    })

    it('handles hidden files', async () => {
      const result = await ctx.exec('dirname /path/to/.hidden')
      expect(result.stdout.trim()).toBe('/path/to')
      expect(result.exitCode).toBe(0)
    })
  })

  // ============================================================================
  // echo - Write arguments to standard output
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/echo.html
  // ============================================================================
  describe('echo', () => {
    it('outputs arguments followed by newline', async () => {
      const result = await ctx.exec('echo hello')
      expect(result.stdout).toBe('hello\n')
      expect(result.exitCode).toBe(0)
    })

    it('outputs multiple arguments separated by space', async () => {
      const result = await ctx.exec('echo hello world')
      expect(result.stdout).toBe('hello world\n')
      expect(result.exitCode).toBe(0)
    })

    it('outputs empty line with no arguments', async () => {
      const result = await ctx.exec('echo')
      expect(result.stdout).toBe('\n')
      expect(result.exitCode).toBe(0)
    })

    it('outputs empty string argument', async () => {
      const result = await ctx.exec('echo ""')
      expect(result.stdout).toBe('\n')
      expect(result.exitCode).toBe(0)
    })

    it('preserves spaces in quoted arguments', async () => {
      const result = await ctx.exec('echo "hello   world"')
      expect(result.stdout).toBe('hello   world\n')
      expect(result.exitCode).toBe(0)
    })

    it('handles single quotes', async () => {
      const result = await ctx.exec("echo 'hello world'")
      expect(result.stdout).toBe('hello world\n')
      expect(result.exitCode).toBe(0)
    })

    it('handles special characters in double quotes', async () => {
      const result = await ctx.exec('echo "hello$world"')
      // $world is an undefined variable, expands to empty
      expect(result.stdout).toBe('hello\n')
      expect(result.exitCode).toBe(0)
    })

    it('handles special characters in single quotes (literal)', async () => {
      const result = await ctx.exec("echo 'hello$world'")
      expect(result.stdout).toBe('hello$world\n')
      expect(result.exitCode).toBe(0)
    })

    it('handles backslash escape sequences (implementation-defined)', async () => {
      // POSIX echo behavior with backslash is implementation-defined
      // -e flag is not POSIX standard but commonly supported
      const result = await ctx.exec('echo "hello\\nworld"')
      // Behavior varies: may output literal \n or newline
      expect(result.exitCode).toBe(0)
    })

    it('handles tab characters in string', async () => {
      const result = await ctx.exec('printf "hello\\tworld\\n"')
      expect(result.stdout).toBe('hello\tworld\n')
      expect(result.exitCode).toBe(0)
    })

    it('handles multiple consecutive spaces between arguments', async () => {
      const result = await ctx.exec('echo a    b    c')
      // Multiple spaces collapse to single space when not quoted
      expect(result.stdout).toBe('a b c\n')
      expect(result.exitCode).toBe(0)
    })

    it('expands environment variables', async () => {
      const result = await ctx.exec('echo $HOME', { env: { HOME: '/test/home' } })
      expect(result.stdout).toBe('/test/home\n')
      expect(result.exitCode).toBe(0)
    })

    it('handles asterisk without expansion in quotes', async () => {
      const result = await ctx.exec('echo "*"')
      expect(result.stdout).toBe('*\n')
      expect(result.exitCode).toBe(0)
    })
  })

  // ============================================================================
  // env - Set the environment for command invocation
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/env.html
  // ============================================================================
  describe('env', () => {
    it('prints current environment without arguments', async () => {
      const result = await ctx.exec('env')
      expect(result.exitCode).toBe(0)
      // Environment should contain at least PATH
      expect(result.stdout).toContain('PATH=')
    })

    it('sets environment variable for command', async () => {
      const result = await ctx.exec('env MYVAR=hello sh -c \'echo $MYVAR\'')
      expect(result.stdout.trim()).toBe('hello')
      expect(result.exitCode).toBe(0)
    })

    it('sets multiple environment variables', async () => {
      const result = await ctx.exec('env VAR1=one VAR2=two sh -c \'echo $VAR1 $VAR2\'')
      expect(result.stdout.trim()).toBe('one two')
      expect(result.exitCode).toBe(0)
    })

    it('-i starts with empty environment', async () => {
      const result = await ctx.exec('env -i PATH=/bin:/usr/bin env')
      expect(result.exitCode).toBe(0)
      // Should only have PATH
      const lines = result.stdout.trim().split('\n').filter(Boolean)
      expect(lines.length).toBeGreaterThanOrEqual(1)
      expect(result.stdout).toContain('PATH=/bin:/usr/bin')
    })

    it('-u unsets environment variable', async () => {
      const result = await ctx.exec('env MYVAR=hello env -u MYVAR sh -c \'echo ${MYVAR:-unset}\'')
      expect(result.stdout.trim()).toBe('unset')
      expect(result.exitCode).toBe(0)
    })

    it('executes command with modified environment', async () => {
      const result = await ctx.exec('env HOME=/tmp/test sh -c \'echo $HOME\'')
      expect(result.stdout.trim()).toBe('/tmp/test')
      expect(result.exitCode).toBe(0)
    })

    it('handles variable with special characters in value', async () => {
      const result = await ctx.exec('env MYVAR="hello world" sh -c \'echo $MYVAR\'')
      expect(result.stdout.trim()).toBe('hello world')
      expect(result.exitCode).toBe(0)
    })

    it('returns command exit code', async () => {
      const result = await ctx.exec('env sh -c \'exit 42\'')
      expect(result.exitCode).toBe(42)
    })

    it('returns 127 if command not found', async () => {
      const result = await ctx.exec('env nonexistent_command_12345')
      expect(result.exitCode).toBe(127)
    })

    it('handles empty value', async () => {
      const result = await ctx.exec('env MYVAR= sh -c \'echo "value:$MYVAR:end"\'')
      expect(result.stdout.trim()).toBe('value::end')
      expect(result.exitCode).toBe(0)
    })

    it('overrides existing environment variable', async () => {
      const result = await ctx.exec('MYPATH=/original env MYPATH=/custom/path sh -c \'echo $MYPATH\'')
      expect(result.stdout.trim()).toBe('/custom/path')
      expect(result.exitCode).toBe(0)
    })
  })

  // ============================================================================
  // expr - Evaluate arguments as an expression
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/expr.html
  // ============================================================================
  describe('expr', () => {
    describe('arithmetic operations', () => {
      it('adds two numbers', async () => {
        const result = await ctx.exec('expr 5 + 3')
        expect(result.stdout.trim()).toBe('8')
        expect(result.exitCode).toBe(0)
      })

      it('subtracts two numbers', async () => {
        const result = await ctx.exec('expr 10 - 4')
        expect(result.stdout.trim()).toBe('6')
        expect(result.exitCode).toBe(0)
      })

      it('multiplies two numbers (escaped asterisk)', async () => {
        const result = await ctx.exec('expr 6 \\* 7')
        expect(result.stdout.trim()).toBe('42')
        expect(result.exitCode).toBe(0)
      })

      it('divides two numbers', async () => {
        const result = await ctx.exec('expr 20 / 4')
        expect(result.stdout.trim()).toBe('5')
        expect(result.exitCode).toBe(0)
      })

      it('performs modulo operation', async () => {
        const result = await ctx.exec('expr 17 % 5')
        expect(result.stdout.trim()).toBe('2')
        expect(result.exitCode).toBe(0)
      })

      it('handles negative numbers', async () => {
        const result = await ctx.exec('expr -5 + 3')
        expect(result.stdout.trim()).toBe('-2')
        expect(result.exitCode).toBe(0)
      })

      it('returns error for division by zero', async () => {
        const result = await ctx.exec('expr 10 / 0')
        expect(result.exitCode).not.toBe(0)
      })

      it('returns error for modulo by zero', async () => {
        const result = await ctx.exec('expr 10 % 0')
        expect(result.exitCode).not.toBe(0)
      })

      it('handles integer division (truncates)', async () => {
        const result = await ctx.exec('expr 7 / 3')
        expect(result.stdout.trim()).toBe('2')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('comparison operations', () => {
      it('compares equal numbers (=)', async () => {
        const result = await ctx.exec('expr 5 = 5')
        expect(result.stdout.trim()).toBe('1')
        expect(result.exitCode).toBe(0)
      })

      it('compares unequal numbers (=)', async () => {
        const result = await ctx.exec('expr 5 = 6')
        expect(result.stdout.trim()).toBe('0')
        expect(result.exitCode).toBe(1)
      })

      it('compares not equal (!=)', async () => {
        const result = await ctx.exec('expr 5 != 6')
        expect(result.stdout.trim()).toBe('1')
        expect(result.exitCode).toBe(0)
      })

      it('compares less than (escaped)', async () => {
        const result = await ctx.exec('expr 5 \\< 10')
        expect(result.stdout.trim()).toBe('1')
        expect(result.exitCode).toBe(0)
      })

      it('compares greater than (escaped)', async () => {
        const result = await ctx.exec('expr 10 \\> 5')
        expect(result.stdout.trim()).toBe('1')
        expect(result.exitCode).toBe(0)
      })

      it('compares less than or equal (escaped)', async () => {
        const result = await ctx.exec('expr 5 \\<= 5')
        expect(result.stdout.trim()).toBe('1')
        expect(result.exitCode).toBe(0)
      })

      it('compares greater than or equal (escaped)', async () => {
        const result = await ctx.exec('expr 5 \\>= 5')
        expect(result.stdout.trim()).toBe('1')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('string operations', () => {
      it('compares equal strings', async () => {
        const result = await ctx.exec('expr hello = hello')
        expect(result.stdout.trim()).toBe('1')
        expect(result.exitCode).toBe(0)
      })

      it('compares unequal strings', async () => {
        const result = await ctx.exec('expr hello = world')
        expect(result.stdout.trim()).toBe('0')
        expect(result.exitCode).toBe(1)
      })

      // Note: length, substr, index are GNU extensions, not in POSIX expr
      // These tests document behavior when available (GNU coreutils)
      it.skip('returns string length with substr pattern (GNU extension)', async () => {
        const result = await ctx.exec('expr length "hello"')
        expect(result.stdout.trim()).toBe('5')
        expect(result.exitCode).toBe(0)
      })

      it.skip('extracts substring (GNU extension)', async () => {
        const result = await ctx.exec('expr substr "hello" 2 3')
        expect(result.stdout.trim()).toBe('ell')
        expect(result.exitCode).toBe(0)
      })

      it.skip('finds index of character (GNU extension)', async () => {
        const result = await ctx.exec('expr index "hello" "l"')
        expect(result.stdout.trim()).toBe('3')
        expect(result.exitCode).toBe(0)
      })

      it.skip('returns 0 for index not found (GNU extension)', async () => {
        const result = await ctx.exec('expr index "hello" "x"')
        expect(result.stdout.trim()).toBe('0')
        expect(result.exitCode).toBe(1)
      })
    })

    describe('regex matching', () => {
      it('matches pattern and returns matched length', async () => {
        const result = await ctx.exec('expr "hello123" : "hello\\([0-9]*\\)"')
        expect(result.stdout.trim()).toBe('123')
        expect(result.exitCode).toBe(0)
      })

      it('matches pattern and returns count when no group', async () => {
        const result = await ctx.exec('expr "hello" : "hel"')
        expect(result.stdout.trim()).toBe('3')
        expect(result.exitCode).toBe(0)
      })

      it('returns 0/empty for no match', async () => {
        const result = await ctx.exec('expr "hello" : "xyz"')
        expect(result.stdout.trim()).toBe('0')
        expect(result.exitCode).toBe(1)
      })

      it('anchors match at beginning', async () => {
        const result = await ctx.exec('expr "hello" : "ello"')
        expect(result.stdout.trim()).toBe('0')
        expect(result.exitCode).toBe(1)
      })
    })

    describe('logical operations', () => {
      it('evaluates OR with first true', async () => {
        const result = await ctx.exec('expr 5 \\| 0')
        expect(result.stdout.trim()).toBe('5')
        expect(result.exitCode).toBe(0)
      })

      it('evaluates OR with first false', async () => {
        const result = await ctx.exec('expr 0 \\| 5')
        expect(result.stdout.trim()).toBe('5')
        expect(result.exitCode).toBe(0)
      })

      it('evaluates AND with both true', async () => {
        const result = await ctx.exec('expr 5 \\& 3')
        expect(result.stdout.trim()).toBe('5')
        expect(result.exitCode).toBe(0)
      })

      it('evaluates AND with first false', async () => {
        const result = await ctx.exec('expr 0 \\& 5')
        expect(result.stdout.trim()).toBe('0')
        expect(result.exitCode).toBe(1)
      })
    })

    describe('exit codes', () => {
      it('returns 0 for non-zero/non-empty result', async () => {
        const result = await ctx.exec('expr 1 + 1')
        expect(result.exitCode).toBe(0)
      })

      it('returns 1 for zero/empty result', async () => {
        const result = await ctx.exec('expr 0 + 0')
        expect(result.exitCode).toBe(1)
      })

      it('returns 2 for invalid expression', async () => {
        const result = await ctx.exec('expr 1 + + 1')
        expect(result.exitCode).toBe(2)
      })
    })
  })

  // ============================================================================
  // printf - Write formatted output
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/printf.html
  // ============================================================================
  describe('printf', () => {
    describe('basic output', () => {
      it('outputs string without newline', async () => {
        const result = await ctx.exec('printf "hello"')
        expect(result.stdout).toBe('hello')
        expect(result.exitCode).toBe(0)
      })

      it('outputs string with explicit newline', async () => {
        const result = await ctx.exec('printf "hello\\n"')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('outputs empty string with no format or arguments', async () => {
        const result = await ctx.exec('printf ""')
        expect(result.stdout).toBe('')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('escape sequences', () => {
      it('handles \\n for newline', async () => {
        const result = await ctx.exec('printf "line1\\nline2\\n"')
        expect(result.stdout).toBe('line1\nline2\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\t for tab', async () => {
        const result = await ctx.exec('printf "col1\\tcol2\\n"')
        expect(result.stdout).toBe('col1\tcol2\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\r for carriage return', async () => {
        const result = await ctx.exec('printf "hello\\rworld"')
        expect(result.stdout).toBe('hello\rworld')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\\\ for backslash', async () => {
        const result = await ctx.exec('printf "path\\\\\\\\to\\\\\\\\file"')
        expect(result.stdout).toBe('path\\to\\file')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\0NNN for octal characters', async () => {
        const result = await ctx.exec('printf "\\101\\102\\103"')
        expect(result.stdout).toBe('ABC')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\xHH for hex characters', async () => {
        const result = await ctx.exec('printf "\\x41\\x42\\x43"')
        expect(result.stdout).toBe('ABC')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('string format specifier %s', () => {
      it('substitutes string argument', async () => {
        const result = await ctx.exec('printf "Hello, %s!\\n" "World"')
        expect(result.stdout).toBe('Hello, World!\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles multiple string arguments', async () => {
        const result = await ctx.exec('printf "%s and %s\\n" "one" "two"')
        expect(result.stdout).toBe('one and two\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles minimum width', async () => {
        const result = await ctx.exec('printf "|%10s|\\n" "test"')
        expect(result.stdout).toBe('|      test|\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles left-justified with -', async () => {
        const result = await ctx.exec('printf "|%-10s|\\n" "test"')
        expect(result.stdout).toBe('|test      |\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles precision (max length)', async () => {
        const result = await ctx.exec('printf "|%.3s|\\n" "hello"')
        expect(result.stdout).toBe('|hel|\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles empty string argument', async () => {
        const result = await ctx.exec('printf "[%s]\\n" ""')
        expect(result.stdout).toBe('[]\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('integer format specifiers', () => {
      it('handles %d for decimal', async () => {
        const result = await ctx.exec('printf "%d\\n" 42')
        expect(result.stdout).toBe('42\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles %i for integer (same as %d)', async () => {
        const result = await ctx.exec('printf "%i\\n" 42')
        expect(result.stdout).toBe('42\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles %o for octal', async () => {
        const result = await ctx.exec('printf "%o\\n" 8')
        expect(result.stdout).toBe('10\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles %x for lowercase hex', async () => {
        const result = await ctx.exec('printf "%x\\n" 255')
        expect(result.stdout).toBe('ff\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles %X for uppercase hex', async () => {
        const result = await ctx.exec('printf "%X\\n" 255')
        expect(result.stdout).toBe('FF\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles zero padding', async () => {
        const result = await ctx.exec('printf "%05d\\n" 42')
        expect(result.stdout).toBe('00042\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles minimum width', async () => {
        const result = await ctx.exec('printf "%8d\\n" 42')
        expect(result.stdout).toBe('      42\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles negative numbers', async () => {
        const result = await ctx.exec('printf "%d\\n" -42')
        expect(result.stdout).toBe('-42\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles + flag for positive sign', async () => {
        const result = await ctx.exec('printf "%+d\\n" 42')
        expect(result.stdout).toBe('+42\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles space flag for sign placeholder', async () => {
        const result = await ctx.exec('printf "% d\\n" 42')
        expect(result.stdout).toBe(' 42\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles # flag for alternate form (hex)', async () => {
        const result = await ctx.exec('printf "%#x\\n" 255')
        expect(result.stdout).toBe('0xff\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles # flag for alternate form (octal)', async () => {
        const result = await ctx.exec('printf "%#o\\n" 8')
        expect(result.stdout).toBe('010\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('floating point format specifiers', () => {
      it('handles %f for floating point', async () => {
        const result = await ctx.exec('printf "%f\\n" 3.14159')
        expect(result.stdout).toMatch(/^3\.141590/)
        expect(result.exitCode).toBe(0)
      })

      it('handles %e for scientific notation', async () => {
        const result = await ctx.exec('printf "%e\\n" 1234.5')
        expect(result.stdout).toMatch(/1\.234500e\+03/)
        expect(result.exitCode).toBe(0)
      })

      it('handles %E for uppercase scientific notation', async () => {
        const result = await ctx.exec('printf "%E\\n" 1234.5')
        expect(result.stdout).toMatch(/1\.234500E\+03/)
        expect(result.exitCode).toBe(0)
      })

      it('handles %g for shortest representation', async () => {
        const result = await ctx.exec('printf "%g\\n" 0.00001234')
        expect(result.stdout).toMatch(/1\.234e-05|1\.234E-05/)
        expect(result.exitCode).toBe(0)
      })

      it('handles precision for %f', async () => {
        const result = await ctx.exec('printf "%.2f\\n" 3.14159')
        expect(result.stdout).toBe('3.14\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles width and precision', async () => {
        const result = await ctx.exec('printf "%8.2f\\n" 3.14159')
        expect(result.stdout).toBe('    3.14\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('character format specifier %c', () => {
      it('prints first character of string', async () => {
        const result = await ctx.exec('printf "%c\\n" "hello"')
        expect(result.stdout).toBe('h\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles single character', async () => {
        const result = await ctx.exec('printf "%c\\n" "A"')
        expect(result.stdout).toBe('A\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles empty string', async () => {
        const result = await ctx.exec('printf "%c\\n" ""')
        expect(result.stdout).toBe('\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('percent literal', () => {
      it('handles %% for literal percent', async () => {
        const result = await ctx.exec('printf "100%%\\n"')
        expect(result.stdout).toBe('100%\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('format reuse', () => {
      it('reuses format for extra arguments', async () => {
        const result = await ctx.exec('printf "%s\\n" "one" "two" "three"')
        expect(result.stdout).toBe('one\ntwo\nthree\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles missing arguments (defaults)', async () => {
        const result = await ctx.exec('printf "%s %d\\n"')
        expect(result.stdout).toBe(' 0\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('width and precision from arguments', () => {
      it('handles * for width from argument', async () => {
        const result = await ctx.exec('printf "|%*s|\\n" 10 "test"')
        expect(result.stdout).toBe('|      test|\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles * for precision from argument', async () => {
        const result = await ctx.exec('printf "|%.*s|\\n" 3 "hello"')
        expect(result.stdout).toBe('|hel|\n')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // pwd - Print working directory
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/pwd.html
  // ============================================================================
  describe('pwd', () => {
    it('prints current working directory', async () => {
      const result = await ctx.exec('pwd')
      // macOS resolves /var to /private/var, so compare with realpath
      const realpath = await ctx.exec('pwd -P')
      expect(result.stdout.trim()).toBe(realpath.stdout.trim())
      expect(result.exitCode).toBe(0)
    })

    it('returns absolute path', async () => {
      const result = await ctx.exec('pwd')
      expect(result.stdout.trim()).toMatch(/^\//)
      expect(result.exitCode).toBe(0)
    })

    it('-L prints logical path (follows symlinks)', async () => {
      await ctx.createDir('realdir')
      await ctx.exec('ln -s realdir linkdir')

      const result = await ctx.exec('cd linkdir && pwd -L')
      expect(result.stdout.trim()).toContain('linkdir')
      expect(result.exitCode).toBe(0)
    })

    it('-P prints physical path (resolves symlinks)', async () => {
      await ctx.createDir('realdir')
      await ctx.exec('ln -s realdir linkdir')

      const result = await ctx.exec('cd linkdir && pwd -P')
      expect(result.stdout.trim()).toContain('realdir')
      expect(result.exitCode).toBe(0)
    })

    it('handles nested directories', async () => {
      await ctx.createDir('a/b/c')
      const result = await ctx.exec('cd a/b/c && pwd')
      // Use -P to get physical path for comparison (handles macOS /private/var symlink)
      const expected = await ctx.exec('cd a/b/c && pwd -P')
      expect(result.stdout.trim()).toBe(expected.stdout.trim())
      expect(result.exitCode).toBe(0)
    })

    it('handles directory with spaces', async () => {
      await ctx.createDir('dir with spaces')
      const result = await ctx.exec('cd "dir with spaces" && pwd')
      // Use -P to get physical path for comparison
      const expected = await ctx.exec('cd "dir with spaces" && pwd -P')
      expect(result.stdout.trim()).toBe(expected.stdout.trim())
      expect(result.exitCode).toBe(0)
    })
  })

  // ============================================================================
  // test (and [) - Evaluate expression
  // POSIX Reference: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/test.html
  // ============================================================================
  describe('test and [', () => {
    describe('string tests', () => {
      it('-n returns true for non-empty string', async () => {
        const result = await ctx.exec('test -n "hello"')
        expect(result.exitCode).toBe(0)
      })

      it('-n returns false for empty string', async () => {
        const result = await ctx.exec('test -n ""')
        expect(result.exitCode).toBe(1)
      })

      it('-z returns true for empty string', async () => {
        const result = await ctx.exec('test -z ""')
        expect(result.exitCode).toBe(0)
      })

      it('-z returns false for non-empty string', async () => {
        const result = await ctx.exec('test -z "hello"')
        expect(result.exitCode).toBe(1)
      })

      it('= tests string equality', async () => {
        const result = await ctx.exec('test "hello" = "hello"')
        expect(result.exitCode).toBe(0)
      })

      it('= returns false for unequal strings', async () => {
        const result = await ctx.exec('test "hello" = "world"')
        expect(result.exitCode).toBe(1)
      })

      it('!= tests string inequality', async () => {
        const result = await ctx.exec('test "hello" != "world"')
        expect(result.exitCode).toBe(0)
      })

      it('!= returns false for equal strings', async () => {
        const result = await ctx.exec('test "hello" != "hello"')
        expect(result.exitCode).toBe(1)
      })

      it('bare string is non-empty test', async () => {
        const result = await ctx.exec('test hello')
        expect(result.exitCode).toBe(0)
      })

      it('bare empty string is false', async () => {
        const result = await ctx.exec('test ""')
        expect(result.exitCode).toBe(1)
      })
    })

    describe('numeric tests', () => {
      it('-eq tests numeric equality', async () => {
        const result = await ctx.exec('test 42 -eq 42')
        expect(result.exitCode).toBe(0)
      })

      it('-eq returns false for unequal numbers', async () => {
        const result = await ctx.exec('test 42 -eq 43')
        expect(result.exitCode).toBe(1)
      })

      it('-ne tests numeric inequality', async () => {
        const result = await ctx.exec('test 42 -ne 43')
        expect(result.exitCode).toBe(0)
      })

      it('-ne returns false for equal numbers', async () => {
        const result = await ctx.exec('test 42 -ne 42')
        expect(result.exitCode).toBe(1)
      })

      it('-lt tests less than', async () => {
        const result = await ctx.exec('test 5 -lt 10')
        expect(result.exitCode).toBe(0)
      })

      it('-lt returns false when not less', async () => {
        const result = await ctx.exec('test 10 -lt 5')
        expect(result.exitCode).toBe(1)
      })

      it('-le tests less than or equal', async () => {
        const result1 = await ctx.exec('test 5 -le 10')
        const result2 = await ctx.exec('test 5 -le 5')
        expect(result1.exitCode).toBe(0)
        expect(result2.exitCode).toBe(0)
      })

      it('-gt tests greater than', async () => {
        const result = await ctx.exec('test 10 -gt 5')
        expect(result.exitCode).toBe(0)
      })

      it('-gt returns false when not greater', async () => {
        const result = await ctx.exec('test 5 -gt 10')
        expect(result.exitCode).toBe(1)
      })

      it('-ge tests greater than or equal', async () => {
        const result1 = await ctx.exec('test 10 -ge 5')
        const result2 = await ctx.exec('test 5 -ge 5')
        expect(result1.exitCode).toBe(0)
        expect(result2.exitCode).toBe(0)
      })

      it('handles negative numbers', async () => {
        const result = await ctx.exec('test -5 -lt 0')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('file tests', () => {
      it('-e tests file existence', async () => {
        await ctx.createFile('exists.txt', '')
        const result = await ctx.exec('test -e exists.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-e returns false for non-existent file', async () => {
        const result = await ctx.exec('test -e nonexistent.txt')
        expect(result.exitCode).toBe(1)
      })

      it('-f tests regular file', async () => {
        await ctx.createFile('regular.txt', '')
        const result = await ctx.exec('test -f regular.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-f returns false for directory', async () => {
        await ctx.createDir('mydir')
        const result = await ctx.exec('test -f mydir')
        expect(result.exitCode).toBe(1)
      })

      it('-d tests directory', async () => {
        await ctx.createDir('mydir')
        const result = await ctx.exec('test -d mydir')
        expect(result.exitCode).toBe(0)
      })

      it('-d returns false for regular file', async () => {
        await ctx.createFile('regular.txt', '')
        const result = await ctx.exec('test -d regular.txt')
        expect(result.exitCode).toBe(1)
      })

      it('-r tests readable file', async () => {
        await ctx.createFile('readable.txt', '')
        const result = await ctx.exec('test -r readable.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-w tests writable file', async () => {
        await ctx.createFile('writable.txt', '')
        const result = await ctx.exec('test -w writable.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-x tests executable file', async () => {
        await ctx.createFile('script.sh', '#!/bin/sh\necho hi')
        await ctx.exec('chmod +x script.sh')
        const result = await ctx.exec('test -x script.sh')
        expect(result.exitCode).toBe(0)
      })

      it('-x returns false for non-executable file', async () => {
        await ctx.createFile('notexec.txt', '')
        const result = await ctx.exec('test -x notexec.txt')
        expect(result.exitCode).toBe(1)
      })

      it('-s tests non-empty file', async () => {
        await ctx.createFile('nonempty.txt', 'content')
        const result = await ctx.exec('test -s nonempty.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-s returns false for empty file', async () => {
        await ctx.createFile('empty.txt', '')
        const result = await ctx.exec('test -s empty.txt')
        expect(result.exitCode).toBe(1)
      })

      it('-L tests symbolic link', async () => {
        await ctx.createFile('target.txt', '')
        await ctx.exec('ln -s target.txt link.txt')
        const result = await ctx.exec('test -L link.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-L returns false for regular file', async () => {
        await ctx.createFile('regular.txt', '')
        const result = await ctx.exec('test -L regular.txt')
        expect(result.exitCode).toBe(1)
      })

      it('-h is equivalent to -L', async () => {
        await ctx.createFile('target.txt', '')
        await ctx.exec('ln -s target.txt link.txt')
        const result = await ctx.exec('test -h link.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('file comparison tests', () => {
      it('-nt tests newer than', async () => {
        await ctx.createFile('old.txt', '')
        // Use touch with explicit timestamp to ensure files have different times
        await ctx.exec('touch -t 202001010000 old.txt')
        await ctx.createFile('new.txt', '')
        const result = await ctx.exec('test new.txt -nt old.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-ot tests older than', async () => {
        await ctx.createFile('old.txt', '')
        // Use touch with explicit timestamp to ensure files have different times
        await ctx.exec('touch -t 202001010000 old.txt')
        await ctx.createFile('new.txt', '')
        const result = await ctx.exec('test old.txt -ot new.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-ef tests same file (same inode)', async () => {
        await ctx.createFile('original.txt', '')
        await ctx.exec('ln original.txt hardlink.txt')
        const result = await ctx.exec('test original.txt -ef hardlink.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('logical operators', () => {
      it('! negates condition', async () => {
        const result = await ctx.exec('test ! -e nonexistent.txt')
        expect(result.exitCode).toBe(0)
      })

      it('! with false condition becomes true', async () => {
        const result = await ctx.exec('test ! ""')
        expect(result.exitCode).toBe(0)
      })

      it('-a performs AND', async () => {
        await ctx.createFile('file.txt', '')
        const result = await ctx.exec('test -e file.txt -a -f file.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-a with one false returns false', async () => {
        await ctx.createFile('file.txt', '')
        const result = await ctx.exec('test -e file.txt -a -d file.txt')
        expect(result.exitCode).toBe(1)
      })

      it('-o performs OR', async () => {
        await ctx.createFile('file.txt', '')
        const result = await ctx.exec('test -d file.txt -o -f file.txt')
        expect(result.exitCode).toBe(0)
      })

      it('-o with both false returns false', async () => {
        const result = await ctx.exec('test -e nonexistent -o -d nonexistent')
        expect(result.exitCode).toBe(1)
      })

      it('handles parentheses for grouping', async () => {
        await ctx.createFile('file.txt', '')
        const result = await ctx.exec('test \\( -e file.txt \\)')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('[ ] bracket form', () => {
      it('[ ] is equivalent to test', async () => {
        await ctx.createFile('exists.txt', '')
        const result = await ctx.exec('[ -e exists.txt ]')
        expect(result.exitCode).toBe(0)
      })

      it('[ ] requires closing bracket', async () => {
        // This should fail or behave unexpectedly without ]
        const result = await ctx.exec('[ -e exists.txt')
        expect(result.exitCode).not.toBe(0)
      })

      it('[ ] works with string tests', async () => {
        const result = await ctx.exec('[ "hello" = "hello" ]')
        expect(result.exitCode).toBe(0)
      })

      it('[ ] works with numeric tests', async () => {
        const result = await ctx.exec('[ 42 -eq 42 ]')
        expect(result.exitCode).toBe(0)
      })

      it('[ ] works with negation', async () => {
        const result = await ctx.exec('[ ! "" ]')
        expect(result.exitCode).toBe(0)
      })

      it('[ ] handles complex expressions', async () => {
        await ctx.createFile('file.txt', 'content')
        const result = await ctx.exec('[ -f file.txt -a -s file.txt ]')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('edge cases', () => {
      it('no arguments returns false', async () => {
        const result = await ctx.exec('test')
        expect(result.exitCode).toBe(1)
      })

      it('handles special characters in strings', async () => {
        const result = await ctx.exec('test "hello world" = "hello world"')
        expect(result.exitCode).toBe(0)
      })

      it('handles empty string comparison', async () => {
        const result = await ctx.exec('test "" = ""')
        expect(result.exitCode).toBe(0)
      })

      it('handles string that looks like operator', async () => {
        const result = await ctx.exec('test "=" = "="')
        expect(result.exitCode).toBe(0)
      })

      it('handles string that starts with dash', async () => {
        const result = await ctx.exec('test "-n" = "-n"')
        expect(result.exitCode).toBe(0)
      })
    })
  })
})

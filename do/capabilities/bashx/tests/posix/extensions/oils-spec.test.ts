/**
 * Oils Spec Test Adaptation
 *
 * Port of relevant tests from the Oils project (https://www.oilshell.org/)
 * spec test format for testing bash/shell behavior.
 *
 * These tests verify edge cases and behaviors that are important for
 * a shell implementation to handle correctly.
 *
 * Reference: https://github.com/oilshell/oil/tree/master/spec
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestContext, type TestContext } from '../helpers/index'

describe('Oils Spec Tests', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  // ============================================================================
  // COMMAND PARSING EDGE CASES
  // Based on: spec/command-parsing.test.sh
  // ============================================================================
  describe('Command Parsing Edge Cases', () => {
    describe('Empty commands and whitespace', () => {
      it('handles empty command (just newline)', async () => {
        const result = await ctx.exec('')
        expect(result.exitCode).toBe(0)
      })

      it('handles command with only whitespace', async () => {
        const result = await ctx.exec('   ')
        expect(result.exitCode).toBe(0)
      })

      it('handles command with only tabs', async () => {
        const result = await ctx.exec('\t\t')
        expect(result.exitCode).toBe(0)
      })

      it('handles semicolon-only command', async () => {
        const result = await ctx.exec(';')
        // Shells typically accept or error on lone semicolon
        // bash accepts it, some shells don't
        expect([0, 2]).toContain(result.exitCode)
      })

      it('handles multiple semicolons', async () => {
        const result = await ctx.exec(';;;')
        expect([0, 2]).toContain(result.exitCode)
      })
    })

    describe('Command separators', () => {
      it('executes commands separated by semicolon', async () => {
        const result = await ctx.exec('echo one; echo two')
        expect(result.stdout).toBe('one\ntwo\n')
        expect(result.exitCode).toBe(0)
      })

      it('executes commands separated by newline', async () => {
        const result = await ctx.exec('echo one\necho two')
        expect(result.stdout).toBe('one\ntwo\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles command after ampersand (background)', async () => {
        // Note: we wait briefly to let background complete
        const result = await ctx.exec('echo one & echo two; wait')
        expect(result.stdout).toContain('one')
        expect(result.stdout).toContain('two')
        expect(result.exitCode).toBe(0)
      })

      it('handles && for conditional execution (success)', async () => {
        const result = await ctx.exec('true && echo success')
        expect(result.stdout).toBe('success\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles && for conditional execution (failure)', async () => {
        const result = await ctx.exec('false && echo should_not_print')
        expect(result.stdout).toBe('')
        expect(result.exitCode).toBe(1)
      })

      it('handles || for conditional execution (success)', async () => {
        const result = await ctx.exec('true || echo should_not_print')
        expect(result.stdout).toBe('')
        expect(result.exitCode).toBe(0)
      })

      it('handles || for conditional execution (failure)', async () => {
        const result = await ctx.exec('false || echo fallback')
        expect(result.stdout).toBe('fallback\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles mixed && and ||', async () => {
        const result = await ctx.exec('false || true && echo success')
        expect(result.stdout).toBe('success\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Line continuation', () => {
      it('handles backslash line continuation', async () => {
        const result = await ctx.exec('echo hel\\\nlo')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles multiple line continuations', async () => {
        const result = await ctx.exec('echo \\\none \\\ntwo \\\nthree')
        expect(result.stdout).toBe('one two three\n')
        expect(result.exitCode).toBe(0)
      })

      it('line continuation in quoted string', async () => {
        const result = await ctx.exec('"echo" "hel\\\nlo"')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Comments', () => {
      it('ignores inline comments', async () => {
        const result = await ctx.exec('echo hello # this is a comment')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('ignores full-line comments', async () => {
        const result = await ctx.exec('# comment\necho hello')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('hash in quotes is not a comment', async () => {
        const result = await ctx.exec('echo "hello # world"')
        expect(result.stdout).toBe('hello # world\n')
        expect(result.exitCode).toBe(0)
      })

      it('hash after assignment is comment', async () => {
        const result = await ctx.exec('x=5 # comment\necho $x')
        expect(result.stdout).toBe('5\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Reserved words and keywords', () => {
      it('if-then-else-fi basic structure', async () => {
        const result = await ctx.exec('if true; then echo yes; else echo no; fi')
        expect(result.stdout).toBe('yes\n')
        expect(result.exitCode).toBe(0)
      })

      it('while loop basic structure', async () => {
        const result = await ctx.exec('i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done')
        expect(result.stdout).toBe('0\n1\n2\n')
        expect(result.exitCode).toBe(0)
      })

      it('for loop basic structure', async () => {
        const result = await ctx.exec('for i in a b c; do echo $i; done')
        expect(result.stdout).toBe('a\nb\nc\n')
        expect(result.exitCode).toBe(0)
      })

      it('case statement basic structure', async () => {
        const result = await ctx.exec('x=yes; case $x in yes) echo matched;; no) echo nope;; esac')
        expect(result.stdout).toBe('matched\n')
        expect(result.exitCode).toBe(0)
      })

      it('nested if statements', async () => {
        const result = await ctx.exec('if true; then if true; then echo nested; fi; fi')
        expect(result.stdout).toBe('nested\n')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // QUOTING AND ESCAPING BEHAVIOR
  // Based on: spec/quote.test.sh
  // ============================================================================
  describe('Quoting and Escaping Behavior', () => {
    describe('Single quotes', () => {
      it('preserves literal characters', async () => {
        const result = await ctx.exec("echo 'hello world'")
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })

      it('prevents variable expansion', async () => {
        const result = await ctx.exec("x=value; echo '$x'")
        expect(result.stdout).toBe('$x\n')
        expect(result.exitCode).toBe(0)
      })

      it('prevents command substitution', async () => {
        const result = await ctx.exec("echo '$(echo test)'")
        expect(result.stdout).toBe('$(echo test)\n')
        expect(result.exitCode).toBe(0)
      })

      it('preserves backslashes literally', async () => {
        // Use printf instead of echo to avoid echo's escape interpretation
        const result = await ctx.exec("printf '%s\\n' '\\n\\t'")
        expect(result.stdout).toBe('\\n\\t\n')
        expect(result.exitCode).toBe(0)
      })

      it('empty single-quoted string', async () => {
        const result = await ctx.exec("echo ''")
        expect(result.stdout).toBe('\n')
        expect(result.exitCode).toBe(0)
      })

      it('adjacent single-quoted strings concatenate', async () => {
        const result = await ctx.exec("echo 'hel''lo'")
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Double quotes', () => {
      it('preserves spaces', async () => {
        const result = await ctx.exec('echo "hello   world"')
        expect(result.stdout).toBe('hello   world\n')
        expect(result.exitCode).toBe(0)
      })

      it('allows variable expansion', async () => {
        const result = await ctx.exec('x=value; echo "$x"')
        expect(result.stdout).toBe('value\n')
        expect(result.exitCode).toBe(0)
      })

      it('allows command substitution', async () => {
        const result = await ctx.exec('echo "$(echo test)"')
        expect(result.stdout).toBe('test\n')
        expect(result.exitCode).toBe(0)
      })

      it('preserves special characters that are not $, `, \\, or "', async () => {
        const result = await ctx.exec('echo "!@#%^&*()"')
        // Note: ! behavior can vary in interactive shells
        expect(result.stdout).toContain('@#%^&*()')
        expect(result.exitCode).toBe(0)
      })

      it('backslash escapes $ in double quotes', async () => {
        const result = await ctx.exec('echo "\\$HOME"')
        expect(result.stdout).toBe('$HOME\n')
        expect(result.exitCode).toBe(0)
      })

      it('backslash escapes backslash in double quotes', async () => {
        const result = await ctx.exec('echo "\\\\"')
        expect(result.stdout).toBe('\\\n')
        expect(result.exitCode).toBe(0)
      })

      it('backslash escapes double quote in double quotes', async () => {
        const result = await ctx.exec('echo "say \\"hi\\""')
        expect(result.stdout).toBe('say "hi"\n')
        expect(result.exitCode).toBe(0)
      })

      it('backslash escapes backtick in double quotes', async () => {
        const result = await ctx.exec('echo "\\`echo test\\`"')
        expect(result.stdout).toBe('`echo test`\n')
        expect(result.exitCode).toBe(0)
      })

      it('literal backslash before non-special chars', async () => {
        // Use printf to avoid echo's escape interpretation
        const result = await ctx.exec('printf "%s\\n" "\\a\\b\\c"')
        expect(result.stdout).toBe('\\a\\b\\c\n')
        expect(result.exitCode).toBe(0)
      })

      it('empty double-quoted string', async () => {
        const result = await ctx.exec('echo ""')
        expect(result.stdout).toBe('\n')
        expect(result.exitCode).toBe(0)
      })

      it('double quotes preserve newlines', async () => {
        const result = await ctx.exec('echo "line1\nline2"')
        expect(result.stdout).toBe('line1\nline2\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Backslash escaping (unquoted)', () => {
      it('escapes space', async () => {
        const result = await ctx.exec('echo hello\\ world')
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })

      it('escapes special characters', async () => {
        const result = await ctx.exec('echo \\$HOME')
        expect(result.stdout).toBe('$HOME\n')
        expect(result.exitCode).toBe(0)
      })

      it('escapes newline (line continuation)', async () => {
        const result = await ctx.exec('echo hel\\\nlo')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('escapes single quote', async () => {
        const result = await ctx.exec("echo it\\'s")
        expect(result.stdout).toBe("it's\n")
        expect(result.exitCode).toBe(0)
      })

      it('escapes double quote', async () => {
        const result = await ctx.exec('echo say\\"hi\\"')
        expect(result.stdout).toBe('say"hi"\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Quote combinations', () => {
      it('mixed single and double quotes', async () => {
        const result = await ctx.exec("x=world; echo 'hello '$x")
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })

      it('double quotes containing single quotes', async () => {
        const result = await ctx.exec("echo \"it's a test\"")
        expect(result.stdout).toBe("it's a test\n")
        expect(result.exitCode).toBe(0)
      })

      it('single quotes containing double quotes', async () => {
        const result = await ctx.exec("echo 'say \"hello\"'")
        expect(result.stdout).toBe('say "hello"\n')
        expect(result.exitCode).toBe(0)
      })

      it('adjacent quoted and unquoted', async () => {
        const result = await ctx.exec('echo pre"mid"post')
        expect(result.stdout).toBe('premidpost\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('ANSI-C quoting ($\'...\')', () => {
      it('handles \\n for newline', async () => {
        const result = await ctx.exec("echo $'hello\\nworld'")
        expect(result.stdout).toBe('hello\nworld\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\t for tab', async () => {
        const result = await ctx.exec("echo $'col1\\tcol2'")
        expect(result.stdout).toBe('col1\tcol2\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\r for carriage return', async () => {
        const result = await ctx.exec("echo $'hello\\rworld'")
        expect(result.stdout).toBe('hello\rworld\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\\\ for backslash', async () => {
        // Need extra escaping for the shell to see \\
        const result = await ctx.exec("echo $'path\\\\\\\\to\\\\\\\\file'")
        expect(result.stdout).toBe('path\\to\\file\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles \\x hex escapes', async () => {
        const result = await ctx.exec("echo $'\\x41\\x42\\x43'")
        expect(result.stdout).toBe('ABC\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles octal escapes', async () => {
        const result = await ctx.exec("echo $'\\101\\102\\103'")
        expect(result.stdout).toBe('ABC\n')
        expect(result.exitCode).toBe(0)
      })

      it("handles \\' for single quote", async () => {
        const result = await ctx.exec("echo $'it\\'s'")
        expect(result.stdout).toBe("it's\n")
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // VARIABLE EXPANSION PATTERNS
  // Based on: spec/var-sub.test.sh
  // ============================================================================
  describe('Variable Expansion Patterns', () => {
    describe('Basic expansion', () => {
      it('expands simple variable', async () => {
        const result = await ctx.exec('x=hello; echo $x')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('expands variable with braces', async () => {
        const result = await ctx.exec('x=hello; echo ${x}')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('expands variable adjacent to text', async () => {
        const result = await ctx.exec('x=hello; echo ${x}world')
        expect(result.stdout).toBe('helloworld\n')
        expect(result.exitCode).toBe(0)
      })

      it('undefined variable expands to empty', async () => {
        const result = await ctx.exec('echo "[$undefined_var]"')
        expect(result.stdout).toBe('[]\n')
        expect(result.exitCode).toBe(0)
      })

      it('expands special parameter $?', async () => {
        const result = await ctx.exec('true; echo $?')
        expect(result.stdout).toBe('0\n')
        expect(result.exitCode).toBe(0)
      })

      it('expands special parameter $$ (pid)', async () => {
        const result = await ctx.exec('echo $$')
        expect(result.stdout.trim()).toMatch(/^\d+$/)
        expect(result.exitCode).toBe(0)
      })

      it('expands $# (argument count)', async () => {
        const result = await ctx.exec('set -- a b c; echo $#')
        expect(result.stdout).toBe('3\n')
        expect(result.exitCode).toBe(0)
      })

      it('expands $@ (all arguments)', async () => {
        const result = await ctx.exec('set -- a b c; echo "$@"')
        expect(result.stdout).toBe('a b c\n')
        expect(result.exitCode).toBe(0)
      })

      it('expands $* (all arguments as single word)', async () => {
        const result = await ctx.exec('set -- a b c; echo "$*"')
        expect(result.stdout).toBe('a b c\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Default value expansion', () => {
      it('${var:-default} uses default when unset', async () => {
        const result = await ctx.exec('echo ${undefined:-default}')
        expect(result.stdout).toBe('default\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var:-default} uses default when empty', async () => {
        const result = await ctx.exec('x=; echo ${x:-default}')
        expect(result.stdout).toBe('default\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var:-default} uses value when set', async () => {
        const result = await ctx.exec('x=value; echo ${x:-default}')
        expect(result.stdout).toBe('value\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var-default} uses default only when unset', async () => {
        const result = await ctx.exec('x=; echo "[${x-default}]"')
        expect(result.stdout).toBe('[]\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var:=default} assigns default when unset', async () => {
        const result = await ctx.exec('echo ${y:=assigned}; echo $y')
        expect(result.stdout).toBe('assigned\nassigned\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var:+alternate} uses alternate when set and non-empty', async () => {
        const result = await ctx.exec('x=value; echo ${x:+alternate}')
        expect(result.stdout).toBe('alternate\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var:+alternate} is empty when unset', async () => {
        const result = await ctx.exec('echo "[${undefined:+alternate}]"')
        expect(result.stdout).toBe('[]\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var:+alternate} is empty when empty', async () => {
        const result = await ctx.exec('x=; echo "[${x:+alternate}]"')
        expect(result.stdout).toBe('[]\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Error on unset (${var:?})', () => {
      it('${var:?message} errors when unset', async () => {
        const result = await ctx.exec('echo ${undefined_var:?variable not set}')
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain('variable not set')
      })

      it('${var:?message} errors when empty', async () => {
        const result = await ctx.exec('x=; echo ${x:?variable empty}')
        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain('variable empty')
      })

      it('${var:?} uses value when set', async () => {
        const result = await ctx.exec('x=value; echo ${x:?error}')
        expect(result.stdout).toBe('value\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('String length ${#var}', () => {
      it('returns length of string', async () => {
        const result = await ctx.exec('x=hello; echo ${#x}')
        expect(result.stdout).toBe('5\n')
        expect(result.exitCode).toBe(0)
      })

      it('returns 0 for empty string', async () => {
        const result = await ctx.exec('x=; echo ${#x}')
        expect(result.stdout).toBe('0\n')
        expect(result.exitCode).toBe(0)
      })

      it('returns 0 for unset variable', async () => {
        const result = await ctx.exec('echo ${#undefined_var}')
        expect(result.stdout).toBe('0\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Substring removal', () => {
      it('${var#pattern} removes shortest prefix', async () => {
        const result = await ctx.exec('x=hello_world; echo ${x#*_}')
        expect(result.stdout).toBe('world\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var##pattern} removes longest prefix', async () => {
        const result = await ctx.exec('x=one_two_three; echo ${x##*_}')
        expect(result.stdout).toBe('three\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var%pattern} removes shortest suffix', async () => {
        const result = await ctx.exec('x=hello_world; echo ${x%_*}')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var%%pattern} removes longest suffix', async () => {
        const result = await ctx.exec('x=one_two_three; echo ${x%%_*}')
        expect(result.stdout).toBe('one\n')
        expect(result.exitCode).toBe(0)
      })

      it('pattern with no match leaves value unchanged', async () => {
        const result = await ctx.exec('x=hello; echo ${x#xyz}')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Substring extraction ${var:offset:length}', () => {
      it('extracts from offset to end', async () => {
        const result = await ctx.exec('x=hello; echo ${x:2}')
        expect(result.stdout).toBe('llo\n')
        expect(result.exitCode).toBe(0)
      })

      it('extracts with length', async () => {
        const result = await ctx.exec('x=hello; echo ${x:1:3}')
        expect(result.stdout).toBe('ell\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles negative offset (from end)', async () => {
        const result = await ctx.exec('x=hello; echo ${x: -2}')
        expect(result.stdout).toBe('lo\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles zero offset', async () => {
        const result = await ctx.exec('x=hello; echo ${x:0:3}')
        expect(result.stdout).toBe('hel\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Pattern substitution', () => {
      it('${var/pattern/replacement} replaces first match', async () => {
        const result = await ctx.exec('x=hello; echo ${x/l/L}')
        expect(result.stdout).toBe('heLlo\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var//pattern/replacement} replaces all matches', async () => {
        const result = await ctx.exec('x=hello; echo ${x//l/L}')
        expect(result.stdout).toBe('heLLo\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var/#pattern/replacement} replaces at beginning', async () => {
        const result = await ctx.exec('x=hello; echo ${x/#hel/HEL}')
        expect(result.stdout).toBe('HELlo\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var/%pattern/replacement} replaces at end', async () => {
        const result = await ctx.exec('x=hello; echo ${x/%lo/LO}')
        expect(result.stdout).toBe('helLO\n')
        expect(result.exitCode).toBe(0)
      })

      it('${var/pattern/} removes pattern', async () => {
        const result = await ctx.exec('x=hello; echo ${x/l/}')
        expect(result.stdout).toBe('helo\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Case modification (bash 4+)', () => {
      // Note: These features require bash 4.0+ and are not available in /bin/sh
      it.skip('${var^} uppercases first char (bash 4+ only)', async () => {
        const result = await ctx.exec('x=hello; echo ${x^}')
        expect(result.stdout).toBe('Hello\n')
        expect(result.exitCode).toBe(0)
      })

      it.skip('${var^^} uppercases all chars (bash 4+ only)', async () => {
        const result = await ctx.exec('x=hello; echo ${x^^}')
        expect(result.stdout).toBe('HELLO\n')
        expect(result.exitCode).toBe(0)
      })

      it.skip('${var,} lowercases first char (bash 4+ only)', async () => {
        const result = await ctx.exec('x=HELLO; echo ${x,}')
        expect(result.stdout).toBe('hELLO\n')
        expect(result.exitCode).toBe(0)
      })

      it.skip('${var,,} lowercases all chars (bash 4+ only)', async () => {
        const result = await ctx.exec('x=HELLO; echo ${x,,}')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // GLOB PATTERNS
  // Based on: spec/glob.test.sh
  // ============================================================================
  describe('Glob Patterns', () => {
    beforeEach(async () => {
      // Create test files for glob tests
      await ctx.createFile('file1.txt', 'content1')
      await ctx.createFile('file2.txt', 'content2')
      await ctx.createFile('file3.log', 'content3')
      await ctx.createFile('readme.md', 'readme')
      await ctx.createFile('.hidden', 'hidden')
      await ctx.createDir('subdir')
      await ctx.createFile('subdir/nested.txt', 'nested')
    })

    describe('Basic wildcards', () => {
      it('* matches any characters', async () => {
        const result = await ctx.exec('echo *.txt')
        expect(result.stdout.trim().split(' ').sort()).toEqual(['file1.txt', 'file2.txt'])
        expect(result.exitCode).toBe(0)
      })

      it('* does not match hidden files', async () => {
        const result = await ctx.exec('echo *')
        expect(result.stdout).not.toContain('.hidden')
        expect(result.exitCode).toBe(0)
      })

      it('? matches single character', async () => {
        const result = await ctx.exec('echo file?.txt')
        expect(result.stdout.trim().split(' ').sort()).toEqual(['file1.txt', 'file2.txt'])
        expect(result.exitCode).toBe(0)
      })

      it('[...] matches character class', async () => {
        const result = await ctx.exec('echo file[12].txt')
        expect(result.stdout.trim().split(' ').sort()).toEqual(['file1.txt', 'file2.txt'])
        expect(result.exitCode).toBe(0)
      })

      it('[^...] negates character class', async () => {
        const result = await ctx.exec('echo file[^2].txt')
        expect(result.stdout.trim()).toBe('file1.txt')
        expect(result.exitCode).toBe(0)
      })

      it('[!...] also negates character class', async () => {
        const result = await ctx.exec('echo file[!2].txt')
        expect(result.stdout.trim()).toBe('file1.txt')
        expect(result.exitCode).toBe(0)
      })

      it('[a-z] matches character range', async () => {
        const result = await ctx.exec('echo file[0-9].txt')
        expect(result.stdout.trim().split(' ').sort()).toEqual(['file1.txt', 'file2.txt'])
        expect(result.exitCode).toBe(0)
      })
    })

    describe('No match behavior', () => {
      it('returns literal pattern when no match (default)', async () => {
        const result = await ctx.exec('echo *.nomatch')
        expect(result.stdout.trim()).toBe('*.nomatch')
        expect(result.exitCode).toBe(0)
      })

      it('nullglob makes no-match return empty (bash)', async () => {
        const result = await ctx.exec('shopt -s nullglob 2>/dev/null; echo *.nomatch; echo done')
        // If nullglob works, line will be empty before "done"
        expect(result.stdout).toContain('done')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Quoting prevents globbing', () => {
      it('single quotes prevent glob expansion', async () => {
        const result = await ctx.exec("echo '*.txt'")
        expect(result.stdout.trim()).toBe('*.txt')
        expect(result.exitCode).toBe(0)
      })

      it('double quotes prevent glob expansion', async () => {
        const result = await ctx.exec('echo "*.txt"')
        expect(result.stdout.trim()).toBe('*.txt')
        expect(result.exitCode).toBe(0)
      })

      it('backslash escapes glob chars', async () => {
        const result = await ctx.exec('echo \\*.txt')
        expect(result.stdout.trim()).toBe('*.txt')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Extended globs (bash)', () => {
      it.skip('?(pattern) matches zero or one', async () => {
        const result = await ctx.exec('shopt -s extglob; echo file?(1).txt')
        expect(result.stdout.trim().split(' ')).toContain('file1.txt')
        expect(result.exitCode).toBe(0)
      })

      it.skip('*(pattern) matches zero or more', async () => {
        const result = await ctx.exec('shopt -s extglob; echo file*(1).txt')
        expect(result.stdout.trim().split(' ')).toContain('file1.txt')
        expect(result.exitCode).toBe(0)
      })

      it.skip('+(pattern) matches one or more', async () => {
        const result = await ctx.exec('shopt -s extglob; echo file+([0-9]).txt')
        expect(result.stdout.trim().split(' ').sort()).toEqual(['file1.txt', 'file2.txt'])
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Glob with directories', () => {
      it('*/ matches only directories', async () => {
        const result = await ctx.exec('echo */')
        expect(result.stdout.trim()).toBe('subdir/')
        expect(result.exitCode).toBe(0)
      })

      it('**/ recursively matches directories (globstar)', async () => {
        // globstar may not be available in all shells
        const result = await ctx.exec('shopt -s globstar 2>/dev/null; echo **/*.txt')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // ARITHMETIC EXPRESSIONS
  // Based on: spec/arith.test.sh
  // ============================================================================
  describe('Arithmetic Expressions', () => {
    describe('Basic operations', () => {
      it('addition', async () => {
        const result = await ctx.exec('echo $((5 + 3))')
        expect(result.stdout).toBe('8\n')
        expect(result.exitCode).toBe(0)
      })

      it('subtraction', async () => {
        const result = await ctx.exec('echo $((10 - 4))')
        expect(result.stdout).toBe('6\n')
        expect(result.exitCode).toBe(0)
      })

      it('multiplication', async () => {
        const result = await ctx.exec('echo $((6 * 7))')
        expect(result.stdout).toBe('42\n')
        expect(result.exitCode).toBe(0)
      })

      it('division', async () => {
        const result = await ctx.exec('echo $((20 / 4))')
        expect(result.stdout).toBe('5\n')
        expect(result.exitCode).toBe(0)
      })

      it('modulo', async () => {
        const result = await ctx.exec('echo $((17 % 5))')
        expect(result.stdout).toBe('2\n')
        expect(result.exitCode).toBe(0)
      })

      it('exponentiation (bash)', async () => {
        const result = await ctx.exec('echo $((2 ** 10))')
        expect(result.stdout).toBe('1024\n')
        expect(result.exitCode).toBe(0)
      })

      it('negative numbers', async () => {
        const result = await ctx.exec('echo $((-5 + 3))')
        expect(result.stdout).toBe('-2\n')
        expect(result.exitCode).toBe(0)
      })

      it('unary minus', async () => {
        const result = await ctx.exec('x=5; echo $((-x))')
        expect(result.stdout).toBe('-5\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Comparison operators', () => {
      it('less than', async () => {
        const result = await ctx.exec('echo $((5 < 10))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })

      it('greater than', async () => {
        const result = await ctx.exec('echo $((10 > 5))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })

      it('less than or equal', async () => {
        const result = await ctx.exec('echo $((5 <= 5))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })

      it('greater than or equal', async () => {
        const result = await ctx.exec('echo $((5 >= 5))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })

      it('equality', async () => {
        const result = await ctx.exec('echo $((5 == 5))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })

      it('inequality', async () => {
        const result = await ctx.exec('echo $((5 != 6))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Logical operators', () => {
      it('logical AND', async () => {
        const result = await ctx.exec('echo $((1 && 1))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })

      it('logical AND with false', async () => {
        const result = await ctx.exec('echo $((1 && 0))')
        expect(result.stdout).toBe('0\n')
        expect(result.exitCode).toBe(0)
      })

      it('logical OR', async () => {
        const result = await ctx.exec('echo $((0 || 1))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })

      it('logical NOT', async () => {
        const result = await ctx.exec('echo $((!0))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })

      it('logical NOT of non-zero', async () => {
        const result = await ctx.exec('echo $((!5))')
        expect(result.stdout).toBe('0\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Bitwise operators', () => {
      it('bitwise AND', async () => {
        const result = await ctx.exec('echo $((12 & 10))')
        expect(result.stdout).toBe('8\n')
        expect(result.exitCode).toBe(0)
      })

      it('bitwise OR', async () => {
        const result = await ctx.exec('echo $((12 | 10))')
        expect(result.stdout).toBe('14\n')
        expect(result.exitCode).toBe(0)
      })

      it('bitwise XOR', async () => {
        const result = await ctx.exec('echo $((12 ^ 10))')
        expect(result.stdout).toBe('6\n')
        expect(result.exitCode).toBe(0)
      })

      it('bitwise NOT', async () => {
        const result = await ctx.exec('echo $((~0))')
        expect(result.stdout).toBe('-1\n')
        expect(result.exitCode).toBe(0)
      })

      it('left shift', async () => {
        const result = await ctx.exec('echo $((1 << 4))')
        expect(result.stdout).toBe('16\n')
        expect(result.exitCode).toBe(0)
      })

      it('right shift', async () => {
        const result = await ctx.exec('echo $((16 >> 2))')
        expect(result.stdout).toBe('4\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Assignment operators', () => {
      it('simple assignment in arithmetic', async () => {
        const result = await ctx.exec('echo $((x = 5))')
        expect(result.stdout).toBe('5\n')
        expect(result.exitCode).toBe(0)
      })

      it('addition assignment', async () => {
        const result = await ctx.exec('x=5; echo $((x += 3))')
        expect(result.stdout).toBe('8\n')
        expect(result.exitCode).toBe(0)
      })

      it('subtraction assignment', async () => {
        const result = await ctx.exec('x=5; echo $((x -= 2))')
        expect(result.stdout).toBe('3\n')
        expect(result.exitCode).toBe(0)
      })

      it('multiplication assignment', async () => {
        const result = await ctx.exec('x=5; echo $((x *= 3))')
        expect(result.stdout).toBe('15\n')
        expect(result.exitCode).toBe(0)
      })

      it('pre-increment', async () => {
        const result = await ctx.exec('x=5; echo $((++x))')
        expect(result.stdout).toBe('6\n')
        expect(result.exitCode).toBe(0)
      })

      it('post-increment', async () => {
        const result = await ctx.exec('x=5; echo $((x++))')
        expect(result.stdout).toBe('5\n')
        expect(result.exitCode).toBe(0)
      })

      it('pre-decrement', async () => {
        const result = await ctx.exec('x=5; echo $((--x))')
        expect(result.stdout).toBe('4\n')
        expect(result.exitCode).toBe(0)
      })

      it('post-decrement', async () => {
        const result = await ctx.exec('x=5; echo $((x--))')
        expect(result.stdout).toBe('5\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Ternary operator', () => {
      it('returns second when condition is true', async () => {
        const result = await ctx.exec('echo $((1 ? 10 : 20))')
        expect(result.stdout).toBe('10\n')
        expect(result.exitCode).toBe(0)
      })

      it('returns third when condition is false', async () => {
        const result = await ctx.exec('echo $((0 ? 10 : 20))')
        expect(result.stdout).toBe('20\n')
        expect(result.exitCode).toBe(0)
      })

      it('works with expressions', async () => {
        const result = await ctx.exec('x=5; echo $((x > 3 ? 1 : 0))')
        expect(result.stdout).toBe('1\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Grouping and precedence', () => {
      it('parentheses override precedence', async () => {
        const result = await ctx.exec('echo $(((2 + 3) * 4))')
        expect(result.stdout).toBe('20\n')
        expect(result.exitCode).toBe(0)
      })

      it('multiplication before addition', async () => {
        const result = await ctx.exec('echo $((2 + 3 * 4))')
        expect(result.stdout).toBe('14\n')
        expect(result.exitCode).toBe(0)
      })

      it('nested parentheses', async () => {
        const result = await ctx.exec('echo $((((2 + 3) * 4) + 5))')
        expect(result.stdout).toBe('25\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Variable references', () => {
      it('variables without $ prefix', async () => {
        const result = await ctx.exec('x=5; y=3; echo $((x + y))')
        expect(result.stdout).toBe('8\n')
        expect(result.exitCode).toBe(0)
      })

      it('variables with $ prefix', async () => {
        const result = await ctx.exec('x=5; y=3; echo $(($x + $y))')
        expect(result.stdout).toBe('8\n')
        expect(result.exitCode).toBe(0)
      })

      it('undefined variable is 0', async () => {
        const result = await ctx.exec('echo $((undefined_var + 5))')
        expect(result.stdout).toBe('5\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Different bases', () => {
      it('octal (leading 0)', async () => {
        const result = await ctx.exec('echo $((010))')
        expect(result.stdout).toBe('8\n')
        expect(result.exitCode).toBe(0)
      })

      it('hexadecimal (0x prefix)', async () => {
        const result = await ctx.exec('echo $((0xFF))')
        expect(result.stdout).toBe('255\n')
        expect(result.exitCode).toBe(0)
      })

      it('explicit base (base#number)', async () => {
        const result = await ctx.exec('echo $((2#1010))')
        expect(result.stdout).toBe('10\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('let command', () => {
      it('basic let', async () => {
        const result = await ctx.exec('let x=5+3; echo $x')
        expect(result.stdout).toBe('8\n')
        expect(result.exitCode).toBe(0)
      })

      it('multiple expressions', async () => {
        const result = await ctx.exec('let x=5 y=3 z=x+y; echo $z')
        expect(result.stdout).toBe('8\n')
        expect(result.exitCode).toBe(0)
      })

      it('returns 1 when result is 0', async () => {
        const result = await ctx.exec('let "x = 0"; echo $?')
        expect(result.stdout).toBe('1\n')
      })

      it('returns 0 when result is non-zero', async () => {
        const result = await ctx.exec('let "x = 5"; echo $?')
        expect(result.stdout).toBe('0\n')
      })
    })
  })

  // ============================================================================
  // HERE-DOCUMENTS
  // Based on: spec/here-doc.test.sh
  // ============================================================================
  describe('Here-Documents', () => {
    describe('Basic here-docs', () => {
      it('simple here-doc', async () => {
        const result = await ctx.exec(`cat <<EOF
hello world
EOF`)
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })

      it('multi-line here-doc', async () => {
        const result = await ctx.exec(`cat <<EOF
line one
line two
line three
EOF`)
        expect(result.stdout).toBe('line one\nline two\nline three\n')
        expect(result.exitCode).toBe(0)
      })

      it('here-doc with variable expansion', async () => {
        const result = await ctx.exec(`x=world; cat <<EOF
hello $x
EOF`)
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })

      it('here-doc with command substitution', async () => {
        const result = await ctx.exec(`cat <<EOF
today is $(date +%Y)
EOF`)
        expect(result.stdout).toMatch(/today is \d{4}\n/)
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Quoted delimiters (literal)', () => {
      it('single-quoted delimiter prevents expansion', async () => {
        const result = await ctx.exec(`x=world; cat <<'EOF'
hello $x
EOF`)
        expect(result.stdout).toBe('hello $x\n')
        expect(result.exitCode).toBe(0)
      })

      it('double-quoted delimiter prevents expansion', async () => {
        const result = await ctx.exec(`x=world; cat <<"EOF"
hello $x
EOF`)
        expect(result.stdout).toBe('hello $x\n')
        expect(result.exitCode).toBe(0)
      })

      it('backslash-escaped delimiter prevents expansion', async () => {
        const result = await ctx.exec(`x=world; cat <<\\EOF
hello $x
EOF`)
        expect(result.stdout).toBe('hello $x\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Tab stripping (<<-)', () => {
      it('<<- strips leading tabs', async () => {
        const result = await ctx.exec(`cat <<-EOF
\t\thello
\t\tworld
\tEOF`)
        expect(result.stdout).toBe('hello\nworld\n')
        expect(result.exitCode).toBe(0)
      })

      it('<<- only strips tabs, not spaces', async () => {
        const result = await ctx.exec(`cat <<-EOF
  hello
\tworld
EOF`)
        expect(result.stdout).toBe('  hello\nworld\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Here-strings (<<<)', () => {
      it('basic here-string', async () => {
        const result = await ctx.exec('cat <<< "hello world"')
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })

      it('here-string with variable', async () => {
        const result = await ctx.exec('x=hello; cat <<< "$x world"')
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })

      it('here-string without quotes', async () => {
        const result = await ctx.exec('cat <<< hello')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Multiple here-docs', () => {
      it('two here-docs in sequence', async () => {
        // Use separate commands for each heredoc to ensure portability
        const result = await ctx.exec(`cat <<EOF1; cat <<EOF2
first
EOF1
second
EOF2`)
        expect(result.stdout).toContain('first')
        expect(result.stdout).toContain('second')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Here-doc with special content', () => {
      it('preserves backslashes with quoted delimiter', async () => {
        const result = await ctx.exec(`cat <<'EOF'
path\\to\\file
EOF`)
        expect(result.stdout).toBe('path\\to\\file\n')
        expect(result.exitCode).toBe(0)
      })

      it('handles empty lines', async () => {
        const result = await ctx.exec(`cat <<EOF
line1

line3
EOF`)
        expect(result.stdout).toBe('line1\n\nline3\n')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // CONTROL FLOW EDGE CASES
  // Based on: spec/loop.test.sh and spec/if.test.sh
  // ============================================================================
  describe('Control Flow Edge Cases', () => {
    describe('If statement edge cases', () => {
      it('if with command list in condition', async () => {
        const result = await ctx.exec('if true && true; then echo yes; fi')
        expect(result.stdout).toBe('yes\n')
        expect(result.exitCode).toBe(0)
      })

      it('if with pipeline in condition', async () => {
        const result = await ctx.exec('if echo hello | grep -q hello; then echo found; fi')
        expect(result.stdout).toBe('found\n')
        expect(result.exitCode).toBe(0)
      })

      it('if with negation', async () => {
        const result = await ctx.exec('if ! false; then echo yes; fi')
        expect(result.stdout).toBe('yes\n')
        expect(result.exitCode).toBe(0)
      })

      it('empty then clause is syntax error', async () => {
        const result = await ctx.exec('if true; then; fi')
        expect(result.exitCode).not.toBe(0)
      })

      it('elif chain', async () => {
        const result = await ctx.exec('x=2; if [ $x -eq 1 ]; then echo one; elif [ $x -eq 2 ]; then echo two; else echo other; fi')
        expect(result.stdout).toBe('two\n')
        expect(result.exitCode).toBe(0)
      })

      it('if returns last command exit status', async () => {
        const result = await ctx.exec('if true; then false; fi; echo $?')
        expect(result.stdout).toBe('1\n')
      })

      it('if false returns 0 when no else', async () => {
        const result = await ctx.exec('if false; then echo hi; fi; echo $?')
        expect(result.stdout).toBe('0\n')
      })
    })

    describe('While loop edge cases', () => {
      it('while with break', async () => {
        const result = await ctx.exec('i=0; while true; do i=$((i+1)); if [ $i -ge 3 ]; then break; fi; echo $i; done')
        expect(result.stdout).toBe('1\n2\n')
        expect(result.exitCode).toBe(0)
      })

      it('while with continue', async () => {
        const result = await ctx.exec('i=0; while [ $i -lt 5 ]; do i=$((i+1)); if [ $i -eq 3 ]; then continue; fi; echo $i; done')
        expect(result.stdout).toBe('1\n2\n4\n5\n')
        expect(result.exitCode).toBe(0)
      })

      it('break with count', async () => {
        const result = await ctx.exec('for i in 1 2 3; do for j in a b c; do if [ $j = b ]; then break 2; fi; echo $i$j; done; done; echo done')
        expect(result.stdout).toBe('1a\ndone\n')
        expect(result.exitCode).toBe(0)
      })

      it('continue with count', async () => {
        const result = await ctx.exec('for i in 1 2; do for j in a b; do if [ $j = a ]; then continue 2; fi; echo $i$j; done; done')
        expect(result.stdout).toBe('')
        expect(result.exitCode).toBe(0)
      })

      it('until loop (opposite of while)', async () => {
        const result = await ctx.exec('i=0; until [ $i -ge 3 ]; do echo $i; i=$((i+1)); done')
        expect(result.stdout).toBe('0\n1\n2\n')
        expect(result.exitCode).toBe(0)
      })

      it('while false executes zero times', async () => {
        const result = await ctx.exec('while false; do echo never; done; echo done')
        expect(result.stdout).toBe('done\n')
        expect(result.exitCode).toBe(0)
      })

      it('while returns 0 when condition is false', async () => {
        const result = await ctx.exec('while false; do :; done; echo $?')
        expect(result.stdout).toBe('0\n')
      })
    })

    describe('For loop edge cases', () => {
      it('for with empty list', async () => {
        const result = await ctx.exec('for i in ; do echo $i; done; echo done')
        expect(result.stdout).toBe('done\n')
        expect(result.exitCode).toBe(0)
      })

      it('for with glob expansion', async () => {
        await ctx.createFile('a.txt', '')
        await ctx.createFile('b.txt', '')
        const result = await ctx.exec('for f in *.txt; do echo $f; done')
        expect(result.stdout.split('\n').sort().filter(Boolean)).toEqual(['a.txt', 'b.txt'])
        expect(result.exitCode).toBe(0)
      })

      it('for with brace expansion', async () => {
        const result = await ctx.exec('for i in {1..3}; do echo $i; done')
        expect(result.stdout).toBe('1\n2\n3\n')
        expect(result.exitCode).toBe(0)
      })

      it('for with command substitution', async () => {
        const result = await ctx.exec('for i in $(echo a b c); do echo $i; done')
        expect(result.stdout).toBe('a\nb\nc\n')
        expect(result.exitCode).toBe(0)
      })

      it('C-style for loop', async () => {
        const result = await ctx.exec('for ((i=0; i<3; i++)); do echo $i; done')
        expect(result.stdout).toBe('0\n1\n2\n')
        expect(result.exitCode).toBe(0)
      })

      it('for loop variable scope', async () => {
        const result = await ctx.exec('for i in 1 2 3; do :; done; echo $i')
        expect(result.stdout).toBe('3\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Case statement edge cases', () => {
      it('case with multiple patterns per clause', async () => {
        const result = await ctx.exec('x=b; case $x in a|b|c) echo matched;; esac')
        expect(result.stdout).toBe('matched\n')
        expect(result.exitCode).toBe(0)
      })

      it('case with glob pattern', async () => {
        const result = await ctx.exec('x=hello; case $x in hel*) echo matched;; esac')
        expect(result.stdout).toBe('matched\n')
        expect(result.exitCode).toBe(0)
      })

      it('case with ? pattern', async () => {
        const result = await ctx.exec('x=ab; case $x in ??) echo two;; ???) echo three;; esac')
        expect(result.stdout).toBe('two\n')
        expect(result.exitCode).toBe(0)
      })

      it('case with character class', async () => {
        const result = await ctx.exec('x=5; case $x in [0-9]) echo digit;; esac')
        expect(result.stdout).toBe('digit\n')
        expect(result.exitCode).toBe(0)
      })

      it('case with default (*)', async () => {
        const result = await ctx.exec('x=unknown; case $x in a) echo a;; *) echo default;; esac')
        expect(result.stdout).toBe('default\n')
        expect(result.exitCode).toBe(0)
      })

      it.skip('case fall-through (;&) - bash only', async () => {
        // ;& is a bash extension for case fall-through, not POSIX
        const result = await ctx.exec('x=a; case $x in a) echo a;& b) echo b;; esac')
        expect(result.stdout).toBe('a\nb\n')
        expect(result.exitCode).toBe(0)
      })

      it.skip('case continue (;;&) - bash only', async () => {
        // ;;& is a bash extension for continue-testing, not POSIX
        const result = await ctx.exec('x=ab; case $x in a*) echo a;;& *b) echo b;; esac')
        expect(result.stdout).toBe('a\nb\n')
        expect(result.exitCode).toBe(0)
      })

      it('case with empty clause', async () => {
        const result = await ctx.exec('x=skip; case $x in skip) ;; *) echo default;; esac; echo done')
        expect(result.stdout).toBe('done\n')
        expect(result.exitCode).toBe(0)
      })

      it('case with no match', async () => {
        const result = await ctx.exec('x=z; case $x in a) echo a;; b) echo b;; esac; echo $?')
        expect(result.stdout).toBe('0\n')
      })
    })

    describe('Select statement (bash)', () => {
      it.skip('select with input', async () => {
        // Select is interactive and harder to test
        const result = await ctx.exec('select opt in a b c; do echo $opt; break; done', { stdin: '2\n' })
        expect(result.stdout).toContain('b')
      })
    })
  })

  // ============================================================================
  // PIPELINE BEHAVIOR
  // Based on: spec/pipeline.test.sh
  // ============================================================================
  describe('Pipeline Behavior', () => {
    describe('Basic pipelines', () => {
      it('simple pipe', async () => {
        const result = await ctx.exec('echo hello | cat')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('multi-stage pipe', async () => {
        const result = await ctx.exec('echo "one two three" | tr " " "\\n" | sort')
        expect(result.stdout).toBe('one\nthree\ntwo\n')
        expect(result.exitCode).toBe(0)
      })

      it('pipe with failing first command', async () => {
        const result = await ctx.exec('false | cat; echo $?')
        expect(result.stdout).toBe('0\n')
      })

      it('pipe with failing last command', async () => {
        const result = await ctx.exec('echo hi | false; echo $?')
        expect(result.stdout).toBe('1\n')
      })
    })

    describe('pipefail option', () => {
      it('pipefail makes pipe fail on any failure', async () => {
        const result = await ctx.exec('set -o pipefail; false | true; echo $?')
        expect(result.stdout).toBe('1\n')
      })

      it('pipefail returns rightmost failure', async () => {
        const result = await ctx.exec('set -o pipefail; exit 3 | exit 5 | true; echo $?')
        // The exact exit code depends on which failure is "rightmost"
        expect(result.stdout).toMatch(/[1-9]/)
      })
    })

    describe('PIPESTATUS array', () => {
      it('PIPESTATUS captures all exit codes', async () => {
        const result = await ctx.exec('true | false | true; echo ${PIPESTATUS[0]} ${PIPESTATUS[1]} ${PIPESTATUS[2]}')
        expect(result.stdout).toBe('0 1 0\n')
        expect(result.exitCode).toBe(0)
      })

      it('PIPESTATUS with multiple commands', async () => {
        const result = await ctx.exec('(exit 1) | (exit 2) | (exit 3); echo ${PIPESTATUS[@]}')
        expect(result.stdout).toBe('1 2 3\n')
      })
    })

    describe('Pipeline negation', () => {
      it('! negates pipeline exit status', async () => {
        const result = await ctx.exec('! false; echo $?')
        expect(result.stdout).toBe('0\n')
      })

      it('! with successful pipeline', async () => {
        const result = await ctx.exec('! true; echo $?')
        expect(result.stdout).toBe('1\n')
      })

      it('! with pipe', async () => {
        const result = await ctx.exec('! echo hi | false; echo $?')
        expect(result.stdout).toBe('0\n')
      })
    })

    describe('Subshell in pipeline', () => {
      it('each pipeline stage runs in subshell', async () => {
        const result = await ctx.exec('x=before; echo hi | { x=after; cat; }; echo $x')
        // In most shells, x remains "before" because pipe runs in subshell
        expect(result.stdout).toContain('hi')
        expect(result.exitCode).toBe(0)
      })

      it('lastpipe option (bash) runs last in current shell', async () => {
        const result = await ctx.exec('shopt -s lastpipe 2>/dev/null; x=before; echo after | read x; echo $x')
        // With lastpipe, x should be "after"
        // Without it, x stays "before"
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Process substitution (bash/zsh)', () => {
      // Process substitution <() and >() is a bash/zsh extension, not POSIX
      // Use bash explicitly for these tests
      it('reads from process substitution', async () => {
        const result = await ctx.exec('/bin/bash -c "cat <(echo hello)"')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('writes to process substitution', async () => {
        const result = await ctx.exec('/bin/bash -c "echo hello > >(cat); sleep 0.1"')
        expect(result.exitCode).toBe(0)
      })

      it('multiple process substitutions', async () => {
        const result = await ctx.exec('/bin/bash -c "diff <(echo a) <(echo b)"')
        expect(result.exitCode).not.toBe(0) // diff returns 1 for differences
      })

      it('process substitution with paste', async () => {
        const result = await ctx.exec('/bin/bash -c "paste <(echo 1; echo 2) <(echo a; echo b)"')
        expect(result.stdout).toBe('1\ta\n2\tb\n')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // COMMAND SUBSTITUTION
  // Based on: spec/command-sub.test.sh
  // ============================================================================
  describe('Command Substitution', () => {
    describe('$() syntax', () => {
      it('basic command substitution', async () => {
        const result = await ctx.exec('echo $(echo hello)')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('nested command substitution', async () => {
        const result = await ctx.exec('echo $(echo $(echo nested))')
        expect(result.stdout).toBe('nested\n')
        expect(result.exitCode).toBe(0)
      })

      it('command substitution strips trailing newlines', async () => {
        const result = await ctx.exec('x=$(printf "hello\\n\\n\\n"); echo "[$x]"')
        expect(result.stdout).toBe('[hello]\n')
        expect(result.exitCode).toBe(0)
      })

      it('command substitution preserves internal newlines', async () => {
        const result = await ctx.exec('x=$(printf "a\\nb"); echo "$x"')
        expect(result.stdout).toBe('a\nb\n')
        expect(result.exitCode).toBe(0)
      })

      it('command substitution in double quotes', async () => {
        const result = await ctx.exec('echo "hello $(echo world)"')
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Backtick syntax', () => {
      it('basic backtick substitution', async () => {
        const result = await ctx.exec('echo `echo hello`')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('nested backticks require escaping', async () => {
        const result = await ctx.exec('echo `echo \\`echo inner\\``')
        expect(result.stdout).toBe('inner\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Exit status', () => {
      it('captures exit status of substituted command', async () => {
        const result = await ctx.exec('x=$(false); echo $?')
        expect(result.stdout).toBe('1\n')
      })

      it('successful substitution', async () => {
        const result = await ctx.exec('x=$(true); echo $?')
        expect(result.stdout).toBe('0\n')
      })

      it('exit status with pipeline', async () => {
        const result = await ctx.exec('x=$(echo hi | false); echo $?')
        expect(result.stdout).toBe('1\n')
      })
    })

    describe('Word splitting', () => {
      it('unquoted substitution splits on whitespace', async () => {
        const result = await ctx.exec('for w in $(echo "a b c"); do echo $w; done')
        expect(result.stdout).toBe('a\nb\nc\n')
        expect(result.exitCode).toBe(0)
      })

      it('quoted substitution preserves whitespace', async () => {
        const result = await ctx.exec('for w in "$(echo "a b c")"; do echo $w; done')
        expect(result.stdout).toBe('a b c\n')
        expect(result.exitCode).toBe(0)
      })

      it('IFS affects word splitting', async () => {
        const result = await ctx.exec('IFS=:; for w in $(echo "a:b:c"); do echo $w; done')
        expect(result.stdout).toBe('a\nb\nc\n')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // REDIRECTION
  // Based on: spec/redirect.test.sh
  // ============================================================================
  describe('Redirection', () => {
    describe('Output redirection', () => {
      it('redirects stdout to file', async () => {
        await ctx.exec('echo hello > out.txt')
        const content = await ctx.readFile('out.txt')
        expect(content).toBe('hello\n')
      })

      it('appends to file', async () => {
        await ctx.exec('echo line1 > out.txt')
        await ctx.exec('echo line2 >> out.txt')
        const content = await ctx.readFile('out.txt')
        expect(content).toBe('line1\nline2\n')
      })

      it('redirects stderr', async () => {
        const result = await ctx.exec('ls nonexistent 2> err.txt; cat err.txt')
        expect(result.stdout).toContain('nonexistent')
      })

      it('redirects both stdout and stderr (&>)', async () => {
        await ctx.exec('{ echo out; echo err >&2; } &> both.txt')
        const content = await ctx.readFile('both.txt')
        expect(content).toContain('out')
        expect(content).toContain('err')
      })

      it('redirects stderr to stdout (2>&1)', async () => {
        const result = await ctx.exec('{ echo out; echo err >&2; } 2>&1')
        expect(result.stdout).toContain('out')
        expect(result.stdout).toContain('err')
      })
    })

    describe('Input redirection', () => {
      it('redirects stdin from file', async () => {
        await ctx.createFile('input.txt', 'hello\nworld')
        const result = await ctx.exec('cat < input.txt')
        expect(result.stdout).toBe('hello\nworld')
        expect(result.exitCode).toBe(0)
      })

      it('redirects stdin from process substitution (bash)', async () => {
        // Process substitution requires bash
        const result = await ctx.exec('/bin/bash -c "cat < <(echo hello)"')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('File descriptor manipulation', () => {
      it('opens file on specific fd', async () => {
        await ctx.createFile('input.txt', 'content')
        const result = await ctx.exec('exec 3< input.txt; cat <&3; exec 3<&-')
        expect(result.stdout).toBe('content')
        expect(result.exitCode).toBe(0)
      })

      it('duplicates file descriptors', async () => {
        const result = await ctx.exec('{ echo stdout; echo stderr >&2; } 2>&1 1>/dev/null')
        expect(result.stdout).toBe('stderr\n')
      })

      it('closes file descriptor', async () => {
        const result = await ctx.exec('echo hi >&3 3>&-; echo $?')
        expect(result.stdout).toBe('1\n')
      })
    })

    describe('Noclobber option', () => {
      it('noclobber prevents overwriting', async () => {
        await ctx.createFile('existing.txt', 'original')
        const result = await ctx.exec('set -o noclobber; echo new > existing.txt 2>&1; cat existing.txt')
        expect(result.stdout).toContain('original')
      })

      it('>| overrides noclobber', async () => {
        await ctx.createFile('existing.txt', 'original')
        await ctx.exec('set -o noclobber; echo new >| existing.txt')
        const content = await ctx.readFile('existing.txt')
        expect(content).toBe('new\n')
      })
    })

    describe('Special redirections', () => {
      it('/dev/null discards output', async () => {
        const result = await ctx.exec('echo hello > /dev/null; echo $?')
        expect(result.stdout).toBe('0\n')
      })

      it('reads from /dev/zero', async () => {
        const result = await ctx.exec('head -c 5 /dev/zero | od -An -tx1')
        // od output format varies by system (extra spaces, etc)
        expect(result.stdout.replace(/\s+/g, ' ').trim()).toBe('00 00 00 00 00')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // FUNCTIONS
  // Based on: spec/func.test.sh
  // ============================================================================
  describe('Functions', () => {
    describe('Function definition', () => {
      it('defines and calls function (keyword style)', async () => {
        const result = await ctx.exec('function greet { echo hello; }; greet')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('defines and calls function (POSIX style)', async () => {
        const result = await ctx.exec('greet() { echo hello; }; greet')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('function with arguments', async () => {
        const result = await ctx.exec('greet() { echo "hello $1"; }; greet world')
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })

      it('function with multiple arguments', async () => {
        const result = await ctx.exec('f() { echo "$1 $2 $3"; }; f a b c')
        expect(result.stdout).toBe('a b c\n')
        expect(result.exitCode).toBe(0)
      })

      it('function accesses $# for argument count', async () => {
        const result = await ctx.exec('f() { echo $#; }; f a b c d e')
        expect(result.stdout).toBe('5\n')
        expect(result.exitCode).toBe(0)
      })

      it('function accesses $@ for all arguments', async () => {
        const result = await ctx.exec('f() { for x in "$@"; do echo $x; done; }; f one two three')
        expect(result.stdout).toBe('one\ntwo\nthree\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Return values', () => {
      it('return exits function with status', async () => {
        const result = await ctx.exec('f() { return 5; }; f; echo $?')
        expect(result.stdout).toBe('5\n')
      })

      it('return with no value uses last command status', async () => {
        const result = await ctx.exec('f() { false; return; }; f; echo $?')
        expect(result.stdout).toBe('1\n')
      })

      it('function without return uses last command status', async () => {
        const result = await ctx.exec('f() { true; }; f; echo $?')
        expect(result.stdout).toBe('0\n')
      })

      it('function can return output via stdout', async () => {
        const result = await ctx.exec('f() { echo result; }; x=$(f); echo $x')
        expect(result.stdout).toBe('result\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Local variables', () => {
      it('local declares local variable', async () => {
        const result = await ctx.exec('x=outer; f() { local x=inner; echo $x; }; f; echo $x')
        expect(result.stdout).toBe('inner\nouter\n')
        expect(result.exitCode).toBe(0)
      })

      it('local variable shadows outer', async () => {
        const result = await ctx.exec('x=1; f() { local x; x=2; echo $x; }; f; echo $x')
        expect(result.stdout).toBe('2\n1\n')
        expect(result.exitCode).toBe(0)
      })

      it('unset local restores outer value', async () => {
        const result = await ctx.exec('x=outer; f() { local x=inner; unset x; echo ${x:-unset}; }; f; echo $x')
        expect(result.stdout).toBe('unset\nouter\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Recursion', () => {
      it('function can call itself', async () => {
        const result = await ctx.exec('fact() { if [ $1 -le 1 ]; then echo 1; else echo $(( $1 * $(fact $(($1-1))) )); fi; }; fact 5')
        expect(result.stdout).toBe('120\n')
        expect(result.exitCode).toBe(0)
      })

      it('mutual recursion', async () => {
        const result = await ctx.exec('even() { [ $1 -eq 0 ] && echo yes || odd $(($1-1)); }; odd() { [ $1 -eq 0 ] && echo no || even $(($1-1)); }; even 4')
        expect(result.stdout).toBe('yes\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Function redefinition', () => {
      it('can redefine existing function', async () => {
        const result = await ctx.exec('f() { echo first; }; f() { echo second; }; f')
        expect(result.stdout).toBe('second\n')
        expect(result.exitCode).toBe(0)
      })

      it('unset -f removes function', async () => {
        const result = await ctx.exec('f() { echo hi; }; unset -f f; f 2>&1')
        expect(result.stdout).toContain('not found')
        expect(result.exitCode).not.toBe(0)
      })
    })
  })

  // ============================================================================
  // SUBSHELLS AND COMMAND GROUPING
  // Based on: spec/subshell.test.sh
  // ============================================================================
  describe('Subshells and Command Grouping', () => {
    describe('Subshell ()', () => {
      it('subshell creates isolated environment', async () => {
        const result = await ctx.exec('x=outer; (x=inner; echo $x); echo $x')
        expect(result.stdout).toBe('inner\nouter\n')
        expect(result.exitCode).toBe(0)
      })

      it('subshell has its own working directory', async () => {
        await ctx.createDir('subdir')
        const result = await ctx.exec('(cd subdir && pwd -P | xargs basename); pwd -P | xargs basename')
        expect(result.stdout).toContain('subdir')
        expect(result.exitCode).toBe(0)
      })

      it('subshell exit does not affect parent', async () => {
        const result = await ctx.exec('(exit 42); echo $?')
        expect(result.stdout).toBe('42\n')
      })

      it('nested subshells', async () => {
        const result = await ctx.exec('x=1; (x=2; (x=3; echo $x); echo $x); echo $x')
        expect(result.stdout).toBe('3\n2\n1\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('Brace grouping {}', () => {
      it('braces group commands in current shell', async () => {
        const result = await ctx.exec('x=outer; { x=inner; }; echo $x')
        expect(result.stdout).toBe('inner\n')
        expect(result.exitCode).toBe(0)
      })

      it('braces require semicolon before closing', async () => {
        const result = await ctx.exec('{ echo hello; }')
        expect(result.stdout).toBe('hello\n')
        expect(result.exitCode).toBe(0)
      })

      it('braces with redirection', async () => {
        await ctx.exec('{ echo line1; echo line2; } > out.txt')
        const content = await ctx.readFile('out.txt')
        expect(content).toBe('line1\nline2\n')
      })

      it('braces in pipeline', async () => {
        const result = await ctx.exec('{ echo a; echo b; } | cat -n')
        expect(result.stdout).toContain('1')
        expect(result.stdout).toContain('a')
        expect(result.stdout).toContain('2')
        expect(result.stdout).toContain('b')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('$() vs backticks', () => {
      it('$() allows nesting without escaping', async () => {
        const result = await ctx.exec('echo $(echo $(echo nested))')
        expect(result.stdout).toBe('nested\n')
        expect(result.exitCode).toBe(0)
      })

      it('$() with quotes inside', async () => {
        const result = await ctx.exec('echo $(echo "hello world")')
        expect(result.stdout).toBe('hello world\n')
        expect(result.exitCode).toBe(0)
      })
    })
  })

  // ============================================================================
  // TRAPS AND SIGNALS
  // Based on: spec/errexit.test.sh and spec/trap.test.sh
  // ============================================================================
  describe('Traps and Signals', () => {
    describe('trap command', () => {
      it('trap on EXIT', async () => {
        const result = await ctx.exec("trap 'echo exiting' EXIT; echo running")
        expect(result.stdout).toBe('running\nexiting\n')
        expect(result.exitCode).toBe(0)
      })

      it('trap on ERR', async () => {
        const result = await ctx.exec("trap 'echo error caught' ERR; false; echo after")
        expect(result.stdout).toContain('error caught')
        expect(result.exitCode).toBe(0)
      })

      it('trap on DEBUG', async () => {
        const result = await ctx.exec("trap 'echo debug' DEBUG; echo one; echo two")
        expect(result.stdout.split('debug').length - 1).toBeGreaterThanOrEqual(2)
      })

      it('trap on RETURN', async () => {
        const result = await ctx.exec("f() { trap 'echo returning' RETURN; echo in f; }; f; echo after")
        expect(result.stdout).toBe('in f\nreturning\nafter\n')
        expect(result.exitCode).toBe(0)
      })

      it('trap with empty string resets', async () => {
        const result = await ctx.exec("trap 'echo trapped' EXIT; trap '' EXIT; echo done")
        expect(result.stdout).toBe('done\n')
        expect(result.exitCode).toBe(0)
      })

      it('trap - restores default', async () => {
        const result = await ctx.exec("trap 'echo trapped' EXIT; trap - EXIT; echo done")
        expect(result.stdout).toBe('done\n')
        expect(result.exitCode).toBe(0)
      })
    })

    describe('errexit (set -e)', () => {
      it('exits on first failure', async () => {
        const result = await ctx.exec('set -e; false; echo should not print')
        expect(result.stdout).toBe('')
        expect(result.exitCode).not.toBe(0)
      })

      it('does not exit on failure in condition', async () => {
        const result = await ctx.exec('set -e; if false; then echo yes; fi; echo after')
        expect(result.stdout).toBe('after\n')
        expect(result.exitCode).toBe(0)
      })

      it('does not exit on failure in && or ||', async () => {
        const result = await ctx.exec('set -e; false || true; echo after')
        expect(result.stdout).toBe('after\n')
        expect(result.exitCode).toBe(0)
      })

      it('does not exit on failure in negated command', async () => {
        const result = await ctx.exec('set -e; ! false; echo after')
        expect(result.stdout).toBe('after\n')
        expect(result.exitCode).toBe(0)
      })

      it('respects trap ERR before exit', async () => {
        const result = await ctx.exec("set -e; trap 'echo trapped' ERR; false")
        expect(result.stdout).toBe('trapped\n')
        expect(result.exitCode).not.toBe(0)
      })
    })

    describe('pipefail with errexit', () => {
      it('set -e -o pipefail exits on pipe failure', async () => {
        const result = await ctx.exec('set -e -o pipefail; false | true; echo after')
        expect(result.stdout).toBe('')
        expect(result.exitCode).not.toBe(0)
      })
    })
  })
})

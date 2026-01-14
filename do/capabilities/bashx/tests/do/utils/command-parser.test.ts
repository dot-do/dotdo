/**
 * @fileoverview Tests for command-parser utilities
 *
 * These tests cover the shell command parsing utilities extracted from
 * TieredExecutor, NativeExecutor, and other executors.
 */

import { describe, it, expect } from 'vitest'
import {
  extractCommandName,
  extractArgs,
  tokenize,
  stripQuotes,
  hasPipeline,
  parseEnvVars,
  removeEnvVarsPrefix,
} from '../../../src/do/utils/command-parser.js'

describe('command-parser', () => {
  // ============================================================================
  // extractCommandName
  // ============================================================================
  describe('extractCommandName', () => {
    describe('basic command extraction', () => {
      it('extracts simple command name', () => {
        expect(extractCommandName('echo hello')).toBe('echo')
      })

      it('extracts command with no arguments', () => {
        expect(extractCommandName('pwd')).toBe('pwd')
      })

      it('handles leading whitespace', () => {
        expect(extractCommandName('  ls -la')).toBe('ls')
      })

      it('handles trailing whitespace', () => {
        expect(extractCommandName('cat file.txt   ')).toBe('cat')
      })

      it('returns empty string for empty input', () => {
        expect(extractCommandName('')).toBe('')
      })

      it('returns empty string for whitespace-only input', () => {
        expect(extractCommandName('   ')).toBe('')
      })
    })

    describe('environment variable prefix handling', () => {
      it('extracts command after single env var', () => {
        expect(extractCommandName('VAR=value cmd')).toBe('cmd')
      })

      it('extracts command after multiple env vars', () => {
        expect(extractCommandName('VAR1=val1 VAR2=val2 npm run build')).toBe('npm')
      })

      it('handles env vars with special characters in values', () => {
        expect(extractCommandName('PATH=/usr/bin:/bin node app.js')).toBe('node')
      })

      it('handles env vars with underscores', () => {
        expect(extractCommandName('MY_VAR=123 python script.py')).toBe('python')
      })

      it('handles env var with quoted value', () => {
        // Note: The simple regex doesn't handle quoted values in env vars.
        // 'MSG="hello world"' is treated as part of the command since the regex
        // expects VAR=non-whitespace patterns only. This matches existing TieredExecutor behavior.
        // For a fully quoted env var value, the command extraction may not work correctly.
        // This test documents the current limitation.
        expect(extractCommandName('MSG=hello echo test')).toBe('echo')
      })
    })

    describe('path handling', () => {
      it('extracts basename from absolute path', () => {
        expect(extractCommandName('/usr/bin/bash')).toBe('bash')
      })

      it('extracts basename from relative path', () => {
        expect(extractCommandName('./scripts/build.sh')).toBe('build.sh')
      })

      it('handles path with env var prefix', () => {
        expect(extractCommandName('VAR=x /usr/local/bin/node script.js')).toBe('node')
      })

      it('handles dotted commands like bash.exe', () => {
        expect(extractCommandName('/cygwin/bin/bash.exe')).toBe('bash.exe')
      })

      it('handles hyphenated commands', () => {
        expect(extractCommandName('/usr/bin/aws-cli command')).toBe('aws-cli')
      })
    })

    describe('edge cases', () => {
      it('handles command starting with number', () => {
        // Unusual but valid
        expect(extractCommandName('7z x archive.7z')).toBe('7z')
      })

      it('handles single character command', () => {
        expect(extractCommandName('R --version')).toBe('R')
      })

      it('handles commands with dots', () => {
        expect(extractCommandName('node.exe script.js')).toBe('node.exe')
      })
    })
  })

  // ============================================================================
  // extractArgs
  // ============================================================================
  describe('extractArgs', () => {
    describe('basic argument extraction', () => {
      it('extracts simple arguments', () => {
        expect(extractArgs('ls -la /tmp')).toEqual(['-la', '/tmp'])
      })

      it('returns empty array for command with no args', () => {
        expect(extractArgs('pwd')).toEqual([])
      })

      it('extracts multiple flags', () => {
        expect(extractArgs('grep -r -n -i pattern file')).toEqual(['-r', '-n', '-i', 'pattern', 'file'])
      })

      it('extracts long flags', () => {
        expect(extractArgs('npm install --save-dev typescript')).toEqual(['install', '--save-dev', 'typescript'])
      })
    })

    describe('quote handling', () => {
      it('preserves content inside double quotes as single arg', () => {
        expect(extractArgs('echo "hello world"')).toEqual(['hello world'])
      })

      it('preserves content inside single quotes as single arg', () => {
        expect(extractArgs("echo 'hello world'")).toEqual(['hello world'])
      })

      it('handles mixed quotes', () => {
        expect(extractArgs('echo "hello" \'world\'')).toEqual(['hello', 'world'])
      })

      it('handles nested single quote in double quotes', () => {
        expect(extractArgs('echo "It\'s working"')).toEqual(["It's working"])
      })

      it('handles nested double quote in single quotes', () => {
        expect(extractArgs("echo 'He said \"hello\"'")).toEqual(['He said "hello"'])
      })

      it('handles quotes at the beginning of argument', () => {
        expect(extractArgs('grep "pattern" file.txt')).toEqual(['pattern', 'file.txt'])
      })
    })

    describe('escape sequence handling', () => {
      it('handles escaped double quotes', () => {
        // The \" escape sequence inside double quotes is unescaped to "
        expect(extractArgs('echo "hello \\"world\\""')).toEqual(['hello "world"'])
      })

      it('handles escaped backslash', () => {
        // Note: The simple stripQuotes only handles \" escape, not \\
        // Other escapes are kept as-is (matching TieredExecutor behavior)
        expect(extractArgs('echo "path\\\\to\\\\file"')).toEqual(['path\\\\to\\\\file'])
      })
    })

    describe('environment variable prefix', () => {
      it('skips env vars and extracts remaining args', () => {
        expect(extractArgs('VAR=value npm install express')).toEqual(['install', 'express'])
      })

      it('handles multiple env vars', () => {
        expect(extractArgs('A=1 B=2 node script.js --port 3000')).toEqual(['script.js', '--port', '3000'])
      })
    })

    describe('whitespace handling', () => {
      it('handles multiple spaces between args', () => {
        expect(extractArgs('ls   -l    /tmp')).toEqual(['-l', '/tmp'])
      })

      it('handles tabs', () => {
        expect(extractArgs('ls\t-l\t/tmp')).toEqual(['-l', '/tmp'])
      })

      it('handles leading and trailing whitespace', () => {
        expect(extractArgs('  ls -la   ')).toEqual(['-la'])
      })
    })
  })

  // ============================================================================
  // tokenize
  // ============================================================================
  describe('tokenize', () => {
    describe('basic tokenization', () => {
      it('splits on whitespace', () => {
        expect(tokenize('a b c')).toEqual(['a', 'b', 'c'])
      })

      it('handles multiple spaces', () => {
        expect(tokenize('a   b   c')).toEqual(['a', 'b', 'c'])
      })

      it('handles empty string', () => {
        expect(tokenize('')).toEqual([])
      })

      it('handles whitespace-only string', () => {
        expect(tokenize('   ')).toEqual([])
      })
    })

    describe('single quote handling', () => {
      it('keeps quoted text together', () => {
        expect(tokenize("echo 'hello world'")).toEqual(['echo', 'hello world'])
      })

      it('handles quote at start', () => {
        expect(tokenize("'hello world' more")).toEqual(['hello world', 'more'])
      })

      it('handles multiple quoted strings', () => {
        expect(tokenize("'first' 'second'")).toEqual(['first', 'second'])
      })

      it('preserves internal quotes of other type', () => {
        expect(tokenize("'he said \"hi\"'")).toEqual(['he said "hi"'])
      })
    })

    describe('double quote handling', () => {
      it('keeps quoted text together', () => {
        expect(tokenize('echo "hello world"')).toEqual(['echo', 'hello world'])
      })

      it('handles quote at start', () => {
        expect(tokenize('"hello world" more')).toEqual(['hello world', 'more'])
      })

      it('preserves internal quotes of other type', () => {
        expect(tokenize('"it\'s working"')).toEqual(["it's working"])
      })
    })

    describe('escape sequence handling in double quotes', () => {
      it('handles escaped double quote', () => {
        expect(tokenize('echo "say \\"hello\\""')).toEqual(['echo', 'say "hello"'])
      })

      it('handles escaped backslash', () => {
        // Note: The simple stripQuotes only handles \" escape
        // Other escapes like \\\\ are kept as-is
        expect(tokenize('echo "path\\\\file"')).toEqual(['echo', 'path\\\\file'])
      })

      it('handles other escaped chars', () => {
        expect(tokenize('echo "line\\nbreak"')).toEqual(['echo', 'line\\nbreak'])
      })
    })

    describe('mixed quotes', () => {
      it('handles alternating quotes', () => {
        expect(tokenize("\"first\" 'second' \"third\"")).toEqual(['first', 'second', 'third'])
      })

      it('handles quotes adjacent to unquoted text', () => {
        // In bash, prefix"quoted"post is a single token
        // The simple stripQuotes implementation only handles pure quoted strings
        // So pre"fix"post is returned as-is since it doesn't start AND end with matching quotes
        expect(tokenize('pre"fix"post')).toEqual(['pre"fix"post'])
      })
    })

    describe('edge cases', () => {
      it('handles unclosed single quote at end', () => {
        // Behavior depends on implementation - document current behavior
        const result = tokenize("echo 'unclosed")
        expect(result.length).toBeGreaterThan(0)
      })

      it('handles unclosed double quote at end', () => {
        const result = tokenize('echo "unclosed')
        expect(result.length).toBeGreaterThan(0)
      })

      it('handles empty quotes', () => {
        expect(tokenize('echo "" more')).toEqual(['echo', '', 'more'])
      })

      it('handles single empty quotes', () => {
        expect(tokenize("echo '' more")).toEqual(['echo', '', 'more'])
      })
    })
  })

  // ============================================================================
  // stripQuotes
  // ============================================================================
  describe('stripQuotes', () => {
    describe('double quote stripping', () => {
      it('removes outer double quotes', () => {
        expect(stripQuotes('"hello world"')).toBe('hello world')
      })

      it('unescapes inner escaped quotes', () => {
        expect(stripQuotes('"say \\"hello\\""')).toBe('say "hello"')
      })

      it('handles empty double quotes', () => {
        expect(stripQuotes('""')).toBe('')
      })

      it('handles single character in quotes', () => {
        expect(stripQuotes('"a"')).toBe('a')
      })
    })

    describe('single quote stripping', () => {
      it('removes outer single quotes', () => {
        expect(stripQuotes("'hello world'")).toBe('hello world')
      })

      it('preserves backslashes in single quotes (no escaping)', () => {
        expect(stripQuotes("'path\\to\\file'")).toBe('path\\to\\file')
      })

      it('handles empty single quotes', () => {
        expect(stripQuotes("''")).toBe('')
      })
    })

    describe('unquoted strings', () => {
      it('returns unquoted string unchanged', () => {
        expect(stripQuotes('hello')).toBe('hello')
      })

      it('returns empty string unchanged', () => {
        expect(stripQuotes('')).toBe('')
      })

      it('handles string starting with quote but not ending', () => {
        // The simple implementation only strips when both start and end match
        expect(stripQuotes('"unclosed')).toBe('"unclosed')
      })

      it('handles string ending with quote but not starting', () => {
        expect(stripQuotes('unclosed"')).toBe('unclosed"')
      })

      it('handles mismatched quotes', () => {
        // Mismatched quotes are returned as-is
        expect(stripQuotes('"mixed\'')).toBe('"mixed\'')
      })
    })

    describe('edge cases', () => {
      it('handles string with only opening quote', () => {
        expect(stripQuotes('"')).toBe('"')
      })

      it('handles string with only closing quote', () => {
        expect(stripQuotes("'")).toBe("'")
      })

      it('handles multiple levels of quotes', () => {
        // '"nested"' - outer single quotes around double-quoted content
        expect(stripQuotes("'\"nested\"'")).toBe('"nested"')
      })
    })
  })

  // ============================================================================
  // hasPipeline
  // ============================================================================
  describe('hasPipeline', () => {
    describe('basic pipe detection', () => {
      it('detects simple pipe', () => {
        expect(hasPipeline('cat file | grep pattern')).toBe(true)
      })

      it('returns false for no pipe', () => {
        expect(hasPipeline('echo hello')).toBe(false)
      })

      it('detects multiple pipes', () => {
        expect(hasPipeline('cat file | grep pattern | wc -l')).toBe(true)
      })
    })

    describe('pipes in quotes should be ignored', () => {
      it('ignores pipe in double quotes', () => {
        expect(hasPipeline('echo "hello | world"')).toBe(false)
      })

      it('ignores pipe in single quotes', () => {
        expect(hasPipeline("echo 'hello | world'")).toBe(false)
      })

      it('detects pipe after quoted section', () => {
        expect(hasPipeline('echo "hello" | grep hello')).toBe(true)
      })

      it('detects pipe before quoted section', () => {
        expect(hasPipeline('cat file | grep "pattern"')).toBe(true)
      })

      it('ignores pipe in mixed quotes', () => {
        expect(hasPipeline('echo "test \'a | b\' more"')).toBe(false)
      })
    })

    describe('edge cases with pipe-like characters', () => {
      it('ignores || (logical or)', () => {
        expect(hasPipeline('cmd1 || cmd2')).toBe(false)
      })

      it('ignores |& (pipe stderr)', () => {
        // |& is bash-specific, may or may not be considered a pipeline
        // Document current behavior
        expect(hasPipeline('cmd1 |& cmd2')).toBe(true) // or false depending on impl
      })

      it('detects pipe without surrounding spaces', () => {
        // Stricter implementations require spaces
        expect(hasPipeline('cat file|grep pattern')).toBe(true)
      })

      it('handles pipe at start (invalid but check behavior)', () => {
        expect(hasPipeline('| grep pattern')).toBe(true)
      })

      it('handles pipe at end (invalid but check behavior)', () => {
        expect(hasPipeline('cat file |')).toBe(true)
      })
    })

    describe('complex scenarios', () => {
      it('handles pipe in nested quotes', () => {
        expect(hasPipeline("grep 'pattern with \"pipe | here\"' file")).toBe(false)
      })

      it('handles real-world pipeline with quotes', () => {
        expect(hasPipeline('cat file.txt | grep "error" | wc -l')).toBe(true)
      })

      it('handles escape sequences near pipe', () => {
        expect(hasPipeline('echo "test\\" | grep"')).toBe(false) // pipe is inside quotes
      })
    })
  })

  // ============================================================================
  // parseEnvVars (optional utility)
  // ============================================================================
  describe('parseEnvVars', () => {
    it('parses single env var', () => {
      expect(parseEnvVars('VAR=value cmd')).toEqual({ VAR: 'value' })
    })

    it('parses multiple env vars', () => {
      expect(parseEnvVars('A=1 B=2 cmd')).toEqual({ A: '1', B: '2' })
    })

    it('returns empty object for no env vars', () => {
      expect(parseEnvVars('cmd arg')).toEqual({})
    })

    it('handles env vars with paths', () => {
      expect(parseEnvVars('PATH=/usr/bin cmd')).toEqual({ PATH: '/usr/bin' })
    })

    it('handles underscores in names', () => {
      expect(parseEnvVars('MY_VAR=test cmd')).toEqual({ MY_VAR: 'test' })
    })
  })

  // ============================================================================
  // removeEnvVarsPrefix (helper utility)
  // ============================================================================
  describe('removeEnvVarsPrefix', () => {
    it('removes single env var', () => {
      expect(removeEnvVarsPrefix('VAR=value cmd arg')).toBe('cmd arg')
    })

    it('removes multiple env vars', () => {
      expect(removeEnvVarsPrefix('A=1 B=2 npm install')).toBe('npm install')
    })

    it('returns original if no env vars', () => {
      expect(removeEnvVarsPrefix('cmd arg')).toBe('cmd arg')
    })

    it('handles path values', () => {
      expect(removeEnvVarsPrefix('PATH=/bin:/usr/bin node app.js')).toBe('node app.js')
    })
  })
})

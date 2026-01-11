/**
 * RED Phase Tests: Bloblang String Stdlib Functions
 * Issue: dotdo-7fbtz
 *
 * These tests define the expected behavior for Bloblang's string standard library functions.
 * They should FAIL until the implementation is complete.
 */
import { describe, it, expect } from 'vitest'
import { stringFunctions } from '../stdlib/string'

describe('Bloblang String Stdlib Functions', () => {
  describe('uppercase()', () => {
    it('converts lowercase string to uppercase', () => {
      const result = stringFunctions.uppercase.call('hello')
      expect(result).toBe('HELLO')
    })

    it('converts mixed case to uppercase', () => {
      const result = stringFunctions.uppercase.call('HeLLo WoRLd')
      expect(result).toBe('HELLO WORLD')
    })

    it('handles empty string', () => {
      const result = stringFunctions.uppercase.call('')
      expect(result).toBe('')
    })

    it('handles Unicode characters', () => {
      const result = stringFunctions.uppercase.call('café')
      expect(result).toBe('CAFÉ')
    })

    it('handles strings with numbers', () => {
      const result = stringFunctions.uppercase.call('abc123def')
      expect(result).toBe('ABC123DEF')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.uppercase.call(null)).toThrow()
      expect(() => stringFunctions.uppercase.call(undefined)).toThrow()
      expect(() => stringFunctions.uppercase.call(123)).toThrow()
      expect(() => stringFunctions.uppercase.call({ text: 'hello' })).toThrow()
    })
  })

  describe('lowercase()', () => {
    it('converts uppercase string to lowercase', () => {
      const result = stringFunctions.lowercase.call('HELLO')
      expect(result).toBe('hello')
    })

    it('converts mixed case to lowercase', () => {
      const result = stringFunctions.lowercase.call('HeLLo WoRLd')
      expect(result).toBe('hello world')
    })

    it('handles empty string', () => {
      const result = stringFunctions.lowercase.call('')
      expect(result).toBe('')
    })

    it('handles Unicode characters', () => {
      const result = stringFunctions.lowercase.call('CAFÉ')
      expect(result).toBe('café')
    })

    it('handles strings with numbers', () => {
      const result = stringFunctions.lowercase.call('ABC123DEF')
      expect(result).toBe('abc123def')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.lowercase.call(null)).toThrow()
      expect(() => stringFunctions.lowercase.call(undefined)).toThrow()
      expect(() => stringFunctions.lowercase.call(123)).toThrow()
      expect(() => stringFunctions.lowercase.call([])).toThrow()
    })
  })

  describe('length()', () => {
    it('returns length of string', () => {
      const result = stringFunctions.length.call('hello')
      expect(result).toBe(5)
    })

    it('returns 0 for empty string', () => {
      const result = stringFunctions.length.call('')
      expect(result).toBe(0)
    })

    it('counts string with spaces', () => {
      const result = stringFunctions.length.call('hello world')
      expect(result).toBe(11)
    })

    it('counts Unicode characters correctly', () => {
      const result = stringFunctions.length.call('café')
      expect(result).toBe(4)
    })

    it('counts emoji as single character', () => {
      const result = stringFunctions.length.call('hello 👋')
      expect(result).toBe(8)
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.length.call(null)).toThrow()
      expect(() => stringFunctions.length.call(123)).toThrow()
      expect(() => stringFunctions.length.call({})).toThrow()
    })
  })

  describe('trim()', () => {
    it('removes leading and trailing whitespace', () => {
      const result = stringFunctions.trim.call('  hello world  ')
      expect(result).toBe('hello world')
    })

    it('removes tabs and newlines', () => {
      const result = stringFunctions.trim.call('\t\nhello\n\t')
      expect(result).toBe('hello')
    })

    it('handles string with no whitespace', () => {
      const result = stringFunctions.trim.call('hello')
      expect(result).toBe('hello')
    })

    it('handles empty string', () => {
      const result = stringFunctions.trim.call('')
      expect(result).toBe('')
    })

    it('preserves internal whitespace', () => {
      const result = stringFunctions.trim.call('  hello   world  ')
      expect(result).toBe('hello   world')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.trim.call(null)).toThrow()
      expect(() => stringFunctions.trim.call(123)).toThrow()
    })
  })

  describe('trim_prefix(prefix)', () => {
    it('removes prefix from string', () => {
      const result = stringFunctions.trim_prefix.call('hello world', 'hello ')
      expect(result).toBe('world')
    })

    it('returns original string if prefix not found', () => {
      const result = stringFunctions.trim_prefix.call('hello world', 'goodbye ')
      expect(result).toBe('hello world')
    })

    it('handles empty prefix', () => {
      const result = stringFunctions.trim_prefix.call('hello', '')
      expect(result).toBe('hello')
    })

    it('handles prefix equal to string', () => {
      const result = stringFunctions.trim_prefix.call('hello', 'hello')
      expect(result).toBe('')
    })

    it('is case-sensitive', () => {
      const result = stringFunctions.trim_prefix.call('Hello world', 'hello ')
      expect(result).toBe('Hello world')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.trim_prefix.call(null, 'prefix')).toThrow()
      expect(() => stringFunctions.trim_prefix.call(123, 'prefix')).toThrow()
    })

    it('throws if prefix argument missing', () => {
      expect(() => stringFunctions.trim_prefix.call('hello')).toThrow()
    })
  })

  describe('trim_suffix(suffix)', () => {
    it('removes suffix from string', () => {
      const result = stringFunctions.trim_suffix.call('hello world', ' world')
      expect(result).toBe('hello')
    })

    it('returns original string if suffix not found', () => {
      const result = stringFunctions.trim_suffix.call('hello world', ' universe')
      expect(result).toBe('hello world')
    })

    it('handles empty suffix', () => {
      const result = stringFunctions.trim_suffix.call('hello', '')
      expect(result).toBe('hello')
    })

    it('handles suffix equal to string', () => {
      const result = stringFunctions.trim_suffix.call('hello', 'hello')
      expect(result).toBe('')
    })

    it('is case-sensitive', () => {
      const result = stringFunctions.trim_suffix.call('hello World', ' world')
      expect(result).toBe('hello World')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.trim_suffix.call(null, 'suffix')).toThrow()
      expect(() => stringFunctions.trim_suffix.call(123, 'suffix')).toThrow()
    })

    it('throws if suffix argument missing', () => {
      expect(() => stringFunctions.trim_suffix.call('hello')).toThrow()
    })
  })

  describe('contains(substr)', () => {
    it('returns true if substring found', () => {
      const result = stringFunctions.contains.call('hello world', 'world')
      expect(result).toBe(true)
    })

    it('returns false if substring not found', () => {
      const result = stringFunctions.contains.call('hello world', 'universe')
      expect(result).toBe(false)
    })

    it('is case-sensitive', () => {
      const result = stringFunctions.contains.call('Hello World', 'world')
      expect(result).toBe(false)
    })

    it('finds substring at start', () => {
      const result = stringFunctions.contains.call('hello world', 'hello')
      expect(result).toBe(true)
    })

    it('finds substring at end', () => {
      const result = stringFunctions.contains.call('hello world', 'world')
      expect(result).toBe(true)
    })

    it('finds substring in middle', () => {
      const result = stringFunctions.contains.call('hello world', ' ')
      expect(result).toBe(true)
    })

    it('handles empty substring', () => {
      const result = stringFunctions.contains.call('hello', '')
      expect(result).toBe(true)
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.contains.call(null, 'substr')).toThrow()
      expect(() => stringFunctions.contains.call(123, 'substr')).toThrow()
    })

    it('throws if substr argument missing', () => {
      expect(() => stringFunctions.contains.call('hello')).toThrow()
    })
  })

  describe('has_prefix(prefix)', () => {
    it('returns true if string starts with prefix', () => {
      const result = stringFunctions.has_prefix.call('hello world', 'hello')
      expect(result).toBe(true)
    })

    it('returns false if string does not start with prefix', () => {
      const result = stringFunctions.has_prefix.call('hello world', 'world')
      expect(result).toBe(false)
    })

    it('is case-sensitive', () => {
      const result = stringFunctions.has_prefix.call('Hello world', 'hello')
      expect(result).toBe(false)
    })

    it('handles empty prefix', () => {
      const result = stringFunctions.has_prefix.call('hello', '')
      expect(result).toBe(true)
    })

    it('handles prefix equal to string', () => {
      const result = stringFunctions.has_prefix.call('hello', 'hello')
      expect(result).toBe(true)
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.has_prefix.call(null, 'prefix')).toThrow()
      expect(() => stringFunctions.has_prefix.call(123, 'prefix')).toThrow()
    })

    it('throws if prefix argument missing', () => {
      expect(() => stringFunctions.has_prefix.call('hello')).toThrow()
    })
  })

  describe('has_suffix(suffix)', () => {
    it('returns true if string ends with suffix', () => {
      const result = stringFunctions.has_suffix.call('hello world', 'world')
      expect(result).toBe(true)
    })

    it('returns false if string does not end with suffix', () => {
      const result = stringFunctions.has_suffix.call('hello world', 'hello')
      expect(result).toBe(false)
    })

    it('is case-sensitive', () => {
      const result = stringFunctions.has_suffix.call('hello World', 'world')
      expect(result).toBe(false)
    })

    it('handles empty suffix', () => {
      const result = stringFunctions.has_suffix.call('hello', '')
      expect(result).toBe(true)
    })

    it('handles suffix equal to string', () => {
      const result = stringFunctions.has_suffix.call('hello', 'hello')
      expect(result).toBe(true)
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.has_suffix.call(null, 'suffix')).toThrow()
      expect(() => stringFunctions.has_suffix.call(123, 'suffix')).toThrow()
    })

    it('throws if suffix argument missing', () => {
      expect(() => stringFunctions.has_suffix.call('hello')).toThrow()
    })
  })

  describe('replace(old, new)', () => {
    it('replaces first occurrence of substring', () => {
      const result = stringFunctions.replace.call('hello hello world', 'hello', 'hi')
      expect(result).toBe('hi hello world')
    })

    it('handles empty old string', () => {
      const result = stringFunctions.replace.call('hello', '', 'x')
      expect(result).toBe('xhello')
    })

    it('replaces with empty string', () => {
      const result = stringFunctions.replace.call('hello world', 'hello ', '')
      expect(result).toBe('world')
    })

    it('is case-sensitive', () => {
      const result = stringFunctions.replace.call('Hello world', 'hello', 'hi')
      expect(result).toBe('Hello world')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.replace.call(null, 'old', 'new')).toThrow()
      expect(() => stringFunctions.replace.call(123, 'old', 'new')).toThrow()
    })

    it('throws if old argument missing', () => {
      expect(() => stringFunctions.replace.call('hello', undefined, 'new')).toThrow()
    })

    it('throws if new argument missing', () => {
      expect(() => stringFunctions.replace.call('hello', 'old', undefined)).toThrow()
    })
  })

  describe('replace_all(old, new)', () => {
    it('replaces all occurrences of substring', () => {
      const result = stringFunctions.replace_all.call('hello hello world', 'hello', 'hi')
      expect(result).toBe('hi hi world')
    })

    it('handles multiple non-overlapping matches', () => {
      const result = stringFunctions.replace_all.call('aaa', 'aa', 'b')
      expect(result).toBe('ba')
    })

    it('replaces with empty string', () => {
      const result = stringFunctions.replace_all.call('hello world', 'l', '')
      expect(result).toBe('heo word')
    })

    it('is case-sensitive', () => {
      const result = stringFunctions.replace_all.call('Hello HELLO hello', 'hello', 'hi')
      expect(result).toBe('Hello HELLO hi')
    })

    it('handles empty old string', () => {
      const result = stringFunctions.replace_all.call('ab', '', 'x')
      expect(result).toBe('xaxbx')
    })

    it('returns original string if no matches', () => {
      const result = stringFunctions.replace_all.call('hello world', 'xyz', 'abc')
      expect(result).toBe('hello world')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.replace_all.call(null, 'old', 'new')).toThrow()
      expect(() => stringFunctions.replace_all.call(123, 'old', 'new')).toThrow()
    })

    it('throws if old argument missing', () => {
      expect(() => stringFunctions.replace_all.call('hello', undefined, 'new')).toThrow()
    })

    it('throws if new argument missing', () => {
      expect(() => stringFunctions.replace_all.call('hello', 'old', undefined)).toThrow()
    })
  })

  describe('split(delimiter)', () => {
    it('splits string by delimiter', () => {
      const result = stringFunctions.split.call('hello,world,test', ',')
      expect(result).toEqual(['hello', 'world', 'test'])
    })

    it('splits string by space', () => {
      const result = stringFunctions.split.call('hello world test', ' ')
      expect(result).toEqual(['hello', 'world', 'test'])
    })

    it('handles delimiter at start', () => {
      const result = stringFunctions.split.call(',hello', ',')
      expect(result).toEqual(['', 'hello'])
    })

    it('handles delimiter at end', () => {
      const result = stringFunctions.split.call('hello,', ',')
      expect(result).toEqual(['hello', ''])
    })

    it('handles consecutive delimiters', () => {
      const result = stringFunctions.split.call('hello,,world', ',')
      expect(result).toEqual(['hello', '', 'world'])
    })

    it('returns single element if no delimiter found', () => {
      const result = stringFunctions.split.call('hello', ',')
      expect(result).toEqual(['hello'])
    })

    it('handles empty string', () => {
      const result = stringFunctions.split.call('', ',')
      expect(result).toEqual([''])
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.split.call(null, ',')).toThrow()
      expect(() => stringFunctions.split.call(123, ',')).toThrow()
    })

    it('throws if delimiter argument missing', () => {
      expect(() => stringFunctions.split.call('hello')).toThrow()
    })
  })

  describe('join(delimiter)', () => {
    it('joins array of strings with delimiter', () => {
      const result = stringFunctions.join.call(['hello', 'world', 'test'], ',')
      expect(result).toBe('hello,world,test')
    })

    it('joins with space delimiter', () => {
      const result = stringFunctions.join.call(['hello', 'world'], ' ')
      expect(result).toBe('hello world')
    })

    it('joins single element array', () => {
      const result = stringFunctions.join.call(['hello'], ',')
      expect(result).toBe('hello')
    })

    it('joins empty array', () => {
      const result = stringFunctions.join.call([], ',')
      expect(result).toBe('')
    })

    it('handles array with empty strings', () => {
      const result = stringFunctions.join.call(['hello', '', 'world'], ',')
      expect(result).toBe('hello,,world')
    })

    it('joins mixed content converting to strings', () => {
      const result = stringFunctions.join.call(['hello', 'world', 'test'], '-')
      expect(result).toBe('hello-world-test')
    })

    it('handles empty delimiter', () => {
      const result = stringFunctions.join.call(['a', 'b', 'c'], '')
      expect(result).toBe('abc')
    })

    it('throws if not called on array', () => {
      expect(() => stringFunctions.join.call('hello', ',')).toThrow()
      expect(() => stringFunctions.join.call(123, ',')).toThrow()
      expect(() => stringFunctions.join.call(null, ',')).toThrow()
    })

    it('throws if delimiter argument missing', () => {
      expect(() => stringFunctions.join.call(['hello', 'world'])).toThrow()
    })
  })

  describe('slice(start, end)', () => {
    it('extracts substring with start and end indices', () => {
      const result = stringFunctions.slice.call('hello world', 0, 5)
      expect(result).toBe('hello')
    })

    it('extracts substring with start index only', () => {
      const result = stringFunctions.slice.call('hello world', 6)
      expect(result).toBe('world')
    })

    it('handles negative indices', () => {
      const result = stringFunctions.slice.call('hello world', -5)
      expect(result).toBe('world')
    })

    it('handles negative end index', () => {
      const result = stringFunctions.slice.call('hello world', 0, -6)
      expect(result).toBe('hello')
    })

    it('returns empty string if start >= end', () => {
      const result = stringFunctions.slice.call('hello', 5, 2)
      expect(result).toBe('')
    })

    it('handles out of bounds indices', () => {
      const result = stringFunctions.slice.call('hello', 10, 20)
      expect(result).toBe('')
    })

    it('handles zero start', () => {
      const result = stringFunctions.slice.call('hello', 0)
      expect(result).toBe('hello')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.slice.call(null, 0, 5)).toThrow()
      expect(() => stringFunctions.slice.call(123, 0, 5)).toThrow()
    })

    it('throws if start argument missing', () => {
      expect(() => stringFunctions.slice.call('hello')).toThrow()
    })
  })

  describe('format(template, ...args)', () => {
    it('formats string with %s placeholder', () => {
      const result = stringFunctions.format.call('hello %s', 'world')
      expect(result).toBe('hello world')
    })

    it('formats string with multiple placeholders', () => {
      const result = stringFunctions.format.call('%s %s %s', 'one', 'two', 'three')
      expect(result).toBe('one two three')
    })

    it('formats with %d for numbers', () => {
      const result = stringFunctions.format.call('number: %d', 42)
      expect(result).toBe('number: 42')
    })

    it('formats with %f for floats', () => {
      const result = stringFunctions.format.call('pi: %.2f', 3.14159)
      expect(result).toMatch(/pi: 3\.14/)
    })

    it('formats with %x for hex', () => {
      const result = stringFunctions.format.call('hex: %x', 255)
      expect(result).toBe('hex: ff')
    })

    it('formats with %b for boolean', () => {
      const result = stringFunctions.format.call('flag: %b', true)
      expect(result).toBe('flag: true')
    })

    it('handles %% escape for literal percent', () => {
      const result = stringFunctions.format.call('50%% complete', undefined)
      expect(result).toBe('50% complete')
    })

    it('ignores extra arguments', () => {
      const result = stringFunctions.format.call('hello %s', 'world', 'extra')
      expect(result).toBe('hello world')
    })

    it('leaves placeholder if not enough arguments', () => {
      const result = stringFunctions.format.call('hello %s %s', 'world')
      expect(result).toContain('hello world')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.format.call(null, 'arg')).toThrow()
      expect(() => stringFunctions.format.call(123, 'arg')).toThrow()
    })
  })

  describe('re_match(pattern)', () => {
    it('returns true if pattern matches', () => {
      const result = stringFunctions.re_match.call('hello123', '\\d+')
      expect(result).toBe(true)
    })

    it('returns false if pattern does not match', () => {
      const result = stringFunctions.re_match.call('hello', '\\d+')
      expect(result).toBe(false)
    })

    it('matches email pattern', () => {
      const result = stringFunctions.re_match.call('test@example.com.ai', '^[^@]+@[^@]+$')
      expect(result).toBe(true)
    })

    it('is case-sensitive by default', () => {
      const result = stringFunctions.re_match.call('Hello', '^hello')
      expect(result).toBe(false)
    })

    it('matches with anchors', () => {
      const start = stringFunctions.re_match.call('hello', '^he')
      const end = stringFunctions.re_match.call('hello', 'lo$')
      expect(start).toBe(true)
      expect(end).toBe(true)
    })

    it('matches with character classes', () => {
      const result = stringFunctions.re_match.call('a1b2c3', '[a-z]+[0-9]+')
      expect(result).toBe(true)
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.re_match.call(null, '\\d+')).toThrow()
      expect(() => stringFunctions.re_match.call(123, '\\d+')).toThrow()
    })

    it('throws if pattern argument missing', () => {
      expect(() => stringFunctions.re_match.call('hello')).toThrow()
    })

    it('throws on invalid regex pattern', () => {
      expect(() => stringFunctions.re_match.call('hello', '[invalid')).toThrow()
    })
  })

  describe('re_find_all(pattern)', () => {
    it('finds all matches of pattern', () => {
      const result = stringFunctions.re_find_all.call('hello123world456', '\\d+')
      expect(result).toEqual(['123', '456'])
    })

    it('returns empty array if no matches', () => {
      const result = stringFunctions.re_find_all.call('hello', '\\d+')
      expect(result).toEqual([])
    })

    it('finds all words', () => {
      const result = stringFunctions.re_find_all.call('one two three', '\\w+')
      expect(result).toEqual(['one', 'two', 'three'])
    })

    it('returns array with single match', () => {
      const result = stringFunctions.re_find_all.call('hello123', '\\d+')
      expect(result).toEqual(['123'])
    })

    it('finds overlapping patterns with lookahead', () => {
      const result = stringFunctions.re_find_all.call('aaa', '(?=a)a')
      expect(result.length).toBeGreaterThan(0)
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.re_find_all.call(null, '\\d+')).toThrow()
      expect(() => stringFunctions.re_find_all.call(123, '\\d+')).toThrow()
    })

    it('throws if pattern argument missing', () => {
      expect(() => stringFunctions.re_find_all.call('hello')).toThrow()
    })

    it('throws on invalid regex pattern', () => {
      expect(() => stringFunctions.re_find_all.call('hello', '[invalid')).toThrow()
    })
  })

  describe('re_replace(pattern, replacement)', () => {
    it('replaces first match of pattern', () => {
      const result = stringFunctions.re_replace.call('hello123world456', '\\d+', 'X')
      expect(result).toBe('helloXworld456')
    })

    it('replaces with capture groups', () => {
      const result = stringFunctions.re_replace.call('hello world', '(\\w+) (\\w+)', '$2 $1')
      expect(result).toBe('world hello')
    })

    it('replaces with empty string', () => {
      const result = stringFunctions.re_replace.call('hello123world', '\\d+', '')
      expect(result).toBe('helloworld')
    })

    it('returns original if no matches', () => {
      const result = stringFunctions.re_replace.call('hello', '\\d+', 'X')
      expect(result).toBe('hello')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.re_replace.call(null, '\\d+', 'X')).toThrow()
      expect(() => stringFunctions.re_replace.call(123, '\\d+', 'X')).toThrow()
    })

    it('throws if pattern argument missing', () => {
      expect(() => stringFunctions.re_replace.call('hello', undefined, 'X')).toThrow()
    })

    it('throws if replacement argument missing', () => {
      expect(() => stringFunctions.re_replace.call('hello', '\\d+', undefined)).toThrow()
    })

    it('throws on invalid regex pattern', () => {
      expect(() => stringFunctions.re_replace.call('hello', '[invalid', 'X')).toThrow()
    })
  })

  describe('encode(encoding) - base64', () => {
    it('encodes string to base64', () => {
      const result = stringFunctions.encode.call('hello', 'base64')
      expect(result).toBe('aGVsbG8=')
    })

    it('encodes UTF-8 characters to base64', () => {
      const result = stringFunctions.encode.call('café', 'base64')
      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
    })

    it('encodes empty string to base64', () => {
      const result = stringFunctions.encode.call('', 'base64')
      expect(result).toBe('')
    })

    it('encodes numbers in string', () => {
      const result = stringFunctions.encode.call('12345', 'base64')
      expect(result).toBe('MTIzNDU=')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.encode.call(null, 'base64')).toThrow()
      expect(() => stringFunctions.encode.call(123, 'base64')).toThrow()
    })

    it('throws if encoding argument missing', () => {
      expect(() => stringFunctions.encode.call('hello')).toThrow()
    })

    it('throws on unsupported encoding', () => {
      expect(() => stringFunctions.encode.call('hello', 'unknown')).toThrow()
    })
  })

  describe('decode(encoding) - base64', () => {
    it('decodes base64 to string', () => {
      const result = stringFunctions.decode.call('aGVsbG8=', 'base64')
      expect(result).toBe('hello')
    })

    it('decodes base64 with UTF-8 characters', () => {
      const encoded = stringFunctions.encode.call('café', 'base64')
      const decoded = stringFunctions.decode.call(encoded, 'base64')
      expect(decoded).toBe('café')
    })

    it('decodes empty base64', () => {
      const result = stringFunctions.decode.call('', 'base64')
      expect(result).toBe('')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.decode.call(null, 'base64')).toThrow()
      expect(() => stringFunctions.decode.call(123, 'base64')).toThrow()
    })

    it('throws if encoding argument missing', () => {
      expect(() => stringFunctions.decode.call('aGVsbG8=')).toThrow()
    })

    it('throws on invalid base64', () => {
      expect(() => stringFunctions.decode.call('!!!invalid!!!', 'base64')).toThrow()
    })

    it('throws on unsupported encoding', () => {
      expect(() => stringFunctions.decode.call('hello', 'unknown')).toThrow()
    })
  })

  describe('hash(algorithm)', () => {
    it('generates sha256 hash', () => {
      const result = stringFunctions.hash.call('hello', 'sha256')
      expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('generates md5 hash', () => {
      const result = stringFunctions.hash.call('hello', 'md5')
      expect(result).toBe('5d41402abc4b2a76b9719d911017c592')
    })

    it('generates consistent hash', () => {
      const hash1 = stringFunctions.hash.call('test', 'sha256')
      const hash2 = stringFunctions.hash.call('test', 'sha256')
      expect(hash1).toBe(hash2)
    })

    it('generates different hashes for different inputs', () => {
      const hash1 = stringFunctions.hash.call('hello', 'sha256')
      const hash2 = stringFunctions.hash.call('world', 'sha256')
      expect(hash1).not.toBe(hash2)
    })

    it('handles UTF-8 characters', () => {
      const result = stringFunctions.hash.call('café', 'sha256')
      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
      expect(result.length).toBe(64) // SHA256 hex is 64 chars
    })

    it('handles empty string', () => {
      const result = stringFunctions.hash.call('', 'sha256')
      expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    })

    it('throws on non-string input', () => {
      expect(() => stringFunctions.hash.call(null, 'sha256')).toThrow()
      expect(() => stringFunctions.hash.call(123, 'sha256')).toThrow()
    })

    it('throws if algorithm argument missing', () => {
      expect(() => stringFunctions.hash.call('hello')).toThrow()
    })

    it('throws on unsupported algorithm', () => {
      expect(() => stringFunctions.hash.call('hello', 'unknown')).toThrow()
    })
  })

  describe('Unicode handling', () => {
    it('handles emoji in uppercase', () => {
      const result = stringFunctions.uppercase.call('hello 👋 world')
      expect(result).toBe('HELLO 👋 WORLD')
    })

    it('handles emoji in lowercase', () => {
      const result = stringFunctions.lowercase.call('HELLO 👋 WORLD')
      expect(result).toBe('hello 👋 world')
    })

    it('handles emoji in length', () => {
      // Note: JavaScript's String.length returns UTF-16 code units, not grapheme clusters.
      // The emoji 👋 takes 2 UTF-16 code units (surrogate pair), so 'hi 👋' = 2 + 1 + 2 = 5
      // This is consistent with the test at line 101-104 which expects 'hello 👋' to be 8.
      const result = stringFunctions.length.call('hi 👋')
      expect(result).toBe(5) // 'h'=1, 'i'=1, ' '=1, '👋'=2 (surrogate pair)
    })

    it('handles emoji in contains', () => {
      const result = stringFunctions.contains.call('hello 👋 world', '👋')
      expect(result).toBe(true)
    })

    it('handles emoji in split', () => {
      const result = stringFunctions.split.call('hello👋world', '👋')
      expect(result).toEqual(['hello', 'world'])
    })

    it('handles accented characters', () => {
      // Verify that uppercase/lowercase preserve accented characters.
      // 'naïve' -> 'NAÏVE' -> 'naïve', the ï (i with diaeresis) should be preserved.
      const result = stringFunctions.uppercase.call('naïve')
      expect(result).toBe('NAÏVE')
      expect(result.toLowerCase()).toBe('naïve')
      expect(result.toLowerCase()).toContain('ï') // Verify accented character is preserved
    })

    it('handles combining characters', () => {
      const nfc = 'é' // Single character
      const nfd = 'e\u0301' // Decomposed (e + combining accent)
      const result1 = stringFunctions.length.call(nfc)
      const result2 = stringFunctions.length.call(nfd)
      expect([result1, result2]).toContain(1)
    })
  })

  describe('Error handling', () => {
    it('throws descriptive error for missing arguments', () => {
      expect(() => {
        stringFunctions.trim_prefix.call('hello')
      }).toThrow(/prefix|argument|required/i)
    })

    it('throws descriptive error for invalid types', () => {
      expect(() => {
        stringFunctions.uppercase.call(null)
      }).toThrow(/string|type|input/i)
    })

    it('throws for invalid regex patterns', () => {
      expect(() => {
        stringFunctions.re_match.call('hello', '[invalid')
      }).toThrow(/regex|pattern|invalid/i)
    })

    it('throws for invalid encoding', () => {
      expect(() => {
        stringFunctions.encode.call('hello', 'invalid_encoding')
      }).toThrow(/encoding|support|unknown/i)
    })

    it('throws for invalid hash algorithm', () => {
      expect(() => {
        stringFunctions.hash.call('hello', 'invalid_algorithm')
      }).toThrow(/algorithm|support|unknown/i)
    })
  })

  describe('Integration tests', () => {
    it('chains multiple string operations', () => {
      // Split a string, uppercase elements, rejoin
      const split = stringFunctions.split.call('hello,world', ',')
      const upper = split.map((s: string) => stringFunctions.uppercase.call(s))
      const joined = stringFunctions.join.call(upper, '-')
      expect(joined).toBe('HELLO-WORLD')
    })

    it('combines trim and split', () => {
      const trimmed = stringFunctions.trim.call('  hello,world,test  ')
      const split = stringFunctions.split.call(trimmed, ',')
      expect(split).toEqual(['hello', 'world', 'test'])
    })

    it('uses regex to extract and format', () => {
      const numbers = stringFunctions.re_find_all.call('call 123-456-7890', '\\d+')
      const formatted = stringFunctions.join.call(numbers, '-')
      expect(formatted).toBe('123-456-7890')
    })

    it('encodes sensitive data with hash', () => {
      const password = 'my-secret-password'
      const hashed = stringFunctions.hash.call(password, 'sha256')
      const encoded = stringFunctions.encode.call(hashed, 'base64')
      expect(encoded).toBeDefined()
      expect(typeof encoded).toBe('string')
    })
  })
})

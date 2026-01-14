/**
 * POSIX Utility Commands Tests
 *
 * Comprehensive tests for POSIX utility commands:
 * - cut: Remove sections from lines
 * - sort: Sort lines
 * - tr: Translate characters
 * - uniq: Report/filter repeated lines
 * - wc: Word, line, byte counts
 * - basename: Strip directory and suffix
 * - dirname: Strip last component
 * - echo: Print arguments
 * - printf: Formatted output
 * - date: Display/format date
 * - dd: Convert and copy
 * - od: Octal dump
 *
 * @module bashx/do/commands/posix-utils.test
 */

import { describe, it, expect } from 'vitest'
import {
  executeCut,
  executeSort,
  executeTr,
  executeUniq,
  executeWc,
  executeBasename,
  executeDirname,
  executeEcho,
  executePrintf,
  executeDate,
  executeDd,
  executeOd,
} from './posix-utils.js'

// ============================================================================
// CUT COMMAND TESTS
// ============================================================================

describe('cut command', () => {
  describe('field extraction (-f)', () => {
    it('extracts single field with tab delimiter', () => {
      const input = 'one\ttwo\tthree\nfour\tfive\tsix\n'
      const result = executeCut(input, { fields: '1' })
      expect(result).toBe('one\nfour\n')
    })

    it('extracts multiple fields with tab delimiter', () => {
      const input = 'one\ttwo\tthree\nfour\tfive\tsix\n'
      const result = executeCut(input, { fields: '1,3' })
      expect(result).toBe('one\tthree\nfour\tsix\n')
    })

    it('extracts field range', () => {
      const input = 'a\tb\tc\td\te\n'
      const result = executeCut(input, { fields: '2-4' })
      expect(result).toBe('b\tc\td\n')
    })

    it('uses custom delimiter', () => {
      const input = 'one,two,three\nfour,five,six\n'
      const result = executeCut(input, { fields: '2', delimiter: ',' })
      expect(result).toBe('two\nfive\n')
    })

    it('uses custom output delimiter', () => {
      const input = 'one,two,three\n'
      const result = executeCut(input, { fields: '1,3', delimiter: ',', outputDelimiter: ':' })
      expect(result).toBe('one:three\n')
    })

    it('skips lines without delimiter when -s is used', () => {
      const input = 'one,two\nno-comma\nthree,four\n'
      const result = executeCut(input, { fields: '1', delimiter: ',', onlyDelimited: true })
      expect(result).toBe('one\nthree\n')
    })
  })

  describe('byte/character extraction (-b/-c)', () => {
    it('extracts bytes by position', () => {
      const input = 'hello\nworld\n'
      const result = executeCut(input, { bytes: '1-3' })
      expect(result).toBe('hel\nwor\n')
    })

    it('extracts characters by position', () => {
      const input = 'hello\nworld\n'
      const result = executeCut(input, { chars: '1,3,5' })
      expect(result).toBe('hlo\nwrd\n')
    })

    it('extracts from start with open-ended range', () => {
      const input = 'hello\n'
      const result = executeCut(input, { bytes: '-3' })
      expect(result).toBe('hel\n')
    })

    it('extracts to end with open-ended range', () => {
      const input = 'hello\n'
      const result = executeCut(input, { bytes: '3-' })
      expect(result).toBe('llo\n')
    })
  })

  describe('complement', () => {
    it('complements field selection', () => {
      const input = 'a,b,c,d\n'
      const result = executeCut(input, { fields: '2', delimiter: ',', complement: true })
      expect(result).toBe('a,c,d\n')
    })
  })
})

// ============================================================================
// SORT COMMAND TESTS
// ============================================================================

describe('sort command', () => {
  describe('basic sorting', () => {
    it('sorts lines alphabetically', () => {
      const lines = ['cherry', 'apple', 'banana']
      const result = executeSort(lines)
      expect(result).toEqual(['apple', 'banana', 'cherry'])
    })

    it('sorts in reverse order', () => {
      const lines = ['apple', 'banana', 'cherry']
      const result = executeSort(lines, { reverse: true })
      expect(result).toEqual(['cherry', 'banana', 'apple'])
    })

    it('sorts case-insensitively', () => {
      const lines = ['Banana', 'apple', 'Cherry']
      const result = executeSort(lines, { ignoreCase: true })
      expect(result).toEqual(['apple', 'Banana', 'Cherry'])
    })
  })

  describe('numeric sorting', () => {
    it('sorts numbers numerically', () => {
      const lines = ['10', '2', '1', '20']
      const result = executeSort(lines, { numeric: true })
      expect(result).toEqual(['1', '2', '10', '20'])
    })

    it('handles negative numbers', () => {
      const lines = ['5', '-3', '0', '-10']
      const result = executeSort(lines, { numeric: true })
      expect(result).toEqual(['-10', '-3', '0', '5'])
    })

    it('sorts human-readable sizes', () => {
      const lines = ['1K', '1M', '1G', '512K']
      const result = executeSort(lines, { humanNumeric: true })
      expect(result).toEqual(['1K', '512K', '1M', '1G'])
    })
  })

  describe('key sorting', () => {
    it('sorts by specific field', () => {
      const lines = ['alice 30', 'bob 25', 'charlie 35']
      const result = executeSort(lines, { key: '2', numeric: true })
      expect(result).toEqual(['bob 25', 'alice 30', 'charlie 35'])
    })

    it('uses custom separator', () => {
      const lines = ['alice,30', 'bob,25', 'charlie,35']
      const result = executeSort(lines, { key: '2', separator: ',', numeric: true })
      expect(result).toEqual(['bob,25', 'alice,30', 'charlie,35'])
    })
  })

  describe('unique sorting', () => {
    it('removes duplicate lines', () => {
      const lines = ['apple', 'banana', 'apple', 'cherry', 'banana']
      const result = executeSort(lines, { unique: true })
      expect(result).toEqual(['apple', 'banana', 'cherry'])
    })
  })

  describe('check mode', () => {
    it('returns silently for sorted input', () => {
      const lines = ['a', 'b', 'c']
      expect(() => executeSort(lines, { check: true })).not.toThrow()
    })

    it('throws for unsorted input', () => {
      const lines = ['b', 'a', 'c']
      expect(() => executeSort(lines, { check: true })).toThrow('disorder')
    })
  })
})

// ============================================================================
// TR COMMAND TESTS
// ============================================================================

describe('tr command', () => {
  describe('character translation', () => {
    it('translates single characters', () => {
      const result = executeTr('hello', 'e', 'a')
      expect(result).toBe('hallo')
    })

    it('translates character ranges', () => {
      const result = executeTr('hello', 'a-z', 'A-Z')
      expect(result).toBe('HELLO')
    })

    it('translates using character classes', () => {
      const result = executeTr('hello 123', '[:lower:]', '[:upper:]')
      expect(result).toBe('HELLO 123')
    })

    it('handles escape sequences', () => {
      const result = executeTr('hello\tworld', '\\t', ' ')
      expect(result).toBe('hello world')
    })
  })

  describe('delete mode (-d)', () => {
    it('deletes specified characters', () => {
      const result = executeTr('hello123world', '[:digit:]', undefined, { delete: true })
      expect(result).toBe('helloworld')
    })

    it('deletes vowels', () => {
      const result = executeTr('hello', 'aeiou', undefined, { delete: true })
      expect(result).toBe('hll')
    })
  })

  describe('squeeze mode (-s)', () => {
    it('squeezes repeated characters', () => {
      const result = executeTr('heeeello', 'e', 'e', { squeeze: true })
      expect(result).toBe('hello')
    })

    it('squeezes spaces', () => {
      const result = executeTr('hello    world', ' ', ' ', { squeeze: true })
      expect(result).toBe('hello world')
    })
  })

  describe('complement mode (-c)', () => {
    it('complements character set', () => {
      const result = executeTr('hello123', '[:alpha:]', 'X', { complement: true })
      expect(result).toBe('helloXXX')
    })
  })
})

// ============================================================================
// UNIQ COMMAND TESTS
// ============================================================================

describe('uniq command', () => {
  describe('basic deduplication', () => {
    it('removes consecutive duplicates', () => {
      const lines = ['a', 'a', 'b', 'b', 'a']
      const result = executeUniq(lines)
      expect(result).toEqual(['a', 'b', 'a'])
    })

    it('handles empty input', () => {
      const result = executeUniq([])
      expect(result).toEqual([])
    })
  })

  describe('count mode (-c)', () => {
    it('prefixes lines with occurrence count', () => {
      const lines = ['a', 'a', 'b', 'c', 'c', 'c']
      const result = executeUniq(lines, { count: true })
      expect(result[0]).toMatch(/^\s*2 a$/)
      expect(result[1]).toMatch(/^\s*1 b$/)
      expect(result[2]).toMatch(/^\s*3 c$/)
    })
  })

  describe('repeated mode (-d)', () => {
    it('shows only duplicate lines', () => {
      const lines = ['a', 'a', 'b', 'c', 'c']
      const result = executeUniq(lines, { repeated: true })
      expect(result).toEqual(['a', 'c'])
    })
  })

  describe('unique mode (-u)', () => {
    it('shows only unique lines', () => {
      const lines = ['a', 'a', 'b', 'c', 'c']
      const result = executeUniq(lines, { unique: true })
      expect(result).toEqual(['b'])
    })
  })

  describe('case insensitive mode (-i)', () => {
    it('ignores case when comparing', () => {
      const lines = ['Apple', 'APPLE', 'apple', 'Banana']
      const result = executeUniq(lines, { ignoreCase: true })
      expect(result).toEqual(['Apple', 'Banana'])
    })
  })

  describe('skip fields mode (-f)', () => {
    it('skips fields before comparing', () => {
      const lines = ['1 apple', '2 apple', '3 banana']
      const result = executeUniq(lines, { skipFields: 1 })
      expect(result).toEqual(['1 apple', '3 banana'])
    })
  })
})

// ============================================================================
// WC COMMAND TESTS
// ============================================================================

describe('wc command', () => {
  describe('counting', () => {
    it('counts lines, words, and bytes', () => {
      const input = 'hello world\nfoo bar\n'
      const result = executeWc(input)
      expect(result.lines).toBe(2)
      expect(result.words).toBe(4)
      expect(result.bytes).toBe(20)
    })

    it('counts lines correctly', () => {
      const input = 'line1\nline2\nline3\n'
      const result = executeWc(input)
      expect(result.lines).toBe(3)
    })

    it('counts words correctly', () => {
      const input = 'one two three   four\n'
      const result = executeWc(input)
      expect(result.words).toBe(4)
    })

    it('handles empty input', () => {
      const result = executeWc('')
      expect(result.lines).toBe(0)
      expect(result.words).toBe(0)
      expect(result.bytes).toBe(0)
    })

    it('handles input without trailing newline', () => {
      const input = 'hello world'
      const result = executeWc(input)
      expect(result.lines).toBe(0)
      expect(result.words).toBe(2)
    })

    it('counts UTF-8 characters correctly', () => {
      const input = 'hello \u{1F600}\n'  // hello + emoji
      const result = executeWc(input)
      expect(result.chars).toBe(8)  // h e l l o space emoji newline
    })
  })
})

// ============================================================================
// BASENAME COMMAND TESTS
// ============================================================================

describe('basename command', () => {
  it('extracts filename from path', () => {
    expect(executeBasename('/usr/bin/bash')).toBe('bash')
  })

  it('handles path without directory', () => {
    expect(executeBasename('file.txt')).toBe('file.txt')
  })

  it('removes trailing slashes', () => {
    expect(executeBasename('/usr/bin/')).toBe('bin')
  })

  it('removes suffix when specified', () => {
    expect(executeBasename('/path/to/file.txt', '.txt')).toBe('file')
  })

  it('does not remove partial suffix match', () => {
    expect(executeBasename('/path/to/file.txt', '.md')).toBe('file.txt')
  })

  it('handles root path', () => {
    expect(executeBasename('/')).toBe('/')
  })

  it('handles multiple slashes', () => {
    expect(executeBasename('//usr//bin//')).toBe('bin')
  })
})

// ============================================================================
// DIRNAME COMMAND TESTS
// ============================================================================

describe('dirname command', () => {
  it('extracts directory from path', () => {
    expect(executeDirname('/usr/bin/bash')).toBe('/usr/bin')
  })

  it('returns . for filename without directory', () => {
    expect(executeDirname('file.txt')).toBe('.')
  })

  it('handles trailing slashes', () => {
    expect(executeDirname('/usr/bin/')).toBe('/usr')
  })

  it('returns / for root path', () => {
    expect(executeDirname('/')).toBe('/')
  })

  it('returns / for first-level path', () => {
    expect(executeDirname('/usr')).toBe('/')
  })

  it('handles multiple slashes', () => {
    expect(executeDirname('//usr//bin//')).toBe('//usr')
  })
})

// ============================================================================
// ECHO COMMAND TESTS
// ============================================================================

describe('echo command', () => {
  describe('basic output', () => {
    it('prints arguments separated by spaces', () => {
      const result = executeEcho(['hello', 'world'])
      expect(result).toBe('hello world\n')
    })

    it('prints empty line for no arguments', () => {
      const result = executeEcho([])
      expect(result).toBe('\n')
    })
  })

  describe('no newline option (-n)', () => {
    it('omits trailing newline', () => {
      const result = executeEcho(['hello'], { noNewline: true })
      expect(result).toBe('hello')
    })
  })

  describe('escape interpretation (-e)', () => {
    it('interprets \\n as newline', () => {
      const result = executeEcho(['hello\\nworld'], { interpretEscapes: true })
      expect(result).toBe('hello\nworld\n')
    })

    it('interprets \\t as tab', () => {
      const result = executeEcho(['hello\\tworld'], { interpretEscapes: true })
      expect(result).toBe('hello\tworld\n')
    })

    it('interprets \\\\ as backslash', () => {
      const result = executeEcho(['hello\\\\world'], { interpretEscapes: true })
      expect(result).toBe('hello\\world\n')
    })

    it('interprets \\0nnn as octal', () => {
      const result = executeEcho(['\\0101'], { interpretEscapes: true })
      expect(result).toBe('A\n')
    })

    it('handles \\c to stop output', () => {
      const result = executeEcho(['hello\\cworld'], { interpretEscapes: true })
      expect(result).toBe('hello\n')
    })
  })
})

// ============================================================================
// PRINTF COMMAND TESTS
// ============================================================================

describe('printf command', () => {
  describe('string format (%s)', () => {
    it('formats string arguments', () => {
      const result = executePrintf('Hello, %s!\n', ['World'])
      expect(result).toBe('Hello, World!\n')
    })

    it('handles multiple string arguments', () => {
      const result = executePrintf('%s %s\n', ['Hello', 'World'])
      expect(result).toBe('Hello World\n')
    })

    it('truncates with precision', () => {
      const result = executePrintf('%.3s\n', ['Hello'])
      expect(result).toBe('Hel\n')
    })
  })

  describe('integer format (%d)', () => {
    it('formats integer arguments', () => {
      const result = executePrintf('Number: %d\n', ['42'])
      expect(result).toBe('Number: 42\n')
    })

    it('handles negative numbers', () => {
      const result = executePrintf('%d\n', ['-10'])
      expect(result).toBe('-10\n')
    })
  })

  describe('hexadecimal format (%x/%X)', () => {
    it('formats as lowercase hex', () => {
      const result = executePrintf('%x\n', ['255'])
      expect(result).toBe('ff\n')
    })

    it('formats as uppercase hex', () => {
      const result = executePrintf('%X\n', ['255'])
      expect(result).toBe('FF\n')
    })
  })

  describe('octal format (%o)', () => {
    it('formats as octal', () => {
      const result = executePrintf('%o\n', ['8'])
      expect(result).toBe('10\n')
    })
  })

  describe('float format (%f)', () => {
    it('formats floating point numbers', () => {
      const result = executePrintf('%f\n', ['3.14159'])
      expect(result).toBe('3.141590\n')
    })

    it('handles precision', () => {
      const result = executePrintf('%.2f\n', ['3.14159'])
      expect(result).toBe('3.14\n')
    })
  })

  describe('escape sequences', () => {
    it('interprets \\n as newline', () => {
      const result = executePrintf('line1\\nline2', [])
      expect(result).toBe('line1\nline2')
    })

    it('interprets \\t as tab', () => {
      const result = executePrintf('col1\\tcol2', [])
      expect(result).toBe('col1\tcol2')
    })

    it('interprets %% as literal percent', () => {
      const result = executePrintf('100%% complete', [])
      expect(result).toBe('100% complete')
    })
  })

  describe('width formatting', () => {
    it('pads with spaces on left', () => {
      const result = executePrintf('%10s', ['hi'])
      expect(result).toBe('        hi')
    })

    it('pads with spaces on right with -', () => {
      const result = executePrintf('%-10s', ['hi'])
      expect(result).toBe('hi        ')
    })
  })
})

// ============================================================================
// DATE COMMAND TESTS
// ============================================================================

describe('date command', () => {
  describe('format specifiers', () => {
    const testDate = new Date('2024-03-15T14:30:45.123Z')

    it('formats year (%Y)', () => {
      const result = executeDate('+%Y', { date: testDate, utc: true })
      expect(result).toBe('2024')
    })

    it('formats short year (%y)', () => {
      const result = executeDate('+%y', { date: testDate, utc: true })
      expect(result).toBe('24')
    })

    it('formats month (%m)', () => {
      const result = executeDate('+%m', { date: testDate, utc: true })
      expect(result).toBe('03')
    })

    it('formats day (%d)', () => {
      const result = executeDate('+%d', { date: testDate, utc: true })
      expect(result).toBe('15')
    })

    it('formats hour (%H)', () => {
      const result = executeDate('+%H', { date: testDate, utc: true })
      expect(result).toBe('14')
    })

    it('formats minute (%M)', () => {
      const result = executeDate('+%M', { date: testDate, utc: true })
      expect(result).toBe('30')
    })

    it('formats second (%S)', () => {
      const result = executeDate('+%S', { date: testDate, utc: true })
      expect(result).toBe('45')
    })

    it('formats Unix timestamp (%s)', () => {
      const result = executeDate('+%s', { date: testDate })
      expect(result).toBe(String(Math.floor(testDate.getTime() / 1000)))
    })

    it('formats weekday name (%A)', () => {
      const result = executeDate('+%A', { date: testDate, utc: true })
      expect(result).toBe('Friday')
    })

    it('formats month name (%B)', () => {
      const result = executeDate('+%B', { date: testDate, utc: true })
      expect(result).toBe('March')
    })

    it('handles combined format', () => {
      const result = executeDate('+%Y-%m-%d %H:%M:%S', { date: testDate, utc: true })
      expect(result).toBe('2024-03-15 14:30:45')
    })
  })

  describe('UTC mode', () => {
    it('uses UTC timezone when specified', () => {
      const testDate = new Date('2024-03-15T00:00:00Z')
      const result = executeDate('+%Y-%m-%d', { date: testDate, utc: true })
      expect(result).toBe('2024-03-15')
    })
  })

  describe('error handling', () => {
    it('throws for invalid date', () => {
      expect(() => executeDate('+%Y', { date: 'invalid-date' })).toThrow('invalid date')
    })
  })
})

// ============================================================================
// DD COMMAND TESTS
// ============================================================================

describe('dd command', () => {
  describe('basic copy', () => {
    it('copies entire input by default', () => {
      const input = new TextEncoder().encode('hello world')
      const result = executeDd(input)
      expect(new TextDecoder().decode(result)).toBe('hello world')
    })
  })

  describe('block size and count', () => {
    it('limits output with count', () => {
      const input = new TextEncoder().encode('hello world')
      const result = executeDd(input, { bs: 5, count: 1 })
      expect(new TextDecoder().decode(result)).toBe('hello')
    })

    it('uses different input and output block sizes', () => {
      const input = new TextEncoder().encode('abcdefghij')
      const result = executeDd(input, { ibs: 2, count: 3 })
      expect(new TextDecoder().decode(result)).toBe('abcdef')
    })
  })

  describe('skip and seek', () => {
    it('skips input blocks', () => {
      const input = new TextEncoder().encode('hello world')
      const result = executeDd(input, { bs: 6, skip: 1 })
      expect(new TextDecoder().decode(result)).toBe('world')
    })

    it('seeks in output (pads with zeros)', () => {
      const input = new TextEncoder().encode('hi')
      const result = executeDd(input, { bs: 1, seek: 3 })
      expect(result.length).toBe(5)
      expect(result[0]).toBe(0)
      expect(new TextDecoder().decode(result.slice(3))).toBe('hi')
    })
  })

  describe('edge cases', () => {
    it('handles empty input', () => {
      const input = new Uint8Array(0)
      const result = executeDd(input)
      expect(result.length).toBe(0)
    })

    it('handles skip beyond input', () => {
      const input = new TextEncoder().encode('hello')
      const result = executeDd(input, { bs: 10, skip: 1 })
      expect(result.length).toBe(0)
    })
  })
})

// ============================================================================
// OD COMMAND TESTS
// ============================================================================

describe('od command', () => {
  describe('octal format (default)', () => {
    it('outputs in octal by default', () => {
      const input = new TextEncoder().encode('ABC')
      const result = executeOd(input)
      expect(result).toContain('101')  // 'A' in octal
      expect(result).toContain('102')  // 'B' in octal
      expect(result).toContain('103')  // 'C' in octal
    })
  })

  describe('hex format (-x)', () => {
    it('outputs in hexadecimal', () => {
      const input = new TextEncoder().encode('ABC')
      const result = executeOd(input, { format: 'x' })
      expect(result).toContain('41')  // 'A' in hex
      expect(result).toContain('42')  // 'B' in hex
      expect(result).toContain('43')  // 'C' in hex
    })
  })

  describe('character format (-c)', () => {
    it('outputs printable characters', () => {
      const input = new TextEncoder().encode('ABC')
      const result = executeOd(input, { format: 'c' })
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('C')
    })

    it('shows escape sequences for special characters', () => {
      const input = new TextEncoder().encode('\n\t')
      const result = executeOd(input, { format: 'c' })
      expect(result).toContain('\\n')
      expect(result).toContain('\\t')
    })
  })

  describe('decimal format (-d)', () => {
    it('outputs in decimal', () => {
      const input = new TextEncoder().encode('A')
      const result = executeOd(input, { format: 'd' })
      expect(result).toContain('65')  // 'A' in decimal
    })
  })

  describe('address format (-A)', () => {
    it('uses octal addresses by default', () => {
      const input = new TextEncoder().encode('hello')
      const result = executeOd(input)
      expect(result).toMatch(/^0000000/)
    })

    it('uses hex addresses with -Ax', () => {
      const input = new TextEncoder().encode('hello')
      const result = executeOd(input, { addressFormat: 'x' })
      expect(result).toMatch(/^0000000/)
    })

    it('omits addresses with -An', () => {
      const input = new TextEncoder().encode('hello')
      const result = executeOd(input, { addressFormat: 'n' })
      expect(result).not.toMatch(/^0000000/)
    })
  })

  describe('width (-w)', () => {
    it('changes bytes per line', () => {
      const input = new TextEncoder().encode('hello world test')
      const result = executeOd(input, { width: 8, format: 'c' })
      const lines = result.trim().split('\n')
      expect(lines.length).toBeGreaterThan(2)
    })
  })

  describe('skip and count', () => {
    it('skips initial bytes', () => {
      const input = new TextEncoder().encode('hello')
      const result = executeOd(input, { skip: 2, format: 'c' })
      expect(result).toContain('l')
      expect(result).not.toContain('h')
    })

    it('limits bytes read', () => {
      const input = new TextEncoder().encode('hello')
      const result = executeOd(input, { count: 2, format: 'c' })
      expect(result).toContain('h')
      expect(result).toContain('e')
      expect(result).not.toContain('o')
    })
  })
})

/**
 * GNU Extensions Tests
 *
 * Tests for GNU-specific command extensions:
 * - grep -P: Perl-compatible regex (JavaScript regex)
 * - cut --complement: Invert field/character selection
 * - sort -h: Human-readable numeric sort (K, M, G suffixes)
 * - sort -V: Version number sort (1.2 < 1.10)
 * - uniq -w N: Compare only first N characters
 * - head -q: Suppress headers for multiple files
 * - head/tail -n -N: Exclude last N lines
 *
 * @module bashx/do/commands/gnu-extensions.test
 */

import { describe, it, expect } from 'vitest'
import {
  executeCut,
  executeSort,
  executeUniq,
} from './posix-utils.js'

// ============================================================================
// CUT --COMPLEMENT TESTS (already implemented, verify behavior)
// ============================================================================

describe('cut --complement (GNU extension)', () => {
  it('should invert field selection', () => {
    const input = 'a,b,c,d\n'
    const result = executeCut(input, { fields: '2', delimiter: ',', complement: true })
    expect(result).toBe('a,c,d\n')
  })

  it('should complement multiple fields', () => {
    const input = 'one,two,three,four,five\n'
    const result = executeCut(input, { fields: '1,3,5', delimiter: ',', complement: true })
    expect(result).toBe('two,four\n')
  })

  it('should complement byte selection', () => {
    const input = 'hello\n'
    const result = executeCut(input, { bytes: '2,4', complement: true })
    expect(result).toBe('hlo\n')
  })

  it('should complement character selection', () => {
    const input = 'abcde\n'
    const result = executeCut(input, { chars: '1,5', complement: true })
    expect(result).toBe('bcd\n')
  })

  it('should handle field range complement', () => {
    const input = 'a\tb\tc\td\te\n'
    const result = executeCut(input, { fields: '2-4', complement: true })
    expect(result).toBe('a\te\n')
  })
})

// ============================================================================
// SORT -h TESTS (Human-readable numeric sort)
// ============================================================================

describe('sort -h (human-readable numeric sort)', () => {
  it('should sort human-readable sizes correctly', () => {
    const lines = ['1K', '1M', '1G', '512K']
    const result = executeSort(lines, { humanNumeric: true })
    expect(result).toEqual(['1K', '512K', '1M', '1G'])
  })

  it('should handle mixed sizes', () => {
    const lines = ['10M', '2G', '500K', '1T']
    const result = executeSort(lines, { humanNumeric: true })
    expect(result).toEqual(['500K', '10M', '2G', '1T'])
  })

  it('should handle lowercase suffixes', () => {
    const lines = ['1k', '1m', '1g']
    const result = executeSort(lines, { humanNumeric: true })
    expect(result).toEqual(['1k', '1m', '1g'])
  })

  it('should handle values without suffixes', () => {
    const lines = ['1000', '2K', '500']
    const result = executeSort(lines, { humanNumeric: true })
    expect(result).toEqual(['500', '1000', '2K'])
  })

  it('should handle decimal values', () => {
    const lines = ['1.5K', '1K', '2K']
    const result = executeSort(lines, { humanNumeric: true })
    expect(result).toEqual(['1K', '1.5K', '2K'])
  })

  it('should work with reverse option', () => {
    const lines = ['1K', '1M', '1G']
    const result = executeSort(lines, { humanNumeric: true, reverse: true })
    expect(result).toEqual(['1G', '1M', '1K'])
  })
})

// ============================================================================
// SORT -V TESTS (Version number sort)
// ============================================================================

describe('sort -V (version number sort)', () => {
  it('should sort version numbers correctly', () => {
    const lines = ['1.2', '1.10', '1.1', '2.0']
    const result = executeSort(lines, { versionSort: true })
    expect(result).toEqual(['1.1', '1.2', '1.10', '2.0'])
  })

  it('should handle semver versions', () => {
    const lines = ['1.0.0', '1.10.0', '1.2.0', '2.0.0']
    const result = executeSort(lines, { versionSort: true })
    expect(result).toEqual(['1.0.0', '1.2.0', '1.10.0', '2.0.0'])
  })

  it('should handle version prefixes (v)', () => {
    const lines = ['v1.2', 'v1.10', 'v1.1']
    const result = executeSort(lines, { versionSort: true })
    expect(result).toEqual(['v1.1', 'v1.2', 'v1.10'])
  })

  it('should handle pre-release versions', () => {
    const lines = ['1.0-beta', '1.0-alpha', '1.0']
    const result = executeSort(lines, { versionSort: true })
    // Numbers sort before strings, so 1.0 (with number 0) comes before 1.0-alpha
    expect(result).toEqual(['1.0', '1.0-alpha', '1.0-beta'])
  })

  it('should handle complex versions with build numbers', () => {
    const lines = ['node-18.17.1', 'node-18.9.1', 'node-20.1.0']
    const result = executeSort(lines, { versionSort: true })
    expect(result).toEqual(['node-18.9.1', 'node-18.17.1', 'node-20.1.0'])
  })

  it('should handle file names with version numbers', () => {
    const lines = ['package-1.10.tar.gz', 'package-1.2.tar.gz', 'package-2.0.tar.gz']
    const result = executeSort(lines, { versionSort: true })
    expect(result).toEqual(['package-1.2.tar.gz', 'package-1.10.tar.gz', 'package-2.0.tar.gz'])
  })

  it('should work with reverse option', () => {
    const lines = ['1.1', '1.10', '1.2']
    const result = executeSort(lines, { versionSort: true, reverse: true })
    expect(result).toEqual(['1.10', '1.2', '1.1'])
  })

  it('should handle mixed numeric and text segments', () => {
    const lines = ['foo2bar', 'foo10bar', 'foo1bar']
    const result = executeSort(lines, { versionSort: true })
    expect(result).toEqual(['foo1bar', 'foo2bar', 'foo10bar'])
  })

  it('should sort kernel versions correctly', () => {
    const lines = ['5.4.0', '5.15.0', '5.4.10', '6.1.0']
    const result = executeSort(lines, { versionSort: true })
    expect(result).toEqual(['5.4.0', '5.4.10', '5.15.0', '6.1.0'])
  })
})

// ============================================================================
// UNIQ -w N TESTS (Compare only first N characters)
// ============================================================================

describe('uniq -w N (compare first N characters)', () => {
  it('should compare only first N characters', () => {
    const lines = ['abc123', 'abc456', 'def789']
    const result = executeUniq(lines, { compareChars: 3 })
    expect(result).toEqual(['abc123', 'def789'])
  })

  it('should keep first occurrence when comparing first N chars', () => {
    const lines = ['hello world', 'hello there', 'hi there']
    const result = executeUniq(lines, { compareChars: 5 })
    expect(result).toEqual(['hello world', 'hi there'])
  })

  it('should work with count option', () => {
    const lines = ['aaa1', 'aaa2', 'aaa3', 'bbb1']
    const result = executeUniq(lines, { compareChars: 3, count: true })
    expect(result[0]).toMatch(/^\s*3 aaa1$/)
    expect(result[1]).toMatch(/^\s*1 bbb1$/)
  })

  it('should work with repeated option', () => {
    const lines = ['foo1', 'foo2', 'bar1', 'bar2', 'baz1']
    const result = executeUniq(lines, { compareChars: 3, repeated: true })
    expect(result).toEqual(['foo1', 'bar1'])
  })

  it('should work with unique option', () => {
    const lines = ['aaa1', 'aaa2', 'bbb1', 'ccc1', 'ccc2']
    const result = executeUniq(lines, { compareChars: 3, unique: true })
    expect(result).toEqual(['bbb1'])
  })

  it('should work with ignoreCase option', () => {
    const lines = ['ABC123', 'abc456', 'DEF789']
    const result = executeUniq(lines, { compareChars: 3, ignoreCase: true })
    expect(result).toEqual(['ABC123', 'DEF789'])
  })

  it('should handle N larger than line length', () => {
    const lines = ['ab', 'ab', 'abc']
    const result = executeUniq(lines, { compareChars: 10 })
    expect(result).toEqual(['ab', 'abc'])
  })

  it('should handle N of 1', () => {
    const lines = ['apple', 'apricot', 'banana', 'blueberry']
    const result = executeUniq(lines, { compareChars: 1 })
    expect(result).toEqual(['apple', 'banana'])
  })

  it('should combine with skipFields', () => {
    const lines = ['1 abc', '2 abc', '3 def']
    const result = executeUniq(lines, { skipFields: 1, compareChars: 3 })
    expect(result).toEqual(['1 abc', '3 def'])
  })

  it('should combine with skipChars', () => {
    const lines = ['xxabc', 'xxabc', 'xxdef']
    const result = executeUniq(lines, { skipChars: 2, compareChars: 3 })
    expect(result).toEqual(['xxabc', 'xxdef'])
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('GNU extension integration', () => {
  describe('sort combinations', () => {
    it('should combine version sort with unique', () => {
      const lines = ['1.0', '1.10', '1.0', '1.2']
      const result = executeSort(lines, { versionSort: true, unique: true })
      expect(result).toEqual(['1.0', '1.2', '1.10'])
    })

    it('should combine human numeric with key', () => {
      const lines = ['file1 100K', 'file2 2M', 'file3 50K']
      const result = executeSort(lines, { humanNumeric: true, key: '2' })
      expect(result).toEqual(['file3 50K', 'file1 100K', 'file2 2M'])
    })
  })

  describe('cut and uniq pipeline simulation', () => {
    it('should work together for data extraction', () => {
      // Simulate: cut -d',' -f1 | uniq -w 3
      const input = 'abc123,data\nabc456,more\ndef789,other\n'
      const cutResult = executeCut(input, { fields: '1', delimiter: ',' })
      // cutResult = 'abc123\nabc456\ndef789\n'
      const lines = cutResult.split('\n').filter(l => l)
      const uniqResult = executeUniq(lines, { compareChars: 3 })
      expect(uniqResult).toEqual(['abc123', 'def789'])
    })
  })
})

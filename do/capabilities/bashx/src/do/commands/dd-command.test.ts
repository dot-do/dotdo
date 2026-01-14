/**
 * DD Command Tests
 *
 * Comprehensive tests for the POSIX `dd` command implementation.
 * Tests block copying, size parsing, conversions, and statistics.
 *
 * @module bashx/do/commands/dd-command.test
 */

import { describe, it, expect } from 'vitest'
import {
  executeDd,
  parseDdArgs,
  parseSize,
  formatDdStats,
  isDdCommand,
  type DdStats,
} from './dd-command.js'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert string to Uint8Array
 */
function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

/**
 * Convert Uint8Array to string
 */
function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

// ============================================================================
// SIZE PARSING TESTS
// ============================================================================

describe('parseSize', () => {
  describe('basic numbers', () => {
    it('parses plain numbers', () => {
      expect(parseSize('512')).toBe(512)
      expect(parseSize('1024')).toBe(1024)
      expect(parseSize('0')).toBe(0)
    })
  })

  describe('binary suffixes (K, M, G)', () => {
    it('parses K suffix (1024)', () => {
      expect(parseSize('1K')).toBe(1024)
      expect(parseSize('2K')).toBe(2048)
      expect(parseSize('1k')).toBe(1024)
    })

    it('parses M suffix (1024^2)', () => {
      expect(parseSize('1M')).toBe(1048576)
      expect(parseSize('2M')).toBe(2097152)
      expect(parseSize('1m')).toBe(1048576)
    })

    it('parses G suffix (1024^3)', () => {
      expect(parseSize('1G')).toBe(1073741824)
      expect(parseSize('1g')).toBe(1073741824)
    })

    it('parses T suffix (1024^4)', () => {
      expect(parseSize('1T')).toBe(1099511627776)
    })
  })

  describe('error handling', () => {
    it('throws on invalid format', () => {
      expect(() => parseSize('abc')).toThrow("invalid number: 'abc'")
      expect(() => parseSize('-1')).toThrow("invalid number: '-1'")
      expect(() => parseSize('1X')).toThrow("invalid number: '1X'")
    })
  })
})

// ============================================================================
// ARGUMENT PARSING TESTS
// ============================================================================

describe('parseDdArgs', () => {
  describe('file operands', () => {
    it('parses if= input file', () => {
      const options = parseDdArgs(['if=input.bin'])
      expect(options.if).toBe('input.bin')
    })

    it('parses of= output file', () => {
      const options = parseDdArgs(['of=output.bin'])
      expect(options.of).toBe('output.bin')
    })

    it('parses both if= and of=', () => {
      const options = parseDdArgs(['if=in.bin', 'of=out.bin'])
      expect(options.if).toBe('in.bin')
      expect(options.of).toBe('out.bin')
    })
  })

  describe('block size operands', () => {
    it('parses bs= block size', () => {
      const options = parseDdArgs(['bs=512'])
      expect(options.bs).toBe(512)
    })

    it('parses bs= with suffix', () => {
      const options = parseDdArgs(['bs=1K'])
      expect(options.bs).toBe(1024)
    })

    it('parses ibs= input block size', () => {
      const options = parseDdArgs(['ibs=256'])
      expect(options.ibs).toBe(256)
    })

    it('parses obs= output block size', () => {
      const options = parseDdArgs(['obs=4K'])
      expect(options.obs).toBe(4096)
    })
  })

  describe('count and seek operands', () => {
    it('parses count= block count', () => {
      const options = parseDdArgs(['count=10'])
      expect(options.count).toBe(10)
    })

    it('parses skip= input skip', () => {
      const options = parseDdArgs(['skip=5'])
      expect(options.skip).toBe(5)
    })

    it('parses seek= output seek', () => {
      const options = parseDdArgs(['seek=3'])
      expect(options.seek).toBe(3)
    })
  })

  describe('conv= operand', () => {
    it('parses single conversion', () => {
      const options = parseDdArgs(['conv=lcase'])
      expect(options.conv).toEqual(['lcase'])
    })

    it('parses multiple conversions', () => {
      const options = parseDdArgs(['conv=lcase,sync,notrunc'])
      expect(options.conv).toEqual(['lcase', 'sync', 'notrunc'])
    })
  })

  describe('complex operand combinations', () => {
    it('parses typical dd command', () => {
      const options = parseDdArgs([
        'if=input.iso',
        'of=/dev/sdb',
        'bs=4M',
        'count=1024',
        'conv=sync,noerror',
      ])
      expect(options.if).toBe('input.iso')
      expect(options.of).toBe('/dev/sdb')
      expect(options.bs).toBe(4 * 1024 * 1024)
      expect(options.count).toBe(1024)
      expect(options.conv).toEqual(['sync', 'noerror'])
    })
  })

  describe('error handling', () => {
    it('throws on unrecognized operand', () => {
      expect(() => parseDdArgs(['unknown=value'])).toThrow("unrecognized operand 'unknown=value'")
    })

    it('throws on operand without =', () => {
      expect(() => parseDdArgs(['noequals'])).toThrow("unrecognized operand 'noequals'")
    })

    it('throws on invalid count', () => {
      expect(() => parseDdArgs(['count=-1'])).toThrow("invalid number of blocks: '-1'")
      expect(() => parseDdArgs(['count=abc'])).toThrow("invalid number of blocks: 'abc'")
    })
  })
})

// ============================================================================
// BLOCK COPY TESTS
// ============================================================================

describe('executeDd - basic copying', () => {
  describe('default behavior', () => {
    it('copies all data with default options', () => {
      const input = toBytes('hello world')
      const result = executeDd(input)
      expect(fromBytes(result.output)).toBe('hello world')
      expect(result.stats.bytesCopied).toBe(11)
    })

    it('returns empty output for empty input', () => {
      const input = new Uint8Array(0)
      const result = executeDd(input)
      expect(result.output.length).toBe(0)
      expect(result.stats.bytesCopied).toBe(0)
    })
  })

  describe('block size (bs=)', () => {
    it('respects block size for statistics', () => {
      const input = toBytes('hello world')  // 11 bytes
      const result = executeDd(input, { bs: 5 })
      expect(fromBytes(result.output)).toBe('hello world')
      expect(result.stats.fullBlocksIn).toBe(2)  // 5 + 5
      expect(result.stats.partialBlocksIn).toBe(1)  // 1 remaining
    })

    it('handles exact block size match', () => {
      const input = toBytes('1234567890')  // 10 bytes
      const result = executeDd(input, { bs: 5 })
      expect(result.stats.fullBlocksIn).toBe(2)
      expect(result.stats.partialBlocksIn).toBe(0)
    })
  })

  describe('count= (block count)', () => {
    it('limits output to count blocks', () => {
      const input = toBytes('hello world')  // 11 bytes
      const result = executeDd(input, { bs: 5, count: 1 })
      expect(fromBytes(result.output)).toBe('hello')
      expect(result.stats.bytesCopied).toBe(5)
    })

    it('handles count=0', () => {
      const input = toBytes('hello world')
      const result = executeDd(input, { count: 0 })
      expect(result.output.length).toBe(0)
      expect(result.stats.bytesCopied).toBe(0)
    })

    it('handles count larger than input', () => {
      const input = toBytes('hi')
      const result = executeDd(input, { bs: 1, count: 100 })
      expect(fromBytes(result.output)).toBe('hi')
      expect(result.stats.bytesCopied).toBe(2)
    })
  })

  describe('skip= (input skip)', () => {
    it('skips input blocks', () => {
      const input = toBytes('hello world')  // 11 bytes
      const result = executeDd(input, { bs: 5, skip: 1 })
      expect(fromBytes(result.output)).toBe(' world')  // Skip first 5 bytes
    })

    it('returns empty when skip exceeds input', () => {
      const input = toBytes('hello')
      const result = executeDd(input, { bs: 10, skip: 1 })
      expect(result.output.length).toBe(0)
    })

    it('combines skip and count', () => {
      const input = toBytes('0123456789ABCDEF')  // 16 chars
      const result = executeDd(input, { bs: 4, skip: 1, count: 2 })
      // Skip 4 bytes (0123), read 8 bytes (45678ABC)
      // But count=2 blocks of 4 bytes each = 8 bytes from position 4
      expect(fromBytes(result.output)).toBe('456789AB')
    })
  })

  describe('seek= (output seek)', () => {
    it('pads output with zeros', () => {
      const input = toBytes('ABC')
      const result = executeDd(input, { obs: 3, seek: 2 })
      // Seek 2 blocks of 3 bytes each = 6 zero bytes
      expect(result.output.length).toBe(9)
      expect(result.output[0]).toBe(0)
      expect(result.output[5]).toBe(0)
      expect(fromBytes(result.output.slice(6))).toBe('ABC')
    })
  })
})

// ============================================================================
// CONVERSION TESTS
// ============================================================================

describe('executeDd - conversions', () => {
  describe('conv=lcase', () => {
    it('converts uppercase to lowercase', () => {
      const input = toBytes('HELLO WORLD')
      const result = executeDd(input, { conv: ['lcase'] })
      expect(fromBytes(result.output)).toBe('hello world')
    })

    it('preserves non-uppercase characters', () => {
      const input = toBytes('Hello World 123!')
      const result = executeDd(input, { conv: ['lcase'] })
      expect(fromBytes(result.output)).toBe('hello world 123!')
    })
  })

  describe('conv=ucase', () => {
    it('converts lowercase to uppercase', () => {
      const input = toBytes('hello world')
      const result = executeDd(input, { conv: ['ucase'] })
      expect(fromBytes(result.output)).toBe('HELLO WORLD')
    })

    it('preserves non-lowercase characters', () => {
      const input = toBytes('Hello World 123!')
      const result = executeDd(input, { conv: ['ucase'] })
      expect(fromBytes(result.output)).toBe('HELLO WORLD 123!')
    })
  })

  describe('conv=sync', () => {
    it('pads partial blocks with NULs', () => {
      const input = toBytes('ABC')  // 3 bytes
      const result = executeDd(input, { bs: 5, conv: ['sync'] })
      expect(result.output.length).toBe(5)
      expect(fromBytes(result.output.slice(0, 3))).toBe('ABC')
      expect(result.output[3]).toBe(0)
      expect(result.output[4]).toBe(0)
    })

    it('does not pad full blocks', () => {
      const input = toBytes('ABCDE')  // 5 bytes
      const result = executeDd(input, { bs: 5, conv: ['sync'] })
      expect(result.output.length).toBe(5)
      expect(fromBytes(result.output)).toBe('ABCDE')
    })
  })

  describe('multiple conversions', () => {
    it('applies conversions in order', () => {
      const input = toBytes('HELLO WORLD')
      const result = executeDd(input, { conv: ['lcase'] })
      expect(fromBytes(result.output)).toBe('hello world')
    })
  })
})

// ============================================================================
// SEPARATE BLOCK SIZES (IBS/OBS) TESTS
// ============================================================================

describe('executeDd - separate block sizes', () => {
  describe('ibs= (input block size)', () => {
    it('uses ibs for input reading', () => {
      const input = toBytes('hello world')
      const result = executeDd(input, { ibs: 3, skip: 1 })
      // Skip 1 block of 3 bytes = skip 3 bytes
      expect(fromBytes(result.output)).toBe('lo world')
    })
  })

  describe('obs= (output block size)', () => {
    it('uses obs for output statistics', () => {
      const input = toBytes('hello world')
      const result = executeDd(input, { obs: 4 })
      // 11 bytes = 2 full blocks of 4 + 1 partial of 3
      expect(result.stats.fullBlocksOut).toBe(2)
      expect(result.stats.partialBlocksOut).toBe(1)
    })

    it('uses obs for seek calculation', () => {
      const input = toBytes('ABC')
      const result = executeDd(input, { obs: 2, seek: 2 })
      // Seek 2 blocks of 2 bytes = 4 zero bytes
      expect(result.output.length).toBe(7)
      expect(result.output[3]).toBe(0)
      expect(fromBytes(result.output.slice(4))).toBe('ABC')
    })
  })

  describe('ibs and obs together', () => {
    it('uses ibs for input, obs for output', () => {
      const input = toBytes('0123456789')  // 10 bytes
      const result = executeDd(input, { ibs: 2, obs: 5, skip: 1 })
      // Skip 1 input block of 2 bytes
      expect(fromBytes(result.output)).toBe('23456789')
      // Output: 8 bytes = 1 full block of 5 + 1 partial of 3
      expect(result.stats.fullBlocksOut).toBe(1)
      expect(result.stats.partialBlocksOut).toBe(1)
    })
  })
})

// ============================================================================
// STATISTICS TESTS
// ============================================================================

describe('executeDd - statistics', () => {
  it('tracks full and partial input blocks', () => {
    const input = toBytes('0123456789A')  // 11 bytes
    const result = executeDd(input, { bs: 4 })
    // 11 / 4 = 2 full blocks (8 bytes) + 1 partial (3 bytes)
    expect(result.stats.fullBlocksIn).toBe(2)
    expect(result.stats.partialBlocksIn).toBe(1)
  })

  it('tracks full and partial output blocks', () => {
    const input = toBytes('0123456')  // 7 bytes
    const result = executeDd(input, { obs: 3 })
    // 7 / 3 = 2 full blocks + 1 partial
    expect(result.stats.fullBlocksOut).toBe(2)
    expect(result.stats.partialBlocksOut).toBe(1)
  })

  it('tracks total bytes copied', () => {
    const input = toBytes('hello world')
    const result = executeDd(input, { bs: 5, count: 2 })
    expect(result.stats.bytesCopied).toBe(10)
  })
})

// ============================================================================
// FORMAT STATS TESTS
// ============================================================================

describe('formatDdStats', () => {
  it('formats stats correctly', () => {
    const stats: DdStats = {
      fullBlocksIn: 10,
      partialBlocksIn: 1,
      fullBlocksOut: 10,
      partialBlocksOut: 1,
      bytesCopied: 5632,
    }
    const output = formatDdStats(stats)
    expect(output).toContain('10+1 records in')
    expect(output).toContain('10+1 records out')
    expect(output).toContain('5632 bytes copied')
  })

  it('handles zero partial blocks', () => {
    const stats: DdStats = {
      fullBlocksIn: 5,
      partialBlocksIn: 0,
      fullBlocksOut: 5,
      partialBlocksOut: 0,
      bytesCopied: 2560,
    }
    const output = formatDdStats(stats)
    expect(output).toContain('5+0 records in')
    expect(output).toContain('5+0 records out')
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('isDdCommand', () => {
  it('returns true for "dd"', () => {
    expect(isDdCommand('dd')).toBe(true)
  })

  it('returns false for other commands', () => {
    expect(isDdCommand('cp')).toBe(false)
    expect(isDdCommand('cat')).toBe(false)
    expect(isDdCommand('od')).toBe(false)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('executeDd - edge cases', () => {
  it('handles binary data correctly', () => {
    const input = new Uint8Array([0, 1, 127, 128, 255])
    const result = executeDd(input)
    expect(result.output).toEqual(input)
  })

  it('handles large block sizes with small input', () => {
    const input = toBytes('hi')
    const result = executeDd(input, { bs: 1024 })
    expect(fromBytes(result.output)).toBe('hi')
    expect(result.stats.partialBlocksIn).toBe(1)
    expect(result.stats.fullBlocksIn).toBe(0)
  })

  it('handles very small block size', () => {
    const input = toBytes('ABCD')
    const result = executeDd(input, { bs: 1, count: 2 })
    expect(fromBytes(result.output)).toBe('AB')
    expect(result.stats.fullBlocksIn).toBe(2)
  })

  it('preserves exact byte values with conversions', () => {
    // Test that lcase only affects A-Z
    const input = new Uint8Array([65, 90, 128, 255, 0])  // A, Z, and non-ASCII
    const result = executeDd(input, { conv: ['lcase'] })
    expect(result.output[0]).toBe(97)   // a
    expect(result.output[1]).toBe(122)  // z
    expect(result.output[2]).toBe(128)  // unchanged
    expect(result.output[3]).toBe(255)  // unchanged
    expect(result.output[4]).toBe(0)    // unchanged
  })
})

/**
 * OD Command Tests
 *
 * Comprehensive tests for the POSIX `od` command implementation.
 * Tests octal/hex dump, address formats, type specifications, and output formatting.
 *
 * @module bashx/do/commands/od-command.test
 */

import { describe, it, expect } from 'vitest'
import {
  executeOd,
  parseOdArgs,
  parseTypeSpec,
  isOdCommand,
} from './od-command.js'

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
 * Create Uint8Array from byte values
 */
function fromByteValues(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

// ============================================================================
// TYPE SPEC PARSING TESTS
// ============================================================================

describe('parseTypeSpec', () => {
  describe('basic types', () => {
    it('parses type "o" (octal) with default size', () => {
      const spec = parseTypeSpec('o')
      expect(spec.type).toBe('o')
      expect(spec.size).toBe(2)  // Default for octal
    })

    it('parses type "x" (hex) with default size', () => {
      const spec = parseTypeSpec('x')
      expect(spec.type).toBe('x')
      expect(spec.size).toBe(2)  // Default for hex
    })

    it('parses type "d" (signed decimal) with default size', () => {
      const spec = parseTypeSpec('d')
      expect(spec.type).toBe('d')
      expect(spec.size).toBe(4)  // Default for decimal
    })

    it('parses type "u" (unsigned decimal) with default size', () => {
      const spec = parseTypeSpec('u')
      expect(spec.type).toBe('u')
      expect(spec.size).toBe(4)  // Default for unsigned
    })

    it('parses type "c" (character)', () => {
      const spec = parseTypeSpec('c')
      expect(spec.type).toBe('c')
      expect(spec.size).toBe(1)  // Always 1 for char
    })

    it('parses type "a" (named character)', () => {
      const spec = parseTypeSpec('a')
      expect(spec.type).toBe('a')
      expect(spec.size).toBe(1)  // Always 1 for named char
    })
  })

  describe('explicit sizes', () => {
    it('parses numeric size', () => {
      expect(parseTypeSpec('x1').size).toBe(1)
      expect(parseTypeSpec('x2').size).toBe(2)
      expect(parseTypeSpec('x4').size).toBe(4)
      expect(parseTypeSpec('x8').size).toBe(8)
    })

    it('parses size specifiers (C, S, I, L)', () => {
      expect(parseTypeSpec('dC').size).toBe(1)  // char
      expect(parseTypeSpec('dS').size).toBe(2)  // short
      expect(parseTypeSpec('dI').size).toBe(4)  // int
      expect(parseTypeSpec('dL').size).toBe(8)  // long
    })

    it('is case-insensitive for size specifiers', () => {
      expect(parseTypeSpec('dc').size).toBe(1)
      expect(parseTypeSpec('ds').size).toBe(2)
      expect(parseTypeSpec('di').size).toBe(4)
      expect(parseTypeSpec('dl').size).toBe(8)
    })
  })

  describe('error handling', () => {
    it('throws on empty string', () => {
      expect(() => parseTypeSpec('')).toThrow("invalid type string ''")
    })

    it('throws on invalid type character', () => {
      expect(() => parseTypeSpec('z')).toThrow("invalid type string 'z'")
      expect(() => parseTypeSpec('1')).toThrow("invalid type string '1'")
    })

    it('throws on invalid size for char types', () => {
      expect(() => parseTypeSpec('c2')).toThrow("invalid type string 'c2'")
      expect(() => parseTypeSpec('a4')).toThrow("invalid type string 'a4'")
    })

    it('throws on invalid size specifier', () => {
      expect(() => parseTypeSpec('x3')).toThrow("invalid type string 'x3'")
      expect(() => parseTypeSpec('dX')).toThrow("invalid type string 'dX'")
    })
  })
})

// ============================================================================
// ARGUMENT PARSING TESTS
// ============================================================================

describe('parseOdArgs', () => {
  describe('address radix (-A)', () => {
    it('parses -A d (decimal)', () => {
      const options = parseOdArgs(['-A', 'd'])
      expect(options.addressRadix).toBe('d')
    })

    it('parses -Ax (hex)', () => {
      const options = parseOdArgs(['-Ax'])
      expect(options.addressRadix).toBe('x')
    })

    it('parses -A o (octal)', () => {
      const options = parseOdArgs(['-A', 'o'])
      expect(options.addressRadix).toBe('o')
    })

    it('parses -A n (none)', () => {
      const options = parseOdArgs(['-An'])
      expect(options.addressRadix).toBe('n')
    })

    it('throws on invalid radix', () => {
      expect(() => parseOdArgs(['-A', 'q'])).toThrow("invalid address radix 'q'")
    })
  })

  describe('type format (-t)', () => {
    it('parses -t with type spec', () => {
      const options = parseOdArgs(['-t', 'x2'])
      expect(options.types).toHaveLength(1)
      expect(options.types![0]).toEqual({ type: 'x', size: 2 })
    })

    it('parses -tx2 combined form', () => {
      const options = parseOdArgs(['-tx2'])
      expect(options.types).toHaveLength(1)
      expect(options.types![0]).toEqual({ type: 'x', size: 2 })
    })

    it('parses multiple type specs', () => {
      const options = parseOdArgs(['-t', 'x2', '-t', 'd4'])
      expect(options.types).toHaveLength(2)
      expect(options.types![0]).toEqual({ type: 'x', size: 2 })
      expect(options.types![1]).toEqual({ type: 'd', size: 4 })
    })
  })

  describe('byte count (-N)', () => {
    it('parses -N count', () => {
      const options = parseOdArgs(['-N', '32'])
      expect(options.count).toBe(32)
    })

    it('parses -N32 combined form', () => {
      const options = parseOdArgs(['-N32'])
      expect(options.count).toBe(32)
    })

    it('throws on invalid count', () => {
      expect(() => parseOdArgs(['-N', 'abc'])).toThrow("invalid number of bytes: 'abc'")
      expect(() => parseOdArgs(['-N', '-1'])).toThrow("invalid number of bytes: '-1'")
    })
  })

  describe('skip bytes (-j)', () => {
    it('parses -j skip', () => {
      const options = parseOdArgs(['-j', '16'])
      expect(options.skip).toBe(16)
    })

    it('parses -j16 combined form', () => {
      const options = parseOdArgs(['-j16'])
      expect(options.skip).toBe(16)
    })
  })

  describe('width (-w)', () => {
    it('parses -w width', () => {
      const options = parseOdArgs(['-w', '32'])
      expect(options.width).toBe(32)
    })

    it('parses -w32 combined form', () => {
      const options = parseOdArgs(['-w32'])
      expect(options.width).toBe(32)
    })

    it('throws on invalid width', () => {
      expect(() => parseOdArgs(['-w', '0'])).toThrow("invalid line width: '0'")
      expect(() => parseOdArgs(['-w', '-8'])).toThrow("invalid line width: '-8'")
    })
  })

  describe('traditional options', () => {
    it('parses -b (octal bytes)', () => {
      const options = parseOdArgs(['-b'])
      expect(options.types).toContainEqual({ type: 'o', size: 1 })
    })

    it('parses -c (chars)', () => {
      const options = parseOdArgs(['-c'])
      expect(options.types).toContainEqual({ type: 'c', size: 1 })
    })

    it('parses -x (hex shorts)', () => {
      const options = parseOdArgs(['-x'])
      expect(options.types).toContainEqual({ type: 'x', size: 2 })
    })

    it('parses -d (unsigned decimal shorts)', () => {
      const options = parseOdArgs(['-d'])
      expect(options.types).toContainEqual({ type: 'u', size: 2 })
    })

    it('parses -o (octal shorts)', () => {
      const options = parseOdArgs(['-o'])
      expect(options.types).toContainEqual({ type: 'o', size: 2 })
    })

    it('parses -s (signed decimal shorts)', () => {
      const options = parseOdArgs(['-s'])
      expect(options.types).toContainEqual({ type: 'd', size: 2 })
    })
  })

  describe('complex combinations', () => {
    it('parses typical od command', () => {
      const options = parseOdArgs(['-Ax', '-tx1', '-N64', '-j8', '-w16'])
      expect(options.addressRadix).toBe('x')
      expect(options.types).toContainEqual({ type: 'x', size: 1 })
      expect(options.count).toBe(64)
      expect(options.skip).toBe(8)
      expect(options.width).toBe(16)
    })
  })
})

// ============================================================================
// BASIC OUTPUT FORMAT TESTS
// ============================================================================

describe('executeOd - output formats', () => {
  describe('default octal output', () => {
    it('outputs octal shorts by default', () => {
      const input = fromByteValues(0x41, 0x42, 0x43, 0x44)  // ABCD
      const result = executeOd(input)
      // Default: octal shorts, octal address
      expect(result.output).toContain('0000000')
      expect(result.output).toContain('0000004')
    })
  })

  describe('hexadecimal output (-t x)', () => {
    it('outputs hex bytes', () => {
      const input = fromByteValues(0x00, 0x41, 0xff)
      const result = executeOd(input, { types: [{ type: 'x', size: 1 }] })
      expect(result.output).toContain('00')
      expect(result.output).toContain('41')
      expect(result.output).toContain('ff')
    })

    it('outputs hex shorts', () => {
      const input = fromByteValues(0x12, 0x34)  // Little-endian: 0x3412
      const result = executeOd(input, { types: [{ type: 'x', size: 2 }] })
      expect(result.output).toContain('3412')
    })

    it('outputs hex ints', () => {
      const input = fromByteValues(0x01, 0x02, 0x03, 0x04)  // Little-endian: 0x04030201
      const result = executeOd(input, { types: [{ type: 'x', size: 4 }] })
      expect(result.output).toContain('04030201')
    })
  })

  describe('decimal output (-t d)', () => {
    it('outputs signed decimal', () => {
      const input = fromByteValues(0xff, 0xff)  // -1 as signed short
      const result = executeOd(input, { types: [{ type: 'd', size: 2 }] })
      expect(result.output).toContain('-1')
    })

    it('handles positive values', () => {
      const input = fromByteValues(0x01, 0x00)  // 1 as little-endian short
      const result = executeOd(input, { types: [{ type: 'd', size: 2 }] })
      expect(result.output).toContain('1')
    })
  })

  describe('unsigned decimal output (-t u)', () => {
    it('outputs unsigned decimal', () => {
      const input = fromByteValues(0xff, 0xff)  // 65535 as unsigned short
      const result = executeOd(input, { types: [{ type: 'u', size: 2 }] })
      expect(result.output).toContain('65535')
    })
  })

  describe('octal output (-t o)', () => {
    it('outputs octal bytes', () => {
      const input = fromByteValues(0o101, 0o102, 0o103)  // ABC in octal
      const result = executeOd(input, { types: [{ type: 'o', size: 1 }] })
      expect(result.output).toContain('101')
      expect(result.output).toContain('102')
      expect(result.output).toContain('103')
    })
  })

  describe('character output (-t c)', () => {
    it('outputs printable characters', () => {
      const input = toBytes('ABC')
      const result = executeOd(input, { types: [{ type: 'c', size: 1 }] })
      expect(result.output).toContain('A')
      expect(result.output).toContain('B')
      expect(result.output).toContain('C')
    })

    it('outputs escape sequences for control chars', () => {
      const input = fromByteValues(0, 9, 10, 13)  // NUL, TAB, LF, CR
      const result = executeOd(input, { types: [{ type: 'c', size: 1 }] })
      expect(result.output).toContain('\\0')
      expect(result.output).toContain('\\t')
      expect(result.output).toContain('\\n')
      expect(result.output).toContain('\\r')
    })

    it('outputs octal for non-printable, non-special chars', () => {
      const input = fromByteValues(1)  // SOH - not printable, no escape
      const result = executeOd(input, { types: [{ type: 'c', size: 1 }] })
      expect(result.output).toContain('001')
    })
  })

  describe('named character output (-t a)', () => {
    it('outputs named control characters', () => {
      const input = fromByteValues(0, 7, 9, 10, 27, 32, 127)
      const result = executeOd(input, { types: [{ type: 'a', size: 1 }] })
      expect(result.output).toContain('nul')
      expect(result.output).toContain('bel')
      expect(result.output).toContain('ht')
      expect(result.output).toContain('nl')
      expect(result.output).toContain('esc')
      expect(result.output).toContain('sp')
      expect(result.output).toContain('del')
    })

    it('outputs printable characters', () => {
      const input = toBytes('A')
      const result = executeOd(input, { types: [{ type: 'a', size: 1 }] })
      expect(result.output).toContain('A')
    })
  })
})

// ============================================================================
// ADDRESS FORMAT TESTS
// ============================================================================

describe('executeOd - address formats', () => {
  describe('octal address (-A o)', () => {
    it('uses octal addresses by default', () => {
      const input = fromByteValues(0x41)
      const result = executeOd(input, { addressRadix: 'o' })
      expect(result.output).toMatch(/^0000000/)
      expect(result.output).toContain('0000001')  // Final address
    })
  })

  describe('hexadecimal address (-A x)', () => {
    it('uses hex addresses', () => {
      const input = new Uint8Array(17)  // More than 16 bytes
      const result = executeOd(input, { addressRadix: 'x', types: [{ type: 'x', size: 1 }] })
      expect(result.output).toMatch(/^0000000/)
      expect(result.output).toContain('0000010')  // 16 in hex
    })
  })

  describe('decimal address (-A d)', () => {
    it('uses decimal addresses', () => {
      const input = new Uint8Array(17)
      const result = executeOd(input, { addressRadix: 'd', types: [{ type: 'x', size: 1 }] })
      expect(result.output).toMatch(/^0000000/)
      expect(result.output).toContain('0000016')  // 16 in decimal
    })
  })

  describe('no address (-A n)', () => {
    it('omits addresses', () => {
      const input = toBytes('ABC')
      const result = executeOd(input, { addressRadix: 'n', types: [{ type: 'c', size: 1 }] })
      // Should not have 7-digit address prefix
      expect(result.output).not.toMatch(/^\d{7}/)
    })
  })
})

// ============================================================================
// SKIP AND COUNT TESTS
// ============================================================================

describe('executeOd - skip and count', () => {
  describe('skip bytes (-j)', () => {
    it('skips initial bytes', () => {
      const input = toBytes('ABCDEFGHIJ')
      const result = executeOd(input, {
        skip: 4,
        types: [{ type: 'c', size: 1 }],
      })
      expect(result.output).toContain('E')
      expect(result.output).not.toContain('A')
      expect(result.bytesProcessed).toBe(6)
    })

    it('handles skip beyond input length', () => {
      const input = toBytes('ABC')
      const result = executeOd(input, { skip: 100 })
      expect(result.bytesProcessed).toBe(0)
    })
  })

  describe('limit bytes (-N)', () => {
    it('limits output to N bytes', () => {
      const input = toBytes('ABCDEFGHIJ')
      const result = executeOd(input, {
        count: 4,
        types: [{ type: 'c', size: 1 }],
      })
      expect(result.output).toContain('A')
      expect(result.output).toContain('D')
      expect(result.output).not.toContain('E')
      expect(result.bytesProcessed).toBe(4)
    })

    it('handles count larger than input', () => {
      const input = toBytes('ABC')
      const result = executeOd(input, { count: 100 })
      expect(result.bytesProcessed).toBe(3)
    })
  })

  describe('skip and count together', () => {
    it('combines skip and count correctly', () => {
      const input = toBytes('ABCDEFGHIJ')
      const result = executeOd(input, {
        skip: 2,
        count: 4,
        types: [{ type: 'c', size: 1 }],
      })
      // Skip 2 ('AB'), read 4 ('CDEF')
      expect(result.output).toContain('C')
      expect(result.output).toContain('F')
      expect(result.output).not.toContain('A')
      expect(result.output).not.toContain('B')
      expect(result.output).not.toContain('G')
      expect(result.bytesProcessed).toBe(4)
    })
  })
})

// ============================================================================
// WIDTH TESTS
// ============================================================================

describe('executeOd - width', () => {
  it('uses default width of 16', () => {
    const input = new Uint8Array(32)
    const result = executeOd(input, { types: [{ type: 'x', size: 1 }] })
    // Should have 2 data lines plus final address
    const lines = result.output.trim().split('\n')
    expect(lines.length).toBe(3)
  })

  it('respects custom width', () => {
    const input = new Uint8Array(16)
    const result = executeOd(input, { width: 8, types: [{ type: 'x', size: 1 }] })
    // 16 bytes / 8 per line = 2 data lines plus final address
    const lines = result.output.trim().split('\n')
    expect(lines.length).toBe(3)
  })

  it('handles width larger than input', () => {
    const input = toBytes('ABC')
    const result = executeOd(input, { width: 32, types: [{ type: 'c', size: 1 }] })
    const lines = result.output.trim().split('\n')
    // Should have 1 data line plus final address
    expect(lines.length).toBe(2)
  })
})

// ============================================================================
// MULTIPLE TYPE SPECS TESTS
// ============================================================================

describe('executeOd - multiple types', () => {
  it('outputs multiple type formats', () => {
    const input = fromByteValues(0x41, 0x42)
    const result = executeOd(input, {
      types: [
        { type: 'x', size: 1 },
        { type: 'c', size: 1 },
      ],
    })
    // Should have hex output and char output
    expect(result.output).toContain('41')
    expect(result.output).toContain('42')
    expect(result.output).toContain('A')
    expect(result.output).toContain('B')
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('isOdCommand', () => {
  it('returns true for "od"', () => {
    expect(isOdCommand('od')).toBe(true)
  })

  it('returns false for other commands', () => {
    expect(isOdCommand('dd')).toBe(false)
    expect(isOdCommand('hexdump')).toBe(false)
    expect(isOdCommand('xxd')).toBe(false)
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('executeOd - edge cases', () => {
  it('handles empty input', () => {
    const input = new Uint8Array(0)
    const result = executeOd(input)
    // Should have just the final address line
    expect(result.output).toContain('0000000')
    expect(result.bytesProcessed).toBe(0)
  })

  it('handles single byte input', () => {
    const input = fromByteValues(0x41)
    const result = executeOd(input, { types: [{ type: 'x', size: 1 }] })
    expect(result.output).toContain('41')
    expect(result.bytesProcessed).toBe(1)
  })

  it('handles input not aligned to type size', () => {
    const input = fromByteValues(0x01, 0x02, 0x03)  // 3 bytes, not aligned to 2
    const result = executeOd(input, { types: [{ type: 'x', size: 2 }] })
    // Should handle partial read gracefully
    expect(result.output).toContain('0201')  // First short
    expect(result.bytesProcessed).toBe(3)
  })

  it('handles all zero bytes', () => {
    const input = new Uint8Array(4)
    const result = executeOd(input, { types: [{ type: 'x', size: 1 }] })
    expect(result.output).toContain('00')
  })

  it('handles all 0xff bytes', () => {
    const input = fromByteValues(0xff, 0xff, 0xff, 0xff)
    const result = executeOd(input, { types: [{ type: 'x', size: 1 }] })
    expect(result.output).toContain('ff')
  })

  it('handles large multi-byte values', () => {
    // Test 8-byte integer handling
    const input = fromByteValues(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f)
    const result = executeOd(input, { types: [{ type: 'x', size: 8 }] })
    expect(result.output).toContain('7fffffffffffffff')
  })
})

// ============================================================================
// REAL-WORLD SCENARIO TESTS
// ============================================================================

describe('executeOd - real-world scenarios', () => {
  it('dumps typical binary file header', () => {
    // ELF header magic bytes
    const elfMagic = fromByteValues(0x7f, 0x45, 0x4c, 0x46)
    const result = executeOd(elfMagic, {
      types: [{ type: 'x', size: 1 }],
      addressRadix: 'x',
    })
    expect(result.output).toContain('7f')
    expect(result.output).toContain('45')  // E
    expect(result.output).toContain('4c')  // L
    expect(result.output).toContain('46')  // F
  })

  it('dumps text file with mixed content', () => {
    const text = toBytes('Hello\nWorld\t!')
    const result = executeOd(text, {
      types: [{ type: 'c', size: 1 }],
    })
    expect(result.output).toContain('H')
    expect(result.output).toContain('\\n')
    expect(result.output).toContain('\\t')
    expect(result.output).toContain('!')
  })

  it('analyzes network packet data', () => {
    // Simulated IP packet header bytes
    const packet = fromByteValues(
      0x45, 0x00, 0x00, 0x3c,  // Version, IHL, DSCP, Total Length
      0x1c, 0x46, 0x40, 0x00,  // ID, Flags, Fragment Offset
    )
    const result = executeOd(packet, {
      types: [
        { type: 'x', size: 2 },
      ],
      addressRadix: 'd',
    })
    expect(result.output).toContain('0045')  // Version+IHL (little-endian)
    expect(result.bytesProcessed).toBe(8)
  })
})

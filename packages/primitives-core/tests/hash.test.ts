/**
 * Hash utilities tests
 * @module @dotdo/primitives-core/hash.test
 */
import { describe, test, expect } from 'vitest'
import {
  sha1,
  sha256,
  murmurHash3,
  murmurHash3_32,
  bytesToHex,
  hexToBytes,
} from '../src/hash.js'

describe('sha1', () => {
  test('hashes empty string', async () => {
    const hash = await sha1('')
    expect(hash).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })

  test('hashes "hello" string', async () => {
    const hash = await sha1('hello')
    expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
  })

  test('hashes Uint8Array input', async () => {
    const input = new TextEncoder().encode('hello')
    const hash = await sha1(input)
    expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
  })

  test('produces 40-character hex string', async () => {
    const hash = await sha1('test')
    expect(hash.length).toBe(40)
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
  })

  test('is deterministic', async () => {
    const hash1 = await sha1('same input')
    const hash2 = await sha1('same input')
    expect(hash1).toBe(hash2)
  })

  test('different inputs produce different hashes', async () => {
    const hash1 = await sha1('input1')
    const hash2 = await sha1('input2')
    expect(hash1).not.toBe(hash2)
  })
})

describe('sha256', () => {
  test('hashes empty string', async () => {
    const hash = await sha256('')
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  test('hashes "hello" string', async () => {
    const hash = await sha256('hello')
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  test('hashes Uint8Array input', async () => {
    const input = new TextEncoder().encode('hello')
    const hash = await sha256(input)
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  test('produces 64-character hex string', async () => {
    const hash = await sha256('test')
    expect(hash.length).toBe(64)
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
  })
})

describe('murmurHash3', () => {
  test('hashes string with seed', () => {
    const hash1 = murmurHash3('hello', 0)
    const hash2 = murmurHash3('hello', 1)
    expect(hash1).not.toBe(hash2)
  })

  test('is deterministic', () => {
    const hash1 = murmurHash3('test', 42)
    const hash2 = murmurHash3('test', 42)
    expect(hash1).toBe(hash2)
  })

  test('returns 32-bit unsigned integer', () => {
    const hash = murmurHash3('test', 0)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(hash)).toBe(true)
  })

  test('handles empty string', () => {
    const hash = murmurHash3('', 0)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(hash)).toBe(true)
  })

  test('different strings produce different hashes', () => {
    const hash1 = murmurHash3('foo', 0)
    const hash2 = murmurHash3('bar', 0)
    expect(hash1).not.toBe(hash2)
  })

  test('same string with different seeds produces different hashes', () => {
    const results = new Set<number>()
    for (let seed = 0; seed < 10; seed++) {
      results.add(murmurHash3('test', seed))
    }
    // Should have at least 8 unique hashes (allowing some collision)
    expect(results.size).toBeGreaterThanOrEqual(8)
  })
})

describe('murmurHash3_32', () => {
  test('hashes Uint8Array', () => {
    const input = new TextEncoder().encode('hello')
    const hash = murmurHash3_32(input, 0)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThanOrEqual(0xffffffff)
  })

  test('is deterministic', () => {
    const input = new TextEncoder().encode('test')
    const hash1 = murmurHash3_32(input, 42)
    const hash2 = murmurHash3_32(input, 42)
    expect(hash1).toBe(hash2)
  })

  test('handles empty array', () => {
    const hash = murmurHash3_32(new Uint8Array(0), 0)
    expect(Number.isInteger(hash)).toBe(true)
  })

  test('handles data longer than 4 bytes', () => {
    const input = new TextEncoder().encode('longer test string with more bytes')
    const hash = murmurHash3_32(input, 0)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThanOrEqual(0xffffffff)
  })

  test('handles data with various lengths (1-10 bytes)', () => {
    for (let len = 1; len <= 10; len++) {
      const input = new Uint8Array(len).fill(0x42)
      const hash = murmurHash3_32(input, 0)
      expect(Number.isInteger(hash)).toBe(true)
    }
  })
})

describe('bytesToHex', () => {
  test('converts empty array', () => {
    const result = bytesToHex(new Uint8Array(0))
    expect(result).toBe('')
  })

  test('converts single byte', () => {
    expect(bytesToHex(new Uint8Array([0x00]))).toBe('00')
    expect(bytesToHex(new Uint8Array([0x0f]))).toBe('0f')
    expect(bytesToHex(new Uint8Array([0xff]))).toBe('ff')
  })

  test('converts multiple bytes', () => {
    const input = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
    expect(bytesToHex(input)).toBe('48656c6c6f')
  })

  test('produces lowercase hex', () => {
    const input = new Uint8Array([0xAB, 0xCD, 0xEF])
    expect(bytesToHex(input)).toBe('abcdef')
  })

  test('pads single-digit hex values with zero', () => {
    const input = new Uint8Array([0x01, 0x02, 0x03])
    expect(bytesToHex(input)).toBe('010203')
  })
})

describe('hexToBytes', () => {
  test('converts empty string', () => {
    const result = hexToBytes('')
    expect(result).toEqual(new Uint8Array(0))
  })

  test('converts single byte', () => {
    expect(hexToBytes('00')).toEqual(new Uint8Array([0x00]))
    expect(hexToBytes('0f')).toEqual(new Uint8Array([0x0f]))
    expect(hexToBytes('ff')).toEqual(new Uint8Array([0xff]))
  })

  test('converts multiple bytes', () => {
    const result = hexToBytes('48656c6c6f')
    expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]))
  })

  test('handles uppercase hex', () => {
    const result = hexToBytes('ABCDEF')
    expect(result).toEqual(new Uint8Array([0xab, 0xcd, 0xef]))
  })

  test('handles mixed case hex', () => {
    const result = hexToBytes('AbCdEf')
    expect(result).toEqual(new Uint8Array([0xab, 0xcd, 0xef]))
  })
})

describe('bytesToHex and hexToBytes roundtrip', () => {
  test('roundtrips all byte values', () => {
    const input = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      input[i] = i
    }
    const hex = bytesToHex(input)
    const output = hexToBytes(hex)
    expect(output).toEqual(input)
  })

  test('roundtrips random data', () => {
    const input = new Uint8Array(100)
    for (let i = 0; i < 100; i++) {
      input[i] = Math.floor(Math.random() * 256)
    }
    const hex = bytesToHex(input)
    const output = hexToBytes(hex)
    expect(output).toEqual(input)
  })
})

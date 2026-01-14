import { describe, it, expect } from 'vitest'
import { sha1, sha256, hashObject, hexToBytes, bytesToHex } from '../../src/utils/hash'

describe('SHA hashing utilities', () => {
  describe('sha1', () => {
    it('should return correct hash for "hello" string', async () => {
      // Known SHA-1 hash of "hello"
      // echo -n "hello" | sha1sum
      const result = await sha1('hello')
      expect(result).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should return correct hash for Uint8Array input', async () => {
      // Same as sha1('hello') but using Uint8Array
      const encoder = new TextEncoder()
      const data = encoder.encode('hello')
      const result = await sha1(data)
      expect(result).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')
    })

    it('should return 40-character lowercase hex string', async () => {
      const result = await sha1('test')
      expect(result).toHaveLength(40)
      expect(result).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should return correct hash for empty string', async () => {
      // echo -n "" | sha1sum
      const result = await sha1('')
      expect(result).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    })

    it('should return correct hash for binary data', async () => {
      // Binary data with null bytes
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe])
      const result = await sha1(data)
      // This hash was computed using: printf '\x00\x01\x02\xff\xfe' | sha1sum
      expect(result).toBe('1b26a7676d5de2059b41f7a09451533f158744da')
    })
  })

  describe('sha256', () => {
    it('should return correct hash for "hello" string', async () => {
      // echo -n "hello" | sha256sum
      const result = await sha256('hello')
      expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('should return 64-character lowercase hex string', async () => {
      const result = await sha256('test')
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should return correct hash for empty string', async () => {
      // echo -n "" | sha256sum
      const result = await sha256('')
      expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    })
  })

  describe('hashObject', () => {
    it('should match git hash-object output for blob', async () => {
      // echo -n "hello" | git hash-object --stdin
      // This creates header "blob 5\0hello" and hashes it
      const encoder = new TextEncoder()
      const data = encoder.encode('hello')
      const result = await hashObject('blob', data)
      expect(result).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0')
    })

    it('should return correct hash for empty blob', async () => {
      // git hash-object -t blob /dev/null
      // Header: "blob 0\0"
      const result = await hashObject('blob', new Uint8Array(0))
      expect(result).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    })

    it('should return correct hash for tree type', async () => {
      // For tree objects, the data format is different but hashing works the same
      // We'll use an empty tree: git hash-object -t tree /dev/null
      const result = await hashObject('tree', new Uint8Array(0))
      expect(result).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
    })

    it('should handle larger content correctly', async () => {
      // echo -n "hello world" | git hash-object --stdin
      const encoder = new TextEncoder()
      const data = encoder.encode('hello world')
      const result = await hashObject('blob', data)
      expect(result).toBe('95d09f2b10159347eece71399a7e2e907ea3df4f')
    })
  })

  describe('hexToBytes', () => {
    it('should convert hex string to Uint8Array', () => {
      const result = hexToBytes('48656c6c6f')
      expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])) // "Hello"
    })

    it('should handle lowercase hex', () => {
      const result = hexToBytes('deadbeef')
      expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })

    it('should handle uppercase hex', () => {
      const result = hexToBytes('DEADBEEF')
      expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
    })

    it('should return empty array for empty string', () => {
      const result = hexToBytes('')
      expect(result).toEqual(new Uint8Array(0))
    })
  })

  describe('bytesToHex', () => {
    it('should convert Uint8Array to hex string', () => {
      const result = bytesToHex(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]))
      expect(result).toBe('48656c6c6f')
    })

    it('should return lowercase hex', () => {
      const result = bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
      expect(result).toBe('deadbeef')
    })

    it('should return empty string for empty array', () => {
      const result = bytesToHex(new Uint8Array(0))
      expect(result).toBe('')
    })

    it('should pad single-digit hex values with zero', () => {
      const result = bytesToHex(new Uint8Array([0x00, 0x0f, 0x01]))
      expect(result).toBe('000f01')
    })
  })

  describe('hexToBytes/bytesToHex round-trip', () => {
    it('should round-trip correctly for SHA-1 hash', () => {
      const originalHex = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      const bytes = hexToBytes(originalHex)
      const resultHex = bytesToHex(bytes)
      expect(resultHex).toBe(originalHex)
    })

    it('should round-trip correctly for SHA-256 hash', () => {
      const originalHex = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      const bytes = hexToBytes(originalHex)
      const resultHex = bytesToHex(bytes)
      expect(resultHex).toBe(originalHex)
    })

    it('should round-trip correctly for arbitrary bytes', () => {
      const originalBytes = new Uint8Array([0, 127, 255, 16, 32, 64, 128])
      const hex = bytesToHex(originalBytes)
      const resultBytes = hexToBytes(hex)
      expect(resultBytes).toEqual(originalBytes)
    })
  })

  describe('known test vectors', () => {
    it('should match git hash for "test content\\n"', async () => {
      // echo "test content" | git hash-object --stdin
      // Note: echo adds a newline
      const encoder = new TextEncoder()
      const data = encoder.encode('test content\n')
      const result = await hashObject('blob', data)
      expect(result).toBe('d670460b4b4aece5915caf5c68d12f560a9fe3e4')
    })

    it('should match git hash for multiline content', async () => {
      // printf 'line1\nline2\nline3\n' | git hash-object --stdin
      const encoder = new TextEncoder()
      const data = encoder.encode('line1\nline2\nline3\n')
      const result = await hashObject('blob', data)
      expect(result).toBe('83db48f84ec878fbfb30b46d16630e944e34f205')
    })
  })
})

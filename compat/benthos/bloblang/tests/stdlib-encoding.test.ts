/**
 * Bloblang Stdlib Encoding Functions Tests
 * Issue: dotdo-b01ha - Bloblang stdlib: Encoding Functions
 *
 * Tests for encoding/decoding functions:
 * - base64 encoding/decoding
 * - base64url encoding/decoding (URL-safe Base64)
 * - hex encoding/decoding
 * - ascii85 encoding/decoding
 * - z85 encoding/decoding (ZeroMQ Base85)
 */
import { describe, it, expect } from 'vitest'
import { encodingFunctions } from '../stdlib/encoding'

describe('Bloblang Encoding Stdlib Functions', () => {
  describe('encode("base64")', () => {
    it('encodes string to base64', () => {
      const result = encodingFunctions.encode.call('hello', 'base64')
      expect(result).toBe('aGVsbG8=')
    })

    it('encodes UTF-8 characters to base64', () => {
      const result = encodingFunctions.encode.call('cafe', 'base64')
      expect(result).toBe('Y2FmZQ==')
    })

    it('encodes empty string to base64', () => {
      const result = encodingFunctions.encode.call('', 'base64')
      expect(result).toBe('')
    })

    it('encodes numbers in string', () => {
      const result = encodingFunctions.encode.call('12345', 'base64')
      expect(result).toBe('MTIzNDU=')
    })

    it('encodes binary-like data', () => {
      const result = encodingFunctions.encode.call('hello world', 'base64')
      expect(result).toBe('aGVsbG8gd29ybGQ=')
    })

    it('throws on non-string input', () => {
      expect(() => encodingFunctions.encode.call(null, 'base64')).toThrow()
      expect(() => encodingFunctions.encode.call(123, 'base64')).toThrow()
    })

    it('throws if encoding argument missing', () => {
      expect(() => encodingFunctions.encode.call('hello')).toThrow()
    })
  })

  describe('decode("base64")', () => {
    it('decodes base64 to string', () => {
      const result = encodingFunctions.decode.call('aGVsbG8=', 'base64')
      expect(result).toBe('hello')
    })

    it('decodes base64 roundtrip', () => {
      const original = 'hello world'
      const encoded = encodingFunctions.encode.call(original, 'base64')
      const decoded = encodingFunctions.decode.call(encoded, 'base64')
      expect(decoded).toBe(original)
    })

    it('decodes empty base64', () => {
      const result = encodingFunctions.decode.call('', 'base64')
      expect(result).toBe('')
    })

    it('decodes base64 without padding', () => {
      // 'aGVsbG8' is 'hello' without the trailing '='
      const result = encodingFunctions.decode.call('aGVsbG8', 'base64')
      expect(result).toBe('hello')
    })

    it('throws on non-string input', () => {
      expect(() => encodingFunctions.decode.call(null, 'base64')).toThrow()
      expect(() => encodingFunctions.decode.call(123, 'base64')).toThrow()
    })

    it('throws on invalid base64', () => {
      expect(() => encodingFunctions.decode.call('!!!invalid!!!', 'base64')).toThrow()
    })
  })

  describe('encode("base64url")', () => {
    it('encodes string to URL-safe base64', () => {
      const result = encodingFunctions.encode.call('hello', 'base64url')
      expect(result).toBe('aGVsbG8')  // No padding, no special chars
    })

    it('replaces + with - and / with _', () => {
      // Input that would produce + or / in standard base64
      // The bytes 0xfb, 0xef, 0xbe produce '++/+' in base64
      const input = '\xfb\xef\xbe'
      const result = encodingFunctions.encode.call(input, 'base64url')
      expect(result).not.toContain('+')
      expect(result).not.toContain('/')
      expect(result).not.toContain('=')
    })

    it('encodes empty string', () => {
      const result = encodingFunctions.encode.call('', 'base64url')
      expect(result).toBe('')
    })

    it('is URL-safe (no padding)', () => {
      const result = encodingFunctions.encode.call('test', 'base64url')
      expect(result).not.toContain('=')
    })
  })

  describe('decode("base64url")', () => {
    it('decodes URL-safe base64 to string', () => {
      const result = encodingFunctions.decode.call('aGVsbG8', 'base64url')
      expect(result).toBe('hello')
    })

    it('decodes base64url roundtrip', () => {
      const original = 'hello world! test?query=1&foo=bar'
      const encoded = encodingFunctions.encode.call(original, 'base64url')
      const decoded = encodingFunctions.decode.call(encoded, 'base64url')
      expect(decoded).toBe(original)
    })

    it('decodes empty base64url', () => {
      const result = encodingFunctions.decode.call('', 'base64url')
      expect(result).toBe('')
    })

    it('handles - and _ characters', () => {
      // Create input with - and _ which are base64url specific
      const encoded = 'SGVsbG8td29ybGRf'  // Contains - and _
      // Should decode without error
      const result = encodingFunctions.decode.call(encoded, 'base64url')
      expect(typeof result).toBe('string')
    })

    it('throws on invalid base64url', () => {
      expect(() => encodingFunctions.decode.call('!!!invalid!!!', 'base64url')).toThrow()
    })
  })

  describe('encode("hex")', () => {
    it('encodes string to hexadecimal', () => {
      const result = encodingFunctions.encode.call('hello', 'hex')
      expect(result).toBe('68656c6c6f')
    })

    it('encodes empty string', () => {
      const result = encodingFunctions.encode.call('', 'hex')
      expect(result).toBe('')
    })

    it('encodes binary data to hex', () => {
      const result = encodingFunctions.encode.call('\x00\x01\x02\xff', 'hex')
      expect(result).toBe('000102ff')
    })

    it('encodes ASCII characters', () => {
      const result = encodingFunctions.encode.call('ABC', 'hex')
      expect(result).toBe('414243')
    })

    it('encodes numbers in string', () => {
      const result = encodingFunctions.encode.call('123', 'hex')
      expect(result).toBe('313233')
    })

    it('produces lowercase hex output', () => {
      const result = encodingFunctions.encode.call('\xab\xcd\xef', 'hex')
      expect(result).toBe('abcdef')
    })

    it('throws on non-string input', () => {
      expect(() => encodingFunctions.encode.call(null, 'hex')).toThrow()
      expect(() => encodingFunctions.encode.call(123, 'hex')).toThrow()
    })
  })

  describe('decode("hex")', () => {
    it('decodes hexadecimal to string', () => {
      const result = encodingFunctions.decode.call('68656c6c6f', 'hex')
      expect(result).toBe('hello')
    })

    it('decodes hex roundtrip', () => {
      const original = 'hello world'
      const encoded = encodingFunctions.encode.call(original, 'hex')
      const decoded = encodingFunctions.decode.call(encoded, 'hex')
      expect(decoded).toBe(original)
    })

    it('decodes empty hex', () => {
      const result = encodingFunctions.decode.call('', 'hex')
      expect(result).toBe('')
    })

    it('decodes uppercase hex', () => {
      const result = encodingFunctions.decode.call('68656C6C6F', 'hex')
      expect(result).toBe('hello')
    })

    it('decodes mixed case hex', () => {
      const result = encodingFunctions.decode.call('68656C6c6F', 'hex')
      expect(result).toBe('hello')
    })

    it('decodes binary data from hex', () => {
      const result = encodingFunctions.decode.call('000102ff', 'hex')
      expect(result).toBe('\x00\x01\x02\xff')
    })

    it('throws on invalid hex (odd length)', () => {
      expect(() => encodingFunctions.decode.call('abc', 'hex')).toThrow()
    })

    it('throws on invalid hex characters', () => {
      expect(() => encodingFunctions.decode.call('xyz123', 'hex')).toThrow()
    })

    it('throws on non-string input', () => {
      expect(() => encodingFunctions.decode.call(null, 'hex')).toThrow()
      expect(() => encodingFunctions.decode.call(123, 'hex')).toThrow()
    })
  })

  describe('encode("ascii85")', () => {
    it('encodes string to ASCII85', () => {
      const result = encodingFunctions.encode.call('hello', 'ascii85')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('encodes empty string', () => {
      const result = encodingFunctions.encode.call('', 'ascii85')
      expect(result).toBe('')
    })

    it('encodes test vector "Man "', () => {
      // Standard ASCII85 test vector: "Man " -> "9jqo^"
      const result = encodingFunctions.encode.call('Man ', 'ascii85')
      expect(result).toBe('9jqo^')
    })

    it('encodes zeros specially', () => {
      // Four zero bytes encode to 'z' in ASCII85
      const result = encodingFunctions.encode.call('\x00\x00\x00\x00', 'ascii85')
      expect(result).toBe('z')
    })

    it('handles non-aligned input', () => {
      // Input not divisible by 4 bytes should still encode
      const result = encodingFunctions.encode.call('hi', 'ascii85')
      expect(typeof result).toBe('string')
    })

    it('roundtrips correctly', () => {
      const original = 'hello world'
      const encoded = encodingFunctions.encode.call(original, 'ascii85')
      const decoded = encodingFunctions.decode.call(encoded, 'ascii85')
      expect(decoded).toBe(original)
    })

    it('throws on non-string input', () => {
      expect(() => encodingFunctions.encode.call(null, 'ascii85')).toThrow()
      expect(() => encodingFunctions.encode.call(123, 'ascii85')).toThrow()
    })
  })

  describe('decode("ascii85")', () => {
    it('decodes ASCII85 to string', () => {
      const encoded = encodingFunctions.encode.call('hello', 'ascii85')
      const result = encodingFunctions.decode.call(encoded, 'ascii85')
      expect(result).toBe('hello')
    })

    it('decodes empty ASCII85', () => {
      const result = encodingFunctions.decode.call('', 'ascii85')
      expect(result).toBe('')
    })

    it('decodes test vector "9jqo^"', () => {
      const result = encodingFunctions.decode.call('9jqo^', 'ascii85')
      expect(result).toBe('Man ')
    })

    it('decodes z shortcut for zeros', () => {
      const result = encodingFunctions.decode.call('z', 'ascii85')
      expect(result).toBe('\x00\x00\x00\x00')
    })

    it('throws on invalid ASCII85 characters', () => {
      // Characters outside the valid range (!-u plus z)
      expect(() => encodingFunctions.decode.call('\x00\x01', 'ascii85')).toThrow()
    })

    it('throws on non-string input', () => {
      expect(() => encodingFunctions.decode.call(null, 'ascii85')).toThrow()
      expect(() => encodingFunctions.decode.call(123, 'ascii85')).toThrow()
    })
  })

  describe('encode("z85")', () => {
    it('encodes string to Z85', () => {
      const result = encodingFunctions.encode.call('test', 'z85')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('encodes empty string', () => {
      const result = encodingFunctions.encode.call('', 'z85')
      expect(result).toBe('')
    })

    it('encodes Z85 test vector', () => {
      // ZeroMQ Z85 uses a specific character set
      // Test vector from spec: 0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B -> "HelloWorld"
      const input = Buffer.from([0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B]).toString('binary')
      const result = encodingFunctions.encode.call(input, 'z85')
      expect(result).toBe('HelloWorld')
    })

    it('uses Z85 character set (printable ASCII)', () => {
      // Z85 requires input divisible by 4, so use 16 bytes
      // Z85 uses 85 printable characters: 0-9, a-z, A-Z, .-:+=^!/*?&<>()[]{}@%$#
      const result = encodingFunctions.encode.call('test data here!!', 'z85')
      // All characters should be printable ASCII
      for (const char of result) {
        const code = char.charCodeAt(0)
        expect(code).toBeGreaterThanOrEqual(33)  // printable starts at !
        expect(code).toBeLessThanOrEqual(126)    // printable ends at ~
      }
    })

    it('roundtrips correctly', () => {
      const original = 'HelloWorld!!'  // 12 bytes, divisible by 4
      const encoded = encodingFunctions.encode.call(original, 'z85')
      const decoded = encodingFunctions.decode.call(encoded, 'z85')
      expect(decoded).toBe(original)
    })

    it('throws on input not divisible by 4', () => {
      // Z85 requires input length to be divisible by 4
      expect(() => encodingFunctions.encode.call('hi', 'z85')).toThrow(/divisible by 4|length/i)
    })

    it('throws on non-string input', () => {
      expect(() => encodingFunctions.encode.call(null, 'z85')).toThrow()
      expect(() => encodingFunctions.encode.call(123, 'z85')).toThrow()
    })
  })

  describe('decode("z85")', () => {
    it('decodes Z85 to string', () => {
      const original = 'test'  // 4 bytes
      const encoded = encodingFunctions.encode.call(original, 'z85')
      const result = encodingFunctions.decode.call(encoded, 'z85')
      expect(result).toBe(original)
    })

    it('decodes empty Z85', () => {
      const result = encodingFunctions.decode.call('', 'z85')
      expect(result).toBe('')
    })

    it('decodes Z85 test vector "HelloWorld"', () => {
      const result = encodingFunctions.decode.call('HelloWorld', 'z85')
      const expected = Buffer.from([0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B]).toString('binary')
      expect(result).toBe(expected)
    })

    it('throws on invalid Z85 length (not divisible by 5)', () => {
      // Z85 encoded length must be divisible by 5
      expect(() => encodingFunctions.decode.call('Hi', 'z85')).toThrow(/divisible by 5|length/i)
    })

    it('throws on invalid Z85 characters', () => {
      // Z85 uses specific character set, spaces are invalid
      expect(() => encodingFunctions.decode.call('Hello World', 'z85')).toThrow()
    })

    it('throws on non-string input', () => {
      expect(() => encodingFunctions.decode.call(null, 'z85')).toThrow()
      expect(() => encodingFunctions.decode.call(123, 'z85')).toThrow()
    })
  })

  describe('Unsupported encodings', () => {
    it('throws on unsupported encoding for encode', () => {
      expect(() => encodingFunctions.encode.call('hello', 'unknown')).toThrow(/unsupported|encoding/i)
    })

    it('throws on unsupported encoding for decode', () => {
      expect(() => encodingFunctions.decode.call('hello', 'unknown')).toThrow(/unsupported|encoding/i)
    })
  })

  describe('Case insensitivity', () => {
    it('encode accepts uppercase encoding name', () => {
      const result = encodingFunctions.encode.call('hello', 'BASE64')
      expect(result).toBe('aGVsbG8=')
    })

    it('decode accepts uppercase encoding name', () => {
      const result = encodingFunctions.decode.call('aGVsbG8=', 'BASE64')
      expect(result).toBe('hello')
    })

    it('encode accepts mixed case encoding name', () => {
      const result = encodingFunctions.encode.call('hello', 'Base64')
      expect(result).toBe('aGVsbG8=')
    })

    it('decode accepts mixed case encoding name', () => {
      const result = encodingFunctions.decode.call('aGVsbG8=', 'Base64')
      expect(result).toBe('hello')
    })
  })

  describe('Integration tests', () => {
    it('chains base64 and hex encoding', () => {
      const original = 'secret'
      const base64 = encodingFunctions.encode.call(original, 'base64')
      const hex = encodingFunctions.encode.call(base64, 'hex')

      // Reverse the process
      const decodedHex = encodingFunctions.decode.call(hex, 'hex')
      const decodedBase64 = encodingFunctions.decode.call(decodedHex, 'base64')

      expect(decodedBase64).toBe(original)
    })

    it('encodes binary data through multiple formats', () => {
      const binary = '\x00\x01\x02\x03'

      const hex = encodingFunctions.encode.call(binary, 'hex')
      expect(hex).toBe('00010203')

      const base64 = encodingFunctions.encode.call(binary, 'base64')
      expect(encodingFunctions.decode.call(base64, 'base64')).toBe(binary)
    })

    it('handles URL-safe encoding for web tokens', () => {
      const payload = '{"sub":"1234567890","name":"John Doe"}'
      const encoded = encodingFunctions.encode.call(payload, 'base64url')

      // Should be safe for URLs
      expect(encoded).not.toContain('+')
      expect(encoded).not.toContain('/')
      expect(encoded).not.toContain('=')

      // Should decode back
      const decoded = encodingFunctions.decode.call(encoded, 'base64url')
      expect(decoded).toBe(payload)
    })
  })
})

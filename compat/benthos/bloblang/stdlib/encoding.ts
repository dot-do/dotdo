/**
 * Bloblang Stdlib Encoding Functions Implementation
 * Issue: dotdo-b01ha - Bloblang stdlib: Encoding Functions
 *
 * Encoding/decoding functions:
 * - base64: Standard Base64 encoding (RFC 4648)
 * - base64url: URL-safe Base64 encoding (RFC 4648 Section 5)
 * - hex: Hexadecimal encoding
 * - ascii85: Adobe ASCII85 encoding (Btoa format)
 * - z85: ZeroMQ Z85 encoding (RFC variant of ASCII85)
 */

/**
 * Helper function to validate string input
 */
function validateString(value: unknown, functionName: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${functionName} expects a string input, got ${typeof value}`)
  }
  return value
}

/**
 * Helper function to validate argument exists
 */
function validateArgument(value: unknown, argName: string, functionName: string): unknown {
  if (value === undefined) {
    throw new Error(`${functionName} requires ${argName} argument`)
  }
  return value
}

// Z85 character set (85 printable ASCII characters, avoiding + / = and special chars)
const Z85_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#'

// Z85 decode map
const Z85_DECODE: Record<string, number> = {}
for (let i = 0; i < Z85_CHARS.length; i++) {
  Z85_DECODE[Z85_CHARS[i]] = i
}

// ASCII85 decode map (characters ! to u, plus z for zeros)
const ASCII85_BASE = 33  // '!' character

/**
 * Encode bytes to ASCII85 format
 */
function encodeAscii85(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''

  const result: string[] = []
  let i = 0

  // Process 4-byte chunks
  while (i < bytes.length) {
    const remaining = bytes.length - i
    let value = 0
    const chunkSize = Math.min(4, remaining)

    // Build 32-bit value from up to 4 bytes
    for (let j = 0; j < chunkSize; j++) {
      value = (value << 8) | bytes[i + j]
    }

    // Pad with zeros if not a full chunk
    if (chunkSize < 4) {
      value <<= (4 - chunkSize) * 8
    }

    // Special case: four zero bytes encode to 'z'
    if (value === 0 && chunkSize === 4) {
      result.push('z')
    } else {
      // Convert to 5 ASCII85 characters
      const chars: string[] = []
      for (let j = 4; j >= 0; j--) {
        chars[j] = String.fromCharCode((value % 85) + ASCII85_BASE)
        value = Math.floor(value / 85)
      }

      // Only output the required number of characters for partial chunks
      const outputChars = chunkSize === 4 ? 5 : chunkSize + 1
      result.push(chars.slice(0, outputChars).join(''))
    }

    i += chunkSize
  }

  return result.join('')
}

/**
 * Decode ASCII85 string to bytes
 */
function decodeAscii85(str: string): Uint8Array {
  if (str === '') return new Uint8Array(0)

  const result: number[] = []
  let i = 0

  while (i < str.length) {
    // Handle 'z' shortcut (four zero bytes)
    if (str[i] === 'z') {
      result.push(0, 0, 0, 0)
      i++
      continue
    }

    // Read up to 5 characters
    const remaining = str.length - i
    const chunkSize = Math.min(5, remaining)
    let value = 0

    for (let j = 0; j < chunkSize; j++) {
      const c = str.charCodeAt(i + j)
      if (c < ASCII85_BASE || c > ASCII85_BASE + 84) {
        throw new Error(`Invalid ASCII85 character: ${str[i + j]}`)
      }
      value = value * 85 + (c - ASCII85_BASE)
    }

    // Pad with 'u' characters (84) for partial chunks
    for (let j = chunkSize; j < 5; j++) {
      value = value * 85 + 84
    }

    // Extract bytes (4 bytes from 5 chars, or fewer for partial)
    const bytesToOutput = chunkSize === 5 ? 4 : chunkSize - 1
    for (let j = 3; j >= 4 - bytesToOutput; j--) {
      result.push((value >> (j * 8)) & 0xff)
    }

    i += chunkSize
  }

  return new Uint8Array(result)
}

/**
 * Encode bytes to Z85 format
 * Input length must be divisible by 4
 */
function encodeZ85(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''

  if (bytes.length % 4 !== 0) {
    throw new Error(`Z85 encoding requires input length divisible by 4, got ${bytes.length}`)
  }

  const result: string[] = []

  for (let i = 0; i < bytes.length; i += 4) {
    // Read 4 bytes as big-endian 32-bit integer
    let value = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]
    // Handle as unsigned
    value = value >>> 0

    // Convert to 5 Z85 characters
    const chars: string[] = []
    for (let j = 4; j >= 0; j--) {
      chars[j] = Z85_CHARS[value % 85]
      value = Math.floor(value / 85)
    }
    result.push(chars.join(''))
  }

  return result.join('')
}

/**
 * Decode Z85 string to bytes
 * Input length must be divisible by 5
 */
function decodeZ85(str: string): Uint8Array {
  if (str === '') return new Uint8Array(0)

  if (str.length % 5 !== 0) {
    throw new Error(`Z85 decoding requires input length divisible by 5, got ${str.length}`)
  }

  const result: number[] = []

  for (let i = 0; i < str.length; i += 5) {
    let value = 0

    for (let j = 0; j < 5; j++) {
      const c = str[i + j]
      const idx = Z85_DECODE[c]
      if (idx === undefined) {
        throw new Error(`Invalid Z85 character: ${c}`)
      }
      value = value * 85 + idx
    }

    // Extract 4 bytes
    result.push((value >> 24) & 0xff)
    result.push((value >> 16) & 0xff)
    result.push((value >> 8) & 0xff)
    result.push(value & 0xff)
  }

  return new Uint8Array(result)
}

/**
 * Convert string to bytes using Latin-1 encoding (preserves byte values)
 */
function stringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff
  }
  return bytes
}

/**
 * Convert bytes to string using Latin-1 encoding (preserves byte values)
 */
function bytesToString(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i])
  }
  return result
}

/**
 * Encoding functions object
 */
export const encodingFunctions = {
  /**
   * Encodes string using specified encoding
   */
  encode: {
    call(value: unknown, encoding?: unknown): string {
      const str = validateString(value, 'encode')
      validateArgument(encoding, 'encoding', 'encode')
      const encodingStr = String(encoding).toLowerCase()

      if (str === '') return ''

      switch (encodingStr) {
        case 'base64': {
          // Use Buffer for Node.js environment
          return Buffer.from(str, 'utf-8').toString('base64')
        }

        case 'base64url': {
          // URL-safe Base64: replace +/= with -_ and remove padding
          const base64 = Buffer.from(str, 'utf-8').toString('base64')
          return base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')
        }

        case 'hex': {
          const bytes = stringToBytes(str)
          let result = ''
          for (let i = 0; i < bytes.length; i++) {
            result += bytes[i].toString(16).padStart(2, '0')
          }
          return result
        }

        case 'ascii85': {
          const bytes = stringToBytes(str)
          return encodeAscii85(bytes)
        }

        case 'z85': {
          const bytes = stringToBytes(str)
          return encodeZ85(bytes)
        }

        default:
          throw new Error(`Unsupported encoding: ${encodingStr}`)
      }
    }
  },

  /**
   * Decodes string using specified encoding
   */
  decode: {
    call(value: unknown, encoding?: unknown): string {
      const str = validateString(value, 'decode')
      validateArgument(encoding, 'encoding', 'decode')
      const encodingStr = String(encoding).toLowerCase()

      if (str === '') return ''

      switch (encodingStr) {
        case 'base64': {
          // Validate base64 format
          const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/
          // Also accept without padding
          const noPadding = str.replace(/=+$/, '')
          if (!base64Regex.test(str) && !/^[A-Za-z0-9+/]*$/.test(noPadding)) {
            throw new Error('Invalid base64 string')
          }
          return Buffer.from(str, 'base64').toString('utf-8')
        }

        case 'base64url': {
          // Convert URL-safe base64 back to standard
          let base64 = str
            .replace(/-/g, '+')
            .replace(/_/g, '/')

          // Add padding if needed
          const paddingNeeded = (4 - (base64.length % 4)) % 4
          base64 += '='.repeat(paddingNeeded)

          // Validate
          if (!/^[A-Za-z0-9+/]*={0,3}$/.test(base64)) {
            throw new Error('Invalid base64url string')
          }

          return Buffer.from(base64, 'base64').toString('utf-8')
        }

        case 'hex': {
          // Validate hex format
          if (str.length % 2 !== 0) {
            throw new Error('Invalid hex string: odd length')
          }
          if (!/^[0-9a-fA-F]*$/.test(str)) {
            throw new Error('Invalid hex string: contains non-hex characters')
          }

          const bytes = new Uint8Array(str.length / 2)
          for (let i = 0; i < str.length; i += 2) {
            bytes[i / 2] = parseInt(str.slice(i, i + 2), 16)
          }
          return bytesToString(bytes)
        }

        case 'ascii85': {
          const bytes = decodeAscii85(str)
          return bytesToString(bytes)
        }

        case 'z85': {
          const bytes = decodeZ85(str)
          return bytesToString(bytes)
        }

        default:
          throw new Error(`Unsupported encoding: ${encodingStr}`)
      }
    }
  }
}

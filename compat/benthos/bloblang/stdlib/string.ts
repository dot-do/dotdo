/**
 * Bloblang String Stdlib Functions
 * Implementation of string manipulation functions for Bloblang compatibility
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
 * Helper function to validate array input
 */
function validateArray(value: unknown, functionName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${functionName} expects an array input, got ${typeof value}`)
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

/**
 * String stdlib functions object
 */
export const stringFunctions = {
  /**
   * Converts string to uppercase
   */
  uppercase: {
    call(value: unknown): string {
      const str = validateString(value, 'uppercase')
      return str.toUpperCase()
    }
  },

  /**
   * Converts string to lowercase
   */
  lowercase: {
    call(value: unknown): string {
      const str = validateString(value, 'lowercase')
      return str.toLowerCase()
    }
  },

  /**
   * Returns length of string (UTF-16 code units)
   */
  length: {
    call(value: unknown): number {
      const str = validateString(value, 'length')
      return str.length
    }
  },

  /**
   * Trims whitespace from both ends
   */
  trim: {
    call(value: unknown): string {
      const str = validateString(value, 'trim')
      return str.trim()
    }
  },

  /**
   * Removes prefix from string if present
   */
  trim_prefix: {
    call(value: unknown, prefix?: unknown): string {
      const str = validateString(value, 'trim_prefix')
      validateArgument(prefix, 'prefix', 'trim_prefix')
      const prefixStr = String(prefix)

      if (str.startsWith(prefixStr)) {
        return str.slice(prefixStr.length)
      }
      return str
    }
  },

  /**
   * Removes suffix from string if present
   */
  trim_suffix: {
    call(value: unknown, suffix?: unknown): string {
      const str = validateString(value, 'trim_suffix')
      validateArgument(suffix, 'suffix', 'trim_suffix')
      const suffixStr = String(suffix)

      if (str.endsWith(suffixStr)) {
        return str.slice(0, -suffixStr.length || undefined)
      }
      return str
    }
  },

  /**
   * Checks if string contains substring
   */
  contains: {
    call(value: unknown, substr?: unknown): boolean {
      const str = validateString(value, 'contains')
      validateArgument(substr, 'substr', 'contains')
      const substrStr = String(substr)

      return str.includes(substrStr)
    }
  },

  /**
   * Checks if string starts with prefix
   */
  has_prefix: {
    call(value: unknown, prefix?: unknown): boolean {
      const str = validateString(value, 'has_prefix')
      validateArgument(prefix, 'prefix', 'has_prefix')
      const prefixStr = String(prefix)

      return str.startsWith(prefixStr)
    }
  },

  /**
   * Checks if string ends with suffix
   */
  has_suffix: {
    call(value: unknown, suffix?: unknown): boolean {
      const str = validateString(value, 'has_suffix')
      validateArgument(suffix, 'suffix', 'has_suffix')
      const suffixStr = String(suffix)

      return str.endsWith(suffixStr)
    }
  },

  /**
   * Replaces first occurrence of old with new
   */
  replace: {
    call(value: unknown, old?: unknown, replacement?: unknown): string {
      const str = validateString(value, 'replace')
      validateArgument(old, 'old', 'replace')
      validateArgument(replacement, 'new', 'replace')
      const oldStr = String(old)
      const newStr = String(replacement)

      return str.replace(oldStr, newStr)
    }
  },

  /**
   * Replaces all occurrences of old with new
   */
  replace_all: {
    call(value: unknown, old?: unknown, replacement?: unknown): string {
      const str = validateString(value, 'replace_all')
      validateArgument(old, 'old', 'replace_all')
      validateArgument(replacement, 'new', 'replace_all')
      const oldStr = String(old)
      const newStr = String(replacement)

      return str.replaceAll(oldStr, newStr)
    }
  },

  /**
   * Splits string by delimiter
   */
  split: {
    call(value: unknown, delimiter?: unknown): string[] {
      const str = validateString(value, 'split')
      validateArgument(delimiter, 'delimiter', 'split')
      const delimiterStr = String(delimiter)

      return str.split(delimiterStr)
    }
  },

  /**
   * Joins array elements with delimiter
   */
  join: {
    call(value: unknown, delimiter?: unknown): string {
      const arr = validateArray(value, 'join')
      validateArgument(delimiter, 'delimiter', 'join')
      const delimiterStr = String(delimiter)

      return arr.join(delimiterStr)
    }
  },

  /**
   * Extracts substring from start to end
   */
  slice: {
    call(value: unknown, start?: unknown, end?: unknown): string {
      const str = validateString(value, 'slice')
      validateArgument(start, 'start', 'slice')
      const startNum = Number(start)

      if (end === undefined) {
        return str.slice(startNum)
      }
      const endNum = Number(end)
      return str.slice(startNum, endNum)
    }
  },

  /**
   * Formats string with placeholders
   */
  format: {
    call(value: unknown, ...args: unknown[]): string {
      const template = validateString(value, 'format')
      let result = template
      let argIndex = 0

      // Replace %% with a placeholder first
      result = result.replace(/%%/g, '\x00PERCENT\x00')

      // Replace format specifiers
      result = result.replace(/%([sdfxb])/g, (match, specifier) => {
        if (argIndex >= args.length) {
          return match // Leave placeholder if no argument
        }

        const arg = args[argIndex++]

        switch (specifier) {
          case 's': // string
            return String(arg)
          case 'd': // decimal integer
            return String(Math.floor(Number(arg)))
          case 'f': // float
            return String(Number(arg))
          case 'x': // hexadecimal
            return Number(arg).toString(16)
          case 'b': // boolean
            return String(arg)
          default:
            return match
        }
      })

      // Handle %.Nf format for floating point precision
      argIndex = 0
      result = result.replace(/%.(\d+)f/g, (match, precision) => {
        if (argIndex >= args.length) {
          return match
        }
        const arg = args[argIndex++]
        return Number(arg).toFixed(Number(precision))
      })

      // Restore escaped percent signs
      result = result.replace(/\x00PERCENT\x00/g, '%')

      return result
    }
  },

  /**
   * Tests if string matches regex pattern
   */
  re_match: {
    call(value: unknown, pattern?: unknown): boolean {
      const str = validateString(value, 're_match')
      validateArgument(pattern, 'pattern', 're_match')
      const patternStr = String(pattern)

      try {
        const regex = new RegExp(patternStr)
        return regex.test(str)
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${patternStr}`)
      }
    }
  },

  /**
   * Finds all matches of regex pattern
   */
  re_find_all: {
    call(value: unknown, pattern?: unknown): string[] {
      const str = validateString(value, 're_find_all')
      validateArgument(pattern, 'pattern', 're_find_all')
      const patternStr = String(pattern)

      try {
        const regex = new RegExp(patternStr, 'g')
        const matches = str.match(regex)
        return matches || []
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${patternStr}`)
      }
    }
  },

  /**
   * Replaces first regex match with replacement
   */
  re_replace: {
    call(value: unknown, pattern?: unknown, replacement?: unknown): string {
      const str = validateString(value, 're_replace')
      validateArgument(pattern, 'pattern', 're_replace')
      validateArgument(replacement, 'replacement', 're_replace')
      const patternStr = String(pattern)
      const replacementStr = String(replacement)

      try {
        const regex = new RegExp(patternStr)
        return str.replace(regex, replacementStr)
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${patternStr}`)
      }
    }
  },

  /**
   * Encodes string using specified encoding
   */
  encode: {
    call(value: unknown, encoding?: unknown): string {
      const str = validateString(value, 'encode')
      validateArgument(encoding, 'encoding', 'encode')
      const encodingStr = String(encoding).toLowerCase()

      if (encodingStr === 'base64') {
        if (str === '') return ''
        // Use browser-compatible base64 encoding
        try {
          return btoa(unescape(encodeURIComponent(str)))
        } catch (error) {
          // Fallback for Node.js environment
          return Buffer.from(str, 'utf-8').toString('base64')
        }
      }

      throw new Error(`Unsupported encoding: ${encodingStr}`)
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

      if (encodingStr === 'base64') {
        if (str === '') return ''

        // Validate base64 format before attempting to decode
        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/
        if (!base64Regex.test(str)) {
          throw new Error(`Invalid base64 string`)
        }

        try {
          // Use browser-compatible base64 decoding
          return decodeURIComponent(escape(atob(str)))
        } catch (error) {
          // Fallback for Node.js environment
          try {
            const decoded = Buffer.from(str, 'base64').toString('utf-8')
            // Verify the base64 was valid by re-encoding
            const reencoded = Buffer.from(decoded, 'utf-8').toString('base64')
            if (reencoded !== str) {
              throw new Error(`Invalid base64 string`)
            }
            return decoded
          } catch {
            throw new Error(`Invalid base64 string`)
          }
        }
      }

      throw new Error(`Unsupported encoding: ${encodingStr}`)
    }
  },

  /**
   * Generates hash of string using specified algorithm
   */
  hash: {
    async call(value: unknown, algorithm?: unknown): Promise<string> {
      const str = validateString(value, 'hash')
      validateArgument(algorithm, 'algorithm', 'hash')
      const algoStr = String(algorithm).toLowerCase()

      // Convert string to bytes
      const encoder = new TextEncoder()
      const data = encoder.encode(str)

      if (algoStr === 'sha256') {
        try {
          // Try Web Crypto API (browser and modern Node.js)
          const hashBuffer = await crypto.subtle.digest('SHA-256', data)
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
        } catch {
          // Fallback for Node.js
          const crypto = await import('crypto')
          return crypto.createHash('sha256').update(str).digest('hex')
        }
      }

      if (algoStr === 'md5') {
        try {
          // MD5 not available in Web Crypto, use Node.js crypto
          const crypto = await import('crypto')
          return crypto.createHash('md5').update(str).digest('hex')
        } catch {
          throw new Error('MD5 hashing not available in this environment')
        }
      }

      throw new Error(`Unsupported hash algorithm: ${algoStr}`)
    }
  }
}

// Synchronous wrapper for hash function to match test expectations
const originalHash = stringFunctions.hash.call
stringFunctions.hash.call = function(value: unknown, algorithm?: unknown): string {
  const str = validateString(value, 'hash')
  validateArgument(algorithm, 'algorithm', 'hash')
  const algoStr = String(algorithm).toLowerCase()

  // Use Node.js crypto for synchronous hashing
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto')

    if (algoStr === 'sha256') {
      return crypto.createHash('sha256').update(str).digest('hex')
    }

    if (algoStr === 'md5') {
      return crypto.createHash('md5').update(str).digest('hex')
    }

    throw new Error(`Unsupported hash algorithm: ${algoStr}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unsupported')) {
      throw error
    }
    throw new Error('Hashing not available in this environment')
  }
}

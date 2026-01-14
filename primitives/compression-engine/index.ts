/**
 * CompressionEngine
 * Comprehensive compression system for the dotdo platform
 */
import {
  CompressionAlgorithm,
  CompressionLevel,
  CompressionResult,
  DecompressionResult,
  CompressionStats,
  BenchmarkResult,
  StreamOptions,
  DictionaryConfig,
  Compressor,
  CompressionError,
} from './types'

// Re-export types
export * from './types'

/**
 * Convert named level to numeric
 */
function normalizeLevel(level: CompressionLevel): number {
  if (typeof level === 'number') return level
  switch (level) {
    case 'fast': return 1
    case 'default': return 6
    case 'best': return 9
  }
}

/**
 * Magic bytes for algorithm detection
 */
const MAGIC_BYTES = {
  gzip: [0x1f, 0x8b],
  deflate: [[0x78, 0x01], [0x78, 0x5e], [0x78, 0x9c], [0x78, 0xda]], // Various zlib headers
  brotli: [0xce, 0xb2, 0xcf, 0x81], // Custom magic for our brotli wrapper
  lz4: [0x04, 0x22, 0x4d, 0x18], // LZ4 frame magic
  snappy: [0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59], // snappy stream
} as const

/**
 * Preset dictionaries for common data types
 */
const PRESET_DICTIONARIES: Record<string, Uint8Array> = {
  json: new TextEncoder().encode(
    '{"null":true,"false":[],"name":"value","id":,"type":"data":,"items":,"count":,"status":"error":"message":"success":"result":}'
  ),
  html: new TextEncoder().encode(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title></title><link rel="stylesheet" href=""><script src=""></script></head><body><div class=""><span><a href=""><img src=""><p><ul><li><table><tr><td></td></tr></table>'
  ),
  css: new TextEncoder().encode(
    '.container{display:flex;flex-direction:row;justify-content:center;align-items:center;margin:0;padding:0;width:100%;height:100%;background-color:#;color:#;font-size:px;font-family:sans-serif;border:1px solid #;border-radius:px;}'
  ),
  javascript: new TextEncoder().encode(
    'function(){return;const let var async await import export from default class extends constructor this super new typeof instanceof if else for while do switch case break continue try catch finally throw Error Promise.resolve Promise.reject .then(.catch(.finally(console.log(document.window.module.exports require('
  ),
  text: new TextEncoder().encode(
    ' the and is in of to for with that this was are be on at by from or an as it not have been has its were will their which would more about can all there when one out other into some them these then so than up also such only over new after just most may between two through back well because our own where being before very into most'
  ),
}

/**
 * GzipCompressor - Gzip compression using CompressionStream API
 */
export class GzipCompressor implements Compressor {
  algorithm: CompressionAlgorithm = 'gzip'

  async compress(data: Uint8Array, level?: CompressionLevel): Promise<Uint8Array> {
    // CompressionStream doesn't support level, but we accept it for interface consistency
    const cs = new CompressionStream('gzip')
    const writer = cs.writable.getWriter()
    writer.write(data)
    writer.close()

    const reader = cs.readable.getReader()
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    return concatUint8Arrays(chunks)
  }

  async decompress(data: Uint8Array): Promise<Uint8Array> {
    try {
      const ds = new DecompressionStream('gzip')
      const writer = ds.writable.getWriter()
      const reader = ds.readable.getReader()

      // Use Promise.all to handle both write and read errors properly
      const writePromise = (async () => {
        try {
          await writer.write(data)
          await writer.close()
        } catch (e) {
          // Abort the reader to prevent hanging
          await reader.cancel().catch(() => {})
          throw e
        }
      })()

      const readPromise = (async () => {
        const chunks: Uint8Array[] = []
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
          }
          return chunks
        } catch (e) {
          // Cancel writer to clean up
          await writer.abort().catch(() => {})
          throw e
        }
      })()

      const [, chunks] = await Promise.all([writePromise, readPromise])
      return concatUint8Arrays(chunks)
    } catch (e) {
      throw new CompressionError(
        `Failed to decompress gzip data: ${e instanceof Error ? e.message : String(e)}`,
        'gzip',
        e instanceof Error ? e : undefined
      )
    }
  }

  detect(data: Uint8Array): boolean {
    return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
  }
}

/**
 * DeflateCompressor - Raw deflate compression
 */
export class DeflateCompressor implements Compressor {
  algorithm: CompressionAlgorithm = 'deflate'

  async compress(data: Uint8Array, level?: CompressionLevel): Promise<Uint8Array> {
    const cs = new CompressionStream('deflate')
    const writer = cs.writable.getWriter()
    writer.write(data)
    writer.close()

    const reader = cs.readable.getReader()
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    return concatUint8Arrays(chunks)
  }

  async decompress(data: Uint8Array): Promise<Uint8Array> {
    try {
      const ds = new DecompressionStream('deflate')
      const writer = ds.writable.getWriter()
      const reader = ds.readable.getReader()

      // Use Promise.all to handle both write and read errors properly
      const writePromise = (async () => {
        try {
          await writer.write(data)
          await writer.close()
        } catch (e) {
          // Abort the reader to prevent hanging
          await reader.cancel().catch(() => {})
          throw e
        }
      })()

      const readPromise = (async () => {
        const chunks: Uint8Array[] = []
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
          }
          return chunks
        } catch (e) {
          // Cancel writer to clean up
          await writer.abort().catch(() => {})
          throw e
        }
      })()

      const [, chunks] = await Promise.all([writePromise, readPromise])
      return concatUint8Arrays(chunks)
    } catch (e) {
      throw new CompressionError(
        `Failed to decompress deflate data: ${e instanceof Error ? e.message : String(e)}`,
        'deflate',
        e instanceof Error ? e : undefined
      )
    }
  }

  detect(data: Uint8Array): boolean {
    if (data.length < 2) return false
    // zlib header bytes
    const cmf = data[0]
    const flg = data[1]
    // Check for valid zlib header
    return (cmf === 0x78 && (flg === 0x01 || flg === 0x5e || flg === 0x9c || flg === 0xda))
  }
}

/**
 * BrotliCompressor - Brotli compression (simulated with deflate-raw for compatibility)
 * Note: Native Brotli requires WASM or native module; this uses a wrapper approach
 */
class BrotliCompressor implements Compressor {
  algorithm: CompressionAlgorithm = 'brotli'

  // Magic header to identify our brotli-wrapped data
  private readonly MAGIC = new Uint8Array([0xce, 0xb2, 0xcf, 0x81])

  async compress(data: Uint8Array, level?: CompressionLevel): Promise<Uint8Array> {
    // Use deflate-raw as underlying algorithm with brotli-like wrapper
    const cs = new CompressionStream('deflate-raw')
    const writer = cs.writable.getWriter()
    writer.write(data)
    writer.close()

    const reader = cs.readable.getReader()
    const chunks: Uint8Array[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    const compressed = concatUint8Arrays(chunks)

    // Add magic header to identify as brotli
    const result = new Uint8Array(this.MAGIC.length + compressed.length)
    result.set(this.MAGIC, 0)
    result.set(compressed, this.MAGIC.length)

    return result
  }

  async decompress(data: Uint8Array): Promise<Uint8Array> {
    try {
      // Strip magic header
      if (!this.detect(data)) {
        throw new Error('Invalid brotli data: missing magic header')
      }

      const compressedData = data.slice(this.MAGIC.length)

      const ds = new DecompressionStream('deflate-raw')
      const writer = ds.writable.getWriter()
      const reader = ds.readable.getReader()

      // Use Promise.all to handle both write and read errors properly
      const writePromise = (async () => {
        try {
          await writer.write(compressedData)
          await writer.close()
        } catch (e) {
          // Abort the reader to prevent hanging
          await reader.cancel().catch(() => {})
          throw e
        }
      })()

      const readPromise = (async () => {
        const chunks: Uint8Array[] = []
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
          }
          return chunks
        } catch (e) {
          // Cancel writer to clean up
          await writer.abort().catch(() => {})
          throw e
        }
      })()

      const [, chunks] = await Promise.all([writePromise, readPromise])
      return concatUint8Arrays(chunks)
    } catch (e) {
      throw new CompressionError(
        `Failed to decompress brotli data: ${e instanceof Error ? e.message : String(e)}`,
        'brotli',
        e instanceof Error ? e : undefined
      )
    }
  }

  detect(data: Uint8Array): boolean {
    if (data.length < this.MAGIC.length) return false
    return data[0] === this.MAGIC[0] &&
           data[1] === this.MAGIC[1] &&
           data[2] === this.MAGIC[2] &&
           data[3] === this.MAGIC[3]
  }
}

/**
 * LZ4Compressor - LZ4-like fast compression
 * This is a simplified LZ4-compatible implementation optimized for speed
 */
export class LZ4Compressor implements Compressor {
  algorithm: CompressionAlgorithm = 'lz4'

  // LZ4 frame magic number
  private readonly MAGIC = new Uint8Array([0x04, 0x22, 0x4d, 0x18])

  async compress(data: Uint8Array, level?: CompressionLevel): Promise<Uint8Array> {
    // Simple LZ4-style compression
    const compressed = this.lz4Compress(data)

    // Add frame header
    const result = new Uint8Array(this.MAGIC.length + 4 + compressed.length)
    result.set(this.MAGIC, 0)
    // Store original length
    const view = new DataView(result.buffer)
    view.setUint32(this.MAGIC.length, data.length, true)
    result.set(compressed, this.MAGIC.length + 4)

    return result
  }

  async decompress(data: Uint8Array): Promise<Uint8Array> {
    try {
      if (!this.detect(data)) {
        throw new Error('Invalid LZ4 data: missing magic header')
      }

      const view = new DataView(data.buffer, data.byteOffset)
      const originalLength = view.getUint32(this.MAGIC.length, true)
      const compressedData = data.slice(this.MAGIC.length + 4)

      return this.lz4Decompress(compressedData, originalLength)
    } catch (e) {
      throw new CompressionError(
        `Failed to decompress LZ4 data: ${e instanceof Error ? e.message : String(e)}`,
        'lz4',
        e instanceof Error ? e : undefined
      )
    }
  }

  detect(data: Uint8Array): boolean {
    if (data.length < this.MAGIC.length) return false
    return data[0] === this.MAGIC[0] &&
           data[1] === this.MAGIC[1] &&
           data[2] === this.MAGIC[2] &&
           data[3] === this.MAGIC[3]
  }

  /**
   * Simple LZ4-style compression
   * Uses a hash table for fast matching with 4-byte sequences
   */
  private lz4Compress(input: Uint8Array): Uint8Array {
    if (input.length === 0) return new Uint8Array(0)
    if (input.length < 12) {
      // Too small for compression, store as literal
      return this.encodeLiteral(input)
    }

    const output: number[] = []
    const hashTable = new Map<number, number>()

    let ip = 0 // input position
    let anchor = 0 // position of last literal run

    const hashBytes = (pos: number): number => {
      if (pos + 4 > input.length) return 0
      return (input[pos] | (input[pos + 1] << 8) | (input[pos + 2] << 16) | (input[pos + 3] << 24)) >>> 0
    }

    while (ip < input.length - 12) {
      const hash = hashBytes(ip)
      const ref = hashTable.get(hash)
      hashTable.set(hash, ip)

      if (ref !== undefined && ip - ref < 65535) {
        // Check for match
        let matchLen = 0
        while (ip + matchLen < input.length &&
               ref + matchLen < ip &&
               input[ref + matchLen] === input[ip + matchLen]) {
          matchLen++
        }

        if (matchLen >= 4) {
          // Found a match
          const literalLen = ip - anchor
          const offset = ip - ref

          // Encode token
          const token = (Math.min(literalLen, 15) << 4) | Math.min(matchLen - 4, 15)
          output.push(token)

          // Encode literal length (if >= 15)
          if (literalLen >= 15) {
            let remaining = literalLen - 15
            while (remaining >= 255) {
              output.push(255)
              remaining -= 255
            }
            output.push(remaining)
          }

          // Copy literals
          for (let i = 0; i < literalLen; i++) {
            output.push(input[anchor + i])
          }

          // Encode offset (little-endian)
          output.push(offset & 0xff)
          output.push((offset >> 8) & 0xff)

          // Encode match length (if >= 19)
          if (matchLen - 4 >= 15) {
            let remaining = matchLen - 4 - 15
            while (remaining >= 255) {
              output.push(255)
              remaining -= 255
            }
            output.push(remaining)
          }

          ip += matchLen
          anchor = ip
          continue
        }
      }

      ip++
    }

    // Handle remaining literals
    const literalLen = input.length - anchor
    if (literalLen > 0) {
      const token = Math.min(literalLen, 15) << 4
      output.push(token)

      if (literalLen >= 15) {
        let remaining = literalLen - 15
        while (remaining >= 255) {
          output.push(255)
          remaining -= 255
        }
        output.push(remaining)
      }

      for (let i = 0; i < literalLen; i++) {
        output.push(input[anchor + i])
      }
    }

    return new Uint8Array(output)
  }

  /**
   * Encode data as a literal-only block
   */
  private encodeLiteral(input: Uint8Array): Uint8Array {
    const output: number[] = []
    const literalLen = input.length

    const token = Math.min(literalLen, 15) << 4
    output.push(token)

    if (literalLen >= 15) {
      let remaining = literalLen - 15
      while (remaining >= 255) {
        output.push(255)
        remaining -= 255
      }
      output.push(remaining)
    }

    for (let i = 0; i < literalLen; i++) {
      output.push(input[i])
    }

    return new Uint8Array(output)
  }

  /**
   * LZ4-style decompression
   */
  private lz4Decompress(input: Uint8Array, originalLength: number): Uint8Array {
    if (input.length === 0) return new Uint8Array(0)

    const output = new Uint8Array(originalLength)
    let ip = 0 // input position
    let op = 0 // output position

    while (ip < input.length && op < originalLength) {
      const token = input[ip++]
      let literalLen = token >> 4

      // Read extended literal length
      if (literalLen === 15) {
        let b: number
        do {
          b = input[ip++]
          literalLen += b
        } while (b === 255 && ip < input.length)
      }

      // Copy literals
      for (let i = 0; i < literalLen && op < originalLength; i++) {
        output[op++] = input[ip++]
      }

      if (op >= originalLength) break

      // Read offset
      if (ip + 1 >= input.length) break
      const offset = input[ip] | (input[ip + 1] << 8)
      ip += 2

      if (offset === 0) {
        throw new Error('Invalid LZ4 offset: zero')
      }

      // Read match length
      let matchLen = (token & 0x0f) + 4
      if ((token & 0x0f) === 15) {
        let b: number
        do {
          b = input[ip++]
          matchLen += b
        } while (b === 255 && ip < input.length)
      }

      // Copy match
      const matchPos = op - offset
      for (let i = 0; i < matchLen && op < originalLength; i++) {
        output[op++] = output[matchPos + i]
      }
    }

    return output.slice(0, op)
  }
}

/**
 * SnappyCompressor - Snappy-style fast compression
 */
class SnappyCompressor implements Compressor {
  algorithm: CompressionAlgorithm = 'snappy'

  // Snappy stream identifier
  private readonly MAGIC = new Uint8Array([0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59])

  async compress(data: Uint8Array, level?: CompressionLevel): Promise<Uint8Array> {
    // Simple Snappy-style compression (similar to LZ4)
    const compressed = this.snappyCompress(data)

    // Add stream header
    const result = new Uint8Array(this.MAGIC.length + 4 + compressed.length)
    result.set(this.MAGIC, 0)
    const view = new DataView(result.buffer)
    view.setUint32(this.MAGIC.length, data.length, true)
    result.set(compressed, this.MAGIC.length + 4)

    return result
  }

  async decompress(data: Uint8Array): Promise<Uint8Array> {
    try {
      if (!this.detect(data)) {
        throw new Error('Invalid Snappy data: missing stream identifier')
      }

      const view = new DataView(data.buffer, data.byteOffset)
      const originalLength = view.getUint32(this.MAGIC.length, true)
      const compressedData = data.slice(this.MAGIC.length + 4)

      return this.snappyDecompress(compressedData, originalLength)
    } catch (e) {
      throw new CompressionError(
        `Failed to decompress Snappy data: ${e instanceof Error ? e.message : String(e)}`,
        'snappy',
        e instanceof Error ? e : undefined
      )
    }
  }

  detect(data: Uint8Array): boolean {
    if (data.length < this.MAGIC.length) return false
    for (let i = 0; i < this.MAGIC.length; i++) {
      if (data[i] !== this.MAGIC[i]) return false
    }
    return true
  }

  /**
   * Simple Snappy-style compression
   */
  private snappyCompress(input: Uint8Array): Uint8Array {
    if (input.length === 0) return new Uint8Array(0)

    const output: number[] = []
    const hashTable = new Map<number, number>()

    let ip = 0
    let pendingLiterals: number[] = []

    const hashBytes = (pos: number): number => {
      if (pos + 4 > input.length) return 0
      return (input[pos] * 31 + input[pos + 1] * 17 + input[pos + 2] * 7 + input[pos + 3]) | 0
    }

    const flushLiterals = () => {
      if (pendingLiterals.length === 0) return

      const len = pendingLiterals.length
      if (len < 60) {
        output.push((len - 1) << 2) // literal tag
      } else if (len < 256) {
        output.push(60 << 2)
        output.push(len - 1)
      } else {
        output.push(61 << 2)
        output.push((len - 1) & 0xff)
        output.push(((len - 1) >> 8) & 0xff)
      }

      for (const b of pendingLiterals) {
        output.push(b)
      }
      pendingLiterals = []
    }

    while (ip < input.length) {
      if (ip + 4 > input.length) {
        // Not enough for matching
        pendingLiterals.push(input[ip++])
        continue
      }

      const hash = hashBytes(ip)
      const ref = hashTable.get(hash)
      hashTable.set(hash, ip)

      if (ref !== undefined && ip - ref < 65536) {
        // Check for match
        let matchLen = 0
        while (ip + matchLen < input.length &&
               ref + matchLen < ip &&
               input[ref + matchLen] === input[ip + matchLen] &&
               matchLen < 64) {
          matchLen++
        }

        if (matchLen >= 4) {
          // Found a match, flush pending literals first
          flushLiterals()

          const offset = ip - ref

          // Encode copy
          if (matchLen <= 11 && offset < 2048) {
            // Short copy (1 byte tag + 1 byte offset)
            output.push(((offset >> 8) << 5) | ((matchLen - 4) << 2) | 1)
            output.push(offset & 0xff)
          } else if (offset < 65536) {
            // Long copy (2 bytes offset)
            output.push(((matchLen - 1) << 2) | 2)
            output.push(offset & 0xff)
            output.push((offset >> 8) & 0xff)
          }

          ip += matchLen
          continue
        }
      }

      pendingLiterals.push(input[ip++])
    }

    flushLiterals()
    return new Uint8Array(output)
  }

  /**
   * Snappy-style decompression
   */
  private snappyDecompress(input: Uint8Array, originalLength: number): Uint8Array {
    if (input.length === 0) return new Uint8Array(0)

    const output = new Uint8Array(originalLength)
    let ip = 0
    let op = 0

    while (ip < input.length && op < originalLength) {
      const tag = input[ip++]
      const tagType = tag & 3

      if (tagType === 0) {
        // Literal
        let len = tag >> 2
        if (len < 60) {
          len++
        } else if (len === 60) {
          len = input[ip++] + 1
        } else if (len === 61) {
          len = (input[ip] | (input[ip + 1] << 8)) + 1
          ip += 2
        } else if (len === 62) {
          len = (input[ip] | (input[ip + 1] << 8) | (input[ip + 2] << 16)) + 1
          ip += 3
        } else {
          len = (input[ip] | (input[ip + 1] << 8) | (input[ip + 2] << 16) | (input[ip + 3] << 24)) + 1
          ip += 4
        }

        for (let i = 0; i < len && op < originalLength; i++) {
          output[op++] = input[ip++]
        }
      } else if (tagType === 1) {
        // Copy with 1-byte offset
        const len = ((tag >> 2) & 7) + 4
        const offset = ((tag >> 5) << 8) | input[ip++]

        const srcPos = op - offset
        for (let i = 0; i < len && op < originalLength; i++) {
          output[op++] = output[srcPos + i]
        }
      } else if (tagType === 2) {
        // Copy with 2-byte offset
        const len = (tag >> 2) + 1
        const offset = input[ip] | (input[ip + 1] << 8)
        ip += 2

        const srcPos = op - offset
        for (let i = 0; i < len && op < originalLength; i++) {
          output[op++] = output[srcPos + i]
        }
      } else {
        // Copy with 4-byte offset (tagType === 3)
        const len = (tag >> 2) + 1
        const offset = input[ip] | (input[ip + 1] << 8) | (input[ip + 2] << 16) | (input[ip + 3] << 24)
        ip += 4

        const srcPos = op - offset
        for (let i = 0; i < len && op < originalLength; i++) {
          output[op++] = output[srcPos + i]
        }
      }
    }

    return output.slice(0, op)
  }
}

/**
 * DictionaryCompressor - Dictionary-based compression
 */
export class DictionaryCompressor {
  private baseCompressor = new DeflateCompressor()

  async compress(
    data: Uint8Array,
    level: CompressionLevel = 'default',
    config?: { dictionary?: Uint8Array | DictionaryConfig }
  ): Promise<Uint8Array> {
    const dictionary = this.getDictionary(config?.dictionary)

    if (dictionary) {
      // Prepend dictionary to data for better compression
      // Store dictionary hash for decompression
      const hash = this.hashDictionary(dictionary)
      const combined = new Uint8Array(data.length + dictionary.length)
      combined.set(dictionary, 0)
      combined.set(data, dictionary.length)

      const compressed = await this.baseCompressor.compress(combined, level)

      // Wrap with dictionary info
      const result = new Uint8Array(8 + compressed.length)
      const view = new DataView(result.buffer)
      view.setUint32(0, hash, true)
      view.setUint32(4, dictionary.length, true)
      result.set(compressed, 8)

      return result
    }

    return this.baseCompressor.compress(data, level)
  }

  async decompress(
    data: Uint8Array,
    config?: { dictionary?: Uint8Array | DictionaryConfig }
  ): Promise<Uint8Array> {
    const dictionary = this.getDictionary(config?.dictionary)

    if (dictionary) {
      // Extract dictionary info
      const view = new DataView(data.buffer, data.byteOffset)
      const storedHash = view.getUint32(0, true)
      const dictLen = view.getUint32(4, true)
      const compressedData = data.slice(8)

      const decompressed = await this.baseCompressor.decompress(compressedData)

      // Remove dictionary prefix
      return decompressed.slice(dictLen)
    }

    return this.baseCompressor.decompress(data)
  }

  private getDictionary(config?: Uint8Array | DictionaryConfig): Uint8Array | undefined {
    if (!config) return undefined

    if (config instanceof Uint8Array) {
      return config
    }

    if ('preset' in config && config.preset) {
      return PRESET_DICTIONARIES[config.preset]
    }

    if ('dictionary' in config && config.dictionary) {
      return config.dictionary
    }

    return undefined
  }

  private hashDictionary(dict: Uint8Array): number {
    let hash = 0
    for (let i = 0; i < dict.length; i++) {
      hash = ((hash << 5) - hash + dict[i]) | 0
    }
    return hash >>> 0
  }
}

/**
 * AdaptiveCompressor - Auto-selects best algorithm
 */
export class AdaptiveCompressor {
  private compressors: Map<CompressionAlgorithm, Compressor>

  constructor() {
    this.compressors = new Map([
      ['gzip', new GzipCompressor()],
      ['deflate', new DeflateCompressor()],
      ['brotli', new BrotliCompressor()],
      ['lz4', new LZ4Compressor()],
      ['snappy', new SnappyCompressor()],
    ])
  }

  async compress(
    data: Uint8Array,
    options?: { preferSpeed?: boolean; preferRatio?: boolean }
  ): Promise<{ data: Uint8Array; algorithm: CompressionAlgorithm }> {
    // Determine which algorithm to use based on data size and preferences
    let algorithm: CompressionAlgorithm

    if (options?.preferSpeed || data.length > 100000) {
      // Use fast algorithms for large data or when speed is preferred
      algorithm = 'lz4'
    } else if (options?.preferRatio) {
      // Use high-ratio algorithm for small data or when ratio is preferred
      algorithm = 'brotli'
    } else {
      // Default: use gzip as good balance
      algorithm = 'gzip'
    }

    const compressor = this.compressors.get(algorithm)!
    const compressed = await compressor.compress(data)

    return { data: compressed, algorithm }
  }

  async decompress(data: Uint8Array): Promise<Uint8Array> {
    // Auto-detect algorithm
    for (const [algo, compressor] of this.compressors) {
      if (compressor.detect(data)) {
        return compressor.decompress(data)
      }
    }

    throw new CompressionError('Unable to detect compression algorithm')
  }
}

/**
 * ChunkedCompressor - Chunk-based compression for large data
 */
export class ChunkedCompressor {
  private chunkSize: number
  private engine: CompressionEngine

  constructor(options?: { chunkSize?: number }) {
    this.chunkSize = options?.chunkSize ?? 16384
    this.engine = new CompressionEngine()
  }

  async compress(
    data: Uint8Array,
    algorithm: CompressionAlgorithm,
    options?: { onProgress?: (progress: number) => void }
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = []
    const numChunks = Math.ceil(data.length / this.chunkSize)

    // Header: chunk count + original size + algorithm byte
    const header = new Uint8Array(9)
    const headerView = new DataView(header.buffer)
    headerView.setUint32(0, numChunks, true)
    headerView.setUint32(4, data.length, true)
    header[8] = this.algorithmToByte(algorithm)
    chunks.push(header)

    for (let i = 0; i < numChunks; i++) {
      const start = i * this.chunkSize
      const end = Math.min(start + this.chunkSize, data.length)
      const chunk = data.slice(start, end)

      const compressed = await this.engine.compress(chunk, algorithm)

      // Store chunk size before chunk data
      const chunkHeader = new Uint8Array(4)
      new DataView(chunkHeader.buffer).setUint32(0, compressed.data.length, true)
      chunks.push(chunkHeader)
      chunks.push(compressed.data)

      if (options?.onProgress) {
        options.onProgress((i + 1) / numChunks)
      }
    }

    return concatUint8Arrays(chunks)
  }

  async decompress(
    data: Uint8Array,
    algorithm: CompressionAlgorithm
  ): Promise<Uint8Array> {
    const headerView = new DataView(data.buffer, data.byteOffset)
    const numChunks = headerView.getUint32(0, true)
    const originalSize = headerView.getUint32(4, true)
    // algorithm byte at offset 8

    const result = new Uint8Array(originalSize)
    let offset = 9
    let outputOffset = 0

    for (let i = 0; i < numChunks; i++) {
      const chunkSize = new DataView(data.buffer, data.byteOffset + offset).getUint32(0, true)
      offset += 4

      const chunk = data.slice(offset, offset + chunkSize)
      offset += chunkSize

      const decompressed = await this.engine.decompress(chunk, algorithm)
      result.set(decompressed.data, outputOffset)
      outputOffset += decompressed.data.length
    }

    return result
  }

  private algorithmToByte(algorithm: CompressionAlgorithm): number {
    const map: Record<CompressionAlgorithm, number> = {
      gzip: 0,
      deflate: 1,
      brotli: 2,
      lz4: 3,
      snappy: 4,
    }
    return map[algorithm]
  }
}

/**
 * Main CompressionEngine class
 */
export class CompressionEngine {
  private compressors: Map<CompressionAlgorithm, Compressor>
  private dictionaryCompressor: DictionaryCompressor

  constructor() {
    this.compressors = new Map([
      ['gzip', new GzipCompressor()],
      ['deflate', new DeflateCompressor()],
      ['brotli', new BrotliCompressor()],
      ['lz4', new LZ4Compressor()],
      ['snappy', new SnappyCompressor()],
    ])
    this.dictionaryCompressor = new DictionaryCompressor()
  }

  /**
   * Compress data using specified algorithm
   */
  async compress(
    data: Uint8Array,
    algorithm: CompressionAlgorithm,
    level: CompressionLevel = 'default',
    options?: { dictionary?: Uint8Array | DictionaryConfig }
  ): Promise<CompressionResult> {
    let compressed: Uint8Array

    if (options?.dictionary) {
      compressed = await this.dictionaryCompressor.compress(data, level, { dictionary: options.dictionary })
    } else {
      const compressor = this.compressors.get(algorithm)
      if (!compressor) {
        throw new CompressionError(`Unknown algorithm: ${algorithm}`, algorithm)
      }
      compressed = await compressor.compress(data, level)
    }

    return {
      data: compressed,
      originalSize: data.length,
      compressedSize: compressed.length,
      ratio: data.length === 0 ? 1 : compressed.length / data.length,
    }
  }

  /**
   * Decompress data using specified algorithm
   */
  async decompress(
    data: Uint8Array,
    algorithm: CompressionAlgorithm,
    options?: { dictionary?: Uint8Array | DictionaryConfig }
  ): Promise<DecompressionResult> {
    let decompressed: Uint8Array

    if (options?.dictionary) {
      decompressed = await this.dictionaryCompressor.decompress(data, { dictionary: options.dictionary })
    } else {
      const compressor = this.compressors.get(algorithm)
      if (!compressor) {
        throw new CompressionError(`Unknown algorithm: ${algorithm}`, algorithm)
      }
      decompressed = await compressor.decompress(data)
    }

    return {
      data: decompressed,
      compressedSize: data.length,
      decompressedSize: decompressed.length,
    }
  }

  /**
   * Create a compression stream
   */
  compressStream(
    algorithm: CompressionAlgorithm,
    options?: StreamOptions
  ): TransformStream<Uint8Array, Uint8Array> {
    // Use native CompressionStream for gzip/deflate, wrapped in TransformStream
    if (algorithm === 'gzip' || algorithm === 'deflate') {
      const cs = new CompressionStream(algorithm)
      return {
        readable: cs.readable,
        writable: cs.writable,
      } as TransformStream<Uint8Array, Uint8Array>
    }

    // For other algorithms, create a custom transform stream
    const engine = this
    return new TransformStream({
      async transform(chunk, controller) {
        const result = await engine.compress(chunk, algorithm)
        controller.enqueue(result.data)
      }
    })
  }

  /**
   * Create a decompression stream
   */
  decompressStream(
    algorithm: CompressionAlgorithm,
    options?: StreamOptions
  ): TransformStream<Uint8Array, Uint8Array> {
    // Use native DecompressionStream for gzip/deflate, wrapped in TransformStream
    if (algorithm === 'gzip' || algorithm === 'deflate') {
      const ds = new DecompressionStream(algorithm)
      return {
        readable: ds.readable,
        writable: ds.writable,
      } as TransformStream<Uint8Array, Uint8Array>
    }

    // For other algorithms, create a custom transform stream
    const engine = this
    return new TransformStream({
      async transform(chunk, controller) {
        const result = await engine.decompress(chunk, algorithm)
        controller.enqueue(result.data)
      }
    })
  }

  /**
   * Detect compression algorithm from data
   */
  detectAlgorithm(data: Uint8Array): CompressionAlgorithm | null {
    for (const [algorithm, compressor] of this.compressors) {
      if (compressor.detect(data)) {
        return algorithm
      }
    }
    return null
  }

  /**
   * Benchmark compression algorithms
   */
  async benchmark(
    data: Uint8Array,
    algorithms?: CompressionAlgorithm[]
  ): Promise<BenchmarkResult> {
    const algosToTest = algorithms ?? (['gzip', 'deflate', 'brotli', 'lz4', 'snappy'] as CompressionAlgorithm[])
    const results: CompressionStats[] = []

    for (const algorithm of algosToTest) {
      const start = performance.now()
      const result = await this.compress(data, algorithm)
      const duration = performance.now() - start

      results.push({
        algorithm,
        level: 'default',
        duration,
        ratio: result.ratio,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        throughput: data.length / (duration / 1000),
      })
    }

    // Find best ratio
    const sortedByRatio = [...results].sort((a, b) => a.ratio - b.ratio)
    const bestRatio = sortedByRatio[0]

    // Find fastest
    const sortedBySpeed = [...results].sort((a, b) => a.duration - b.duration)
    const fastest = sortedBySpeed[0]

    return {
      bestAlgorithm: bestRatio.algorithm,
      bestRatio: bestRatio.ratio,
      fastestAlgorithm: fastest.algorithm,
      fastestDuration: fastest.duration,
      results,
    }
  }
}

/**
 * Helper to concatenate Uint8Arrays
 */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

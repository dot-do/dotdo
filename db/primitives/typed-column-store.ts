/**
 * TypedColumnStore - Columnar storage with compression codecs
 *
 * A column-oriented data store optimized for analytical workloads with
 * specialized compression codecs and statistical operations.
 *
 * Key features:
 * - Gorilla XOR compression for floating-point time series
 * - Delta-of-delta encoding for timestamps
 * - Run-length encoding (RLE) for low-cardinality data
 * - ZSTD-like general-purpose compression (using deflate)
 * - Bloom filters for membership testing
 * - HyperLogLog for distinct count estimation
 *
 * @module db/primitives/typed-column-store
 */

import { murmurHash3_32 } from './utils/murmur3'

// ============================================================================
// Types
// ============================================================================

/**
 * Supported column types
 */
export type ColumnType = 'int64' | 'float64' | 'string' | 'boolean' | 'timestamp'

/**
 * Comparison operators for predicates
 */
export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'between'

/**
 * Predicate for filtering rows
 */
export interface Predicate {
  column: string
  op: ComparisonOp
  value: unknown
}

/**
 * Aggregate functions
 */
export type AggregateFunction = 'sum' | 'count' | 'min' | 'max' | 'avg'

/**
 * Result of a column projection or filter
 */
export interface ColumnBatch {
  columns: Map<string, unknown[]>
  rowCount: number
}

/**
 * Bloom filter interface
 */
export interface BloomFilter {
  mightContain(value: number | string): boolean
  falsePositiveRate(): number
}

/**
 * TypedColumnStore interface
 */
export interface TypedColumnStore {
  // Compression codecs
  encode(values: number[], codec: 'gorilla' | 'delta' | 'rle' | 'zstd'): Uint8Array
  decode(data: Uint8Array, codec: string): number[]

  // Column operations
  addColumn(name: string, type: ColumnType): void
  append(column: string, values: unknown[]): void
  project(columns: string[]): ColumnBatch
  filter(predicate: Predicate): ColumnBatch
  aggregate(column: string, fn: AggregateFunction): number

  // Statistics
  minMax(column: string): { min: number; max: number }
  distinctCount(column: string): number
  bloomFilter(column: string): BloomFilter
}

// ============================================================================
// Bloom Filter Implementation
// ============================================================================

class BloomFilterImpl implements BloomFilter {
  private readonly bits: Uint8Array
  private readonly numHashFunctions: number
  private readonly numBits: number
  private readonly numElements: number

  constructor(expectedElements: number, falsePositiveRate: number = 0.005) {
    // Calculate optimal number of bits: m = -n * ln(p) / (ln(2)^2)
    // Use slightly lower FPR for safety margin
    const targetFPR = falsePositiveRate * 0.5
    const ln2Squared = Math.LN2 * Math.LN2
    this.numBits = Math.max(64, Math.ceil((-expectedElements * Math.log(targetFPR)) / ln2Squared))

    // Round up to nearest byte
    const numBytes = Math.ceil(this.numBits / 8)
    this.bits = new Uint8Array(numBytes)

    // k = (m/n) * ln(2)
    this.numHashFunctions = Math.max(1, Math.min(20, Math.round((this.numBits / expectedElements) * Math.LN2)))
    this.numElements = expectedElements
  }

  add(value: number | string): void {
    const key = this.valueToBytes(value)
    const h1 = murmurHash3_32(key, 0)
    const h2 = murmurHash3_32(key, h1)

    for (let i = 0; i < this.numHashFunctions; i++) {
      const combinedHash = (h1 + i * h2) >>> 0
      const bitIndex = combinedHash % this.numBits
      const byteIndex = Math.floor(bitIndex / 8)
      const bitOffset = bitIndex % 8
      this.bits[byteIndex] |= 1 << bitOffset
    }
  }

  mightContain(value: number | string): boolean {
    const key = this.valueToBytes(value)
    const h1 = murmurHash3_32(key, 0)
    const h2 = murmurHash3_32(key, h1)

    for (let i = 0; i < this.numHashFunctions; i++) {
      const combinedHash = (h1 + i * h2) >>> 0
      const bitIndex = combinedHash % this.numBits
      const byteIndex = Math.floor(bitIndex / 8)
      const bitOffset = bitIndex % 8

      if ((this.bits[byteIndex] & (1 << bitOffset)) === 0) {
        return false
      }
    }

    return true
  }

  falsePositiveRate(): number {
    // FPR = (1 - e^(-kn/m))^k
    return Math.pow(1 - Math.exp((-this.numHashFunctions * this.numElements) / this.numBits), this.numHashFunctions)
  }

  private valueToBytes(value: number | string): Uint8Array {
    if (typeof value === 'string') {
      return new TextEncoder().encode(value)
    }
    // For numbers, convert to 8-byte representation
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    if (Number.isInteger(value)) {
      // Use BigInt64 for integers
      view.setBigInt64(0, BigInt(Math.round(value)), true)
    } else {
      // Use Float64 for floats
      view.setFloat64(0, value, true)
    }
    return new Uint8Array(buffer)
  }
}

// ============================================================================
// HyperLogLog Implementation (for distinct count estimation)
// ============================================================================

class HyperLogLog {
  private readonly registers: Uint8Array
  private readonly numRegisters: number
  private readonly alpha: number

  constructor(precision: number = 14) {
    // Use precision bits for register addressing
    this.numRegisters = 1 << precision
    this.registers = new Uint8Array(this.numRegisters)

    // Alpha constant for bias correction
    if (this.numRegisters === 16) {
      this.alpha = 0.673
    } else if (this.numRegisters === 32) {
      this.alpha = 0.697
    } else if (this.numRegisters === 64) {
      this.alpha = 0.709
    } else {
      this.alpha = 0.7213 / (1 + 1.079 / this.numRegisters)
    }
  }

  add(value: number | string): void {
    const hash = this.hash(value)

    // Use first log2(numRegisters) bits for register index
    const registerBits = Math.log2(this.numRegisters)
    const registerIndex = hash >>> (32 - registerBits)

    // Count leading zeros in remaining bits + 1
    const remainingBits = (hash << registerBits) >>> 0
    const leadingZeros = this.countLeadingZeros(remainingBits, 32 - registerBits) + 1

    // Update register with max
    if (leadingZeros > this.registers[registerIndex]) {
      this.registers[registerIndex] = leadingZeros
    }
  }

  estimate(): number {
    // Calculate raw estimate using harmonic mean
    let sum = 0
    for (let i = 0; i < this.numRegisters; i++) {
      sum += Math.pow(2, -this.registers[i])
    }

    const rawEstimate = (this.alpha * this.numRegisters * this.numRegisters) / sum

    // Apply corrections
    if (rawEstimate <= 2.5 * this.numRegisters) {
      // Small range correction
      let zeroCount = 0
      for (let i = 0; i < this.numRegisters; i++) {
        if (this.registers[i] === 0) zeroCount++
      }
      if (zeroCount > 0) {
        return this.numRegisters * Math.log(this.numRegisters / zeroCount)
      }
    }

    // For larger estimates, use raw estimate
    return rawEstimate
  }

  private hash(value: number | string): number {
    let bytes: Uint8Array
    if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value)
    } else {
      const buffer = new ArrayBuffer(8)
      const view = new DataView(buffer)
      view.setFloat64(0, value, true)
      bytes = new Uint8Array(buffer)
    }
    return murmurHash3_32(bytes, 0)
  }

  private countLeadingZeros(value: number, maxBits: number): number {
    if (value === 0) return maxBits
    let count = 0
    let mask = 1 << (maxBits - 1)
    while ((value & mask) === 0 && count < maxBits) {
      count++
      mask >>>= 1
    }
    return count
  }
}

// ============================================================================
// Bit Stream Helper
// ============================================================================

class BitWriter {
  private buffer: number[] = []
  private currentByte: number = 0
  private bitPos: number = 0

  writeBit(bit: boolean): void {
    if (bit) {
      this.currentByte |= 1 << (7 - this.bitPos)
    }
    this.bitPos++
    if (this.bitPos === 8) {
      this.buffer.push(this.currentByte)
      this.currentByte = 0
      this.bitPos = 0
    }
  }

  writeBits(value: bigint, numBits: number): void {
    for (let i = numBits - 1; i >= 0; i--) {
      this.writeBit(((value >> BigInt(i)) & 1n) === 1n)
    }
  }

  writeUint(value: number, numBits: number): void {
    for (let i = numBits - 1; i >= 0; i--) {
      this.writeBit(((value >> i) & 1) === 1)
    }
  }

  finish(): Uint8Array {
    if (this.bitPos > 0) {
      this.buffer.push(this.currentByte)
    }
    return new Uint8Array(this.buffer)
  }

  get byteLength(): number {
    return this.buffer.length + (this.bitPos > 0 ? 1 : 0)
  }
}

class BitReader {
  private data: Uint8Array
  private bytePos: number = 0
  private bitPos: number = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  readBit(): boolean {
    if (this.bytePos >= this.data.length) return false
    const bit = (this.data[this.bytePos] >> (7 - this.bitPos)) & 1
    this.bitPos++
    if (this.bitPos === 8) {
      this.bytePos++
      this.bitPos = 0
    }
    return bit === 1
  }

  readBits(numBits: number): bigint {
    let result = 0n
    for (let i = 0; i < numBits; i++) {
      result = (result << 1n) | (this.readBit() ? 1n : 0n)
    }
    return result
  }

  readUint(numBits: number): number {
    let result = 0
    for (let i = 0; i < numBits; i++) {
      result = (result << 1) | (this.readBit() ? 1 : 0)
    }
    return result
  }

  hasMore(): boolean {
    return this.bytePos < this.data.length
  }
}

// ============================================================================
// Gorilla XOR Compression
// ============================================================================

/**
 * Gorilla XOR compression for floating-point time series
 *
 * Stores XOR of current value with previous value, then variable-length
 * encodes the meaningful bits using the Facebook Gorilla paper algorithm.
 *
 * For small arrays, uses a simpler encoding to avoid header overhead dominating.
 */
class GorillaCodec {
  encode(values: number[]): Uint8Array {
    if (values.length === 0) {
      return new Uint8Array([0, 0, 0, 0])
    }

    const writer = new BitWriter()

    // Write all values as bits for bit-level packing
    // First value: full 64 bits
    const firstBits = this.float64ToBits(values[0])
    writer.writeBits(firstBits, 64)

    let prevBits = firstBits
    let prevLeadingZeros = 255 // Initialize to invalid value
    let prevTrailingZeros = 0

    // Encode subsequent values using XOR with Gorilla algorithm
    for (let i = 1; i < values.length; i++) {
      const currentBits = this.float64ToBits(values[i])
      const xor = prevBits ^ currentBits

      if (xor === 0n) {
        // Same as previous - single 0 bit
        writer.writeBit(false)
      } else {
        // Different - write 1 bit
        writer.writeBit(true)

        const leadingZeros = this.countLeadingZeros64(xor)
        const trailingZeros = this.countTrailingZeros64(xor)
        const meaningfulBits = 64 - leadingZeros - trailingZeros

        // Check if we can reuse previous block structure
        // (only if previous block was valid and current XOR fits within it)
        if (
          prevLeadingZeros !== 255 &&
          leadingZeros >= prevLeadingZeros &&
          trailingZeros >= prevTrailingZeros
        ) {
          // Control bit 0: reuse previous block
          writer.writeBit(false)

          // Write meaningful bits using previous block structure
          const prevMeaningfulBits = 64 - prevLeadingZeros - prevTrailingZeros
          const shifted = xor >> BigInt(prevTrailingZeros)
          writer.writeBits(shifted, prevMeaningfulBits)
        } else {
          // Control bit 1: new block
          writer.writeBit(true)

          // Write leading zeros (6 bits to support up to 63)
          writer.writeUint(leadingZeros, 6)

          // Write meaningful bits length (6 bits, 0 means 64)
          const mbitsEncoded = meaningfulBits === 64 ? 0 : meaningfulBits
          writer.writeUint(mbitsEncoded, 6)

          // Write meaningful bits
          const shifted = xor >> BigInt(trailingZeros)
          writer.writeBits(shifted, meaningfulBits)

          prevLeadingZeros = leadingZeros
          prevTrailingZeros = trailingZeros
        }
      }

      prevBits = currentBits
    }

    const bitBytes = writer.finish()

    // Output: [length 4B][bit stream...]
    // More compact - no separate first value storage
    const output = new Uint8Array(4 + bitBytes.length)
    const view = new DataView(output.buffer)
    view.setUint32(0, values.length, true)
    output.set(bitBytes, 4)

    return output
  }

  decode(data: Uint8Array): number[] {
    // Validate minimum buffer size for header
    if (data.length < 4) {
      if (data.length === 0) return []
      throw new Error('Gorilla decode error: Buffer too small - expected at least 4 bytes for header')
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const length = view.getUint32(0, true)

    if (length === 0) return []

    // Validate buffer has enough data for at least the first value (8 bytes = 64 bits)
    // Header (4 bytes) + at least 8 bytes for first float
    if (data.length < 12) {
      throw new Error('Gorilla decode error: Buffer truncated - insufficient data for first value')
    }

    // Sanity check: prevent unreasonable length values that could cause memory issues
    if (length > 100_000_000) {
      throw new Error(`Gorilla decode error: Invalid length ${length} - exceeds maximum allowed (100M values)`)
    }

    const reader = new BitReader(data.slice(4))

    // Read first value (full 64 bits)
    const firstBits = reader.readBits(64)
    const values: number[] = [this.bitsToFloat64(firstBits)]

    if (length === 1) return values

    let prevBits = firstBits
    let prevLeadingZeros = 255
    let prevMeaningfulBits = 0
    let prevTrailingZeros = 0

    for (let i = 1; i < length; i++) {
      const controlBit = reader.readBit()

      if (!controlBit) {
        // Same as previous
        values.push(this.bitsToFloat64(prevBits))
      } else {
        // Different value
        const blockControl = reader.readBit()

        let leadingZeros: number
        let meaningfulBits: number
        let trailingZeros: number

        if (!blockControl && prevLeadingZeros !== 255) {
          // Reuse previous block structure
          leadingZeros = prevLeadingZeros
          meaningfulBits = prevMeaningfulBits
          trailingZeros = prevTrailingZeros
        } else {
          // New block structure (or first different value)
          leadingZeros = reader.readUint(6) // 6 bits to support up to 63
          meaningfulBits = reader.readUint(6)

          // Handle edge case where meaningfulBits is 0 (meaning 64)
          if (meaningfulBits === 0) meaningfulBits = 64

          trailingZeros = 64 - leadingZeros - meaningfulBits

          // Validate block structure
          if (trailingZeros < 0) {
            throw new Error(`Gorilla decode error: Invalid block structure at value ${i} - leadingZeros(${leadingZeros}) + meaningfulBits(${meaningfulBits}) > 64`)
          }

          prevLeadingZeros = leadingZeros
          prevMeaningfulBits = meaningfulBits
          prevTrailingZeros = trailingZeros
        }

        // Read meaningful bits
        const xorValue = reader.readBits(meaningfulBits)

        // Shift to correct position
        const shifted = xorValue << BigInt(trailingZeros)

        // XOR with previous to get current value
        const currentBits = prevBits ^ shifted
        values.push(this.bitsToFloat64(currentBits))
        prevBits = currentBits
      }
    }

    return values
  }

  private float64ToBits(value: number): bigint {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setFloat64(0, value, false)
    return view.getBigUint64(0, false)
  }

  private bitsToFloat64(bits: bigint): number {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setBigUint64(0, bits, false)
    return view.getFloat64(0, false)
  }

  private countLeadingZeros64(value: bigint): number {
    if (value === 0n) return 64
    let count = 0
    let mask = 1n << 63n
    while ((value & mask) === 0n && count < 64) {
      count++
      mask >>= 1n
    }
    return count
  }

  private countTrailingZeros64(value: bigint): number {
    if (value === 0n) return 64
    let count = 0
    while ((value & 1n) === 0n && count < 64) {
      count++
      value >>= 1n
    }
    return count
  }
}

// ============================================================================
// Delta-of-Delta Compression
// ============================================================================

/**
 * Delta-of-delta compression for timestamps
 *
 * Stores first value, first delta, then delta-of-deltas using
 * variable-bit encoding based on the Gorilla paper.
 */
class DeltaCodec {
  encode(values: number[]): Uint8Array {
    if (values.length === 0) {
      return new Uint8Array([0, 0, 0, 0])
    }

    // Header: length (4B) + first value (8B)
    const headerSize = 4 + 8
    const writer = new BitWriter()

    if (values.length === 1) {
      const output = new Uint8Array(headerSize)
      const view = new DataView(output.buffer)
      view.setUint32(0, 1, true)
      view.setBigInt64(4, BigInt(Math.round(values[0])), true)
      return output
    }

    // Calculate first delta
    let prevValue = BigInt(Math.round(values[0]))
    let prevDelta = BigInt(Math.round(values[1])) - prevValue

    // Write first delta using variable-bit encoding
    this.writeDelta(writer, prevDelta)

    // Encode delta-of-deltas
    for (let i = 2; i < values.length; i++) {
      const currentValue = BigInt(Math.round(values[i]))
      const delta = currentValue - BigInt(Math.round(values[i - 1]))
      const dod = delta - prevDelta

      this.writeDeltaOfDelta(writer, dod)

      prevDelta = delta
    }

    const dodBytes = writer.finish()

    // Build output: [length 4B][first value 8B][dod bits...]
    const output = new Uint8Array(headerSize + dodBytes.length)
    const view = new DataView(output.buffer)
    view.setUint32(0, values.length, true)
    view.setBigInt64(4, BigInt(Math.round(values[0])), true)
    output.set(dodBytes, headerSize)

    return output
  }

  decode(data: Uint8Array): number[] {
    // Validate minimum buffer size for header
    if (data.length < 4) {
      if (data.length === 0) return []
      throw new Error('Delta decode error: Buffer too small - expected at least 4 bytes for header')
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const length = view.getUint32(0, true)

    if (length === 0) return []

    // Validate buffer has enough data for header (4 bytes) + first value (8 bytes)
    if (data.length < 12) {
      throw new Error('Delta decode error: Buffer truncated - insufficient data for first value')
    }

    // Sanity check: prevent unreasonable length values that could cause memory issues
    if (length > 100_000_000) {
      throw new Error(`Delta decode error: Invalid length ${length} - exceeds maximum allowed (100M values)`)
    }

    // Read first value
    const firstValue = Number(view.getBigInt64(4, true))
    const values: number[] = [firstValue]

    if (length === 1) return values

    const reader = new BitReader(data.slice(12))

    // Read first delta
    let prevDelta = this.readDelta(reader)
    values.push(firstValue + Number(prevDelta))

    if (length === 2) return values

    // Read delta-of-deltas
    for (let i = 2; i < length; i++) {
      const dod = this.readDeltaOfDelta(reader)
      const delta = prevDelta + dod
      values.push(values[values.length - 1] + Number(delta))
      prevDelta = delta
    }

    return values
  }

  private writeDelta(writer: BitWriter, delta: bigint): void {
    // Variable-bit encoding for first delta
    // Use zigzag encoding then write with length prefix
    const zigzag = delta >= 0n ? delta * 2n : -delta * 2n - 1n

    if (zigzag === 0n) {
      writer.writeBit(false) // Single zero bit
    } else {
      writer.writeBit(true)
      // Write the zigzag value with variable length
      const bits = this.bitLength(zigzag)
      writer.writeUint(bits, 6)
      writer.writeBits(zigzag, bits)
    }
  }

  private readDelta(reader: BitReader): bigint {
    if (!reader.readBit()) {
      return 0n
    }
    const bits = reader.readUint(6)
    const zigzag = reader.readBits(bits)
    return (zigzag >> 1n) ^ -(zigzag & 1n)
  }

  private writeDeltaOfDelta(writer: BitWriter, dod: bigint): void {
    // Encode delta-of-delta using variable-length encoding
    // Similar to Gorilla: different bit counts for different ranges
    // Use symmetric ranges around zero for easier decode
    if (dod === 0n) {
      // Single 0 bit
      writer.writeBit(false)
    } else if (dod >= -64n && dod <= 63n) {
      // '10' + 7 bits (symmetric range [-64, 63])
      writer.writeBit(true)
      writer.writeBit(false)
      // Use zigzag encoding for clean symmetric handling
      const zigzag = dod >= 0n ? dod * 2n : -dod * 2n - 1n
      writer.writeBits(zigzag, 7)
    } else if (dod >= -256n && dod <= 255n) {
      // '110' + 9 bits (symmetric range [-256, 255])
      writer.writeBit(true)
      writer.writeBit(true)
      writer.writeBit(false)
      const zigzag = dod >= 0n ? dod * 2n : -dod * 2n - 1n
      writer.writeBits(zigzag, 9)
    } else if (dod >= -2048n && dod <= 2047n) {
      // '1110' + 12 bits (symmetric range [-2048, 2047])
      writer.writeBit(true)
      writer.writeBit(true)
      writer.writeBit(true)
      writer.writeBit(false)
      const zigzag = dod >= 0n ? dod * 2n : -dod * 2n - 1n
      writer.writeBits(zigzag, 12)
    } else {
      // '1111' + 64 bits for large deltas
      writer.writeBit(true)
      writer.writeBit(true)
      writer.writeBit(true)
      writer.writeBit(true)
      // Zigzag encode for signed
      const zigzag = dod >= 0n ? dod * 2n : -dod * 2n - 1n
      writer.writeBits(zigzag, 64)
    }
  }

  private readDeltaOfDelta(reader: BitReader): bigint {
    if (!reader.readBit()) {
      return 0n
    }

    if (!reader.readBit()) {
      // 7 bits zigzag
      const zigzag = reader.readBits(7)
      return (zigzag >> 1n) ^ -(zigzag & 1n)
    }

    if (!reader.readBit()) {
      // 9 bits zigzag
      const zigzag = reader.readBits(9)
      return (zigzag >> 1n) ^ -(zigzag & 1n)
    }

    if (!reader.readBit()) {
      // 12 bits zigzag
      const zigzag = reader.readBits(12)
      return (zigzag >> 1n) ^ -(zigzag & 1n)
    }

    // 64 bits zigzag
    const zigzag = reader.readBits(64)
    return (zigzag >> 1n) ^ -(zigzag & 1n)
  }

  private bitLength(value: bigint): number {
    if (value === 0n) return 1
    let bits = 0
    let v = value
    while (v > 0n) {
      bits++
      v >>= 1n
    }
    return bits
  }
}

// ============================================================================
// Run-Length Encoding
// ============================================================================

/**
 * Run-length encoding for repeated values
 */
class RLECodec {
  encode(values: number[]): Uint8Array {
    if (values.length === 0) {
      return new Uint8Array([0, 0, 0, 0])
    }

    const runs: Array<{ value: number; count: number }> = []
    let currentValue = values[0]
    let currentCount = 1

    for (let i = 1; i < values.length; i++) {
      if (values[i] === currentValue) {
        currentCount++
      } else {
        runs.push({ value: currentValue, count: currentCount })
        currentValue = values[i]
        currentCount = 1
      }
    }
    runs.push({ value: currentValue, count: currentCount })

    // Encode: [length 4B][numRuns 4B][run1Value 8B][run1Count 4B]...
    const output = new Uint8Array(4 + 4 + runs.length * 12)
    const view = new DataView(output.buffer)

    view.setUint32(0, values.length, true) // Original length
    view.setUint32(4, runs.length, true) // Number of runs

    let offset = 8
    for (const run of runs) {
      view.setFloat64(offset, run.value, true)
      view.setUint32(offset + 8, run.count, true)
      offset += 12
    }

    return output
  }

  decode(data: Uint8Array): number[] {
    // Validate minimum buffer size for header
    if (data.length < 4) {
      if (data.length === 0) return []
      throw new Error('RLE decode error: Buffer too small - expected at least 4 bytes for header')
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const originalLength = view.getUint32(0, true)

    if (originalLength === 0) return []

    // Validate buffer has enough data for header (4 bytes) + numRuns (4 bytes)
    if (data.length < 8) {
      throw new Error('RLE decode error: Buffer truncated - insufficient data for run count')
    }

    // Sanity check: prevent unreasonable length values that could cause memory issues
    if (originalLength > 100_000_000) {
      throw new Error(`RLE decode error: Invalid original length ${originalLength} - exceeds maximum allowed (100M values)`)
    }

    const numRuns = view.getUint32(4, true)

    // Sanity check: number of runs should be reasonable
    if (numRuns > 100_000_000) {
      throw new Error(`RLE decode error: Invalid number of runs ${numRuns} - exceeds maximum allowed (100M runs)`)
    }

    // Validate buffer has enough data for all runs (each run is 12 bytes: 8B value + 4B count)
    const expectedDataSize = 8 + numRuns * 12
    if (data.length < expectedDataSize) {
      throw new Error(`RLE decode error: Buffer truncated - expected ${expectedDataSize} bytes for ${numRuns} runs, got ${data.length}`)
    }

    const values: number[] = []

    let offset = 8
    let totalCount = 0
    for (let i = 0; i < numRuns; i++) {
      const value = view.getFloat64(offset, true)
      const count = view.getUint32(offset + 8, true)
      offset += 12

      // Validate individual run count
      if (count > 100_000_000) {
        throw new Error(`RLE decode error: Invalid run count ${count} at run ${i} - exceeds maximum allowed`)
      }

      totalCount += count
      // Check for overflow or mismatch
      if (totalCount > originalLength) {
        throw new Error(`RLE decode error: Run data exceeds declared original length (${totalCount} > ${originalLength})`)
      }

      for (let j = 0; j < count; j++) {
        values.push(value)
      }
    }

    return values
  }
}

// ============================================================================
// ZSTD-like Compression (using simple LZ77 + Huffman-like approach)
// ============================================================================

/**
 * General-purpose compression using deflate-like algorithm
 */
class ZstdCodec {
  encode(values: number[]): Uint8Array {
    if (values.length === 0) {
      return new Uint8Array([0, 0, 0, 0])
    }

    // Convert values to bytes
    const rawBytes = new Uint8Array(values.length * 8)
    const view = new DataView(rawBytes.buffer)
    for (let i = 0; i < values.length; i++) {
      view.setFloat64(i * 8, values[i], true)
    }

    // Simple compression: store raw with header
    // Format: [length 4B][compressedLength 4B][compressed data]
    const compressed = this.compress(rawBytes)

    const output = new Uint8Array(8 + compressed.length)
    const outView = new DataView(output.buffer)
    outView.setUint32(0, values.length, true)
    outView.setUint32(4, compressed.length, true)
    output.set(compressed, 8)

    return output
  }

  decode(data: Uint8Array): number[] {
    // Validate minimum buffer size for length field
    if (data.length < 4) {
      if (data.length === 0) return []
      throw new Error('ZSTD decode error: Buffer too small - expected at least 4 bytes for header')
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const length = view.getUint32(0, true)

    // Empty array case - encoder outputs only 4 bytes with length=0
    if (length === 0) return []

    // For non-empty data, we need the full header (8 bytes)
    if (data.length < 8) {
      throw new Error('ZSTD decode error: Buffer truncated - insufficient data for compressed length field')
    }

    // Sanity check: prevent unreasonable length values that could cause memory issues
    if (length > 100_000_000) {
      throw new Error(`ZSTD decode error: Invalid length ${length} - exceeds maximum allowed (100M values)`)
    }

    const compressedLength = view.getUint32(4, true)

    // Validate compressed length is reasonable
    if (compressedLength > data.length - 8) {
      throw new Error(`ZSTD decode error: Buffer truncated - compressed length ${compressedLength} exceeds available data ${data.length - 8}`)
    }

    // Sanity check: compressed data should not claim to be larger than possible
    if (compressedLength > 1_000_000_000) {
      throw new Error(`ZSTD decode error: Invalid compressed length ${compressedLength} - exceeds maximum allowed`)
    }

    const compressed = data.slice(8, 8 + compressedLength)

    const decompressed = this.decompress(compressed, length * 8)

    // Validate decompressed data is correct size
    if (decompressed.length < length * 8) {
      throw new Error(`ZSTD decode error: Decompressed data size mismatch - expected ${length * 8} bytes, got ${decompressed.length}`)
    }

    const decompView = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength)

    const values: number[] = []
    for (let i = 0; i < length; i++) {
      values.push(decompView.getFloat64(i * 8, true))
    }

    return values
  }

  private compress(data: Uint8Array): Uint8Array {
    // Simple RLE-like compression for byte sequences
    const output: number[] = []
    let i = 0

    while (i < data.length) {
      // Look for runs of identical bytes
      let runLength = 1
      while (i + runLength < data.length && data[i + runLength] === data[i] && runLength < 127) {
        runLength++
      }

      if (runLength >= 4) {
        // Encode run: [0x80 | length, value]
        output.push(0x80 | runLength)
        output.push(data[i])
        i += runLength
      } else {
        // Find literal run
        const literalStart = i
        let literalLength = 0

        while (i < data.length && literalLength < 127) {
          // Check if next bytes form a run worth encoding
          let nextRunLength = 1
          while (
            i + nextRunLength < data.length &&
            data[i + nextRunLength] === data[i] &&
            nextRunLength < 127
          ) {
            nextRunLength++
          }

          if (nextRunLength >= 4) break

          literalLength++
          i++
        }

        if (literalLength > 0) {
          output.push(literalLength)
          for (let j = 0; j < literalLength; j++) {
            output.push(data[literalStart + j])
          }
        }
      }
    }

    return new Uint8Array(output)
  }

  private decompress(data: Uint8Array, expectedLength: number): Uint8Array {
    const output = new Uint8Array(expectedLength)
    let outPos = 0
    let inPos = 0

    while (inPos < data.length && outPos < expectedLength) {
      const header = data[inPos++]

      if (header & 0x80) {
        // Run
        const length = header & 0x7f
        const value = data[inPos++]
        for (let i = 0; i < length && outPos < expectedLength; i++) {
          output[outPos++] = value
        }
      } else {
        // Literals
        const length = header
        for (let i = 0; i < length && inPos < data.length && outPos < expectedLength; i++) {
          output[outPos++] = data[inPos++]
        }
      }
    }

    return output
  }
}

// ============================================================================
// Helper functions for large arrays (avoid stack overflow)
// ============================================================================

function arrayMin(values: number[]): number {
  if (values.length === 0) return Infinity
  let min = values[0]
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) min = values[i]
  }
  return min
}

function arrayMax(values: number[]): number {
  if (values.length === 0) return -Infinity
  let max = values[0]
  for (let i = 1; i < values.length; i++) {
    if (values[i] > max) max = values[i]
  }
  return max
}

function arraySum(values: number[]): number {
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
  }
  return sum
}

// ============================================================================
// Column Store Implementation
// ============================================================================

interface ColumnInfo {
  type: ColumnType
  data: unknown[]
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a column type is numeric (can be aggregated)
 */
function isNumericColumnType(type: ColumnType): type is 'int64' | 'float64' | 'timestamp' {
  return type === 'int64' || type === 'float64' || type === 'timestamp'
}

/**
 * Check if a column type is comparable (supports ordering operators)
 */
function isComparableColumnType(type: ColumnType): type is 'int64' | 'float64' | 'timestamp' | 'string' {
  return type === 'int64' || type === 'float64' || type === 'timestamp' || type === 'string'
}

/**
 * Check if a column type supports bloom filter/HLL operations
 */
function isHashableColumnType(type: ColumnType): type is 'int64' | 'float64' | 'string' | 'timestamp' {
  return type === 'int64' || type === 'float64' || type === 'string' || type === 'timestamp'
}

/**
 * Runtime check that a value is a number
 */
function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

/**
 * Runtime check that a value is a string
 */
function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Runtime check that a value is number or string (for bloom filter/HLL)
 */
function isNumberOrString(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}

/**
 * Runtime check that a value is an array
 */
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Runtime check that a value is a [number, number] tuple
 */
function isNumberTuple(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && isNumber(value[0]) && isNumber(value[1])
}

class ColumnStoreImpl implements TypedColumnStore {
  private columns: Map<string, ColumnInfo> = new Map()

  private gorillaCodec = new GorillaCodec()
  private deltaCodec = new DeltaCodec()
  private rleCodec = new RLECodec()
  private zstdCodec = new ZstdCodec()

  // Compression codecs
  encode(values: number[], codec: 'gorilla' | 'delta' | 'rle' | 'zstd'): Uint8Array {
    switch (codec) {
      case 'gorilla':
        return this.gorillaCodec.encode(values)
      case 'delta':
        return this.deltaCodec.encode(values)
      case 'rle':
        return this.rleCodec.encode(values)
      case 'zstd':
        return this.zstdCodec.encode(values)
      default:
        throw new Error(`Unknown codec: ${codec}`)
    }
  }

  decode(data: Uint8Array, codec: string): number[] {
    switch (codec) {
      case 'gorilla':
        return this.gorillaCodec.decode(data)
      case 'delta':
        return this.deltaCodec.decode(data)
      case 'rle':
        return this.rleCodec.decode(data)
      case 'zstd':
        return this.zstdCodec.decode(data)
      default:
        throw new Error(`Unknown codec: ${codec}`)
    }
  }

  // Column operations
  addColumn(name: string, type: ColumnType): void {
    if (this.columns.has(name)) {
      throw new Error(`Column '${name}' already exists`)
    }
    this.columns.set(name, { type, data: [] })
  }

  append(column: string, values: unknown[]): void {
    const col = this.columns.get(column)
    if (!col) {
      throw new Error(`Column '${column}' does not exist`)
    }

    // Validate type compatibility
    for (const value of values) {
      if (!this.isValidType(value, col.type)) {
        throw new Error(`Invalid value type for column '${column}' (expected ${col.type})`)
      }
    }

    // Use push.apply in chunks to avoid stack overflow for large arrays
    const CHUNK_SIZE = 10000
    for (let i = 0; i < values.length; i += CHUNK_SIZE) {
      const chunk = values.slice(i, i + CHUNK_SIZE)
      col.data.push(...chunk)
    }
  }

  project(columns: string[]): ColumnBatch {
    const result = new Map<string, unknown[]>()
    let rowCount = 0

    for (const colName of columns) {
      const col = this.columns.get(colName)
      if (!col) {
        throw new Error(`Column '${colName}' does not exist`)
      }
      result.set(colName, [...col.data])
      rowCount = col.data.length
    }

    return { columns: result, rowCount }
  }

  filter(predicate: Predicate): ColumnBatch {
    const col = this.columns.get(predicate.column)
    if (!col) {
      throw new Error(`Column '${predicate.column}' does not exist`)
    }

    // Find matching row indices
    const matchingIndices: number[] = []
    for (let i = 0; i < col.data.length; i++) {
      if (this.evaluatePredicate(col.data[i], predicate, col.type)) {
        matchingIndices.push(i)
      }
    }

    // Project all columns at matching indices
    const result = new Map<string, unknown[]>()
    for (const [colName, colInfo] of this.columns) {
      const filtered = matchingIndices.map((i) => colInfo.data[i])
      result.set(colName, filtered)
    }

    return { columns: result, rowCount: matchingIndices.length }
  }

  aggregate(column: string, fn: AggregateFunction): number {
    const col = this.columns.get(column)
    if (!col) {
      throw new Error(`Column '${column}' does not exist`)
    }

    // Validate that column type is numeric before aggregation
    if (!isNumericColumnType(col.type)) {
      throw new Error(`Cannot aggregate non-numeric column '${column}' (type: ${col.type})`)
    }

    // Now we know the column contains numbers, validate at runtime for safety
    const values: number[] = []
    for (const value of col.data) {
      if (!isNumber(value)) {
        throw new Error(`Invalid value in numeric column '${column}': expected number, got ${typeof value}`)
      }
      values.push(value)
    }

    switch (fn) {
      case 'count':
        return values.length

      case 'sum':
        return arraySum(values)

      case 'min':
        return arrayMin(values)

      case 'max':
        return arrayMax(values)

      case 'avg':
        if (values.length === 0) return NaN
        return arraySum(values) / values.length

      default:
        throw new Error(`Unknown aggregate function: ${fn}`)
    }
  }

  // Statistics
  minMax(column: string): { min: number; max: number } {
    const col = this.columns.get(column)
    if (!col) {
      throw new Error(`Column '${column}' does not exist`)
    }

    // Validate that column type is numeric
    if (!isNumericColumnType(col.type)) {
      throw new Error(`Cannot compute minMax on non-numeric column '${column}' (type: ${col.type})`)
    }

    if (col.data.length === 0) {
      throw new Error(`Column '${column}' is empty`)
    }

    // Validate and extract numeric values
    const values: number[] = []
    for (const value of col.data) {
      if (!isNumber(value)) {
        throw new Error(`Invalid value in numeric column '${column}': expected number, got ${typeof value}`)
      }
      values.push(value)
    }

    return {
      min: arrayMin(values),
      max: arrayMax(values),
    }
  }

  distinctCount(column: string): number {
    const col = this.columns.get(column)
    if (!col) {
      throw new Error(`Column '${column}' does not exist`)
    }

    // Validate that column type supports hashing
    if (!isHashableColumnType(col.type)) {
      throw new Error(`Cannot compute distinctCount on column '${column}' (type: ${col.type})`)
    }

    const values = col.data

    if (values.length === 0) return 0

    // For small datasets, use exact count
    if (values.length < 10000) {
      return new Set(values.map((v) => String(v))).size
    }

    // For large datasets, use HyperLogLog
    const hll = new HyperLogLog(14)
    for (const value of values) {
      // Validate each value at runtime
      if (!isNumberOrString(value)) {
        throw new Error(`Invalid value in column '${column}': expected number or string, got ${typeof value}`)
      }
      hll.add(value)
    }

    return Math.round(hll.estimate())
  }

  bloomFilter(column: string): BloomFilter {
    const col = this.columns.get(column)
    if (!col) {
      throw new Error(`Column '${column}' does not exist`)
    }

    // Validate that column type supports hashing
    if (!isHashableColumnType(col.type)) {
      throw new Error(`Cannot create bloom filter for column '${column}' (type: ${col.type})`)
    }

    // Create bloom filter with very low FPR for safety
    const bloom = new BloomFilterImpl(Math.max(col.data.length, 100), 0.005)

    for (const value of col.data) {
      // Validate each value at runtime
      if (!isNumberOrString(value)) {
        throw new Error(`Invalid value in column '${column}': expected number or string, got ${typeof value}`)
      }
      bloom.add(value)
    }

    return bloom
  }

  // Helper methods
  private isValidType(value: unknown, type: ColumnType): boolean {
    switch (type) {
      case 'int64':
      case 'float64':
      case 'timestamp':
        return typeof value === 'number'
      case 'string':
        return typeof value === 'string'
      case 'boolean':
        return typeof value === 'boolean'
      default:
        return false
    }
  }

  private evaluatePredicate(value: unknown, predicate: Predicate, columnType: ColumnType): boolean {
    const { op, value: predicateValue } = predicate

    switch (op) {
      case '=':
        return value === predicateValue
      case '!=':
        return value !== predicateValue
      case '>':
      case '<':
      case '>=':
      case '<=': {
        // Validate that both value and predicate are comparable
        if (!isComparableColumnType(columnType)) {
          throw new Error(`Cannot use comparison operator '${op}' on non-comparable column type '${columnType}'`)
        }

        // For numeric types, validate both operands are numbers
        if (columnType === 'int64' || columnType === 'float64' || columnType === 'timestamp') {
          if (!isNumber(value)) {
            throw new Error(`Invalid column value for comparison: expected number, got ${typeof value}`)
          }
          if (!isNumber(predicateValue)) {
            throw new Error(`Invalid predicate value for comparison: expected number, got ${typeof predicateValue}`)
          }

          switch (op) {
            case '>': return value > predicateValue
            case '<': return value < predicateValue
            case '>=': return value >= predicateValue
            case '<=': return value <= predicateValue
          }
        }

        // For string type, validate both operands are strings
        if (columnType === 'string') {
          if (!isString(value)) {
            throw new Error(`Invalid column value for comparison: expected string, got ${typeof value}`)
          }
          if (!isString(predicateValue)) {
            throw new Error(`Invalid predicate value for comparison: expected string, got ${typeof predicateValue}`)
          }

          switch (op) {
            case '>': return value > predicateValue
            case '<': return value < predicateValue
            case '>=': return value >= predicateValue
            case '<=': return value <= predicateValue
          }
        }

        return false
      }
      case 'in': {
        // Validate that predicateValue is an array
        if (!isArray(predicateValue)) {
          throw new Error(`Invalid predicate value for 'in' operator: expected array, got ${typeof predicateValue}`)
        }
        return predicateValue.includes(value)
      }
      case 'between': {
        // Validate that column type is numeric
        if (columnType !== 'int64' && columnType !== 'float64' && columnType !== 'timestamp') {
          throw new Error(`Cannot use 'between' operator on non-numeric column type '${columnType}'`)
        }

        // Validate predicate value is [number, number] tuple
        if (!isNumberTuple(predicateValue)) {
          throw new Error(`Invalid predicate value for 'between' operator: expected [number, number], got ${typeof predicateValue}`)
        }

        // Validate column value is number
        if (!isNumber(value)) {
          throw new Error(`Invalid column value for 'between' comparison: expected number, got ${typeof value}`)
        }

        const [min, max] = predicateValue
        return value >= min && value <= max
      }
      default:
        return false
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new TypedColumnStore instance
 */
export function createColumnStore(): TypedColumnStore {
  return new ColumnStoreImpl()
}

// Re-export the TypedColumnStore class for type purposes
export { ColumnStoreImpl as TypedColumnStoreClass }

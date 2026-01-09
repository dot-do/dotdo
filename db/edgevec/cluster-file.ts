/**
 * Cluster File Format Parser
 *
 * Implements parsing and creation of CLST binary format files that store
 * PQ codes and vector IDs per cluster for static assets vector search.
 *
 * CLST File Format:
 * - Header (64 bytes): magic, version, flags, cluster_id, vector_count, M, id_type, has_metadata
 * - Vector IDs section: uint64 array or string offsets + string data
 * - PQ Codes section: interleaved uint8[M] per vector
 * - Metadata section (optional): compressed JSON/MessagePack
 *
 * @module db/edgevec/cluster-file
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** CLST magic number: 0x434C5354 ("CLST") */
export const CLST_MAGIC = 0x434c5354

/** Header size in bytes */
export const HEADER_SIZE = 64

/** ID type: uint64 */
export const ID_TYPE_UINT64 = 0

/** ID type: string with offset table */
export const ID_TYPE_STRING = 1

/** Supported version */
export const SUPPORTED_VERSION = 1

/** Flag: file has checksum */
export const FLAG_HAS_CHECKSUM = 0x0001

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed CLST header
 */
export interface ClusterHeader {
  /** Magic number */
  magic: number
  /** Magic as string */
  magicString: string
  /** Format version */
  version: number
  /** Header flags */
  flags: number
  /** Cluster ID */
  clusterId: number
  /** Number of vectors in cluster */
  vectorCount: number
  /** Number of PQ subspaces */
  M: number
  /** ID type (0 = uint64, 1 = string) */
  idType: number
  /** ID type as string */
  idTypeName: 'uint64' | 'string'
  /** Whether metadata is present */
  hasMetadata: boolean
}

/**
 * Parsed cluster file data
 */
export interface ClusterData {
  /** Parsed header */
  header: ClusterHeader
  /** Vector IDs (bigint for uint64, string for string type) */
  ids: Array<bigint | string>
  /** All PQ codes (flat array, M bytes per vector) */
  pqCodes: Uint8Array
  /** Whether metadata is present */
  hasMetadata: boolean
  /** Parsed metadata (if present) */
  metadata: Array<Record<string, unknown>> | null
}

/**
 * Entry for iteration
 */
export interface ClusterEntry {
  /** Vector ID */
  id: bigint | string
  /** PQ codes for this vector */
  codes: Uint8Array
  /** Metadata (if present) */
  metadata?: Record<string, unknown>
}

/**
 * Batch of entries
 */
export interface ClusterBatch {
  /** Vector IDs in batch */
  ids: Array<bigint | string>
  /** PQ codes (flat array) */
  codes: Uint8Array
}

/**
 * Slice result
 */
export interface ClusterSlice {
  /** Vector IDs in slice */
  ids: Array<bigint | string>
  /** PQ codes for slice */
  codes: Uint8Array
}

/**
 * Checksum validation result
 */
export interface ChecksumResult {
  /** Whether validation passed */
  valid: boolean
  /** Whether file has checksum */
  hasChecksum: boolean
  /** Error message if invalid */
  error?: string
}

/**
 * Options for ClusterFile constructor
 */
export interface ClusterFileOptions {
  /** Lazy loading mode - don't parse all data upfront */
  lazy?: boolean
}

/**
 * Options for createClusterFile
 */
export interface CreateClusterFileOptions {
  /** Cluster ID */
  clusterId: number
  /** Vector IDs */
  ids: Array<bigint | string>
  /** PQ codes per vector */
  pqCodes: Uint8Array[]
  /** Number of PQ subspaces */
  M: number
  /** ID type (auto-detected if not specified) */
  idType?: 'uint64' | 'string'
  /** Optional metadata per vector */
  metadata?: Array<Record<string, unknown>>
  /** Include checksum */
  includeChecksum?: boolean
}

// ============================================================================
// HEADER PARSING
// ============================================================================

/**
 * Parse only the 64-byte CLST header
 */
export function parseClusterHeader(buffer: ArrayBuffer): ClusterHeader {
  if (buffer.byteLength < HEADER_SIZE) {
    throw new Error('Invalid cluster file: header truncated (too small)')
  }

  const view = new DataView(buffer)

  const magic = view.getUint32(0, true)
  if (magic !== CLST_MAGIC) {
    throw new Error(`Invalid cluster file: invalid magic number 0x${magic.toString(16)}`)
  }

  const version = view.getUint16(4, true)
  if (version > SUPPORTED_VERSION) {
    throw new Error(`Unsupported cluster file version: ${version}`)
  }

  const flags = view.getUint16(6, true)
  const clusterId = view.getUint32(8, true)
  const vectorCount = view.getUint32(12, true)
  const M = view.getUint8(16)
  const idType = view.getUint8(17)
  const hasMetadataByte = view.getUint8(18)

  if (M === 0) {
    throw new Error('Invalid cluster file: invalid M (subspaces) value of 0')
  }

  // Magic is stored as little-endian 32-bit, so bytes are reversed
  // 0x434C5354 = 'C' 'L' 'S' 'T' but stored as 'T' 'S' 'L' 'C' in memory
  // Convert from the numeric value to get correct string
  const magicString = String.fromCharCode(
    (magic >> 24) & 0xff,
    (magic >> 16) & 0xff,
    (magic >> 8) & 0xff,
    magic & 0xff
  )

  return {
    magic,
    magicString,
    version,
    flags,
    clusterId,
    vectorCount,
    M,
    idType,
    idTypeName: idType === ID_TYPE_STRING ? 'string' : 'uint64',
    hasMetadata: hasMetadataByte !== 0,
  }
}

// ============================================================================
// FULL FILE PARSING
// ============================================================================

/**
 * Parse a complete CLST cluster file
 */
export function parseClusterFile(buffer: ArrayBuffer): ClusterData {
  const header = parseClusterHeader(buffer)
  const view = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)

  const { vectorCount, M, idType, hasMetadata } = header

  // Calculate section offsets
  let offset = HEADER_SIZE
  let idsSectionSize: number
  let ids: Array<bigint | string>

  if (idType === ID_TYPE_UINT64) {
    // uint64 IDs: vectorCount * 8 bytes
    idsSectionSize = vectorCount * 8
    const expectedSize = HEADER_SIZE + idsSectionSize + vectorCount * M
    if (buffer.byteLength < expectedSize) {
      throw new Error(`Invalid cluster file: count mismatch or truncated (expected ${expectedSize}, got ${buffer.byteLength})`)
    }

    ids = []
    for (let i = 0; i < vectorCount; i++) {
      ids.push(view.getBigUint64(offset, true))
      offset += 8
    }
  } else {
    // String IDs: offset table + string data
    const offsetTableSize = (vectorCount + 1) * 4
    if (buffer.byteLength < HEADER_SIZE + offsetTableSize) {
      throw new Error('Invalid cluster file: truncated string offset table')
    }

    // Read offset table
    const stringOffsets: number[] = []
    for (let i = 0; i <= vectorCount; i++) {
      stringOffsets.push(view.getUint32(offset, true))
      offset += 4
    }

    // Read strings
    const stringDataStart = offset
    const decoder = new TextDecoder()
    ids = []

    for (let i = 0; i < vectorCount; i++) {
      const start = stringDataStart + stringOffsets[i]
      const end = stringDataStart + stringOffsets[i + 1]
      const stringBytes = uint8View.slice(start, end)
      ids.push(decoder.decode(stringBytes))
    }

    // Move offset past string data
    offset = stringDataStart + stringOffsets[vectorCount]
    idsSectionSize = offsetTableSize + stringOffsets[vectorCount]
  }

  // Parse PQ codes section
  const pqCodesSize = vectorCount * M
  const pqCodesStart = offset

  if (buffer.byteLength < pqCodesStart + pqCodesSize) {
    throw new Error(`Invalid cluster file: truncated PQ codes section`)
  }

  // Create a view for PQ codes
  const pqCodes = new Uint8Array(buffer, pqCodesStart, pqCodesSize)
  offset += pqCodesSize

  // Parse metadata section (if present)
  let metadata: Array<Record<string, unknown>> | null = null

  if (hasMetadata && vectorCount > 0) {
    // Metadata format: offset table + JSON data
    const metaOffsetTableSize = (vectorCount + 1) * 4

    if (buffer.byteLength >= offset + metaOffsetTableSize) {
      // Read metadata offsets
      const metaOffsets: number[] = []
      for (let i = 0; i <= vectorCount; i++) {
        metaOffsets.push(view.getUint32(offset, true))
        offset += 4
      }

      // Read metadata JSON
      const metaDataStart = offset

      // The mock format may have metadata as a single JSON array, not individual entries
      // Try to find valid JSON by reading all remaining data
      const remainingData = uint8View.slice(metaDataStart)
      const decoder = new TextDecoder()

      // First try: parse all remaining data as JSON array
      try {
        const fullJson = decoder.decode(remainingData)
        const parsed = JSON.parse(fullJson)
        if (Array.isArray(parsed)) {
          metadata = parsed
        }
      } catch {
        // Second try: use offset-based length
        const metaDataLength = metaOffsets[vectorCount]
        if (buffer.byteLength >= metaDataStart + metaDataLength) {
          const metaBytes = uint8View.slice(metaDataStart, metaDataStart + metaDataLength)
          const metaJson = decoder.decode(metaBytes)

          try {
            metadata = JSON.parse(metaJson)
          } catch {
            // Fallback: parse individual entries
            metadata = []
            for (let i = 0; i < vectorCount; i++) {
              const start = metaOffsets[i]
              const end = metaOffsets[i + 1]
              if (start < end && end <= metaDataLength) {
                try {
                  const entryBytes = metaBytes.slice(start, end)
                  const entryJson = decoder.decode(entryBytes)
                  metadata.push(JSON.parse(entryJson))
                } catch {
                  metadata.push({})
                }
              } else {
                metadata.push({})
              }
            }
          }
        }
      }
    }
  }

  return {
    header,
    ids,
    pqCodes,
    hasMetadata,
    metadata,
  }
}

// ============================================================================
// CHECKSUM VALIDATION
// ============================================================================

/**
 * Calculate checksum for buffer (simple rotating XOR)
 */
function calculateChecksum(data: Uint8Array): number {
  let checksum = 0
  for (let i = 0; i < data.length; i++) {
    checksum ^= data[i]
    checksum = ((checksum << 1) | (checksum >>> 31)) >>> 0
  }
  return checksum
}

/**
 * Validate cluster file checksum
 */
export function validateClusterChecksum(buffer: ArrayBuffer): ChecksumResult {
  // Check minimum size
  if (buffer.byteLength < HEADER_SIZE) {
    return {
      valid: false,
      hasChecksum: false,
      error: 'Invalid cluster file: truncated header',
    }
  }

  const view = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)

  // Validate magic
  const magic = view.getUint32(0, true)
  if (magic !== CLST_MAGIC) {
    return {
      valid: false,
      hasChecksum: false,
      error: `Invalid cluster file: invalid magic/format 0x${magic.toString(16)}`,
    }
  }

  // Check flags for checksum presence
  const flags = view.getUint16(6, true)
  const hasChecksum = (flags & FLAG_HAS_CHECKSUM) !== 0

  if (!hasChecksum) {
    // No checksum to validate
    return {
      valid: true,
      hasChecksum: false,
    }
  }

  // Calculate expected file size (header + ids + pq codes + checksum)
  const vectorCount = view.getUint32(12, true)
  const M = view.getUint8(16)
  const idType = view.getUint8(17)

  // Calculate IDs section size
  let idsSectionSize: number
  if (idType === ID_TYPE_STRING) {
    // For string IDs, we need to read the offset table to know the size
    const offsetTableSize = (vectorCount + 1) * 4
    if (buffer.byteLength < HEADER_SIZE + offsetTableSize) {
      return {
        valid: false,
        hasChecksum: true,
        error: 'Invalid cluster file: truncated/incomplete - string offset table missing',
      }
    }
    const lastStringOffset = view.getUint32(HEADER_SIZE + vectorCount * 4, true)
    idsSectionSize = offsetTableSize + lastStringOffset
  } else {
    idsSectionSize = vectorCount * 8
  }

  const pqCodesSectionSize = vectorCount * M
  const expectedDataSize = HEADER_SIZE + idsSectionSize + pqCodesSectionSize
  const expectedTotalSize = expectedDataSize + 4 // + checksum

  // Check if file is truncated
  if (buffer.byteLength < expectedTotalSize) {
    return {
      valid: false,
      hasChecksum: true,
      error: `Invalid cluster file: truncated/incomplete (expected ${expectedTotalSize} bytes, got ${buffer.byteLength})`,
    }
  }

  // Calculate checksum over the data portion (excluding checksum bytes at end)
  const dataView = uint8View.slice(0, expectedDataSize)
  const expectedChecksum = calculateChecksum(dataView)

  // Read stored checksum at expected position
  const storedChecksum = view.getUint32(expectedDataSize, true)

  if (expectedChecksum !== storedChecksum) {
    return {
      valid: false,
      hasChecksum: true,
      error: `Checksum mismatch: expected 0x${expectedChecksum.toString(16)}, got 0x${storedChecksum.toString(16)}`,
    }
  }

  return {
    valid: true,
    hasChecksum: true,
  }
}

// ============================================================================
// CLUSTER FILE CREATION
// ============================================================================

/**
 * Create a new cluster file from data
 */
export function createClusterFile(options: CreateClusterFileOptions): ArrayBuffer {
  const {
    clusterId,
    ids,
    pqCodes,
    M,
    metadata,
    includeChecksum = false,
  } = options

  const vectorCount = ids.length

  // Determine ID type
  let idType: number
  if (options.idType === 'string') {
    idType = ID_TYPE_STRING
  } else if (options.idType === 'uint64') {
    idType = ID_TYPE_UINT64
  } else {
    // Auto-detect
    idType = ids.length > 0 && typeof ids[0] === 'string' ? ID_TYPE_STRING : ID_TYPE_UINT64
  }

  const hasMetadata = metadata && metadata.length > 0

  // Calculate IDs section size
  let idsSectionSize: number
  let stringBuffers: Uint8Array[] | null = null
  let stringOffsets: number[] | null = null

  if (idType === ID_TYPE_STRING) {
    const encoder = new TextEncoder()
    stringBuffers = (ids as string[]).map((id) => encoder.encode(id))
    stringOffsets = [0]
    let stringOffset = 0
    for (const buf of stringBuffers) {
      stringOffset += buf.length
      stringOffsets.push(stringOffset)
    }
    idsSectionSize = (vectorCount + 1) * 4 + stringOffset
  } else {
    idsSectionSize = vectorCount * 8
  }

  // Calculate PQ codes section size
  const pqCodesSectionSize = vectorCount * M

  // Calculate metadata section size
  let metadataSectionSize = 0
  let metadataBuffer: Uint8Array | null = null
  let metadataOffsets: number[] | null = null

  if (hasMetadata) {
    const encoder = new TextEncoder()
    const metadataJson = JSON.stringify(metadata)
    metadataBuffer = encoder.encode(metadataJson)

    // Simple offset distribution for now
    metadataOffsets = []
    const perVectorSize = Math.floor(metadataBuffer.length / vectorCount)
    for (let i = 0; i <= vectorCount; i++) {
      metadataOffsets.push(i * perVectorSize)
    }

    metadataSectionSize = (vectorCount + 1) * 4 + metadataBuffer.length
  }

  // Calculate total size
  let totalSize = HEADER_SIZE + idsSectionSize + pqCodesSectionSize + metadataSectionSize
  if (includeChecksum) {
    totalSize += 4
  }

  // Create buffer
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const uint8View = new Uint8Array(buffer)

  // Write header
  const flags = includeChecksum ? FLAG_HAS_CHECKSUM : 0
  view.setUint32(0, CLST_MAGIC, true)
  view.setUint16(4, SUPPORTED_VERSION, true)
  view.setUint16(6, flags, true)
  view.setUint32(8, clusterId, true)
  view.setUint32(12, vectorCount, true)
  view.setUint8(16, M)
  view.setUint8(17, idType)
  view.setUint8(18, hasMetadata ? 1 : 0)

  // Write IDs section
  let offset = HEADER_SIZE

  if (idType === ID_TYPE_STRING) {
    // Write string offsets
    for (const stringOffset of stringOffsets!) {
      view.setUint32(offset, stringOffset, true)
      offset += 4
    }

    // Write string data
    for (const buf of stringBuffers!) {
      uint8View.set(buf, offset)
      offset += buf.length
    }
  } else {
    // Write uint64 IDs
    for (const id of ids) {
      const bigintId = typeof id === 'bigint' ? id : BigInt(id as string)
      view.setBigUint64(offset, bigintId, true)
      offset += 8
    }
  }

  // Write PQ codes section
  for (let i = 0; i < vectorCount; i++) {
    uint8View.set(pqCodes[i], offset)
    offset += M
  }

  // Write metadata section
  if (hasMetadata && metadataBuffer && metadataOffsets) {
    // Write offset table
    for (const metaOffset of metadataOffsets) {
      view.setUint32(offset, metaOffset, true)
      offset += 4
    }

    // Write metadata data
    uint8View.set(metadataBuffer, offset)
    offset += metadataBuffer.length
  }

  // Write checksum
  if (includeChecksum) {
    const dataLength = totalSize - 4
    const dataView = uint8View.slice(0, dataLength)
    const checksum = calculateChecksum(dataView)
    view.setUint32(dataLength, checksum, true)
  }

  return buffer
}

// ============================================================================
// CLUSTER FILE CLASS
// ============================================================================

/**
 * ClusterFile class for parsing and accessing CLST files
 */
export class ClusterFile implements Iterable<ClusterEntry> {
  private readonly buffer: ArrayBuffer
  private readonly view: DataView
  private readonly uint8View: Uint8Array
  private readonly _header: ClusterHeader
  private readonly _lazy: boolean

  // Cached parsed data (for non-lazy mode)
  private _ids: Array<bigint | string> | null = null
  private _pqCodes: Uint8Array | null = null
  private _metadata: Array<Record<string, unknown>> | null = null

  // Section offsets (calculated on demand)
  private _idsSectionOffset: number = HEADER_SIZE
  private _pqCodesSectionOffset: number = 0
  private _metadataSectionOffset: number = 0

  constructor(buffer: ArrayBuffer, options: ClusterFileOptions = {}) {
    this.buffer = buffer
    this.view = new DataView(buffer)
    this.uint8View = new Uint8Array(buffer)
    this._lazy = options.lazy ?? false
    this._header = parseClusterHeader(buffer)

    // Calculate section offsets
    this._calculateOffsets()

    // Parse everything upfront if not lazy
    if (!this._lazy) {
      const parsed = parseClusterFile(buffer)
      this._ids = parsed.ids
      this._pqCodes = parsed.pqCodes
      this._metadata = parsed.metadata
    }
  }

  private _calculateOffsets(): void {
    const { vectorCount, idType, M, hasMetadata } = this._header

    this._idsSectionOffset = HEADER_SIZE

    if (idType === ID_TYPE_STRING) {
      // Need to read the offset table to find string data end
      const offsetTableSize = (vectorCount + 1) * 4
      if (vectorCount > 0) {
        const lastOffset = this.view.getUint32(HEADER_SIZE + vectorCount * 4, true)
        this._pqCodesSectionOffset = HEADER_SIZE + offsetTableSize + lastOffset
      } else {
        this._pqCodesSectionOffset = HEADER_SIZE + offsetTableSize
      }
    } else {
      this._pqCodesSectionOffset = HEADER_SIZE + vectorCount * 8
    }

    this._metadataSectionOffset = this._pqCodesSectionOffset + vectorCount * M
  }

  // ============================================================================
  // GETTERS
  // ============================================================================

  get header(): ClusterHeader {
    return this._header
  }

  get vectorCount(): number {
    return this._header.vectorCount
  }

  get clusterId(): number {
    return this._header.clusterId
  }

  get pqCodes(): Uint8Array {
    if (this._pqCodes) {
      return this._pqCodes
    }

    const { vectorCount, M } = this._header
    const size = vectorCount * M
    return new Uint8Array(this.buffer, this._pqCodesSectionOffset, size)
  }

  get ids(): Array<bigint | string> {
    if (this._ids) {
      return this._ids
    }

    // Lazy load IDs
    const { vectorCount, idType } = this._header

    if (idType === ID_TYPE_UINT64) {
      const ids: bigint[] = []
      let offset = HEADER_SIZE
      for (let i = 0; i < vectorCount; i++) {
        ids.push(this.view.getBigUint64(offset, true))
        offset += 8
      }
      return ids
    } else {
      // String IDs
      const offsetTableSize = (vectorCount + 1) * 4
      const stringOffsets: number[] = []
      let offset = HEADER_SIZE

      for (let i = 0; i <= vectorCount; i++) {
        stringOffsets.push(this.view.getUint32(offset, true))
        offset += 4
      }

      const stringDataStart = offset
      const decoder = new TextDecoder()
      const ids: string[] = []

      for (let i = 0; i < vectorCount; i++) {
        const start = stringDataStart + stringOffsets[i]
        const end = stringDataStart + stringOffsets[i + 1]
        const stringBytes = this.uint8View.slice(start, end)
        ids.push(decoder.decode(stringBytes))
      }

      return ids
    }
  }

  // ============================================================================
  // SECTION OFFSET METHODS
  // ============================================================================

  getIdsSectionOffset(): number {
    return this._idsSectionOffset
  }

  getPQCodesSectionOffset(): number {
    return this._pqCodesSectionOffset
  }

  // ============================================================================
  // SIZE METHODS
  // ============================================================================

  getHeaderSize(): number {
    return HEADER_SIZE
  }

  getIdsSectionSize(): number {
    return this._pqCodesSectionOffset - HEADER_SIZE
  }

  getPQCodesSectionSize(): number {
    return this._header.vectorCount * this._header.M
  }

  getTotalSize(): number {
    return this.buffer.byteLength
  }

  // ============================================================================
  // RANDOM ACCESS METHODS
  // ============================================================================

  private _checkBounds(index: number): void {
    if (index < 0 || index >= this._header.vectorCount) {
      throw new Error(`Index ${index} out of bounds [0, ${this._header.vectorCount})`)
    }
  }

  /**
   * Get vector entry at index
   */
  at(index: number): ClusterEntry {
    this._checkBounds(index)

    return {
      id: this.getId(index),
      codes: this.getPQCodes(index),
      metadata: this.getMetadata(index) ?? undefined,
    }
  }

  /**
   * Get vector ID at index
   */
  getId(index: number): bigint | string {
    this._checkBounds(index)

    if (this._ids) {
      return this._ids[index]
    }

    const { idType } = this._header

    if (idType === ID_TYPE_UINT64) {
      const offset = HEADER_SIZE + index * 8
      return this.view.getBigUint64(offset, true)
    } else {
      // String ID - need to read offset table
      const offsetTableStart = HEADER_SIZE
      const startOffsetPos = offsetTableStart + index * 4
      const endOffsetPos = offsetTableStart + (index + 1) * 4

      const startOffset = this.view.getUint32(startOffsetPos, true)
      const endOffset = this.view.getUint32(endOffsetPos, true)

      const stringDataStart = HEADER_SIZE + (this._header.vectorCount + 1) * 4
      const start = stringDataStart + startOffset
      const end = stringDataStart + endOffset

      const decoder = new TextDecoder()
      return decoder.decode(this.uint8View.slice(start, end))
    }
  }

  /**
   * Get PQ codes for vector at index
   */
  getPQCodes(index: number): Uint8Array {
    this._checkBounds(index)

    const { M } = this._header
    const start = this._pqCodesSectionOffset + index * M
    return new Uint8Array(this.buffer, start, M)
  }

  /**
   * Get metadata for vector at index
   */
  getMetadata(index: number): Record<string, unknown> | null {
    this._checkBounds(index)

    if (!this._header.hasMetadata) {
      return null
    }

    // Check if we have cached metadata (non-lazy mode)
    if (this._metadata !== null) {
      // _metadata is an array - check if index exists
      if (index < this._metadata.length) {
        return this._metadata[index]
      }
      return null
    }

    // Lazy load metadata - we need to parse the whole metadata section
    // because the mock format stores it as a single JSON array
    const { vectorCount } = this._header
    const metaOffset = this._metadataSectionOffset

    if (this.buffer.byteLength <= metaOffset) {
      return null
    }

    // Read metadata offsets
    const offsetTableSize = (vectorCount + 1) * 4
    if (this.buffer.byteLength < metaOffset + offsetTableSize) {
      return null
    }

    // Read the last offset to get total metadata data length
    const metaDataLength = this.view.getUint32(metaOffset + vectorCount * 4, true)
    const metaDataStart = metaOffset + offsetTableSize

    if (this.buffer.byteLength < metaDataStart + metaDataLength) {
      return null
    }

    try {
      const decoder = new TextDecoder()
      const metaBytes = this.uint8View.slice(metaDataStart, metaDataStart + metaDataLength)
      const metaJson = decoder.decode(metaBytes)
      const parsedMetadata = JSON.parse(metaJson)

      // Cache for future access
      if (Array.isArray(parsedMetadata)) {
        this._metadata = parsedMetadata
        if (index < parsedMetadata.length) {
          return parsedMetadata[index]
        }
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Get a slice of vectors
   */
  slice(start: number, end: number): ClusterSlice {
    if (start < 0) start = 0
    if (end > this._header.vectorCount) end = this._header.vectorCount
    if (start >= end) {
      return { ids: [], codes: new Uint8Array(0) }
    }

    const count = end - start
    const ids: Array<bigint | string> = []

    for (let i = start; i < end; i++) {
      ids.push(this.getId(i))
    }

    const { M } = this._header
    const codesStart = this._pqCodesSectionOffset + start * M
    const codesLength = count * M
    const codes = new Uint8Array(this.buffer, codesStart, codesLength)

    return { ids, codes }
  }

  // ============================================================================
  // ITERATION
  // ============================================================================

  /**
   * Iterate over all entries
   */
  *[Symbol.iterator](): Iterator<ClusterEntry> {
    const { vectorCount } = this._header

    for (let i = 0; i < vectorCount; i++) {
      yield this.at(i)
    }
  }

  /**
   * Iterate in batches
   */
  *batches(batchSize: number): Generator<ClusterBatch> {
    const { vectorCount, M } = this._header

    for (let start = 0; start < vectorCount; start += batchSize) {
      const end = Math.min(start + batchSize, vectorCount)
      const count = end - start

      const ids: Array<bigint | string> = []
      for (let i = start; i < end; i++) {
        ids.push(this.getId(i))
      }

      const codesStart = this._pqCodesSectionOffset + start * M
      const codesLength = count * M
      const codes = new Uint8Array(this.buffer, codesStart, codesLength)

      yield { ids, codes }
    }
  }
}

// ============================================================================
// CLUSTER FILE ITERATOR (ASYNC)
// ============================================================================

/**
 * Options for ClusterFileIterator
 */
export interface ClusterFileIteratorOptions {
  /** Chunk size for chunked iteration */
  chunkSize?: number
}

/**
 * Async iterator for cluster files
 */
export class ClusterFileIterator implements AsyncIterable<ClusterEntry> {
  private readonly cluster: ClusterFile
  private readonly chunkSize: number

  constructor(buffer: ArrayBuffer, options: ClusterFileIteratorOptions = {}) {
    this.cluster = new ClusterFile(buffer, { lazy: true })
    this.chunkSize = options.chunkSize ?? 100
  }

  /**
   * Async iterate over all entries
   */
  async *[Symbol.asyncIterator](): AsyncIterator<ClusterEntry> {
    const { vectorCount } = this.cluster.header

    for (let i = 0; i < vectorCount; i++) {
      yield this.cluster.at(i)
    }
  }

  /**
   * Iterate in chunks
   */
  async *chunks(): AsyncGenerator<ClusterBatch> {
    for (const batch of this.cluster.batches(this.chunkSize)) {
      yield batch
    }
  }
}

// ============================================================================
// CLUSTER FILE PARSER (ALIAS)
// ============================================================================

/**
 * Parser class (alias for functional API)
 */
export class ClusterFileParser {
  static parseHeader(buffer: ArrayBuffer): ClusterHeader {
    return parseClusterHeader(buffer)
  }

  static parse(buffer: ArrayBuffer): ClusterData {
    return parseClusterFile(buffer)
  }

  static validate(buffer: ArrayBuffer): ChecksumResult {
    return validateClusterChecksum(buffer)
  }

  static create(options: CreateClusterFileOptions): ArrayBuffer {
    return createClusterFile(options)
  }
}

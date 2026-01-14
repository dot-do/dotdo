/**
 * Tar header parsing and creation
 *
 * Supports USTAR, PAX extended headers, and legacy formats
 */

import {
  TAR_BLOCK_SIZE,
  TYPE_FLAGS,
  type TarHeader,
  type TarEntryType,
  type PaxExtendedHeader,
} from './types'

const textDecoder = new TextDecoder('utf-8')
const textEncoder = new TextEncoder()

/**
 * Parse a tar header from a 512-byte block
 *
 * @param header - 512-byte header block
 * @returns Parsed header information
 */
export function parseTarHeader(header: Uint8Array): TarHeader {
  // Check for null block (end of archive)
  const isNullBlock = header.every((byte) => byte === 0)

  if (isNullBlock) {
    return {
      name: '',
      mode: 0,
      uid: 0,
      gid: 0,
      size: 0,
      mtime: new Date(0),
      type: 'unknown',
      linkname: '',
      format: 'unknown',
      version: '',
      uname: '',
      gname: '',
      devmajor: 0,
      devminor: 0,
      prefix: '',
      fullPath: '',
      checksumValid: false,
      isNullBlock: true,
    }
  }

  // Parse basic fields
  const name = parseString(header, 0, 100)
  const mode = parseOctal(header, 100, 8)
  const uid = parseOctal(header, 108, 8)
  const gid = parseOctal(header, 116, 8)
  const size = parseOctal(header, 124, 12)
  const mtime = new Date(parseOctal(header, 136, 12) * 1000)
  const checksum = parseOctal(header, 148, 8)
  const typeflag = header[156] ?? 0
  const linkname = parseString(header, 157, 100)

  // Detect format and parse USTAR-specific fields
  const magic = parseString(header, 257, 6)
  const version = parseString(header, 263, 2)

  let format: TarHeader['format'] = 'unknown'
  let uname = ''
  let gname = ''
  let devmajor = 0
  let devminor = 0
  let prefix = ''

  if (magic === 'ustar\0' || magic === 'ustar') {
    format = 'ustar'
    uname = parseString(header, 265, 32)
    gname = parseString(header, 297, 32)
    devmajor = parseOctal(header, 329, 8)
    devminor = parseOctal(header, 337, 8)
    prefix = parseString(header, 345, 155)
  } else if (magic.startsWith('ustar ') || magic === 'ustar ') {
    format = 'gnu'
    uname = parseString(header, 265, 32)
    gname = parseString(header, 297, 32)
    devmajor = parseOctal(header, 329, 8)
    devminor = parseOctal(header, 337, 8)
    prefix = parseString(header, 345, 155)
  } else if (name) {
    format = 'v7'
  }

  // Calculate checksum
  const checksumValid = validateChecksum(header, checksum)

  // Parse type
  const type = parseType(typeflag)

  // Build full path
  const fullPath = prefix ? `${prefix}/${name}` : name

  return {
    name,
    mode,
    uid,
    gid,
    size,
    mtime,
    type,
    linkname,
    format,
    version,
    uname,
    gname,
    devmajor,
    devminor,
    prefix,
    fullPath,
    checksumValid,
    isNullBlock: false,
  }
}

/**
 * Parse a null-terminated string from a buffer
 */
function parseString(buffer: Uint8Array, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length)
  const nullIndex = slice.indexOf(0)
  const end = nullIndex === -1 ? length : nullIndex
  return textDecoder.decode(slice.subarray(0, end))
}

/**
 * Parse an octal number from a buffer
 */
function parseOctal(buffer: Uint8Array, offset: number, length: number): number {
  const str = parseString(buffer, offset, length).trim()
  if (!str) return 0

  // Handle binary encoding for large numbers (PAX/GNU extension)
  const firstByte = buffer[offset]
  if (firstByte === 0x80) {
    // Binary big-endian
    let value = 0n
    for (let i = 1; i < length; i++) {
      const byte = buffer[offset + i]
      if (byte !== undefined) {
        value = (value << 8n) | BigInt(byte)
      }
    }
    return Number(value)
  }

  return parseInt(str, 8) || 0
}

/**
 * Validate tar header checksum
 */
function validateChecksum(header: Uint8Array, expectedChecksum: number): boolean {
  // Calculate checksum (treating checksum field as spaces)
  let sum = 0
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    // Checksum field is at offset 148-155, treat as spaces (0x20)
    if (i >= 148 && i < 156) {
      sum += 32 // space character
    } else {
      const byte = header[i]
      if (byte !== undefined) {
        sum += byte
      }
    }
  }
  return sum === expectedChecksum
}

/**
 * Parse type flag to entry type
 */
function parseType(typeflag: number): TarEntryType {
  switch (typeflag) {
    case 0: // NUL character (old format)
    case TYPE_FLAGS.FILE:
      return 'file'
    case TYPE_FLAGS.HARDLINK:
      return 'hardlink'
    case TYPE_FLAGS.SYMLINK:
      return 'symlink'
    case TYPE_FLAGS.CHAR_DEVICE:
      return 'character-device'
    case TYPE_FLAGS.BLOCK_DEVICE:
      return 'block-device'
    case TYPE_FLAGS.DIRECTORY:
      return 'directory'
    case TYPE_FLAGS.FIFO:
      return 'fifo'
    case TYPE_FLAGS.CONTIGUOUS:
      return 'contiguous'
    case TYPE_FLAGS.PAX_EXTENDED:
      return 'pax-extended'
    case TYPE_FLAGS.PAX_GLOBAL:
      return 'pax-global'
    case TYPE_FLAGS.GNU_LONGNAME:
      return 'gnu-longname'
    case TYPE_FLAGS.GNU_LONGLINK:
      return 'gnu-longlink'
    default:
      return 'unknown'
  }
}

/**
 * Parse PAX extended header content
 *
 * Format: "length key=value\n" for each entry
 */
export function parsePaxHeaders(content: Uint8Array): PaxExtendedHeader {
  const text = textDecoder.decode(content)
  const headers: PaxExtendedHeader = {}
  let offset = 0

  while (offset < text.length) {
    // Find the space after length
    const spaceIndex = text.indexOf(' ', offset)
    if (spaceIndex === -1) break

    const length = parseInt(text.substring(offset, spaceIndex), 10)
    if (isNaN(length) || length <= 0) break

    // Extract the key=value\n portion
    const record = text.substring(spaceIndex + 1, offset + length - 1) // -1 for newline
    const equalsIndex = record.indexOf('=')
    if (equalsIndex !== -1) {
      const key = record.substring(0, equalsIndex)
      const value = record.substring(equalsIndex + 1)

      // Parse known numeric fields
      switch (key) {
        case 'size':
        case 'uid':
        case 'gid':
          headers[key] = parseInt(value, 10)
          break
        case 'mtime':
        case 'atime':
        case 'ctime':
          headers[key] = parseFloat(value)
          break
        default:
          headers[key] = value
      }
    }

    offset += length
  }

  return headers
}

/**
 * Create a PAX extended header block
 */
export function createPaxHeader(headers: PaxExtendedHeader): Uint8Array {
  let content = ''

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const record = `${key}=${value}`
    // Length includes: length digits + space + record + newline
    // We need to calculate the length including its own digits
    let length = record.length + 3 // minimum: "X K=V\n"
    while (true) {
      const newLength = length.toString().length + 1 + record.length + 1
      if (newLength <= length) break
      length = newLength
    }
    content += `${length} ${record}\n`
  }

  return textEncoder.encode(content)
}

/**
 * Create a USTAR tar header
 */
export function createTarHeader(
  name: string,
  size: number,
  options: {
    mode?: number
    uid?: number
    gid?: number
    mtime?: Date
    type?: TarEntryType
    linkname?: string
    uname?: string
    gname?: string
    prefix?: string
  } = {}
): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK_SIZE)

  const {
    mode = 0o644,
    uid = 0,
    gid = 0,
    mtime = new Date(),
    type = 'file',
    linkname = '',
    uname = '',
    gname = '',
    prefix = '',
  } = options

  // Name (0-99)
  writeString(header, 0, name, 100)

  // Mode (100-107)
  writeOctal(header, 100, mode, 8)

  // UID (108-115)
  writeOctal(header, 108, uid, 8)

  // GID (116-123)
  writeOctal(header, 116, gid, 8)

  // Size (124-135)
  writeOctal(header, 124, size, 12)

  // Mtime (136-147)
  writeOctal(header, 136, Math.floor(mtime.getTime() / 1000), 12)

  // Typeflag (156)
  header[156] = getTypeflag(type)

  // Linkname (157-256)
  writeString(header, 157, linkname, 100)

  // Magic (257-262) - 'ustar\0'
  writeString(header, 257, 'ustar\0', 6)

  // Version (263-264) - '00'
  writeString(header, 263, '00', 2)

  // Uname (265-296)
  writeString(header, 265, uname, 32)

  // Gname (297-328)
  writeString(header, 297, gname, 32)

  // Devmajor (329-336)
  writeOctal(header, 329, 0, 8)

  // Devminor (337-344)
  writeOctal(header, 337, 0, 8)

  // Prefix (345-499)
  writeString(header, 345, prefix, 155)

  // Calculate and write checksum (148-155)
  let checksum = 0
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    // Treat checksum field as spaces
    if (i >= 148 && i < 156) {
      checksum += 32
    } else {
      const byte = header[i]
      if (byte !== undefined) {
        checksum += byte
      }
    }
  }
  writeOctal(header, 148, checksum, 8)
  header[155] = 32 // space

  return header
}

/**
 * Write a string to header at offset
 */
function writeString(header: Uint8Array, offset: number, str: string, length: number): void {
  const encoded = textEncoder.encode(str)
  header.set(encoded.subarray(0, Math.min(encoded.length, length)), offset)
}

/**
 * Write an octal number to header at offset
 */
function writeOctal(header: Uint8Array, offset: number, value: number, length: number): void {
  const str = value.toString(8).padStart(length - 1, '0')
  writeString(header, offset, str, length - 1)
  header[offset + length - 1] = 0 // null terminator
}

/**
 * Get type flag byte for entry type
 */
function getTypeflag(type: TarEntryType): number {
  switch (type) {
    case 'file':
      return TYPE_FLAGS.FILE
    case 'hardlink':
      return TYPE_FLAGS.HARDLINK
    case 'symlink':
      return TYPE_FLAGS.SYMLINK
    case 'character-device':
      return TYPE_FLAGS.CHAR_DEVICE
    case 'block-device':
      return TYPE_FLAGS.BLOCK_DEVICE
    case 'directory':
      return TYPE_FLAGS.DIRECTORY
    case 'fifo':
      return TYPE_FLAGS.FIFO
    case 'contiguous':
      return TYPE_FLAGS.CONTIGUOUS
    case 'pax-extended':
      return TYPE_FLAGS.PAX_EXTENDED
    case 'pax-global':
      return TYPE_FLAGS.PAX_GLOBAL
    default:
      return TYPE_FLAGS.FILE
  }
}

/**
 * Pad data to tar block boundary
 */
export function padToBlockSize(data: Uint8Array): Uint8Array {
  const remainder = data.length % TAR_BLOCK_SIZE
  if (remainder === 0) return data

  const paddedLength = data.length + (TAR_BLOCK_SIZE - remainder)
  const padded = new Uint8Array(paddedLength)
  padded.set(data)
  return padded
}

/**
 * Create end-of-archive marker (two null blocks)
 */
export function createEndOfArchive(): Uint8Array {
  return new Uint8Array(TAR_BLOCK_SIZE * 2)
}

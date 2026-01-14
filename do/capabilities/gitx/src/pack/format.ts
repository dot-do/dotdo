/**
 * @fileoverview Git Packfile Format Implementation
 *
 * This module implements the Git packfile format specification, providing utilities
 * for creating, parsing, and manipulating Git packfiles. Packfiles are Git's primary
 * mechanism for efficient storage and network transfer of repository objects.
 *
 * ## Packfile Structure
 *
 * A packfile consists of:
 * - **Header (12 bytes)**:
 *   - 4 bytes: "PACK" signature
 *   - 4 bytes: version number (network byte order, big-endian) - currently version 2
 *   - 4 bytes: number of objects (network byte order)
 * - **Object entries (variable length)**:
 *   - Each object has a variable-length header followed by zlib-compressed data
 * - **Trailer (20 bytes)**:
 *   - SHA-1 checksum of all preceding content
 *
 * ## Object Header Encoding
 *
 * The object header uses a variable-length encoding:
 * - First byte: (MSB) continuation bit | 3-bit type | 4-bit size LSB
 * - Subsequent bytes: (MSB) continuation bit | 7-bit size continuation
 *
 * ## Supported Object Types
 *
 * | Type Code | Name      | Description                                    |
 * |-----------|-----------|------------------------------------------------|
 * | 1         | commit    | A commit object                                |
 * | 2         | tree      | A tree object (directory listing)              |
 * | 3         | blob      | A blob object (file content)                   |
 * | 4         | tag       | An annotated tag object                        |
 * | 6         | ofs_delta | Delta referencing base by offset               |
 * | 7         | ref_delta | Delta referencing base by SHA-1                |
 *
 * @module pack/format
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 *
 * @example
 * // Creating a simple packfile
 * import { createPackfile, PackableObject } from './format';
 *
 * const objects: PackableObject[] = [
 *   { type: 'blob', data: new TextEncoder().encode('Hello, World!') }
 * ];
 *
 * const packfile = createPackfile(objects);
 * // packfile is now a Uint8Array containing the complete packfile
 */

import pako from 'pako'
import { sha1 } from '../utils/sha1'

/**
 * The 4-byte ASCII signature that identifies a valid packfile.
 * Every packfile must begin with these bytes: 0x50 0x41 0x43 0x4b ("PACK").
 *
 * @constant {string}
 * @example
 * // Validate packfile signature
 * const signature = String.fromCharCode(...packData.slice(0, 4));
 * if (signature !== PACK_SIGNATURE) {
 *   throw new Error('Invalid packfile');
 * }
 */
export const PACK_SIGNATURE = 'PACK'

/**
 * The packfile version number supported by this implementation.
 * Currently, only version 2 is widely used and supported.
 *
 * @constant {number}
 */
export const PACK_VERSION = 2

/**
 * Enumeration of Git pack object types.
 *
 * These values are used in the packfile header to identify the type of each object.
 * Note that types 0 and 5 are reserved/unused in the Git pack format.
 *
 * @description Represents the different types of objects that can be stored in a Git packfile.
 * Delta types (OFS_DELTA and REF_DELTA) are used for efficient storage by referencing
 * a base object and storing only the differences.
 *
 * @enum {number}
 *
 * @example
 * // Check if an object is a delta type
 * function isDelta(type: PackObjectType): boolean {
 *   return type === PackObjectType.OBJ_OFS_DELTA || type === PackObjectType.OBJ_REF_DELTA;
 * }
 */
export enum PackObjectType {
  /** A commit object containing tree reference, parent commits, author, and message */
  OBJ_COMMIT = 1,
  /** A tree object representing a directory structure */
  OBJ_TREE = 2,
  /** A blob object containing file content */
  OBJ_BLOB = 3,
  /** An annotated tag object */
  OBJ_TAG = 4,
  /** An offset delta - references base object by byte offset within the packfile */
  OBJ_OFS_DELTA = 6,
  /** A reference delta - references base object by its SHA-1 hash */
  OBJ_REF_DELTA = 7
}

/**
 * Converts a PackObjectType enum value to its string representation.
 *
 * @description Converts numeric pack object types to their human-readable string names.
 * This is useful for logging, debugging, and when interfacing with Git's loose object format.
 *
 * @param {PackObjectType} type - The numeric pack object type to convert
 * @returns {string} The string name of the object type ('commit', 'tree', 'blob', 'tag', 'ofs_delta', or 'ref_delta')
 * @throws {Error} If the type is not a valid PackObjectType value
 *
 * @example
 * // Convert type for display
 * const type = PackObjectType.OBJ_BLOB;
 * console.log(`Object type: ${packObjectTypeToString(type)}`); // "Object type: blob"
 *
 * @example
 * // Use in error messages
 * function validateObject(type: PackObjectType, data: Uint8Array) {
 *   if (data.length === 0) {
 *     throw new Error(`Empty ${packObjectTypeToString(type)} object`);
 *   }
 * }
 */
export function packObjectTypeToString(type: PackObjectType): string {
  switch (type) {
    case PackObjectType.OBJ_COMMIT:
      return 'commit'
    case PackObjectType.OBJ_TREE:
      return 'tree'
    case PackObjectType.OBJ_BLOB:
      return 'blob'
    case PackObjectType.OBJ_TAG:
      return 'tag'
    case PackObjectType.OBJ_OFS_DELTA:
      return 'ofs_delta'
    case PackObjectType.OBJ_REF_DELTA:
      return 'ref_delta'
    default:
      throw new Error(`Invalid pack object type: ${type}`)
  }
}

/**
 * Converts a string object type name to its PackObjectType enum value.
 *
 * @description Parses a string object type name and returns the corresponding enum value.
 * This is useful when reading Git loose objects or configuration files that use string type names.
 * Note: Delta types ('ofs_delta', 'ref_delta') are not supported as they are not valid
 * standalone object types.
 *
 * @param {string} str - The string type name ('commit', 'tree', 'blob', or 'tag')
 * @returns {PackObjectType} The corresponding PackObjectType enum value
 * @throws {Error} If the string does not match a valid base object type
 *
 * @example
 * // Parse type from Git object
 * const typeStr = 'blob';
 * const type = stringToPackObjectType(typeStr);
 * // type === PackObjectType.OBJ_BLOB
 *
 * @example
 * // Error handling for invalid types
 * try {
 *   const type = stringToPackObjectType('invalid');
 * } catch (e) {
 *   console.error('Unknown object type');
 * }
 */
export function stringToPackObjectType(str: string): PackObjectType {
  switch (str) {
    case 'commit':
      return PackObjectType.OBJ_COMMIT
    case 'tree':
      return PackObjectType.OBJ_TREE
    case 'blob':
      return PackObjectType.OBJ_BLOB
    case 'tag':
      return PackObjectType.OBJ_TAG
    default:
      throw new Error(`Invalid object type string: ${str}`)
  }
}

/**
 * Encodes a non-negative integer using variable-length integer encoding.
 *
 * @description Uses Git's varint encoding scheme where each byte encodes 7 bits of the value,
 * with the MSB (most significant bit) serving as a continuation flag. If the MSB is set (1),
 * more bytes follow; if clear (0), this is the last byte.
 *
 * The encoding is little-endian: least significant bits come first. This allows efficient
 * encoding of small values (1 byte for values 0-127) while supporting arbitrarily large values.
 *
 * @param {number} value - A non-negative integer to encode (must be >= 0)
 * @returns {Uint8Array} The variable-length encoded bytes
 *
 * @example
 * // Encode small value (fits in 1 byte)
 * const encoded = encodeVarint(100);
 * // encoded = Uint8Array [100] (0x64, no continuation bit)
 *
 * @example
 * // Encode larger value (requires multiple bytes)
 * const encoded = encodeVarint(300);
 * // encoded = Uint8Array [172, 2] (0xAC with continuation, 0x02)
 * // 300 = 0b100101100 = (0101100 | continuation) + (10)
 */
export function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = []

  // Encode value in 7-bit chunks with continuation bit
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value > 0) {
      byte |= 0x80 // Set continuation bit
    }
    bytes.push(byte)
  } while (value > 0)

  return new Uint8Array(bytes)
}

/**
 * Decodes a variable-length integer from a byte buffer.
 *
 * @description Reads and decodes a varint starting at the specified offset. The encoding uses
 * 7 bits per byte for the value, with the MSB as a continuation flag. This is the inverse
 * operation of {@link encodeVarint}.
 *
 * **Important Notes:**
 * - Maximum supported varint length is 10 bytes (enough for 64-bit values)
 * - Throws if data ends unexpectedly before varint is complete
 * - Throws if varint exceeds maximum length (likely corrupted data)
 *
 * @param {Uint8Array} data - The byte buffer containing the encoded varint
 * @param {number} offset - The starting position in the buffer
 * @returns {{ value: number; bytesRead: number }} Object containing the decoded value and number of bytes consumed
 * @throws {Error} If unexpected end of data or varint exceeds maximum length
 *
 * @example
 * // Decode a varint from a buffer
 * const buffer = new Uint8Array([172, 2, 0, 0]); // 300 encoded + extra bytes
 * const { value, bytesRead } = decodeVarint(buffer, 0);
 * // value === 300, bytesRead === 2
 *
 * @example
 * // Decode multiple varints
 * const buffer = new Uint8Array([100, 172, 2]);
 * let offset = 0;
 * const first = decodeVarint(buffer, offset);  // value: 100, bytesRead: 1
 * offset += first.bytesRead;
 * const second = decodeVarint(buffer, offset); // value: 300, bytesRead: 2
 */
export function decodeVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0
  let shift = 0
  let bytesRead = 0

  // Maximum bytes for a 64-bit varint is 10 (ceil(64/7))
  // For JavaScript's safe integer range, 8 bytes is sufficient
  const MAX_VARINT_BYTES = 10

  while (true) {
    if (offset + bytesRead >= data.length) {
      throw new Error(`Varint decoding failed: unexpected end of data at offset ${offset + bytesRead}`)
    }
    if (bytesRead >= MAX_VARINT_BYTES) {
      throw new Error(`Varint decoding failed: exceeded maximum length of ${MAX_VARINT_BYTES} bytes (possible infinite loop or corrupted data)`)
    }

    const byte = data[offset + bytesRead]
    bytesRead++
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      break
    }
    shift += 7
  }

  return { value, bytesRead }
}

/**
 * Encodes object type and uncompressed size into a pack object header.
 *
 * @description Creates the variable-length header that precedes each object in a packfile.
 * The header encodes both the object type (3 bits) and the uncompressed data size.
 *
 * **Header Format:**
 * - First byte: `[continuation][type:3][size:4]` - MSB is continuation flag, then 3-bit type, then 4 LSBs of size
 * - Subsequent bytes: `[continuation][size:7]` - MSB is continuation flag, then 7 bits of size
 *
 * This encoding allows:
 * - Sizes 0-15: 1 byte
 * - Sizes 16-2047: 2 bytes
 * - Larger sizes: additional bytes as needed
 *
 * @param {PackObjectType} type - The object type (1-4 for base types, 6-7 for deltas)
 * @param {number} size - The uncompressed object size in bytes
 * @returns {Uint8Array} The encoded header bytes
 *
 * @example
 * // Encode a small blob object
 * const header = encodeTypeAndSize(PackObjectType.OBJ_BLOB, 10);
 * // header[0] = (3 << 4) | 10 = 0x3A (type=blob, size=10, no continuation)
 *
 * @example
 * // Encode a larger object (size requires continuation)
 * const header = encodeTypeAndSize(PackObjectType.OBJ_COMMIT, 256);
 * // First byte has type and low 4 bits of size, with continuation
 * // Second byte has remaining size bits
 */
export function encodeTypeAndSize(type: PackObjectType, size: number): Uint8Array {
  const bytes: number[] = []

  // First byte: continuation bit (if needed) | type (3 bits) | size low 4 bits
  let firstByte = (type << 4) | (size & 0x0f)
  size >>>= 4

  if (size > 0) {
    firstByte |= 0x80 // Set continuation bit
  }
  bytes.push(firstByte)

  // Subsequent bytes: continuation bit | 7 bits of size
  while (size > 0) {
    let byte = size & 0x7f
    size >>>= 7
    if (size > 0) {
      byte |= 0x80
    }
    bytes.push(byte)
  }

  return new Uint8Array(bytes)
}

/**
 * Decodes object type and size from a pack object header.
 *
 * @description Parses the variable-length header at the beginning of each packed object.
 * This is the inverse operation of {@link encodeTypeAndSize}.
 *
 * **Decoding Process:**
 * 1. Read first byte to get type (bits 4-6) and initial size (bits 0-3)
 * 2. If MSB is set, read continuation bytes (7 bits each) for remaining size
 * 3. Return the decoded type, size, and total bytes consumed
 *
 * **Important Notes:**
 * - Maximum header length is 10 bytes (prevents infinite loops on corrupted data)
 * - Throws if offset is beyond data bounds
 * - Throws if data ends before header is complete
 *
 * @param {Uint8Array} data - The packfile data buffer
 * @param {number} offset - Starting offset of the object header
 * @returns {{ type: PackObjectType; size: number; bytesRead: number }} Decoded type, uncompressed size, and bytes consumed
 * @throws {Error} If offset is out of bounds or header data is truncated/corrupted
 *
 * @example
 * // Decode an object header
 * const packData = getPackfileData();
 * let offset = 12; // Skip 12-byte pack header
 *
 * const { type, size, bytesRead } = decodeTypeAndSize(packData, offset);
 * console.log(`Object type: ${packObjectTypeToString(type)}, size: ${size}`);
 * offset += bytesRead; // Move to start of compressed data
 */
export function decodeTypeAndSize(data: Uint8Array, offset: number): {
  type: PackObjectType
  size: number
  bytesRead: number
} {
  // Maximum bytes for type+size header (first byte + continuation bytes)
  // Similar to varint, limit to prevent infinite loops
  const MAX_HEADER_BYTES = 10

  if (offset >= data.length) {
    throw new Error(`decodeTypeAndSize failed: offset ${offset} is beyond data length ${data.length}`)
  }

  let bytesRead = 0
  const firstByte = data[offset + bytesRead]
  bytesRead++

  // Extract type (bits 4-6 of first byte)
  const type = ((firstByte >> 4) & 0x07) as PackObjectType

  // Extract initial size (low 4 bits)
  let size = firstByte & 0x0f
  let shift = 4

  // Read continuation bytes if MSB is set
  if (firstByte & 0x80) {
    while (true) {
      if (offset + bytesRead >= data.length) {
        throw new Error(`decodeTypeAndSize failed: unexpected end of data at offset ${offset + bytesRead}`)
      }
      if (bytesRead >= MAX_HEADER_BYTES) {
        throw new Error(`decodeTypeAndSize failed: exceeded maximum header length of ${MAX_HEADER_BYTES} bytes (possible infinite loop or corrupted data)`)
      }

      const byte = data[offset + bytesRead]
      bytesRead++
      size |= (byte & 0x7f) << shift
      shift += 7
      if ((byte & 0x80) === 0) {
        break
      }
    }
  }

  return { type, size, bytesRead }
}

/**
 * Represents the parsed 12-byte header of a Git packfile.
 *
 * @description The pack header contains essential metadata about the packfile:
 * - The signature validates this is a genuine packfile
 * - The version indicates the format version (currently always 2)
 * - The object count tells how many objects follow
 *
 * @interface PackHeader
 *
 * @example
 * const header: PackHeader = parsePackHeader(packData);
 * console.log(`Pack contains ${header.objectCount} objects`);
 */
export interface PackHeader {
  /** The 4-byte signature string, should always be "PACK" */
  signature: string
  /** The format version number (currently always 2) */
  version: number
  /** Total number of objects in the packfile */
  objectCount: number
}

/**
 * Parses and validates the 12-byte header of a Git packfile.
 *
 * @description Reads the first 12 bytes of a packfile and validates:
 * 1. The signature is "PACK"
 * 2. The version is 2 (only supported version)
 * 3. Extracts the object count
 *
 * This should be called first when processing a packfile to understand
 * its structure and validate basic integrity.
 *
 * @param {Uint8Array} data - The packfile data (at least 12 bytes)
 * @returns {PackHeader} Parsed header with signature, version, and object count
 * @throws {Error} If data is too short (< 12 bytes)
 * @throws {Error} If signature is not "PACK"
 * @throws {Error} If version is not 2
 *
 * @example
 * // Parse a packfile header
 * const packData = await readPackfile('objects/pack/pack-abc123.pack');
 * const header = parsePackHeader(packData);
 *
 * console.log(`Packfile version: ${header.version}`);
 * console.log(`Contains ${header.objectCount} objects`);
 *
 * @example
 * // Error handling for invalid packfile
 * try {
 *   const header = parsePackHeader(suspectData);
 * } catch (e) {
 *   console.error('Not a valid packfile:', e.message);
 * }
 */
export function parsePackHeader(data: Uint8Array): PackHeader {
  if (data.length < 12) {
    throw new Error('Packfile header too short: expected at least 12 bytes')
  }

  // Read signature (4 bytes)
  const signature = String.fromCharCode(data[0], data[1], data[2], data[3])
  if (signature !== PACK_SIGNATURE) {
    throw new Error(`Invalid pack signature: expected "${PACK_SIGNATURE}", got "${signature}"`)
  }

  // Read version (4 bytes, big-endian)
  const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]
  if (version !== 2) {
    throw new Error(`Unsupported pack version: ${version} (only version 2 is supported)`)
  }

  // Read object count (4 bytes, big-endian)
  const objectCount = (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11]

  return { signature, version, objectCount }
}

/**
 * Represents a parsed pack object header (without the actual data).
 *
 * @description Contains the metadata extracted from a pack object's header.
 * This is useful when scanning through a packfile to index its contents
 * without fully decompressing each object.
 *
 * @interface ParsedPackObject
 */
export interface ParsedPackObject {
  /** The object type (commit, tree, blob, tag, or delta types) */
  type: PackObjectType
  /** The uncompressed size of the object data in bytes */
  size: number
  /** Number of bytes consumed by the header (for offset calculations) */
  headerSize: number
}

/**
 * Parses an individual pack object header at the specified offset.
 *
 * @description Extracts the object type and uncompressed size from the header
 * at the given offset. This is useful for scanning/indexing packfiles.
 *
 * **Important Notes:**
 * - This only parses the header, not the compressed data following it
 * - For delta objects, you'll need additional parsing (base offset/SHA)
 * - Use `headerSize` to calculate where the compressed data begins
 *
 * @param {Uint8Array} data - The packfile data buffer
 * @param {number} offset - Byte offset where the object header starts
 * @returns {ParsedPackObject} Object containing type, size, and header size
 * @throws {Error} If offset is out of bounds or header is malformed
 *
 * @example
 * // Scan through all objects in a packfile
 * const header = parsePackHeader(packData);
 * let offset = 12; // After pack header
 *
 * for (let i = 0; i < header.objectCount; i++) {
 *   const obj = parsePackObject(packData, offset);
 *   console.log(`Object ${i}: type=${obj.type}, size=${obj.size}`);
 *   // Skip header + compressed data (need to decompress to find boundary)
 *   offset += obj.headerSize;
 *   // ... decompress and skip compressed data ...
 * }
 */
export function parsePackObject(data: Uint8Array, offset: number): ParsedPackObject {
  const { type, size, bytesRead } = decodeTypeAndSize(data, offset)

  return {
    type,
    size,
    headerSize: bytesRead
  }
}

/**
 * Represents an object to be packed into a packfile.
 *
 * @description This is the input format for {@link createPackfile}. Each object
 * consists of a type string and the raw (uncompressed) object data. The data
 * should be the full object content without the Git object header prefix.
 *
 * @interface PackableObject
 *
 * @example
 * // Create a blob object for a file
 * const blobObject: PackableObject = {
 *   type: 'blob',
 *   data: new TextEncoder().encode('file contents here')
 * };
 */
export interface PackableObject {
  /** Object type as a string ('blob', 'tree', 'commit', or 'tag') */
  type: 'blob' | 'tree' | 'commit' | 'tag'
  /** The raw object data (will be compressed during packing) */
  data: Uint8Array
}

/**
 * Creates a complete packfile from an array of objects.
 *
 * @description Generates a valid Git packfile containing the specified objects.
 * The resulting packfile includes:
 * - 12-byte header (signature, version, object count)
 * - Each object (header + zlib-compressed data)
 * - 20-byte SHA-1 checksum trailer
 *
 * **Process:**
 * 1. Creates the pack header with signature "PACK", version 2, and object count
 * 2. For each object, encodes type/size header and compresses data with zlib
 * 3. Appends SHA-1 checksum of the entire pack content
 *
 * **Important Notes:**
 * - Objects are packed in the order provided (no reordering for delta compression)
 * - This function creates full objects only (no delta compression)
 * - For delta compression, use the generation module functions
 *
 * @param {PackableObject[]} objects - Array of objects to include in the packfile
 * @returns {Uint8Array} Complete packfile as binary data
 *
 * @example
 * // Create a packfile with a single blob
 * const objects: PackableObject[] = [
 *   { type: 'blob', data: new TextEncoder().encode('Hello, World!') }
 * ];
 * const packfile = createPackfile(objects);
 * // Write packfile to disk or send over network
 *
 * @example
 * // Create a packfile with multiple objects
 * const objects: PackableObject[] = [
 *   { type: 'blob', data: fileContent1 },
 *   { type: 'blob', data: fileContent2 },
 *   { type: 'tree', data: treeData },
 *   { type: 'commit', data: commitData }
 * ];
 * const packfile = createPackfile(objects);
 */
export function createPackfile(objects: PackableObject[]): Uint8Array {
  const parts: Uint8Array[] = []

  // Create header
  const header = new Uint8Array(12)
  // Signature: "PACK"
  header[0] = 0x50 // P
  header[1] = 0x41 // A
  header[2] = 0x43 // C
  header[3] = 0x4b // K
  // Version: 2 (big-endian)
  header[4] = 0
  header[5] = 0
  header[6] = 0
  header[7] = 2
  // Object count (big-endian)
  const count = objects.length
  header[8] = (count >> 24) & 0xff
  header[9] = (count >> 16) & 0xff
  header[10] = (count >> 8) & 0xff
  header[11] = count & 0xff

  parts.push(header)

  // Add each object
  for (const obj of objects) {
    const type = stringToPackObjectType(obj.type)
    const typeAndSize = encodeTypeAndSize(type, obj.data.length)

    // Compress the data using zlib deflate
    const compressed = pako.deflate(obj.data)

    parts.push(typeAndSize)
    parts.push(compressed)
  }

  // Calculate total length
  let totalLength = 0
  for (const part of parts) {
    totalLength += part.length
  }

  // Combine all parts
  const packData = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    packData.set(part, offset)
    offset += part.length
  }

  // Calculate SHA-1 checksum of the pack data
  const checksum = sha1(packData)

  // Create final packfile with checksum
  const finalPack = new Uint8Array(packData.length + 20)
  finalPack.set(packData, 0)
  finalPack.set(checksum, packData.length)

  return finalPack
}

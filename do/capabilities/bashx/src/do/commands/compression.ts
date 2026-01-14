/**
 * Compression Commands Implementation
 *
 * Implements gzip, gunzip, zcat, tar, zip, unzip commands for bashx.do.
 * Uses pako for gzip/deflate and fflate for zip support.
 *
 * Architecture:
 * - ArchiveHandler: Unified interface for tar/zip operations
 * - CompressionCodec: Pluggable compression (gzip via pako)
 * - BufferUtils: Common byte array manipulation utilities
 *
 * @module bashx/do/commands/compression
 */

import pako from 'pako'
import * as fflate from 'fflate'
import type { BashResult } from '../../types.js'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Mock filesystem interface for compression operations.
 * Provides async file system operations for reading, writing, and managing files.
 */
interface MockFs {
  /** Map of file paths to file data */
  files: Map<string, FileData>
  /** Set of directory paths */
  directories: Set<string>
  /** Map of symlink paths to their targets */
  symlinks: Map<string, string>
  /** Read file contents from path */
  read(path: string): Promise<Uint8Array | string>
  /** Write content to path */
  write(path: string, content: Uint8Array | string): Promise<void>
  /** Check if path exists */
  exists(path: string): Promise<boolean>
  /** Get file/directory stats */
  stat(path: string): Promise<FileStat>
  /** List directory contents */
  readdir(path: string): Promise<string[]>
  /** Create directory (optionally recursive) */
  mkdir(path: string, options?: MkdirOptions): Promise<void>
  /** Remove file */
  rm(path: string): Promise<void>
  /** Read symlink target */
  readlink(path: string): Promise<string>
  /** Create symlink */
  symlink(target: string, path: string): Promise<void>
}

/** File data stored in mock filesystem */
interface FileData {
  content: Uint8Array | string
  mode?: number
  mtime?: Date
}

/** File statistics */
interface FileStat {
  size: number
  mode: number
  mtime: Date
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** Options for mkdir */
interface MkdirOptions {
  recursive?: boolean
}

/** Command execution context */
interface CommandContext {
  /** Command arguments */
  args: string[]
  /** Current working directory */
  cwd: string
  /** Filesystem interface */
  fs: MockFs
}

/** Parsed command line arguments */
interface ParsedArgs {
  /** Single-character and long flags (e.g., -v, --verbose) */
  flags: Set<string>
  /** Key-value options (e.g., --level=9) */
  options: Map<string, string>
  /** Non-flag arguments */
  positional: string[]
}

// ============================================================================
// ARCHIVE HANDLER INTERFACE
// ============================================================================

/**
 * Represents an entry in an archive (tar or zip).
 * Unified structure for both archive formats.
 */
interface ArchiveEntry {
  /** Relative path within archive */
  name: string
  /** File contents (empty for directories/symlinks) */
  content: Uint8Array
  /** Unix file mode (e.g., 0o644 for files, 0o755 for directories) */
  mode: number
  /** Modification time */
  mtime: Date
  /** Entry type */
  type: 'file' | 'directory' | 'symlink'
  /** Target path for symlinks */
  linkname?: string
}

/**
 * Unified interface for archive operations.
 * Implemented by TarHandler and ZipHandler.
 */
interface ArchiveHandler {
  /** Build archive from entries */
  build(entries: ArchiveEntry[]): Uint8Array
  /** Parse archive into entries */
  parse(data: Uint8Array): ArchiveEntry[]
}

// ============================================================================
// COMPRESSION CODEC INTERFACE
// ============================================================================

/** Compression level configuration */
interface CompressionOptions {
  /** Compression level (1-9, where 9 is maximum compression) */
  level?: number
}

/**
 * Interface for compression/decompression codecs.
 * Currently implemented for gzip via pako.
 */
interface CompressionCodec {
  /** Compress data */
  compress(data: Uint8Array, options?: CompressionOptions): Uint8Array
  /** Decompress data */
  decompress(data: Uint8Array): Uint8Array
  /** Magic bytes to identify format */
  magicBytes: number[]
}

// ============================================================================
// BUFFER UTILITIES
// ============================================================================

/**
 * Utility class for byte array operations.
 * Centralizes all buffer manipulation to avoid duplication.
 */
const BufferUtils = {
  /**
   * Convert string to Uint8Array using UTF-8 encoding.
   * @param str - String to convert
   * @returns UTF-8 encoded byte array
   */
  stringToBytes(str: string): Uint8Array {
    return new TextEncoder().encode(str)
  },

  /**
   * Convert Uint8Array to string using UTF-8 decoding.
   * @param bytes - Byte array to convert
   * @returns Decoded string
   */
  bytesToString(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes)
  },

  /**
   * Ensure content is Uint8Array (convert string if needed).
   * @param content - String or byte array
   * @returns Byte array
   */
  toBytes(content: Uint8Array | string): Uint8Array {
    return typeof content === 'string' ? this.stringToBytes(content) : content
  },

  /**
   * Check if bytes represent valid UTF-8 text without data loss.
   * Used to determine if decompressed data should be stored as text or binary.
   * @param bytes - Byte array to check
   * @returns true if valid UTF-8 text
   */
  isValidUtf8(bytes: Uint8Array): boolean {
    // Check for null bytes in the middle (common in binary data)
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0) return false
    }

    // Try decode and re-encode, compare lengths
    try {
      // Use fatal: true option in constructor to throw on invalid UTF-8
      // Cast to standard TextDecoder type since Cloudflare Workers types may differ
      const decoder = new (TextDecoder as unknown as new (label?: string, options?: { fatal?: boolean }) => TextDecoder)('utf-8', { fatal: true })
      const decoded = decoder.decode(bytes)
      const reencoded = new TextEncoder().encode(decoded)
      return bytes.length === reencoded.length
    } catch {
      return false
    }
  },

  /**
   * Convert bytes to string if valid UTF-8, otherwise return bytes.
   * @param bytes - Byte array to convert
   * @returns String for text data, Uint8Array for binary data
   */
  toStringOrBinary(bytes: Uint8Array): string | Uint8Array {
    return this.isValidUtf8(bytes) ? this.bytesToString(bytes) : bytes
  },

  /**
   * Concatenate multiple byte arrays into one.
   * @param arrays - Arrays to concatenate
   * @returns Combined byte array
   */
  concat(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
      result.set(arr, offset)
      offset += arr.length
    }
    return result
  },

  /**
   * Create a zero-filled byte array of specified size.
   * @param size - Size of array
   * @returns Zero-filled byte array
   */
  zeros(size: number): Uint8Array {
    return new Uint8Array(size)
  },

  /**
   * Pad byte array to block boundary.
   * @param data - Data to pad
   * @param blockSize - Block size to pad to
   * @returns Padded byte array
   */
  padToBlock(data: Uint8Array, blockSize: number): Uint8Array {
    const blocks = Math.ceil(data.length / blockSize)
    const paddedSize = blocks * blockSize
    if (paddedSize === data.length) return data
    const padded = new Uint8Array(paddedSize)
    padded.set(data)
    return padded
  },
} as const

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Utility functions for path manipulation.
 */
const PathUtils = {
  /**
   * Resolve a path relative to cwd.
   * @param path - Path to resolve
   * @param cwd - Current working directory
   * @returns Absolute path
   */
  resolve(path: string, cwd: string): string {
    if (path.startsWith('/')) return path
    return cwd.endsWith('/') ? cwd + path : cwd + '/' + path
  },

  /**
   * Get parent directory of a path.
   * @param path - File path
   * @returns Parent directory path
   */
  dirname(path: string): string {
    return path.split('/').slice(0, -1).join('/')
  },

  /**
   * Get filename from path.
   * @param path - File path
   * @returns Filename
   */
  basename(path: string): string {
    return path.split('/').pop() || path
  },

  /**
   * Join path segments.
   * @param base - Base path
   * @param segment - Path segment to append
   * @returns Combined path
   */
  join(base: string, segment: string): string {
    return base.endsWith('/') ? base + segment : base + '/' + segment
  },
} as const

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

/**
 * Parse command line arguments extracting flags, options, and positional args.
 *
 * Supports:
 * - Long options: --verbose, --level=9
 * - Short flags: -v, -f
 * - Combined short flags: -cvf (expanded to -c, -v, -f)
 * - Compression levels: -1 through -9
 *
 * @param args - Command line arguments
 * @returns Parsed arguments structure
 */
function parseArgs(args: string[]): ParsedArgs {
  const flags = new Set<string>()
  const options = new Map<string, string>()
  const positional: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg.startsWith('--')) {
      // Long option (--verbose or --level=9)
      if (arg.includes('=')) {
        const [key, value] = arg.split('=', 2)
        options.set(key, value)
      } else {
        flags.add(arg)
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Short option or combined flags
      if (/^-[0-9]$/.test(arg)) {
        // Compression level flag (-1 through -9)
        options.set('-level', arg.slice(1))
      } else {
        // Split combined flags like -czvf into -c, -z, -v, -f
        for (let j = 1; j < arg.length; j++) {
          flags.add('-' + arg[j])
        }
      }
    } else {
      positional.push(arg)
    }
  }

  return { flags, options, positional }
}

/**
 * Match a filename against a glob pattern.
 * Supports * (any characters) and ? (single character).
 *
 * @param filename - Filename to test
 * @param pattern - Glob pattern
 * @returns true if filename matches pattern
 */
function matchGlob(filename: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${regex}$`).test(filename)
}

// ============================================================================
// GZIP CODEC IMPLEMENTATION
// ============================================================================

/**
 * Gzip compression codec using pako library.
 */
const GzipCodec: CompressionCodec = {
  magicBytes: [0x1f, 0x8b],

  compress(data: Uint8Array, options?: CompressionOptions): Uint8Array {
    const level = (options?.level ?? 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
    return pako.gzip(data, { level })
  },

  decompress(data: Uint8Array): Uint8Array {
    return pako.ungzip(data)
  },
}

/**
 * Check if data is gzip compressed by examining magic bytes.
 * @param data - Data to check
 * @returns true if gzip compressed
 */
function isGzipCompressed(data: Uint8Array): boolean {
  return data.length >= 2 &&
    data[0] === GzipCodec.magicBytes[0] &&
    data[1] === GzipCodec.magicBytes[1]
}

// ============================================================================
// TAR HANDLER IMPLEMENTATION
// ============================================================================

/** TAR block and header sizes (USTAR format) */
const TAR_BLOCK_SIZE = 512
const TAR_HEADER_SIZE = 512

/** TAR type flags */
const TAR_TYPE = {
  FILE: 0x30,      // '0' - Regular file
  SYMLINK: 0x32,   // '2' - Symbolic link
  DIRECTORY: 0x35, // '5' - Directory
} as const

/**
 * TAR archive handler implementing USTAR format.
 */
const TarHandler: ArchiveHandler = {
  /**
   * Build a TAR archive from entries.
   * Creates USTAR format with 512-byte blocks.
   *
   * @param entries - Archive entries to include
   * @returns TAR archive data
   */
  build(entries: ArchiveEntry[]): Uint8Array {
    const blocks: Uint8Array[] = []

    for (const entry of entries) {
      // Add header block
      blocks.push(createTarHeader(entry))

      // Add content blocks (padded to block boundary)
      if (entry.type === 'file' && entry.content.length > 0) {
        blocks.push(BufferUtils.padToBlock(entry.content, TAR_BLOCK_SIZE))
      }
    }

    // Add two empty blocks at end (TAR terminator)
    blocks.push(BufferUtils.zeros(TAR_BLOCK_SIZE))
    blocks.push(BufferUtils.zeros(TAR_BLOCK_SIZE))

    return BufferUtils.concat(blocks)
  },

  /**
   * Parse a TAR archive into entries.
   *
   * @param data - TAR archive data
   * @returns Parsed archive entries
   */
  parse(data: Uint8Array): ArchiveEntry[] {
    const entries: ArchiveEntry[] = []
    let offset = 0

    while (offset + TAR_HEADER_SIZE <= data.length) {
      const header = data.slice(offset, offset + TAR_HEADER_SIZE)
      const entry = parseTarHeader(header)

      if (!entry) break // Empty block = end of archive

      offset += TAR_HEADER_SIZE

      // Read file content
      if (entry.type === 'file' && entry.content.length > 0) {
        const contentSize = entry.content.length
        const paddedSize = Math.ceil(contentSize / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE
        entry.content = data.slice(offset, offset + contentSize)
        offset += paddedSize
      }

      entries.push(entry)
    }

    return entries
  },
}

/**
 * Create a TAR header for an entry.
 *
 * USTAR header format (512 bytes):
 * - 0-99: File name
 * - 100-107: File mode (octal)
 * - 108-115: Owner UID (octal)
 * - 116-123: Owner GID (octal)
 * - 124-135: File size (octal)
 * - 136-147: Modification time (octal)
 * - 148-155: Checksum
 * - 156: Type flag
 * - 157-256: Link name
 * - 257-262: Magic "ustar\0"
 * - 263-264: Version "00"
 *
 * @param entry - Archive entry
 * @returns 512-byte TAR header
 */
function createTarHeader(entry: ArchiveEntry): Uint8Array {
  const header = new Uint8Array(TAR_HEADER_SIZE)
  const encoder = new TextEncoder()

  // Name (100 bytes at offset 0)
  const nameBytes = encoder.encode(entry.name)
  header.set(nameBytes.slice(0, 100), 0)

  // Mode (8 bytes at offset 100) - octal string
  const modeStr = entry.mode.toString(8).padStart(7, '0')
  header.set(encoder.encode(modeStr), 100)

  // UID (8 bytes at offset 108)
  header.set(encoder.encode('0000000'), 108)

  // GID (8 bytes at offset 116)
  header.set(encoder.encode('0000000'), 116)

  // Size (12 bytes at offset 124) - octal string
  const size = entry.type === 'file' ? entry.content.length : 0
  const sizeStr = size.toString(8).padStart(11, '0')
  header.set(encoder.encode(sizeStr), 124)

  // Mtime (12 bytes at offset 136) - octal seconds since epoch
  const mtimeSeconds = Math.floor(entry.mtime.getTime() / 1000)
  const mtimeStr = mtimeSeconds.toString(8).padStart(11, '0')
  header.set(encoder.encode(mtimeStr), 136)

  // Checksum placeholder (8 bytes at offset 148) - filled with spaces initially
  for (let i = 148; i < 156; i++) header[i] = 0x20

  // Type flag (1 byte at offset 156)
  header[156] = entry.type === 'file' ? TAR_TYPE.FILE :
    entry.type === 'directory' ? TAR_TYPE.DIRECTORY :
      TAR_TYPE.SYMLINK

  // Link name (100 bytes at offset 157)
  if (entry.linkname) {
    header.set(encoder.encode(entry.linkname).slice(0, 100), 157)
  }

  // USTAR magic (6 bytes at offset 257)
  header.set(encoder.encode('ustar'), 257)
  header[262] = 0x00

  // Version (2 bytes at offset 263)
  header.set(encoder.encode('00'), 263)

  // Calculate and set checksum
  let checksum = 0
  for (let i = 0; i < TAR_HEADER_SIZE; i++) {
    checksum += header[i]
  }
  const checksumStr = checksum.toString(8).padStart(6, '0')
  header.set(encoder.encode(checksumStr), 148)
  header[154] = 0x00
  header[155] = 0x20

  return header
}

/**
 * Parse a TAR header block.
 *
 * @param header - 512-byte header block
 * @returns Parsed entry or null if empty block (end of archive)
 */
function parseTarHeader(header: Uint8Array): ArchiveEntry | null {
  // Check if empty block (end of archive)
  let isEmpty = true
  for (let i = 0; i < TAR_HEADER_SIZE; i++) {
    if (header[i] !== 0) {
      isEmpty = false
      break
    }
  }
  if (isEmpty) return null

  const decoder = new TextDecoder()

  // Helper to extract null-terminated string
  const extractString = (start: number, length: number): string => {
    const bytes = header.slice(start, start + length)
    const nullIndex = bytes.indexOf(0)
    return decoder.decode(nullIndex >= 0 ? bytes.slice(0, nullIndex) : bytes)
  }

  // Parse fields
  const name = extractString(0, 100)
  const mode = parseInt(extractString(100, 7).trim(), 8) || 0o644
  const size = parseInt(extractString(124, 11).trim(), 8) || 0
  const mtimeSeconds = parseInt(extractString(136, 11).trim(), 8) || 0
  const typeFlag = header[156]
  const linkname = extractString(157, 100)

  // Determine entry type
  let type: 'file' | 'directory' | 'symlink' = 'file'
  if (typeFlag === TAR_TYPE.DIRECTORY || typeFlag === 53) type = 'directory'
  if (typeFlag === TAR_TYPE.SYMLINK || typeFlag === 50) type = 'symlink'

  return {
    name,
    content: new Uint8Array(size),
    mode,
    mtime: new Date(mtimeSeconds * 1000),
    type,
    linkname: linkname || undefined,
  }
}

// ============================================================================
// ZIP HANDLER IMPLEMENTATION
// ============================================================================

/**
 * ZIP archive handler using fflate library.
 */
export const ZipHandler: ArchiveHandler = {
  /**
   * Build a ZIP archive from entries.
   *
   * @param entries - Archive entries to include
   * @returns ZIP archive data
   */
  build(entries: ArchiveEntry[]): Uint8Array {
    const zipInput: fflate.Zippable = {}

    for (const entry of entries) {
      if (entry.type === 'file') {
        zipInput[entry.name] = [entry.content, { level: 6 }] as fflate.AsyncZippableFile
      }
      // Note: fflate handles directories implicitly from paths
    }

    return fflate.zipSync(zipInput)
  },

  /**
   * Parse a ZIP archive into entries.
   *
   * @param data - ZIP archive data
   * @returns Parsed archive entries
   */
  parse(data: Uint8Array): ArchiveEntry[] {
    const files = fflate.unzipSync(data)
    const entries: ArchiveEntry[] = []

    for (const [name, content] of Object.entries(files)) {
      entries.push({
        name,
        content,
        mode: 0o644,
        mtime: new Date(),
        type: 'file',
      })
    }

    return entries
  },
}

// ============================================================================
// RESULT HELPER
// ============================================================================

/**
 * Create a standardized BashResult for compression commands.
 *
 * @param command - Command name
 * @param stdout - Standard output
 * @param stderr - Standard error
 * @param exitCode - Exit code (0 = success)
 * @returns BashResult object
 */
function createResult(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number
): BashResult {
  return {
    input: command,
    command,
    valid: true,
    generated: false,
    stdout,
    stderr,
    exitCode,
    intent: {
      commands: [command],
      reads: [],
      writes: [],
      deletes: [],
      network: false,
      elevated: false,
    },
    classification: {
      type: 'execute',
      impact: 'none',
      reversible: true,
      reason: 'Compression operation',
    },
  }
}

// ============================================================================
// FILE COLLECTION UTILITIES
// ============================================================================

/**
 * Recursively collect files for tar archive creation.
 *
 * @param fs - Filesystem interface
 * @param fullPath - Absolute path to file/directory
 * @param relativePath - Relative path for archive entry
 * @param entries - Array to collect entries into
 * @param excludePatterns - Glob patterns to exclude
 */
async function collectTarEntries(
  fs: MockFs,
  fullPath: string,
  relativePath: string,
  entries: ArchiveEntry[],
  excludePatterns: string[]
): Promise<void> {
  // Check exclusions
  const filename = PathUtils.basename(relativePath)
  for (const pattern of excludePatterns) {
    if (matchGlob(filename, pattern)) {
      return
    }
  }

  if (!(await fs.exists(fullPath))) {
    return
  }

  const stat = await fs.stat(fullPath)

  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(fullPath)
    entries.push({
      name: relativePath,
      content: new Uint8Array(0),
      mode: 0o777,
      mtime: stat.mtime,
      type: 'symlink',
      linkname: target,
    })
  } else if (stat.isDirectory()) {
    entries.push({
      name: relativePath + '/',
      content: new Uint8Array(0),
      mode: stat.mode,
      mtime: stat.mtime,
      type: 'directory',
    })

    // Recurse into directory
    const children = await fs.readdir(fullPath)
    for (const child of children) {
      const childFull = PathUtils.join(fullPath, child)
      const childRel = relativePath + '/' + child
      await collectTarEntries(fs, childFull, childRel, entries, excludePatterns)
    }
  } else {
    const content = await fs.read(fullPath)
    entries.push({
      name: relativePath,
      content: BufferUtils.toBytes(content),
      mode: stat.mode,
      mtime: stat.mtime,
      type: 'file',
    })
  }
}

/**
 * Recursively collect files for zip archive creation.
 *
 * @param fs - Filesystem interface
 * @param fullPath - Absolute path to file/directory
 * @param relativePath - Relative path for archive entry
 * @param zipData - Object to collect entries into
 */
async function collectZipEntries(
  fs: MockFs,
  fullPath: string,
  relativePath: string,
  zipData: Record<string, Uint8Array>
): Promise<void> {
  const stat = await fs.stat(fullPath)

  if (stat.isDirectory()) {
    const children = await fs.readdir(fullPath)
    for (const child of children) {
      const childFull = PathUtils.join(fullPath, child)
      const childRel = relativePath + '/' + child
      await collectZipEntries(fs, childFull, childRel, zipData)
    }
  } else {
    const content = await fs.read(fullPath)
    zipData[relativePath] = BufferUtils.toBytes(content)
  }
}

// ============================================================================
// GZIP COMMAND
// ============================================================================

/**
 * Execute gzip command - compress or decompress files using gzip algorithm.
 *
 * Options:
 * - -d, --decompress: Decompress instead of compress
 * - -k, --keep: Keep original file
 * - -c, --stdout: Write to stdout
 * - -f, --force: Overwrite existing files
 * - -l, --list: Show compression info
 * - -1 to -9: Compression level
 * - --fast: Same as -1
 * - --best: Same as -9
 *
 * @param ctx - Command context
 * @returns Command result
 */
export async function gzip(ctx: CommandContext): Promise<BashResult> {
  const { args, cwd, fs } = ctx
  const { flags, options, positional } = parseArgs(args)

  // Parse options
  const decompress = flags.has('-d') || flags.has('--decompress')
  const keep = flags.has('-k') || flags.has('--keep')
  const toStdout = flags.has('-c') || flags.has('--stdout')
  const force = flags.has('-f') || flags.has('--force')
  const list = flags.has('-l') || flags.has('--list')

  // Determine compression level
  let level = 6
  if (options.has('-level')) {
    level = parseInt(options.get('-level')!, 10)
  }
  if (flags.has('--best')) level = 9
  if (flags.has('--fast')) level = 1

  if (positional.length === 0) {
    return createResult('gzip', '', 'gzip: missing operand', 1)
  }

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  for (const file of positional) {
    const fullPath = PathUtils.resolve(file, cwd)

    try {
      // Validate file exists
      const exists = await fs.exists(fullPath)
      if (!exists) {
        stderr += `gzip: ${file}: No such file or directory\n`
        exitCode = 1
        continue
      }

      // Skip directories
      const stat = await fs.stat(fullPath)
      if (stat.isDirectory()) {
        stderr += `gzip: ${file}: is a directory -- ignored\n`
        exitCode = 1
        continue
      }

      const content = await fs.read(fullPath)
      const bytes = BufferUtils.toBytes(content)

      // List mode - show compression info
      if (list) {
        if (fullPath.endsWith('.gz')) {
          try {
            const decompressed = GzipCodec.decompress(bytes)
            const ratio = ((1 - bytes.length / decompressed.length) * 100).toFixed(1)
            stdout += `compressed: ${bytes.length}, uncompressed: ${decompressed.length}, ratio: ${ratio}%\n`
          } catch {
            stderr += `gzip: ${file}: not in gzip format\n`
            exitCode = 1
          }
        } else {
          stderr += `gzip: ${file}: not in gzip format\n`
          exitCode = 1
        }
        continue
      }

      // Decompress mode
      if (decompress) {
        try {
          const decompressed = GzipCodec.decompress(bytes)

          if (toStdout) {
            stdout += BufferUtils.bytesToString(decompressed)
          } else {
            const outPath = fullPath.replace(/\.gz$/, '')
            await fs.write(outPath, BufferUtils.toStringOrBinary(decompressed))
            if (!keep) {
              await fs.rm(fullPath)
            }
          }
        } catch {
          stderr += `gzip: ${file}: invalid compressed data--format violated\n`
          exitCode = 1
        }
        continue
      }

      // Compress mode
      const compressed = GzipCodec.compress(bytes, { level })
      const outPath = fullPath + '.gz'

      if (toStdout) {
        // Return binary result for stdout
        return {
          input: `gzip ${args.join(' ')}`,
          command: 'gzip',
          valid: true,
          generated: false,
          stdout: compressed,
          stderr: '',
          exitCode: 0,
          intent: { commands: ['gzip'], reads: [fullPath], writes: [], deletes: [], network: false, elevated: false },
          classification: { type: 'execute', impact: 'none', reversible: true, reason: 'Compression' },
        } as unknown as BashResult
      }

      // Check if output exists
      if (!force && await fs.exists(outPath)) {
        stderr += `gzip: ${file}.gz already exists; not overwritten\n`
        exitCode = 1
        continue
      }

      await fs.write(outPath, compressed)
      if (!keep) {
        await fs.rm(fullPath)
      }
    } catch (error) {
      stderr += `gzip: ${file}: ${error instanceof Error ? error.message : String(error)}\n`
      exitCode = 1
    }
  }

  return createResult('gzip', stdout, stderr, exitCode)
}

// ============================================================================
// GUNZIP COMMAND
// ============================================================================

/**
 * Execute gunzip command - decompress gzip files.
 *
 * Options:
 * - -k, --keep: Keep original .gz file
 * - -c, --stdout: Write to stdout
 *
 * @param ctx - Command context
 * @returns Command result
 */
export async function gunzip(ctx: CommandContext): Promise<BashResult> {
  const { args, cwd, fs } = ctx
  const { flags, positional } = parseArgs(args)

  const keep = flags.has('-k') || flags.has('--keep')
  const toStdout = flags.has('-c') || flags.has('--stdout')

  if (positional.length === 0) {
    return createResult('gunzip', '', 'gunzip: missing operand', 1)
  }

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  for (const file of positional) {
    const fullPath = PathUtils.resolve(file, cwd)

    try {
      const exists = await fs.exists(fullPath)
      if (!exists) {
        stderr += `gunzip: ${file}: No such file or directory\n`
        exitCode = 1
        continue
      }

      const content = await fs.read(fullPath)
      const bytes = BufferUtils.toBytes(content)

      try {
        const decompressed = GzipCodec.decompress(bytes)

        if (toStdout) {
          stdout += BufferUtils.bytesToString(decompressed)
        } else {
          const outPath = fullPath.replace(/\.gz$/, '')
          await fs.write(outPath, BufferUtils.toStringOrBinary(decompressed))
          if (!keep) {
            await fs.rm(fullPath)
          }
        }
      } catch {
        stderr += `gunzip: ${file}: invalid compressed data--format violated\n`
        exitCode = 1
      }
    } catch (error) {
      stderr += `gunzip: ${file}: ${error instanceof Error ? error.message : String(error)}\n`
      exitCode = 1
    }
  }

  return createResult('gunzip', stdout, stderr, exitCode)
}

// ============================================================================
// ZCAT COMMAND
// ============================================================================

/**
 * Execute zcat command - decompress to stdout.
 * Equivalent to gunzip -c.
 *
 * @param ctx - Command context
 * @returns Command result
 */
export async function zcat(ctx: CommandContext): Promise<BashResult> {
  const { args, cwd, fs } = ctx
  const { positional } = parseArgs(args)

  if (positional.length === 0) {
    return createResult('zcat', '', 'zcat: missing operand', 1)
  }

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  for (const file of positional) {
    const fullPath = PathUtils.resolve(file, cwd)

    try {
      const exists = await fs.exists(fullPath)
      if (!exists) {
        stderr += `zcat: ${file}: No such file or directory\n`
        exitCode = 1
        continue
      }

      const content = await fs.read(fullPath)
      const bytes = BufferUtils.toBytes(content)

      try {
        const decompressed = GzipCodec.decompress(bytes)
        stdout += BufferUtils.bytesToString(decompressed)
      } catch {
        stderr += `zcat: ${file}: invalid compressed data--format violated\n`
        exitCode = 1
      }
    } catch (error) {
      stderr += `zcat: ${file}: ${error instanceof Error ? error.message : String(error)}\n`
      exitCode = 1
    }
  }

  return createResult('zcat', stdout, stderr, exitCode)
}

// ============================================================================
// TAR COMMAND
// ============================================================================

/** Parsed tar command options */
interface TarOptions {
  create: boolean
  extract: boolean
  list: boolean
  verbose: boolean
  useGzip: boolean
  archiveFile: string | null
  files: string[]
  extractDir: string
  excludePatterns: string[]
}

/**
 * Parse tar command arguments.
 * Handles special tar syntax like -cvf, -xvzf, etc.
 *
 * @param args - Command arguments
 * @param cwd - Current working directory
 * @returns Parsed tar options
 */
function parseTarArgs(args: string[], cwd: string): TarOptions {
  const result: TarOptions = {
    create: false,
    extract: false,
    list: false,
    verbose: false,
    useGzip: false,
    archiveFile: null,
    files: [],
    extractDir: cwd,
    excludePatterns: [],
  }

  let expectArchive = false
  let expectDir = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (expectArchive) {
      result.archiveFile = arg
      expectArchive = false
      continue
    }
    if (expectDir) {
      result.extractDir = arg.startsWith('/') ? arg : PathUtils.resolve(arg, cwd)
      expectDir = false
      continue
    }

    if (arg === '-C' || arg === '--directory') {
      expectDir = true
      continue
    }
    if (arg === '-f' || arg === '--file') {
      expectArchive = true
      continue
    }
    if (arg.startsWith('--exclude=')) {
      result.excludePatterns.push(arg.slice('--exclude='.length))
      continue
    }
    if (arg.startsWith('--')) {
      continue // Ignore other long options
    }

    if (arg.startsWith('-') && arg.length > 1 && !/^-[0-9]/.test(arg)) {
      // Parse combined flags like -cvf, -xvf, -czvf
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j]
        switch (flag) {
          case 'c': result.create = true; break
          case 'x': result.extract = true; break
          case 't': result.list = true; break
          case 'v': result.verbose = true; break
          case 'z': result.useGzip = true; break
          case 'f':
            if (j < arg.length - 1) {
              result.archiveFile = arg.slice(j + 1)
              j = arg.length
            } else {
              expectArchive = true
            }
            break
        }
      }
    } else {
      result.files.push(arg)
    }
  }

  // Handle positional archive file
  if (!result.archiveFile && result.files.length > 0) {
    result.archiveFile = result.files[0]
    result.files = result.files.slice(1)
  }

  return result
}

/**
 * Execute tar command - create, extract, or list tar archives.
 *
 * Options:
 * - -c: Create archive
 * - -x: Extract archive
 * - -t: List archive contents
 * - -v: Verbose output
 * - -z: Use gzip compression
 * - -f FILE: Archive file
 * - -C DIR: Change to directory
 * - --exclude=PATTERN: Exclude files matching pattern
 *
 * @param ctx - Command context
 * @returns Command result
 */
export async function tar(ctx: CommandContext): Promise<BashResult> {
  const { args, cwd, fs } = ctx
  const opts = parseTarArgs(args, cwd)

  if (!opts.archiveFile) {
    return createResult('tar', '', 'tar: You must specify one of the options', 1)
  }

  const archivePath = PathUtils.resolve(opts.archiveFile, cwd)
  const isGzipped = opts.useGzip ||
    archivePath.endsWith('.tar.gz') ||
    archivePath.endsWith('.tgz')

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  try {
    if (opts.create) {
      // Create archive
      const entries: ArchiveEntry[] = []

      for (const file of opts.files) {
        const fullPath = PathUtils.resolve(file, cwd)
        await collectTarEntries(fs, fullPath, file, entries, opts.excludePatterns)
      }

      // Check for missing files
      if (entries.length === 0 && opts.files.length > 0) {
        for (const file of opts.files) {
          const fullPath = PathUtils.resolve(file, cwd)
          if (!(await fs.exists(fullPath))) {
            stderr += `tar: ${file}: Cannot stat: No such file or directory\n`
            exitCode = 1
          }
        }
        if (exitCode !== 0) {
          return createResult('tar', stdout, stderr, exitCode)
        }
      }

      // Build archive
      let tarData = TarHandler.build(entries)

      // Optionally compress with gzip
      if (isGzipped) {
        tarData = GzipCodec.compress(tarData)
      }

      await fs.write(archivePath, tarData)

      if (opts.verbose) {
        for (const entry of entries) {
          stdout += entry.name + '\n'
        }
      }
    } else if (opts.extract) {
      // Extract archive
      if (!(await fs.exists(archivePath))) {
        stderr += `tar: ${opts.archiveFile}: Cannot open: No such file or directory\n`
        return createResult('tar', stdout, stderr, 1)
      }

      const archiveContent = await fs.read(archivePath)
      let tarData = BufferUtils.toBytes(archiveContent)

      // Decompress if gzipped
      if (isGzipped || isGzipCompressed(tarData)) {
        try {
          tarData = GzipCodec.decompress(tarData)
        } catch {
          stderr += `tar: ${opts.archiveFile}: invalid compressed data\n`
          return createResult('tar', stdout, stderr, 1)
        }
      }

      // Parse and extract
      const entries = TarHandler.parse(tarData)

      if (entries.length === 0 && tarData.length > 0) {
        stderr += `tar: ${opts.archiveFile}: invalid tar format\n`
        return createResult('tar', stdout, stderr, 1)
      }

      for (const entry of entries) {
        const outPath = PathUtils.resolve(entry.name, opts.extractDir)

        if (entry.type === 'directory') {
          await fs.mkdir(outPath, { recursive: true })
        } else if (entry.type === 'symlink') {
          await fs.symlink(entry.linkname!, outPath)
        } else {
          // Ensure parent directory exists
          const parentDir = PathUtils.dirname(outPath)
          if (parentDir && !(await fs.exists(parentDir))) {
            await fs.mkdir(parentDir, { recursive: true })
          }

          // Write file with preserved mode/mtime
          await fs.write(outPath, BufferUtils.toStringOrBinary(entry.content))
          const fileData = fs.files.get(outPath)
          if (fileData) {
            fileData.mode = entry.mode
            fileData.mtime = entry.mtime
          }
        }

        if (opts.verbose) {
          stdout += entry.name + '\n'
        }
      }
    } else if (opts.list) {
      // List archive contents
      if (!(await fs.exists(archivePath))) {
        stderr += `tar: ${opts.archiveFile}: Cannot open: No such file or directory\n`
        return createResult('tar', stdout, stderr, 1)
      }

      const archiveContent = await fs.read(archivePath)
      let tarData = BufferUtils.toBytes(archiveContent)

      if (isGzipped || isGzipCompressed(tarData)) {
        try {
          tarData = GzipCodec.decompress(tarData)
        } catch {
          stderr += `tar: ${opts.archiveFile}: invalid compressed data\n`
          return createResult('tar', stdout, stderr, 1)
        }
      }

      const entries = TarHandler.parse(tarData)

      for (const entry of entries) {
        if (opts.verbose) {
          const modeStr = entry.mode.toString(8).padStart(4, '0')
          const sizeStr = entry.content.length.toString().padStart(8, ' ')
          stdout += `${modeStr} ${sizeStr} ${entry.name}\n`
        } else {
          stdout += entry.name + '\n'
        }
      }
    }
  } catch (error) {
    stderr += `tar: ${error instanceof Error ? error.message : String(error)}\n`
    exitCode = 1
  }

  return createResult('tar', stdout, stderr, exitCode)
}

// ============================================================================
// ZIP COMMAND
// ============================================================================

/**
 * Execute zip command - create zip archives.
 *
 * Options:
 * - -r, --recurse-paths: Recurse into directories
 * - -1 to -9: Compression level
 *
 * @param ctx - Command context
 * @returns Command result
 */
export async function zip(ctx: CommandContext): Promise<BashResult> {
  const { args, cwd, fs } = ctx
  const { flags, options, positional } = parseArgs(args)

  const recursive = flags.has('-r') || flags.has('--recurse-paths')

  // Get compression level
  let level = 6
  if (options.has('-level')) {
    level = parseInt(options.get('-level')!, 10)
  }

  if (positional.length < 2) {
    return createResult('zip', '', 'zip: missing archive name and/or files', 1)
  }

  const archiveFile = positional[0]
  const files = positional.slice(1)
  const archivePath = PathUtils.resolve(archiveFile, cwd)

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  try {
    // Collect all files
    const zipData: Record<string, Uint8Array> = {}

    // Read existing archive if present
    if (await fs.exists(archivePath)) {
      const existingContent = await fs.read(archivePath)
      const existingBytes = BufferUtils.toBytes(existingContent)
      try {
        const existingFiles = fflate.unzipSync(existingBytes)
        for (const [name, content] of Object.entries(existingFiles)) {
          zipData[name] = content
        }
      } catch {
        // Ignore - start fresh
      }
    }

    // Add new files
    for (const file of files) {
      const fullPath = PathUtils.resolve(file, cwd)

      if (!(await fs.exists(fullPath))) {
        stderr += `zip: ${file}: No such file or directory\n`
        exitCode = 1
        continue
      }

      const stat = await fs.stat(fullPath)

      if (stat.isDirectory()) {
        if (recursive) {
          await collectZipEntries(fs, fullPath, file, zipData)
        } else {
          stderr += `zip: ${file}: is a directory (use -r to include)\n`
        }
      } else {
        const content = await fs.read(fullPath)
        zipData[file] = BufferUtils.toBytes(content)
        stdout += `  adding: ${file}\n`
      }
    }

    // Create zip with compression
    const zipOptions: fflate.Zippable = {}
    for (const [name, content] of Object.entries(zipData)) {
      zipOptions[name] = [content, { level }] as fflate.AsyncZippableFile
    }

    const zipResult = fflate.zipSync(zipOptions)
    await fs.write(archivePath, zipResult)
  } catch (error) {
    stderr += `zip: ${error instanceof Error ? error.message : String(error)}\n`
    exitCode = 1
  }

  return createResult('zip', stdout, stderr, exitCode)
}

// ============================================================================
// UNZIP COMMAND
// ============================================================================

/** Parsed unzip command options */
interface UnzipOptions {
  listOnly: boolean
  toStdout: boolean
  overwrite: boolean
  destDir: string
  archiveFile: string | null
  selectFiles: string[]
}

/**
 * Parse unzip command arguments.
 *
 * @param args - Command arguments
 * @param cwd - Current working directory
 * @returns Parsed unzip options
 */
function parseUnzipArgs(args: string[], cwd: string): UnzipOptions {
  const result: UnzipOptions = {
    listOnly: false,
    toStdout: false,
    overwrite: false,
    destDir: cwd,
    archiveFile: null,
    selectFiles: [],
  }

  let expectDest = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (expectDest) {
      result.destDir = arg.startsWith('/') ? arg : PathUtils.resolve(arg, cwd)
      expectDest = false
      continue
    }

    if (arg === '-d') {
      expectDest = true
      continue
    }
    if (arg === '-l' || arg === '--list') {
      result.listOnly = true
      continue
    }
    if (arg === '-p' || arg === '--pipe') {
      result.toStdout = true
      continue
    }
    if (arg === '-o' || arg === '--overwrite') {
      result.overwrite = true
      continue
    }
    if (arg.startsWith('-')) {
      continue // Ignore other flags
    }

    // Positional arguments
    if (!result.archiveFile) {
      result.archiveFile = arg
    } else {
      result.selectFiles.push(arg)
    }
  }

  return result
}

/**
 * Execute unzip command - extract zip archives.
 *
 * Options:
 * - -l, --list: List contents only
 * - -p, --pipe: Extract to stdout
 * - -o, --overwrite: Overwrite existing files
 * - -d DIR: Extract to directory
 *
 * @param ctx - Command context
 * @returns Command result
 */
export async function unzip(ctx: CommandContext): Promise<BashResult> {
  const { args, cwd, fs } = ctx
  const opts = parseUnzipArgs(args, cwd)

  if (!opts.archiveFile) {
    return createResult('unzip', '', 'unzip: missing archive name', 1)
  }

  const archivePath = PathUtils.resolve(opts.archiveFile, cwd)

  let stdout = ''
  let stderr = ''
  let exitCode = 0

  try {
    if (!(await fs.exists(archivePath))) {
      stderr += `unzip: cannot find or open ${opts.archiveFile}\n`
      return createResult('unzip', stdout, stderr, 1)
    }

    const archiveContent = await fs.read(archivePath)
    const bytes = BufferUtils.toBytes(archiveContent)

    let files: Record<string, Uint8Array>
    try {
      files = fflate.unzipSync(bytes)
    } catch {
      stderr += `unzip: ${opts.archiveFile}: invalid zip file\n`
      return createResult('unzip', stdout, stderr, 1)
    }

    // Filter files if specific ones requested
    const fileNames = Object.keys(files)
    const filesToProcess = opts.selectFiles.length > 0
      ? fileNames.filter(name => opts.selectFiles.includes(name))
      : fileNames

    // Check if requested files exist
    if (opts.selectFiles.length > 0) {
      for (const name of opts.selectFiles) {
        if (!fileNames.includes(name)) {
          stderr += `unzip: ${name}: file not found in archive\n`
          exitCode = 1
        }
      }
      if (exitCode !== 0 && filesToProcess.length === 0) {
        return createResult('unzip', stdout, stderr, exitCode)
      }
    }

    if (opts.listOnly) {
      // List contents
      stdout += '  Length      Name\n'
      stdout += '---------  --------------------\n'
      for (const name of filesToProcess) {
        const content = files[name]
        stdout += `${content.length.toString().padStart(9)}  ${name}\n`
      }
    } else if (opts.toStdout) {
      // Extract to stdout
      for (const name of filesToProcess) {
        const content = files[name]
        stdout += BufferUtils.bytesToString(content)
      }
    } else {
      // Create destination directory if needed
      if (!(await fs.exists(opts.destDir))) {
        await fs.mkdir(opts.destDir, { recursive: true })
      }

      // Extract files
      for (const name of filesToProcess) {
        const content = files[name]
        const outPath = PathUtils.resolve(name, opts.destDir)

        // Create parent directories
        const parentDir = PathUtils.dirname(outPath)
        if (parentDir && !(await fs.exists(parentDir))) {
          await fs.mkdir(parentDir, { recursive: true })
        }

        // Check for overwrite
        if (!opts.overwrite && await fs.exists(outPath)) {
          continue // Skip in non-interactive mode
        }

        await fs.write(outPath, BufferUtils.toStringOrBinary(content))
      }
    }
  } catch (error) {
    stderr += `unzip: ${error instanceof Error ? error.message : String(error)}\n`
    exitCode = 1
  }

  return createResult('unzip', stdout, stderr, exitCode)
}

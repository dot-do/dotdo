/**
 * Tarball extraction for npm packages
 *
 * Handles decompression, tar parsing, and file extraction
 */

import { decompress, isGzipData } from './decompress'
import { parseTarHeader, parsePaxHeaders } from './tar'
import { SecurityError } from '../errors'
import {
  TAR_BLOCK_SIZE,
  type TarEntry,
  type ExtractOptions,
  type PaxExtendedHeader,
  type VirtualFS,
} from './types'

/**
 * Extract a tarball to an array of entries
 *
 * @param data - Tarball data (gzipped or raw tar)
 * @param options - Extraction options
 * @returns Array of extracted entries
 */
export async function extractTarball(
  data: Uint8Array,
  options: ExtractOptions = {}
): Promise<TarEntry[]> {
  const { stripPrefix = 0, output, secure = false, onProgress, startOffset = 0, limit } = options

  // Decompress if gzipped
  let tarData: Uint8Array
  if (isGzipData(data)) {
    tarData = await decompress(data)
  } else {
    tarData = data
  }

  const entries: TarEntry[] = []
  let offset = startOffset
  let entryCount = 0
  let paxHeaders: PaxExtendedHeader = {}
  let gnuLongName: string | null = null
  let gnuLongLink: string | null = null

  while (offset + TAR_BLOCK_SIZE <= tarData.length) {
    // Check limit
    if (limit !== undefined && entryCount >= limit) {
      break
    }

    const headerBlock = tarData.subarray(offset, offset + TAR_BLOCK_SIZE)
    const header = parseTarHeader(headerBlock)

    // End of archive
    if (header.isNullBlock) {
      // Check for second null block
      if (offset + TAR_BLOCK_SIZE * 2 <= tarData.length) {
        const nextBlock = tarData.subarray(offset + TAR_BLOCK_SIZE, offset + TAR_BLOCK_SIZE * 2)
        if (nextBlock.every((b) => b === 0)) {
          break
        }
      }
      offset += TAR_BLOCK_SIZE
      continue
    }

    if (!header.checksumValid) {
      // Skip invalid headers
      offset += TAR_BLOCK_SIZE
      continue
    }

    // Calculate content offset and size
    const contentOffset = offset + TAR_BLOCK_SIZE
    const contentSize = header.size
    const paddedSize = Math.ceil(contentSize / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE

    // Handle special entry types
    if (header.type === 'pax-global' || header.type === 'pax-extended') {
      // Parse PAX extended headers
      const content = tarData.subarray(contentOffset, contentOffset + contentSize)
      paxHeaders = { ...paxHeaders, ...parsePaxHeaders(content) }
      offset += TAR_BLOCK_SIZE + paddedSize
      continue
    }

    if (header.type === 'gnu-longname') {
      // GNU long filename
      const content = tarData.subarray(contentOffset, contentOffset + contentSize)
      gnuLongName = new TextDecoder().decode(content).replace(/\0+$/, '')
      offset += TAR_BLOCK_SIZE + paddedSize
      continue
    }

    if (header.type === 'gnu-longlink') {
      // GNU long link name
      const content = tarData.subarray(contentOffset, contentOffset + contentSize)
      gnuLongLink = new TextDecoder().decode(content).replace(/\0+$/, '')
      offset += TAR_BLOCK_SIZE + paddedSize
      continue
    }

    // Apply PAX/GNU overrides
    let name = gnuLongName || (paxHeaders.path as string) || header.fullPath || header.name
    let linkname = gnuLongLink || (paxHeaders.linkpath as string) || header.linkname
    let size = (paxHeaders.size as number) ?? contentSize
    let uid = (paxHeaders.uid as number) ?? header.uid
    let gid = (paxHeaders.gid as number) ?? header.gid
    let mtime = header.mtime

    if (paxHeaders.mtime !== undefined) {
      // PAX mtime can have sub-second precision
      mtime = new Date((paxHeaders.mtime as number) * 1000)
    }

    // Security check for path traversal
    if (secure) {
      validatePath(name)
      if (linkname) {
        validateSymlinkTarget(name, linkname)
      }
    }

    // Strip prefix from path
    const strippedName = stripPrefixFromPath(name, stripPrefix)

    // Extract content
    const content =
      header.type === 'file' || header.type === 'contiguous'
        ? tarData.subarray(contentOffset, contentOffset + size)
        : new Uint8Array(0)

    const entry: TarEntry = {
      name: strippedName,
      type: header.type,
      mode: header.mode,
      uid,
      gid,
      size,
      mtime,
      content,
    }

    // Only set linkname if it exists (satisfies exactOptionalPropertyTypes)
    if (linkname) {
      entry.linkname = linkname
    }

    // Call progress callback
    if (onProgress) {
      onProgress(entry, offset + TAR_BLOCK_SIZE + paddedSize)
    }

    // Write to virtual filesystem if provided
    if (output) {
      await writeToFS(entry, output, secure)
    }

    entries.push(entry)
    entryCount++

    // Reset PAX/GNU headers for next entry
    paxHeaders = {}
    gnuLongName = null
    gnuLongLink = null

    // Move to next entry
    offset += TAR_BLOCK_SIZE + paddedSize
  }

  return entries
}

/**
 * Strip prefix components from a path
 */
function stripPrefixFromPath(path: string, count: number): string {
  if (count <= 0) return path

  const parts = path.split('/')
  return parts.slice(count).join('/')
}

/**
 * Validate a path for security (no traversal attacks)
 */
function validatePath(path: string): void {
  const normalized = path.replace(/\\/g, '/')

  // Check for path traversal
  if (normalized.includes('../') || normalized.startsWith('/') || normalized.includes('/./')) {
    throw new SecurityError(`Path traversal detected in "${path}"`, { severity: 'critical' })
  }

  // Check for absolute paths on Windows
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new SecurityError(`Absolute path detected in "${path}"`, { severity: 'critical' })
  }
}

/**
 * Validate symlink target for security
 */
function validateSymlinkTarget(path: string, target: string): void {
  // Calculate how many directories we'd need to go up
  const pathParts = path.split('/').filter((p) => p && p !== '.')
  const targetParts = target.split('/').filter((p) => p)

  let depth = pathParts.length - 1 // Current directory depth (file is at pathParts.length - 1 level)
  for (const part of targetParts) {
    if (part === '..') {
      depth--
      if (depth < 0) {
        throw new SecurityError(`Symlink escape detected in "${path}" -> "${target}"`, { severity: 'critical' })
      }
    } else if (part !== '.') {
      depth++
    }
  }
}

/**
 * Write an entry to a virtual filesystem
 */
async function writeToFS(entry: TarEntry, fs: VirtualFS, _secure: boolean): Promise<void> {
  const path = entry.name.startsWith('/') ? entry.name : '/' + entry.name

  // Create parent directories
  if (fs.mkdirSync) {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      const dir = '/' + parts.slice(0, i).join('/')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
  }

  switch (entry.type) {
    case 'file':
    case 'contiguous':
      fs.writeFileSync(path, entry.content, { mode: entry.mode })
      break

    case 'directory':
      if (fs.mkdirSync) {
        const dirPath = path.endsWith('/') ? path.slice(0, -1) : path
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true })
        }
      }
      break

    case 'symlink':
      if (fs.symlinkSync && entry.linkname) {
        fs.symlinkSync(entry.linkname, path)
      }
      break

    case 'hardlink':
      // For hardlinks, we'd need to copy the original file's content
      // Most virtual filesystems don't support true hardlinks
      break
  }
}

/**
 * Streaming extraction generator
 *
 * @param stream - Readable stream of tarball data
 * @yields Tar entries as they are extracted
 */
export async function* streamExtractTarball(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<TarEntry> {
  const reader = stream.getReader()
  let buffer = new Uint8Array(0)
  let paxHeaders: PaxExtendedHeader = {}
  let gnuLongName: string | null = null
  let gnuLongLink: string | null = null

  // Helper to ensure we have enough bytes
  async function ensureBytes(needed: number): Promise<boolean> {
    while (buffer.length < needed) {
      const { done, value } = await reader.read()
      if (done) return false
      const newBuffer = new Uint8Array(buffer.length + value.length)
      newBuffer.set(buffer)
      newBuffer.set(value, buffer.length)
      buffer = newBuffer
    }
    return true
  }

  // Consume bytes from buffer
  function consume(count: number): Uint8Array {
    const result = buffer.subarray(0, count)
    buffer = buffer.subarray(count)
    return result
  }

  while (await ensureBytes(TAR_BLOCK_SIZE)) {
    const headerBlock = consume(TAR_BLOCK_SIZE)
    const header = parseTarHeader(headerBlock)

    if (header.isNullBlock) continue
    if (!header.checksumValid) continue

    const contentSize = header.size
    const paddedSize = Math.ceil(contentSize / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE

    // Ensure we have the content
    if (!(await ensureBytes(paddedSize))) break

    // Handle special entry types
    if (header.type === 'pax-global' || header.type === 'pax-extended') {
      const content = consume(paddedSize).subarray(0, contentSize)
      paxHeaders = { ...paxHeaders, ...parsePaxHeaders(content) }
      continue
    }

    if (header.type === 'gnu-longname') {
      const content = consume(paddedSize).subarray(0, contentSize)
      gnuLongName = new TextDecoder().decode(content).replace(/\0+$/, '')
      continue
    }

    if (header.type === 'gnu-longlink') {
      const content = consume(paddedSize).subarray(0, contentSize)
      gnuLongLink = new TextDecoder().decode(content).replace(/\0+$/, '')
      continue
    }

    // Get content
    const fullContent = consume(paddedSize)
    const content =
      header.type === 'file' || header.type === 'contiguous'
        ? fullContent.subarray(0, contentSize)
        : new Uint8Array(0)

    // Apply PAX/GNU overrides
    const name = gnuLongName || (paxHeaders.path as string) || header.fullPath || header.name
    const linkname = gnuLongLink || (paxHeaders.linkpath as string) || header.linkname
    const size = (paxHeaders.size as number) ?? contentSize
    const uid = (paxHeaders.uid as number) ?? header.uid
    const gid = (paxHeaders.gid as number) ?? header.gid
    let mtime = header.mtime

    if (paxHeaders.mtime !== undefined) {
      mtime = new Date((paxHeaders.mtime as number) * 1000)
    }

    const entry: TarEntry = {
      name,
      type: header.type,
      mode: header.mode,
      uid,
      gid,
      size,
      mtime,
      content,
    }

    // Only set linkname if it exists (satisfies exactOptionalPropertyTypes)
    if (linkname) {
      entry.linkname = linkname
    }

    yield entry

    // Reset for next entry
    paxHeaders = {}
    gnuLongName = null
    gnuLongLink = null
  }

  reader.releaseLock()
}

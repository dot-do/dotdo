/**
 * Test utilities for fsx filesystem tests
 *
 * Provides in-memory storage backend and helper functions for creating
 * test files and directories.
 */

import { constants } from '../core/constants'
import { PathValidator, pathValidator } from '../do/security'

// ============================================================================
// HEADER PARSING UTILITIES
// ============================================================================

/**
 * Parsed options from X-FSx-Options header
 */
export interface StreamWriteOptions {
  mode?: number
  flag?: 'w' | 'wx' | 'a' | 'ax'
}

/**
 * Parse headers from either Headers object or plain object
 */
function getHeader(headers: Record<string, string> | Headers | undefined, name: string): string | null {
  if (!headers) return null
  if (headers instanceof Headers) {
    return headers.get(name)
  }
  return headers[name] ?? null
}

/**
 * Parse stream write options from X-FSx-Options header
 * @param optionsHeader - Raw header value
 * @returns Parsed options or error object
 */
function parseStreamWriteOptions(optionsHeader: string | null): StreamWriteOptions | { error: string } {
  if (!optionsHeader) return {}
  try {
    return JSON.parse(optionsHeader) as StreamWriteOptions
  } catch {
    return { error: 'Invalid JSON in X-FSx-Options header' }
  }
}

/**
 * Convert request body to Uint8Array
 */
async function bodyToUint8Array(body: BodyInit | null | undefined): Promise<Uint8Array> {
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }
  if (body instanceof Uint8Array) {
    return body
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body)
  }
  if (body === null || body === undefined) {
    return new Uint8Array(0)
  }
  // Handle ReadableStream or other body types
  try {
    const response = new Response(body)
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return new Uint8Array(0)
  }
}

// ============================================================================
// STREAM WRITE RESPONSE BUILDER
// ============================================================================

/**
 * Build successful stream write response
 */
function buildStreamWriteResponse(params: {
  path: string
  size: number
  mode: number
  created: boolean
  mtime: number
}): Response {
  return new Response(
    JSON.stringify({
      success: true,
      path: params.path,
      size: params.size,
      mode: params.mode & 0o777,
      created: params.created,
      mtime: params.mtime,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * Build error response for stream write
 */
function buildStreamWriteError(code: string, message: string, path?: string, status: number = 400): Response {
  const body: Record<string, string> = { code, message }
  if (path) body.path = path
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * File entry stored in the in-memory filesystem
 */
export interface MemoryFileEntry {
  type: 'file' | 'directory' | 'symlink'
  mode: number
  content: Uint8Array
  linkTarget?: string
  uid: number
  gid: number
  atime: number
  mtime: number
  ctime: number
  birthtime: number
  nlink: number
}

/**
 * In-memory storage backend for testing filesystem operations
 *
 * This class simulates a filesystem in memory, providing all the storage
 * operations needed by the fsx filesystem implementation.
 */
export class InMemoryStorage {
  private entries: Map<string, MemoryFileEntry> = new Map()
  private nextInode: number = 1

  constructor() {
    // Initialize with root directory
    this.entries.set('/', {
      type: 'directory',
      mode: 0o755 | constants.S_IFDIR,
      content: new Uint8Array(0),
      uid: 0,
      gid: 0,
      atime: Date.now(),
      mtime: Date.now(),
      ctime: Date.now(),
      birthtime: Date.now(),
      nlink: 2,
    })
  }

  /**
   * Normalize a path: resolve . and .., remove double slashes, ensure starts with /
   */
  normalizePath(path: string): string {
    // Ensure starts with /
    if (!path.startsWith('/')) {
      path = '/' + path
    }

    // Split and process
    const segments = path.split('/').filter((s) => s !== '' && s !== '.')
    const result: string[] = []

    for (const segment of segments) {
      if (segment === '..') {
        result.pop()
      } else {
        result.push(segment)
      }
    }

    return '/' + result.join('/')
  }

  /**
   * Get parent path
   */
  getParentPath(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return normalized.substring(0, lastSlash)
  }

  /**
   * Get file name from path
   */
  getFileName(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    return normalized.substring(lastSlash + 1)
  }

  /**
   * Check if an entry exists
   */
  has(path: string): boolean {
    return this.entries.has(this.normalizePath(path))
  }

  /**
   * Get an entry
   */
  get(path: string): MemoryFileEntry | undefined {
    return this.entries.get(this.normalizePath(path))
  }

  /**
   * Check if path is a directory
   */
  isDirectory(path: string): boolean {
    const entry = this.get(path)
    return entry?.type === 'directory'
  }

  /**
   * Check if path is a file
   */
  isFile(path: string): boolean {
    const entry = this.get(path)
    return entry?.type === 'file'
  }

  /**
   * Check if path is a symlink
   */
  isSymlink(path: string): boolean {
    const entry = this.get(path)
    return entry?.type === 'symlink'
  }

  /**
   * Check if parent directory exists
   */
  parentExists(path: string): boolean {
    const parentPath = this.getParentPath(path)
    return this.isDirectory(parentPath)
  }

  /**
   * Add a file
   */
  addFile(
    path: string,
    content: Uint8Array | string,
    options?: {
      mode?: number
      uid?: number
      gid?: number
      birthtime?: number
    }
  ): void {
    // Validate input path for security
    pathValidator.validateInput(path)

    const normalized = this.normalizePath(path)
    const now = Date.now()
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content

    this.entries.set(normalized, {
      type: 'file',
      mode: (options?.mode ?? 0o644) | constants.S_IFREG,
      content: bytes,
      uid: options?.uid ?? 0,
      gid: options?.gid ?? 0,
      atime: now,
      mtime: now,
      ctime: now,
      birthtime: options?.birthtime ?? now,
      nlink: 1,
    })
  }

  /**
   * Add a directory
   */
  addDirectory(
    path: string,
    options?: {
      mode?: number
      uid?: number
      gid?: number
    }
  ): void {
    // Validate input path for security
    pathValidator.validateInput(path)

    const normalized = this.normalizePath(path)
    const now = Date.now()

    this.entries.set(normalized, {
      type: 'directory',
      mode: (options?.mode ?? 0o755) | constants.S_IFDIR,
      content: new Uint8Array(0),
      uid: options?.uid ?? 0,
      gid: options?.gid ?? 0,
      atime: now,
      mtime: now,
      ctime: now,
      birthtime: now,
      nlink: 2,
    })
  }

  /**
   * Add a symbolic link
   */
  addSymlink(path: string, target: string): void {
    // Validate input paths for security
    pathValidator.validateInput(path)
    pathValidator.validateInput(target)

    const normalized = this.normalizePath(path)
    const now = Date.now()

    this.entries.set(normalized, {
      type: 'symlink',
      mode: 0o777 | constants.S_IFLNK,
      content: new Uint8Array(0),
      linkTarget: target,
      uid: 0,
      gid: 0,
      atime: now,
      mtime: now,
      ctime: now,
      birthtime: now,
      nlink: 1,
    })
  }

  /**
   * Remove an entry
   */
  remove(path: string): boolean {
    return this.entries.delete(this.normalizePath(path))
  }

  /**
   * Update file content
   */
  updateContent(path: string, content: Uint8Array | string): void {
    const normalized = this.normalizePath(path)
    const entry = this.entries.get(normalized)

    if (!entry) {
      throw new Error(`File not found: ${path}`)
    }

    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    const now = Date.now()

    entry.content = bytes
    entry.mtime = now
    entry.ctime = now
  }

  /**
   * Get directory children (immediate children only)
   */
  getChildren(path: string): string[] {
    const normalized = this.normalizePath(path)
    const prefix = normalized === '/' ? '/' : normalized + '/'
    const children: string[] = []

    for (const entryPath of this.entries.keys()) {
      if (entryPath === normalized) continue

      // Check if this is an immediate child
      if (entryPath.startsWith(prefix)) {
        const relativePath = entryPath.substring(prefix.length)
        // Only include immediate children (no slashes in relative path)
        if (!relativePath.includes('/')) {
          children.push(relativePath)
        }
      }
    }

    return children.sort()
  }

  /**
   * Clear all entries (except root)
   */
  clear(): void {
    const root = this.entries.get('/')!
    this.entries.clear()
    this.entries.set('/', root)
  }

  /**
   * Get all entries (for debugging)
   */
  getAllPaths(): string[] {
    return Array.from(this.entries.keys()).sort()
  }

  /**
   * Get file content as string
   */
  readFileAsString(path: string, encoding: BufferEncoding = 'utf-8'): string {
    // Validate input path for security
    pathValidator.validateInput(path)

    const entry = this.get(path)
    if (!entry || entry.type !== 'file') {
      throw new Error(`File not found: ${path}`)
    }

    if (encoding === 'utf-8' || encoding === 'utf8') {
      return new TextDecoder().decode(entry.content)
    }

    if (encoding === 'base64') {
      let binary = ''
      for (const byte of entry.content) {
        binary += String.fromCharCode(byte)
      }
      return btoa(binary)
    }

    if (encoding === 'hex') {
      return Array.from(entry.content)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }

    // Default to utf-8
    return new TextDecoder().decode(entry.content)
  }

  /**
   * Get file content as Uint8Array
   */
  readFileAsBytes(path: string): Uint8Array {
    const entry = this.get(path)
    if (!entry || entry.type !== 'file') {
      throw new Error(`File not found: ${path}`)
    }
    return entry.content
  }
}

type BufferEncoding = 'utf-8' | 'utf8' | 'base64' | 'hex' | 'ascii' | 'latin1' | 'binary'

/**
 * Helper to create a populated test filesystem
 */
export function createTestFilesystem(): InMemoryStorage {
  const storage = new InMemoryStorage()

  // Create some common test directories
  storage.addDirectory('/home')
  storage.addDirectory('/home/user')
  storage.addDirectory('/tmp')
  storage.addDirectory('/var')
  storage.addDirectory('/var/log')

  // Create some test files
  storage.addFile('/home/user/hello.txt', 'Hello, World!')
  storage.addFile('/home/user/data.json', '{"key": "value"}')
  storage.addFile('/tmp/temp.txt', 'temporary data')

  return storage
}

/**
 * Helper to create random binary data
 */
export function createRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

/**
 * Helper to create a file with specific size
 */
export function createFileWithSize(storage: InMemoryStorage, path: string, size: number): void {
  const content = createRandomBytes(size)
  storage.addFile(path, content)
}

/**
 * Helper to create nested directory structure
 */
export function createNestedDirs(storage: InMemoryStorage, basePath: string, depth: number): void {
  let currentPath = basePath
  for (let i = 0; i < depth; i++) {
    currentPath = `${currentPath}/level${i}`
    storage.addDirectory(currentPath)
  }
}

/**
 * Mock R2 bucket for testing tiered storage
 */
export class MockR2Bucket {
  private objects: Map<string, Uint8Array> = new Map()

  async put(key: string, value: Uint8Array | ArrayBuffer | string): Promise<void> {
    if (typeof value === 'string') {
      this.objects.set(key, new TextEncoder().encode(value))
    } else if (value instanceof ArrayBuffer) {
      this.objects.set(key, new Uint8Array(value))
    } else {
      this.objects.set(key, value)
    }
  }

  async get(key: string): Promise<MockR2Object | null> {
    const data = this.objects.get(key)
    if (!data) return null
    return new MockR2Object(data)
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async head(key: string): Promise<{ size: number } | null> {
    const data = this.objects.get(key)
    if (!data) return null
    return { size: data.length }
  }

  async list(options?: { prefix?: string }): Promise<{ objects: Array<{ key: string; size: number }> }> {
    const results: Array<{ key: string; size: number }> = []
    for (const [key, data] of this.objects) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        results.push({ key, size: data.length })
      }
    }
    return { objects: results }
  }

  clear(): void {
    this.objects.clear()
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }
}

/**
 * Mock R2 object
 */
export class MockR2Object {
  private data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data
  }

  get size(): number {
    return this.data.length
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.data.buffer.slice(this.data.byteOffset, this.data.byteOffset + this.data.byteLength)
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.data)
  }
}

/**
 * Mock Durable Object stub for testing
 */
export class MockDurableObjectStub {
  private storage: InMemoryStorage
  private rootPath: string

  constructor(storage?: InMemoryStorage, rootPath: string = '/') {
    this.storage = storage ?? new InMemoryStorage()
    this.rootPath = rootPath
  }

  /**
   * Validate a path against path traversal attacks
   * @returns The validated, normalized path
   * @throws Error with code 'EACCES' if path would escape root
   */
  private validatePath(path: string): string {
    // Check for explicit path traversal patterns even when root is /
    // These patterns indicate an explicit attempt to escape a filesystem jail
    if (this.hasExplicitTraversalPattern(path)) {
      throw { code: 'EACCES', message: 'permission denied - path traversal detected', path }
    }
    return pathValidator.validatePath(path, this.rootPath)
  }

  /**
   * Check if a path would escape the root via traversal
   */
  private isPathTraversal(path: string): boolean {
    // Check for explicit traversal patterns first
    if (this.hasExplicitTraversalPattern(path)) {
      return true
    }
    return pathValidator.isPathTraversal(path, this.rootPath)
  }

  /**
   * Check for explicit path traversal patterns that indicate malicious intent
   * These patterns should be rejected regardless of the root path
   */
  private hasExplicitTraversalPattern(path: string): boolean {
    // Pattern: starts with /.. or starts with ../
    // These indicate explicit attempts to escape upward from current location
    if (path.startsWith('/..') || path.startsWith('../')) {
      return true
    }
    // Check for patterns like /foo/../../.. that would go above /foo
    // Count the depth and the .. references
    const segments = path.split('/').filter((s) => s !== '')
    let depth = 0
    for (const seg of segments) {
      if (seg === '..') {
        depth--
        if (depth < 0) return true
      } else if (seg !== '.') {
        depth++
      }
    }
    return depth < 0
  }

  /**
   * Infer Content-Type from file extension
   */
  private inferContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      json: 'application/json',
      txt: 'text/plain',
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      mjs: 'application/javascript',
      ts: 'text/typescript',
      xml: 'application/xml',
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      ico: 'image/x-icon',
      pdf: 'application/pdf',
      zip: 'application/zip',
      md: 'text/markdown',
      mdx: 'text/mdx',
    }
    return mimeTypes[ext ?? ''] ?? 'application/octet-stream'
  }

  /**
   * Generate ETag from file content and mtime
   */
  private generateETag(entry: MemoryFileEntry): string {
    // Simple ETag based on size and mtime
    return `"${entry.content.length}-${entry.mtime}"`
  }

  /**
   * Parse Range header and return start/end bytes
   */
  private parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
    // Parse "bytes=start-end" format
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
    if (!match) return null

    const [, startStr, endStr] = match
    let start: number
    let end: number

    if (startStr === '' && endStr !== '') {
      // "bytes=-N" means last N bytes
      const n = parseInt(endStr, 10)
      start = Math.max(0, fileSize - n)
      end = fileSize - 1
    } else if (startStr !== '' && endStr === '') {
      // "bytes=N-" means from N to end
      start = parseInt(startStr, 10)
      end = fileSize - 1
    } else {
      // "bytes=start-end"
      start = parseInt(startStr, 10)
      end = parseInt(endStr, 10)
    }

    // Validate range
    if (start < 0 || end < start || start >= fileSize) {
      return null
    }

    // Clamp end to file size
    end = Math.min(end, fileSize - 1)

    return { start, end }
  }

  /**
   * Resolve symlinks to get the target entry
   */
  private resolveSymlink(path: string, maxDepth: number = 10): { entry: MemoryFileEntry | undefined; resolvedPath: string } {
    let currentPath = path
    let depth = 0

    while (depth < maxDepth) {
      const entry = this.storage.get(currentPath)
      if (!entry) {
        return { entry: undefined, resolvedPath: currentPath }
      }

      if (entry.type !== 'symlink' || !entry.linkTarget) {
        return { entry, resolvedPath: currentPath }
      }

      // Resolve the symlink target
      const target = entry.linkTarget
      if (target.startsWith('/')) {
        currentPath = target
      } else {
        // Relative path - resolve from parent directory
        const parentPath = this.storage.getParentPath(currentPath)
        currentPath = this.storage.normalizePath(parentPath + '/' + target)
      }
      depth++
    }

    // Max depth exceeded - treat as broken
    return { entry: undefined, resolvedPath: currentPath }
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const parsedUrl = new URL(url)

    // Handle stream/read endpoint for createReadStream
    if (parsedUrl.pathname === '/stream/read' && init?.method === 'POST') {
      try {
        let body: { path?: string }
        try {
          body = JSON.parse(init.body as string)
        } catch {
          return new Response(JSON.stringify({ code: 'EINVAL', message: 'invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const path = body.path

        // Validate path is provided
        if (!path) {
          return new Response(JSON.stringify({ code: 'EINVAL', message: 'path is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Validate path against traversal attacks
        if (this.isPathTraversal(path)) {
          return new Response(JSON.stringify({ code: 'EACCES', message: 'permission denied - path traversal detected', path }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Resolve symlinks to get the actual file
        const { entry, resolvedPath } = this.resolveSymlink(path)

        if (!entry) {
          return new Response(JSON.stringify({ code: 'ENOENT', message: 'no such file or directory', path }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (entry.type === 'directory') {
          return new Response(JSON.stringify({ code: 'EISDIR', message: 'illegal operation on a directory', path }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const fileSize = entry.content.length
        const contentType = this.inferContentType(resolvedPath)
        const etag = this.generateETag(entry)
        const lastModified = new Date(entry.mtime).toUTCString()

        // Get request headers
        const headers = init?.headers as Record<string, string> | undefined
        const rangeHeader = headers?.['Range'] || headers?.['range']
        const ifNoneMatch = headers?.['If-None-Match'] || headers?.['if-none-match']
        const ifMatch = headers?.['If-Match'] || headers?.['if-match']

        // Handle If-Match precondition
        if (ifMatch && ifMatch !== etag && ifMatch !== '*') {
          return new Response(null, {
            status: 412,
            headers: {
              'ETag': etag,
              'Last-Modified': lastModified,
            },
          })
        }

        // Handle If-None-Match conditional request
        if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
          return new Response(null, {
            status: 304,
            headers: {
              'ETag': etag,
              'Last-Modified': lastModified,
            },
          })
        }

        // Base response headers
        const responseHeaders: Record<string, string> = {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'ETag': etag,
          'Last-Modified': lastModified,
        }

        // Handle Range request
        if (rangeHeader) {
          const range = this.parseRangeHeader(rangeHeader, fileSize)

          if (!range) {
            // Invalid range - return 416 Range Not Satisfiable
            return new Response(null, {
              status: 416,
              headers: {
                ...responseHeaders,
                'Content-Range': `bytes */${fileSize}`,
              },
            })
          }

          const { start, end } = range
          const content = entry.content.slice(start, end + 1)

          return new Response(content, {
            status: 206,
            headers: {
              ...responseHeaders,
              'Content-Length': String(content.length),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            },
          })
        }

        // Full content response
        return new Response(entry.content, {
          status: 200,
          headers: {
            ...responseHeaders,
            'Content-Length': String(fileSize),
          },
        })
      } catch (error: unknown) {
        const err = error as Error & { code?: string; path?: string }
        const status = err.code === 'EACCES' ? 403 : err.code === 'ENOENT' ? 404 : 400
        return new Response(JSON.stringify({ code: err.code ?? 'UNKNOWN', message: err.message, path: err.path }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Handle stream/write endpoint for createWriteStream
    if (parsedUrl.pathname === '/stream/write' && init?.method === 'POST') {
      return this.handleStreamWrite(init)
    }

    // Handle RPC endpoint
    if (parsedUrl.pathname === '/rpc' && init?.method === 'POST') {
      return this.handleRpcRequest(init.body as string)
    }

    // Parse the RPC request (legacy non-/rpc path for backward compat)
    if (init?.method === 'POST' && init.body) {
      return this.handleRpcRequest(init.body as string)
    }

    return new Response('Not found', { status: 404 })
  }

  /**
   * Handle stream write requests
   *
   * Refactored implementation using extracted header parsing utilities
   * for cleaner, more maintainable code.
   */
  private async handleStreamWrite(init: RequestInit): Promise<Response> {
    const headers = init.headers as Record<string, string> | Headers | undefined

    // 1. Parse and validate path header
    const path = getHeader(headers, 'X-FSx-Path')
    if (!path) {
      return buildStreamWriteError('EINVAL', 'Missing X-FSx-Path header')
    }

    // 2. Security: validate against path traversal attacks
    if (this.isPathTraversal(path)) {
      return buildStreamWriteError('EACCES', 'permission denied - path traversal detected', path, 403)
    }

    // 3. Parse options header
    const optionsHeader = getHeader(headers, 'X-FSx-Options')
    const parsedOptions = parseStreamWriteOptions(optionsHeader)
    if ('error' in parsedOptions) {
      return buildStreamWriteError('EINVAL', parsedOptions.error)
    }

    // 4. Convert body to bytes
    const content = await bodyToUint8Array(init.body)

    // 5. Extract options with defaults
    const flag = parsedOptions.flag ?? 'w'
    const mode = parsedOptions.mode ?? 0o644
    const now = Date.now()
    const fileExists = this.storage.has(path)

    // 6. Validate parent directory exists (root always exists)
    const parentPath = this.storage.getParentPath(path)
    if (parentPath !== '/' && !this.storage.isDirectory(parentPath)) {
      return buildStreamWriteError('ENOENT', 'no such file or directory', parentPath, 404)
    }

    // 7. Handle exclusive flags (wx, ax) - fail if file exists
    if ((flag === 'wx' || flag === 'ax') && fileExists) {
      return buildStreamWriteError('EEXIST', 'file already exists', path)
    }

    // 8. Handle append mode for existing files
    if ((flag === 'a' || flag === 'ax') && fileExists) {
      return this.handleAppendWrite(path, content, mode, parsedOptions.mode !== undefined, now)
    }

    // 9. Handle overwrite or create
    if (fileExists) {
      return this.handleOverwriteFile(path, content, mode, now)
    }

    // 10. Create new file
    return this.handleCreateFile(path, content, mode, now)
  }

  /**
   * Handle append write to existing file
   */
  private handleAppendWrite(
    path: string,
    content: Uint8Array,
    mode: number,
    modeSpecified: boolean,
    now: number
  ): Response {
    const existingEntry = this.storage.get(path)!

    // Combine existing and new content
    const newContent = new Uint8Array(existingEntry.content.length + content.length)
    newContent.set(existingEntry.content)
    newContent.set(content, existingEntry.content.length)

    // Update entry preserving birthtime
    const birthtime = existingEntry.birthtime
    existingEntry.content = newContent
    existingEntry.mtime = now
    existingEntry.ctime = now
    existingEntry.birthtime = birthtime

    // Only update mode if explicitly specified
    if (modeSpecified) {
      existingEntry.mode = (existingEntry.mode & ~0o777) | (mode & 0o777)
    }

    return buildStreamWriteResponse({
      path,
      size: newContent.length,
      mode: existingEntry.mode,
      created: false,
      mtime: now,
    })
  }

  /**
   * Handle overwrite of existing file
   */
  private handleOverwriteFile(path: string, content: Uint8Array, mode: number, now: number): Response {
    const existingEntry = this.storage.get(path)!
    const birthtime = existingEntry.birthtime

    existingEntry.content = content
    existingEntry.mtime = now
    existingEntry.ctime = now
    existingEntry.birthtime = birthtime
    existingEntry.mode = constants.S_IFREG | (mode & 0o777)

    return buildStreamWriteResponse({
      path,
      size: content.length,
      mode,
      created: false,
      mtime: now,
    })
  }

  /**
   * Handle creation of new file
   */
  private handleCreateFile(path: string, content: Uint8Array, mode: number, now: number): Response {
    this.storage.addFile(path, content, { mode })

    return buildStreamWriteResponse({
      path,
      size: content.length,
      mode,
      created: true,
      mtime: now,
    })
  }

  /**
   * Handle JSON-RPC style requests
   */
  private async handleRpcRequest(bodyStr: string): Promise<Response> {
    // Parse JSON body
    let body: unknown
    try {
      body = JSON.parse(bodyStr)
    } catch {
      return new Response(
        JSON.stringify({ code: 'PARSE_ERROR', message: 'Invalid JSON' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Handle batch requests (array of requests)
    if (Array.isArray(body)) {
      if (body.length === 0) {
        return new Response(
          JSON.stringify({ code: 'INVALID_REQUEST', message: 'Empty batch request' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const results = await Promise.all(
        body.map(async (req) => this.processBatchRpcRequest(req))
      )
      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Handle single request
    return this.processSingleRpcRequest(body)
  }

  /**
   * Process a batch JSON-RPC request - returns an object, not a Response
   */
  private async processBatchRpcRequest(body: unknown): Promise<Record<string, unknown>> {
    // Validate request is an object
    if (body === null || typeof body !== 'object') {
      return { code: 'INVALID_REQUEST', message: 'Request must be an object' }
    }

    const request = body as Record<string, unknown>
    const id = request.id
    const jsonrpc = request.jsonrpc as string | undefined
    const method = request.method
    const params = (request.params ?? {}) as Record<string, unknown>

    // Validate method field
    if (method === undefined || method === null) {
      return { code: 'INVALID_REQUEST', message: 'Missing method field', ...(id !== undefined && { id }) }
    }

    if (typeof method !== 'string' || method === '') {
      return { code: 'INVALID_REQUEST', message: 'Method must be a non-empty string', ...(id !== undefined && { id }) }
    }

    // Check for internal methods (prefixed with underscore)
    if (method.startsWith('_')) {
      return {
        code: 'METHOD_NOT_FOUND',
        message: `Method not found: ${method}`,
        ...(id !== undefined && { id }),
      }
    }

    try {
      const result = await this.handleMethod(method, params)

      // Build JSON-RPC 2.0 response object for batch
      if (jsonrpc === '2.0') {
        return {
          jsonrpc: '2.0',
          ...(id !== undefined && { id }),
          result,
        }
      } else {
        // Simple response
        return {
          ...(result as Record<string, unknown> ?? {}),
          ...(id !== undefined && { id }),
        }
      }
    } catch (error: unknown) {
      const err = error as Error & { code?: string; path?: string; message?: string }

      // Build error response object
      const errorObj: Record<string, unknown> = {
        code: err.code ?? 'UNKNOWN',
        message: err.message ?? 'Unknown error',
      }
      if (err.path) {
        errorObj.path = err.path
      }

      if (jsonrpc === '2.0') {
        return {
          jsonrpc: '2.0',
          ...(id !== undefined && { id }),
          error: errorObj,
        }
      } else {
        return {
          ...errorObj,
          ...(id !== undefined && { id }),
        }
      }
    }
  }

  /**
   * Process a single JSON-RPC request
   */
  private async processSingleRpcRequest(body: unknown): Promise<Response | Record<string, unknown>> {
    // Validate request is an object
    if (body === null || typeof body !== 'object') {
      const errorResponse = { code: 'INVALID_REQUEST', message: 'Request must be an object' }
      // When called from batch, return the object directly
      if (arguments.length > 0 && body !== null && typeof (body as Record<string, unknown>).id === 'undefined') {
        return errorResponse
      }
      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const request = body as Record<string, unknown>
    const id = request.id
    const jsonrpc = request.jsonrpc as string | undefined
    const method = request.method
    const params = (request.params ?? {}) as Record<string, unknown>

    // Validate method field
    if (method === undefined || method === null) {
      const errorResponse = { code: 'INVALID_REQUEST', message: 'Missing method field', ...(id !== undefined && { id }) }
      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (typeof method !== 'string' || method === '') {
      const errorResponse = { code: 'INVALID_REQUEST', message: 'Method must be a non-empty string', ...(id !== undefined && { id }) }
      return new Response(JSON.stringify(errorResponse), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Check for internal methods (prefixed with underscore)
    if (method.startsWith('_')) {
      const errorResponse = {
        code: 'METHOD_NOT_FOUND',
        message: `Method not found: ${method}`,
        ...(id !== undefined && { id }),
      }
      return new Response(JSON.stringify(errorResponse), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const result = await this.handleMethod(method, params)

      // Build response
      if (jsonrpc === '2.0') {
        // Full JSON-RPC 2.0 response format
        const responseObj: Record<string, unknown> = {
          jsonrpc: '2.0',
          result,
        }
        if (id !== undefined) {
          responseObj.id = id
        }

        // For JSON-RPC 2.0 notifications (no id AND no result expected), return 204
        // But if method was executed and we have a result, still return 200
        // The proper notification behavior happens when called without 'id' field
        // and method is void/side-effect only (like mkdir in notification test)
        // For methods that return data (stat, readFile), always return 200
        if (id === undefined && (method === 'mkdir' || method === 'writeFile' || method === 'rm' || method === 'rmdir' || method === 'unlink')) {
          return new Response(null, { status: 204 })
        }

        return new Response(JSON.stringify(responseObj), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } else {
        // Simple response format (just the result)
        const responseObj: Record<string, unknown> = result as Record<string, unknown> ?? {}
        if (id !== undefined) {
          responseObj.id = id
        }
        return new Response(JSON.stringify(responseObj), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } catch (error: unknown) {
      const err = error as Error & { code?: string; path?: string; message?: string }

      // Determine status code based on error type
      let status = 400
      if (err.code === 'EACCES') {
        status = 403
      } else if (err.code === 'METHOD_NOT_FOUND') {
        status = 404
      }

      // Build error response
      const errorResponse: Record<string, unknown> = {
        code: err.code ?? 'UNKNOWN',
        message: err.message ?? 'Unknown error',
      }
      if (err.path) {
        errorResponse.path = err.path
      }
      if (id !== undefined) {
        errorResponse.id = id
      }

      return new Response(JSON.stringify(errorResponse), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  private async handleMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'readFile': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const entry = this.storage.get(path)
        if (!entry) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }
        if (entry.type === 'directory') {
          throw { code: 'EISDIR', message: 'illegal operation on a directory', path }
        }

        // Return base64 encoded data
        let binary = ''
        for (const byte of entry.content) {
          binary += String.fromCharCode(byte)
        }
        return { data: btoa(binary), encoding: 'base64' }
      }

      case 'writeFile': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const data = params.data as string
        const encoding = params.encoding as string
        const mode = params.mode as number | undefined

        // Decode the data
        let bytes: Uint8Array
        if (encoding === 'base64') {
          const binary = atob(data)
          bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
        } else {
          bytes = new TextEncoder().encode(data)
        }

        // Check parent exists
        if (!this.storage.parentExists(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        this.storage.addFile(path, bytes, { mode })
        return {}
      }

      case 'mkdir': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const recursive = params.recursive as boolean
        const mode = params.mode as number | undefined

        if (this.storage.has(path)) {
          if (!recursive) {
            throw { code: 'EEXIST', message: 'file already exists', path }
          }
          return {}
        }

        if (recursive) {
          // Create all parent directories
          const parts = path.split('/').filter(Boolean)
          let currentPath = ''
          for (const part of parts) {
            currentPath += '/' + part
            if (!this.storage.has(currentPath)) {
              this.storage.addDirectory(currentPath, { mode })
            }
          }
        } else {
          if (!this.storage.parentExists(path)) {
            throw { code: 'ENOENT', message: 'no such file or directory', path }
          }
          this.storage.addDirectory(path, { mode })
        }
        return {}
      }

      case 'rmdir': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const recursive = params.recursive as boolean

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        if (!this.storage.isDirectory(path)) {
          throw { code: 'ENOTDIR', message: 'not a directory', path }
        }

        const children = this.storage.getChildren(path)
        if (children.length > 0 && !recursive) {
          throw { code: 'ENOTEMPTY', message: 'directory not empty', path }
        }

        if (recursive) {
          // Remove all children first
          const allPaths = this.storage.getAllPaths()
          const toRemove = allPaths.filter((p) => p.startsWith(path + '/') || p === path)
          toRemove.sort((a, b) => b.length - a.length) // Remove deepest first
          for (const p of toRemove) {
            this.storage.remove(p)
          }
        } else {
          this.storage.remove(path)
        }
        return {}
      }

      case 'readdir': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const withFileTypes = params.withFileTypes as boolean

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        if (!this.storage.isDirectory(path)) {
          throw { code: 'ENOTDIR', message: 'not a directory', path }
        }

        const children = this.storage.getChildren(path)

        if (withFileTypes) {
          return children.map((name) => {
            const childPath = path === '/' ? `/${name}` : `${path}/${name}`
            const entry = this.storage.get(childPath)
            return {
              name,
              parentPath: path,
              type: entry?.type ?? 'file',
            }
          })
        }

        return children
      }

      case 'stat':
      case 'lstat': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const entry = this.storage.get(path)

        if (!entry) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        return {
          dev: 0,
          ino: 0,
          mode: entry.mode,
          nlink: entry.nlink,
          uid: entry.uid,
          gid: entry.gid,
          rdev: 0,
          size: entry.content.length,
          blksize: 4096,
          blocks: Math.ceil(entry.content.length / 512),
          atime: entry.atime,
          mtime: entry.mtime,
          ctime: entry.ctime,
          birthtime: entry.birthtime,
        }
      }

      case 'unlink': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        if (this.storage.isDirectory(path)) {
          throw { code: 'EISDIR', message: 'illegal operation on a directory', path }
        }

        this.storage.remove(path)
        return {}
      }

      case 'rename': {
        const oldPath = params.oldPath as string
        const newPath = params.newPath as string
        // Validate both paths for traversal attacks
        this.validatePath(oldPath)
        this.validatePath(newPath)

        if (!this.storage.has(oldPath)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path: oldPath }
        }

        // If same path, do nothing
        if (oldPath === newPath) {
          return {}
        }

        const entry = this.storage.get(oldPath)!
        // Copy entry to new path
        if (entry.type === 'file') {
          this.storage.addFile(newPath, entry.content, { mode: entry.mode & 0o777 })
        } else if (entry.type === 'directory') {
          this.storage.addDirectory(newPath, { mode: entry.mode & 0o777 })
        } else if (entry.type === 'symlink') {
          this.storage.addSymlink(newPath, entry.linkTarget!)
        }
        this.storage.remove(oldPath)
        return {}
      }

      case 'copyFile': {
        const src = params.src as string
        const dest = params.dest as string
        // Validate both paths for traversal attacks
        this.validatePath(src)
        this.validatePath(dest)

        if (!this.storage.has(src)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path: src }
        }

        const entry = this.storage.get(src)!
        if (entry.type !== 'file') {
          throw { code: 'EISDIR', message: 'illegal operation on a directory', path: src }
        }

        this.storage.addFile(dest, entry.content, { mode: entry.mode & 0o777 })
        return {}
      }

      case 'rm': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const recursive = params.recursive as boolean
        const force = params.force as boolean

        if (!this.storage.has(path)) {
          if (force) {
            return {}
          }
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        if (this.storage.isDirectory(path)) {
          if (!recursive) {
            throw { code: 'EISDIR', message: 'is a directory', path }
          }
          // Remove directory recursively
          const allPaths = this.storage.getAllPaths()
          const toRemove = allPaths.filter((p) => p.startsWith(path + '/') || p === path)
          toRemove.sort((a, b) => b.length - a.length)
          for (const p of toRemove) {
            this.storage.remove(p)
          }
        } else {
          this.storage.remove(path)
        }
        return {}
      }

      case 'access': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }
        // For the mock, we just check existence. Real impl would check mode.
        return {}
      }

      case 'chmod': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const mode = params.mode as number

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        const entry = this.storage.get(path)!
        // Update mode (keeping file type bits)
        entry.mode = (entry.mode & ~0o777) | (mode & 0o777)
        return {}
      }

      case 'chown': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const uid = params.uid as number
        const gid = params.gid as number

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        const entry = this.storage.get(path)!
        entry.uid = uid
        entry.gid = gid
        return {}
      }

      case 'utimes': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const atime = params.atime as number
        const mtime = params.mtime as number

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        const entry = this.storage.get(path)!
        entry.atime = atime
        entry.mtime = mtime
        return {}
      }

      case 'symlink': {
        const target = params.target as string
        const path = params.path as string
        // Validate the path where the symlink will be created
        this.validatePath(path)
        // Also validate that the target doesn't point outside the root
        // This prevents creating symlinks that escape the filesystem jail
        if (pathValidator.isSymlinkEscape(target, path, this.rootPath)) {
          const error = { code: 'EACCES', message: 'permission denied - symlink target outside root', path: target }
          throw error
        }

        this.storage.addSymlink(path, target)
        return {}
      }

      case 'link': {
        const existingPath = params.existingPath as string
        const newPath = params.newPath as string
        // Validate both paths for traversal attacks
        this.validatePath(existingPath)
        this.validatePath(newPath)

        if (!this.storage.has(existingPath)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path: existingPath }
        }

        const entry = this.storage.get(existingPath)!
        if (entry.type !== 'file') {
          throw { code: 'EPERM', message: 'operation not permitted', path: existingPath }
        }

        // Create hard link (copy file with same content)
        this.storage.addFile(newPath, entry.content, { mode: entry.mode & 0o777 })
        entry.nlink++
        return {}
      }

      case 'readlink': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        const entry = this.storage.get(path)!
        if (entry.type !== 'symlink') {
          throw { code: 'EINVAL', message: 'invalid argument', path }
        }

        return entry.linkTarget
      }

      case 'realpath': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)

        // Normalize the path
        const normalized = this.storage.normalizePath(path)

        if (!this.storage.has(normalized)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        return normalized
      }

      case 'truncate': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)
        const length = (params.length as number) ?? 0

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        const entry = this.storage.get(path)!
        if (entry.type !== 'file') {
          throw { code: 'EISDIR', message: 'is a directory', path }
        }

        if (length < entry.content.length) {
          entry.content = entry.content.slice(0, length)
        } else if (length > entry.content.length) {
          const newContent = new Uint8Array(length)
          newContent.set(entry.content)
          entry.content = newContent
        }
        return {}
      }

      case 'open': {
        const path = params.path as string
        // Validate path for traversal attacks
        this.validatePath(path)

        if (!this.storage.has(path)) {
          throw { code: 'ENOENT', message: 'no such file or directory', path }
        }

        // Return a mock file descriptor
        return { fd: Math.floor(Math.random() * 1000) + 3 }
      }

      case 'setMetadata':
      case 'getMetadata':
      case 'demoteFile':
        // These are used by TieredFS - return minimal implementations
        return null

      case 'ping':
        // Simple ping method for connectivity testing
        return { pong: true }

      default:
        throw { code: 'METHOD_NOT_FOUND', message: `Unknown method: ${method}` }
    }
  }

  getStorage(): InMemoryStorage {
    return this.storage
  }
}

/**
 * Assert that an async function throws an error with specific code
 */
export async function expectError(fn: () => Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await fn()
    throw new Error(`Expected error with code ${expectedCode} but no error was thrown`)
  } catch (error: unknown) {
    const err = error as Error & { code?: string }
    if (err.code !== expectedCode) {
      throw new Error(`Expected error code ${expectedCode} but got ${err.code}: ${err.message}`)
    }
  }
}

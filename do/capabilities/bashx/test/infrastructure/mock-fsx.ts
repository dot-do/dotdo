/**
 * Mock FSX Service for Testing
 *
 * Provides an in-memory filesystem implementation that mimics the FSX service
 * binding interface (Fetcher) for testing purposes. This allows tests to verify
 * FSX integration without requiring the actual FSX service.
 *
 * ## Overview
 *
 * The mock implements the RPC protocol expected by FsxServiceAdapter:
 * - POST to https://fsx.do/rpc with JSON body { method, params }
 * - Returns JSON responses with appropriate data or error codes
 *
 * ## Supported Operations
 *
 * - `stat` - Get file/directory metadata
 * - `readFile` - Read file contents (text or binary)
 * - `writeFile` - Write file contents
 * - `unlink` - Delete a file
 * - `mkdir` - Create a directory (supports recursive)
 * - `rmdir` - Remove a directory (supports recursive)
 * - `readdir` - List directory contents
 *
 * ## Usage
 *
 * ### Basic Setup (Global Environment)
 *
 * ```typescript
 * import { setupMockFSX, cleanupMockFSX } from './mock-fsx.js'
 *
 * beforeAll(() => {
 *   setupMockFSX()
 * })
 *
 * afterAll(() => {
 *   cleanupMockFSX()
 * })
 * ```
 *
 * ### Direct Mock Creation
 *
 * ```typescript
 * import { createMockFSX } from './mock-fsx.js'
 *
 * const mockFSX = createMockFSX()
 * const adapter = new FsxServiceAdapter(mockFSX)
 * ```
 *
 * ### With Test Adapter
 *
 * ```typescript
 * import { createMockFSX, createTestFsAdapter } from './mock-fsx.js'
 *
 * const mockFSX = createMockFSX()
 * const fs = createTestFsAdapter(mockFSX)
 *
 * // Use fs operations directly
 * await fs.write('/test.txt', 'hello')
 * const content = await fs.read('/test.txt', { encoding: 'utf-8' })
 * ```
 *
 * ### Pre-populated Filesystem
 *
 * ```typescript
 * import { createMockFSX } from './mock-fsx.js'
 *
 * const mockFSX = createMockFSX({
 *   '/config.json': '{"debug": true}',
 *   '/data/users.txt': 'alice\nbob\ncharlie',
 * })
 * ```
 *
 * ## Error Handling
 *
 * The mock returns appropriate POSIX error codes:
 * - `ENOENT` - File or directory not found
 * - `EEXIST` - File or directory already exists
 * - `EISDIR` - Illegal operation on a directory
 * - `ENOTDIR` - Not a directory
 * - `ENOTEMPTY` - Directory not empty
 *
 * @module test/infrastructure/mock-fsx
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * In-memory file entry representing a file or directory in the mock filesystem.
 */
interface MockFileEntry {
  /** Entry type: 'file' or 'directory' */
  type: 'file' | 'directory'
  /** File content (undefined for directories) */
  content?: Uint8Array
  /** POSIX permission mode (e.g., 0o644 for files, 0o755 | 0o40000 for directories) */
  mode: number
  /** Last modification time (Unix timestamp) */
  mtime: number
  /** Last change time (Unix timestamp) */
  ctime: number
  /** Birth time / creation time (Unix timestamp) */
  birthtime: number
}

/**
 * Initial filesystem content for pre-populating the mock.
 * Maps absolute paths to file contents.
 *
 * @example
 * ```typescript
 * const initialFiles: MockFSXInitialFiles = {
 *   '/config.json': '{"debug": true}',
 *   '/data/users.txt': 'alice\nbob',
 * }
 * ```
 */
export interface MockFSXInitialFiles {
  [path: string]: string | Uint8Array
}

// ============================================================================
// MEMORY FILESYSTEM
// ============================================================================

/**
 * Creates an in-memory filesystem store with optional initial content.
 *
 * @param initialFiles - Optional map of paths to file contents for pre-populating
 * @returns Map of paths to MockFileEntry objects
 *
 * @example
 * ```typescript
 * // Empty filesystem (just root directory)
 * const fs = createMemoryFS()
 *
 * // Pre-populated filesystem
 * const fs = createMemoryFS({
 *   '/test.txt': 'test content',
 *   '/data/config.json': '{"debug": true}',
 * })
 * ```
 */
function createMemoryFS(initialFiles?: MockFSXInitialFiles): Map<string, MockFileEntry> {
  const fs = new Map<string, MockFileEntry>()

  // Initialize root directory
  const now = Date.now()
  fs.set('/', {
    type: 'directory',
    mode: 0o755 | 0o40000, // directory mode
    mtime: now,
    ctime: now,
    birthtime: now,
  })

  // Add default test file for backward compatibility
  fs.set('/test.txt', {
    type: 'file',
    content: new TextEncoder().encode('test content'),
    mode: 0o644,
    mtime: now,
    ctime: now,
    birthtime: now,
  })

  // Add initial files if provided
  if (initialFiles) {
    for (const [path, content] of Object.entries(initialFiles)) {
      // Ensure parent directories exist
      const parts = path.split('/').filter(Boolean)
      let currentPath = ''
      for (const part of parts.slice(0, -1)) {
        currentPath += '/' + part
        if (!fs.has(currentPath)) {
          fs.set(currentPath, {
            type: 'directory',
            mode: 0o755 | 0o40000,
            mtime: now,
            ctime: now,
            birthtime: now,
          })
        }
      }

      // Add the file
      const fileContent = typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content
      fs.set(path, {
        type: 'file',
        content: fileContent,
        mode: 0o644,
        mtime: now,
        ctime: now,
        birthtime: now,
      })
    }
  }

  return fs
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Normalize a filesystem path for consistent handling.
 * Removes trailing slashes except for root directory.
 *
 * @param path - The path to normalize
 * @returns Normalized path
 */
function normalizePath(path: string): string {
  // Remove trailing slashes except for root
  if (path !== '/' && path.endsWith('/')) {
    return path.slice(0, -1)
  }
  return path
}

/**
 * Get the parent directory path from a given path.
 *
 * @param path - The path to get the parent of
 * @returns Parent directory path (returns '/' for root-level items)
 */
function getParentPath(path: string): string {
  const normalized = normalizePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === 0) return '/'
  return normalized.slice(0, lastSlash)
}

// ============================================================================
// RPC HANDLER
// ============================================================================

/**
 * Create the mock FSX RPC request handler.
 *
 * Handles all FSX RPC methods and returns appropriate JSON responses
 * matching the FSX service protocol.
 *
 * @param initialFiles - Optional initial files to populate the filesystem
 * @returns Async request handler function
 */
function createMockFSXHandler(initialFiles?: MockFSXInitialFiles) {
  const fs = createMemoryFS(initialFiles)

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = (await request.json()) as {
      method: string
      params: Record<string, unknown>
    }

    const { method, params } = body
    const path = normalizePath((params.path as string) || '/')

    try {
      switch (method) {
        case 'stat': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, stat '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          return new Response(
            JSON.stringify({
              size: entry.content?.length ?? 0,
              mtime: entry.mtime,
              ctime: entry.ctime,
              birthtime: entry.birthtime,
              mode: entry.mode,
              type: entry.type,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        case 'readFile': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, open '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          if (entry.type === 'directory') {
            return new Response(
              JSON.stringify({ code: 'EISDIR', message: `EISDIR: illegal operation on a directory, read '${path}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }
          const encoding = params.encoding as string | undefined
          if (encoding === 'utf-8' || encoding === 'utf8') {
            const text = new TextDecoder().decode(entry.content)
            return new Response(JSON.stringify({ data: text }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          // Return as array of bytes for binary
          return new Response(JSON.stringify({ data: Array.from(entry.content || new Uint8Array()) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'writeFile': {
          const parentPath = getParentPath(path)
          const parentEntry = fs.get(parentPath)
          if (!parentEntry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, open '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          if (parentEntry.type !== 'directory') {
            return new Response(
              JSON.stringify({ code: 'ENOTDIR', message: `ENOTDIR: not a directory, open '${path}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const data = params.data as string | number[]
          let content: Uint8Array
          if (typeof data === 'string') {
            content = new TextEncoder().encode(data)
          } else if (Array.isArray(data)) {
            content = new Uint8Array(data)
          } else {
            content = new Uint8Array()
          }

          const now = Date.now()
          const existing = fs.get(path)
          fs.set(path, {
            type: 'file',
            content,
            mode: (params.mode as number) ?? existing?.mode ?? 0o644,
            mtime: now,
            ctime: now,
            birthtime: existing?.birthtime ?? now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'unlink': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, unlink '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          if (entry.type === 'directory') {
            return new Response(
              JSON.stringify({ code: 'EISDIR', message: `EISDIR: illegal operation on a directory, unlink '${path}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }
          fs.delete(path)
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'mkdir': {
          const existing = fs.get(path)
          if (existing) {
            return new Response(
              JSON.stringify({ code: 'EEXIST', message: `EEXIST: file already exists, mkdir '${path}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const recursive = params.recursive as boolean
          const parentPath = getParentPath(path)

          // Check parent exists (or create recursively)
          if (!fs.has(parentPath)) {
            if (recursive) {
              // Create parent directories recursively
              const parts = path.split('/').filter(Boolean)
              let currentPath = ''
              for (const part of parts.slice(0, -1)) {
                currentPath += '/' + part
                if (!fs.has(currentPath)) {
                  const now = Date.now()
                  fs.set(currentPath, {
                    type: 'directory',
                    mode: 0o755 | 0o40000,
                    mtime: now,
                    ctime: now,
                    birthtime: now,
                  })
                }
              }
            } else {
              return new Response(
                JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, mkdir '${path}'` }),
                { status: 404, headers: { 'Content-Type': 'application/json' } }
              )
            }
          }

          const now = Date.now()
          fs.set(path, {
            type: 'directory',
            mode: 0o755 | 0o40000,
            mtime: now,
            ctime: now,
            birthtime: now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'rmdir': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, rmdir '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          if (entry.type !== 'directory') {
            return new Response(
              JSON.stringify({ code: 'ENOTDIR', message: `ENOTDIR: not a directory, rmdir '${path}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const recursive = params.recursive as boolean

          // Check if directory has children
          const children = Array.from(fs.keys()).filter(
            (p) => p !== path && p.startsWith(path + '/')
          )

          if (children.length > 0 && !recursive) {
            return new Response(
              JSON.stringify({ code: 'ENOTEMPTY', message: `ENOTEMPTY: directory not empty, rmdir '${path}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          // Delete all children if recursive
          if (recursive) {
            for (const childPath of children) {
              fs.delete(childPath)
            }
          }

          fs.delete(path)
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'readdir': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, scandir '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }
          if (entry.type !== 'directory') {
            return new Response(
              JSON.stringify({ code: 'ENOTDIR', message: `ENOTDIR: not a directory, scandir '${path}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const withFileTypes = params.withFileTypes as boolean
          const recursive = params.recursive as boolean
          const prefix = path === '/' ? '/' : path + '/'

          // Get children (immediate or recursive)
          const children = Array.from(fs.entries())
            .filter(([p]) => {
              if (!p.startsWith(prefix)) return false
              const relativePath = p.slice(prefix.length)
              if (!relativePath) return false
              if (recursive) return true
              return !relativePath.includes('/')
            })
            .map(([p, e]) => {
              const name = p.slice(prefix.length)
              if (withFileTypes) {
                return { name, path: p, type: e.type }
              }
              return name
            })

          return new Response(JSON.stringify({ entries: children }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'rm': {
          const entry = fs.get(path)
          const forceOpt = params.force as boolean
          const recursiveOpt = params.recursive as boolean

          if (!entry) {
            if (forceOpt) {
              return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            }
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, rm '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          if (entry.type === 'directory') {
            if (!recursiveOpt) {
              return new Response(
                JSON.stringify({ code: 'EISDIR', message: `EISDIR: is a directory, rm '${path}'` }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
              )
            }
            // Delete all children recursively
            const childPaths = Array.from(fs.keys()).filter(
              (p) => p !== path && p.startsWith(path + '/')
            )
            for (const childPath of childPaths) {
              fs.delete(childPath)
            }
          }

          fs.delete(path)
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'copyFile': {
          const src = normalizePath((params.src as string) || '')
          const dest = normalizePath((params.dest as string) || '')
          const srcEntry = fs.get(src)

          if (!srcEntry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, copyfile '${src}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const now = Date.now()
          fs.set(dest, {
            type: srcEntry.type,
            content: srcEntry.content ? new Uint8Array(srcEntry.content) : undefined,
            mode: srcEntry.mode,
            mtime: now,
            ctime: now,
            birthtime: now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'rename': {
          const oldPath = normalizePath((params.oldPath as string) || '')
          const newPath = normalizePath((params.newPath as string) || '')
          const oldEntry = fs.get(oldPath)

          if (!oldEntry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, rename '${oldPath}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const now = Date.now()
          fs.set(newPath, {
            ...oldEntry,
            ctime: now,
          })
          fs.delete(oldPath)

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'utimes': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, utime '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const atime = params.atime as number
          const mtime = params.mtime as number
          const now = Date.now()

          fs.set(path, {
            ...entry,
            mtime: mtime ?? entry.mtime,
            ctime: now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'truncate': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, truncate '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          if (entry.type === 'directory') {
            return new Response(
              JSON.stringify({ code: 'EISDIR', message: `EISDIR: is a directory, truncate '${path}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const length = (params.length as number) ?? 0
          const now = Date.now()
          const newContent = entry.content
            ? entry.content.slice(0, length)
            : new Uint8Array(0)

          fs.set(path, {
            ...entry,
            content: newContent,
            mtime: now,
            ctime: now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'readlink': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, readlink '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          // Mock doesn't track symlinks, return the path itself for now
          return new Response(JSON.stringify({ target: path }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'symlink': {
          const target = params.target as string
          const symlinkPath = normalizePath((params.path as string) || path)

          const existing = fs.get(symlinkPath)
          if (existing) {
            return new Response(
              JSON.stringify({ code: 'EEXIST', message: `EEXIST: file already exists, symlink '${symlinkPath}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const now = Date.now()
          fs.set(symlinkPath, {
            type: 'file', // Mock treats symlinks as files
            content: new TextEncoder().encode(target), // Store target as content
            mode: 0o777 | 0o120000, // symlink mode
            mtime: now,
            ctime: now,
            birthtime: now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'link': {
          const existingPath = normalizePath((params.existingPath as string) || '')
          const newLinkPath = normalizePath((params.newPath as string) || '')

          const srcEntry = fs.get(existingPath)
          if (!srcEntry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, link '${existingPath}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const existing = fs.get(newLinkPath)
          if (existing) {
            return new Response(
              JSON.stringify({ code: 'EEXIST', message: `EEXIST: file already exists, link '${newLinkPath}'` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const now = Date.now()
          fs.set(newLinkPath, {
            ...srcEntry,
            ctime: now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'chmod': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, chmod '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const mode = params.mode as number
          const now = Date.now()
          // Preserve type bits (directory/file), update permission bits
          const typeBits = entry.mode & 0o170000 // Keep type bits
          const newMode = typeBits | (mode & 0o7777) // Set permission bits

          fs.set(path, {
            ...entry,
            mode: newMode,
            ctime: now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        case 'chown': {
          const entry = fs.get(path)
          if (!entry) {
            return new Response(
              JSON.stringify({ code: 'ENOENT', message: `ENOENT: no such file or directory, chown '${path}'` }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            )
          }

          // Mock doesn't track uid/gid, just update ctime
          const now = Date.now()
          fs.set(path, {
            ...entry,
            ctime: now,
          })

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        default:
          return new Response(
            JSON.stringify({ error: `Unknown method: ${method}` }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
      }
    } catch (error) {
      return new Response(
        JSON.stringify({
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }
}

// ============================================================================
// MOCK FSX EXPORTS
// ============================================================================

/**
 * Mock Fetcher interface matching Cloudflare Workers Fetcher binding.
 */
export interface MockFetcher {
  fetch: typeof fetch
}

/**
 * Create a mock Fetcher that implements the FSX service interface.
 *
 * The returned mock can be used directly as a Fetcher binding in tests,
 * or passed to FsxServiceAdapter for higher-level file operations.
 *
 * @param initialFiles - Optional map of paths to file contents for pre-populating
 * @returns Mock Fetcher with FSX RPC support
 *
 * @example
 * ```typescript
 * // Basic usage
 * const mockFSX = createMockFSX()
 *
 * // Pre-populated filesystem
 * const mockFSX = createMockFSX({
 *   '/config.json': '{"debug": true}',
 * })
 *
 * // Make RPC calls
 * const response = await mockFSX.fetch('https://fsx.do/rpc', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ method: 'stat', params: { path: '/' } }),
 * })
 * ```
 */
export function createMockFSX(initialFiles?: MockFSXInitialFiles): MockFetcher {
  const handler = createMockFSXHandler(initialFiles)

  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(input, init)
      return handler(request)
    },
  }
}

// ============================================================================
// GLOBAL ENVIRONMENT SETUP
// ============================================================================

/**
 * Setup the mock FSX service in the global environment.
 *
 * This injects the mock FSX Fetcher into `globalThis.env.FSX`, simulating
 * how Cloudflare Workers service bindings are available in production.
 *
 * @param initialFiles - Optional map of paths to file contents for pre-populating
 *
 * @example
 * ```typescript
 * import { setupMockFSX, cleanupMockFSX } from './mock-fsx.js'
 *
 * beforeAll(() => {
 *   setupMockFSX({
 *     '/test.txt': 'test content',
 *   })
 * })
 *
 * afterAll(() => {
 *   cleanupMockFSX()
 * })
 * ```
 */
export function setupMockFSX(initialFiles?: MockFSXInitialFiles): void {
  const mockFSX = createMockFSX(initialFiles)

  // Inject into globalThis.env
  ;(globalThis as unknown as { env: { FSX: MockFetcher } }).env = {
    FSX: mockFSX,
  }
}

/**
 * Cleanup the mock FSX service from the global environment.
 *
 * Call this in afterAll() or afterEach() to clean up after tests.
 */
export function cleanupMockFSX(): void {
  delete (globalThis as unknown as { env?: { FSX?: MockFetcher } }).env
}

// ============================================================================
// TEST FILESYSTEM ADAPTER
// ============================================================================

/**
 * Stat result from the test adapter.
 */
export interface TestFsStat {
  /** File size in bytes */
  size: number
  /** Last modification time */
  mtime: Date
  /** Check if entry is a file */
  isFile(): boolean
  /** Check if entry is a directory */
  isDirectory(): boolean
}

/**
 * Directory entry with file type information.
 */
export interface TestFsDirent {
  /** Entry name (not the full path) */
  name: string
  /** Check if entry is a directory */
  isDirectory(): boolean
}

/**
 * Test filesystem adapter interface.
 *
 * Provides a convenient API for filesystem operations in tests,
 * wrapping the low-level RPC calls to the mock FSX service.
 */
export interface TestFsAdapter {
  /**
   * Read a file's contents.
   *
   * @param path - Absolute path to the file
   * @param options - Read options (encoding for text mode)
   * @returns File contents as string (text) or Uint8Array (binary)
   * @throws Error with code 'ENOENT' if file doesn't exist
   * @throws Error with code 'EISDIR' if path is a directory
   */
  read(
    path: string,
    options?: { encoding?: string }
  ): Promise<string | Uint8Array>

  /**
   * Write content to a file.
   *
   * @param path - Absolute path to the file
   * @param data - Content to write (string or binary)
   * @param options - Write options (mode for permissions)
   * @throws Error with code 'ENOENT' if parent directory doesn't exist
   */
  write(
    path: string,
    data: string | Uint8Array,
    options?: { mode?: number }
  ): Promise<void>

  /**
   * Check if a path exists.
   *
   * @param path - Absolute path to check
   * @returns true if path exists, false otherwise
   */
  exists(path: string): Promise<boolean>

  /**
   * Get file or directory metadata.
   *
   * @param path - Absolute path to stat
   * @returns Stat object with size, mtime, isFile(), isDirectory()
   * @throws Error with code 'ENOENT' if path doesn't exist
   */
  stat(path: string): Promise<TestFsStat>

  /**
   * List directory contents.
   *
   * @param path - Absolute path to directory
   * @param options - List options (withFileTypes for Dirent objects)
   * @returns Array of entry names or Dirent objects
   * @throws Error with code 'ENOENT' if directory doesn't exist
   * @throws Error with code 'ENOTDIR' if path is not a directory
   */
  list(
    path: string,
    options?: { withFileTypes?: boolean }
  ): Promise<Array<string | TestFsDirent>>

  /**
   * Delete a file.
   *
   * @param path - Absolute path to file
   * @throws Error with code 'ENOENT' if file doesn't exist
   * @throws Error with code 'EISDIR' if path is a directory
   */
  unlink(path: string): Promise<void>

  /**
   * Create a directory.
   *
   * @param path - Absolute path for new directory
   * @param options - Creation options (recursive to create parents)
   * @throws Error with code 'EEXIST' if directory already exists
   * @throws Error with code 'ENOENT' if parent doesn't exist (without recursive)
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>

  /**
   * Remove a directory.
   *
   * @param path - Absolute path to directory
   * @param options - Removal options (recursive to delete contents)
   * @throws Error with code 'ENOENT' if directory doesn't exist
   * @throws Error with code 'ENOTDIR' if path is not a directory
   * @throws Error with code 'ENOTEMPTY' if directory has contents (without recursive)
   */
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>
}

/**
 * Create a test filesystem adapter from a mock FSX Fetcher.
 *
 * This provides a convenient high-level API for filesystem operations
 * in tests, similar to FsCapability but designed specifically for testing.
 *
 * @param fsx - Mock FSX Fetcher (from createMockFSX)
 * @returns Test filesystem adapter
 *
 * @example
 * ```typescript
 * const mockFSX = createMockFSX()
 * const fs = createTestFsAdapter(mockFSX)
 *
 * // Write and read a file
 * await fs.write('/test.txt', 'hello world')
 * const content = await fs.read('/test.txt', { encoding: 'utf-8' })
 *
 * // Check existence
 * const exists = await fs.exists('/test.txt')
 *
 * // Get stats
 * const stats = await fs.stat('/test.txt')
 * console.log(stats.size, stats.isFile())
 *
 * // Directory operations
 * await fs.mkdir('/data', { recursive: true })
 * const entries = await fs.list('/data')
 * await fs.rmdir('/data', { recursive: true })
 * ```
 */
export function createTestFsAdapter(fsx: MockFetcher): TestFsAdapter {
  /**
   * Make an RPC call to the mock FSX service.
   */
  async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const response = await fsx.fetch('https://fsx.do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })

    if (!response.ok) {
      const error = await response.json() as { code?: string; message?: string }
      throw Object.assign(new Error(error.message || `${method} failed`), { code: error.code })
    }

    return response.json() as Promise<T>
  }

  return {
    async read(path, options) {
      const result = await rpc<{ data: string | number[] }>('readFile', { path, encoding: options?.encoding })

      if (options?.encoding === 'utf-8' || options?.encoding === 'utf8') {
        return result.data as string
      }

      if (Array.isArray(result.data)) {
        return new Uint8Array(result.data)
      }

      return result.data as string
    },

    async write(path, data, options) {
      await rpc<{ success: boolean }>('writeFile', { path, data, ...options })
    },

    async exists(path) {
      try {
        await rpc<unknown>('stat', { path })
        return true
      } catch {
        return false
      }
    },

    async stat(path) {
      const result = await rpc<{ size: number; mtime: number; mode: number }>('stat', { path })
      const isDir = (result.mode & 0o40000) === 0o40000

      return {
        size: result.size,
        mtime: new Date(result.mtime),
        isFile: () => !isDir,
        isDirectory: () => isDir,
      }
    },

    async list(path, options) {
      const result = await rpc<{ entries: Array<string | { name: string; type: string }> }>(
        'readdir',
        { path, withFileTypes: options?.withFileTypes }
      )

      if (options?.withFileTypes) {
        return (result.entries as Array<{ name: string; type: string }>).map((e) => ({
          name: e.name,
          isDirectory: () => e.type === 'directory',
        }))
      }

      return result.entries as string[]
    },

    async unlink(path) {
      await rpc<{ success: boolean }>('unlink', { path })
    },

    async mkdir(path, options) {
      await rpc<{ success: boolean }>('mkdir', { path, ...options })
    },

    async rmdir(path, options) {
      await rpc<{ success: boolean }>('rmdir', { path, ...options })
    },
  }
}

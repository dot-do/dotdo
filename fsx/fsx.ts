// @dotdo/fsx - Extended Filesystem Operations for Durable Objects
// Provides POSIX-like filesystem semantics backed by DO SQLite storage

import type {
  FileEntry,
  Stats,
  Dirent,
  MkdirOptions,
  RmdirOptions,
  ReaddirOptions,
  ReadOptions,
  WriteOptions,
  BufferEncoding,
} from './types'
import { F_OK, R_OK, W_OK, X_OK } from './types'
import { FsxBackend, type FsxBackendConfig } from './backend'
import { ENOENT, EEXIST, ENOTDIR, EINVAL, EACCES } from './errors'
import * as path from './path'

// Text encoder/decoder for string operations
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/**
 * FSX Store - File system operations within a Durable Object
 * Implements a Node.js fs-like API
 */
export interface FsxStore {
  // Read operations
  readFile(path: string, options?: ReadOptions): Promise<Uint8Array | string>
  readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>
  stat(path: string): Promise<Stats>
  lstat(path: string): Promise<Stats>
  exists(path: string): Promise<boolean>
  access(path: string, mode?: number): Promise<void>
  readlink(path: string): Promise<string>

  // Write operations
  writeFile(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>
  appendFile(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>
  mkdir(path: string, options?: MkdirOptions): Promise<string | undefined>
  rm(path: string, options?: RmdirOptions): Promise<void>
  rmdir(path: string, options?: RmdirOptions): Promise<void>
  unlink(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  copyFile(src: string, dest: string, flags?: number): Promise<void>
  symlink(target: string, path: string): Promise<void>
  truncate(path: string, len?: number): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  chown(path: string, uid: number, gid: number): Promise<void>
  utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>

  // Utility
  realpath(path: string): Promise<string>
  mkdtemp(prefix: string): Promise<string>
}

/**
 * Create an FSX store instance
 */
export function createFsxStore(config?: Partial<FsxBackendConfig>): FsxStore {
  const backend = new FsxBackend(config)

  /**
   * Convert data to Uint8Array
   */
  function toBytes(data: string | Uint8Array, encoding?: BufferEncoding): Uint8Array {
    if (data instanceof Uint8Array) {
      return data
    }

    switch (encoding) {
      case 'base64':
        return Uint8Array.from(atob(data), c => c.charCodeAt(0))
      case 'hex':
        const bytes = new Uint8Array(data.length / 2)
        for (let i = 0; i < data.length; i += 2) {
          bytes[i / 2] = parseInt(data.slice(i, i + 2), 16)
        }
        return bytes
      case 'binary':
        return Uint8Array.from(data, c => c.charCodeAt(0))
      default:
        return textEncoder.encode(data)
    }
  }

  /**
   * Convert Uint8Array to string
   */
  function fromBytes(data: Uint8Array, encoding?: BufferEncoding): string {
    switch (encoding) {
      case 'base64':
        return btoa(String.fromCharCode(...data))
      case 'hex':
        return Array.from(data)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
      case 'binary':
        return String.fromCharCode(...data)
      default:
        return textDecoder.decode(data)
    }
  }

  const store: FsxStore = {
    async readFile(filePath, options) {
      const content = backend.readFile(filePath)

      if (options?.encoding) {
        return fromBytes(content, options.encoding)
      }

      // Handle partial read
      if (options?.start !== undefined || options?.end !== undefined) {
        const start = options.start ?? 0
        const end = options.end ?? content.length
        return content.slice(start, end)
      }

      return content
    },

    async readdir(dirPath, options) {
      const entries = backend.listDirectoryEntries(dirPath)

      if (options?.withFileTypes) {
        const dirents = entries.map(e => backend.entryToDirent(e))

        if (options.recursive) {
          const allDirents: Dirent[] = [...dirents]
          for (const entry of entries) {
            if (entry.type === 'directory') {
              const subPath = path.join(dirPath, entry.name)
              const subDirents = await store.readdir(subPath, options) as Dirent[]
              for (const sub of subDirents) {
                allDirents.push({
                  ...sub,
                  name: path.join(entry.name, sub.name),
                })
              }
            }
          }
          return allDirents
        }

        return dirents
      }

      const names = entries.map(e => e.name)

      if (options?.recursive) {
        const allNames: string[] = [...names]
        for (const entry of entries) {
          if (entry.type === 'directory') {
            const subPath = path.join(dirPath, entry.name)
            const subNames = await store.readdir(subPath, { recursive: true }) as string[]
            for (const sub of subNames) {
              allNames.push(path.join(entry.name, sub))
            }
          }
        }
        return allNames
      }

      return names
    },

    async stat(filePath) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'stat')
      }

      // Follow symlinks
      if (entry.type === 'symlink' && entry.target) {
        const targetPath = path.resolve(path.dirname(filePath), entry.target)
        return store.stat(targetPath)
      }

      return backend.entryToStats(entry)
    },

    async lstat(filePath) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'lstat')
      }
      return backend.entryToStats(entry)
    },

    async exists(filePath) {
      return backend.exists(filePath)
    },

    async access(filePath, mode = F_OK) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'access')
      }

      // Check permissions (simplified - real implementation would check uid/gid)
      if (mode & R_OK) {
        if (!(entry.mode & 0o004)) {
          throw new EACCES(filePath, 'access')
        }
      }
      if (mode & W_OK) {
        if (!(entry.mode & 0o002)) {
          throw new EACCES(filePath, 'access')
        }
      }
      if (mode & X_OK) {
        if (!(entry.mode & 0o001)) {
          throw new EACCES(filePath, 'access')
        }
      }
    },

    async readlink(filePath) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'readlink')
      }
      if (entry.type !== 'symlink' || !entry.target) {
        throw new EINVAL('not a symbolic link', filePath, 'readlink')
      }
      return entry.target
    },

    async writeFile(filePath, data, options) {
      const bytes = toBytes(data, options?.encoding)

      if (backend.exists(filePath)) {
        backend.writeFile(filePath, bytes)
      } else {
        backend.createFile(filePath, bytes, options?.mode)
      }
    },

    async appendFile(filePath, data, options) {
      const bytes = toBytes(data, options?.encoding)

      if (backend.exists(filePath)) {
        const existing = backend.readFile(filePath)
        const combined = new Uint8Array(existing.length + bytes.length)
        combined.set(existing)
        combined.set(bytes, existing.length)
        backend.writeFile(filePath, combined)
      } else {
        backend.createFile(filePath, bytes, options?.mode)
      }
    },

    async mkdir(dirPath, options) {
      if (options?.recursive) {
        const parts = path.resolve('/', dirPath).split('/').filter(Boolean)
        let current = ''

        for (const part of parts) {
          current = current + '/' + part
          if (!backend.exists(current)) {
            backend.createDirectory(current, options?.mode)
          }
        }

        return dirPath
      } else {
        backend.createDirectory(dirPath, options?.mode)
        return undefined
      }
    },

    async rm(filePath, options) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'rm')
      }

      if (entry.type === 'directory') {
        if (options?.recursive) {
          // Delete children first
          const children = backend.listDirectoryEntries(filePath)
          for (const child of children) {
            const childPath = path.join(filePath, child.name)
            await store.rm(childPath, { recursive: true })
          }
        }
      }

      backend.deleteEntry(filePath)
    },

    async rmdir(dirPath, options) {
      return store.rm(dirPath, options)
    },

    async unlink(filePath) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'unlink')
      }
      if (entry.type === 'directory') {
        throw new EINVAL('is a directory, use rmdir', filePath, 'unlink')
      }
      backend.deleteEntry(filePath)
    },

    async rename(oldPath, newPath) {
      backend.rename(oldPath, newPath)
    },

    async copyFile(src, dest, flags) {
      const content = backend.readFile(src)

      if (flags && (flags & 1) && backend.exists(dest)) {
        throw new EEXIST(dest, 'copyfile')
      }

      if (backend.exists(dest)) {
        backend.writeFile(dest, content)
      } else {
        backend.createFile(dest, content)
      }
    },

    async symlink(target, linkPath) {
      backend.createSymlink(linkPath, target)
    },

    async truncate(filePath, len = 0) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'truncate')
      }

      if (entry.type !== 'file') {
        throw new EINVAL('not a file', filePath, 'truncate')
      }

      const content = entry.content ?? new Uint8Array(0)
      if (len < content.length) {
        backend.writeFile(filePath, content.slice(0, len))
      } else if (len > content.length) {
        const padded = new Uint8Array(len)
        padded.set(content)
        backend.writeFile(filePath, padded)
      }
    },

    async chmod(filePath, mode) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'chmod')
      }

      // Preserve file type bits, only change permission bits
      const typeBits = entry.mode & 0o170000
      entry.mode = typeBits | (mode & 0o7777)
    },

    async chown(filePath, uid, gid) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'chown')
      }

      entry.uid = uid
      entry.gid = gid
    },

    async utimes(filePath, atime, mtime) {
      const entry = backend.getEntry(filePath)
      if (!entry) {
        throw new ENOENT(filePath, 'utimes')
      }

      entry.accessedAt = atime instanceof Date ? atime.getTime() : atime
      entry.modifiedAt = mtime instanceof Date ? mtime.getTime() : mtime
    },

    async realpath(filePath) {
      // Resolve symlinks
      let current = path.resolve('/', filePath)
      const seen = new Set<string>()
      const maxDepth = 40 // Prevent infinite loops

      for (let i = 0; i < maxDepth; i++) {
        if (seen.has(current)) {
          throw new EINVAL('symlink loop detected', filePath, 'realpath')
        }
        seen.add(current)

        const entry = backend.getEntry(current)
        if (!entry) {
          throw new ENOENT(filePath, 'realpath')
        }

        if (entry.type !== 'symlink') {
          return current
        }

        if (!entry.target) {
          return current
        }

        current = path.resolve(path.dirname(current), entry.target)
      }

      throw new EINVAL('too many symbolic links', filePath, 'realpath')
    },

    async mkdtemp(prefix) {
      const randomSuffix = Math.random().toString(36).slice(2, 8)
      const dirPath = prefix + randomSuffix
      await store.mkdir(dirPath)
      return dirPath
    },
  }

  return store
}

// Re-export path utilities
export { path }

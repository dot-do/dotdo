// Storage backend for fsx primitive
// Manages file entries in DO SQLite storage

import type { FileEntry, Stats, Dirent } from './types'
import { S_IFREG, S_IFDIR, S_IFLNK } from './types'
import { ENOENT, EEXIST, ENOTDIR, EISDIR, ENOTEMPTY } from './errors'
import * as path from './path'

/**
 * Configuration for file storage backend
 */
export interface FsxBackendConfig {
  /** Maximum file size to store inline (bytes) */
  inlineThreshold: number
  /** R2 bucket binding for large files (optional) */
  r2Bucket?: R2Bucket
  /** Default file permissions */
  defaultFileMode: number
  /** Default directory permissions */
  defaultDirMode: number
}

/**
 * Default configuration
 */
export const defaultConfig: FsxBackendConfig = {
  inlineThreshold: 64 * 1024, // 64KB
  defaultFileMode: 0o644,
  defaultDirMode: 0o755,
}

/**
 * In-memory storage backend for fsx
 * SQLite backend would extend this with actual persistence
 */
export class FsxBackend {
  private entries: Map<number, FileEntry> = new Map()
  private pathIndex: Map<string, number> = new Map()
  private nextInode: number = 1
  private config: FsxBackendConfig

  constructor(config: Partial<FsxBackendConfig> = {}) {
    this.config = { ...defaultConfig, ...config }
    this.initRoot()
  }

  /**
   * Initialize root directory
   */
  private initRoot(): void {
    const now = Date.now()
    const root: FileEntry = {
      id: 0,
      parentId: null,
      name: '',
      type: 'directory',
      size: 0,
      mode: this.config.defaultDirMode | S_IFDIR,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      accessedAt: now,
    }
    this.entries.set(0, root)
    this.pathIndex.set('/', 0)
  }

  /**
   * Get next available inode
   */
  private allocateInode(): number {
    return this.nextInode++
  }

  /**
   * Resolve a path to its components
   */
  private resolvePath(filePath: string): { parentId: number; name: string; fullPath: string } {
    const normalized = path.normalize(filePath)
    const resolved = path.resolve('/', normalized)
    const parent = path.dirname(resolved)
    const name = path.basename(resolved)

    const parentId = this.pathIndex.get(parent)
    if (parentId === undefined && parent !== '/') {
      throw new ENOENT(parent, 'resolve')
    }

    return {
      parentId: parentId ?? 0,
      name,
      fullPath: resolved,
    }
  }

  /**
   * Get an entry by path
   */
  getEntry(filePath: string): FileEntry | null {
    const normalized = path.resolve('/', filePath)
    const inodeId = this.pathIndex.get(normalized)
    if (inodeId === undefined) {
      return null
    }
    return this.entries.get(inodeId) ?? null
  }

  /**
   * Get an entry by inode
   */
  getEntryById(id: number): FileEntry | null {
    return this.entries.get(id) ?? null
  }

  /**
   * Check if a path exists
   */
  exists(filePath: string): boolean {
    return this.getEntry(filePath) !== null
  }

  /**
   * Create a file entry
   */
  createFile(filePath: string, content?: Uint8Array, mode?: number): FileEntry {
    const { parentId, name, fullPath } = this.resolvePath(filePath)

    // Check parent exists and is a directory
    const parent = this.entries.get(parentId)
    if (!parent || parent.type !== 'directory') {
      throw new ENOTDIR(path.dirname(filePath), 'open')
    }

    // Check file doesn't already exist
    if (this.pathIndex.has(fullPath)) {
      throw new EEXIST(filePath, 'open')
    }

    const now = Date.now()
    const entry: FileEntry = {
      id: this.allocateInode(),
      parentId,
      name,
      type: 'file',
      content: content ?? new Uint8Array(0),
      size: content?.length ?? 0,
      mode: (mode ?? this.config.defaultFileMode) | S_IFREG,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      accessedAt: now,
    }

    this.entries.set(entry.id, entry)
    this.pathIndex.set(fullPath, entry.id)

    // Update parent modification time
    parent.modifiedAt = now

    return entry
  }

  /**
   * Create a directory entry
   */
  createDirectory(filePath: string, mode?: number): FileEntry {
    const { parentId, name, fullPath } = this.resolvePath(filePath)

    // Check parent exists and is a directory
    const parent = this.entries.get(parentId)
    if (!parent || parent.type !== 'directory') {
      throw new ENOTDIR(path.dirname(filePath), 'mkdir')
    }

    // Check directory doesn't already exist
    if (this.pathIndex.has(fullPath)) {
      throw new EEXIST(filePath, 'mkdir')
    }

    const now = Date.now()
    const entry: FileEntry = {
      id: this.allocateInode(),
      parentId,
      name,
      type: 'directory',
      size: 0,
      mode: (mode ?? this.config.defaultDirMode) | S_IFDIR,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      accessedAt: now,
    }

    this.entries.set(entry.id, entry)
    this.pathIndex.set(fullPath, entry.id)

    // Update parent modification time
    parent.modifiedAt = now

    return entry
  }

  /**
   * Create a symlink entry
   */
  createSymlink(linkPath: string, target: string): FileEntry {
    const { parentId, name, fullPath } = this.resolvePath(linkPath)

    // Check parent exists and is a directory
    const parent = this.entries.get(parentId)
    if (!parent || parent.type !== 'directory') {
      throw new ENOTDIR(path.dirname(linkPath), 'symlink')
    }

    // Check link doesn't already exist
    if (this.pathIndex.has(fullPath)) {
      throw new EEXIST(linkPath, 'symlink')
    }

    const now = Date.now()
    const entry: FileEntry = {
      id: this.allocateInode(),
      parentId,
      name,
      type: 'symlink',
      target,
      size: target.length,
      mode: 0o777 | S_IFLNK,
      uid: 0,
      gid: 0,
      createdAt: now,
      modifiedAt: now,
      accessedAt: now,
    }

    this.entries.set(entry.id, entry)
    this.pathIndex.set(fullPath, entry.id)

    // Update parent modification time
    parent.modifiedAt = now

    return entry
  }

  /**
   * Update a file's content
   */
  writeFile(filePath: string, content: Uint8Array): FileEntry {
    const entry = this.getEntry(filePath)
    if (!entry) {
      throw new ENOENT(filePath, 'write')
    }
    if (entry.type !== 'file') {
      throw new EISDIR(filePath, 'write')
    }

    const now = Date.now()
    entry.content = content
    entry.size = content.length
    entry.modifiedAt = now
    entry.accessedAt = now

    return entry
  }

  /**
   * Read a file's content
   */
  readFile(filePath: string): Uint8Array {
    const entry = this.getEntry(filePath)
    if (!entry) {
      throw new ENOENT(filePath, 'read')
    }
    if (entry.type !== 'file') {
      throw new EISDIR(filePath, 'read')
    }

    entry.accessedAt = Date.now()
    return entry.content ?? new Uint8Array(0)
  }

  /**
   * Delete an entry
   */
  deleteEntry(filePath: string): void {
    const normalized = path.resolve('/', filePath)
    const inodeId = this.pathIndex.get(normalized)

    if (inodeId === undefined) {
      throw new ENOENT(filePath, 'unlink')
    }

    const entry = this.entries.get(inodeId)
    if (!entry) {
      throw new ENOENT(filePath, 'unlink')
    }

    // Check if directory is empty
    if (entry.type === 'directory') {
      const children = this.listDirectoryEntries(normalized)
      if (children.length > 0) {
        throw new ENOTEMPTY(filePath, 'rmdir')
      }
    }

    // Update parent modification time
    if (entry.parentId !== null) {
      const parent = this.entries.get(entry.parentId)
      if (parent) {
        parent.modifiedAt = Date.now()
      }
    }

    this.entries.delete(inodeId)
    this.pathIndex.delete(normalized)
  }

  /**
   * List entries in a directory
   */
  listDirectoryEntries(dirPath: string): FileEntry[] {
    const normalized = path.resolve('/', dirPath)
    const dirEntry = this.getEntry(normalized)

    if (!dirEntry) {
      throw new ENOENT(dirPath, 'scandir')
    }
    if (dirEntry.type !== 'directory') {
      throw new ENOTDIR(dirPath, 'scandir')
    }

    dirEntry.accessedAt = Date.now()

    return Array.from(this.entries.values()).filter(e => e.parentId === dirEntry.id)
  }

  /**
   * Rename/move an entry
   */
  rename(oldPath: string, newPath: string): FileEntry {
    const oldNormalized = path.resolve('/', oldPath)
    const entry = this.getEntry(oldNormalized)

    if (!entry) {
      throw new ENOENT(oldPath, 'rename')
    }

    const { parentId, name, fullPath } = this.resolvePath(newPath)

    // Check new parent exists and is a directory
    const newParent = this.entries.get(parentId)
    if (!newParent || newParent.type !== 'directory') {
      throw new ENOTDIR(path.dirname(newPath), 'rename')
    }

    // Check new path doesn't exist (or delete if it does)
    const existing = this.getEntry(fullPath)
    if (existing) {
      if (existing.type === 'directory') {
        const children = this.listDirectoryEntries(fullPath)
        if (children.length > 0) {
          throw new ENOTEMPTY(newPath, 'rename')
        }
      }
      this.entries.delete(existing.id)
    }

    // Update entry
    const oldParent = entry.parentId !== null ? this.entries.get(entry.parentId) : null
    const now = Date.now()

    entry.parentId = parentId
    entry.name = name
    entry.modifiedAt = now

    // Update path index
    this.pathIndex.delete(oldNormalized)
    this.pathIndex.set(fullPath, entry.id)

    // Update parent modification times
    if (oldParent) {
      oldParent.modifiedAt = now
    }
    newParent.modifiedAt = now

    return entry
  }

  /**
   * Convert FileEntry to Stats
   */
  entryToStats(entry: FileEntry): Stats {
    return {
      size: entry.size,
      mode: entry.mode,
      uid: entry.uid,
      gid: entry.gid,
      atime: new Date(entry.accessedAt),
      mtime: new Date(entry.modifiedAt),
      ctime: new Date(entry.modifiedAt),
      birthtime: new Date(entry.createdAt),
      isFile: () => entry.type === 'file',
      isDirectory: () => entry.type === 'directory',
      isSymbolicLink: () => entry.type === 'symlink',
    }
  }

  /**
   * Convert FileEntry to Dirent
   */
  entryToDirent(entry: FileEntry): Dirent {
    return {
      name: entry.name,
      isFile: () => entry.type === 'file',
      isDirectory: () => entry.type === 'directory',
      isSymbolicLink: () => entry.type === 'symlink',
    }
  }

  /**
   * Get path for an entry
   */
  getPathForEntry(entry: FileEntry): string {
    const parts: string[] = [entry.name]
    let current = entry

    while (current.parentId !== null && current.parentId !== 0) {
      const parent = this.entries.get(current.parentId)
      if (!parent) break
      parts.unshift(parent.name)
      current = parent
    }

    return '/' + parts.filter(Boolean).join('/')
  }
}

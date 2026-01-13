/**
 * FileGraphAdapter - fsx integration with Graph Store
 *
 * GREEN PHASE: Implements filesystem operations using the graph store,
 * where files and directories are represented as Things.
 *
 * @see dotdo-wdsod - [GREEN] fsx-as-Things - Implementation
 *
 * Design:
 * - Files are Things with type='File' and data containing path, size, mtime, contentType, contentRef
 * - Directories are Things with type='Directory' and data containing path, mtime
 * - Parent-child relationships use verb='contains'
 * - File-content relationships use verb='hasContent'
 * - Content is stored separately via ContentStore interface (default: in-memory Map)
 * - Path resolution traverses the graph via contains relationships
 */

import type { GraphStore, GraphThing } from '../types'
import { SQLiteGraphStore } from '../stores'
import { createHash } from 'crypto'

// ============================================================================
// TYPES
// ============================================================================

/**
 * File metadata stored in Thing.data
 */
export interface FileData {
  path: string
  size: number
  mtime: number
  contentType: string
  contentRef: string | null
}

/**
 * Directory metadata stored in Thing.data
 */
export interface DirectoryData {
  path: string
  mtime: number
}

/**
 * Options for createFile
 */
export interface CreateFileOptions {
  contentType?: string
}

/**
 * Options for mkdir
 */
export interface MkdirOptions {
  recursive?: boolean
}

/**
 * Content storage interface for blob storage
 */
export interface ContentStore {
  get(ref: string): Promise<string | Uint8Array | null>
  set(content: string | Uint8Array): Promise<string>
  delete(ref: string): Promise<boolean>
}

/**
 * FileGraphAdapter provides filesystem operations via the graph.
 */
export interface FileGraphAdapter {
  // File operations
  createFile(path: string, content: string | Uint8Array, options?: CreateFileOptions): Promise<GraphThing>
  readFile(path: string): Promise<{ metadata: GraphThing; content: string | Uint8Array }>
  writeFile(path: string, content: string | Uint8Array): Promise<GraphThing>
  deleteFile(path: string): Promise<boolean>
  getFile(path: string): Promise<GraphThing | null>

  // Directory operations
  mkdir(path: string, options?: MkdirOptions): Promise<GraphThing>
  rmdir(path: string): Promise<boolean>
  ls(path: string): Promise<GraphThing[]>

  // Path operations
  resolvePath(path: string): Promise<GraphThing | null>
  exists(path: string): Promise<boolean>

  // Utility
  getStore(): GraphStore
  close(): Promise<void>
}

// ============================================================================
// IN-MEMORY CONTENT STORE
// ============================================================================

/**
 * In-memory content store for testing and simple use cases.
 */
export class InMemoryContentStore implements ContentStore {
  private storage = new Map<string, string | Uint8Array>()

  async get(ref: string): Promise<string | Uint8Array | null> {
    return this.storage.get(ref) ?? null
  }

  async set(content: string | Uint8Array): Promise<string> {
    const hash = this.computeHash(content)
    const ref = `blob:sha256-${hash}`
    this.storage.set(ref, content)
    return ref
  }

  async delete(ref: string): Promise<boolean> {
    return this.storage.delete(ref)
  }

  private computeHash(content: string | Uint8Array): string {
    const bytes = typeof content === 'string' ? Buffer.from(content) : content
    return createHash('sha256').update(bytes).digest('hex')
  }
}

// ============================================================================
// CONTENT TYPE DETECTION
// ============================================================================

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.bin': 'application/octet-stream',
}

function detectContentType(path: string, content: string | Uint8Array): string {
  // Check extension
  const lastDotIndex = path.lastIndexOf('.')
  if (lastDotIndex !== -1) {
    const ext = path.slice(lastDotIndex).toLowerCase()
    if (EXTENSION_CONTENT_TYPES[ext]) {
      return EXTENSION_CONTENT_TYPES[ext]!
    }
  }

  // Default based on content type
  if (content instanceof Uint8Array) {
    return 'application/octet-stream'
  }

  return 'text/plain'
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Normalize a path, resolving . and .. segments
 */
function normalizePath(path: string): string {
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path
  }

  const segments = path.split('/').filter((s) => s !== '')
  const result: string[] = []

  for (const segment of segments) {
    if (segment === '.') {
      continue
    } else if (segment === '..') {
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
function getParentPath(path: string): string | null {
  const normalized = normalizePath(path)
  if (normalized === '/') {
    return null
  }

  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) {
    return '/'
  }

  return normalized.slice(0, lastSlash)
}

/**
 * Get path segments (excluding root)
 */
function getPathSegments(path: string): string[] {
  const normalized = normalizePath(path)
  if (normalized === '/') {
    return []
  }

  return normalized.slice(1).split('/')
}

/**
 * Generate a unique ID from a path
 */
function pathToId(path: string): string {
  const normalized = normalizePath(path)
  // Use a consistent ID scheme based on path
  return `fs:${normalized}`
}

// ============================================================================
// FILE GRAPH ADAPTER IMPLEMENTATION
// ============================================================================

class FileGraphAdapterImpl implements FileGraphAdapter {
  private store: SQLiteGraphStore
  private contentStore: ContentStore
  private initialized = false
  private typeIdCounter = 1

  constructor(store: SQLiteGraphStore, contentStore?: ContentStore) {
    this.store = store
    this.contentStore = contentStore ?? new InMemoryContentStore()
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.store.initialize()

    // Ensure root directory exists
    const root = await this.store.getThing(pathToId('/'))
    if (!root) {
      await this.store.createThing({
        id: pathToId('/'),
        typeId: this.getTypeId('Directory'),
        typeName: 'Directory',
        data: {
          path: '/',
          mtime: Date.now(),
        } as DirectoryData,
      })
    }

    this.initialized = true
  }

  // =========================================================================
  // FILE OPERATIONS
  // =========================================================================

  async createFile(
    path: string,
    content: string | Uint8Array,
    options?: CreateFileOptions
  ): Promise<GraphThing> {
    const normalized = normalizePath(path)

    // Ensure parent directories exist
    await this.ensureParentDirectories(normalized)

    // Store content
    const contentRef = await this.contentStore.set(content)

    // Compute size
    const size = typeof content === 'string' ? Buffer.from(content).length : content.length

    // Determine content type
    const contentType = options?.contentType ?? detectContentType(normalized, content)

    // Create the file Thing
    const fileData: FileData = {
      path: normalized,
      size,
      mtime: Date.now(),
      contentType,
      contentRef,
    }

    const file = await this.store.createThing({
      id: pathToId(normalized),
      typeId: this.getTypeId('File'),
      typeName: 'File',
      data: fileData,
    })

    // Create relationship from parent directory
    const parentPath = getParentPath(normalized)
    if (parentPath !== null) {
      const parentId = pathToId(parentPath)
      await this.store.createRelationship({
        id: `rel:contains:${parentId}:${file.id}`,
        verb: 'contains',
        from: `thing://${parentId}`,
        to: `thing://${file.id}`,
      })
    }

    // Create hasContent relationship
    await this.store.createRelationship({
      id: `rel:hasContent:${file.id}`,
      verb: 'hasContent',
      from: `thing://${file.id}`,
      to: contentRef,
    })

    return file
  }

  async readFile(path: string): Promise<{ metadata: GraphThing; content: string | Uint8Array }> {
    const normalized = normalizePath(path)
    const file = await this.store.getThing(pathToId(normalized))

    if (!file || file.typeName !== 'File') {
      throw new Error(`ENOENT: no such file '${path}'`)
    }

    const fileData = file.data as FileData
    if (!fileData.contentRef) {
      throw new Error(`File '${path}' has no content`)
    }

    const content = await this.contentStore.get(fileData.contentRef)
    if (content === null) {
      throw new Error(`Content not found for file '${path}'`)
    }

    return { metadata: file, content }
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<GraphThing> {
    const normalized = normalizePath(path)
    const existingFile = await this.store.getThing(pathToId(normalized))

    if (!existingFile) {
      // Create new file
      return this.createFile(path, content)
    }

    // Update existing file
    const existingData = existingFile.data as FileData

    // Store new content
    const newContentRef = await this.contentStore.set(content)

    // Compute new size
    const newSize = typeof content === 'string' ? Buffer.from(content).length : content.length

    // Update file Thing
    const updatedData: FileData = {
      ...existingData,
      size: newSize,
      mtime: Date.now(),
      contentRef: newContentRef,
    }

    const updated = await this.store.updateThing(existingFile.id, { data: updatedData })

    // Update hasContent relationship
    // First delete old one
    await this.store.deleteRelationship(`rel:hasContent:${existingFile.id}`)

    // Create new hasContent relationship
    await this.store.createRelationship({
      id: `rel:hasContent:${existingFile.id}`,
      verb: 'hasContent',
      from: `thing://${existingFile.id}`,
      to: newContentRef,
    })

    return updated!
  }

  async deleteFile(path: string): Promise<boolean> {
    const normalized = normalizePath(path)
    const file = await this.store.getThing(pathToId(normalized))

    if (!file || file.typeName !== 'File') {
      return false
    }

    // Delete hasContent relationship
    await this.store.deleteRelationship(`rel:hasContent:${file.id}`)

    // Delete contains relationship from parent
    const parentPath = getParentPath(normalized)
    if (parentPath !== null) {
      const parentId = pathToId(parentPath)
      await this.store.deleteRelationship(`rel:contains:${parentId}:${file.id}`)
    }

    // Delete the file Thing
    await this.store.deleteThing(file.id)

    return true
  }

  async getFile(path: string): Promise<GraphThing | null> {
    const normalized = normalizePath(path)
    const file = await this.store.getThing(pathToId(normalized))

    if (!file || file.typeName !== 'File' || file.deletedAt !== null) {
      return null
    }

    return file
  }

  // =========================================================================
  // DIRECTORY OPERATIONS
  // =========================================================================

  async mkdir(path: string, options?: MkdirOptions): Promise<GraphThing> {
    const normalized = normalizePath(path)

    // Check if already exists
    const existing = await this.store.getThing(pathToId(normalized))
    if (existing) {
      if (existing.typeName === 'Directory') {
        return existing
      }
      throw new Error(`EEXIST: '${path}' already exists as a file`)
    }

    // Check parent exists
    const parentPath = getParentPath(normalized)
    if (parentPath !== null && parentPath !== '/') {
      const parent = await this.store.getThing(pathToId(parentPath))
      if (!parent) {
        if (options?.recursive) {
          await this.mkdir(parentPath, { recursive: true })
        } else {
          throw new Error(`ENOENT: parent directory '${parentPath}' does not exist`)
        }
      }
    }

    // Create the directory Thing
    const dirData: DirectoryData = {
      path: normalized,
      mtime: Date.now(),
    }

    const dir = await this.store.createThing({
      id: pathToId(normalized),
      typeId: this.getTypeId('Directory'),
      typeName: 'Directory',
      data: dirData,
    })

    // Create relationship from parent directory
    if (parentPath !== null) {
      const parentId = pathToId(parentPath)
      await this.store.createRelationship({
        id: `rel:contains:${parentId}:${dir.id}`,
        verb: 'contains',
        from: `thing://${parentId}`,
        to: `thing://${dir.id}`,
      })
    }

    return dir
  }

  async rmdir(path: string): Promise<boolean> {
    const normalized = normalizePath(path)

    if (normalized === '/') {
      throw new Error('EPERM: cannot remove root directory')
    }

    const dir = await this.store.getThing(pathToId(normalized))

    if (!dir || dir.typeName !== 'Directory') {
      return false
    }

    // Check if directory is empty
    const contents = await this.ls(normalized)
    if (contents.length > 0) {
      throw new Error(`ENOTEMPTY: directory '${path}' is not empty`)
    }

    // Delete contains relationship from parent
    const parentPath = getParentPath(normalized)
    if (parentPath !== null) {
      const parentId = pathToId(parentPath)
      await this.store.deleteRelationship(`rel:contains:${parentId}:${dir.id}`)
    }

    // Delete the directory Thing
    await this.store.deleteThing(dir.id)

    return true
  }

  async ls(path: string): Promise<GraphThing[]> {
    const normalized = normalizePath(path)
    const dir = await this.store.getThing(pathToId(normalized))

    if (!dir || dir.typeName !== 'Directory') {
      throw new Error(`ENOENT: no such directory '${path}'`)
    }

    // Query contains relationships from this directory
    const relationships = await this.store.queryRelationshipsFrom(`thing://${dir.id}`, {
      verb: 'contains',
    })

    // Get the child Things
    const children: GraphThing[] = []
    for (const rel of relationships) {
      const childId = rel.to.replace('thing://', '')
      const child = await this.store.getThing(childId)
      if (child && !child.deletedAt) {
        children.push(child)
      }
    }

    return children
  }

  // =========================================================================
  // PATH OPERATIONS
  // =========================================================================

  async resolvePath(path: string): Promise<GraphThing | null> {
    const normalized = normalizePath(path)
    const thing = await this.store.getThing(pathToId(normalized))
    if (!thing || thing.deletedAt !== null) {
      return null
    }
    return thing
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path)
    const thing = await this.store.getThing(pathToId(normalized))
    return thing !== null && thing.deletedAt === null
  }

  // =========================================================================
  // UTILITY
  // =========================================================================

  getStore(): GraphStore {
    return this.store
  }

  async close(): Promise<void> {
    await this.store.close()
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  private getTypeId(typeName: string): number {
    // Simple type ID assignment
    switch (typeName) {
      case 'Directory':
        return 1
      case 'File':
        return 2
      default:
        return this.typeIdCounter++
    }
  }

  private async ensureParentDirectories(path: string): Promise<void> {
    const segments = getPathSegments(path)
    if (segments.length <= 1) {
      // No intermediate directories needed (file is at root)
      return
    }

    // Create all parent directories (excluding the file itself)
    let currentPath = ''
    for (let i = 0; i < segments.length - 1; i++) {
      currentPath += '/' + segments[i]
      const existing = await this.store.getThing(pathToId(currentPath))
      if (!existing) {
        await this.mkdir(currentPath, { recursive: true })
      }
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new FileGraphAdapter.
 *
 * @param options - Optional configuration
 * @returns A FileGraphAdapter instance ready to use
 *
 * @example
 * ```typescript
 * const adapter = await createFileGraphAdapter()
 *
 * // Create a file
 * await adapter.createFile('/readme.md', '# Hello')
 *
 * // Read the file
 * const { metadata, content } = await adapter.readFile('/readme.md')
 *
 * // List directory
 * const files = await adapter.ls('/')
 *
 * // Clean up
 * await adapter.close()
 * ```
 */
export async function createFileGraphAdapter(options?: {
  contentStore?: ContentStore
}): Promise<FileGraphAdapter> {
  const store = new SQLiteGraphStore(':memory:')
  const adapter = new FileGraphAdapterImpl(store, options?.contentStore)
  await adapter.initialize()
  return adapter
}

// Export the implementation class for advanced use cases
export { FileGraphAdapterImpl }

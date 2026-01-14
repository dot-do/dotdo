/**
 * Document Versioning
 *
 * Provides version control for documents with:
 * - Automatic version numbering
 * - Version retrieval (specific, latest, list)
 * - Revert to previous versions
 * - Diff generation between versions
 *
 * @module lib/documents/versioning
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Metadata associated with a document version
 */
export interface VersionMetadata {
  /** User who created this version */
  author?: string
  /** Commit message describing the change */
  message?: string
  /** Labels/tags for categorization */
  labels?: string[]
  /** Reference to version this was reverted from */
  revertedFrom?: number
  /** Additional custom metadata */
  [key: string]: unknown
}

/**
 * A single version of a document
 */
export interface DocumentVersion<T = unknown> {
  /** Unique identifier for this version */
  id: string
  /** Document ID this version belongs to */
  docId: string
  /** Version number (1-indexed, auto-incrementing) */
  version: number
  /** Content snapshot at this version */
  content: T
  /** When this version was created */
  createdAt: Date
  /** Optional metadata */
  metadata?: VersionMetadata
}

/**
 * A single change in a diff
 */
export interface VersionChange {
  /** Type of change */
  type: 'added' | 'removed' | 'modified'
  /** JSON path to the changed field */
  path: string
  /** Previous value (for removed/modified) */
  oldValue?: unknown
  /** New value (for added/modified) */
  newValue?: unknown
}

/**
 * Diff between two versions
 */
export interface VersionDiff {
  /** Document ID */
  docId: string
  /** Source version number */
  fromVersion: number
  /** Target version number */
  toVersion: number
  /** List of changes */
  changes: VersionChange[]
}

/**
 * Options for listing versions
 */
export interface ListVersionsOptions {
  /** Sort order */
  order?: 'asc' | 'desc'
  /** Maximum number of versions to return */
  limit?: number
  /** Number of versions to skip */
  offset?: number
}

/**
 * Storage backend interface for document versions
 */
export interface DocumentVersionStorage {
  /** Save a new version */
  save(version: DocumentVersion): Promise<void>
  /** Get a specific version */
  get(docId: string, version: number): Promise<DocumentVersion | null>
  /** Get the latest version */
  getLatest(docId: string): Promise<DocumentVersion | null>
  /** List all versions for a document */
  list(docId: string, options?: ListVersionsOptions): Promise<DocumentVersion[]>
  /** Get the next version number for a document */
  getNextVersion(docId: string): Promise<number>
}

/**
 * Options for creating a DocumentVersionManager
 */
export interface DocumentVersionManagerOptions {
  /** Custom storage backend */
  storage?: DocumentVersionStorage
}

/**
 * Document version manager interface
 */
export interface DocumentVersionManager {
  /**
   * Create a new version of a document
   * @param docId Document identifier
   * @param content Content to snapshot
   * @param metadata Optional version metadata
   * @returns The created version
   */
  createVersion<T>(docId: string, content: T, metadata?: VersionMetadata): Promise<DocumentVersion<T>>

  /**
   * Get a specific version of a document
   * @param docId Document identifier
   * @param version Version number
   * @returns The version or null if not found
   */
  getVersion<T = unknown>(docId: string, version: number): Promise<DocumentVersion<T> | null>

  /**
   * Get the latest version of a document
   * @param docId Document identifier
   * @returns The latest version or null if no versions exist
   */
  getLatest<T = unknown>(docId: string): Promise<DocumentVersion<T> | null>

  /**
   * List all versions of a document
   * @param docId Document identifier
   * @param options Pagination and sorting options
   * @returns Array of versions
   */
  listVersions<T = unknown>(docId: string, options?: ListVersionsOptions): Promise<DocumentVersion<T>[]>

  /**
   * Revert to a previous version (creates a new version with old content)
   * @param docId Document identifier
   * @param version Version number to revert to
   * @param metadata Optional metadata for the revert version
   * @returns The new version created from the revert
   */
  revert<T = unknown>(docId: string, version: number, metadata?: VersionMetadata): Promise<DocumentVersion<T>>

  /**
   * Generate a diff between two versions
   * @param docId Document identifier
   * @param v1 First version number
   * @param v2 Second version number
   * @returns Diff between the versions
   */
  diff(docId: string, v1: number, v2: number): Promise<VersionDiff>
}

// ============================================================================
// IN-MEMORY STORAGE IMPLEMENTATION
// ============================================================================

/**
 * In-memory storage backend for document versions
 */
class InMemoryVersionStorage implements DocumentVersionStorage {
  private versions = new Map<string, DocumentVersion[]>()
  private locks = new Map<string, Promise<void>>()

  /**
   * Acquire a lock for a document to ensure sequential version numbers
   */
  private async acquireLock(docId: string): Promise<() => void> {
    // Wait for any existing lock to release
    const existingLock = this.locks.get(docId)
    if (existingLock) {
      await existingLock
    }

    // Create a new lock
    let releaseLock: () => void
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    this.locks.set(docId, lockPromise)

    return releaseLock!
  }

  async save(version: DocumentVersion): Promise<void> {
    const docVersions = this.versions.get(version.docId) || []
    docVersions.push(version)
    this.versions.set(version.docId, docVersions)
  }

  async get(docId: string, version: number): Promise<DocumentVersion | null> {
    const docVersions = this.versions.get(docId) || []
    return docVersions.find((v) => v.version === version) ?? null
  }

  async getLatest(docId: string): Promise<DocumentVersion | null> {
    const docVersions = this.versions.get(docId) || []
    if (docVersions.length === 0) return null
    return docVersions.reduce((latest, v) => (v.version > latest.version ? v : latest), docVersions[0])
  }

  async list(docId: string, options?: ListVersionsOptions): Promise<DocumentVersion[]> {
    let docVersions = [...(this.versions.get(docId) || [])]

    // Sort by version number
    const order = options?.order ?? 'asc'
    docVersions.sort((a, b) => (order === 'asc' ? a.version - b.version : b.version - a.version))

    // Apply pagination
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? docVersions.length

    return docVersions.slice(offset, offset + limit)
  }

  async getNextVersion(docId: string): Promise<number> {
    const releaseLock = await this.acquireLock(docId)
    try {
      const docVersions = this.versions.get(docId) || []
      if (docVersions.length === 0) return 1
      const maxVersion = Math.max(...docVersions.map((v) => v.version))
      return maxVersion + 1
    } finally {
      releaseLock()
    }
  }

  /**
   * Thread-safe version creation
   */
  async createVersionAtomic(docId: string, createFn: (nextVersion: number) => DocumentVersion): Promise<DocumentVersion> {
    const releaseLock = await this.acquireLock(docId)
    try {
      const docVersions = this.versions.get(docId) || []
      const nextVersion = docVersions.length === 0 ? 1 : Math.max(...docVersions.map((v) => v.version)) + 1
      const version = createFn(nextVersion)
      docVersions.push(version)
      this.versions.set(docId, docVersions)
      return version
    } finally {
      releaseLock()
    }
  }
}

// ============================================================================
// DIFF UTILITIES
// ============================================================================

/**
 * Generate a unique ID for a version
 */
function generateVersionId(): string {
  return `v_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Deep clone an object to ensure immutability
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

/**
 * Compare two values and generate changes
 */
function compareValues(oldValue: unknown, newValue: unknown, path: string, changes: VersionChange[]): void {
  const oldType = typeof oldValue
  const newType = typeof newValue

  // Handle null specially
  const oldIsNull = oldValue === null
  const newIsNull = newValue === null

  if (oldIsNull && newIsNull) {
    // Both null, no change
    return
  }

  if (oldIsNull !== newIsNull || oldType !== newType) {
    // Type changed
    if (oldValue !== undefined && oldValue !== null) {
      if (newValue === undefined) {
        changes.push({ type: 'removed', path, oldValue })
      } else {
        changes.push({ type: 'modified', path, oldValue, newValue })
      }
    } else if (newValue !== undefined && newValue !== null) {
      changes.push({ type: 'added', path, newValue })
    }
    return
  }

  if (oldType !== 'object' || oldIsNull) {
    // Primitive comparison
    if (oldValue !== newValue) {
      changes.push({ type: 'modified', path, oldValue, newValue })
    }
    return
  }

  // Object/Array comparison
  const oldObj = oldValue as Record<string, unknown>
  const newObj = newValue as Record<string, unknown>
  const oldIsArray = Array.isArray(oldObj)
  const newIsArray = Array.isArray(newObj)

  if (oldIsArray !== newIsArray) {
    // Array vs object type change
    changes.push({ type: 'modified', path, oldValue, newValue })
    return
  }

  if (oldIsArray) {
    // Array comparison
    const oldArr = oldValue as unknown[]
    const newArr = newValue as unknown[]
    const maxLen = Math.max(oldArr.length, newArr.length)

    for (let i = 0; i < maxLen; i++) {
      const itemPath = `${path}[${i}]`
      if (i >= oldArr.length) {
        changes.push({ type: 'added', path: itemPath, newValue: newArr[i] })
      } else if (i >= newArr.length) {
        changes.push({ type: 'removed', path: itemPath, oldValue: oldArr[i] })
      } else if (JSON.stringify(oldArr[i]) !== JSON.stringify(newArr[i])) {
        // Simple comparison for array items - could be made recursive
        changes.push({ type: 'modified', path: itemPath, oldValue: oldArr[i], newValue: newArr[i] })
      }
    }
    return
  }

  // Object comparison
  const allKeys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]))

  for (const key of allKeys) {
    const childPath = path ? `${path}.${key}` : key
    const oldVal = oldObj[key]
    const newVal = newObj[key]

    if (!(key in oldObj)) {
      changes.push({ type: 'added', path: childPath, newValue: newVal })
    } else if (!(key in newObj)) {
      changes.push({ type: 'removed', path: childPath, oldValue: oldVal })
    } else {
      compareValues(oldVal, newVal, childPath, changes)
    }
  }
}

/**
 * Generate diff between two content objects
 */
function generateDiff(oldContent: unknown, newContent: unknown): VersionChange[] {
  const changes: VersionChange[] = []
  compareValues(oldContent, newContent, '', changes)
  return changes
}

// ============================================================================
// DOCUMENT VERSION MANAGER IMPLEMENTATION
// ============================================================================

/**
 * Default implementation of DocumentVersionManager
 */
class DefaultDocumentVersionManager implements DocumentVersionManager {
  private storage: DocumentVersionStorage
  private inMemoryStorage: InMemoryVersionStorage | null = null

  constructor(options?: DocumentVersionManagerOptions) {
    if (options?.storage) {
      this.storage = options.storage
    } else {
      this.inMemoryStorage = new InMemoryVersionStorage()
      this.storage = this.inMemoryStorage
    }
  }

  async createVersion<T>(docId: string, content: T, metadata?: VersionMetadata): Promise<DocumentVersion<T>> {
    // Clone content to ensure immutability
    const clonedContent = deepClone(content)

    if (this.inMemoryStorage) {
      // Use atomic operation for in-memory storage
      return this.inMemoryStorage.createVersionAtomic(docId, (nextVersion) => ({
        id: generateVersionId(),
        docId,
        version: nextVersion,
        content: clonedContent,
        createdAt: new Date(),
        metadata,
      })) as Promise<DocumentVersion<T>>
    }

    // For custom storage, use getNextVersion
    const nextVersion = await this.storage.getNextVersion(docId)

    const version: DocumentVersion<T> = {
      id: generateVersionId(),
      docId,
      version: nextVersion,
      content: clonedContent,
      createdAt: new Date(),
      metadata,
    }

    await this.storage.save(version)
    return version
  }

  async getVersion<T = unknown>(docId: string, version: number): Promise<DocumentVersion<T> | null> {
    return (await this.storage.get(docId, version)) as DocumentVersion<T> | null
  }

  async getLatest<T = unknown>(docId: string): Promise<DocumentVersion<T> | null> {
    return (await this.storage.getLatest(docId)) as DocumentVersion<T> | null
  }

  async listVersions<T = unknown>(docId: string, options?: ListVersionsOptions): Promise<DocumentVersion<T>[]> {
    return (await this.storage.list(docId, options)) as DocumentVersion<T>[]
  }

  async revert<T = unknown>(docId: string, version: number, metadata?: VersionMetadata): Promise<DocumentVersion<T>> {
    const targetVersion = await this.storage.get(docId, version)

    if (!targetVersion) {
      throw new Error(`Version ${version} not found for document ${docId}`)
    }

    // Create new version with old content and revertedFrom metadata
    const revertMetadata: VersionMetadata = {
      ...metadata,
      revertedFrom: version,
    }

    return this.createVersion(docId, targetVersion.content as T, revertMetadata)
  }

  async diff(docId: string, v1: number, v2: number): Promise<VersionDiff> {
    const version1 = await this.storage.get(docId, v1)
    const version2 = await this.storage.get(docId, v2)

    if (!version1) {
      throw new Error(`Version ${v1} not found for document ${docId}`)
    }

    if (!version2) {
      throw new Error(`Version ${v2} not found for document ${docId}`)
    }

    const changes = generateDiff(version1.content, version2.content)

    return {
      docId,
      fromVersion: v1,
      toVersion: v2,
      changes,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new DocumentVersionManager instance
 *
 * @param options Configuration options
 * @returns A new DocumentVersionManager
 *
 * @example
 * ```ts
 * const manager = createDocumentVersionManager()
 *
 * // Create versions
 * await manager.createVersion('doc-1', { title: 'Hello' })
 * await manager.createVersion('doc-1', { title: 'Hello World' })
 *
 * // Get specific version
 * const v1 = await manager.getVersion('doc-1', 1)
 *
 * // Get latest
 * const latest = await manager.getLatest('doc-1')
 *
 * // List all versions
 * const versions = await manager.listVersions('doc-1')
 *
 * // Revert to previous version
 * await manager.revert('doc-1', 1)
 *
 * // Generate diff
 * const diff = await manager.diff('doc-1', 1, 2)
 * ```
 */
export function createDocumentVersionManager(options?: DocumentVersionManagerOptions): DocumentVersionManager {
  return new DefaultDocumentVersionManager(options)
}

// Export the default implementation class for extension
export { DefaultDocumentVersionManager }

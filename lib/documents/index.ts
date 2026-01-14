/**
 * Documents module exports
 *
 * Provides document management utilities for dotdo including:
 * - Document versioning with automatic version numbering
 * - Version retrieval, listing, and pagination
 * - Revert to previous versions
 * - Diff generation between versions
 *
 * @module lib/documents
 *
 * @example
 * ```typescript
 * import { createDocumentVersionManager } from './lib/documents'
 *
 * const manager = createDocumentVersionManager()
 *
 * // Create versions
 * await manager.createVersion('doc-1', { title: 'Draft' }, { author: 'user-123' })
 * await manager.createVersion('doc-1', { title: 'Final' }, { author: 'user-123' })
 *
 * // Get the latest version
 * const latest = await manager.getLatest('doc-1')
 *
 * // Generate diff between versions
 * const diff = await manager.diff('doc-1', 1, 2)
 *
 * // Revert to a previous version
 * await manager.revert('doc-1', 1)
 * ```
 */

export {
  // Types
  type VersionMetadata,
  type DocumentVersion,
  type VersionChange,
  type VersionDiff,
  type ListVersionsOptions,
  type DocumentVersionStorage,
  type DocumentVersionManagerOptions,
  type DocumentVersionManager,

  // Factory Functions
  createDocumentVersionManager,

  // Classes (for extension)
  DefaultDocumentVersionManager,
} from './versioning'

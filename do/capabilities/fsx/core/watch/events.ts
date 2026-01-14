/**
 * Watch event types and factory functions for fsx.do
 *
 * Watch events are emitted when files or directories change in the filesystem.
 * Events include optional metadata to provide additional context about the change.
 *
 * @module core/watch/events
 */

/**
 * The type of filesystem change that occurred.
 *
 * - `create`: A new file or directory was created
 * - `modify`: An existing file's content was modified
 * - `delete`: A file or directory was deleted
 * - `rename`: A file or directory was renamed/moved
 */
export type WatchEventType = 'create' | 'modify' | 'delete' | 'rename'

/**
 * Optional metadata that can be included with watch events.
 * All fields are optional to optimize event payload size.
 *
 * @property size - File size in bytes (undefined for directories or deleted files)
 * @property mtime - Last modification time as Unix timestamp in milliseconds
 * @property isDirectory - Whether the path refers to a directory
 */
export interface WatchEventMetadata {
  /** File size in bytes. Only meaningful for files (not directories). */
  size?: number
  /** Last modification time as Unix timestamp (milliseconds since epoch). */
  mtime?: number
  /** Whether the path refers to a directory rather than a file. */
  isDirectory?: boolean
}

/**
 * Represents a filesystem change event.
 *
 * Watch events are emitted when files or directories are created, modified,
 * deleted, or renamed. Events include a timestamp and optional metadata
 * providing additional context about the changed file.
 *
 * @example
 * ```typescript
 * // Create event with metadata
 * const event = createWatchEvent('create', '/data/config.json', {
 *   size: 1024,
 *   mtime: Date.now(),
 *   isDirectory: false,
 * })
 *
 * // Rename event
 * const renameEvent = createWatchEvent('rename', '/old.txt', '/new.txt', {
 *   size: 512,
 * })
 * ```
 */
export interface WatchEvent extends WatchEventMetadata {
  /** The type of change that occurred. */
  type: WatchEventType
  /** The path of the file or directory that changed. For rename events, this is the new path. */
  path: string
  /** Unix timestamp (milliseconds) when the event was created. */
  timestamp: number
  /** For rename events only: the original path before renaming. */
  oldPath?: string
}

/**
 * Factory function to create watch events with optional metadata.
 *
 * Creates a WatchEvent with the current timestamp and any provided metadata.
 * The function supports two calling patterns:
 *
 * **Standard events (create, modify, delete):**
 * ```typescript
 * createWatchEvent('create', '/path/to/file', { size: 1024 })
 * createWatchEvent('modify', '/path/to/file', { size: 2048, mtime: Date.now() })
 * createWatchEvent('delete', '/path/to/file')
 * ```
 *
 * **Rename events:**
 * ```typescript
 * createWatchEvent('rename', '/old/path', '/new/path', { size: 512 })
 * ```
 *
 * @param type - The type of filesystem change
 * @param path - The file path. For rename events, this is the OLD path.
 * @param newPathOrMetadata - For rename events: the NEW path. For other events: optional metadata.
 * @param metadata - For rename events only: optional metadata about the renamed file.
 * @returns A WatchEvent object with timestamp and any provided metadata
 *
 * @example
 * ```typescript
 * // Create event with full metadata
 * const event = createWatchEvent('create', '/data/file.json', {
 *   size: 1024,
 *   mtime: Date.now(),
 *   isDirectory: false,
 * })
 *
 * // Rename event with metadata
 * const renamed = createWatchEvent('rename', '/old.txt', '/new.txt', {
 *   size: 512,
 *   isDirectory: false,
 * })
 * ```
 */
export function createWatchEvent(
  type: WatchEventType,
  path: string,
  newPathOrMetadata?: string | WatchEventMetadata,
  metadata?: WatchEventMetadata
): WatchEvent {
  if (type === 'rename') {
    // For rename: newPathOrMetadata is the new path, metadata is optional metadata
    const newPath = newPathOrMetadata as string
    return {
      type,
      path: newPath,
      oldPath: path,
      timestamp: Date.now(),
      ...metadata,
    }
  }

  // For non-rename events: newPathOrMetadata is optional metadata
  const eventMetadata = newPathOrMetadata as WatchEventMetadata | undefined
  return {
    type,
    path,
    timestamp: Date.now(),
    ...eventMetadata,
  }
}

/**
 * Type guard for create events.
 *
 * Use this to narrow a WatchEvent to a create event in conditional checks.
 *
 * @param event - The watch event to check
 * @returns True if the event is a create event
 *
 * @example
 * ```typescript
 * if (isCreateEvent(event)) {
 *   console.log(`New file created: ${event.path}, size: ${event.size}`)
 * }
 * ```
 */
export function isCreateEvent(event: WatchEvent): event is WatchEvent & { type: 'create' } {
  return event.type === 'create'
}

/**
 * Type guard for modify events.
 *
 * Use this to narrow a WatchEvent to a modify event in conditional checks.
 *
 * @param event - The watch event to check
 * @returns True if the event is a modify event
 *
 * @example
 * ```typescript
 * if (isModifyEvent(event)) {
 *   console.log(`File modified: ${event.path}, new size: ${event.size}`)
 * }
 * ```
 */
export function isModifyEvent(event: WatchEvent): event is WatchEvent & { type: 'modify' } {
  return event.type === 'modify'
}

/**
 * Type guard for delete events.
 *
 * Use this to narrow a WatchEvent to a delete event in conditional checks.
 * Note: Delete events typically do not include size or mtime metadata
 * since the file no longer exists.
 *
 * @param event - The watch event to check
 * @returns True if the event is a delete event
 *
 * @example
 * ```typescript
 * if (isDeleteEvent(event)) {
 *   console.log(`File deleted: ${event.path}`)
 * }
 * ```
 */
export function isDeleteEvent(event: WatchEvent): event is WatchEvent & { type: 'delete' } {
  return event.type === 'delete'
}

/**
 * Type guard for rename events.
 *
 * Use this to narrow a WatchEvent to a rename event in conditional checks.
 * Rename events include the oldPath property with the original file path.
 *
 * @param event - The watch event to check
 * @returns True if the event is a rename event (guaranteed to have oldPath)
 *
 * @example
 * ```typescript
 * if (isRenameEvent(event)) {
 *   console.log(`File renamed: ${event.oldPath} -> ${event.path}`)
 * }
 * ```
 */
export function isRenameEvent(event: WatchEvent): event is WatchEvent & { type: 'rename'; oldPath: string } {
  return event.type === 'rename'
}

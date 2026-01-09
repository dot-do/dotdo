/**
 * Memory-only runtime for DuckDB in Workers environment
 *
 * This module provides a virtual file system backed by in-memory buffers,
 * since Cloudflare Workers don't have access to a real filesystem.
 */

// ============================================================================
// Instance-Scoped File Buffer Registry
// ============================================================================

/**
 * Instance-scoped file buffer registry.
 * Each DuckDB instance should have its own registry to ensure isolation.
 */
export class FileBufferRegistry {
  private readonly buffers = new Map<string, Uint8Array>()

  /**
   * Register a buffer as a virtual file
   * @param name - Virtual file path/name
   * @param buffer - Data to store
   */
  register(name: string, buffer: ArrayBuffer | Uint8Array): void {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    this.buffers.set(name, data)
  }

  /**
   * Remove a virtual file from the registry
   * @param name - Virtual file path/name to remove
   * @returns true if file was removed, false if it didn't exist
   */
  drop(name: string): boolean {
    return this.buffers.delete(name)
  }

  /**
   * Retrieve a registered file buffer
   * @param name - Virtual file path/name
   * @returns The buffer if found, undefined otherwise
   */
  get(name: string): Uint8Array | undefined {
    return this.buffers.get(name)
  }

  /**
   * Check if a virtual file exists
   * @param name - Virtual file path/name
   * @returns true if file is registered
   */
  has(name: string): boolean {
    return this.buffers.has(name)
  }

  /**
   * List all registered virtual files
   * @returns Array of registered file names
   */
  list(): string[] {
    return Array.from(this.buffers.keys())
  }

  /**
   * Get the size of a registered file
   * @param name - Virtual file path/name
   * @returns Size in bytes, or -1 if not found
   */
  size(name: string): number {
    const buffer = this.buffers.get(name)
    return buffer ? buffer.byteLength : -1
  }

  /**
   * Clear all registered files and free memory
   */
  clear(): void {
    this.buffers.clear()
  }

  /**
   * Get total memory used by all registered files
   * @returns Total bytes used
   */
  totalMemoryUsage(): number {
    let total = 0
    for (const buffer of this.buffers.values()) {
      total += buffer.byteLength
    }
    return total
  }

  /**
   * Get the number of registered files
   */
  get fileCount(): number {
    return this.buffers.size
  }
}

// ============================================================================
// Global Registry (for backward compatibility)
// ============================================================================

/**
 * Default global file buffer registry.
 * Used by the legacy global functions for backward compatibility.
 * New code should use instance-scoped FileBufferRegistry instead.
 */
const globalRegistry = new FileBufferRegistry()

/**
 * Register a buffer as a virtual file (global registry)
 * @deprecated Use FileBufferRegistry instance methods for isolation
 * @param name - Virtual file path/name
 * @param buffer - Data to store
 */
export function registerFileBuffer(name: string, buffer: ArrayBuffer | Uint8Array): void {
  globalRegistry.register(name, buffer)
}

/**
 * Remove a virtual file from the registry (global registry)
 * @deprecated Use FileBufferRegistry instance methods for isolation
 * @param name - Virtual file path/name to remove
 * @returns true if file was removed, false if it didn't exist
 */
export function dropFile(name: string): boolean {
  return globalRegistry.drop(name)
}

/**
 * Retrieve a registered file buffer (global registry)
 * @deprecated Use FileBufferRegistry instance methods for isolation
 * @param name - Virtual file path/name
 * @returns The buffer if found, undefined otherwise
 */
export function getFileBuffer(name: string): Uint8Array | undefined {
  return globalRegistry.get(name)
}

/**
 * Check if a virtual file exists (global registry)
 * @deprecated Use FileBufferRegistry instance methods for isolation
 * @param name - Virtual file path/name
 * @returns true if file is registered
 */
export function hasFile(name: string): boolean {
  return globalRegistry.has(name)
}

/**
 * List all registered virtual files (global registry)
 * @deprecated Use FileBufferRegistry instance methods for isolation
 * @returns Array of registered file names
 */
export function listFiles(): string[] {
  return globalRegistry.list()
}

/**
 * Get the size of a registered file (global registry)
 * @deprecated Use FileBufferRegistry instance methods for isolation
 * @param name - Virtual file path/name
 * @returns Size in bytes, or -1 if not found
 */
export function getFileSize(name: string): number {
  return globalRegistry.size(name)
}

/**
 * Clear all registered files and free memory (global registry)
 * @deprecated Use FileBufferRegistry instance methods for isolation
 */
export function clearAllFiles(): void {
  globalRegistry.clear()
}

/**
 * Get total memory used by all registered files (global registry)
 * @deprecated Use FileBufferRegistry instance methods for isolation
 * @returns Total bytes used
 */
export function getTotalMemoryUsage(): number {
  return globalRegistry.totalMemoryUsage()
}

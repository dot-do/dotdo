/**
 * Memory-only runtime for DuckDB in Workers environment
 *
 * This module provides a virtual file system backed by in-memory buffers,
 * since Cloudflare Workers don't have access to a real filesystem.
 */

/**
 * In-memory file buffer storage
 */
const fileBuffers = new Map<string, Uint8Array>()

/**
 * Register a buffer as a virtual file
 * @param name - Virtual file path/name
 * @param buffer - Data to store
 */
export function registerFileBuffer(name: string, buffer: ArrayBuffer | Uint8Array): void {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  fileBuffers.set(name, data)
}

/**
 * Remove a virtual file from the registry
 * @param name - Virtual file path/name to remove
 * @returns true if file was removed, false if it didn't exist
 */
export function dropFile(name: string): boolean {
  return fileBuffers.delete(name)
}

/**
 * Retrieve a registered file buffer
 * @param name - Virtual file path/name
 * @returns The buffer if found, undefined otherwise
 */
export function getFileBuffer(name: string): Uint8Array | undefined {
  return fileBuffers.get(name)
}

/**
 * Check if a virtual file exists
 * @param name - Virtual file path/name
 * @returns true if file is registered
 */
export function hasFile(name: string): boolean {
  return fileBuffers.has(name)
}

/**
 * List all registered virtual files
 * @returns Array of registered file names
 */
export function listFiles(): string[] {
  return Array.from(fileBuffers.keys())
}

/**
 * Get the size of a registered file
 * @param name - Virtual file path/name
 * @returns Size in bytes, or -1 if not found
 */
export function getFileSize(name: string): number {
  const buffer = fileBuffers.get(name)
  return buffer ? buffer.byteLength : -1
}

/**
 * Clear all registered files and free memory
 */
export function clearAllFiles(): void {
  fileBuffers.clear()
}

/**
 * Get total memory used by all registered files
 * @returns Total bytes used
 */
export function getTotalMemoryUsage(): number {
  let total = 0
  for (const buffer of fileBuffers.values()) {
    total += buffer.byteLength
  }
  return total
}

/**
 * Path utilities for CLI
 *
 * Re-exports core path utilities and adds CLI-specific helpers.
 */

// Re-export core path utilities
export { normalize, join, basename, dirname, isAbsolute } from '../../core/path'

/**
 * Normalize a path for CLI commands.
 * - Handles '.' as current directory (maps to '/')
 * - Collapses double slashes
 * - Removes trailing slashes (except for root)
 */
export function normalizeCLIPath(path: string): string {
  if (path === '.') return '/'

  // Replace double slashes with single
  let normalized = path.replace(/\/+/g, '/')

  // Remove trailing slash unless it's root
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

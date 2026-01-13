/**
 * Keyboard Shortcuts Configuration
 *
 * Centralized keyboard shortcut definitions for the app shell.
 * Used by useKeyboardShortcuts hook.
 *
 * ## Shortcuts
 * - Cmd/Ctrl+B: Toggle sidebar
 * - Cmd/Ctrl+K: Open search
 * - G then D: Go to Dashboard
 * - G then P: Go to Projects
 * - G then W: Go to Workflows
 * - G then S: Go to Settings
 */

// =============================================================================
// Types
// =============================================================================

export interface ShortcutConfig {
  /** Unique identifier for the shortcut */
  id: string
  /** Key to trigger (case-insensitive) */
  key: string
  /** Require Meta/Cmd key */
  meta?: boolean
  /** Require Ctrl key */
  ctrl?: boolean
  /** Require Alt/Option key */
  alt?: boolean
  /** Require Shift key */
  shift?: boolean
  /** Human-readable description */
  description: string
  /** Category for grouping in help dialog */
  category?: 'navigation' | 'actions' | 'general'
  /** Allow trigger when focused on input/textarea */
  allowInInput?: boolean
}

// =============================================================================
// App Shortcuts
// =============================================================================

export const appShortcuts: ShortcutConfig[] = [
  // General
  {
    id: 'toggle-sidebar',
    key: 'b',
    meta: true,
    description: 'Toggle sidebar',
    category: 'general',
  },
  {
    id: 'search',
    key: 'k',
    meta: true,
    description: 'Open search',
    category: 'general',
  },
  {
    id: 'close-dialog',
    key: 'Escape',
    description: 'Close dialog or menu',
    category: 'general',
    allowInInput: true,
  },
  {
    id: 'help',
    key: '?',
    shift: true,
    description: 'Show keyboard shortcuts',
    category: 'general',
  },

  // Navigation
  {
    id: 'go-dashboard',
    key: 'd',
    alt: true,
    description: 'Go to Dashboard',
    category: 'navigation',
  },
  {
    id: 'go-projects',
    key: 'p',
    alt: true,
    description: 'Go to Projects',
    category: 'navigation',
  },
  {
    id: 'go-workflows',
    key: 'w',
    alt: true,
    description: 'Go to Workflows',
    category: 'navigation',
  },
  {
    id: 'go-settings',
    key: 's',
    alt: true,
    description: 'Go to Settings',
    category: 'navigation',
  },

  // Actions
  {
    id: 'new-project',
    key: 'n',
    meta: true,
    description: 'Create new project',
    category: 'actions',
  },
  {
    id: 'refresh',
    key: 'r',
    meta: true,
    shift: true,
    description: 'Refresh current view',
    category: 'actions',
  },
]

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get shortcuts by category
 */
export function getShortcutsByCategory(category: ShortcutConfig['category']): ShortcutConfig[] {
  return appShortcuts.filter((s) => s.category === category)
}

/**
 * Find shortcut by ID
 */
export function getShortcutById(id: string): ShortcutConfig | undefined {
  return appShortcuts.find((s) => s.id === id)
}

/**
 * Format shortcut for display (e.g., "Cmd+K" or "Ctrl+K")
 */
export function formatShortcut(shortcut: ShortcutConfig): string {
  const parts: string[] = []

  // Determine if we're on Mac
  const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

  if (shortcut.meta) {
    parts.push(isMac ? 'Cmd' : 'Ctrl')
  }
  if (shortcut.ctrl) {
    parts.push('Ctrl')
  }
  if (shortcut.alt) {
    parts.push(isMac ? 'Option' : 'Alt')
  }
  if (shortcut.shift) {
    parts.push('Shift')
  }

  // Format the key
  let key = shortcut.key
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = key.toUpperCase()

  parts.push(key)

  return parts.join('+')
}

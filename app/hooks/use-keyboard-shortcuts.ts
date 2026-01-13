/**
 * useKeyboardShortcuts Hook
 *
 * Registers keyboard shortcuts with automatic cleanup.
 * Handles modifier keys (Meta, Ctrl, Alt, Shift) and prevents
 * triggering when user is typing in inputs.
 *
 * @example
 * ```tsx
 * import { useKeyboardShortcuts } from '~/hooks/use-keyboard-shortcuts'
 *
 * function App() {
 *   useKeyboardShortcuts([
 *     { key: 'k', meta: true, callback: () => openSearch() },
 *     { key: 'b', meta: true, callback: () => toggleSidebar() },
 *   ])
 *
 *   return <div>...</div>
 * }
 * ```
 */

import { useEffect, useCallback } from 'react'

export interface KeyboardShortcut {
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
  /** Callback to execute */
  callback: (e: KeyboardEvent) => void
  /** Allow trigger when focused on input/textarea (default: false) */
  allowInInput?: boolean
  /** Prevent default browser behavior (default: true) */
  preventDefault?: boolean
}

/**
 * Check if the event target is an input element
 */
function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false

  const tagName = target.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true
  }

  // Check for contenteditable
  if (target.getAttribute('contenteditable') === 'true') {
    return true
  }

  return false
}

/**
 * Check if a shortcut matches the keyboard event
 */
function matchesShortcut(shortcut: KeyboardShortcut, event: KeyboardEvent): boolean {
  // Check key (case-insensitive)
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
    return false
  }

  // Check modifiers
  if (shortcut.meta && !event.metaKey) return false
  if (shortcut.ctrl && !event.ctrlKey) return false
  if (shortcut.alt && !event.altKey) return false
  if (shortcut.shift && !event.shiftKey) return false

  // Check for no extra modifiers (unless specified)
  if (!shortcut.meta && event.metaKey) return false
  if (!shortcut.ctrl && event.ctrlKey) return false
  if (!shortcut.alt && event.altKey) return false
  if (!shortcut.shift && event.shiftKey) return false

  return true
}

/**
 * Hook that registers keyboard shortcuts
 *
 * @param shortcuts - Array of shortcut configurations
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Find matching shortcut
      for (const shortcut of shortcuts) {
        if (!matchesShortcut(shortcut, event)) {
          continue
        }

        // Check if we should ignore input elements
        if (!shortcut.allowInInput && isInputElement(event.target)) {
          continue
        }

        // Prevent default if configured (default: true)
        if (shortcut.preventDefault !== false) {
          event.preventDefault()
          event.stopPropagation()
        }

        // Execute callback
        shortcut.callback(event)
        return
      }
    },
    [shortcuts]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}

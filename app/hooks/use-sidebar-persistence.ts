/**
 * useSidebarPersistence Hook
 *
 * Manages sidebar open/collapsed state with localStorage persistence.
 * Provides a consistent sidebar experience across page navigations and sessions.
 *
 * @example
 * ```tsx
 * import { useSidebarPersistence } from '~/hooks/use-sidebar-persistence'
 *
 * function AppShell() {
 *   const { isOpen, setIsOpen, isCollapsed, setIsCollapsed } = useSidebarPersistence()
 *
 *   return (
 *     <Sidebar open={isOpen} collapsed={isCollapsed}>
 *       ...
 *     </Sidebar>
 *   )
 * }
 * ```
 */

import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'app-sidebar-state'

export interface SidebarState {
  isOpen: boolean
  isCollapsed: boolean
}

export interface SidebarPersistenceOptions {
  /** Default open state if no persisted value exists */
  defaultOpen?: boolean
  /** Default collapsed state if no persisted value exists */
  defaultCollapsed?: boolean
}

export interface SidebarPersistenceReturn {
  isOpen: boolean
  setIsOpen: (value: boolean) => void
  isCollapsed: boolean
  setIsCollapsed: (value: boolean) => void
  toggle: () => void
  toggleCollapsed: () => void
}

/**
 * Hook for managing sidebar state with localStorage persistence
 */
export function useSidebarPersistence(
  options: SidebarPersistenceOptions = {}
): SidebarPersistenceReturn {
  const { defaultOpen = true, defaultCollapsed = false } = options

  // Initialize state from localStorage or defaults
  const [state, setState] = useState<SidebarState>(() => {
    // Only access localStorage on client
    if (typeof window === 'undefined') {
      return { isOpen: defaultOpen, isCollapsed: defaultCollapsed }
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<SidebarState>
        return {
          isOpen: parsed.isOpen ?? defaultOpen,
          isCollapsed: parsed.isCollapsed ?? defaultCollapsed,
        }
      }
    } catch {
      // Ignore parse errors
    }

    return { isOpen: defaultOpen, isCollapsed: defaultCollapsed }
  })

  // Persist state to localStorage when it changes
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Ignore storage errors (e.g., quota exceeded)
    }
  }, [state])

  // Hydrate from localStorage on mount (for SSR)
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<SidebarState>
        setState({
          isOpen: parsed.isOpen ?? defaultOpen,
          isCollapsed: parsed.isCollapsed ?? defaultCollapsed,
        })
      }
    } catch {
      // Ignore parse errors
    }
  }, [defaultOpen, defaultCollapsed])

  const setIsOpen = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, isOpen: value }))
  }, [])

  const setIsCollapsed = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, isCollapsed: value }))
  }, [])

  const toggle = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: !prev.isOpen }))
  }, [])

  const toggleCollapsed = useCallback(() => {
    setState((prev) => ({ ...prev, isCollapsed: !prev.isCollapsed }))
  }, [])

  return {
    isOpen: state.isOpen,
    setIsOpen,
    isCollapsed: state.isCollapsed,
    setIsCollapsed,
    toggle,
    toggleCollapsed,
  }
}

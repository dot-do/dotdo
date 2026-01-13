/**
 * App Shell Optimization Tests (TDD)
 *
 * Tests for app shell polish and optimization including:
 * - Navigation configuration extraction
 * - Route prefetching
 * - Sidebar state optimization
 * - Mobile drawer polish
 * - Keyboard shortcuts
 *
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// =============================================================================
// Navigation Configuration Tests
// =============================================================================

describe('Navigation Configuration', () => {
  describe('navConfig module', () => {
    it('exports navItems array', async () => {
      const { navItems } = await import('~/config/nav')
      expect(Array.isArray(navItems)).toBe(true)
      expect(navItems.length).toBeGreaterThan(0)
    })

    it('each nav item has required properties', async () => {
      const { navItems } = await import('~/config/nav')
      navItems.forEach((item: { title?: string; url?: string; icon?: unknown; testId?: string }) => {
        expect(item).toHaveProperty('title')
        expect(item).toHaveProperty('url')
        expect(item).toHaveProperty('icon')
        expect(item).toHaveProperty('testId')
        expect(typeof item.title).toBe('string')
        expect(typeof item.url).toBe('string')
        expect(typeof item.testId).toBe('string')
      })
    })

    it('exports pageMetadata object', async () => {
      const { pageMetadata } = await import('~/config/nav')
      expect(typeof pageMetadata).toBe('object')
      expect(pageMetadata).not.toBeNull()
    })

    it('pageMetadata has entries for main routes', async () => {
      const { pageMetadata } = await import('~/config/nav')
      expect(pageMetadata).toHaveProperty('/app')
      expect(pageMetadata).toHaveProperty('/app/projects')
      expect(pageMetadata).toHaveProperty('/app/workflows')
      expect(pageMetadata).toHaveProperty('/app/settings')
    })

    it('pageMetadata entries have title and description', async () => {
      const { pageMetadata } = await import('~/config/nav')
      Object.values(pageMetadata).forEach((meta: { title?: string; description?: string }) => {
        expect(meta).toHaveProperty('title')
        expect(meta).toHaveProperty('description')
        expect(typeof meta.title).toBe('string')
        expect(typeof meta.description).toBe('string')
      })
    })

    it('exports labelMap for breadcrumb generation', async () => {
      const { labelMap } = await import('~/config/nav')
      expect(typeof labelMap).toBe('object')
      expect(labelMap).toHaveProperty('app')
      expect(labelMap).toHaveProperty('projects')
      expect(labelMap).toHaveProperty('workflows')
      expect(labelMap).toHaveProperty('settings')
    })

    it('exports generateBreadcrumbs function', async () => {
      const { generateBreadcrumbs } = await import('~/config/nav')
      expect(typeof generateBreadcrumbs).toBe('function')
    })

    it('generateBreadcrumbs produces correct output for /app', async () => {
      const { generateBreadcrumbs } = await import('~/config/nav')
      const breadcrumbs = generateBreadcrumbs('/app')
      expect(breadcrumbs).toHaveLength(1)
      expect(breadcrumbs[0]).toHaveProperty('label', 'Dashboard')
    })

    it('generateBreadcrumbs produces correct output for nested routes', async () => {
      const { generateBreadcrumbs } = await import('~/config/nav')
      const breadcrumbs = generateBreadcrumbs('/app/projects/123')
      expect(breadcrumbs.length).toBeGreaterThanOrEqual(2)
      expect(breadcrumbs[0]).toHaveProperty('label', 'Dashboard')
      expect(breadcrumbs[1]).toHaveProperty('label', 'Projects')
    })
  })
})

// =============================================================================
// Route Prefetching Tests
// =============================================================================

describe('Route Prefetching', () => {
  describe('prefetch configuration', () => {
    it('exports prefetchConfig object', async () => {
      const { prefetchConfig } = await import('~/config/nav')
      expect(typeof prefetchConfig).toBe('object')
    })

    it('prefetchConfig has intent property', async () => {
      const { prefetchConfig } = await import('~/config/nav')
      expect(prefetchConfig).toHaveProperty('intent')
      expect(typeof prefetchConfig.intent).toBe('boolean')
    })

    it('prefetchConfig intent defaults to true', async () => {
      const { prefetchConfig } = await import('~/config/nav')
      expect(prefetchConfig.intent).toBe(true)
    })

    it('prefetchConfig has hover delay property', async () => {
      const { prefetchConfig } = await import('~/config/nav')
      expect(prefetchConfig).toHaveProperty('hoverDelay')
      expect(typeof prefetchConfig.hoverDelay).toBe('number')
    })

    it('prefetchConfig hover delay is reasonable (50-200ms)', async () => {
      const { prefetchConfig } = await import('~/config/nav')
      expect(prefetchConfig.hoverDelay).toBeGreaterThanOrEqual(50)
      expect(prefetchConfig.hoverDelay).toBeLessThanOrEqual(200)
    })
  })

  describe('usePrefetch hook', () => {
    it('exports usePrefetch hook', async () => {
      const { usePrefetch } = await import('~/hooks/use-prefetch')
      expect(typeof usePrefetch).toBe('function')
    })

    it('returns prefetch handlers', async () => {
      const { usePrefetch } = await import('~/hooks/use-prefetch')

      // Simple test component to verify hook output
      function TestComponent() {
        const handlers = usePrefetch('/app/projects')
        return (
          <div>
            <span data-testid="has-onMouseEnter">{String(typeof handlers.onMouseEnter === 'function')}</span>
            <span data-testid="has-onFocus">{String(typeof handlers.onFocus === 'function')}</span>
          </div>
        )
      }

      render(<TestComponent />)
      expect(screen.getByTestId('has-onMouseEnter')).toHaveTextContent('true')
      expect(screen.getByTestId('has-onFocus')).toHaveTextContent('true')
    })
  })
})

// =============================================================================
// Sidebar State Optimization Tests
// =============================================================================

describe('Sidebar State Optimization', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
  })

  describe('sidebar persistence', () => {
    it('exports useSidebarPersistence hook', async () => {
      const { useSidebarPersistence } = await import('~/hooks/use-sidebar-persistence')
      expect(typeof useSidebarPersistence).toBe('function')
    })

    it('persists sidebar state to localStorage', async () => {
      const { useSidebarPersistence } = await import('~/hooks/use-sidebar-persistence')

      function TestComponent() {
        const { isOpen, setIsOpen } = useSidebarPersistence()
        return (
          <div>
            <span data-testid="isOpen">{String(isOpen)}</span>
            <button data-testid="toggle" onClick={() => setIsOpen(!isOpen)}>Toggle</button>
          </div>
        )
      }

      render(<TestComponent />)

      // Click toggle to close
      fireEvent.click(screen.getByTestId('toggle'))

      await waitFor(() => {
        const stored = localStorage.getItem('app-sidebar-state')
        expect(stored).not.toBeNull()
      })
    })

    it('restores sidebar state from localStorage', async () => {
      // Pre-set localStorage
      localStorage.setItem('app-sidebar-state', JSON.stringify({ isOpen: false }))

      const { useSidebarPersistence } = await import('~/hooks/use-sidebar-persistence')

      function TestComponent() {
        const { isOpen } = useSidebarPersistence()
        return <span data-testid="isOpen">{String(isOpen)}</span>
      }

      render(<TestComponent />)

      await waitFor(() => {
        expect(screen.getByTestId('isOpen')).toHaveTextContent('false')
      })
    })

    it('respects defaultOpen prop', async () => {
      const { useSidebarPersistence } = await import('~/hooks/use-sidebar-persistence')

      function TestComponent() {
        const { isOpen } = useSidebarPersistence({ defaultOpen: false })
        return <span data-testid="isOpen">{String(isOpen)}</span>
      }

      render(<TestComponent />)

      expect(screen.getByTestId('isOpen')).toHaveTextContent('false')
    })

    it('localStorage takes precedence over defaultOpen', async () => {
      localStorage.setItem('app-sidebar-state', JSON.stringify({ isOpen: true }))

      const { useSidebarPersistence } = await import('~/hooks/use-sidebar-persistence')

      function TestComponent() {
        const { isOpen } = useSidebarPersistence({ defaultOpen: false })
        return <span data-testid="isOpen">{String(isOpen)}</span>
      }

      render(<TestComponent />)

      await waitFor(() => {
        expect(screen.getByTestId('isOpen')).toHaveTextContent('true')
      })
    })
  })

  describe('collapsed state', () => {
    it('tracks collapsed state separately from open state', async () => {
      const { useSidebarPersistence } = await import('~/hooks/use-sidebar-persistence')

      function TestComponent() {
        const { isCollapsed, setIsCollapsed } = useSidebarPersistence()
        return (
          <div>
            <span data-testid="isCollapsed">{String(isCollapsed)}</span>
            <button data-testid="collapse" onClick={() => setIsCollapsed(true)}>Collapse</button>
          </div>
        )
      }

      render(<TestComponent />)

      expect(screen.getByTestId('isCollapsed')).toHaveTextContent('false')

      fireEvent.click(screen.getByTestId('collapse'))

      await waitFor(() => {
        expect(screen.getByTestId('isCollapsed')).toHaveTextContent('true')
      })
    })

    it('persists collapsed state', async () => {
      const { useSidebarPersistence } = await import('~/hooks/use-sidebar-persistence')

      function TestComponent() {
        const { setIsCollapsed } = useSidebarPersistence()
        return <button data-testid="collapse" onClick={() => setIsCollapsed(true)}>Collapse</button>
      }

      render(<TestComponent />)
      fireEvent.click(screen.getByTestId('collapse'))

      await waitFor(() => {
        const stored = localStorage.getItem('app-sidebar-state')
        expect(stored).not.toBeNull()
        const parsed = JSON.parse(stored!)
        expect(parsed.isCollapsed).toBe(true)
      })
    })
  })
})

// =============================================================================
// Mobile Drawer Tests
// =============================================================================

describe('Mobile Drawer Polish', () => {
  beforeEach(() => {
    // Mock mobile viewport
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 375 })
    Object.defineProperty(window, 'innerHeight', { writable: true, value: 667 })
    window.dispatchEvent(new Event('resize'))
  })

  afterEach(() => {
    // Reset to desktop
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { writable: true, value: 768 })
    window.dispatchEvent(new Event('resize'))
  })

  describe('useIsMobile hook', () => {
    it('exports useIsMobile hook', async () => {
      const { useIsMobile } = await import('~/hooks/use-is-mobile')
      expect(typeof useIsMobile).toBe('function')
    })

    it('returns true for mobile viewport', async () => {
      const { useIsMobile } = await import('~/hooks/use-is-mobile')

      function TestComponent() {
        const isMobile = useIsMobile()
        return <span data-testid="isMobile">{String(isMobile)}</span>
      }

      render(<TestComponent />)

      expect(screen.getByTestId('isMobile')).toHaveTextContent('true')
    })

    it('returns false for desktop viewport', async () => {
      // Reset to desktop before this test
      Object.defineProperty(window, 'innerWidth', { writable: true, value: 1024 })
      window.dispatchEvent(new Event('resize'))

      const { useIsMobile } = await import('~/hooks/use-is-mobile')

      function TestComponent() {
        const isMobile = useIsMobile()
        return <span data-testid="isMobile">{String(isMobile)}</span>
      }

      render(<TestComponent />)

      expect(screen.getByTestId('isMobile')).toHaveTextContent('false')
    })

    it('accepts custom breakpoint', async () => {
      Object.defineProperty(window, 'innerWidth', { writable: true, value: 500 })
      window.dispatchEvent(new Event('resize'))

      const { useIsMobile } = await import('~/hooks/use-is-mobile')

      function TestComponent() {
        const isMobile = useIsMobile(400) // Custom breakpoint
        return <span data-testid="isMobile">{String(isMobile)}</span>
      }

      render(<TestComponent />)

      // 500 > 400, so should be false (not mobile)
      expect(screen.getByTestId('isMobile')).toHaveTextContent('false')
    })
  })

  describe('drawer animations', () => {
    it('exports DRAWER_ANIMATION_DURATION constant', async () => {
      const { DRAWER_ANIMATION_DURATION } = await import('~/config/nav')
      expect(typeof DRAWER_ANIMATION_DURATION).toBe('number')
      expect(DRAWER_ANIMATION_DURATION).toBeGreaterThanOrEqual(150)
      expect(DRAWER_ANIMATION_DURATION).toBeLessThanOrEqual(400)
    })

    it('exports drawerVariants for framer-motion', async () => {
      const { drawerVariants } = await import('~/config/nav')
      expect(typeof drawerVariants).toBe('object')
      expect(drawerVariants).toHaveProperty('open')
      expect(drawerVariants).toHaveProperty('closed')
    })
  })

  describe('swipe gestures', () => {
    it('exports useSwipeGesture hook', async () => {
      const { useSwipeGesture } = await import('~/hooks/use-swipe-gesture')
      expect(typeof useSwipeGesture).toBe('function')
    })

    it('useSwipeGesture returns gesture handlers', async () => {
      const { useSwipeGesture } = await import('~/hooks/use-swipe-gesture')

      function TestComponent() {
        const handlers = useSwipeGesture({
          onSwipeLeft: () => {},
          onSwipeRight: () => {},
        })
        return (
          <div>
            <span data-testid="has-onTouchStart">{String(typeof handlers.onTouchStart === 'function')}</span>
            <span data-testid="has-onTouchMove">{String(typeof handlers.onTouchMove === 'function')}</span>
            <span data-testid="has-onTouchEnd">{String(typeof handlers.onTouchEnd === 'function')}</span>
          </div>
        )
      }

      render(<TestComponent />)
      expect(screen.getByTestId('has-onTouchStart')).toHaveTextContent('true')
      expect(screen.getByTestId('has-onTouchMove')).toHaveTextContent('true')
      expect(screen.getByTestId('has-onTouchEnd')).toHaveTextContent('true')
    })

    it('triggers onSwipeLeft callback', async () => {
      const { useSwipeGesture } = await import('~/hooks/use-swipe-gesture')
      const onSwipeLeft = vi.fn()

      function TestComponent() {
        const handlers = useSwipeGesture({
          onSwipeLeft,
          onSwipeRight: () => {},
          threshold: 50,
        })
        return <div data-testid="swipe-area" {...handlers} style={{ width: 200, height: 200 }} />
      }

      render(<TestComponent />)
      const area = screen.getByTestId('swipe-area')

      // Simulate swipe left
      fireEvent.touchStart(area, { touches: [{ clientX: 150, clientY: 100 }] })
      fireEvent.touchMove(area, { touches: [{ clientX: 50, clientY: 100 }] })
      fireEvent.touchEnd(area)

      expect(onSwipeLeft).toHaveBeenCalled()
    })

    it('triggers onSwipeRight callback', async () => {
      const { useSwipeGesture } = await import('~/hooks/use-swipe-gesture')
      const onSwipeRight = vi.fn()

      function TestComponent() {
        const handlers = useSwipeGesture({
          onSwipeLeft: () => {},
          onSwipeRight,
          threshold: 50,
        })
        return <div data-testid="swipe-area" {...handlers} style={{ width: 200, height: 200 }} />
      }

      render(<TestComponent />)
      const area = screen.getByTestId('swipe-area')

      // Simulate swipe right
      fireEvent.touchStart(area, { touches: [{ clientX: 50, clientY: 100 }] })
      fireEvent.touchMove(area, { touches: [{ clientX: 150, clientY: 100 }] })
      fireEvent.touchEnd(area)

      expect(onSwipeRight).toHaveBeenCalled()
    })
  })
})

// =============================================================================
// Keyboard Shortcuts Tests
// =============================================================================

describe('Keyboard Shortcuts', () => {
  describe('useKeyboardShortcuts hook', () => {
    it('exports useKeyboardShortcuts hook', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      expect(typeof useKeyboardShortcuts).toBe('function')
    })

    it('registers shortcuts on mount', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      const callback = vi.fn()

      function TestComponent() {
        useKeyboardShortcuts([
          { key: 'k', meta: true, callback },
        ])
        return <div>Test</div>
      }

      render(<TestComponent />)

      // Simulate Cmd+K
      fireEvent.keyDown(document, { key: 'k', metaKey: true })

      expect(callback).toHaveBeenCalled()
    })

    it('unregisters shortcuts on unmount', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      const callback = vi.fn()

      function TestComponent() {
        useKeyboardShortcuts([
          { key: 'k', meta: true, callback },
        ])
        return <div>Test</div>
      }

      const { unmount } = render(<TestComponent />)
      unmount()

      // Simulate Cmd+K after unmount
      fireEvent.keyDown(document, { key: 'k', metaKey: true })

      expect(callback).not.toHaveBeenCalled()
    })

    it('supports Ctrl modifier', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      const callback = vi.fn()

      function TestComponent() {
        useKeyboardShortcuts([
          { key: 'k', ctrl: true, callback },
        ])
        return <div>Test</div>
      }

      render(<TestComponent />)

      // Simulate Ctrl+K
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

      expect(callback).toHaveBeenCalled()
    })

    it('supports Alt modifier', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      const callback = vi.fn()

      function TestComponent() {
        useKeyboardShortcuts([
          { key: 'k', alt: true, callback },
        ])
        return <div>Test</div>
      }

      render(<TestComponent />)

      // Simulate Alt+K
      fireEvent.keyDown(document, { key: 'k', altKey: true })

      expect(callback).toHaveBeenCalled()
    })

    it('supports Shift modifier', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      const callback = vi.fn()

      function TestComponent() {
        useKeyboardShortcuts([
          { key: 'k', shift: true, callback },
        ])
        return <div>Test</div>
      }

      render(<TestComponent />)

      // Simulate Shift+K
      fireEvent.keyDown(document, { key: 'k', shiftKey: true })

      expect(callback).toHaveBeenCalled()
    })

    it('supports multiple shortcuts', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      function TestComponent() {
        useKeyboardShortcuts([
          { key: 'k', meta: true, callback: callback1 },
          { key: 'p', meta: true, callback: callback2 },
        ])
        return <div>Test</div>
      }

      render(<TestComponent />)

      fireEvent.keyDown(document, { key: 'k', metaKey: true })
      fireEvent.keyDown(document, { key: 'p', metaKey: true })

      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()
    })

    it('does not trigger when typing in input', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      const callback = vi.fn()

      function TestComponent() {
        useKeyboardShortcuts([
          { key: 'k', meta: true, callback },
        ])
        return <input data-testid="input" type="text" />
      }

      render(<TestComponent />)
      const input = screen.getByTestId('input')
      input.focus()

      // Simulate Cmd+K while focused on input
      fireEvent.keyDown(input, { key: 'k', metaKey: true })

      expect(callback).not.toHaveBeenCalled()
    })

    it('triggers when allowInInput is true', async () => {
      const { useKeyboardShortcuts } = await import('~/hooks/use-keyboard-shortcuts')
      const callback = vi.fn()

      function TestComponent() {
        useKeyboardShortcuts([
          { key: 'Escape', callback, allowInInput: true },
        ])
        return <input data-testid="input" type="text" />
      }

      render(<TestComponent />)
      const input = screen.getByTestId('input')
      input.focus()

      // Simulate Escape while focused on input
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(callback).toHaveBeenCalled()
    })
  })

  describe('keyboard shortcuts config', () => {
    it('exports appShortcuts configuration', async () => {
      const { appShortcuts } = await import('~/config/shortcuts')
      expect(Array.isArray(appShortcuts)).toBe(true)
    })

    it('includes toggle sidebar shortcut', async () => {
      const { appShortcuts } = await import('~/config/shortcuts')
      const toggleSidebar = appShortcuts.find((s: { id?: string }) => s.id === 'toggle-sidebar')
      expect(toggleSidebar).toBeDefined()
      expect(toggleSidebar.key).toBe('b')
      expect(toggleSidebar.meta).toBe(true)
    })

    it('includes search shortcut', async () => {
      const { appShortcuts } = await import('~/config/shortcuts')
      const search = appShortcuts.find((s: { id?: string }) => s.id === 'search')
      expect(search).toBeDefined()
      expect(search.key).toBe('k')
      expect(search.meta).toBe(true)
    })

    it('includes navigation shortcuts', async () => {
      const { appShortcuts } = await import('~/config/shortcuts')
      const goDashboard = appShortcuts.find((s: { id?: string }) => s.id === 'go-dashboard')
      const goProjects = appShortcuts.find((s: { id?: string }) => s.id === 'go-projects')
      const goWorkflows = appShortcuts.find((s: { id?: string }) => s.id === 'go-workflows')
      const goSettings = appShortcuts.find((s: { id?: string }) => s.id === 'go-settings')

      expect(goDashboard).toBeDefined()
      expect(goProjects).toBeDefined()
      expect(goWorkflows).toBeDefined()
      expect(goSettings).toBeDefined()
    })

    it('shortcut descriptions are human-readable', async () => {
      const { appShortcuts } = await import('~/config/shortcuts')
      appShortcuts.forEach((shortcut: { description?: string }) => {
        expect(shortcut).toHaveProperty('description')
        expect(typeof shortcut.description).toBe('string')
        expect(shortcut.description.length).toBeGreaterThan(0)
      })
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('App Shell Integration', () => {
  describe('hook exports', () => {
    it('hooks/index exports all shell hooks', async () => {
      const hooks = await import('~/hooks')

      expect(hooks).toHaveProperty('usePrefetch')
      expect(hooks).toHaveProperty('useSidebarPersistence')
      expect(hooks).toHaveProperty('useIsMobile')
      expect(hooks).toHaveProperty('useSwipeGesture')
      expect(hooks).toHaveProperty('useKeyboardShortcuts')
    })
  })

  describe('nav config exports', () => {
    it('config/nav exports all required items', async () => {
      const nav = await import('~/config/nav')

      expect(nav).toHaveProperty('navItems')
      expect(nav).toHaveProperty('pageMetadata')
      expect(nav).toHaveProperty('labelMap')
      expect(nav).toHaveProperty('generateBreadcrumbs')
      expect(nav).toHaveProperty('prefetchConfig')
      expect(nav).toHaveProperty('drawerVariants')
      expect(nav).toHaveProperty('DRAWER_ANIMATION_DURATION')
      expect(nav).toHaveProperty('isNavItemActive')
      expect(nav).toHaveProperty('getPageMeta')
    })
  })

  describe('shortcuts config exports', () => {
    it('config/shortcuts exports all required items', async () => {
      const shortcuts = await import('~/config/shortcuts')

      expect(shortcuts).toHaveProperty('appShortcuts')
      expect(shortcuts).toHaveProperty('getShortcutsByCategory')
      expect(shortcuts).toHaveProperty('getShortcutById')
      expect(shortcuts).toHaveProperty('formatShortcut')
    })
  })
})

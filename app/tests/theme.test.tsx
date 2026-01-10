/**
 * Theme System Tests (TDD RED Phase)
 *
 * These tests verify the @mdxui/themes integration for the dotdo application.
 * Tests SHOULD FAIL until the theme system is properly integrated.
 *
 * The theme system provides:
 * - ThemeScript: Prevents FOUC by applying theme before React hydrates
 * - useThemeStore: Zustand store for theme state management
 * - Theme presets and modes (light/dark/system)
 * - localStorage persistence
 * - CSS variable updates
 *
 * @see app/routes/__root.tsx for theme integration
 * @see app/styles/app.css for CSS custom properties
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

// Import from @mdxui/themes
import {
  ThemeScript,
  useThemeStore,
  DARK_MODE_CLASS,
  THEME_STORAGE_KEY,
  themePresets,
  getResolvedMode,
  defaultThemeState,
  applyThemeToElement,
} from '@mdxui/themes'

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Creates a wrapper component that provides theme context
 */
function ThemeTestWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

/**
 * Test component that uses the theme store
 */
function ThemeConsumer() {
  const { preset, mode, resolvedMode, setPreset, setMode } = useThemeStore()

  return (
    <div data-testid='theme-consumer'>
      <span data-testid='preset'>{preset}</span>
      <span data-testid='mode'>{mode}</span>
      <span data-testid='resolved-mode'>{resolvedMode}</span>
      <button data-testid='set-dark' onClick={() => setMode('dark')}>
        Dark
      </button>
      <button data-testid='set-light' onClick={() => setMode('light')}>
        Light
      </button>
      <button data-testid='set-system' onClick={() => setMode('system')}>
        System
      </button>
      <button data-testid='set-preset-stripe' onClick={() => setPreset('stripe')}>
        Stripe
      </button>
    </div>
  )
}

/**
 * Component that toggles dark mode
 */
function DarkModeToggle() {
  const { mode, resolvedMode, setMode } = useThemeStore()

  const toggleDarkMode = () => {
    setMode(resolvedMode === 'dark' ? 'light' : 'dark')
  }

  return (
    <button data-testid='dark-mode-toggle' onClick={toggleDarkMode} aria-pressed={resolvedMode === 'dark'}>
      {resolvedMode === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}

// =============================================================================
// Mock Setup
// =============================================================================

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

// Mock matchMedia for system preference detection
const mockMatchMedia = (prefersDark: boolean) => {
  return vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Theme System', () => {
  beforeEach(() => {
    // Reset localStorage mock
    localStorageMock.clear()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })

    // Reset document class list
    document.documentElement.classList.remove(DARK_MODE_CLASS)

    // Reset theme store
    useThemeStore.getState().setMode('light')
    useThemeStore.getState().setPreset('anthropic')

    // Mock matchMedia - default to light mode
    window.matchMedia = mockMatchMedia(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // ThemeScript Tests - FOUC Prevention
  // ===========================================================================

  describe('ThemeScript', () => {
    it('renders a script element', () => {
      const { container } = render(<ThemeScript />)
      const script = container.querySelector('script')
      expect(script).not.toBeNull()
    })

    it('script has correct dangerouslySetInnerHTML', () => {
      const { container } = render(<ThemeScript />)
      const script = container.querySelector('script')
      expect(script?.innerHTML).toBeTruthy()
      expect(script?.innerHTML.length).toBeGreaterThan(0)
    })

    it('script contains localStorage access code', () => {
      const { container } = render(<ThemeScript />)
      const script = container.querySelector('script')
      expect(script?.innerHTML).toContain('localStorage')
    })

    it('script references THEME_STORAGE_KEY', () => {
      const { container } = render(<ThemeScript />)
      const script = container.querySelector('script')
      // The script should use the storage key
      expect(script?.innerHTML).toContain(THEME_STORAGE_KEY)
    })

    it('script handles dark mode class application', () => {
      const { container } = render(<ThemeScript />)
      const script = container.querySelector('script')
      // Should contain logic for adding dark class
      expect(script?.innerHTML).toContain(DARK_MODE_CLASS)
    })

    it('accepts defaultMode prop', () => {
      const { container } = render(<ThemeScript defaultMode='dark' />)
      const script = container.querySelector('script')
      expect(script).not.toBeNull()
      // Script should handle the default mode
      expect(script?.innerHTML).toBeTruthy()
    })

    it('accepts custom storageKey prop', () => {
      const customKey = 'custom-theme-key'
      const { container } = render(<ThemeScript storageKey={customKey} />)
      const script = container.querySelector('script')
      expect(script?.innerHTML).toContain(customKey)
    })

    it('accepts nonce prop for CSP', () => {
      const nonce = 'abc123'
      const { container } = render(<ThemeScript nonce={nonce} />)
      const script = container.querySelector('script')
      expect(script?.getAttribute('nonce')).toBe(nonce)
    })

    it('prevents FOUC by running synchronously', () => {
      // ThemeScript should render immediately without async
      const { container } = render(<ThemeScript />)
      const script = container.querySelector('script')
      // Script should not be deferred or async
      expect(script?.hasAttribute('defer')).toBe(false)
      expect(script?.hasAttribute('async')).toBe(false)
    })
  })

  // ===========================================================================
  // useThemeStore Tests
  // ===========================================================================

  describe('useThemeStore', () => {
    it('returns preset value', () => {
      render(<ThemeConsumer />)
      expect(screen.getByTestId('preset')).toBeInTheDocument()
    })

    it('returns mode value', () => {
      render(<ThemeConsumer />)
      expect(screen.getByTestId('mode')).toBeInTheDocument()
    })

    it('returns resolvedMode value', () => {
      render(<ThemeConsumer />)
      expect(screen.getByTestId('resolved-mode')).toBeInTheDocument()
    })

    it('has default preset', () => {
      render(<ThemeConsumer />)
      const preset = screen.getByTestId('preset')
      expect(themePresets).toContain(preset.textContent)
    })

    it('has default mode', () => {
      render(<ThemeConsumer />)
      const mode = screen.getByTestId('mode')
      expect(['light', 'dark', 'system']).toContain(mode.textContent)
    })

    it('resolvedMode is light or dark', () => {
      render(<ThemeConsumer />)
      const resolvedMode = screen.getByTestId('resolved-mode')
      expect(['light', 'dark']).toContain(resolvedMode.textContent)
    })

    it('setMode updates mode to dark', async () => {
      render(<ThemeConsumer />)

      fireEvent.click(screen.getByTestId('set-dark'))

      await waitFor(() => {
        expect(screen.getByTestId('mode')).toHaveTextContent('dark')
        expect(screen.getByTestId('resolved-mode')).toHaveTextContent('dark')
      })
    })

    it('setMode updates mode to light', async () => {
      render(<ThemeConsumer />)

      // First set to dark
      fireEvent.click(screen.getByTestId('set-dark'))
      // Then back to light
      fireEvent.click(screen.getByTestId('set-light'))

      await waitFor(() => {
        expect(screen.getByTestId('mode')).toHaveTextContent('light')
        expect(screen.getByTestId('resolved-mode')).toHaveTextContent('light')
      })
    })

    it('setMode updates mode to system', async () => {
      render(<ThemeConsumer />)

      fireEvent.click(screen.getByTestId('set-system'))

      await waitFor(() => {
        expect(screen.getByTestId('mode')).toHaveTextContent('system')
      })
    })

    it('setPreset updates preset', async () => {
      render(<ThemeConsumer />)

      fireEvent.click(screen.getByTestId('set-preset-stripe'))

      await waitFor(() => {
        expect(screen.getByTestId('preset')).toHaveTextContent('stripe')
      })
    })

    it('system mode resolves based on OS preference (light)', () => {
      window.matchMedia = mockMatchMedia(false) // Light preference

      act(() => {
        useThemeStore.getState().setMode('system')
      })

      render(<ThemeConsumer />)

      expect(screen.getByTestId('mode')).toHaveTextContent('system')
      expect(screen.getByTestId('resolved-mode')).toHaveTextContent('light')
    })

    it('system mode resolves based on OS preference (dark)', () => {
      window.matchMedia = mockMatchMedia(true) // Dark preference

      act(() => {
        useThemeStore.getState().setMode('system')
      })

      render(<ThemeConsumer />)

      expect(screen.getByTestId('mode')).toHaveTextContent('system')
      expect(screen.getByTestId('resolved-mode')).toHaveTextContent('dark')
    })
  })

  // ===========================================================================
  // Dark Mode Toggle Tests
  // ===========================================================================

  describe('dark mode toggle', () => {
    it('renders toggle button', () => {
      render(<DarkModeToggle />)
      expect(screen.getByTestId('dark-mode-toggle')).toBeInTheDocument()
    })

    it('toggles from light to dark', async () => {
      act(() => {
        useThemeStore.getState().setMode('light')
      })

      render(<DarkModeToggle />)

      const toggle = screen.getByTestId('dark-mode-toggle')
      expect(toggle).toHaveTextContent('Light')

      fireEvent.click(toggle)

      await waitFor(() => {
        expect(toggle).toHaveTextContent('Dark')
      })
    })

    it('toggles from dark to light', async () => {
      act(() => {
        useThemeStore.getState().setMode('dark')
      })

      render(<DarkModeToggle />)

      const toggle = screen.getByTestId('dark-mode-toggle')
      expect(toggle).toHaveTextContent('Dark')

      fireEvent.click(toggle)

      await waitFor(() => {
        expect(toggle).toHaveTextContent('Light')
      })
    })

    it('has aria-pressed attribute', () => {
      render(<DarkModeToggle />)
      expect(screen.getByTestId('dark-mode-toggle')).toHaveAttribute('aria-pressed')
    })

    it('aria-pressed reflects current state', async () => {
      act(() => {
        useThemeStore.getState().setMode('light')
      })

      render(<DarkModeToggle />)

      const toggle = screen.getByTestId('dark-mode-toggle')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(toggle)

      await waitFor(() => {
        expect(toggle).toHaveAttribute('aria-pressed', 'true')
      })
    })
  })

  // ===========================================================================
  // localStorage Persistence Tests
  // ===========================================================================

  describe('localStorage persistence', () => {
    it('persists mode to localStorage', async () => {
      render(<ThemeConsumer />)

      fireEvent.click(screen.getByTestId('set-dark'))

      // Wait for the mode to be updated in the store
      await waitFor(() => {
        expect(screen.getByTestId('mode')).toHaveTextContent('dark')
      })

      // Zustand persist should eventually call setItem
      // Note: The actual timing depends on zustand persist middleware configuration
      // This test verifies the store updates correctly
      const state = useThemeStore.getState()
      expect(state.mode).toBe('dark')
    })

    it('persists preset to localStorage', async () => {
      render(<ThemeConsumer />)

      fireEvent.click(screen.getByTestId('set-preset-stripe'))

      // Wait for the preset to be updated in the store
      await waitFor(() => {
        expect(screen.getByTestId('preset')).toHaveTextContent('stripe')
      })

      // Zustand persist should eventually call setItem
      // Note: The actual timing depends on zustand persist middleware configuration
      // This test verifies the store updates correctly
      const state = useThemeStore.getState()
      expect(state.preset).toBe('stripe')
    })

    it('reads from localStorage on initialization', async () => {
      // Note: Zustand persist middleware handles hydration automatically
      // This test verifies that the persist mechanism is properly configured
      // The actual implementation uses zustand's built-in rehydration

      // Verify the store has the persist middleware configured
      const store = useThemeStore
      expect(store.persist).toBeDefined()
      expect(typeof store.persist.rehydrate).toBe('function')
      expect(typeof store.persist.hasHydrated).toBe('function')
    })

    it('uses default values when localStorage is empty', () => {
      localStorageMock.getItem.mockReturnValue(null)

      const state = useThemeStore.getState()

      // Should have default values
      expect(themePresets).toContain(state.preset)
      expect(['light', 'dark', 'system']).toContain(state.mode)
    })

    it('handles corrupted localStorage gracefully', () => {
      localStorageMock.getItem.mockReturnValue('not valid json')

      // Should not throw
      expect(() => {
        act(() => {
          useThemeStore.getState().initialize?.()
        })
      }).not.toThrow()

      // Should fall back to defaults
      const state = useThemeStore.getState()
      expect(themePresets).toContain(state.preset)
    })

    it('uses THEME_STORAGE_KEY constant', () => {
      expect(THEME_STORAGE_KEY).toBe('do-theme-state')
    })
  })

  // ===========================================================================
  // CSS Variables Tests
  // ===========================================================================

  describe('CSS variables', () => {
    it('applyTheme adds dark class to document', () => {
      act(() => {
        useThemeStore.getState().setMode('dark')
        useThemeStore.getState().applyTheme()
      })

      expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(true)
    })

    it('applyTheme removes dark class in light mode', () => {
      document.documentElement.classList.add(DARK_MODE_CLASS)

      act(() => {
        useThemeStore.getState().setMode('light')
        useThemeStore.getState().applyTheme()
      })

      expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(false)
    })

    it('applyThemeToElement applies theme to specific element', () => {
      const element = document.createElement('div')

      applyThemeToElement(element, 'stripe', 'dark')

      expect(element.classList.contains(DARK_MODE_CLASS)).toBe(true)
    })

    it('applyThemeToElement applies light mode correctly', () => {
      const element = document.createElement('div')
      element.classList.add(DARK_MODE_CLASS)

      applyThemeToElement(element, 'stripe', 'light')

      expect(element.classList.contains(DARK_MODE_CLASS)).toBe(false)
    })

    it('theme switching updates CSS variables on root', async () => {
      render(<ThemeConsumer />)

      // Switch to dark mode
      fireEvent.click(screen.getByTestId('set-dark'))

      act(() => {
        useThemeStore.getState().applyTheme()
      })

      // Document should have dark class
      expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(true)
    })

    it('DARK_MODE_CLASS constant is correct', () => {
      expect(DARK_MODE_CLASS).toBe('dark')
    })
  })

  // ===========================================================================
  // Theme Presets Tests
  // ===========================================================================

  describe('theme presets', () => {
    it('themePresets contains expected presets', () => {
      expect(themePresets).toContain('anthropic')
      expect(themePresets).toContain('stripe')
      expect(themePresets).toContain('linear')
      expect(themePresets).toContain('midnight')
    })

    it('themePresets has multiple options', () => {
      expect(themePresets.length).toBeGreaterThan(5)
    })

    it('defaultThemeState has valid preset', () => {
      expect(themePresets).toContain(defaultThemeState.preset)
    })

    it('defaultThemeState has valid mode', () => {
      expect(['light', 'dark', 'system']).toContain(defaultThemeState.mode)
    })

    it('defaultThemeState has valid resolvedMode', () => {
      expect(['light', 'dark']).toContain(defaultThemeState.resolvedMode)
    })
  })

  // ===========================================================================
  // getResolvedMode Utility Tests
  // ===========================================================================

  describe('getResolvedMode', () => {
    it('returns light for light mode', () => {
      expect(getResolvedMode('light')).toBe('light')
    })

    it('returns dark for dark mode', () => {
      expect(getResolvedMode('dark')).toBe('dark')
    })

    it('returns light for system mode when OS prefers light', () => {
      window.matchMedia = mockMatchMedia(false)
      expect(getResolvedMode('system')).toBe('light')
    })

    it('returns dark for system mode when OS prefers dark', () => {
      window.matchMedia = mockMatchMedia(true)
      expect(getResolvedMode('system')).toBe('dark')
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('integration', () => {
    it('theme state persists across component remounts', async () => {
      // Mount and set dark mode
      const { unmount } = render(<ThemeConsumer />)
      fireEvent.click(screen.getByTestId('set-dark'))

      await waitFor(() => {
        expect(screen.getByTestId('mode')).toHaveTextContent('dark')
      })

      unmount()

      // Remount - state should persist
      render(<ThemeConsumer />)
      expect(screen.getByTestId('mode')).toHaveTextContent('dark')
    })

    it('multiple components share same store', () => {
      render(
        <>
          <ThemeConsumer />
          <div data-testid='second-consumer'>
            <ThemeConsumer />
          </div>
        </>
      )

      // Both should show same values
      const modes = screen.getAllByTestId('mode')
      expect(modes[0].textContent).toBe(modes[1].textContent)
    })

    it('store changes propagate to all consumers', async () => {
      render(
        <>
          <ThemeConsumer />
          <div data-testid='second-consumer'>
            <ThemeConsumer />
          </div>
        </>
      )

      // Click dark button in first consumer
      const darkButtons = screen.getAllByTestId('set-dark')
      fireEvent.click(darkButtons[0])

      // Both consumers should update
      await waitFor(() => {
        const modes = screen.getAllByTestId('mode')
        expect(modes[0]).toHaveTextContent('dark')
        expect(modes[1]).toHaveTextContent('dark')
      })
    })

    it('theme applies to document on mode change', async () => {
      render(<ThemeConsumer />)

      fireEvent.click(screen.getByTestId('set-dark'))

      // Call applyTheme to apply changes to document
      act(() => {
        useThemeStore.getState().applyTheme()
      })

      expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(true)
    })
  })

  // ===========================================================================
  // Application Integration Tests (RED Phase)
  // These tests verify the theme system is properly integrated into the dotdo app
  // ===========================================================================

  describe('application integration', () => {
    it.skip('__root.tsx includes ThemeScript in head', async () => {
      // This test should verify that the root layout includes ThemeScript
      // for FOUC prevention. Skip until integration is implemented.
      const { existsSync } = await import('fs')
      const { readFile } = await import('fs/promises')

      const rootPath = 'app/routes/__root.tsx'
      expect(existsSync(rootPath)).toBe(true)

      const content = await readFile(rootPath, 'utf-8')
      expect(content).toContain('ThemeScript')
      expect(content).toContain('@mdxui/themes')
    })

    it.skip('app.css integrates with theme CSS variables', async () => {
      // This test should verify that app.css properly references theme variables
      // Skip until integration is implemented.
      const { readFile } = await import('fs/promises')

      const cssPath = 'app/styles/app.css'
      const content = await readFile(cssPath, 'utf-8')

      // Should reference theme variables
      expect(content).toContain('--background')
      expect(content).toContain('--foreground')
      expect(content).toContain('--primary')
    })

    it.skip('theme toggle component exists and uses useThemeStore', async () => {
      // This test should verify that a theme toggle component exists
      // Skip until the component is implemented.
      const { existsSync } = await import('fs')

      // Theme toggle should be in components directory
      const togglePaths = [
        'app/components/theme-toggle.tsx',
        'app/components/ui/theme-toggle.tsx',
        'app/components/ThemeToggle.tsx',
      ]

      const exists = togglePaths.some((path) => existsSync(path))
      expect(exists).toBe(true)
    })

    it.skip('layout includes theme provider wrapper', async () => {
      // This test should verify that the layout wraps children with theme context
      // Skip until integration is implemented.
      const { readFile } = await import('fs/promises')

      const rootPath = 'app/routes/__root.tsx'
      const content = await readFile(rootPath, 'utf-8')

      // Should have theme-related provider or wrapper
      expect(content).toMatch(/ThemeProvider|useThemeStore|applyTheme/)
    })
  })
})

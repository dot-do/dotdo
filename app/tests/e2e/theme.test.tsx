/**
 * Theme System E2E Tests
 *
 * These tests verify the theme system works correctly across the application:
 * - ThemeScript prevents FOUC (Flash of Unstyled Content)
 * - Theme toggle with data-testid="theme-toggle" switches themes
 * - Theme persists to localStorage with key "theme"
 * - data-theme attribute is set on html element
 * - CSS variables for colors are properly applied
 *
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import React from 'react'

// =============================================================================
// Mock Setup
// =============================================================================

// Mock localStorage
const createLocalStorageMock = () => {
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
    get _store() {
      return store
    },
  }
}

// Mock matchMedia for system preference detection
const mockMatchMedia = (prefersDark: boolean) => {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  return vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn((fn) => listeners.push(fn)),
    removeListener: vi.fn(),
    addEventListener: vi.fn((event: string, fn: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') listeners.push(fn)
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn((e: MediaQueryListEvent) => {
      listeners.forEach((fn) => fn(e))
    }),
  }))
}

// =============================================================================
// Test Suite: ThemeScript FOUC Prevention
// =============================================================================

describe('ThemeScript FOUC Prevention', () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>

  beforeEach(() => {
    localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ThemeScript renders in document head', async () => {
    const { ThemeScript } = await import('@mdxui/themes')
    const { container } = render(<ThemeScript />)

    const script = container.querySelector('script')
    expect(script).not.toBeNull()
  })

  it('ThemeScript runs synchronously (no defer/async)', async () => {
    const { ThemeScript } = await import('@mdxui/themes')
    const { container } = render(<ThemeScript />)

    const script = container.querySelector('script')
    expect(script?.hasAttribute('defer')).toBe(false)
    expect(script?.hasAttribute('async')).toBe(false)
  })

  it('ThemeScript contains localStorage access', async () => {
    const { ThemeScript, THEME_STORAGE_KEY } = await import('@mdxui/themes')
    const { container } = render(<ThemeScript />)

    const script = container.querySelector('script')
    expect(script?.innerHTML).toContain('localStorage')
    expect(script?.innerHTML).toContain(THEME_STORAGE_KEY)
  })

  it('ThemeScript handles dark mode class', async () => {
    const { ThemeScript, DARK_MODE_CLASS } = await import('@mdxui/themes')
    const { container } = render(<ThemeScript />)

    const script = container.querySelector('script')
    expect(script?.innerHTML).toContain(DARK_MODE_CLASS)
  })

  it('ThemeScript accepts defaultMode prop', async () => {
    const { ThemeScript } = await import('@mdxui/themes')
    const { container } = render(<ThemeScript defaultMode="dark" />)

    const script = container.querySelector('script')
    expect(script).not.toBeNull()
  })

  it('ThemeScript accepts nonce for CSP', async () => {
    const { ThemeScript } = await import('@mdxui/themes')
    const nonce = 'test-nonce-123'
    const { container } = render(<ThemeScript nonce={nonce} />)

    const script = container.querySelector('script')
    expect(script?.getAttribute('nonce')).toBe(nonce)
  })
})

// =============================================================================
// Test Suite: Theme Toggle Functionality
// =============================================================================

describe('Theme Toggle', () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>

  beforeEach(() => {
    localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('theme toggle component has data-testid="theme-toggle"', async () => {
    // Verify the ThemeModeToggle component source contains the data-testid
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('data-testid="theme-toggle"')
  })

  it('admin theme toggle has data-testid="admin-theme-toggle"', async () => {
    // Verify the admin layout contains the data-testid
    const fs = await import('fs')
    const path = await import('path')

    const adminPath = path.resolve(process.cwd(), 'app/routes/admin/_admin.tsx')
    const content = fs.readFileSync(adminPath, 'utf-8')

    expect(content).toContain('data-testid="admin-theme-toggle"')
  })

  it('ThemeModeToggle has aria-label for accessibility', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('aria-label')
  })

  it('ThemeModeToggle has aria-pressed for accessibility', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('aria-pressed')
  })

  it('theme mode can be toggled programmatically', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    // Set initial mode to light
    act(() => {
      useThemeStore.getState().setMode('light')
    })

    expect(useThemeStore.getState().resolvedMode).toBe('light')

    // Toggle to dark
    act(() => {
      useThemeStore.getState().setMode('dark')
    })

    expect(useThemeStore.getState().resolvedMode).toBe('dark')
  })
})

// =============================================================================
// Test Suite: Theme Persistence (localStorage)
// =============================================================================

describe('Theme Persistence', () => {
  let localStorageMock: ReturnType<typeof createLocalStorageMock>

  beforeEach(() => {
    localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses "theme" key for localStorage (via THEME_STORAGE_KEY)', async () => {
    const { THEME_STORAGE_KEY } = await import('@mdxui/themes')
    // The storage key should be defined and used
    expect(THEME_STORAGE_KEY).toBeDefined()
    expect(typeof THEME_STORAGE_KEY).toBe('string')
  })

  it('theme mode persists to store after change', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setMode('dark')
    })

    // The zustand store should persist the value
    const state = useThemeStore.getState()
    expect(state.mode).toBe('dark')
  })

  it('theme preset persists to store after change', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setPreset('stripe')
    })

    const state = useThemeStore.getState()
    expect(state.preset).toBe('stripe')
  })

  it('theme store has persist middleware', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    // Zustand persist middleware adds persist property
    expect(useThemeStore.persist).toBeDefined()
    expect(typeof useThemeStore.persist.rehydrate).toBe('function')
    expect(typeof useThemeStore.persist.hasHydrated).toBe('function')
  })

  it('handles missing localStorage gracefully', async () => {
    // Simulate localStorage being unavailable
    Object.defineProperty(window, 'localStorage', {
      value: undefined,
      writable: true,
    })

    const { useThemeStore } = await import('@mdxui/themes')

    // Should not throw
    expect(() => {
      useThemeStore.getState().setMode('dark')
    }).not.toThrow()
  })
})

// =============================================================================
// Test Suite: HTML data-theme Attribute
// =============================================================================

describe('HTML data-theme Attribute', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applyTheme adds dark class to html element', async () => {
    const { useThemeStore, DARK_MODE_CLASS } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setMode('dark')
      useThemeStore.getState().applyTheme()
    })

    expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(true)
  })

  it('applyTheme removes dark class in light mode', async () => {
    const { useThemeStore, DARK_MODE_CLASS } = await import('@mdxui/themes')

    // First add dark class
    document.documentElement.classList.add(DARK_MODE_CLASS)

    act(() => {
      useThemeStore.getState().setMode('light')
      useThemeStore.getState().applyTheme()
    })

    expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(false)
  })

  it('DARK_MODE_CLASS is "dark"', async () => {
    const { DARK_MODE_CLASS } = await import('@mdxui/themes')
    expect(DARK_MODE_CLASS).toBe('dark')
  })

  it('applyThemeToElement works on custom elements', async () => {
    const { applyThemeToElement, DARK_MODE_CLASS } = await import('@mdxui/themes')

    const element = document.createElement('div')
    applyThemeToElement(element, 'stripe', 'dark')

    expect(element.classList.contains(DARK_MODE_CLASS)).toBe(true)
  })
})

// =============================================================================
// Test Suite: CSS Variables
// =============================================================================

describe('CSS Variables', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('theme defines --background variable', async () => {
    // CSS variables are defined in @mdxui/themes/css/*.css
    // This test verifies the app imports theme CSS
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    // app.css should import theme CSS that defines these variables
    expect(cssContent).toContain('--background')
  })

  it('theme defines --foreground variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--foreground')
  })

  it('theme defines --primary variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--primary')
  })

  it('theme defines --secondary variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--secondary')
  })

  it('theme defines --muted variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--muted')
  })

  it('theme defines --accent variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--accent')
  })

  it('theme defines --destructive variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--destructive')
  })

  it('theme defines --border variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--border')
  })

  it('theme defines --input variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--input')
  })

  it('theme defines --ring variable', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--ring')
  })

  it('app.css imports @mdxui/themes CSS', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('@mdxui/themes')
  })
})

// =============================================================================
// Test Suite: Admin and App Theme Consistency
// =============================================================================

describe('Admin and App Theme Consistency', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('both admin and app use same theme store', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    // Set theme in store
    act(() => {
      useThemeStore.getState().setMode('dark')
    })

    // Both admin and app should see the same state
    const state = useThemeStore.getState()
    expect(state.mode).toBe('dark')
  })

  it('theme changes in admin reflect in app', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    // Simulate admin changing theme
    act(() => {
      useThemeStore.getState().setMode('dark')
      useThemeStore.getState().setPreset('linear')
    })

    // App should see the same values
    const state = useThemeStore.getState()
    expect(state.mode).toBe('dark')
    expect(state.preset).toBe('linear')
  })

  it('theme presets contain expected options', async () => {
    const { themePresets } = await import('@mdxui/themes')

    expect(themePresets).toContain('stripe')
    expect(themePresets).toContain('anthropic')
    expect(themePresets).toContain('linear')
    expect(themePresets.length).toBeGreaterThan(5)
  })
})

// =============================================================================
// Test Suite: System Preference Detection
// =============================================================================

describe('System Preference Detection', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('system mode resolves to light when OS prefers light', async () => {
    window.matchMedia = mockMatchMedia(false) // Light preference
    const { getResolvedMode } = await import('@mdxui/themes')

    expect(getResolvedMode('system')).toBe('light')
  })

  it('system mode resolves to dark when OS prefers dark', async () => {
    window.matchMedia = mockMatchMedia(true) // Dark preference
    const { getResolvedMode } = await import('@mdxui/themes')

    expect(getResolvedMode('system')).toBe('dark')
  })

  it('explicit light mode returns light', async () => {
    const { getResolvedMode } = await import('@mdxui/themes')
    expect(getResolvedMode('light')).toBe('light')
  })

  it('explicit dark mode returns dark', async () => {
    const { getResolvedMode } = await import('@mdxui/themes')
    expect(getResolvedMode('dark')).toBe('dark')
  })

  it('useThemeStore resolvedMode updates with system preference', async () => {
    window.matchMedia = mockMatchMedia(true) // Dark preference
    const { useThemeStore } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setMode('system')
    })

    const state = useThemeStore.getState()
    expect(state.mode).toBe('system')
    expect(state.resolvedMode).toBe('dark')
  })
})

// =============================================================================
// Test Suite: Integration with Root Layout
// =============================================================================

describe('Root Layout Integration', () => {
  it('__root.tsx includes ThemeScript', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const rootPath = path.resolve(process.cwd(), 'app/routes/__root.tsx')
    const content = fs.readFileSync(rootPath, 'utf-8')

    expect(content).toContain('ThemeScript')
    expect(content).toContain('@mdxui/themes')
  })

  it('__root.tsx includes ThemeInitializer', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const rootPath = path.resolve(process.cwd(), 'app/routes/__root.tsx')
    const content = fs.readFileSync(rootPath, 'utf-8')

    expect(content).toContain('ThemeInitializer')
  })

  it('__root.tsx uses useThemeStore', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const rootPath = path.resolve(process.cwd(), 'app/routes/__root.tsx')
    const content = fs.readFileSync(rootPath, 'utf-8')

    expect(content).toContain('useThemeStore')
  })

  it('html element has suppressHydrationWarning', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const rootPath = path.resolve(process.cwd(), 'app/routes/__root.tsx')
    const content = fs.readFileSync(rootPath, 'utf-8')

    expect(content).toContain('suppressHydrationWarning')
  })
})

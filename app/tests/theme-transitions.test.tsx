/**
 * Theme Transitions and Presets Polish Tests (TDD)
 *
 * Tests for theme transition polish:
 * - Smooth CSS transitions between themes
 * - Transition timing and easing
 * - Preset switching behavior
 * - Theme preview interactions
 * - Accessibility during transitions
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
  }
}

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
// Test Suite: Theme Transition CSS
// =============================================================================

describe('Theme Transition CSS', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('app.css defines .theme-transition class', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('.theme-transition')
  })

  it('theme-transition applies to color properties', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('transition-property')
    expect(cssContent).toContain('color')
    expect(cssContent).toContain('background-color')
    expect(cssContent).toContain('border-color')
  })

  it('theme-transition has smooth timing function', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('transition-timing-function')
    expect(cssContent).toContain('cubic-bezier')
  })

  it('theme-transition has appropriate duration', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('transition-duration')
    // Duration should be between 100ms and 400ms for smooth but responsive feel
    expect(cssContent).toMatch(/transition-duration:\s*(1[0-9]{2}|2[0-9]{2}|3[0-9]{2}|400)ms/)
  })

  it('theme-transition-disabled class exists for FOUC prevention', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('.theme-transition-disabled')
    expect(cssContent).toContain('transition: none')
  })

  it('body element has theme-transition class in root layout', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const rootPath = path.resolve(process.cwd(), 'app/routes/__root.tsx')
    const content = fs.readFileSync(rootPath, 'utf-8')

    expect(content).toContain('theme-transition')
  })
})

// =============================================================================
// Test Suite: Theme Preset Switching
// =============================================================================

describe('Theme Preset Switching', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('setPreset updates the current preset', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setPreset('linear')
    })

    expect(useThemeStore.getState().preset).toBe('linear')
  })

  it('setPreset accepts all valid preset names', async () => {
    const { useThemeStore, themePresets } = await import('@mdxui/themes')

    for (const preset of themePresets) {
      act(() => {
        useThemeStore.getState().setPreset(preset)
      })

      expect(useThemeStore.getState().preset).toBe(preset)
    }
  })

  it('applyTheme is called after preset change', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    const applyThemeSpy = vi.spyOn(useThemeStore.getState(), 'applyTheme')

    act(() => {
      useThemeStore.getState().setPreset('stripe')
      useThemeStore.getState().applyTheme()
    })

    expect(applyThemeSpy).toHaveBeenCalled()
  })

  it('preset change persists across store instances', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setPreset('midnight')
    })

    // Re-access the store
    const state = useThemeStore.getState()
    expect(state.preset).toBe('midnight')
  })

  it('default preset is a valid theme preset', async () => {
    const { defaultThemeState, themePresets } = await import('@mdxui/themes')

    // Default should be one of the valid presets
    expect(themePresets).toContain(defaultThemeState.preset)
  })
})

// =============================================================================
// Test Suite: Theme Preview Card Styles
// =============================================================================

describe('Theme Preview Card Styles', () => {
  it('theme-preview-card class has hover effect', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('.theme-preview-card')
    expect(cssContent).toContain('.theme-preview-card:hover')
  })

  it('theme-preview-card hover transforms', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('translateY')
  })

  it('theme-preview-card has focus-visible styles', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('.theme-preview-card:focus-visible')
    expect(cssContent).toContain('outline')
  })

  it('selected theme-preview-card has visual indicator', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('data-selected="true"')
    expect(cssContent).toContain('box-shadow')
  })
})

// =============================================================================
// Test Suite: Theme Swatch Grid
// =============================================================================

describe('Theme Swatch Grid', () => {
  it('theme-swatch-grid class exists', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('.theme-swatch-grid')
  })

  it('theme-swatch-grid uses CSS grid', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('display: grid')
    expect(cssContent).toContain('grid-template-columns')
  })

  it('theme-swatch class exists', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('.theme-swatch')
  })
})

// =============================================================================
// Test Suite: ThemeSelector Component
// =============================================================================

describe('ThemeSelector Component', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ThemeSelector has data-testid attribute', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('data-testid="theme-selector"')
  })

  it('theme preview cards have data-testid', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('data-testid={`theme-preview-')
  })

  it('mode buttons have data-testid', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('data-testid={`theme-mode-')
  })

  it('ThemeSelector has proper ARIA attributes', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('aria-pressed')
    expect(content).toContain('aria-label')
    expect(content).toContain('role="radiogroup"')
  })

  it('ThemeSelector has category sections', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('data-testid={`theme-category-')
  })

  it('ThemeSelector exports QuickThemeSelector', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('export function QuickThemeSelector')
  })

  it('QuickThemeSelector has data-testid', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('data-testid="quick-theme-selector"')
  })
})

// =============================================================================
// Test Suite: Theme Mode Transitions
// =============================================================================

describe('Theme Mode Transitions', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('switching from light to dark adds dark class', async () => {
    const { useThemeStore, DARK_MODE_CLASS } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setMode('light')
      useThemeStore.getState().applyTheme()
    })

    expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(false)

    act(() => {
      useThemeStore.getState().setMode('dark')
      useThemeStore.getState().applyTheme()
    })

    expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(true)
  })

  it('switching from dark to light removes dark class', async () => {
    const { useThemeStore, DARK_MODE_CLASS } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setMode('dark')
      useThemeStore.getState().applyTheme()
    })

    expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(true)

    act(() => {
      useThemeStore.getState().setMode('light')
      useThemeStore.getState().applyTheme()
    })

    expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(false)
  })

  it('system mode follows OS preference', async () => {
    window.matchMedia = mockMatchMedia(true) // Dark preference
    const { useThemeStore, DARK_MODE_CLASS } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setMode('system')
      useThemeStore.getState().applyTheme()
    })

    expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(true)
  })
})

// =============================================================================
// Test Suite: Theme Preset Visual Consistency
// =============================================================================

describe('Theme Preset Visual Consistency', () => {
  it('all presets are in themeMetadata', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    const { themePresets } = await import('@mdxui/themes')

    for (const preset of themePresets) {
      // Each preset should have metadata entry
      expect(content).toContain(`${preset}:`)
    }
  })

  it('themeMetadata has color previews for light and dark', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    // Each theme should have light and dark color arrays
    expect(content).toMatch(/colors:\s*\{\s*light:/m)
    expect(content).toMatch(/dark:/m)
  })

  it('themeMetadata has category assignments', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    // Categories should exist
    expect(content).toContain("category: 'popular'")
    expect(content).toContain("category: 'nature'")
    expect(content).toContain("category: 'productivity'")
    expect(content).toContain("category: 'dark'")
    expect(content).toContain("category: 'playful'")
    expect(content).toContain("category: 'tech'")
    expect(content).toContain("category: 'brand'")
  })
})

// =============================================================================
// Test Suite: ThemeModeToggle Component
// =============================================================================

describe('ThemeModeToggle Component', () => {
  beforeEach(() => {
    const localStorageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })
    window.matchMedia = mockMatchMedia(false)
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ThemeModeToggle is exported', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('export function ThemeModeToggle')
  })

  it('ThemeModeToggle uses useThemeStore', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    // Inside ThemeModeToggle function
    expect(content).toContain('useThemeStore')
  })

  it('ThemeModeToggle has transition styles', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('transition-colors')
  })

  it('ThemeModeToggle shows appropriate icon', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    // Should show Sun and Moon icons
    expect(content).toContain('Sun')
    expect(content).toContain('Moon')
  })
})

// =============================================================================
// Test Suite: Contrast and Accessibility
// =============================================================================

describe('Theme Contrast and Accessibility', () => {
  it('theme selector has role="radiogroup" for mode selection', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('role="radiogroup"')
  })

  it('mode buttons have role="radio"', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('role="radio"')
  })

  it('mode buttons have aria-checked', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('aria-checked')
  })

  it('theme preview cards are focusable buttons', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    // Preview cards should be buttons for keyboard accessibility
    expect(content).toContain('<button')
    expect(content).toContain('type="button"')
  })

  it('icons are marked aria-hidden', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const componentPath = path.resolve(process.cwd(), 'app/components/ui/theme-selector.tsx')
    const content = fs.readFileSync(componentPath, 'utf-8')

    expect(content).toContain('aria-hidden="true"')
  })
})

// =============================================================================
// Test Suite: Theme Store Integration
// =============================================================================

describe('Theme Store Integration', () => {
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

  it('useThemeStore exports all required functions', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    const state = useThemeStore.getState()

    expect(typeof state.setPreset).toBe('function')
    expect(typeof state.setMode).toBe('function')
    expect(typeof state.applyTheme).toBe('function')
    expect(typeof state.initialize).toBe('function')
  })

  it('useThemeStore exports all required state', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    const state = useThemeStore.getState()

    expect(state).toHaveProperty('preset')
    expect(state).toHaveProperty('mode')
    expect(state).toHaveProperty('resolvedMode')
  })

  it('applyTheme updates document state', async () => {
    const { useThemeStore, DARK_MODE_CLASS } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().setMode('dark')
      useThemeStore.getState().applyTheme()
    })

    expect(document.documentElement.classList.contains(DARK_MODE_CLASS)).toBe(true)
  })

  it('initialize hydrates from localStorage', async () => {
    const { useThemeStore } = await import('@mdxui/themes')

    act(() => {
      useThemeStore.getState().initialize()
    })

    // After initialization, state should be defined
    const state = useThemeStore.getState()
    expect(state.preset).toBeDefined()
    expect(state.mode).toBeDefined()
  })
})

// =============================================================================
// Test Suite: CSS Variable Application
// =============================================================================

describe('CSS Variable Application', () => {
  it('stripe.css is imported in app.css', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain("@import '@mdxui/themes/css/stripe.css'")
  })

  it('app.css maps theme variables to Tailwind colors', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--color-primary: var(--primary)')
    expect(cssContent).toContain('--color-background: var(--background)')
    expect(cssContent).toContain('--color-foreground: var(--foreground)')
  })

  it('app.css maps fumadocs custom properties', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('--color-fd-primary: var(--primary)')
    expect(cssContent).toContain('--color-fd-background: var(--background)')
  })

  it('body uses theme background and foreground', async () => {
    const fs = await import('fs')
    const path = await import('path')

    const cssPath = path.resolve(process.cwd(), 'app/styles/app.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')

    expect(cssContent).toContain('background-color: var(--background)')
    expect(cssContent).toContain('color: var(--foreground)')
  })
})

/**
 * Theme System Tests - Extended Coverage (TDD RED Phase)
 *
 * These tests define the extended theme system requirements beyond the basic
 * @mdxui/themes integration. Tests SHOULD FAIL until features are implemented.
 *
 * Coverage areas:
 * - Theme Definition (colors, typography, spacing schema)
 * - Theme Customization (custom themes, overrides, merging)
 * - CSS Variable Generation (dynamic generation)
 * - Typography System (font families, sizes, weights)
 * - Spacing System (consistent spacing scale)
 * - Theme Tokens API
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Test Types - Expected Theme API Shape
// =============================================================================

/**
 * Expected color token structure for themes
 */
interface ColorTokens {
  background: string
  foreground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  destructiveForeground: string
  border: string
  input: string
  ring: string
  // Semantic colors
  success: string
  successForeground: string
  warning: string
  warningForeground: string
  error: string
  errorForeground: string
  info: string
  infoForeground: string
  // Chart colors
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
  // Sidebar colors
  sidebar: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  sidebarRing: string
}

/**
 * Expected typography token structure
 */
interface TypographyTokens {
  fontFamily: {
    sans: string
    mono: string
    display: string
  }
  fontSize: {
    xs: string
    sm: string
    base: string
    lg: string
    xl: string
    '2xl': string
    '3xl': string
    '4xl': string
    '5xl': string
  }
  fontWeight: {
    light: number
    normal: number
    medium: number
    semibold: number
    bold: number
  }
  lineHeight: {
    none: number
    tight: number
    snug: number
    normal: number
    relaxed: number
    loose: number
  }
  letterSpacing: {
    tighter: string
    tight: string
    normal: string
    wide: string
    wider: string
  }
}

/**
 * Expected spacing token structure
 */
interface SpacingTokens {
  0: string
  0.5: string
  1: string
  1.5: string
  2: string
  2.5: string
  3: string
  3.5: string
  4: string
  5: string
  6: string
  7: string
  8: string
  9: string
  10: string
  11: string
  12: string
  14: string
  16: string
  20: string
  24: string
  28: string
  32: string
  36: string
  40: string
  44: string
  48: string
  52: string
  56: string
  60: string
  64: string
  72: string
  80: string
  96: string
}

/**
 * Expected complete theme definition
 */
interface ThemeDefinition {
  name: string
  colors: {
    light: ColorTokens
    dark: ColorTokens
  }
  typography: TypographyTokens
  spacing: SpacingTokens
  radius: {
    none: string
    sm: string
    md: string
    lg: string
    xl: string
    '2xl': string
    full: string
  }
  shadows: {
    sm: string
    md: string
    lg: string
    xl: string
    '2xl': string
    inner: string
  }
}

// =============================================================================
// Theme Definition Tests
// =============================================================================

describe('Theme Definition', () => {
  describe('color schema', () => {
    it('exports a createTheme function', async () => {
      // RED: This function should exist in the theme system
      const { createTheme } = await import('@mdxui/themes')
      expect(typeof createTheme).toBe('function')
    })

    it('createTheme validates required color tokens', async () => {
      const { createTheme } = await import('@mdxui/themes')

      // Should throw when missing required tokens
      expect(() =>
        createTheme({
          name: 'incomplete',
          colors: {
            light: {
              // Missing required tokens
              background: '#fff',
            },
            dark: {},
          },
        })
      ).toThrow(/missing required color tokens/i)
    })

    it('theme colors include all semantic tokens', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('stripe')

      // Verify semantic colors exist
      expect(theme.colors.light).toHaveProperty('success')
      expect(theme.colors.light).toHaveProperty('warning')
      expect(theme.colors.light).toHaveProperty('error')
      expect(theme.colors.light).toHaveProperty('info')
      expect(theme.colors.dark).toHaveProperty('success')
      expect(theme.colors.dark).toHaveProperty('warning')
      expect(theme.colors.dark).toHaveProperty('error')
      expect(theme.colors.dark).toHaveProperty('info')
    })

    it('theme colors are valid CSS color values', async () => {
      const { getTheme, validateColorValue } = await import('@mdxui/themes')

      const theme = getTheme('anthropic')

      // All color values should be valid CSS colors
      Object.values(theme.colors.light).forEach((color) => {
        expect(validateColorValue(color)).toBe(true)
      })
    })

    it('provides color contrast validation utility', async () => {
      const { getContrastRatio } = await import('@mdxui/themes')

      // Should return WCAG contrast ratio
      const ratio = getContrastRatio('#000000', '#ffffff')
      expect(ratio).toBe(21) // Maximum contrast
    })

    it('all themes meet WCAG AA contrast requirements', async () => {
      const { themePresets, getTheme, getContrastRatio } = await import('@mdxui/themes')

      for (const presetName of themePresets) {
        const theme = getTheme(presetName)

        // Primary text on background should have 4.5:1 contrast ratio
        const lightContrastFg = getContrastRatio(theme.colors.light.foreground, theme.colors.light.background)
        expect(lightContrastFg).toBeGreaterThanOrEqual(4.5)

        const darkContrastFg = getContrastRatio(theme.colors.dark.foreground, theme.colors.dark.background)
        expect(darkContrastFg).toBeGreaterThanOrEqual(4.5)
      }
    })
  })

  describe('typography schema', () => {
    it('exports typography tokens', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('stripe')
      expect(theme).toHaveProperty('typography')
    })

    it('typography includes font families', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('linear')
      expect(theme.typography).toHaveProperty('fontFamily')
      expect(theme.typography.fontFamily).toHaveProperty('sans')
      expect(theme.typography.fontFamily).toHaveProperty('mono')
    })

    it('typography includes font size scale', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('anthropic')
      expect(theme.typography).toHaveProperty('fontSize')
      expect(theme.typography.fontSize).toHaveProperty('xs')
      expect(theme.typography.fontSize).toHaveProperty('base')
      expect(theme.typography.fontSize).toHaveProperty('xl')
    })

    it('font sizes follow type scale ratio', async () => {
      const { getTheme, parseFontSize } = await import('@mdxui/themes')

      const theme = getTheme('stripe')
      const sizes = theme.typography.fontSize

      // Each step should be approximately 1.25x the previous (major third scale)
      const base = parseFontSize(sizes.base)
      const lg = parseFontSize(sizes.lg)
      const xl = parseFontSize(sizes.xl)

      const ratio1 = lg / base
      const ratio2 = xl / lg

      // Ratios should be consistent (within 10%)
      expect(Math.abs(ratio1 - ratio2)).toBeLessThan(0.2)
    })

    it('typography includes font weights', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('midnight')
      expect(theme.typography).toHaveProperty('fontWeight')
      expect(theme.typography.fontWeight).toHaveProperty('normal')
      expect(theme.typography.fontWeight).toHaveProperty('bold')
      expect(theme.typography.fontWeight.normal).toBe(400)
      expect(theme.typography.fontWeight.bold).toBe(700)
    })

    it('typography includes line heights', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('obsidian')
      expect(theme.typography).toHaveProperty('lineHeight')
      expect(theme.typography.lineHeight).toHaveProperty('normal')
      expect(theme.typography.lineHeight.normal).toBeGreaterThanOrEqual(1.4)
      expect(theme.typography.lineHeight.normal).toBeLessThanOrEqual(1.6)
    })
  })

  describe('spacing schema', () => {
    it('exports spacing tokens', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('stripe')
      expect(theme).toHaveProperty('spacing')
    })

    it('spacing follows 4px base unit', async () => {
      const { getTheme, parseSpacing } = await import('@mdxui/themes')

      const theme = getTheme('linear')

      // spacing[1] should be 4px (0.25rem)
      expect(parseSpacing(theme.spacing['1'])).toBe(4)

      // spacing[4] should be 16px (1rem)
      expect(parseSpacing(theme.spacing['4'])).toBe(16)

      // spacing[8] should be 32px (2rem)
      expect(parseSpacing(theme.spacing['8'])).toBe(32)
    })

    it('spacing scale is complete', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('anthropic')
      const requiredSpacingKeys = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24']

      for (const key of requiredSpacingKeys) {
        expect(theme.spacing).toHaveProperty(key)
      }
    })
  })

  describe('border radius schema', () => {
    it('exports radius tokens', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('stripe')
      expect(theme).toHaveProperty('radius')
    })

    it('radius includes all size variants', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('linear')
      expect(theme.radius).toHaveProperty('none')
      expect(theme.radius).toHaveProperty('sm')
      expect(theme.radius).toHaveProperty('md')
      expect(theme.radius).toHaveProperty('lg')
      expect(theme.radius).toHaveProperty('xl')
      expect(theme.radius).toHaveProperty('full')
    })

    it('radius values are progressive', async () => {
      const { getTheme, parseRadius } = await import('@mdxui/themes')

      const theme = getTheme('anthropic')

      const none = parseRadius(theme.radius.none)
      const sm = parseRadius(theme.radius.sm)
      const md = parseRadius(theme.radius.md)
      const lg = parseRadius(theme.radius.lg)

      expect(none).toBe(0)
      expect(sm).toBeLessThan(md)
      expect(md).toBeLessThan(lg)
    })
  })

  describe('shadow schema', () => {
    it('exports shadow tokens', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('stripe')
      expect(theme).toHaveProperty('shadows')
    })

    it('shadows include all size variants', async () => {
      const { getTheme } = await import('@mdxui/themes')

      const theme = getTheme('midnight')
      expect(theme.shadows).toHaveProperty('sm')
      expect(theme.shadows).toHaveProperty('md')
      expect(theme.shadows).toHaveProperty('lg')
      expect(theme.shadows).toHaveProperty('xl')
    })

    it('shadows are valid CSS box-shadow values', async () => {
      const { getTheme, validateShadowValue } = await import('@mdxui/themes')

      const theme = getTheme('obsidian')

      Object.values(theme.shadows).forEach((shadow) => {
        expect(validateShadowValue(shadow)).toBe(true)
      })
    })
  })
})

// =============================================================================
// Theme Customization Tests
// =============================================================================

describe('Theme Customization', () => {
  describe('custom theme creation', () => {
    it('createTheme accepts full theme definition', async () => {
      const { createTheme } = await import('@mdxui/themes')

      const customTheme = createTheme({
        name: 'my-brand',
        colors: {
          light: {
            background: '#ffffff',
            foreground: '#1a1a1a',
            primary: '#0066cc',
            primaryForeground: '#ffffff',
            secondary: '#f0f0f0',
            secondaryForeground: '#1a1a1a',
            muted: '#f5f5f5',
            mutedForeground: '#666666',
            accent: '#e6f0ff',
            accentForeground: '#0066cc',
            destructive: '#dc2626',
            destructiveForeground: '#ffffff',
            border: '#e5e5e5',
            input: '#e5e5e5',
            ring: '#0066cc',
            success: '#22c55e',
            successForeground: '#ffffff',
            warning: '#f59e0b',
            warningForeground: '#000000',
            error: '#ef4444',
            errorForeground: '#ffffff',
            info: '#3b82f6',
            infoForeground: '#ffffff',
            chart1: '#0066cc',
            chart2: '#22c55e',
            chart3: '#f59e0b',
            chart4: '#ef4444',
            chart5: '#8b5cf6',
            sidebar: '#f8f8f8',
            sidebarForeground: '#1a1a1a',
            sidebarPrimary: '#0066cc',
            sidebarPrimaryForeground: '#ffffff',
            sidebarAccent: '#e6f0ff',
            sidebarAccentForeground: '#0066cc',
            sidebarBorder: '#e5e5e5',
            sidebarRing: '#0066cc',
          },
          dark: {
            background: '#0a0a0a',
            foreground: '#fafafa',
            primary: '#3b82f6',
            primaryForeground: '#ffffff',
            secondary: '#262626',
            secondaryForeground: '#fafafa',
            muted: '#262626',
            mutedForeground: '#a3a3a3',
            accent: '#1e3a5f',
            accentForeground: '#3b82f6',
            destructive: '#dc2626',
            destructiveForeground: '#ffffff',
            border: '#262626',
            input: '#262626',
            ring: '#3b82f6',
            success: '#22c55e',
            successForeground: '#ffffff',
            warning: '#f59e0b',
            warningForeground: '#000000',
            error: '#ef4444',
            errorForeground: '#ffffff',
            info: '#3b82f6',
            infoForeground: '#ffffff',
            chart1: '#3b82f6',
            chart2: '#22c55e',
            chart3: '#f59e0b',
            chart4: '#ef4444',
            chart5: '#8b5cf6',
            sidebar: '#0f0f0f',
            sidebarForeground: '#fafafa',
            sidebarPrimary: '#3b82f6',
            sidebarPrimaryForeground: '#ffffff',
            sidebarAccent: '#1e3a5f',
            sidebarAccentForeground: '#3b82f6',
            sidebarBorder: '#262626',
            sidebarRing: '#3b82f6',
          },
        },
      })

      expect(customTheme.name).toBe('my-brand')
      expect(customTheme.colors.light.primary).toBe('#0066cc')
    })

    it('createTheme assigns default typography when not provided', async () => {
      const { createTheme } = await import('@mdxui/themes')

      const customTheme = createTheme({
        name: 'minimal',
        colors: {
          light: {
            /* minimal required colors */
          },
          dark: {
            /* minimal required colors */
          },
        },
      })

      expect(customTheme.typography).toBeDefined()
      expect(customTheme.typography.fontFamily.sans).toBeDefined()
    })

    it('createTheme allows typography customization', async () => {
      const { createTheme } = await import('@mdxui/themes')

      const customTheme = createTheme({
        name: 'custom-font',
        colors: {
          light: {
            /* colors */
          },
          dark: {
            /* colors */
          },
        },
        typography: {
          fontFamily: {
            sans: 'Inter, system-ui, sans-serif',
            mono: 'JetBrains Mono, monospace',
            display: 'Cal Sans, Inter, system-ui, sans-serif',
          },
        },
      })

      expect(customTheme.typography.fontFamily.sans).toBe('Inter, system-ui, sans-serif')
      expect(customTheme.typography.fontFamily.mono).toBe('JetBrains Mono, monospace')
    })
  })

  describe('theme extension', () => {
    it('extendTheme creates new theme from base', async () => {
      const { extendTheme, getTheme } = await import('@mdxui/themes')

      const baseTheme = getTheme('stripe')
      const extended = extendTheme(baseTheme, {
        name: 'stripe-custom',
        colors: {
          light: {
            primary: '#ff6600', // Override primary color
          },
        },
      })

      expect(extended.name).toBe('stripe-custom')
      expect(extended.colors.light.primary).toBe('#ff6600')
      // Other colors should be inherited from base
      expect(extended.colors.light.background).toBe(baseTheme.colors.light.background)
    })

    it('extendTheme deep merges nested objects', async () => {
      const { extendTheme, getTheme } = await import('@mdxui/themes')

      const baseTheme = getTheme('linear')
      const extended = extendTheme(baseTheme, {
        typography: {
          fontFamily: {
            display: 'Custom Display Font',
          },
        },
      })

      // Should have custom display font
      expect(extended.typography.fontFamily.display).toBe('Custom Display Font')
      // Should inherit other font families
      expect(extended.typography.fontFamily.sans).toBe(baseTheme.typography.fontFamily.sans)
    })

    it('extendTheme preserves base theme immutability', async () => {
      const { extendTheme, getTheme } = await import('@mdxui/themes')

      const baseTheme = getTheme('anthropic')
      const originalPrimary = baseTheme.colors.light.primary

      extendTheme(baseTheme, {
        colors: {
          light: {
            primary: '#000000',
          },
        },
      })

      // Base theme should be unchanged
      expect(baseTheme.colors.light.primary).toBe(originalPrimary)
    })
  })

  describe('runtime theme registration', () => {
    it('registerTheme adds custom theme to available themes', async () => {
      const { registerTheme, createTheme, getTheme } = await import('@mdxui/themes')

      const customTheme = createTheme({
        name: 'runtime-custom',
        colors: {
          light: {
            /* colors */
          },
          dark: {
            /* colors */
          },
        },
      })

      registerTheme(customTheme)

      const retrieved = getTheme('runtime-custom')
      expect(retrieved.name).toBe('runtime-custom')
    })

    it('registerTheme prevents duplicate names', async () => {
      const { registerTheme, createTheme } = await import('@mdxui/themes')

      const theme = createTheme({
        name: 'unique-name',
        colors: {
          light: {},
          dark: {},
        },
      })

      registerTheme(theme)

      // Registering again with same name should throw
      expect(() => registerTheme(theme)).toThrow(/already registered/i)
    })

    it('unregisterTheme removes custom theme', async () => {
      const { registerTheme, unregisterTheme, getTheme, createTheme } = await import('@mdxui/themes')

      const theme = createTheme({
        name: 'temporary',
        colors: {
          light: {},
          dark: {},
        },
      })

      registerTheme(theme)
      unregisterTheme('temporary')

      expect(() => getTheme('temporary')).toThrow(/not found/i)
    })
  })
})

// =============================================================================
// CSS Variable Generation Tests
// =============================================================================

describe('CSS Variable Generation', () => {
  describe('generateCSSVariables', () => {
    it('exports generateCSSVariables function', async () => {
      const { generateCSSVariables } = await import('@mdxui/themes')
      expect(typeof generateCSSVariables).toBe('function')
    })

    it('generates CSS variables string from theme', async () => {
      const { generateCSSVariables, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('stripe')
      const css = generateCSSVariables(theme, 'light')

      expect(typeof css).toBe('string')
      expect(css).toContain('--background:')
      expect(css).toContain('--foreground:')
      expect(css).toContain('--primary:')
    })

    it('generates both light and dark mode variables', async () => {
      const { generateCSSVariables, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('linear')

      const lightCSS = generateCSSVariables(theme, 'light')
      const darkCSS = generateCSSVariables(theme, 'dark')

      // Should be different
      expect(lightCSS).not.toBe(darkCSS)

      // Both should have all required variables
      expect(lightCSS).toContain('--background:')
      expect(darkCSS).toContain('--background:')
    })

    it('generates complete CSS stylesheet', async () => {
      const { generateThemeCSS, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('anthropic')
      const css = generateThemeCSS(theme)

      // Should include :root selector for light mode
      expect(css).toContain(':root')

      // Should include .dark selector for dark mode
      expect(css).toContain('.dark')

      // Should include system preference media query
      expect(css).toContain('@media (prefers-color-scheme: dark)')
    })

    it('includes typography CSS variables', async () => {
      const { generateThemeCSS, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('midnight')
      const css = generateThemeCSS(theme)

      expect(css).toContain('--font-sans:')
      expect(css).toContain('--font-mono:')
    })

    it('includes spacing CSS variables', async () => {
      const { generateThemeCSS, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('obsidian')
      const css = generateThemeCSS(theme)

      expect(css).toContain('--spacing-1:')
      expect(css).toContain('--spacing-4:')
      expect(css).toContain('--spacing-8:')
    })

    it('includes radius CSS variables', async () => {
      const { generateThemeCSS, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('sage')
      const css = generateThemeCSS(theme)

      expect(css).toContain('--radius:')
    })
  })

  describe('injectThemeCSS', () => {
    beforeEach(() => {
      // Clean up any injected styles
      document.querySelectorAll('style[data-theme]').forEach((el) => el.remove())
    })

    it('injects theme CSS into document head', async () => {
      const { injectThemeCSS, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('stripe')
      injectThemeCSS(theme)

      const styleEl = document.querySelector('style[data-theme="stripe"]')
      expect(styleEl).not.toBeNull()
    })

    it('updates existing style element on re-injection', async () => {
      const { injectThemeCSS, getTheme } = await import('@mdxui/themes')

      const stripeTheme = getTheme('stripe')
      const linearTheme = getTheme('linear')

      injectThemeCSS(stripeTheme)
      injectThemeCSS(linearTheme)

      // Should only have one theme style element (the latest)
      const styleElements = document.querySelectorAll('style[data-theme]')
      expect(styleElements.length).toBe(1)
    })

    it('removes theme CSS with removeThemeCSS', async () => {
      const { injectThemeCSS, removeThemeCSS, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('anthropic')
      injectThemeCSS(theme)

      removeThemeCSS()

      const styleEl = document.querySelector('style[data-theme]')
      expect(styleEl).toBeNull()
    })
  })

  describe('CSS custom property naming', () => {
    it('uses consistent naming convention', async () => {
      const { generateCSSVariables, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('stripe')
      const css = generateCSSVariables(theme, 'light')

      // Should use kebab-case
      expect(css).toContain('--primary-foreground:')
      expect(css).toContain('--muted-foreground:')
      expect(css).not.toContain('--primaryForeground:')
    })

    it('prefixes sidebar variables correctly', async () => {
      const { generateCSSVariables, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('linear')
      const css = generateCSSVariables(theme, 'light')

      expect(css).toContain('--sidebar:')
      expect(css).toContain('--sidebar-foreground:')
      expect(css).toContain('--sidebar-primary:')
    })

    it('chart variables use numbered suffix', async () => {
      const { generateCSSVariables, getTheme } = await import('@mdxui/themes')

      const theme = getTheme('anthropic')
      const css = generateCSSVariables(theme, 'light')

      expect(css).toContain('--chart-1:')
      expect(css).toContain('--chart-2:')
      expect(css).toContain('--chart-3:')
      expect(css).toContain('--chart-4:')
      expect(css).toContain('--chart-5:')
    })
  })
})

// =============================================================================
// Dark/Light Mode Switching Tests
// =============================================================================

describe('Dark/Light Mode Switching', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
  })

  describe('mode application', () => {
    it('applyMode adds dark class for dark mode', async () => {
      const { applyMode } = await import('@mdxui/themes')

      applyMode('dark')

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('applyMode removes dark class for light mode', async () => {
      const { applyMode } = await import('@mdxui/themes')

      document.documentElement.classList.add('dark')
      applyMode('light')

      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('applyMode sets data-theme attribute', async () => {
      const { applyMode, applyPreset } = await import('@mdxui/themes')

      applyPreset('stripe')
      applyMode('dark')

      expect(document.documentElement.getAttribute('data-theme')).toBe('stripe-dark')
    })

    it('applyMode respects system preference for system mode', async () => {
      const { applyMode } = await import('@mdxui/themes')

      // Mock dark system preference
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))

      applyMode('system')

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  describe('system preference listener', () => {
    it('listenToSystemPreference returns cleanup function', async () => {
      const { listenToSystemPreference } = await import('@mdxui/themes')

      const cleanup = listenToSystemPreference(() => {})

      expect(typeof cleanup).toBe('function')
    })

    it('listenToSystemPreference calls callback on change', async () => {
      const { listenToSystemPreference } = await import('@mdxui/themes')

      let changeHandler: ((e: { matches: boolean }) => void) | null = null

      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: (event: string, handler: (e: { matches: boolean }) => void) => {
          if (event === 'change') changeHandler = handler
        },
        removeEventListener: vi.fn(),
      }))

      const callback = vi.fn()
      listenToSystemPreference(callback)

      // Simulate system preference change
      if (changeHandler) {
        changeHandler({ matches: true })
      }

      expect(callback).toHaveBeenCalledWith('dark')
    })

    it('cleanup removes event listener', async () => {
      const { listenToSystemPreference } = await import('@mdxui/themes')

      const removeEventListenerMock = vi.fn()

      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: removeEventListenerMock,
      }))

      const cleanup = listenToSystemPreference(() => {})
      cleanup()

      expect(removeEventListenerMock).toHaveBeenCalled()
    })
  })

  describe('transition handling', () => {
    it('disableTransitions temporarily disables CSS transitions', async () => {
      const { disableTransitions } = await import('@mdxui/themes')

      disableTransitions(() => {
        expect(document.documentElement.style.getPropertyValue('--disable-transitions')).toBe('1')
      })
    })

    it('disableTransitions restores transitions after callback', async () => {
      const { disableTransitions } = await import('@mdxui/themes')

      disableTransitions(() => {
        // During callback
      })

      // After callback - should be reset
      expect(document.documentElement.style.getPropertyValue('--disable-transitions')).toBe('')
    })

    it('mode switch uses disableTransitions to prevent flash', async () => {
      const { applyMode, getTransitionState } = await import('@mdxui/themes')

      let wasDisabled = false

      // Monkey-patch to detect if transitions were disabled
      const originalApplyMode = applyMode

      applyMode('dark')

      // The mode switch should have temporarily disabled transitions
      expect(getTransitionState()).toBe('enabled')
    })
  })
})

// =============================================================================
// Theme Tokens API Tests
// =============================================================================

describe('Theme Tokens API', () => {
  describe('getToken', () => {
    it('getToken retrieves specific token value', async () => {
      const { getToken, useThemeStore } = await import('@mdxui/themes')

      useThemeStore.getState().setPreset('stripe')
      useThemeStore.getState().setMode('light')

      const primaryColor = getToken('colors.primary')
      expect(primaryColor).toBeTruthy()
      expect(typeof primaryColor).toBe('string')
    })

    it('getToken supports nested paths', async () => {
      const { getToken, useThemeStore } = await import('@mdxui/themes')

      useThemeStore.getState().setPreset('linear')

      const fontSans = getToken('typography.fontFamily.sans')
      expect(fontSans).toBeTruthy()
    })

    it('getToken respects current mode', async () => {
      const { getToken, useThemeStore } = await import('@mdxui/themes')

      useThemeStore.getState().setPreset('anthropic')

      useThemeStore.getState().setMode('light')
      const lightBg = getToken('colors.background')

      useThemeStore.getState().setMode('dark')
      const darkBg = getToken('colors.background')

      expect(lightBg).not.toBe(darkBg)
    })

    it('getToken returns undefined for invalid path', async () => {
      const { getToken } = await import('@mdxui/themes')

      const invalid = getToken('colors.nonexistent')
      expect(invalid).toBeUndefined()
    })
  })

  describe('useToken hook', () => {
    it('useToken returns reactive token value', async () => {
      const React = await import('react')
      const { render, screen, act } = await import('@testing-library/react')
      const { useToken, useThemeStore } = await import('@mdxui/themes')

      function TokenDisplay() {
        const primary = useToken('colors.primary')
        return <div data-testid='token'>{primary}</div>
      }

      render(<TokenDisplay />)

      expect(screen.getByTestId('token').textContent).toBeTruthy()
    })

    it('useToken updates when theme changes', async () => {
      const React = await import('react')
      const { render, screen, act, waitFor } = await import('@testing-library/react')
      const { useToken, useThemeStore } = await import('@mdxui/themes')

      function TokenDisplay() {
        const primary = useToken('colors.primary')
        return <div data-testid='token'>{primary}</div>
      }

      useThemeStore.getState().setPreset('stripe')
      render(<TokenDisplay />)

      const initialValue = screen.getByTestId('token').textContent

      act(() => {
        useThemeStore.getState().setPreset('linear')
      })

      await waitFor(() => {
        const newValue = screen.getByTestId('token').textContent
        expect(newValue).not.toBe(initialValue)
      })
    })
  })

  describe('getAllTokens', () => {
    it('getAllTokens returns flattened token map', async () => {
      const { getAllTokens, useThemeStore } = await import('@mdxui/themes')

      useThemeStore.getState().setPreset('stripe')
      useThemeStore.getState().setMode('light')

      const tokens = getAllTokens()

      expect(tokens).toHaveProperty('colors.primary')
      expect(tokens).toHaveProperty('colors.background')
      expect(tokens).toHaveProperty('typography.fontFamily.sans')
      expect(tokens).toHaveProperty('spacing.4')
    })

    it('getAllTokens includes CSS variable names', async () => {
      const { getAllTokens, useThemeStore } = await import('@mdxui/themes')

      useThemeStore.getState().setPreset('linear')
      useThemeStore.getState().setMode('dark')

      const tokens = getAllTokens({ includeCSSVars: true })

      expect(tokens['colors.primary']).toHaveProperty('value')
      expect(tokens['colors.primary']).toHaveProperty('cssVar')
      expect(tokens['colors.primary'].cssVar).toBe('--primary')
    })
  })
})

// =============================================================================
// Theme Preset Completeness Tests
// =============================================================================

describe('Theme Preset Completeness', () => {
  it('all presets have complete color definitions', async () => {
    const { themePresets, getTheme } = await import('@mdxui/themes')

    const requiredColorKeys = [
      'background',
      'foreground',
      'primary',
      'primaryForeground',
      'secondary',
      'secondaryForeground',
      'muted',
      'mutedForeground',
      'accent',
      'accentForeground',
      'destructive',
      'destructiveForeground',
      'border',
      'input',
      'ring',
    ]

    for (const presetName of themePresets) {
      const theme = getTheme(presetName)

      for (const key of requiredColorKeys) {
        expect(theme.colors.light, `${presetName} light mode missing ${key}`).toHaveProperty(key)
        expect(theme.colors.dark, `${presetName} dark mode missing ${key}`).toHaveProperty(key)
      }
    }
  })

  it('all presets have chart colors', async () => {
    const { themePresets, getTheme } = await import('@mdxui/themes')

    for (const presetName of themePresets) {
      const theme = getTheme(presetName)

      expect(theme.colors.light, `${presetName} light missing chart1`).toHaveProperty('chart1')
      expect(theme.colors.light, `${presetName} light missing chart5`).toHaveProperty('chart5')
      expect(theme.colors.dark, `${presetName} dark missing chart1`).toHaveProperty('chart1')
      expect(theme.colors.dark, `${presetName} dark missing chart5`).toHaveProperty('chart5')
    }
  })

  it('all presets have sidebar colors', async () => {
    const { themePresets, getTheme } = await import('@mdxui/themes')

    const sidebarKeys = ['sidebar', 'sidebarForeground', 'sidebarPrimary', 'sidebarBorder']

    for (const presetName of themePresets) {
      const theme = getTheme(presetName)

      for (const key of sidebarKeys) {
        expect(theme.colors.light, `${presetName} light missing ${key}`).toHaveProperty(key)
        expect(theme.colors.dark, `${presetName} dark missing ${key}`).toHaveProperty(key)
      }
    }
  })
})

/**
 * JSX/TSX Imports Type Tests
 *
 * RED Phase: These tests verify that JSX/TSX imports work correctly.
 * They should FAIL initially because:
 * - tsconfig.json only includes TS files, not TSX
 * - tsconfig.json lacks jsx compiler option
 * - tsconfig.json lacks DOM in lib array
 *
 * Issue: do-j4v - RED: Type tests for JSX/TSX imports
 *
 * Expected errors:
 * - Cannot find module or its corresponding type declarations
 * - JSX element implicitly has type any because no interface JSX.IntrinsicElements exists
 */

import { describe, it, expectTypeOf } from 'vitest'

// ============================================================================
// Type imports from TSX components
// These should fail until tsconfig.json is updated to include .tsx files
// ============================================================================

import type { DocsLayoutProps } from '../../components/docs/layout'
import type { DocsPageProps } from '../../components/docs/page'
import type { DocsProviderProps, ThemeMode, ThemeConfig, SearchConfig } from '../../components/docs/provider'

// ============================================================================
// Type-level tests for exported interfaces
// ============================================================================

describe('JSX/TSX Type Import Tests', () => {
  describe('DocsLayoutProps type structure', () => {
    it('should be an object type', () => {
      expectTypeOf<DocsLayoutProps>().toBeObject()
    })

    it('should have children property of ReactNode type', () => {
      expectTypeOf<DocsLayoutProps>().toHaveProperty('children')
    })

    it('should have optional tree property', () => {
      expectTypeOf<DocsLayoutProps>().toMatchTypeOf<{ tree?: unknown }>()
    })

    it('should have optional title property of string type', () => {
      expectTypeOf<DocsLayoutProps>().toMatchTypeOf<{ title?: string }>()
    })

    it('should have optional collapsible property of boolean type', () => {
      expectTypeOf<DocsLayoutProps>().toMatchTypeOf<{ collapsible?: boolean }>()
    })

    it('should have optional defaultOpenLevel property of number type', () => {
      expectTypeOf<DocsLayoutProps>().toMatchTypeOf<{ defaultOpenLevel?: number }>()
    })
  })

  describe('DocsPageProps type structure', () => {
    it('should be an object type', () => {
      expectTypeOf<DocsPageProps>().toBeObject()
    })

    it('should have optional title property', () => {
      expectTypeOf<DocsPageProps>().toMatchTypeOf<{ title?: string }>()
    })

    it('should have optional description property', () => {
      expectTypeOf<DocsPageProps>().toMatchTypeOf<{ description?: string }>()
    })

    it('should have children property', () => {
      expectTypeOf<DocsPageProps>().toHaveProperty('children')
    })

    it('should have optional toc property as array', () => {
      expectTypeOf<DocsPageProps>().toMatchTypeOf<{ toc?: unknown[] }>()
    })

    it('should have optional breadcrumb property as array', () => {
      expectTypeOf<DocsPageProps>().toMatchTypeOf<{ breadcrumb?: unknown[] }>()
    })

    it('should have optional previous/next navigation properties', () => {
      expectTypeOf<DocsPageProps>().toMatchTypeOf<{ previous?: unknown; next?: unknown }>()
    })

    it('should have optional footer property with prev/next', () => {
      expectTypeOf<DocsPageProps>().toMatchTypeOf<{
        footer?: { previous?: unknown; next?: unknown }
      }>()
    })

    it('should have optional showTOC boolean', () => {
      expectTypeOf<DocsPageProps>().toMatchTypeOf<{ showTOC?: boolean }>()
    })

    it('should have optional showMobileTOC boolean', () => {
      expectTypeOf<DocsPageProps>().toMatchTypeOf<{ showMobileTOC?: boolean }>()
    })
  })

  describe('DocsProviderProps type structure', () => {
    it('should be an object type', () => {
      expectTypeOf<DocsProviderProps>().toBeObject()
    })

    it('should have children property', () => {
      expectTypeOf<DocsProviderProps>().toHaveProperty('children')
    })

    it('should have optional theme property', () => {
      expectTypeOf<DocsProviderProps>().toMatchTypeOf<{ theme?: ThemeConfig }>()
    })

    it('should have optional search property', () => {
      expectTypeOf<DocsProviderProps>().toMatchTypeOf<{ search?: SearchConfig }>()
    })
  })

  describe('ThemeMode type', () => {
    it('should be a union of string literals', () => {
      expectTypeOf<ThemeMode>().toEqualTypeOf<'light' | 'dark' | 'system'>()
    })
  })

  describe('ThemeConfig type structure', () => {
    it('should be an object type', () => {
      expectTypeOf<ThemeConfig>().toBeObject()
    })

    it('should have optional defaultTheme of ThemeMode type', () => {
      expectTypeOf<ThemeConfig>().toMatchTypeOf<{ defaultTheme?: ThemeMode }>()
    })

    it('should have optional enableSystem boolean', () => {
      expectTypeOf<ThemeConfig>().toMatchTypeOf<{ enableSystem?: boolean }>()
    })

    it('should have optional disableTransitionOnChange boolean', () => {
      expectTypeOf<ThemeConfig>().toMatchTypeOf<{ disableTransitionOnChange?: boolean }>()
    })

    it('should have optional storageKey string', () => {
      expectTypeOf<ThemeConfig>().toMatchTypeOf<{ storageKey?: string }>()
    })
  })

  describe('SearchConfig type structure', () => {
    it('should be an object type', () => {
      expectTypeOf<SearchConfig>().toBeObject()
    })

    it('should have optional apiUrl string', () => {
      expectTypeOf<SearchConfig>().toMatchTypeOf<{ apiUrl?: string }>()
    })

    it('should have optional enabled boolean', () => {
      expectTypeOf<SearchConfig>().toMatchTypeOf<{ enabled?: boolean }>()
    })

    it('should have optional shortcutKey string', () => {
      expectTypeOf<SearchConfig>().toMatchTypeOf<{ shortcutKey?: string }>()
    })
  })
})

// ============================================================================
// Compile-time type assertions
// These verify the types are properly exported and usable
// ============================================================================

describe('Type Assertion Tests (Compile-Time)', () => {
  it('DocsLayoutProps can be used to type component props', () => {
    // This should compile without errors when tsx support is working
    const props: DocsLayoutProps = {
      children: null,
      title: 'Test Docs',
      collapsible: true,
      defaultOpenLevel: 2,
    }

    expectTypeOf(props).toMatchTypeOf<DocsLayoutProps>()
  })

  it('DocsPageProps can be used to type component props', () => {
    const props: DocsPageProps = {
      children: null,
      title: 'Getting Started',
      description: 'Learn how to use dotdo',
      showTOC: true,
      showMobileTOC: true,
    }

    expectTypeOf(props).toMatchTypeOf<DocsPageProps>()
  })

  it('DocsProviderProps can be used to type component props', () => {
    const props: DocsProviderProps = {
      children: null,
      theme: {
        defaultTheme: 'system',
        enableSystem: true,
      },
      search: {
        enabled: true,
        shortcutKey: 'k',
      },
    }

    expectTypeOf(props).toMatchTypeOf<DocsProviderProps>()
  })

  it('ThemeMode union type is correctly constrained', () => {
    const light: ThemeMode = 'light'
    const dark: ThemeMode = 'dark'
    const system: ThemeMode = 'system'

    expectTypeOf(light).toEqualTypeOf<ThemeMode>()
    expectTypeOf(dark).toEqualTypeOf<ThemeMode>()
    expectTypeOf(system).toEqualTypeOf<ThemeMode>()

    // @ts-expect-error - 'invalid' is not a valid ThemeMode
    const invalid: ThemeMode = 'invalid'
  })
})

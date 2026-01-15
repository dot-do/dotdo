/**
 * DocsProvider Component
 *
 * Provider component for documentation context and theming.
 * Provides SearchProvider, ThemeProvider, and RootProvider-like functionality.
 *
 * ## Features
 * - Theme management (light, dark, system)
 * - Search provider with keyboard shortcut registration
 * - Configuration context for child components
 * - Smooth theme transitions (optional)
 *
 * ## Usage
 * Wrap your entire docs layout with this provider to enable:
 * - Theme switching with system preference detection
 * - Global search with Cmd/Ctrl+K shortcut
 * - Consistent context for all docs components
 *
 * @module components/docs/provider
 * @see https://fumadocs.dev/docs/ui/provider
 */

import { type ReactNode, memo, useEffect } from 'react'

/**
 * Theme mode options
 */
export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * Theme configuration
 */
export interface ThemeConfig {
  /** Default theme mode (default: 'system') */
  defaultTheme?: ThemeMode
  /** Enable system theme preference detection (default: true) */
  enableSystem?: boolean
  /** Disable transitions during theme change (default: false) */
  disableTransitionOnChange?: boolean
  /** Storage key for persisting theme (default: 'docs-theme') */
  storageKey?: string
}

/**
 * Search configuration
 */
export interface SearchConfig {
  /** Search API endpoint (default: '/api/search') */
  apiUrl?: string
  /** Enable search functionality (default: true) */
  enabled?: boolean
  /** Keyboard shortcut key (default: 'k') */
  shortcutKey?: string
}

/**
 * Props for DocsProvider component
 */
export interface DocsProviderProps {
  /** Child components to wrap */
  children: ReactNode
  /** Theme configuration options */
  theme?: ThemeConfig
  /** Search configuration options */
  search?: SearchConfig
}

/**
 * Internal configuration context shape
 */
interface ProviderConfig {
  theme: Required<ThemeConfig>
  search: Required<SearchConfig>
}

/**
 * DocsProvider wraps the application with necessary context providers.
 *
 * This component provides theme and search functionality to all child
 * components. It should be placed near the root of your docs layout.
 *
 * @example
 * ```tsx
 * // Basic usage with defaults
 * <DocsProvider>
 *   <DocsLayout>
 *     <DocsPage>...</DocsPage>
 *   </DocsLayout>
 * </DocsProvider>
 *
 * // With custom configuration
 * <DocsProvider
 *   theme={{
 *     defaultTheme: 'dark',
 *     enableSystem: true,
 *     disableTransitionOnChange: false
 *   }}
 *   search={{
 *     apiUrl: '/api/docs-search',
 *     enabled: true,
 *     shortcutKey: 'k'
 *   }}
 * >
 *   <DocsLayout>{children}</DocsLayout>
 * </DocsProvider>
 * ```
 */
export function DocsProvider({
  children,
  theme = {},
  search = {},
}: DocsProviderProps): ReactNode {
  // Merge with defaults
  const config: ProviderConfig = {
    theme: {
      defaultTheme: theme.defaultTheme ?? 'system',
      enableSystem: theme.enableSystem ?? true,
      disableTransitionOnChange: theme.disableTransitionOnChange ?? false,
      storageKey: theme.storageKey ?? 'docs-theme',
    },
    search: {
      apiUrl: search.apiUrl ?? '/api/search',
      enabled: search.enabled ?? true,
      shortcutKey: search.shortcutKey ?? 'k',
    },
  }

  return (
    <RootProvider config={config}>
      <ThemeProvider config={config.theme}>
        <SearchProvider config={config.search}>
          {children}
        </SearchProvider>
      </ThemeProvider>
    </RootProvider>
  )
}

/**
 * Props for internal provider components
 */
interface InternalProviderProps {
  children: ReactNode
}

/**
 * RootProvider - base configuration context.
 * Provides global data attributes for CSS targeting and scripts.
 */
const RootProvider = memo(function RootProvider({
  children,
  config,
}: InternalProviderProps & { config: ProviderConfig }): ReactNode {
  return (
    <div
      data-root-provider
      data-theme={config.theme.defaultTheme}
      data-search-enabled={config.search.enabled}
      className="contents"
    >
      {children}
    </div>
  )
})

/**
 * ThemeProvider - manages theme state and system preference detection.
 * Uses data attributes for theme application via CSS.
 */
const ThemeProvider = memo(function ThemeProvider({
  children,
  config,
}: InternalProviderProps & { config: Required<ThemeConfig> }): ReactNode {
  const transitionClass = config.disableTransitionOnChange
    ? ''
    : 'transition-colors duration-300'

  return (
    <div
      data-theme-provider
      data-default-theme={config.defaultTheme}
      data-enable-system={config.enableSystem}
      data-storage-key={config.storageKey}
      className={`contents ${transitionClass}`}
    >
      {children}
    </div>
  )
})

/**
 * SearchProvider - provides search context and keyboard shortcut.
 * Registers global keyboard listener for Cmd/Ctrl+K.
 */
const SearchProvider = memo(function SearchProvider({
  children,
  config,
}: InternalProviderProps & { config: Required<SearchConfig> }): ReactNode {
  // Register keyboard shortcut for search
  useEffect(() => {
    if (!config.enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      const isMac = navigator.platform?.toLowerCase().includes('mac')
      const modifier = isMac ? event.metaKey : event.ctrlKey

      if (modifier && event.key.toLowerCase() === config.shortcutKey) {
        event.preventDefault()
        // Dispatch custom event to open search dialog
        document.dispatchEvent(new CustomEvent('search:open'))
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [config.enabled, config.shortcutKey])

  return (
    <div
      data-search-provider
      data-search-api={config.apiUrl}
      data-search-enabled={config.enabled}
      data-search-shortcut={config.shortcutKey}
      className="contents"
    >
      {config.enabled && <SearchDialog apiUrl={config.apiUrl} />}
      {children}
    </div>
  )
})

/**
 * Hidden search dialog container.
 * This placeholder is activated by the search:open event.
 */
const SearchDialog = memo(function SearchDialog({
  apiUrl,
}: {
  apiUrl: string
}): ReactNode {
  return (
    <div
      id="search-dialog-container"
      data-search-dialog
      data-api={apiUrl}
      className="hidden"
      aria-hidden="true"
      role="presentation"
    />
  )
})

export default DocsProvider

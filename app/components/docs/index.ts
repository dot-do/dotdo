/**
 * Docs Components Barrel Export
 *
 * Re-exports all documentation layout components for convenient importing.
 * Provides a unified API for building documentation pages with fumadocs-ui.
 *
 * ## Component Categories
 *
 * ### Layout Components
 * - `DocsLayout` - Main wrapper for documentation pages
 * - `DocsPage` - Individual page content wrapper
 * - `DocsProvider` - Theme and search context provider
 *
 * ### Navigation Components
 * - `Sidebar` / `SidebarTrigger` - Sidebar navigation
 * - `Breadcrumb` - Path-based navigation trail
 * - `PageNavigation` - Previous/next page links
 *
 * ### Content Components
 * - `TableOfContents` - In-page heading navigation
 * - `Search` - Documentation search interface
 *
 * ### MDX Components
 * - `mdxComponents` - Custom MDX component overrides
 * - `Callout` - Admonition/callout component
 *
 * @module components/docs
 *
 * @example
 * ```tsx
 * import {
 *   DocsLayout,
 *   DocsPage,
 *   DocsProvider,
 *   Sidebar,
 *   Search,
 *   mdxComponents
 * } from '@/components/docs'
 *
 * export function DocsRoot({ children }) {
 *   return (
 *     <DocsProvider>
 *       <DocsLayout>
 *         <DocsPage>{children}</DocsPage>
 *       </DocsLayout>
 *     </DocsProvider>
 *   )
 * }
 * ```
 */

// Layout components
export { DocsLayout, type DocsLayoutProps } from './layout'
export { DocsPage, type DocsPageProps } from './page'
export {
  DocsProvider,
  type DocsProviderProps,
  type ThemeConfig,
  type SearchConfig,
  type ThemeMode,
} from './provider'

// Navigation components
export {
  Sidebar,
  SidebarTrigger,
  type SidebarProps,
  type SidebarTriggerProps,
} from './sidebar'
export {
  Breadcrumb,
  PageBreadcrumb,
  type BreadcrumbProps,
  type BreadcrumbItem,
} from './breadcrumb'
export {
  PageNavigation,
  PageNav,
  Footer,
  PageFooter,
  type PageNavigationProps,
  type NavLink,
} from './page-nav'

// Content components
export {
  TableOfContents,
  TOC,
  PageTOC,
  type TableOfContentsProps,
} from './toc'
export {
  Search,
  SearchBar,
  SearchToggle,
  SearchDialog,
  type SearchProps,
  type SearchToggleProps,
  type SearchDialogProps,
} from './search'

// MDX components
export {
  mdxComponents,
  useMDXComponents,
  Callout,
  components,
  type CalloutProps,
  type CalloutType,
} from './mdx-components'

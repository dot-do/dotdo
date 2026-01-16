/**
 * DocsLayout Component
 *
 * Main layout wrapper for documentation pages using fumadocs-ui.
 * Provides sidebar navigation, responsive design, and consistent structure.
 *
 * ## Features
 * - Responsive sidebar navigation from page tree
 * - Mobile-first design with SidebarTrigger toggle
 * - Configurable navigation links in header
 * - Theme support via fumadocs-ui (dark/light mode)
 * - Keyboard navigation support (Tab, Enter, Escape)
 *
 * ## Accessibility
 * - Semantic landmark regions (nav, main, aside)
 * - ARIA labels for navigation elements
 * - Focus management for interactive elements
 * - Screen reader friendly structure
 *
 * @module components/docs/layout
 * @see https://fumadocs.dev/docs/ui/layouts/docs
 */

import type { ReactNode } from 'react'
import type { PageTree } from 'fumadocs-core/server'
import { DocsLayout as FumaDocsLayout } from 'fumadocs-ui/layouts/docs'
import { source } from '../../lib/source'
import { navLinks } from '../../lib/nav-config'

/**
 * Props for DocsLayout component
 */
export interface DocsLayoutProps {
  /** Child content to render within the layout */
  children: ReactNode
  /** Optional page tree override for custom navigation structure */
  tree?: PageTree.Root
  /** Optional custom title for the documentation site */
  title?: string
  /** Whether the sidebar is collapsible (default: true) */
  collapsible?: boolean
  /** Default level for expanded sidebar items (default: 1) */
  defaultOpenLevel?: number
}

/**
 * DocsLayout wraps documentation pages with navigation and structure.
 *
 * This is the main layout component for all documentation pages. It provides:
 * - A sidebar with collapsible navigation tree
 * - A responsive header with site title and links
 * - Mobile-friendly toggle for sidebar visibility
 *
 * @example
 * ```tsx
 * // Basic usage
 * <DocsLayout>
 *   <DocsPage title="Getting Started">
 *     <p>Welcome to the docs!</p>
 *   </DocsPage>
 * </DocsLayout>
 *
 * // With custom tree and options
 * <DocsLayout
 *   tree={customTree}
 *   title="My Docs"
 *   collapsible={true}
 *   defaultOpenLevel={2}
 * >
 *   <DocsPage>{content}</DocsPage>
 * </DocsLayout>
 * ```
 */
export function DocsLayout({
  children,
  tree,
  title = 'dotdo',
  collapsible = true,
  defaultOpenLevel = 1,
}: DocsLayoutProps): ReactNode {
  const pageTree = tree ?? source.pageTree

  return (
    <FumaDocsLayout
      tree={pageTree}
      links={navLinks.map(link => ({
        type: 'main' as const,
        text: link.text,
        url: link.url,
        external: link.external,
      }))}
      nav={{
        title,
      }}
      sidebar={{
        collapsible,
        defaultOpenLevel,
      }}
      // Responsive grid layout:
      // - sm: Single column (sidebar hidden via SidebarTrigger)
      // - md: Sidebar 240px, content 1fr
      // - lg: Sidebar 280px, content 1fr (more breathing room)
      containerProps={{
        className: "md:grid-cols-[240px_1fr] lg:grid-cols-[280px_1fr]",
      }}
    >
      {children}
    </FumaDocsLayout>
  )
}

export default DocsLayout

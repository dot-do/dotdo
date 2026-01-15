/**
 * DocsPage Component
 *
 * Main content wrapper for documentation pages.
 * Uses fumadocs-ui/page components for structure.
 *
 * ## Features
 * - Page title and description with proper heading hierarchy
 * - Table of contents (desktop sidebar + mobile popover)
 * - Breadcrumb navigation with structured data
 * - Previous/next page navigation
 * - Responsive layout with appropriate spacing
 *
 * ## Accessibility
 * - Semantic main landmark
 * - Proper heading structure (h1 for title)
 * - Skip links compatible layout
 * - Focus management for navigation
 *
 * @module components/docs/page
 * @see https://fumadocs.dev/docs/ui/components/page
 */

import { type ReactNode, memo } from 'react'
import type { TOCItemType } from 'fumadocs-core/toc'
import { DocsBody, DocsTitle, DocsDescription } from 'fumadocs-ui/page'
import { TableOfContents } from './toc'
import { Breadcrumb, type BreadcrumbItem } from './breadcrumb'
import { PageNavigation, type NavLink } from './page-nav'

/**
 * Props for DocsPage component
 */
export interface DocsPageProps {
  /** Page title (renders as h1) */
  title?: string
  /** Page description (renders below title) */
  description?: string
  /** Table of contents items for navigation */
  toc?: TOCItemType[]
  /** Breadcrumb navigation items */
  breadcrumb?: BreadcrumbItem[]
  /** Previous page navigation link */
  previous?: NavLink | null
  /** Next page navigation link */
  next?: NavLink | null
  /** Footer navigation (alias for prev/next) */
  footer?: {
    previous?: NavLink | null
    next?: NavLink | null
  }
  /** Whether to show TOC on desktop (default: true if items exist) */
  showTOC?: boolean
  /** Whether to show TOC popover on mobile (default: true if items exist) */
  showMobileTOC?: boolean
  /** Whether to include breadcrumb structured data (default: true) */
  includeBreadcrumbSchema?: boolean
  /** Child content (MDX body) */
  children: ReactNode
}

/**
 * DocsPage wraps documentation content with title, TOC, and navigation.
 *
 * This is the main component for rendering individual documentation pages.
 * It provides a consistent structure with optional features like breadcrumbs,
 * table of contents, and previous/next navigation.
 *
 * @example
 * ```tsx
 * // Full featured page
 * <DocsPage
 *   title="Getting Started"
 *   description="Learn how to use dotdo"
 *   toc={tableOfContents}
 *   breadcrumb={[
 *     { name: 'Home', href: '/docs' },
 *     { name: 'Getting Started', href: '/docs/getting-started' }
 *   ]}
 *   previous={{ title: 'Introduction', url: '/docs/intro' }}
 *   next={{ title: 'Configuration', url: '/docs/config' }}
 * >
 *   <MDXContent />
 * </DocsPage>
 *
 * // Simple page without extras
 * <DocsPage title="API Reference">
 *   <p>API documentation content...</p>
 * </DocsPage>
 * ```
 */
export function DocsPage({
  title,
  description,
  toc = [],
  breadcrumb = [],
  previous,
  next,
  footer,
  showTOC = true,
  showMobileTOC = true,
  includeBreadcrumbSchema = true,
  children,
}: DocsPageProps): ReactNode {
  // Support both direct props and footer object for prev/next
  const prevLink = previous ?? footer?.previous
  const nextLink = next ?? footer?.next

  // Determine if TOC should be shown
  const hasTOC = toc.length > 0
  const shouldShowDesktopTOC = showTOC && hasTOC
  const shouldShowMobileTOC = showMobileTOC && hasTOC

  return (
    <div className="flex gap-8 lg:gap-12">
      {/* Main content area */}
      <main
        className="flex-1 min-w-0 max-w-3xl"
        id="main-content"
        role="main"
      >
        {/* Breadcrumb navigation */}
        {breadcrumb.length > 0 && (
          <Breadcrumb
            items={breadcrumb}
            includeStructuredData={includeBreadcrumbSchema}
          />
        )}

        {/* Page header section */}
        <header className="mb-8">
          {title && (
            <DocsTitle className="text-3xl sm:text-4xl font-bold tracking-tight">
              {title}
            </DocsTitle>
          )}
          {description && (
            <DocsDescription className="mt-3 text-lg text-muted-foreground">
              {description}
            </DocsDescription>
          )}
        </header>

        {/* Mobile TOC (popover mode) - shows on small screens */}
        {shouldShowMobileTOC && (
          <TableOfContents
            items={toc}
            popover
            title="On this page"
          />
        )}

        {/* Page body content */}
        <DocsBody className="prose prose-slate dark:prose-invert max-w-none">
          {children}
        </DocsBody>

        {/* Footer navigation (prev/next) */}
        <PageNavigation previous={prevLink} next={nextLink} />
      </main>

      {/* Desktop TOC sidebar - hidden on mobile, shown on large screens */}
      {shouldShowDesktopTOC && (
        <TableOfContents
          items={toc}
          title="On this page"
        />
      )}
    </div>
  )
}

export default DocsPage

/**
 * Breadcrumb Navigation Component
 *
 * Renders breadcrumb navigation for documentation pages.
 * Supports JSON-LD structured data for SEO.
 *
 * ## Features
 * - Automatic Home link prepending
 * - Path-based navigation trail
 * - JSON-LD BreadcrumbList schema for SEO
 * - Configurable base URL for structured data
 *
 * ## Accessibility
 * - Semantic nav landmark with aria-label
 * - Ordered list for proper screen reader navigation
 * - Current page marked with aria-current
 * - Visual separators hidden from assistive technology
 *
 * @module components/docs/breadcrumb
 * @see https://fumadocs.dev/docs/ui/components/breadcrumb
 * @see https://schema.org/BreadcrumbList
 */

import { type ReactNode, memo } from 'react'

/**
 * Breadcrumb item structure
 */
export interface BreadcrumbItem {
  /** Display name for the breadcrumb */
  name: string
  /** URL path for the breadcrumb link */
  href: string
}

/**
 * Props for Breadcrumb component
 */
export interface BreadcrumbProps {
  /** Array of breadcrumb items from root to current page */
  items: BreadcrumbItem[]
  /** Include JSON-LD structured data for SEO (default: true) */
  includeStructuredData?: boolean
  /** Base URL for structured data (default: https://dotdo.dev) */
  baseUrl?: string
  /** Custom separator element (default: /) */
  separator?: ReactNode
}

/**
 * Breadcrumb renders navigation path for documentation pages.
 *
 * This component displays a trail of links showing the user's current
 * location in the documentation hierarchy. It automatically ensures
 * the Home link is first and includes SEO-friendly structured data.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Breadcrumb items={[
 *   { name: 'Home', href: '/docs' },
 *   { name: 'Guide', href: '/docs/guide' },
 *   { name: 'Installation', href: '/docs/guide/installation' }
 * ]} />
 *
 * // Without structured data
 * <Breadcrumb items={breadcrumbs} includeStructuredData={false} />
 *
 * // Custom base URL and separator
 * <Breadcrumb
 *   items={breadcrumbs}
 *   baseUrl="https://example.com"
 *   separator={<ChevronRight />}
 * />
 * ```
 */
export const Breadcrumb = memo(function Breadcrumb({
  items,
  includeStructuredData = true,
  baseUrl = 'https://dotdo.dev',
  separator,
}: BreadcrumbProps): ReactNode {
  // Early return for empty items
  if (items.length === 0) return null

  // Ensure Home is always the root breadcrumb
  const breadcrumbItems = items[0]?.name === 'Home' || items[0]?.name === 'Docs'
    ? items
    : [{ name: 'Home', href: '/docs' }, ...items]

  // Generate JSON-LD structured data for BreadcrumbList schema
  const jsonLd = includeStructuredData
    ? generateBreadcrumbJsonLd(breadcrumbItems, baseUrl)
    : null

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <nav aria-label="Breadcrumb navigation" className="mb-4">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {breadcrumbItems.map((item, index) => {
            const isLast = index === breadcrumbItems.length - 1

            return (
              <li key={item.href} className="flex items-center gap-1.5">
                {/* Separator (hidden from screen readers) */}
                {index > 0 && (
                  <span aria-hidden="true" className="text-muted-foreground/40 select-none">
                    {separator ?? <BreadcrumbSeparator />}
                  </span>
                )}

                {/* Current page (not a link) or navigable link */}
                {isLast ? (
                  <span
                    className="text-foreground font-medium truncate max-w-[200px]"
                    aria-current="page"
                  >
                    {item.name}
                  </span>
                ) : (
                  <a
                    href={item.href}
                    className="hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded px-0.5"
                  >
                    {item.name}
                  </a>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
    </>
  )
})

/**
 * Default breadcrumb separator component
 */
function BreadcrumbSeparator(): ReactNode {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5l7 7-7 7"
      />
    </svg>
  )
}

/**
 * JSON-LD BreadcrumbList structured data interface
 * @see https://schema.org/BreadcrumbList
 */
interface BreadcrumbJsonLd {
  '@context': 'https://schema.org'
  '@type': 'BreadcrumbList'
  itemListElement: Array<{
    '@type': 'ListItem'
    position: number
    name: string
    item: string
  }>
}

/**
 * Generate JSON-LD structured data for BreadcrumbList.
 *
 * This improves SEO by providing search engines with clear
 * hierarchical navigation information for the page.
 *
 * @param items - Array of breadcrumb items
 * @param baseUrl - Base URL for absolute URLs in structured data
 * @returns JSON-LD object conforming to BreadcrumbList schema
 * @see https://schema.org/BreadcrumbList
 */
function generateBreadcrumbJsonLd(items: BreadcrumbItem[], baseUrl: string): BreadcrumbJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${baseUrl}${item.href}`,
    })),
  }
}

// Named export for flexibility
export { Breadcrumb as PageBreadcrumb }
export default Breadcrumb

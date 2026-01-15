/**
 * Table of Contents Component
 *
 * Renders a table of contents for documentation pages.
 * Uses fumadocs-core/toc for heading extraction.
 *
 * ## Features
 * - Hierarchical heading navigation with depth indicators
 * - Desktop sidebar with sticky positioning
 * - Mobile popover for compact view
 * - Active heading tracking via AnchorProvider pattern
 * - Smooth scroll-to-anchor behavior
 *
 * ## Accessibility
 * - Semantic nav landmark with aria-label
 * - Proper heading structure
 * - Keyboard navigable links
 * - Focus indicators on all interactive elements
 *
 * @module components/docs/toc
 * @see https://fumadocs.dev/docs/ui/components/toc
 */

import { type ReactNode, memo } from 'react'
import type { TOCItemType } from 'fumadocs-core/toc'

/**
 * Props for TableOfContents component
 */
export interface TableOfContentsProps {
  /** Array of TOC items with heading data */
  items: TOCItemType[]
  /** Whether to show in popover mode for mobile (default: false) */
  popover?: boolean
  /** Currently active heading URL for highlighting */
  activeUrl?: string
  /** Custom title for the TOC section */
  title?: string
}

/**
 * Props for TOCItems internal component
 */
interface TOCItemsProps {
  /** Array of TOC items to render */
  items: TOCItemType[]
  /** Currently active heading URL */
  activeUrl?: string
}

/**
 * TableOfContents renders page headings for in-page navigation.
 *
 * This component provides a table of contents sidebar that helps users
 * navigate long documentation pages. It supports two display modes:
 * - Desktop: Fixed sidebar on the right
 * - Mobile: Collapsible popover at the top of content
 *
 * @example
 * ```tsx
 * // Desktop sidebar mode (default)
 * <TableOfContents items={pageHeadings} />
 *
 * // Mobile popover mode
 * <TableOfContents items={pageHeadings} popover />
 *
 * // With active heading tracking
 * <TableOfContents
 *   items={pageHeadings}
 *   activeUrl="#current-section"
 *   title="Contents"
 * />
 * ```
 */
export function TableOfContents({
  items,
  popover = false,
  activeUrl,
  title = 'On this page',
}: TableOfContentsProps): ReactNode {
  // Don't render if no items
  if (items.length === 0) return null

  // Mobile popover mode
  if (popover) {
    return <TOCPopover items={items} activeUrl={activeUrl} title={title} />
  }

  // Desktop sidebar mode
  return (
    <aside
      className="hidden lg:block w-[200px] xl:w-[240px] shrink-0"
      role="complementary"
      aria-label="Table of contents"
    >
      <nav className="sticky top-20 p-4 max-h-[calc(100vh-5rem)] overflow-y-auto">
        <h4 className="font-semibold text-sm mb-3 text-foreground">{title}</h4>
        <TOCItems items={items} activeUrl={activeUrl} />
      </nav>
    </aside>
  )
}

/**
 * TOCItems renders the list of heading links.
 * Memoized to prevent re-renders when parent state changes.
 */
const TOCItems = memo(function TOCItems({ items, activeUrl }: TOCItemsProps): ReactNode {
  return (
    <ul className="space-y-2 text-sm" role="list">
      {items.map((item) => {
        const isActive = activeUrl === item.url
        // Calculate indent based on heading depth (h2=0, h3=12px, h4=24px)
        const indent = (item.depth - 2) * 12

        return (
          <li
            key={item.url}
            style={{ paddingLeft: `${indent}px` }}
            className="relative"
          >
            {/* Active indicator line */}
            {isActive && (
              <span
                className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-full"
                aria-hidden="true"
              />
            )}
            <a
              href={item.url}
              className={`
                block py-1 transition-colors rounded
                focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
                ${isActive
                  ? 'text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground'
                }
              `}
              aria-current={isActive ? 'location' : undefined}
            >
              {item.title}
            </a>
          </li>
        )
      })}
    </ul>
  )
})

/**
 * Props for TOCPopover component
 */
interface TOCPopoverProps {
  /** Array of TOC items to render */
  items: TOCItemType[]
  /** Currently active heading URL */
  activeUrl?: string
  /** Title for the popover button */
  title: string
}

/**
 * TOCPopover renders TOC in a collapsible popover for mobile.
 * Uses native details/summary for progressive enhancement.
 */
function TOCPopover({ items, activeUrl, title }: TOCPopoverProps): ReactNode {
  return (
    <div className="lg:hidden mb-6">
      <details className="group border rounded-lg bg-muted/30">
        <summary
          className="flex items-center justify-between gap-2 cursor-pointer p-3 rounded-lg hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`${title} - ${items.length} sections`}
        >
          <div className="flex items-center gap-2">
            <ListIcon />
            <span className="font-medium text-sm">{title}</span>
            <span className="text-xs text-muted-foreground">({items.length})</span>
          </div>
          <ChevronIcon />
        </summary>
        <div className="p-3 pt-0 border-t border-border/50">
          <TOCItems items={items} activeUrl={activeUrl} />
        </div>
      </details>
    </div>
  )
}

/**
 * List icon for TOC popover button
 */
function ListIcon(): ReactNode {
  return (
    <svg
      className="w-4 h-4 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h7"
      />
    </svg>
  )
}

/**
 * Chevron icon for collapsible indicator
 */
function ChevronIcon(): ReactNode {
  return (
    <svg
      className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  )
}

// Named exports for flexibility
export { TableOfContents as TOC, TableOfContents as PageTOC }
export default TableOfContents

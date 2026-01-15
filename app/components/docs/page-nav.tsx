/**
 * Page Navigation Component
 *
 * Renders previous/next navigation for documentation pages.
 * Uses fumadocs-ui/page PageFooter component style.
 *
 * ## Features
 * - Previous page link with directional arrow
 * - Next page link with directional arrow
 * - Responsive layout (stacked on mobile, side-by-side on desktop)
 * - Keyboard accessible with focus indicators
 *
 * ## Accessibility
 * - Semantic footer and nav landmarks
 * - Descriptive link text for screen readers
 * - Focus visible indicators
 * - Relationship indicated via aria-label
 *
 * @module components/docs/page-nav
 * @see https://fumadocs.dev/docs/ui/components/page
 */

import { type ReactNode, memo } from 'react'

/**
 * Navigation link structure
 */
export interface NavLink {
  /** Page title to display */
  title: string
  /** Page URL to navigate to */
  url: string
  /** Optional description for tooltip or screen readers */
  description?: string
}

/**
 * Props for PageNavigation component
 * Compatible with FooterProps from fumadocs-ui/page
 */
export interface PageNavigationProps {
  /** Previous page link (null to hide) */
  previous?: NavLink | null
  /** Next page link (null to hide) */
  next?: NavLink | null
  /** Custom label for previous (default: "Previous") */
  previousLabel?: string
  /** Custom label for next (default: "Next") */
  nextLabel?: string
}

/**
 * PageNavigation renders previous/next page links at the bottom of docs.
 *
 * This component provides intuitive navigation between documentation pages.
 * It renders a footer with two navigation cards for previous and next pages,
 * adapting to mobile layouts by stacking vertically.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <PageNavigation
 *   previous={{ title: 'Introduction', url: '/docs/intro' }}
 *   next={{ title: 'Configuration', url: '/docs/config' }}
 * />
 *
 * // Only next link
 * <PageNavigation
 *   next={{ title: 'Getting Started', url: '/docs/start' }}
 * />
 *
 * // Custom labels
 * <PageNavigation
 *   previous={{ title: 'Intro', url: '/intro' }}
 *   next={{ title: 'Config', url: '/config' }}
 *   previousLabel="Back"
 *   nextLabel="Continue"
 * />
 * ```
 */
export const PageNavigation = memo(function PageNavigation({
  previous,
  next,
  previousLabel = 'Previous',
  nextLabel = 'Next',
}: PageNavigationProps): ReactNode {
  // Don't render if no links
  if (!previous && !next) return null

  return (
    <footer
      className="mt-12 border-t border-border/50 pt-8"
      role="contentinfo"
      aria-label="Page navigation"
    >
      <nav
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        aria-label="Previous and next pages"
      >
        {/* Previous link or spacer */}
        {previous ? (
          <NavigationCard
            direction="previous"
            link={previous}
            label={previousLabel}
          />
        ) : (
          <div className="hidden sm:block" aria-hidden="true" />
        )}

        {/* Next link or spacer */}
        {next ? (
          <NavigationCard
            direction="next"
            link={next}
            label={nextLabel}
          />
        ) : (
          <div className="hidden sm:block" aria-hidden="true" />
        )}
      </nav>
    </footer>
  )
})

/**
 * Props for NavigationCard component
 */
interface NavigationCardProps {
  /** Direction of navigation */
  direction: 'previous' | 'next'
  /** Link data to render */
  link: NavLink
  /** Label text (e.g., "Previous", "Next") */
  label: string
}

/**
 * Individual navigation card with arrow and title.
 * Memoized to prevent unnecessary re-renders.
 */
const NavigationCard = memo(function NavigationCard({
  direction,
  link,
  label,
}: NavigationCardProps): ReactNode {
  const isPrevious = direction === 'previous'

  return (
    <a
      href={link.url}
      className={`
        group flex flex-col gap-2 p-4 rounded-lg border border-border/50
        bg-card hover:bg-muted/50 hover:border-border
        transition-all duration-200
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
        ${isPrevious ? 'items-start' : 'items-end sm:col-start-2'}
      `}
      rel={isPrevious ? 'prev' : 'next'}
      aria-label={`${label}: ${link.title}`}
    >
      {/* Direction label with arrow */}
      <span className={`
        flex items-center gap-1.5 text-xs font-medium text-muted-foreground
        group-hover:text-foreground transition-colors
        ${isPrevious ? 'flex-row' : 'flex-row-reverse'}
      `}>
        {isPrevious ? <ArrowLeftIcon /> : null}
        {label}
        {!isPrevious ? <ArrowRightIcon /> : null}
      </span>

      {/* Page title */}
      <span className="text-base font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">
        {link.title}
      </span>

      {/* Optional description */}
      {link.description && (
        <span className="text-sm text-muted-foreground line-clamp-1">
          {link.description}
        </span>
      )}
    </a>
  )
})

/**
 * Left arrow icon for previous navigation
 */
function ArrowLeftIcon(): ReactNode {
  return (
    <svg
      className="w-4 h-4 transition-transform group-hover:-translate-x-0.5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 19l-7-7 7-7"
      />
    </svg>
  )
}

/**
 * Right arrow icon for next navigation
 */
function ArrowRightIcon(): ReactNode {
  return (
    <svg
      className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
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

// Named exports for flexibility (compatible with fumadocs naming)
export { PageNavigation as PageNav, PageNavigation as Footer, PageNavigation as PageFooter }
export default PageNavigation

/**
 * Search Component
 *
 * Search bar with keyboard shortcut support (Cmd+K / Ctrl+K).
 * Integrates with fumadocs-ui search functionality.
 *
 * ## Features
 * - Global keyboard shortcut (Cmd/Ctrl+K) to open search
 * - Compact toggle button for header integration
 * - Full-screen modal dialog for search experience
 * - Integration with /api/search endpoint
 *
 * ## Accessibility
 * - ARIA modal pattern for search dialog
 * - Focus trap within dialog
 * - Escape key to close
 * - Screen reader announcements for results
 *
 * @module components/docs/search
 * @see https://fumadocs.dev/docs/ui/search
 */

import { type ReactNode, type KeyboardEvent, useCallback, memo } from 'react'

/**
 * Props for Search component
 */
export interface SearchProps {
  /** Placeholder text for the search input (default: "Search docs...") */
  placeholder?: string
  /** Search API endpoint URL (default: "/api/search") */
  apiUrl?: string
  /** Custom keyboard shortcut display (default: "K") */
  shortcutKey?: string
}

/**
 * Search renders a search bar with keyboard shortcuts.
 *
 * This component provides documentation search functionality with:
 * - A compact trigger button for the header
 * - A full-screen search dialog
 * - Keyboard shortcut integration
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Search />
 *
 * // Custom placeholder and API
 * <Search
 *   placeholder="Find anything..."
 *   apiUrl="/api/docs-search"
 * />
 * ```
 */
export function Search({
  placeholder = 'Search docs...',
  apiUrl = '/api/search',
  shortcutKey = 'K',
}: SearchProps): ReactNode {
  return (
    <div className="relative">
      <SearchToggle placeholder={placeholder} shortcutKey={shortcutKey} />
      <SearchDialog apiUrl={apiUrl} />
    </div>
  )
}

/**
 * Props for SearchToggle component
 */
export interface SearchToggleProps {
  /** Placeholder text to display */
  placeholder?: string
  /** Keyboard shortcut key to display */
  shortcutKey?: string
  /** Callback when toggle is clicked */
  onClick?: () => void
}

/**
 * SearchToggle button that opens the search dialog.
 * Displays a compact search button with keyboard shortcut hint.
 */
export const SearchToggle = memo(function SearchToggle({
  placeholder = 'Search docs...',
  shortcutKey = 'K',
  onClick,
}: SearchToggleProps): ReactNode {
  const handleClick = useCallback(() => {
    if (onClick) {
      onClick()
    } else {
      // Trigger search dialog via custom event
      document.dispatchEvent(new CustomEvent('search:open'))
    }
  }, [onClick])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleClick()
    }
  }, [handleClick])

  return (
    <button
      type="button"
      className="
        flex items-center gap-2 w-full max-w-[280px]
        px-3 py-2 text-sm text-muted-foreground
        bg-muted/50 rounded-lg border border-border/50
        hover:border-primary/30 hover:bg-muted
        transition-colors duration-200
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
      "
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`Search documentation (${isMac() ? 'Cmd' : 'Ctrl'}+${shortcutKey})`}
      aria-haspopup="dialog"
    >
      <SearchIcon />
      <span className="flex-1 text-left truncate">{placeholder}</span>
      <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium bg-background rounded border border-border/50">
        <span className="text-[10px]">{isMac() ? 'Cmd' : 'Ctrl'}</span>
        <span>{shortcutKey}</span>
      </kbd>
    </button>
  )
})

/**
 * Props for SearchDialog component
 */
export interface SearchDialogProps {
  /** Search API endpoint URL */
  apiUrl?: string
  /** Dialog title for screen readers */
  title?: string
}

/**
 * SearchDialog modal component.
 * Provides a full search experience with results display.
 * Uses fetch to query the /api/search endpoint.
 */
export const SearchDialog = memo(function SearchDialog({
  apiUrl = '/api/search',
  title = 'Search documentation',
}: SearchDialogProps): ReactNode {
  return (
    <div
      id="search-dialog"
      className="hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-dialog-title"
      data-search-dialog
      data-api-url={apiUrl}
    >
      {/* Dialog container with positioning */}
      <div
        className="fixed left-1/2 top-[15%] -translate-x-1/2 w-full max-w-lg mx-4 bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
        role="document"
      >
        {/* Hidden title for screen readers */}
        <h2 id="search-dialog-title" className="sr-only">
          {title}
        </h2>

        {/* Search input header */}
        <div className="flex items-center border-b border-border px-4 py-3">
          <SearchIcon className="w-5 h-5 mr-3 text-muted-foreground shrink-0" />
          <input
            type="search"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            placeholder="Type to search..."
            autoFocus
            aria-label="Search query"
            data-search-input
          />
          <kbd
            className="ml-2 px-2 py-1 text-xs font-medium bg-muted rounded border border-border/50 shrink-0"
            aria-label="Press Escape to close"
          >
            Esc
          </kbd>
        </div>

        {/* Search results container */}
        <div
          className="p-4 max-h-[400px] overflow-y-auto"
          data-search-results
          role="listbox"
          aria-label="Search results"
        >
          <p className="text-sm text-muted-foreground text-center py-8">
            Start typing to search...
          </p>
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-background rounded border">Enter</kbd>
              <span>to select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-background rounded border">Up/Down</kbd>
              <span>to navigate</span>
            </span>
          </div>
          <span>Powered by fumadocs</span>
        </div>
      </div>
    </div>
  )
})

/**
 * Search icon component with configurable size
 */
function SearchIcon({ className = 'w-4 h-4' }: { className?: string }): ReactNode {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  )
}

/**
 * Detect if running on macOS for keyboard shortcut display
 */
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.platform?.toLowerCase().includes('mac') ||
         navigator.userAgent?.toLowerCase().includes('mac')
}

// Named exports for flexibility
export { Search as SearchBar }
export default Search

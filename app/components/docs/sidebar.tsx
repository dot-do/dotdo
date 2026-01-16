/**
 * Sidebar Navigation Component
 *
 * Renders the documentation sidebar with collapsible navigation.
 * Uses fumadocs-ui sidebar primitives.
 *
 * ## Features
 * - Hierarchical navigation tree rendering
 * - Collapsible sections with smooth transitions
 * - Mobile-friendly toggle trigger
 * - Keyboard navigation (Tab, Enter, Space)
 *
 * ## Accessibility
 * - Semantic list structure for screen readers
 * - ARIA labels on interactive elements
 * - Focus indicators for keyboard navigation
 * - Collapsible regions use aria-expanded
 *
 * @module components/docs/sidebar
 * @see https://fumadocs.dev/docs/ui/components/sidebar
 */

import { type ReactNode, type KeyboardEvent, useCallback, memo } from 'react'
import { type PageTree } from 'fumadocs-core/server'

/**
 * Props for Sidebar component
 */
export interface SidebarProps {
  /** Page tree for navigation rendering */
  tree: PageTree.Root
  /** Whether sidebar is collapsible (default: true) */
  collapsible?: boolean
  /** Default expand level for nested items (default: 1) */
  defaultOpenLevel?: number
  /** Currently active URL for highlighting */
  activeUrl?: string
  /** Accessible label for sidebar navigation */
  'aria-label'?: string
}

/**
 * Props for individual sidebar items
 */
interface SidebarItemProps {
  /** The page tree node to render */
  node: PageTree.Root | PageTree.Folder | PageTree.Item | PageTree.Separator | PageTree.Node
  /** Default expand level for nested items */
  defaultOpenLevel: number
  /** Current nesting level (0-indexed) */
  level?: number
  /** Currently active URL for highlighting */
  activeUrl?: string
}

/**
 * Sidebar renders the documentation navigation tree.
 *
 * This component provides the left sidebar navigation for documentation pages.
 * It supports collapsible folders, keyboard navigation, and responsive behavior.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <Sidebar tree={source.pageTree} collapsible />
 *
 * // With active URL highlighting
 * <Sidebar
 *   tree={source.pageTree}
 *   activeUrl="/docs/getting-started"
 *   defaultOpenLevel={2}
 * />
 * ```
 */
export function Sidebar({
  tree,
  collapsible = true,
  defaultOpenLevel = 1,
  activeUrl,
  'aria-label': ariaLabel = 'Documentation navigation',
}: SidebarProps): ReactNode {
  return (
    <aside
      className="hidden md:block w-[240px] lg:w-[280px] border-r border-border/50 bg-background/50"
      data-collapsible={collapsible}
      role="complementary"
      aria-label={ariaLabel}
    >
      <nav className="sticky top-0 p-4 max-h-screen overflow-y-auto">
        <SidebarPageTree
          node={tree}
          defaultOpenLevel={defaultOpenLevel}
          activeUrl={activeUrl}
        />
      </nav>
    </aside>
  )
}

/**
 * Renders page tree items recursively.
 * Memoized to prevent unnecessary re-renders on navigation.
 */
const SidebarPageTree = memo(function SidebarPageTree({
  node,
  defaultOpenLevel,
  level = 0,
  activeUrl,
}: SidebarItemProps): ReactNode {
  // Handle root node (no type property, unlike Item/Folder/Separator)
  if ('children' in node && !('type' in node)) {
    const rootNode = node as PageTree.Root
    return (
      <ul className="space-y-1" role="tree" aria-label="Page navigation">
        {rootNode.children.map((child, index) => (
          <SidebarPageTree
            key={`root-${index}`}
            node={child}
            defaultOpenLevel={defaultOpenLevel}
            level={level}
            activeUrl={activeUrl}
          />
        ))}
      </ul>
    )
  }

  // Handle folder node (has children and name)
  if ('children' in node && 'name' in node && 'type' in node && (node as PageTree.Folder).type === 'folder') {
    const folder = node as PageTree.Folder
    const isDefaultOpen = level < defaultOpenLevel
    const folderName = typeof folder.name === 'string' ? folder.name : 'folder'
    const folderId = `folder-${level}-${folderName.toLowerCase().replace(/\s+/g, '-')}`

    return (
      <li role="treeitem" aria-expanded={isDefaultOpen}>
        <details open={isDefaultOpen} className="group">
          <summary
            className="flex items-center justify-between font-medium py-2 px-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            id={folderId}
          >
            <span>{folder.name}</span>
            <CollapsibleIcon />
          </summary>
          <ul
            className="ml-3 pl-3 border-l border-border/30 space-y-1 mt-1"
            role="group"
            aria-labelledby={folderId}
            data-collapsible-content
          >
            {folder.children.map((child, index) => (
              <SidebarPageTree
                key={`folder-${index}`}
                node={child}
                defaultOpenLevel={defaultOpenLevel}
                level={level + 1}
                activeUrl={activeUrl}
              />
            ))}
          </ul>
        </details>
      </li>
    )
  }

  // Handle item node (page link)
  const item = node as PageTree.Item
  const isActive = activeUrl === item.url

  return (
    <li role="treeitem">
      <a
        href={item.url}
        className={`
          block py-2 px-2 rounded-md text-sm transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
          ${isActive
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }
        `}
        aria-current={isActive ? 'page' : undefined}
      >
        {item.name}
      </a>
    </li>
  )
})

/**
 * Collapsible icon for folder headers
 */
function CollapsibleIcon(): ReactNode {
  return (
    <svg
      className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
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
 * Props for SidebarTrigger component
 */
export interface SidebarTriggerProps {
  /** Whether sidebar is currently open */
  isOpen?: boolean
  /** Callback when trigger is activated */
  onToggle?: () => void
  /** Accessible label for the button */
  'aria-label'?: string
}

/**
 * SidebarTrigger button for mobile navigation toggle.
 *
 * This button appears on mobile viewports to toggle sidebar visibility.
 * It supports keyboard activation and announces state to screen readers.
 *
 * @example
 * ```tsx
 * const [isOpen, setIsOpen] = useState(false)
 *
 * <SidebarTrigger
 *   isOpen={isOpen}
 *   onToggle={() => setIsOpen(!isOpen)}
 * />
 * ```
 */
export function SidebarTrigger({
  isOpen = false,
  onToggle,
  'aria-label': ariaLabel = 'Toggle navigation menu',
}: SidebarTriggerProps): ReactNode {
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle?.()
    }
  }, [onToggle])

  return (
    <button
      type="button"
      className="md:hidden p-2 rounded-md hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={ariaLabel}
      aria-expanded={isOpen}
      aria-controls="mobile-sidebar"
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      data-sidebar-trigger
    >
      {isOpen ? <CloseIcon /> : <MenuIcon />}
    </button>
  )
}

/**
 * Hamburger menu icon
 */
function MenuIcon(): ReactNode {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  )
}

/**
 * Close icon for open sidebar state
 */
function CloseIcon(): ReactNode {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  )
}

export default Sidebar

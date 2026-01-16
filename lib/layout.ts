/**
 * Layout Helper Functions
 *
 * Utility functions for documentation layout components.
 * Provides helpers for navigation, breadcrumbs, and TOC generation.
 *
 * @module lib/layout
 */

import type { ReactNode } from 'react'
import type { PageTree } from 'fumadocs-core/server'
import type { TOCItemType } from 'fumadocs-core/toc'
import type { NavLink } from '../components/docs/page-nav'
import type { BreadcrumbItem } from '../components/docs/breadcrumb'

/**
 * Convert ReactNode to string for use in navigation titles.
 * Falls back to empty string if conversion isn't possible.
 */
function nodeToString(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (node == null) return ''
  return ''
}

/**
 * Page navigation result with previous and next links
 */
export interface PageNavigation {
  previous: NavLink | null
  next: NavLink | null
}

/**
 * Get previous and next page navigation for a given URL.
 *
 * @param tree - Page tree from fumadocs source
 * @param currentUrl - Current page URL to find neighbors for
 * @returns Object with previous and next page links
 *
 * @example
 * ```ts
 * const { previous, next } = getPageNavigation(source.pageTree, '/docs/guide/setup')
 * // previous: { title: 'Introduction', url: '/docs/guide/intro' }
 * // next: { title: 'Configuration', url: '/docs/guide/config' }
 * ```
 */
export function getPageNavigation(tree: PageTree.Root, currentUrl: string): PageNavigation {
  const flatPages = flattenPageTree(tree)
  const currentIndex = flatPages.findIndex((page) => page.url === currentUrl)

  if (currentIndex === -1) {
    return { previous: null, next: null }
  }

  return {
    previous: currentIndex > 0
      ? { title: nodeToString(flatPages[currentIndex - 1].name), url: flatPages[currentIndex - 1].url }
      : null,
    next: currentIndex < flatPages.length - 1
      ? { title: nodeToString(flatPages[currentIndex + 1].name), url: flatPages[currentIndex + 1].url }
      : null,
  }
}

/**
 * Generate breadcrumb items from a page URL and tree.
 *
 * @param tree - Page tree from fumadocs source
 * @param currentUrl - Current page URL to generate breadcrumbs for
 * @returns Array of breadcrumb items from root to current page
 *
 * @example
 * ```ts
 * const breadcrumbs = getBreadcrumbs(source.pageTree, '/docs/guide/setup')
 * // [
 * //   { name: 'Home', href: '/docs' },
 * //   { name: 'Guide', href: '/docs/guide' },
 * //   { name: 'Setup', href: '/docs/guide/setup' }
 * // ]
 * ```
 */
export function getBreadcrumbs(tree: PageTree.Root, currentUrl: string): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = [{ name: 'Home', href: '/docs' }]

  // Parse URL path segments
  const segments = currentUrl.replace('/docs', '').split('/').filter(Boolean)

  // Build breadcrumb path incrementally
  let currentPath = '/docs'
  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`
    const page = findPageByUrl(tree, currentPath)

    if (page) {
      breadcrumbs.push({
        name: nodeToString(page.name),
        href: currentPath,
      })
    } else {
      // Format segment as title if page not found in tree
      breadcrumbs.push({
        name: formatSegmentTitle(segment),
        href: currentPath,
      })
    }
  }

  return breadcrumbs
}

/**
 * Extract table of contents from markdown/MDX content.
 *
 * @param content - Raw markdown/MDX content string
 * @returns Array of TOC items with heading data
 *
 * @example
 * ```ts
 * const toc = getTOC(`
 * ## Introduction
 * Some content...
 * ### Installation
 * More content...
 * ## Configuration
 * `)
 * // Returns TOC items for h2 and h3 headings
 * ```
 */
export function getTOC(content: string): TOCItemType[] {
  const headings: TOCItemType[] = []

  // Remove frontmatter
  const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, '')

  // Extract h2-h4 headings
  const headingRegex = /^(#{2,4})\s+(.+)$/gm
  let match

  while ((match = headingRegex.exec(contentWithoutFrontmatter)) !== null) {
    const depth = match[1].length as 2 | 3 | 4
    const title = match[2].trim()
    const url = `#${generateSlug(title)}`

    headings.push({ depth, title, url })
  }

  return headings
}

/**
 * Flatten page tree into ordered array of pages
 */
function flattenPageTree(tree: PageTree.Root | PageTree.Folder): PageTree.Item[] {
  const pages: PageTree.Item[] = []

  for (const node of tree.children) {
    if ('url' in node) {
      // It's a page item
      pages.push(node as PageTree.Item)
    } else if ('children' in node) {
      // It's a folder, recurse
      pages.push(...flattenPageTree(node as PageTree.Folder))
    }
  }

  return pages
}

/**
 * Find a page in the tree by its URL
 */
function findPageByUrl(tree: PageTree.Root | PageTree.Folder, url: string): PageTree.Item | null {
  for (const node of tree.children) {
    if ('url' in node && (node as PageTree.Item).url === url) {
      return node as PageTree.Item
    }
    if ('children' in node) {
      const found = findPageByUrl(node as PageTree.Folder, url)
      if (found) return found
    }
  }
  return null
}

/**
 * Format URL segment as readable title
 */
function formatSegmentTitle(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Generate URL-safe slug from heading text
 */
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default {
  getPageNavigation,
  getBreadcrumbs,
  getTOC,
}

/**
 * Documentation Navigation Module
 *
 * Generates navigation structures for documentation:
 * - Sidebar navigation with sections and items
 * - Breadcrumb navigation
 * - Previous/Next page navigation
 * - Table of contents from headings
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, basename, dirname } from 'path'

// Documentation root directory
const DOCS_DIR = join(process.cwd(), 'docs')

/**
 * Navigation item structure
 */
export interface NavItem {
  title: string
  url: string
  order?: number
  items?: NavItem[]
}

/**
 * Navigation section structure
 */
export interface NavSection {
  title: string
  url?: string
  order?: number
  items: NavItem[]
}

/**
 * Full navigation structure
 */
export interface Navigation {
  sections: NavSection[]
}

/**
 * Breadcrumb item
 */
export interface BreadcrumbItem {
  title: string
  url: string
  current?: boolean
}

/**
 * Extract frontmatter from MDX file
 */
function extractFrontmatter(filePath: string): Record<string, any> {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) return {}

    const frontmatter: Record<string, any> = {}
    const lines = match[1].split('\n')
    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim()
        const value = line.slice(colonIndex + 1).trim()
        frontmatter[key] = value
      }
    }
    return frontmatter
  } catch {
    return {}
  }
}

/**
 * Read meta.json for ordering and titles
 */
function readMeta(dir: string): { title?: string; pages?: string[] } {
  const metaPath = join(dir, 'meta.json')
  try {
    if (existsSync(metaPath)) {
      const content = readFileSync(metaPath, 'utf-8')
      return JSON.parse(content)
    }
  } catch {
    // Ignore errors
  }
  return {}
}

/**
 * Convert filename to title (kebab-case to Title Case)
 */
function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.(mdx?|md)$/, '')
    .replace(/^index$/, 'Overview')
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Get all MDX files in a directory
 */
function getMdxFiles(dir: string): string[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(f => /\.(mdx?|md)$/.test(f) && !f.startsWith('_'))
      .sort()
  } catch {
    return []
  }
}

/**
 * Get all subdirectories
 */
function getSubdirs(dir: string): string[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(f => {
        const path = join(dir, f)
        return statSync(path).isDirectory() && !f.startsWith('_') && !f.startsWith('.')
      })
      .sort()
  } catch {
    return []
  }
}

/**
 * Build navigation items for a directory
 */
function buildNavItems(dir: string, baseUrl: string): NavItem[] {
  const items: NavItem[] = []
  const meta = readMeta(dir)
  const files = getMdxFiles(dir)
  const subdirs = getSubdirs(dir)

  // Determine order from meta.pages or alphabetically
  const ordering = meta.pages || [...files.map(f => f.replace(/\.(mdx?|md)$/, '')), ...subdirs]

  for (let i = 0; i < ordering.length; i++) {
    const name = ordering[i]

    // Skip separators
    if (name === '---') continue

    // Check if it's a file
    const mdxFile = files.find(f => f.replace(/\.(mdx?|md)$/, '') === name)
    if (mdxFile) {
      const filePath = join(dir, mdxFile)
      const frontmatter = extractFrontmatter(filePath)
      const isIndex = name === 'index'
      const url = isIndex ? baseUrl : `${baseUrl}/${name}`.replace(/\/+/g, '/')

      if (!isIndex) {
        items.push({
          title: frontmatter.title || filenameToTitle(name),
          url,
          order: i,
        })
      }
    }

    // Check if it's a subdirectory
    if (subdirs.includes(name)) {
      const subdir = join(dir, name)
      const subMeta = readMeta(subdir)
      const indexPath = join(subdir, 'index.mdx')
      const altIndexPath = join(subdir, 'index.md')
      const hasIndex = existsSync(indexPath) || existsSync(altIndexPath)
      const indexFrontmatter = hasIndex
        ? extractFrontmatter(existsSync(indexPath) ? indexPath : altIndexPath)
        : {}

      const url = `${baseUrl}/${name}`.replace(/\/+/g, '/')
      const subItems = buildNavItems(subdir, url)

      items.push({
        title: subMeta.title || indexFrontmatter.title || filenameToTitle(name),
        url: hasIndex ? url : undefined,
        order: i,
        items: subItems.length > 0 ? subItems : undefined,
      } as NavItem)
    }
  }

  return items
}

/**
 * Generate full navigation structure from docs directory
 */
export function generateNavigation(): Navigation {
  const sections: NavSection[] = []
  const meta = readMeta(DOCS_DIR)
  const ordering = meta.pages || []

  // Build sections from ordering
  for (let i = 0; i < ordering.length; i++) {
    const name = ordering[i]

    // Skip separators
    if (name === '---') continue

    // Check if it's the index (root section)
    if (name === 'index') {
      continue
    }

    const subdir = join(DOCS_DIR, name)
    const isDir = existsSync(subdir) && statSync(subdir).isDirectory()

    if (isDir) {
      const subMeta = readMeta(subdir)
      const indexPath = join(subdir, 'index.mdx')
      const altIndexPath = join(subdir, 'index.md')
      const hasIndex = existsSync(indexPath) || existsSync(altIndexPath)
      const indexFrontmatter = hasIndex
        ? extractFrontmatter(existsSync(indexPath) ? indexPath : altIndexPath)
        : {}

      const url = `/docs/${name}`
      const items = buildNavItems(subdir, url)

      sections.push({
        title: subMeta.title || indexFrontmatter.title || filenameToTitle(name),
        url: hasIndex ? url : undefined,
        order: i,
        items,
      })
    } else {
      // It's a file at the root level
      const filePath = join(DOCS_DIR, `${name}.mdx`)
      const altFilePath = join(DOCS_DIR, `${name}.md`)
      if (existsSync(filePath) || existsSync(altFilePath)) {
        const frontmatter = extractFrontmatter(existsSync(filePath) ? filePath : altFilePath)
        sections.push({
          title: frontmatter.title || filenameToTitle(name),
          url: `/docs/${name}`,
          order: i,
          items: [],
        })
      }
    }
  }

  return { sections }
}

/**
 * Generate breadcrumbs for a given path
 */
export function generateBreadcrumbs(path: string): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = []

  // Always start with docs home
  breadcrumbs.push({
    title: 'Docs',
    url: '/docs/',
  })

  // Parse path segments
  const segments = path
    .replace(/^\/docs\/?/, '')
    .split('/')
    .filter(Boolean)

  let currentUrl = '/docs'
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    currentUrl = `${currentUrl}/${segment}`
    const isLast = i === segments.length - 1

    // Try to get title from file or meta
    const dirPath = join(DOCS_DIR, ...segments.slice(0, i + 1))
    const filePath = join(DOCS_DIR, ...segments.slice(0, i), `${segment}.mdx`)
    const altFilePath = join(DOCS_DIR, ...segments.slice(0, i), `${segment}.md`)

    let title = filenameToTitle(segment)

    if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
      const meta = readMeta(dirPath)
      const indexPath = join(dirPath, 'index.mdx')
      const altIndexPath = join(dirPath, 'index.md')
      if (meta.title) {
        title = meta.title
      } else if (existsSync(indexPath)) {
        const fm = extractFrontmatter(indexPath)
        if (fm.title) title = fm.title
      } else if (existsSync(altIndexPath)) {
        const fm = extractFrontmatter(altIndexPath)
        if (fm.title) title = fm.title
      }
    } else if (existsSync(filePath)) {
      const fm = extractFrontmatter(filePath)
      if (fm.title) title = fm.title
    } else if (existsSync(altFilePath)) {
      const fm = extractFrontmatter(altFilePath)
      if (fm.title) title = fm.title
    }

    breadcrumbs.push({
      title,
      url: currentUrl,
      current: isLast,
    })
  }

  return breadcrumbs
}

/**
 * Get previous and next page navigation
 */
export function getPrevNextNavigation(
  currentPath: string
): { prev?: NavItem; next?: NavItem } {
  const nav = generateNavigation()
  const allPages: NavItem[] = []

  // Flatten navigation
  function flatten(items: NavItem[]) {
    for (const item of items) {
      if (item.url) {
        allPages.push(item)
      }
      if (item.items) {
        flatten(item.items)
      }
    }
  }

  for (const section of nav.sections) {
    if (section.url) {
      allPages.push({ title: section.title, url: section.url })
    }
    flatten(section.items)
  }

  // Normalize current path
  const normalizedPath = currentPath.replace(/\/$/, '').replace(/^\/docs/, '/docs')

  // Find current index
  const currentIndex = allPages.findIndex(
    p => p.url === normalizedPath || p.url === normalizedPath + '/'
  )

  if (currentIndex === -1) {
    return {}
  }

  return {
    prev: currentIndex > 0 ? allPages[currentIndex - 1] : undefined,
    next: currentIndex < allPages.length - 1 ? allPages[currentIndex + 1] : undefined,
  }
}

/**
 * Table of contents item
 */
export interface TocItem {
  title: string
  url: string
  level: number
  children?: TocItem[]
}

/**
 * Generate table of contents from page content
 */
export function generateToc(content: string): TocItem[] {
  const headingRegex = /^(#{2,6})\s+(.+)$/gm
  const items: TocItem[] = []

  let match
  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length
    const title = match[2].trim()
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')

    items.push({
      title,
      url: `#${slug}`,
      level,
    })
  }

  return items
}

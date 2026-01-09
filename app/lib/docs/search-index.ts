/**
 * Search Index Module
 *
 * Generates and provides search index for documentation:
 * - Indexes all documentation pages
 * - Extracts titles, content, and headings
 * - Filters out draft content
 * - Includes metadata for rich results
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Documentation root directory
const DOCS_DIR = join(process.cwd(), 'docs')

/**
 * Search document structure
 */
export interface SearchDocument {
  id: string
  title: string
  url: string
  content: string
  description?: string
  headings?: string[]
  tags?: string[]
}

/**
 * Search index structure
 */
export interface SearchIndex {
  documents: SearchDocument[]
  version: string
  generatedAt: string
}

/**
 * Extract frontmatter from MDX file
 */
function extractFrontmatter(content: string): Record<string, any> {
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
}

/**
 * Extract main content without frontmatter and code blocks
 */
function extractContent(rawContent: string): string {
  // Remove frontmatter
  let content = rawContent.replace(/^---\n[\s\S]*?\n---\n?/, '')

  // Remove code blocks
  content = content.replace(/```[\s\S]*?```/g, '')
  content = content.replace(/`[^`]+`/g, '')

  // Remove JSX/component tags
  content = content.replace(/<[^>]+>/g, '')

  // Remove markdown formatting
  content = content.replace(/[#*_~\[\]]/g, '')

  // Remove multiple spaces and newlines
  content = content.replace(/\s+/g, ' ').trim()

  return content
}

/**
 * Extract headings from markdown content
 */
function extractHeadings(content: string): string[] {
  const headingRegex = /^#{1,6}\s+(.+)$/gm
  const headings: string[] = []

  let match
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[1].trim())
  }

  return headings
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
 * Get all MDX files recursively
 */
function getAllMdxFiles(dir: string, basePath: string = ''): Array<{ path: string; url: string }> {
  const files: Array<{ path: string; url: string }> = []

  try {
    if (!existsSync(dir)) return files

    const entries = readdirSync(dir)

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.startsWith('.') || entry.startsWith('_')) continue

      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        // Recurse into subdirectory
        const subPath = basePath ? `${basePath}/${entry}` : entry
        files.push(...getAllMdxFiles(fullPath, subPath))
      } else if (/\.(mdx?|md)$/.test(entry)) {
        // Process MDX file
        const isIndex = entry === 'index.mdx' || entry === 'index.md'
        const slug = entry.replace(/\.(mdx?|md)$/, '')
        const url = isIndex
          ? basePath ? `/docs/${basePath}` : '/docs'
          : basePath ? `/docs/${basePath}/${slug}` : `/docs/${slug}`

        files.push({ path: fullPath, url })
      }
    }
  } catch {
    // Ignore errors
  }

  return files
}

/**
 * Index a single MDX file
 */
function indexFile(filePath: string, url: string): SearchDocument | null {
  try {
    const rawContent = readFileSync(filePath, 'utf-8')
    const frontmatter = extractFrontmatter(rawContent)

    // Skip draft content
    if (frontmatter.draft === 'true' || frontmatter.draft === true) {
      return null
    }

    // Skip content with "draft" in title
    if (frontmatter.title?.toLowerCase().includes('draft')) {
      return null
    }

    const content = extractContent(rawContent)
    const headings = extractHeadings(rawContent)
    const filename = filePath.split('/').pop() || ''

    return {
      id: url,
      title: frontmatter.title || filenameToTitle(filename),
      url,
      content,
      description: frontmatter.description,
      headings: headings.length > 0 ? headings : undefined,
      tags: frontmatter.tags ? frontmatter.tags.split(',').map((t: string) => t.trim()) : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Generate search index from docs directory
 */
export function generateSearchIndex(): SearchIndex {
  const files = getAllMdxFiles(DOCS_DIR)
  const documents: SearchDocument[] = []

  for (const { path, url } of files) {
    const doc = indexFile(path, url)
    if (doc) {
      documents.push(doc)
    }
  }

  return {
    documents,
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Get the search index (cached for efficiency)
 */
let cachedIndex: SearchIndex | null = null

export function getSearchIndex(): SearchIndex {
  if (!cachedIndex) {
    cachedIndex = generateSearchIndex()
  }
  return cachedIndex
}

/**
 * Clear the search index cache (for testing or rebuilds)
 */
export function clearSearchIndexCache(): void {
  cachedIndex = null
}

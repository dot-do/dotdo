/**
 * Fumadocs Source Configuration
 *
 * This module provides the content source for Fumadocs documentation.
 * It scans the docs/ directory for MDX files and meta.json navigation files,
 * creating a source that can be used with the Fumadocs loader.
 *
 * @module lib/source
 * @see https://fumadocs.dev/docs/headless/source-api
 *
 * In production with Next.js, you would use the fumadocs-mdx virtual module:
 * ```ts
 * import { docs } from 'fumadocs-mdx:collections/server'
 * ```
 *
 * This runtime implementation provides the same functionality for:
 * - Testing with Vitest (no Next.js build required)
 * - Non-Next.js environments (Cloudflare Workers, etc.)
 * - Development without HMR dependencies
 */

import { loader, type Source, type PageData, type MetaData } from 'fumadocs-core/source'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Extended page data interface for documentation pages.
 * Includes structured data for search indexing.
 */
export interface DocsPageData extends PageData {
  /** Page title from frontmatter */
  title: string
  /** Page description for SEO and search */
  description?: string
  /** Structured data for advanced search indexing */
  structuredData?: StructuredData
  /** Optional icon identifier from Lucide icons */
  icon?: string
  /** Whether this page should be excluded from navigation */
  hidden?: boolean
}

/**
 * Structured data for search indexing.
 * Enables heading-level search results.
 */
export interface StructuredData {
  /** Document headings with their content */
  headings?: Array<{
    id: string
    content: string
  }>
  /** Full text content for search */
  contents?: string
}

/**
 * Extended meta data interface for navigation.
 * Supports Fumadocs navigation features like icons and default open state.
 */
export interface DocsMetaData extends MetaData {
  /** Section title in navigation */
  title?: string
  /** Ordered list of page slugs for navigation */
  pages?: string[]
  /** Whether section is expanded by default */
  defaultOpen?: boolean
  /** Lucide icon name for the section */
  icon?: string
  /** Optional description for the section */
  description?: string
}

/** Type for source files (pages and meta) */
type DocsSourceFile = Source<{ pageData: DocsPageData; metaData: DocsMetaData }>['files'][number]

/**
 * Creates a source from the docs directory by scanning for MDX files and meta.json.
 *
 * This is a runtime alternative to the fumadocs-mdx virtual module, useful for:
 * - Testing with Vitest without Next.js build
 * - Non-Next.js environments like Cloudflare Workers
 * - Development scenarios without HMR
 *
 * @returns Source object compatible with fumadocs-core loader
 *
 * @example
 * ```ts
 * const docsSource = createDocsSource()
 * const source = loader({ baseUrl: '/docs', source: docsSource })
 * ```
 */
function createDocsSource(): Source<{ pageData: DocsPageData; metaData: DocsMetaData }> {
  // Point to content/docs within the app folder
  const docsDir = path.resolve(import.meta.dirname, '..', 'content', 'docs')
  const files: DocsSourceFile[] = []

  /**
   * Recursively scans a directory for MDX files and meta.json navigation files.
   * @param dir - Directory to scan
   * @param relativePath - Path relative to docs root (for URL generation)
   */
  function scanDir(dir: string, relativePath: string = ''): void {
    if (!fs.existsSync(dir)) return

    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        scanDir(fullPath, relPath)
      } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) {
        // Parse frontmatter from MDX file
        const content = fs.readFileSync(fullPath, 'utf-8')
        const frontmatter = parseFrontmatter(content)

        // Extract headings for structured search data
        const structuredData = extractStructuredData(content)

        files.push({
          type: 'page',
          path: relPath,
          absolutePath: fullPath,
          data: {
            title: frontmatter.title || formatTitleFromFilename(entry.name),
            description: frontmatter.description,
            icon: frontmatter.icon,
            hidden: frontmatter.hidden === 'true',
            structuredData,
          },
        })
      } else if (entry.name === 'meta.json') {
        // Parse meta.json for navigation
        const content = fs.readFileSync(fullPath, 'utf-8')
        try {
          const meta = JSON.parse(content) as DocsMetaData
          files.push({
            type: 'meta',
            path: relPath,
            absolutePath: fullPath,
            data: meta,
          })
        } catch {
          // Invalid JSON, skip with warning in development
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`[fumadocs] Invalid JSON in ${fullPath}`)
          }
        }
      }
    }
  }

  scanDir(docsDir)
  return { files }
}

/**
 * Formats a filename into a readable title.
 * Handles kebab-case and removes file extension.
 *
 * @param filename - The filename to format
 * @returns Formatted title string
 *
 * @example
 * formatTitleFromFilename('quick-start.mdx') // 'Quick Start'
 * formatTitleFromFilename('index.mdx')       // 'Index'
 */
function formatTitleFromFilename(filename: string): string {
  const basename = path.basename(filename, path.extname(filename))
  return basename
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Extracts structured data from MDX content for search indexing.
 * Parses headings and extracts text content.
 *
 * @param content - Raw MDX content
 * @returns Structured data object for search
 */
function extractStructuredData(content: string): StructuredData {
  // Remove frontmatter for content extraction
  const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, '')

  // Extract headings (## and ###)
  const headingRegex = /^#{2,3}\s+(.+)$/gm
  const headings: Array<{ id: string; content: string }> = []
  let match

  while ((match = headingRegex.exec(contentWithoutFrontmatter)) !== null) {
    const headingText = match[1].trim()
    // Generate slug for heading ID
    const id = headingText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    headings.push({ id, content: headingText })
  }

  // Extract plain text content (remove MDX/JSX and code blocks)
  const textContent = contentWithoutFrontmatter
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/<[^>]+>/g, '')        // Remove JSX/HTML tags
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
    .replace(/[#*`_~]/g, '')        // Remove markdown formatting
    .replace(/\n+/g, ' ')           // Collapse newlines
    .trim()

  return {
    headings,
    contents: textContent.slice(0, 5000), // Limit content size for search
  }
}

/**
 * Simple frontmatter parser for MDX files.
 * Parses YAML-style frontmatter between --- delimiters.
 *
 * @param content - Raw MDX file content
 * @returns Parsed frontmatter as key-value pairs
 *
 * @example
 * ```ts
 * const fm = parseFrontmatter(`---
 * title: "Hello World"
 * description: A simple example
 * ---
 * # Content here`)
 *
 * // Returns: { title: 'Hello World', description: 'A simple example' }
 * ```
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}

  const frontmatter: Record<string, string> = {}
  const lines = match[1].split('\n')

  for (const line of lines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim()
      let value = line.slice(colonIndex + 1).trim()
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      frontmatter[key] = value
    }
  }

  return frontmatter
}

/**
 * The main docs source instance.
 * Use this to access pages, navigation tree, and search data.
 *
 * @example
 * ```ts
 * // Get all pages
 * const pages = source.getPages()
 *
 * // Get navigation tree
 * const tree = source.getPageTree()
 *
 * // Get single page by slug
 * const page = source.getPage(['getting-started', 'installation'])
 * ```
 */
export const source = loader({
  baseUrl: '/docs',
  source: createDocsSource(),
})

/**
 * Re-export types for external use
 */
export type { Source, PageData, MetaData } from 'fumadocs-core/source'

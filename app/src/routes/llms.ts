/**
 * LLM-Friendly Documentation Routes
 *
 * Provides text-based documentation endpoints optimized for LLM consumption:
 * - /llms.txt - Overview with links to documentation pages
 * - /llms-full.txt - Aggregated full documentation content
 * - /*.mdx - Individual documentation pages as plain text
 *
 * llms.txt is a standard for providing LLM-friendly documentation.
 * See: https://llmstxt.org/
 */

import { Hono } from 'hono'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Documentation root directory
const DOCS_DIR = join(process.cwd(), 'docs')

// Common headers for llms.txt responses
const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
}

/**
 * Document metadata structure
 */
interface DocMeta {
  title: string
  description: string
  url: string
  path: string
  content: string
}

/**
 * Extract frontmatter from MDX file content
 */
function extractFrontmatter(content: string): { title?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const frontmatter: Record<string, string> = {}
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
 * Extract markdown content without frontmatter
 */
function extractMarkdownContent(rawContent: string): string {
  // Remove frontmatter
  return rawContent.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
}

/**
 * Convert filename to title (kebab-case to Title Case)
 */
function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.(mdx?|md)$/, '')
    .replace(/^index$/, 'Overview')
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Get all MDX files recursively
 */
function getAllMdxFiles(
  dir: string,
  basePath: string = ''
): Array<{ path: string; url: string; mdxUrl: string }> {
  const files: Array<{ path: string; url: string; mdxUrl: string }> = []

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
          ? basePath
            ? `/docs/${basePath}`
            : '/docs'
          : basePath
            ? `/docs/${basePath}/${slug}`
            : `/docs/${slug}`

        // .mdx URL for llms.txt links
        const mdxUrl = isIndex
          ? basePath
            ? `/docs/${basePath}/index.mdx`
            : '/docs/index.mdx'
          : basePath
            ? `/docs/${basePath}/${slug}.mdx`
            : `/docs/${slug}.mdx`

        files.push({ path: fullPath, url, mdxUrl })
      }
    }
  } catch {
    // Ignore errors
  }

  return files
}

/**
 * Get document metadata for a file
 */
function getDocMeta(filePath: string, url: string, mdxUrl: string): DocMeta | null {
  try {
    const rawContent = readFileSync(filePath, 'utf-8')
    const frontmatter = extractFrontmatter(rawContent)
    const content = extractMarkdownContent(rawContent)
    const filename = filePath.split('/').pop() || ''

    // Skip draft content
    if (
      frontmatter.title?.toLowerCase().includes('draft') ||
      rawContent.includes('draft: true')
    ) {
      return null
    }

    return {
      title: frontmatter.title || filenameToTitle(filename),
      description: frontmatter.description || '',
      url: mdxUrl,
      path: filePath,
      content,
    }
  } catch {
    return null
  }
}

/**
 * Generate llms.txt content
 */
function generateLlmsTxt(): string {
  const files = getAllMdxFiles(DOCS_DIR)
  const docs: DocMeta[] = []

  for (const { path, url, mdxUrl } of files) {
    const doc = getDocMeta(path, url, mdxUrl)
    if (doc) {
      docs.push(doc)
    }
  }

  // Group docs by section
  const sections: Record<string, DocMeta[]> = {}

  for (const doc of docs) {
    // Extract section from URL path
    const parts = doc.url.split('/').filter(Boolean)
    const section = parts.length > 2 ? parts[1] : 'Overview'
    if (!sections[section]) {
      sections[section] = []
    }
    sections[section].push(doc)
  }

  // Build llms.txt content
  let output = `# do.md\n`
  output += `> A Durable Object framework for building stateful, event-driven applications with Cloudflare Workers\n\n`

  // Add sections
  for (const [sectionName, sectionDocs] of Object.entries(sections)) {
    const displayName = sectionName.charAt(0).toUpperCase() + sectionName.slice(1)
    output += `## ${displayName}\n`

    for (const doc of sectionDocs) {
      const description = doc.description ? `: ${doc.description}` : ''
      output += `- [${doc.title}](${doc.url})${description}\n`
    }
    output += '\n'
  }

  return output.trim()
}

/**
 * Generate llms-full.txt content with all documentation
 */
function generateLlmsFullTxt(): string {
  const files = getAllMdxFiles(DOCS_DIR)
  const docs: DocMeta[] = []

  for (const { path, url, mdxUrl } of files) {
    const doc = getDocMeta(path, url, mdxUrl)
    if (doc) {
      docs.push(doc)
    }
  }

  // Build full content
  let output = `# do.md - Full Documentation\n`
  output += `> A Durable Object framework for building stateful, event-driven applications with Cloudflare Workers\n\n`
  output += `This document contains the complete documentation for do.md.\n\n`

  for (const doc of docs) {
    output += `## ${doc.title}\n`
    if (doc.description) {
      output += `> ${doc.description}\n\n`
    }
    output += `Source: ${doc.url}\n\n`
    output += doc.content
    output += '\n\n---\n\n'
  }

  return output.trim()
}

/**
 * Resolve .mdx path to file path
 */
function resolveMdxPath(mdxPath: string): string | null {
  // Remove /docs prefix and .mdx suffix
  let normalizedPath = mdxPath.replace(/^\/docs\/?/, '').replace(/\.mdx$/, '')

  // Handle index.mdx
  if (normalizedPath.endsWith('/index')) {
    normalizedPath = normalizedPath.replace(/\/index$/, '')
  }

  // Try to find the file
  const possiblePaths = [
    join(DOCS_DIR, normalizedPath + '.mdx'),
    join(DOCS_DIR, normalizedPath + '.md'),
    join(DOCS_DIR, normalizedPath, 'index.mdx'),
    join(DOCS_DIR, normalizedPath, 'index.md'),
  ]

  // Special case for /docs/index.mdx
  if (normalizedPath === 'index' || normalizedPath === '') {
    possiblePaths.unshift(join(DOCS_DIR, 'index.mdx'))
    possiblePaths.unshift(join(DOCS_DIR, 'index.md'))
  }

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path
    }
  }

  return null
}

/**
 * Get content for a specific .mdx page
 */
function getMdxContent(mdxPath: string): string | null {
  const filePath = resolveMdxPath(mdxPath)
  if (!filePath) return null

  try {
    const rawContent = readFileSync(filePath, 'utf-8')
    return extractMarkdownContent(rawContent)
  } catch {
    return null
  }
}

// Create Hono router for llms routes
export const llmsRouter = new Hono()

// GET /llms.txt - Overview with links
llmsRouter.get('/llms.txt', (c) => {
  const content = generateLlmsTxt()
  return c.text(content, 200, TEXT_HEADERS)
})

// GET /llms-full.txt - Full aggregated content
llmsRouter.get('/llms-full.txt', (c) => {
  const content = generateLlmsFullTxt()
  return c.text(content, 200, TEXT_HEADERS)
})

// GET /docs/*.mdx - Individual pages as plain text
llmsRouter.get('/docs/*', (c) => {
  const path = c.req.path

  // Only handle .mdx requests
  if (!path.endsWith('.mdx')) {
    return c.notFound()
  }

  const content = getMdxContent(path)
  if (!content) {
    return c.text('Not Found', 404, { 'Content-Type': 'text/plain; charset=utf-8' })
  }

  return c.text(content, 200, TEXT_HEADERS)
})

export default llmsRouter

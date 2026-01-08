import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'

/**
 * llms.txt Route Tests
 *
 * These tests verify the /llms.txt and /llms-full.txt routes for the dotdo app.
 * They are expected to FAIL until the llms.txt routes are implemented.
 *
 * llms.txt is a standard for providing LLM-friendly documentation:
 * - /llms.txt: Overview with links to documentation pages
 * - /llms-full.txt: Aggregated full documentation content
 * - /*.mdx: Individual documentation pages
 *
 * Implementation requirements:
 * - Create routes in app/src/routes/llms.ts (or similar)
 * - Mount routes on the main Hono app
 * - Generate content from documentation source files
 */

// TODO: Import the actual app once routes are implemented
// import { app } from '../../src/app'

// Placeholder app - tests will fail because routes don't exist
const app = new Hono()

// ============================================================================
// Helper Functions
// ============================================================================

async function get(path: string): Promise<Response> {
  return app.request(path, { method: 'GET' })
}

// ============================================================================
// GET /llms.txt - LLM Documentation Index
// ============================================================================

describe('GET /llms.txt', () => {
  it('returns 200 status', async () => {
    const res = await get('/llms.txt')

    expect(res.status).toBe(200)
  })

  it('returns text/plain content type', async () => {
    const res = await get('/llms.txt')

    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  it('returns UTF-8 encoded content', async () => {
    const res = await get('/llms.txt')
    const contentType = res.headers.get('content-type')

    expect(contentType).toContain('charset=utf-8')
  })

  it('starts with # heading (project name)', async () => {
    const res = await get('/llms.txt')
    const text = await res.text()

    // llms.txt format requires starting with a # heading
    expect(text.trim()).toMatch(/^# .+/)
  })

  it('has blockquote summary (> description)', async () => {
    const res = await get('/llms.txt')
    const text = await res.text()

    // After the heading, there should be a blockquote with project description
    expect(text).toMatch(/\n> .+/)
  })

  it('has ## sections with file lists', async () => {
    const res = await get('/llms.txt')
    const text = await res.text()

    // Should have at least one ## section
    expect(text).toMatch(/\n## .+/)

    // Sections should contain file links
    expect(text).toMatch(/- \[.+\]\(.+\)/)
  })

  it('contains links to .mdx documentation files', async () => {
    const res = await get('/llms.txt')
    const text = await res.text()

    // Should have links to .mdx files
    expect(text).toMatch(/\.mdx\)/)
  })

  it('includes file descriptions after links', async () => {
    const res = await get('/llms.txt')
    const text = await res.text()

    // Format: - [title](path.mdx): description
    expect(text).toMatch(/- \[.+\]\(.+\.mdx\): .+/)
  })
})

// ============================================================================
// GET /llms-full.txt - Aggregated Documentation
// ============================================================================

describe('GET /llms-full.txt', () => {
  it('returns 200 status', async () => {
    const res = await get('/llms-full.txt')

    expect(res.status).toBe(200)
  })

  it('returns text/plain content type', async () => {
    const res = await get('/llms-full.txt')

    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  it('returns UTF-8 encoded content', async () => {
    const res = await get('/llms-full.txt')
    const contentType = res.headers.get('content-type')

    expect(contentType).toContain('charset=utf-8')
  })

  it('starts with # heading (project name)', async () => {
    const res = await get('/llms-full.txt')
    const text = await res.text()

    expect(text.trim()).toMatch(/^# .+/)
  })

  it('contains aggregated documentation content', async () => {
    const res = await get('/llms-full.txt')
    const text = await res.text()

    // Should be substantially longer than llms.txt (contains full content)
    expect(text.length).toBeGreaterThan(1000)
  })

  it('contains all page content from llms.txt', async () => {
    const indexRes = await get('/llms.txt')
    const indexText = await indexRes.text()

    const fullRes = await get('/llms-full.txt')
    const fullText = await fullRes.text()

    // Extract page paths from llms.txt
    const pageLinks = indexText.match(/\]\(([^)]+\.mdx)\)/g) || []

    // Full content should be longer and contain content from each linked page
    expect(pageLinks.length).toBeGreaterThan(0)
    expect(fullText.length).toBeGreaterThan(indexText.length)
  })

  it('separates sections with clear delimiters', async () => {
    const res = await get('/llms-full.txt')
    const text = await res.text()

    // Should have multiple ## sections for different pages
    const sectionMatches = text.match(/\n## /g) || []
    expect(sectionMatches.length).toBeGreaterThan(1)
  })

  it('includes source file paths in section headers', async () => {
    const res = await get('/llms-full.txt')
    const text = await res.text()

    // Section headers should reference the source file
    expect(text).toMatch(/## .+\n/)
  })
})

// ============================================================================
// Individual Pages - .mdx Extension Routes
// ============================================================================

describe('Individual .mdx page routes', () => {
  it('serves individual pages with .mdx extension', async () => {
    // Get the index to find available pages
    const indexRes = await get('/llms.txt')
    const indexText = await indexRes.text()

    // Extract first page path
    const match = indexText.match(/\]\(([^)]+\.mdx)\)/)
    if (!match) {
      throw new Error('No .mdx pages found in llms.txt')
    }

    const pagePath = match[1]
    const res = await get(pagePath)

    expect(res.status).toBe(200)
  })

  it('returns text/plain content type for .mdx pages', async () => {
    const indexRes = await get('/llms.txt')
    const indexText = await indexRes.text()

    const match = indexText.match(/\]\(([^)]+\.mdx)\)/)
    if (!match) {
      throw new Error('No .mdx pages found in llms.txt')
    }

    const pagePath = match[1]
    const res = await get(pagePath)

    expect(res.headers.get('content-type')).toContain('text/plain')
  })

  it('returns UTF-8 encoded content for .mdx pages', async () => {
    const indexRes = await get('/llms.txt')
    const indexText = await indexRes.text()

    const match = indexText.match(/\]\(([^)]+\.mdx)\)/)
    if (!match) {
      throw new Error('No .mdx pages found in llms.txt')
    }

    const pagePath = match[1]
    const res = await get(pagePath)
    const contentType = res.headers.get('content-type')

    expect(contentType).toContain('charset=utf-8')
  })

  it('.mdx pages contain markdown content', async () => {
    const indexRes = await get('/llms.txt')
    const indexText = await indexRes.text()

    const match = indexText.match(/\]\(([^)]+\.mdx)\)/)
    if (!match) {
      throw new Error('No .mdx pages found in llms.txt')
    }

    const pagePath = match[1]
    const res = await get(pagePath)
    const text = await res.text()

    // Should contain markdown content (headings, paragraphs, etc.)
    expect(text.length).toBeGreaterThan(100)
    expect(text).toMatch(/(^|\n)#+ .+/)
  })

  it('returns 404 for non-existent .mdx pages', async () => {
    const res = await get('/docs/non-existent-page-12345.mdx')

    expect(res.status).toBe(404)
  })

  it('all pages listed in llms.txt are accessible', async () => {
    const indexRes = await get('/llms.txt')
    const indexText = await indexRes.text()

    // Extract all page paths
    const pageMatches = indexText.matchAll(/\]\(([^)]+\.mdx)\)/g)
    const pagePaths = Array.from(pageMatches, (m) => m[1])

    expect(pagePaths.length).toBeGreaterThan(0)

    // Verify each page is accessible
    for (const pagePath of pagePaths) {
      const res = await get(pagePath)
      expect(res.status).toBe(200)
    }
  })
})

// ============================================================================
// Content Encoding
// ============================================================================

describe('Content Encoding', () => {
  it('llms.txt is valid UTF-8', async () => {
    const res = await get('/llms.txt')
    const buffer = await res.arrayBuffer()
    const decoder = new TextDecoder('utf-8', { fatal: true })

    // Should not throw on valid UTF-8
    expect(() => decoder.decode(buffer)).not.toThrow()
  })

  it('llms-full.txt is valid UTF-8', async () => {
    const res = await get('/llms-full.txt')
    const buffer = await res.arrayBuffer()
    const decoder = new TextDecoder('utf-8', { fatal: true })

    // Should not throw on valid UTF-8
    expect(() => decoder.decode(buffer)).not.toThrow()
  })

  it('handles unicode characters in content', async () => {
    const res = await get('/llms-full.txt')
    const text = await res.text()

    // Content should be readable and not garbled
    // At minimum, standard ASCII should work
    expect(text).toMatch(/[a-zA-Z0-9]/)
  })
})

// ============================================================================
// Cache Headers
// ============================================================================

describe('Cache Headers', () => {
  it('llms.txt includes cache-control header', async () => {
    const res = await get('/llms.txt')

    expect(res.headers.has('cache-control')).toBe(true)
  })

  it('llms-full.txt includes cache-control header', async () => {
    const res = await get('/llms-full.txt')

    expect(res.headers.has('cache-control')).toBe(true)
  })
})

// ============================================================================
// Error Handling
// ============================================================================

describe('Error Handling', () => {
  it('returns 404 for unknown documentation paths', async () => {
    const res = await get('/docs/does-not-exist.mdx')

    expect(res.status).toBe(404)
  })

  it('returns proper error response for missing files', async () => {
    const res = await get('/docs/missing-file.mdx')

    expect(res.status).toBe(404)
    // Could be text/plain or application/json depending on implementation
    expect(res.headers.get('content-type')).toBeTruthy()
  })
})

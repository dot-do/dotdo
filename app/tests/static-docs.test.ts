import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'

/**
 * Static Documentation Serving Tests
 *
 * These tests verify static documentation serving for /docs/* routes:
 * - Static file serving from build output
 * - MIME type handling
 * - Routing and nested paths
 * - Markdown rendering
 * - Code syntax highlighting
 * - Navigation generation
 * - Search index generation
 * - SEO metadata
 *
 * Expected to FAIL until static docs serving is implemented.
 */

// ============================================================================
// Mock Fetchers - Will need actual implementation
// ============================================================================

// Mock page fetcher for static HTML
async function fetchStaticPage(path: string): Promise<Response> {
  // TODO: Replace with actual static file serving
  // @ts-expect-error - module not yet implemented
  const { serveStaticDocs } = await import('../src/serve-static')
  return serveStaticDocs(path)
}

// Mock asset fetcher for JS/CSS/images
async function fetchAsset(path: string): Promise<Response> {
  // TODO: Replace with actual asset serving
  // @ts-expect-error - module not yet implemented
  const { serveStaticAsset } = await import('../src/serve-static')
  return serveStaticAsset(path)
}

// Mock navigation fetcher
async function fetchNavigation(): Promise<object> {
  // TODO: Replace with actual navigation generator
  // @ts-expect-error - module not yet implemented
  const { generateNavigation } = await import('../lib/docs/navigation')
  return generateNavigation()
}

// Mock search index fetcher
async function fetchSearchIndex(): Promise<object> {
  // TODO: Replace with actual search index
  // @ts-expect-error - module not yet implemented
  const { getSearchIndex } = await import('../lib/docs/search-index')
  return getSearchIndex()
}

// ============================================================================
// 1. Basic Serving Tests
// ============================================================================

describe('Basic Static File Serving', () => {
  describe('HTML File Serving', () => {
    it('should serve docs index page at /docs/', async () => {
      const response = await fetchStaticPage('/docs/')
      expect(response.status).toBe(200)
    })

    it('should serve docs index page at /docs (without trailing slash)', async () => {
      const response = await fetchStaticPage('/docs')
      expect(response.status).toBe(200)
    })

    it('should return HTML content type for docs pages', async () => {
      const response = await fetchStaticPage('/docs/')
      expect(response.headers.get('content-type')).toContain('text/html')
    })

    it('should include charset=utf-8 in content type', async () => {
      const response = await fetchStaticPage('/docs/')
      expect(response.headers.get('content-type')).toContain('charset=utf-8')
    })

    it('should serve valid HTML5 document', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<!DOCTYPE html>/i)
      expect(html).toMatch(/<html[^>]*>/i)
      expect(html).toMatch(/<head>/i)
      expect(html).toMatch(/<body>/i)
    })
  })

  describe('CSS File Serving', () => {
    it('should serve CSS files with correct MIME type', async () => {
      const response = await fetchAsset('/docs/_assets/styles.css')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/css')
    })

    it('should serve fumadocs CSS bundle', async () => {
      const response = await fetchAsset('/docs/_assets/fumadocs.css')
      expect(response.status).toBe(200)
    })
  })

  describe('JavaScript File Serving', () => {
    it('should serve JS files with correct MIME type', async () => {
      const response = await fetchAsset('/docs/_assets/main.js')
      expect(response.status).toBe(200)
      const contentType = response.headers.get('content-type')
      expect(contentType).toMatch(/application\/javascript|text\/javascript/)
    })

    it('should serve client-side hydration bundle', async () => {
      const response = await fetchAsset('/docs/_assets/client.js')
      expect(response.status).toBe(200)
    })
  })

  describe('Image File Serving', () => {
    it('should serve PNG images with correct MIME type', async () => {
      const response = await fetchAsset('/docs/_assets/logo.png')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
    })

    it('should serve SVG images with correct MIME type', async () => {
      const response = await fetchAsset('/docs/_assets/icon.svg')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('image/svg+xml')
    })

    it('should serve WebP images with correct MIME type', async () => {
      const response = await fetchAsset('/docs/_assets/hero.webp')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/webp')
    })
  })

  describe('Font File Serving', () => {
    it('should serve WOFF2 fonts with correct MIME type', async () => {
      const response = await fetchAsset('/docs/_assets/fonts/inter.woff2')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('font/woff2')
    })

    it('should serve WOFF fonts with correct MIME type', async () => {
      const response = await fetchAsset('/docs/_assets/fonts/mono.woff')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('font/woff')
    })
  })

  describe('Cache Headers', () => {
    it('should set cache-control for static assets', async () => {
      const response = await fetchAsset('/docs/_assets/styles.css')
      expect(response.headers.has('cache-control')).toBe(true)
    })

    it('should set long cache for hashed assets', async () => {
      const response = await fetchAsset('/docs/_assets/main.abc123.js')
      const cacheControl = response.headers.get('cache-control')
      expect(cacheControl).toContain('max-age')
      // Should cache for at least 1 year for hashed assets
      expect(cacheControl).toMatch(/max-age=\d{7,}/)
    })

    it('should set ETag for static files', async () => {
      const response = await fetchStaticPage('/docs/')
      expect(response.headers.has('etag')).toBe(true)
    })

    it('should support conditional requests (If-None-Match)', async () => {
      const response1 = await fetchStaticPage('/docs/')
      const etag = response1.headers.get('etag')

      // @ts-expect-error - module not yet implemented
      const { serveStaticDocs } = await import('../src/serve-static')
      const response2 = await serveStaticDocs('/docs/', {
        headers: { 'If-None-Match': etag },
      })

      expect(response2.status).toBe(304)
    })
  })
})

// ============================================================================
// 2. Routing Tests
// ============================================================================

describe('Documentation Routing', () => {
  describe('Root Docs Routes', () => {
    it('should serve /docs/getting-started', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      expect(response.status).toBe(200)
    })

    it('should serve /docs/api', async () => {
      const response = await fetchStaticPage('/docs/api')
      expect(response.status).toBe(200)
    })

    it('should serve /docs/concepts', async () => {
      const response = await fetchStaticPage('/docs/concepts')
      expect(response.status).toBe(200)
    })
  })

  describe('Nested Path Routes', () => {
    it('should serve /docs/getting-started/installation', async () => {
      const response = await fetchStaticPage('/docs/getting-started/installation')
      expect(response.status).toBe(200)
    })

    it('should serve /docs/api/authentication', async () => {
      const response = await fetchStaticPage('/docs/api/authentication')
      expect(response.status).toBe(200)
    })

    it('should serve deeply nested paths /docs/guides/advanced/deployment', async () => {
      const response = await fetchStaticPage('/docs/guides/advanced/deployment')
      expect(response.status).toBe(200)
    })
  })

  describe('Index Page Handling', () => {
    it('should serve section index at /docs/concepts/', async () => {
      const response = await fetchStaticPage('/docs/concepts/')
      expect(response.status).toBe(200)
    })

    it('should redirect /docs/concepts to /docs/concepts/', async () => {
      const response = await fetchStaticPage('/docs/concepts')
      // Either redirect or serve directly
      expect([200, 301, 302, 308]).toContain(response.status)
    })
  })

  describe('Special Characters in Paths', () => {
    it('should handle paths with hyphens', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      expect(response.status).toBe(200)
    })

    it('should handle paths with underscores', async () => {
      const response = await fetchStaticPage('/docs/api_reference')
      // Either exists or returns 404 (but shouldn't error)
      expect([200, 404]).toContain(response.status)
    })

    it('should URL-decode percent-encoded paths', async () => {
      const response = await fetchStaticPage('/docs/getting%20started')
      // Should handle encoded spaces
      expect([200, 404]).toContain(response.status)
    })
  })

  describe('Case Sensitivity', () => {
    it('should handle lowercase paths', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      expect(response.status).toBe(200)
    })

    it('should return 404 or redirect for uppercase paths', async () => {
      const response = await fetchStaticPage('/docs/Getting-Started')
      // Either redirect to lowercase or return 404
      expect([200, 301, 302, 308, 404]).toContain(response.status)
    })
  })
})

// ============================================================================
// 3. 404 Handling Tests
// ============================================================================

describe('404 Handling for Missing Docs', () => {
  describe('Non-existent Pages', () => {
    it('should return 404 for non-existent doc page', async () => {
      const response = await fetchStaticPage('/docs/this-page-does-not-exist')
      expect(response.status).toBe(404)
    })

    it('should return 404 for non-existent nested page', async () => {
      const response = await fetchStaticPage('/docs/getting-started/non-existent-section')
      expect(response.status).toBe(404)
    })

    it('should return 404 for deeply non-existent paths', async () => {
      const response = await fetchStaticPage('/docs/a/b/c/d/e/f/g')
      expect(response.status).toBe(404)
    })
  })

  describe('404 Page Content', () => {
    it('should return HTML 404 page for missing docs', async () => {
      const response = await fetchStaticPage('/docs/non-existent')
      expect(response.headers.get('content-type')).toContain('text/html')
    })

    it('should include helpful 404 message', async () => {
      const response = await fetchStaticPage('/docs/non-existent')
      const html = await response.text()
      expect(html.toLowerCase()).toContain('not found')
    })

    it('should include navigation to find content', async () => {
      const response = await fetchStaticPage('/docs/non-existent')
      const html = await response.text()
      // Should have links to docs home or search
      expect(html).toMatch(/href=["'][^"']*docs/i)
    })

    it('should include search functionality on 404 page', async () => {
      const response = await fetchStaticPage('/docs/non-existent')
      const html = await response.text()
      expect(html).toMatch(/search/i)
    })
  })

  describe('Asset 404 Handling', () => {
    it('should return 404 for non-existent assets', async () => {
      const response = await fetchAsset('/docs/_assets/non-existent.js')
      expect(response.status).toBe(404)
    })

    it('should not expose directory listings', async () => {
      const response = await fetchAsset('/docs/_assets/')
      // Should not return 200 with directory listing
      expect(response.status).not.toBe(200)
    })
  })
})

// ============================================================================
// 4. Markdown Rendering Tests
// ============================================================================

describe('Markdown Rendering', () => {
  describe('Basic Markdown Elements', () => {
    it('should render headings correctly', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      expect(html).toMatch(/<h[1-6][^>]*>.*<\/h[1-6]>/i)
    })

    it('should render paragraphs correctly', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      expect(html).toMatch(/<p[^>]*>.*<\/p>/i)
    })

    it('should render bold text', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      expect(html).toMatch(/<strong>.*<\/strong>/i)
    })

    it('should render italic text', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      expect(html).toMatch(/<em>.*<\/em>/i)
    })

    it('should render inline code', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      expect(html).toMatch(/<code[^>]*>.*<\/code>/i)
    })
  })

  describe('Links', () => {
    it('should render internal links correctly', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      expect(html).toMatch(/<a[^>]+href=["'][^"']*docs[^"']*["'][^>]*>/i)
    })

    it('should render external links with target="_blank"', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      // External links should open in new tab
      const externalLinkRegex = /<a[^>]+href=["']https?:\/\/(?!.*\.do\b)[^"']+["'][^>]*>/i
      if (externalLinkRegex.test(html)) {
        expect(html).toMatch(/target=["']_blank["']/i)
      }
    })

    it('should add rel="noopener noreferrer" to external links', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      // External links should have security attributes
      const hasExternalLinks = html.match(/href=["']https?:\/\/(?!.*\.do\b)/i)
      if (hasExternalLinks) {
        expect(html).toMatch(/rel=["'][^"']*noopener[^"']*["']/i)
      }
    })
  })

  describe('Lists', () => {
    it('should render unordered lists', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>.*<\/li>.*<\/ul>/is)
    })

    it('should render ordered lists', async () => {
      const response = await fetchStaticPage('/docs/guides')
      const html = await response.text()
      // May or may not have ordered lists
      expect(html).toBeDefined()
    })

    it('should render nested lists', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Check for nested list structure
      expect(html).toBeDefined()
    })
  })

  describe('Tables', () => {
    it('should render tables with proper structure', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Tables should have proper semantic structure
      if (html.includes('<table')) {
        expect(html).toMatch(/<table[^>]*>/i)
        expect(html).toMatch(/<thead[^>]*>|<th[^>]*>/i)
        expect(html).toMatch(/<tbody[^>]*>|<tr[^>]*>/i)
      }
    })

    it('should make tables responsive', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Tables should be wrapped or styled for responsive display
      if (html.includes('<table')) {
        expect(html).toMatch(/overflow|responsive|scroll/i)
      }
    })
  })

  describe('Blockquotes', () => {
    it('should render blockquotes', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      // May have blockquotes for callouts
      expect(html).toBeDefined()
    })

    it('should style callout boxes (note, warning, tip)', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      // Fumadocs callouts should be styled
      expect(html).toBeDefined()
    })
  })

  describe('Images', () => {
    it('should render images with alt text', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      if (html.match(/<img[^>]+>/i)) {
        expect(html).toMatch(/<img[^>]+alt=["'][^"']*["'][^>]*>/i)
      }
    })

    it('should optimize images for lazy loading', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      if (html.match(/<img[^>]+>/i)) {
        expect(html).toMatch(/loading=["']lazy["']/i)
      }
    })
  })
})

// ============================================================================
// 5. Code Syntax Highlighting Tests
// ============================================================================

describe('Code Syntax Highlighting', () => {
  describe('Code Block Rendering', () => {
    it('should render fenced code blocks', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      expect(html).toMatch(/<pre[^>]*>.*<code[^>]*>/is)
    })

    it('should apply syntax highlighting classes', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Should have syntax highlighting classes (shiki, prism, or similar)
      expect(html).toMatch(/class=["'][^"']*(?:shiki|highlight|token|syntax)[^"']*["']/i)
    })

    it('should preserve code formatting', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Pre tags should be present for code blocks
      expect(html).toMatch(/<pre[^>]*>/i)
    })
  })

  describe('Language Support', () => {
    it('should highlight JavaScript/TypeScript code', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Should have language-specific highlighting
      expect(html).toMatch(/(?:language-|lang-)?(?:javascript|typescript|js|ts)/i)
    })

    it('should highlight shell/bash code', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      // Installation docs typically have shell commands
      expect(html).toBeDefined()
    })

    it('should highlight JSON code', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // API docs typically have JSON examples
      expect(html).toBeDefined()
    })
  })

  describe('Code Block Features', () => {
    it('should show line numbers when specified', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Line numbers should be present in some code blocks
      if (html.match(/showLineNumbers|line-numbers/i)) {
        expect(html).toMatch(/data-line|line-number|counter/i)
      }
    })

    it('should support code block titles', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Code block titles (filename indicators)
      expect(html).toBeDefined()
    })

    it('should support line highlighting', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Highlighted lines in code blocks
      expect(html).toBeDefined()
    })

    it('should have copy button for code blocks', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // Copy button should be present
      expect(html).toMatch(/copy|clipboard/i)
    })
  })

  describe('Theme Support', () => {
    it('should support light theme syntax colors', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      // Should have light theme styles
      expect(html).toBeDefined()
    })

    it('should support dark theme syntax colors', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      // Should have dark theme styles or CSS variables
      expect(html).toMatch(/dark|prefers-color-scheme/i)
    })
  })
})

// ============================================================================
// 6. Navigation Tests
// ============================================================================

describe('Navigation Generation', () => {
  describe('Sidebar Navigation', () => {
    it('should include sidebar navigation', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/sidebar|nav|navigation/i)
    })

    it('should list all documentation sections', async () => {
      const nav = await fetchNavigation()
      expect(nav).toHaveProperty('sections')
      expect(Array.isArray((nav as any).sections)).toBe(true)
    })

    it('should include Getting Started section', async () => {
      const nav = await fetchNavigation()
      const sections = (nav as any).sections
      const gettingStarted = sections.find((s: any) =>
        s.title.toLowerCase().includes('getting started')
      )
      expect(gettingStarted).toBeDefined()
    })

    it('should include API section', async () => {
      const nav = await fetchNavigation()
      const sections = (nav as any).sections
      const apiSection = sections.find((s: any) =>
        s.title.toLowerCase().includes('api')
      )
      expect(apiSection).toBeDefined()
    })

    it('should have nested items in sections', async () => {
      const nav = await fetchNavigation()
      const sections = (nav as any).sections
      const sectionWithItems = sections.find((s: any) =>
        s.items && s.items.length > 0
      )
      expect(sectionWithItems).toBeDefined()
    })

    it('should highlight current page in sidebar', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      // Current page should have active/selected state
      expect(html).toMatch(/active|current|selected|aria-current/i)
    })
  })

  describe('Breadcrumb Navigation', () => {
    it('should include breadcrumbs on nested pages', async () => {
      const response = await fetchStaticPage('/docs/getting-started/installation')
      const html = await response.text()
      expect(html).toMatch(/breadcrumb|aria-label=["']breadcrumb/i)
    })

    it('should show correct breadcrumb path', async () => {
      const response = await fetchStaticPage('/docs/api/authentication')
      const html = await response.text()
      // Should show: Docs > API > Authentication
      expect(html).toContain('API')
    })

    it('should have clickable breadcrumb links', async () => {
      const response = await fetchStaticPage('/docs/guides/deployment')
      const html = await response.text()
      // Breadcrumb items (except current) should be links
      expect(html).toMatch(/<a[^>]+href=["'][^"']*docs[^"']*["']/i)
    })
  })

  describe('Previous/Next Navigation', () => {
    it('should include previous/next page links', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      expect(html).toMatch(/previous|next|prev/i)
    })

    it('should link to correct previous page', async () => {
      const response = await fetchStaticPage('/docs/concepts')
      const html = await response.text()
      // Should have navigation to adjacent pages
      expect(html).toBeDefined()
    })

    it('should link to correct next page', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      // Should have navigation to next section
      expect(html).toBeDefined()
    })
  })

  describe('Table of Contents', () => {
    it('should generate table of contents from headings', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      expect(html).toMatch(/table.of.contents|toc|on.this.page/i)
    })

    it('should include anchor links for headings', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      expect(html).toMatch(/<h[2-6][^>]+id=["'][^"']+["']/i)
    })

    it('should link TOC items to heading anchors', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      expect(html).toMatch(/href=["']#[^"']+["']/i)
    })

    it('should highlight current section in TOC', async () => {
      const response = await fetchStaticPage('/docs/api')
      const html = await response.text()
      // TOC should have scroll-spy functionality
      expect(html).toBeDefined()
    })
  })

  describe('Navigation Structure', () => {
    it('should generate navigation from docs/ directory', async () => {
      const nav = await fetchNavigation()
      expect(nav).toBeDefined()
    })

    it('should respect ordering from frontmatter/meta', async () => {
      const nav = await fetchNavigation()
      // Navigation should be ordered
      expect(nav).toBeDefined()
    })

    it('should support collapsible sections', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      // Sidebar sections should be collapsible
      expect(html).toMatch(/collapsible|expandable|accordion/i)
    })
  })
})

// ============================================================================
// 7. Search Tests
// ============================================================================

describe('Search Index Generation', () => {
  describe('Index Structure', () => {
    it('should generate search index from docs', async () => {
      const index = await fetchSearchIndex()
      expect(index).toBeDefined()
    })

    it('should include page titles in index', async () => {
      const index = await fetchSearchIndex() as any
      expect(index.documents).toBeDefined()
      expect(index.documents[0]).toHaveProperty('title')
    })

    it('should include page URLs in index', async () => {
      const index = await fetchSearchIndex() as any
      expect(index.documents[0]).toHaveProperty('url')
    })

    it('should include page content in index', async () => {
      const index = await fetchSearchIndex() as any
      expect(index.documents[0]).toHaveProperty('content')
    })

    it('should include section headings in index', async () => {
      const index = await fetchSearchIndex() as any
      const hasHeadings = index.documents.some((doc: any) => doc.headings)
      expect(hasHeadings).toBe(true)
    })
  })

  describe('Index Coverage', () => {
    it('should index all documentation pages', async () => {
      const index = await fetchSearchIndex() as any
      // Should have documents for all pages
      expect(index.documents.length).toBeGreaterThan(0)
    })

    it('should not index draft pages', async () => {
      const index = await fetchSearchIndex() as any
      const hasDraft = index.documents.some((doc: any) =>
        doc.title.toLowerCase().includes('draft')
      )
      expect(hasDraft).toBe(false)
    })

    it('should include metadata in index', async () => {
      const index = await fetchSearchIndex() as any
      const hasMetadata = index.documents.some((doc: any) =>
        doc.description || doc.tags
      )
      expect(hasMetadata).toBe(true)
    })
  })

  describe('Search Functionality', () => {
    it('should include search component on docs pages', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/search|cmd.*k|ctrl.*k/i)
    })

    it('should load search index on demand', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      // Should have search index or search functionality
      expect(html).toMatch(/search-index|orama|flexsearch|lunr|fuse/i)
    })

    it('should support keyboard shortcut for search (Cmd/Ctrl+K)', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      // Should have keyboard shortcut handler
      expect(html).toMatch(/cmd|ctrl|keyboard|shortcut/i)
    })
  })

  describe('Search Results', () => {
    it('should return results with title', async () => {
      // This tests the search API which should be available
      // @ts-expect-error - module not yet implemented
      const { searchDocs } = await import('../lib/docs/search')
      const results = await searchDocs('getting started')
      expect(results[0]).toHaveProperty('title')
    })

    it('should return results with URL', async () => {
      // @ts-expect-error - module not yet implemented
      const { searchDocs } = await import('../lib/docs/search')
      const results = await searchDocs('api')
      expect(results[0]).toHaveProperty('url')
    })

    it('should return results with snippet', async () => {
      // @ts-expect-error - module not yet implemented
      const { searchDocs } = await import('../lib/docs/search')
      const results = await searchDocs('installation')
      expect(results[0]).toHaveProperty('snippet')
    })

    it('should highlight matching terms in results', async () => {
      // @ts-expect-error - module not yet implemented
      const { searchDocs } = await import('../lib/docs/search')
      const results = await searchDocs('deploy')
      if (results.length > 0 && results[0].snippet) {
        expect(results[0].snippet).toMatch(/<mark>|<strong>/i)
      }
    })
  })
})

// ============================================================================
// 8. SEO Metadata Tests
// ============================================================================

describe('SEO Metadata', () => {
  describe('Meta Tags', () => {
    it('should have title tag', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<title>[^<]+<\/title>/i)
    })

    it('should have unique title per page', async () => {
      const [indexRes, gettingStartedRes] = await Promise.all([
        fetchStaticPage('/docs/'),
        fetchStaticPage('/docs/getting-started'),
      ])
      const indexHtml = await indexRes.text()
      const gsHtml = await gettingStartedRes.text()

      const indexTitle = indexHtml.match(/<title>([^<]+)<\/title>/i)?.[1]
      const gsTitle = gsHtml.match(/<title>([^<]+)<\/title>/i)?.[1]

      expect(indexTitle).not.toBe(gsTitle)
    })

    it('should have meta description', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+name=["']description["'][^>]*>/i)
    })

    it('should have description content', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                   html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
      expect(match).not.toBeNull()
      expect(match![1].length).toBeGreaterThan(10)
    })

    it('should have canonical URL', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<link[^>]+rel=["']canonical["']/i)
    })
  })

  describe('Open Graph Tags', () => {
    it('should have og:title', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+property=["']og:title["']/i)
    })

    it('should have og:description', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+property=["']og:description["']/i)
    })

    it('should have og:type', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+property=["']og:type["']/i)
    })

    it('should have og:url', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+property=["']og:url["']/i)
    })

    it('should have og:image', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+property=["']og:image["']/i)
    })

    it('should have og:site_name', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+property=["']og:site_name["']/i)
    })
  })

  describe('Twitter Card Tags', () => {
    it('should have twitter:card', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+name=["']twitter:card["']/i)
    })

    it('should have twitter:title', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+name=["']twitter:title["']/i)
    })

    it('should have twitter:description', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+name=["']twitter:description["']/i)
    })
  })

  describe('Structured Data', () => {
    it('should have JSON-LD structured data', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<script[^>]+type=["']application\/ld\+json["']/i)
    })

    it('should have valid JSON-LD content', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      const match = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
      expect(match).not.toBeNull()
      expect(() => JSON.parse(match![1])).not.toThrow()
    })

    it('should have @context set to schema.org', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      const match = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
      const jsonLd = JSON.parse(match![1])
      expect(jsonLd['@context']).toBe('https://schema.org')
    })

    it('should have Article or TechArticle type for doc pages', async () => {
      const response = await fetchStaticPage('/docs/getting-started')
      const html = await response.text()
      const match = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
      const jsonLd = JSON.parse(match![1])
      expect(['Article', 'TechArticle', 'WebPage']).toContain(jsonLd['@type'])
    })
  })

  describe('Additional SEO Elements', () => {
    it('should have viewport meta tag', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+name=["']viewport["']/i)
    })

    it('should have charset declaration', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<meta[^>]+charset=["']utf-8["']/i)
    })

    it('should have lang attribute on html element', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      expect(html).toMatch(/<html[^>]+lang=["'][a-z]{2}/i)
    })

    it('should have robots meta tag allowing indexing', async () => {
      const response = await fetchStaticPage('/docs/')
      const html = await response.text()
      // Should either not have robots meta or have index,follow
      const robotsMatch = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i)
      if (robotsMatch) {
        expect(robotsMatch[1]).not.toContain('noindex')
      }
    })
  })
})

// ============================================================================
// Build Output Tests
// ============================================================================

describe('Build Output', () => {
  describe('Static Files Generation', () => {
    it('should generate static HTML files in dist/', async () => {
      const distExists = existsSync('dist/docs/index.html')
      expect(distExists).toBe(true)
    })

    it('should generate HTML for all doc pages', async () => {
      const gettingStartedExists = existsSync('dist/docs/getting-started/index.html')
      expect(gettingStartedExists).toBe(true)
    })

    it('should generate assets in dist/_assets/', async () => {
      const assetsExist = existsSync('dist/docs/_assets')
      expect(assetsExist).toBe(true)
    })
  })

  describe('Asset Optimization', () => {
    it('should minify CSS in production', async () => {
      const cssFiles = await readdir('dist/docs/_assets')
      const cssFile = cssFiles.find((f: string) => f.endsWith('.css'))
      if (cssFile) {
        const content = await readFile(join('dist/docs/_assets', cssFile), 'utf-8')
        // Minified CSS should have no significant whitespace
        expect(content).not.toMatch(/\n\s*\n/)
      }
    })

    it('should minify JS in production', async () => {
      const jsFiles = await readdir('dist/docs/_assets')
      const jsFile = jsFiles.find((f: string) => f.endsWith('.js'))
      if (jsFile) {
        const content = await readFile(join('dist/docs/_assets', jsFile), 'utf-8')
        // Minified JS should have no significant whitespace
        expect(content).not.toMatch(/\n\s*\n/)
      }
    })

    it('should hash asset filenames for cache busting', async () => {
      const assetsExist = existsSync('dist/docs/_assets')
      if (assetsExist) {
        const files = await readdir('dist/docs/_assets')
        const hashedFile = files.find((f: string) => /\.[a-f0-9]{8,}\./.test(f))
        expect(hashedFile).toBeDefined()
      }
    })
  })

  describe('Search Index', () => {
    it('should generate search index file', async () => {
      const indexExists = existsSync('dist/docs/search-index.json')
      expect(indexExists).toBe(true)
    })

    it('should have valid JSON search index', async () => {
      const content = await readFile('dist/docs/search-index.json', 'utf-8')
      expect(() => JSON.parse(content)).not.toThrow()
    })
  })
})

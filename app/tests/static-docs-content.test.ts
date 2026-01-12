import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { readFile, readdir } from 'fs/promises'
import { join } from 'path'

/**
 * Static Documentation HTML Content Tests - TDD RED PHASE
 *
 * These tests verify that the static docs build produces REAL HTML content,
 * not just an empty SPA shell that relies on client-side hydration.
 *
 * EXPECTED: All tests WILL FAIL initially. This is TDD RED phase.
 * The purpose is to define the expected behavior before implementation.
 *
 * What we're testing:
 * 1. HTML contains actual page content (not just empty divs for hydration)
 * 2. MDX content is rendered to HTML (headings, paragraphs, lists)
 * 3. Code blocks have syntax highlighting classes
 * 4. Navigation sidebar is pre-rendered in the HTML
 * 5. SEO meta tags are present (title, description, og:title, etc.)
 *
 * The dist/docs/ directory should contain pre-rendered HTML that:
 * - Can be indexed by search engines without JavaScript
 * - Provides immediate content for users (no flash of empty content)
 * - Has proper SEO metadata for each page
 */

// Path to the static docs build output
const DOCS_DIST = join(process.cwd(), 'dist/docs')
const APP_DIST = join(process.cwd(), 'app/dist/docs')

// Helper to find the docs dist directory (could be in either location)
function getDocsDistPath(): string {
  if (existsSync(DOCS_DIST)) return DOCS_DIST
  if (existsSync(APP_DIST)) return APP_DIST
  // Return default path for test failure messages
  return DOCS_DIST
}

// Helper to read an HTML file from the docs dist
async function readDocsHtml(path: string): Promise<string> {
  const docsPath = getDocsDistPath()
  // Try with and without .html extension and index.html
  const possiblePaths = [
    join(docsPath, path),
    join(docsPath, path, 'index.html'),
    join(docsPath, `${path}.html`),
    join(docsPath, path.replace(/^\//, '')),
    join(docsPath, path.replace(/^\//, ''), 'index.html'),
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return readFile(p, 'utf-8')
    }
  }

  // Return empty string to trigger test failure with meaningful message
  throw new Error(
    `No HTML file found at any of:\n${possiblePaths.join('\n')}\n\nMake sure to run 'npm run build:app' to generate static docs.`
  )
}

// ============================================================================
// TDD RED PHASE: Pre-check that dist/docs exists
// ============================================================================

describe('TDD RED: Static Docs Build Output', () => {
  it('should have dist/docs directory with build output', () => {
    const docsPath = getDocsDistPath()
    expect(
      existsSync(docsPath),
      `Expected ${docsPath} to exist. Run 'npm run build:app' to generate static docs.`
    ).toBe(true)
  })

  it('should have index.html in dist/docs', () => {
    const docsPath = getDocsDistPath()
    const indexPath = join(docsPath, 'index.html')
    expect(
      existsSync(indexPath),
      `Expected ${indexPath} to exist for docs landing page`
    ).toBe(true)
  })
})

// ============================================================================
// TDD RED: 1. HTML Contains Actual Page Content
// ============================================================================

describe('TDD RED: Static HTML Contains Actual Content', () => {
  describe('Docs Landing Page', () => {
    let html: string

    beforeAll(async () => {
      try {
        html = await readDocsHtml('index.html')
      } catch {
        html = ''
      }
    })

    it('should contain actual text content, not just empty hydration shell', () => {
      // An empty SPA shell typically has just a root div like <div id="root"></div>
      // Real content should have substantial text
      const textContent = html.replace(/<[^>]*>/g, '').trim()
      expect(
        textContent.length,
        'HTML should contain substantial text content, not just empty divs'
      ).toBeGreaterThan(500)
    })

    it('should NOT be just a minimal SPA shell', () => {
      // Check for signs of empty SPA shell
      const emptySpaPatterns = [
        /<div\s+id=["'](?:root|app|__next)["']\s*>\s*<\/div>/i,
        /<body[^>]*>\s*<div[^>]*>\s*<\/div>\s*<script/i,
      ]

      for (const pattern of emptySpaPatterns) {
        expect(
          html,
          'HTML should not be an empty SPA shell with just a root div'
        ).not.toMatch(pattern)
      }
    })

    it('should contain page-specific content from the docs', () => {
      // The docs index page should contain text from docs/index.mdx
      // These are actual phrases from the documentation
      const expectedContent = [
        'dotdo',
        'Business-as-Code',
        'AI agents',
      ]

      for (const content of expectedContent) {
        expect(
          html.toLowerCase(),
          `Expected HTML to contain "${content}" from the docs content`
        ).toContain(content.toLowerCase())
      }
    })
  })

  describe('Getting Started Page', () => {
    let html: string

    beforeAll(async () => {
      try {
        html = await readDocsHtml('getting-started/index.html')
      } catch {
        html = ''
      }
    })

    it('should have pre-rendered content from getting-started MDX', () => {
      // Check for actual content from docs/getting-started/index.mdx
      expect(
        html.length,
        'Getting started page should have substantial content'
      ).toBeGreaterThan(1000)
    })
  })
})

// ============================================================================
// TDD RED: 2. MDX Content is Rendered to HTML
// ============================================================================

describe('TDD RED: MDX Content Rendered to HTML', () => {
  let html: string

  beforeAll(async () => {
    try {
      // Use installation page which has various MDX elements
      html = await readDocsHtml('getting-started/installation.html')
    } catch {
      html = ''
    }
  })

  describe('Headings', () => {
    it('should render H1 heading from MDX', () => {
      expect(html).toMatch(/<h1[^>]*>.*Installation.*<\/h1>/is)
    })

    it('should render H2 headings from MDX sections', () => {
      const h2Pattern = /<h2[^>]*>.*<\/h2>/gi
      const matches = html.match(h2Pattern) || []
      expect(
        matches.length,
        'Expected multiple H2 headings from MDX sections'
      ).toBeGreaterThan(0)
    })

    it('should have heading IDs for anchor linking', () => {
      // Fumadocs generates IDs for headings
      expect(html).toMatch(/<h[2-6][^>]+id=["'][^"']+["']/i)
    })
  })

  describe('Paragraphs', () => {
    it('should render paragraphs from MDX content', () => {
      const pPattern = /<p[^>]*>[^<]{20,}<\/p>/gi
      const matches = html.match(pPattern) || []
      expect(
        matches.length,
        'Expected multiple paragraphs with substantial content'
      ).toBeGreaterThan(0)
    })
  })

  describe('Lists', () => {
    it('should render unordered lists from MDX', () => {
      expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>.*<\/li>.*<\/ul>/is)
    })
  })

  describe('Tables', () => {
    it('should render tables from MDX', () => {
      // The installation page has a table for TypeScript config options
      expect(html).toMatch(/<table[^>]*>/i)
      expect(html).toMatch(/<th[^>]*>|<thead[^>]*>/i)
    })
  })

  describe('Callouts', () => {
    it('should render callout/admonition components from MDX', () => {
      // Fumadocs uses callout components - they should be rendered
      // Look for common callout patterns
      const calloutPatterns = [
        /class=["'][^"']*callout[^"']*["']/i,
        /class=["'][^"']*admonition[^"']*["']/i,
        /data-callout/i,
        /role=["']alert["']/i,
      ]

      const hasCallout = calloutPatterns.some(pattern => pattern.test(html))
      expect(hasCallout, 'Expected callout/admonition components to be rendered').toBe(true)
    })
  })
})

// ============================================================================
// TDD RED: 3. Code Blocks Have Syntax Highlighting
// ============================================================================

describe('TDD RED: Code Blocks Have Syntax Highlighting', () => {
  let html: string

  beforeAll(async () => {
    try {
      // Use installation page which has multiple code blocks
      html = await readDocsHtml('getting-started/installation.html')
    } catch {
      html = ''
    }
  })

  it('should render code blocks in pre/code elements', () => {
    expect(html).toMatch(/<pre[^>]*>.*<code[^>]*>/is)
  })

  it('should have syntax highlighting classes on code blocks', () => {
    // Fumadocs uses rehype-pretty-code or similar for syntax highlighting
    // These add specific data attributes or classes
    const highlightingPatterns = [
      /data-rehype-pretty-code/i,
      /data-highlighted/i,
      /class=["'][^"']*(?:shiki|highlight|syntax|code-block)[^"']*["']/i,
      /data-language/i,
      /data-theme/i,
    ]

    const hasHighlighting = highlightingPatterns.some(pattern => pattern.test(html))
    expect(
      hasHighlighting,
      'Expected code blocks to have syntax highlighting attributes/classes (rehype-pretty-code, shiki, etc.)'
    ).toBe(true)
  })

  it('should have language indicator on code blocks', () => {
    // Code blocks should indicate their language (bash, typescript, json, etc.)
    const languagePatterns = [
      /data-language=["'](?:bash|typescript|ts|json|javascript|js)["']/i,
      /class=["'][^"']*language-(?:bash|typescript|ts|json|javascript|js)[^"']*["']/i,
      /lang=["'](?:bash|typescript|ts|json|javascript|js)["']/i,
    ]

    const hasLanguage = languagePatterns.some(pattern => pattern.test(html))
    expect(
      hasLanguage,
      'Expected code blocks to have language indicators'
    ).toBe(true)
  })

  it('should have colored syntax tokens in code blocks', () => {
    // Syntax highlighting produces span elements with color/style attributes
    const syntaxTokenPatterns = [
      /<span[^>]+style=["'][^"']*color[^"']*["'][^>]*>/i,
      /<span[^>]+class=["'][^"']*(?:token|punctuation|keyword|string|comment)[^"']*["']/i,
    ]

    const hasTokens = syntaxTokenPatterns.some(pattern => pattern.test(html))
    expect(
      hasTokens,
      'Expected syntax-highlighted code to have colored tokens (spans with color styles or token classes)'
    ).toBe(true)
  })

  it('should have code block filename/title when specified in MDX', () => {
    // The installation page has code blocks with titles like "wrangler.jsonc"
    const titlePatterns = [
      /data-title/i,
      /class=["'][^"']*(?:code-title|filename|code-header)[^"']*["']/i,
      />wrangler\.jsonc</i,
      /title=["']/i,
    ]

    const hasTitle = titlePatterns.some(pattern => pattern.test(html))
    expect(
      hasTitle,
      'Expected some code blocks to have filename/title indicators'
    ).toBe(true)
  })
})

// ============================================================================
// TDD RED: 4. Navigation Sidebar is Pre-Rendered
// ============================================================================

describe('TDD RED: Navigation Sidebar Pre-Rendered', () => {
  let html: string

  beforeAll(async () => {
    try {
      html = await readDocsHtml('index.html')
    } catch {
      html = ''
    }
  })

  it('should have navigation/sidebar element in HTML', () => {
    const navPatterns = [
      /<nav[^>]*>/i,
      /<aside[^>]*>/i,
      /class=["'][^"']*(?:sidebar|nav|navigation)[^"']*["']/i,
      /role=["']navigation["']/i,
    ]

    const hasNav = navPatterns.some(pattern => pattern.test(html))
    expect(hasNav, 'Expected navigation/sidebar element to be pre-rendered').toBe(true)
  })

  it('should have navigation links to doc sections', () => {
    // Sidebar should contain links to major doc sections
    const expectedSections = [
      'getting-started',
      'concepts',
      'api',
      'sdk',
    ]

    for (const section of expectedSections) {
      expect(
        html.toLowerCase(),
        `Expected sidebar to have link to ${section} section`
      ).toMatch(new RegExp(`href=["'][^"']*${section}[^"']*["']`, 'i'))
    }
  })

  it('should have nested navigation structure', () => {
    // Sidebar should have nested ul/li structure for sections and subsections
    const nestedPattern = /<ul[^>]*>[\s\S]*<li[^>]*>[\s\S]*<ul[^>]*>[\s\S]*<li[^>]*>/i
    expect(
      html,
      'Expected sidebar to have nested navigation structure (ul > li > ul > li)'
    ).toMatch(nestedPattern)
  })

  it('should have aria labels for accessibility', () => {
    // Navigation should have proper accessibility attributes
    const ariaPatterns = [
      /aria-label=["'][^"']*(?:navigation|sidebar|menu)[^"']*["']/i,
      /role=["']navigation["']/i,
      /aria-current/i,
    ]

    const hasAria = ariaPatterns.some(pattern => pattern.test(html))
    expect(
      hasAria,
      'Expected navigation to have ARIA attributes for accessibility'
    ).toBe(true)
  })

  it('should pre-render table of contents for the page', () => {
    // Fumadocs renders a table of contents from page headings
    const tocPatterns = [
      /class=["'][^"']*(?:toc|table-of-contents|on-this-page)[^"']*["']/i,
      /aria-label=["'][^"']*(?:table of contents|on this page)[^"']*["']/i,
    ]

    const hasToc = tocPatterns.some(pattern => pattern.test(html))
    expect(
      hasToc,
      'Expected table of contents to be pre-rendered'
    ).toBe(true)
  })
})

// ============================================================================
// TDD RED: 5. SEO Meta Tags Present
// ============================================================================

describe('TDD RED: SEO Meta Tags Present', () => {
  let indexHtml: string
  let installHtml: string

  beforeAll(async () => {
    try {
      indexHtml = await readDocsHtml('index.html')
      installHtml = await readDocsHtml('getting-started/installation.html')
    } catch {
      indexHtml = ''
      installHtml = ''
    }
  })

  describe('Basic Meta Tags', () => {
    it('should have title tag', () => {
      expect(indexHtml).toMatch(/<title>[^<]+<\/title>/i)
    })

    it('should have unique title per page', () => {
      const indexTitle = indexHtml.match(/<title>([^<]+)<\/title>/i)?.[1]
      const installTitle = installHtml.match(/<title>([^<]+)<\/title>/i)?.[1]

      expect(indexTitle, 'Index page should have a title').toBeDefined()
      expect(installTitle, 'Installation page should have a title').toBeDefined()
      expect(
        indexTitle,
        'Titles should be unique per page'
      ).not.toBe(installTitle)
    })

    it('should have meta description', () => {
      expect(indexHtml).toMatch(/<meta[^>]+name=["']description["'][^>]*>/i)
    })

    it('should have description with actual content', () => {
      const descMatch = indexHtml.match(
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
      ) || indexHtml.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i
      )

      expect(descMatch, 'Expected meta description tag').not.toBeNull()
      expect(
        descMatch![1].length,
        'Meta description should have substantial content'
      ).toBeGreaterThan(20)
    })

    it('should have viewport meta tag', () => {
      expect(indexHtml).toMatch(/<meta[^>]+name=["']viewport["']/i)
    })

    it('should have charset declaration', () => {
      expect(indexHtml).toMatch(/<meta[^>]+charset=["']utf-8["']/i)
    })

    it('should have lang attribute on html element', () => {
      expect(indexHtml).toMatch(/<html[^>]+lang=["'][a-z]{2}/i)
    })
  })

  describe('Open Graph Tags', () => {
    it('should have og:title', () => {
      expect(indexHtml).toMatch(/<meta[^>]+property=["']og:title["']/i)
    })

    it('should have og:description', () => {
      expect(indexHtml).toMatch(/<meta[^>]+property=["']og:description["']/i)
    })

    it('should have og:type', () => {
      expect(indexHtml).toMatch(/<meta[^>]+property=["']og:type["']/i)
    })

    it('should have og:url', () => {
      expect(indexHtml).toMatch(/<meta[^>]+property=["']og:url["']/i)
    })

    it('should have og:image', () => {
      expect(indexHtml).toMatch(/<meta[^>]+property=["']og:image["']/i)
    })

    it('should have og:site_name', () => {
      expect(indexHtml).toMatch(/<meta[^>]+property=["']og:site_name["']/i)
    })
  })

  describe('Twitter Card Tags', () => {
    it('should have twitter:card', () => {
      expect(indexHtml).toMatch(/<meta[^>]+name=["']twitter:card["']/i)
    })

    it('should have twitter:title', () => {
      expect(indexHtml).toMatch(/<meta[^>]+name=["']twitter:title["']/i)
    })

    it('should have twitter:description', () => {
      expect(indexHtml).toMatch(/<meta[^>]+name=["']twitter:description["']/i)
    })
  })

  describe('Canonical URL', () => {
    it('should have canonical link', () => {
      expect(indexHtml).toMatch(/<link[^>]+rel=["']canonical["']/i)
    })

    it('should have absolute canonical URL', () => {
      const canonicalMatch = indexHtml.match(
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
      ) || indexHtml.match(
        /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i
      )

      expect(canonicalMatch, 'Expected canonical link').not.toBeNull()
      expect(
        canonicalMatch![1],
        'Canonical URL should be absolute'
      ).toMatch(/^https?:\/\//)
    })
  })

  describe('JSON-LD Structured Data', () => {
    it('should have JSON-LD script tag', () => {
      expect(indexHtml).toMatch(/<script[^>]+type=["']application\/ld\+json["']/i)
    })

    it('should have valid JSON-LD content', () => {
      const jsonLdMatch = indexHtml.match(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
      )

      expect(jsonLdMatch, 'Expected JSON-LD script tag').not.toBeNull()
      expect(() => JSON.parse(jsonLdMatch![1]), 'JSON-LD should be valid JSON').not.toThrow()
    })

    it('should have schema.org context', () => {
      const jsonLdMatch = indexHtml.match(
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
      )

      if (jsonLdMatch) {
        const jsonLd = JSON.parse(jsonLdMatch[1])
        expect(jsonLd['@context']).toBe('https://schema.org')
      }
    })
  })
})

// ============================================================================
// TDD RED: Cross-Page Content Verification
// ============================================================================

describe('TDD RED: Multiple Pages Have Real Content', () => {
  const pagesToTest = [
    { path: 'index.html', name: 'Docs Index' },
    { path: 'getting-started/index.html', name: 'Getting Started' },
    { path: 'getting-started/installation.html', name: 'Installation' },
    { path: 'concepts/index.html', name: 'Concepts' },
    { path: 'api/index.html', name: 'API Reference' },
  ]

  for (const { path, name } of pagesToTest) {
    describe(`${name} (${path})`, () => {
      let html: string

      beforeAll(async () => {
        try {
          html = await readDocsHtml(path)
        } catch {
          html = ''
        }
      })

      it(`should exist and have content`, () => {
        expect(
          html.length,
          `${name} page should exist and have content`
        ).toBeGreaterThan(0)
      })

      it('should have rendered body content', () => {
        // Extract body content and check it's not empty
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
        expect(bodyMatch, 'Should have body element').not.toBeNull()

        const bodyContent = bodyMatch![1].replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        const textContent = bodyContent.replace(/<[^>]*>/g, '').trim()

        expect(
          textContent.length,
          `${name} body should have substantial text content (not just scripts)`
        ).toBeGreaterThan(100)
      })

      it('should have title tag with content', () => {
        expect(html).toMatch(/<title>[^<]+<\/title>/i)
      })
    })
  }
})

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * TDD RED PHASE: Static Documentation HTML Files Tests
 *
 * These tests verify that static HTML files are generated in dist/docs after build.
 * They are expected to FAIL until the static docs generation is implemented.
 *
 * Issue: dotdo-45yx8
 *
 * Expected behavior after implementation:
 * - Build process generates static HTML files in app/dist/docs/
 * - Each MDX file in docs/ has a corresponding index.html in dist/docs/
 * - Directory structure is preserved (e.g., docs/api/index.mdx -> dist/docs/api/index.html)
 */

const DIST_DOCS_DIR = join(__dirname, '..', 'dist', 'docs')
const DOCS_SOURCE_DIR = join(__dirname, '..', '..', 'docs')

/**
 * Recursively find all MDX files in a directory
 */
function findMdxFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      findMdxFiles(fullPath, files)
    } else if (entry.endsWith('.mdx')) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Convert MDX source path to expected HTML output path
 * e.g., docs/api/index.mdx -> dist/docs/api/index.html
 *       docs/api/routes.mdx -> dist/docs/api/routes/index.html
 */
function mdxToHtmlPath(mdxPath: string): string {
  const relativePath = relative(DOCS_SOURCE_DIR, mdxPath)
  const withoutExt = relativePath.replace(/\.mdx$/, '')

  // index.mdx files become index.html in the same directory
  // other files become directory/index.html
  if (withoutExt.endsWith('/index') || withoutExt === 'index') {
    return join(DIST_DOCS_DIR, withoutExt + '.html')
  }

  return join(DIST_DOCS_DIR, withoutExt, 'index.html')
}

// ============================================================================
// 1. Core Static File Existence Tests
// ============================================================================

describe('TDD RED: Static docs HTML files exist in dist/docs after build', () => {
  describe('dist/docs directory existence', () => {
    it('should have dist/docs directory after build', () => {
      expect(existsSync(DIST_DOCS_DIR)).toBe(true)
    })
  })

  describe('core documentation pages', () => {
    it('should have dist/docs/index.html (docs homepage)', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })

    it('should have dist/docs/getting-started/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'getting-started', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })

    it('should have dist/docs/getting-started/installation/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'getting-started', 'installation', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })

    it('should have dist/docs/getting-started/quickstart/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'getting-started', 'quickstart', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })
  })

  describe('API documentation pages', () => {
    it('should have dist/docs/api/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'api', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })

    it('should have dist/docs/api/authentication/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'api', 'authentication', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })

    it('should have dist/docs/api/routes/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'api', 'routes', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })
  })

  describe('concepts documentation pages', () => {
    it('should have dist/docs/concepts/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'concepts', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })

    it('should have dist/docs/concepts/things/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'concepts', 'things', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })
  })

  describe('integrations documentation pages', () => {
    it('should have dist/docs/integrations/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'integrations', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })

    it('should have dist/docs/integrations/stripe/index.html', () => {
      const htmlPath = join(DIST_DOCS_DIR, 'integrations', 'stripe', 'index.html')
      expect(existsSync(htmlPath)).toBe(true)
    })
  })
})

// ============================================================================
// 2. Comprehensive MDX to HTML Mapping Tests
// ============================================================================

describe('TDD RED: All MDX files have corresponding HTML in dist/docs', () => {
  const mdxFiles = findMdxFiles(DOCS_SOURCE_DIR)

  it('should find MDX source files to test', () => {
    // This test verifies our test setup works
    expect(mdxFiles.length).toBeGreaterThan(0)
  })

  it('should have HTML files for all MDX files (comprehensive check)', () => {
    const missingHtmlFiles: string[] = []

    for (const mdxPath of mdxFiles) {
      const expectedHtmlPath = mdxToHtmlPath(mdxPath)
      if (!existsSync(expectedHtmlPath)) {
        missingHtmlFiles.push(relative(DOCS_SOURCE_DIR, mdxPath))
      }
    }

    // Report all missing files in the error message
    if (missingHtmlFiles.length > 0) {
      const sampleMissing = missingHtmlFiles.slice(0, 10)
      const message = `Missing HTML files for ${missingHtmlFiles.length} MDX files:\n` +
        sampleMissing.map(f => `  - ${f}`).join('\n') +
        (missingHtmlFiles.length > 10 ? `\n  ... and ${missingHtmlFiles.length - 10} more` : '')
      expect(missingHtmlFiles).toEqual([])
    }
  })

  // Generate individual tests for key documentation sections
  const keyDocSections = [
    'index.mdx',
    'why-dotdo.mdx',
    'getting-started/index.mdx',
    'getting-started/installation.mdx',
    'getting-started/quickstart.mdx',
    'api/index.mdx',
    'concepts/index.mdx',
    'sdk/index.mdx',
    'integrations/index.mdx',
    'deployment/index.mdx',
    'security/index.mdx',
    'cli/index.mdx',
    'tutorials/index.mdx',
  ]

  describe('key documentation sections have HTML files', () => {
    for (const section of keyDocSections) {
      it(`should have HTML for ${section}`, () => {
        const mdxPath = join(DOCS_SOURCE_DIR, section)
        const htmlPath = mdxToHtmlPath(mdxPath)
        expect(existsSync(htmlPath)).toBe(true)
      })
    }
  })
})

// ============================================================================
// 3. HTML File Content Validation Tests
// ============================================================================

describe('TDD RED: Generated HTML files have valid content', () => {
  it('should have non-empty index.html', async () => {
    const htmlPath = join(DIST_DOCS_DIR, 'index.html')

    if (existsSync(htmlPath)) {
      const { readFile } = await import('fs/promises')
      const content = await readFile(htmlPath, 'utf-8')
      expect(content.length).toBeGreaterThan(100)
    } else {
      // Fail the test - file doesn't exist
      expect(existsSync(htmlPath)).toBe(true)
    }
  })

  it('should have valid HTML5 doctype in index.html', async () => {
    const htmlPath = join(DIST_DOCS_DIR, 'index.html')

    if (existsSync(htmlPath)) {
      const { readFile } = await import('fs/promises')
      const content = await readFile(htmlPath, 'utf-8')
      expect(content.toLowerCase()).toContain('<!doctype html>')
    } else {
      expect(existsSync(htmlPath)).toBe(true)
    }
  })

  it('should have html, head, and body tags', async () => {
    const htmlPath = join(DIST_DOCS_DIR, 'index.html')

    if (existsSync(htmlPath)) {
      const { readFile } = await import('fs/promises')
      const content = await readFile(htmlPath, 'utf-8')
      expect(content).toMatch(/<html[^>]*>/i)
      expect(content).toMatch(/<head>/i)
      expect(content).toMatch(/<body[^>]*>/i)
    } else {
      expect(existsSync(htmlPath)).toBe(true)
    }
  })
})

// ============================================================================
// 4. Directory Structure Tests
// ============================================================================

describe('TDD RED: dist/docs maintains proper directory structure', () => {
  const expectedDirectories = [
    'getting-started',
    'api',
    'concepts',
    'sdk',
    'integrations',
    'deployment',
    'security',
    'cli',
    'tutorials',
    'guides',
    'primitives',
    'workflows',
    'agents',
    'rpc',
    'storage',
    'observability',
    'architecture',
    'compat',
    'humans',
    'mcp',
    'migration',
    'transport',
    'ui',
    'platform',
    'events',
    'functions',
    'actions',
    'objects',
    'database',
  ]

  for (const dir of expectedDirectories) {
    it(`should have dist/docs/${dir}/ directory`, () => {
      const dirPath = join(DIST_DOCS_DIR, dir)
      expect(existsSync(dirPath)).toBe(true)
    })
  }
})

// ============================================================================
// 5. Static Asset Tests
// ============================================================================

describe('TDD RED: Static docs assets are generated', () => {
  it('should have _assets or assets directory in dist/docs', () => {
    const assetsPath = join(DIST_DOCS_DIR, '_assets')
    const altAssetsPath = join(DIST_DOCS_DIR, 'assets')
    expect(existsSync(assetsPath) || existsSync(altAssetsPath)).toBe(true)
  })

  it('should have search index file', () => {
    const searchIndexPaths = [
      join(DIST_DOCS_DIR, 'search-index.json'),
      join(DIST_DOCS_DIR, '_assets', 'search-index.json'),
      join(DIST_DOCS_DIR, 'static', 'search-index.json'),
    ]
    const exists = searchIndexPaths.some(p => existsSync(p))
    expect(exists).toBe(true)
  })
})

// ============================================================================
// 6. MDX File Count Verification
// ============================================================================

describe('TDD RED: All 202 MDX files are accounted for', () => {
  it('should have source MDX files to generate from', () => {
    const mdxFiles = findMdxFiles(DOCS_SOURCE_DIR)
    // We know there are ~202 MDX files from our earlier check
    expect(mdxFiles.length).toBeGreaterThanOrEqual(200)
  })

  it('should generate HTML for at least 200 documentation pages', () => {
    if (!existsSync(DIST_DOCS_DIR)) {
      expect(existsSync(DIST_DOCS_DIR)).toBe(true)
      return
    }

    // Count HTML files in dist/docs
    function countHtmlFiles(dir: string): number {
      if (!existsSync(dir)) return 0

      let count = 0
      const entries = readdirSync(dir)

      for (const entry of entries) {
        const fullPath = join(dir, entry)
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          count += countHtmlFiles(fullPath)
        } else if (entry.endsWith('.html')) {
          count++
        }
      }

      return count
    }

    const htmlCount = countHtmlFiles(DIST_DOCS_DIR)
    expect(htmlCount).toBeGreaterThanOrEqual(200)
  })
})

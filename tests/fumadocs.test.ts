/**
 * Fumadocs Content Collections Tests
 *
 * RED phase: These tests verify the Fumadocs content collection setup.
 * All tests should FAIL until the GREEN phase implements the actual files.
 *
 * @see https://fumadocs.dev/docs/headless/source-api
 * @see https://fumadocs.dev/docs/mdx/next
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const LIB_DIR = path.join(ROOT, 'lib')
const DOCS_DIR = path.join(ROOT, 'docs')

describe('Fumadocs Content Collections', () => {
  describe('source.ts configuration', () => {
    const sourcePath = path.join(LIB_DIR, 'source.ts')

    it('should exist at lib/source.ts', () => {
      expect(fs.existsSync(sourcePath)).toBe(true)
    })

    it('should export source object from loader', async () => {
      const module = await import(sourcePath)
      expect(module.source).toBeDefined()
    })

    it('should configure loader with baseUrl /docs', async () => {
      const content = fs.readFileSync(sourcePath, 'utf-8')
      // Should use fumadocs-core/source loader
      expect(content).toMatch(/from\s+['"]fumadocs-core\/source['"]/)
      // Should configure baseUrl
      expect(content).toMatch(/baseUrl:\s*['"]\/docs['"]/)
    })

    it('should import docs collection', async () => {
      const content = fs.readFileSync(sourcePath, 'utf-8')
      // Should import from fumadocs-mdx collections
      expect(content).toMatch(/fumadocs-mdx/)
    })
  })

  describe('source.config.ts configuration', () => {
    const configPath = path.join(ROOT, 'source.config.ts')

    it('should exist at source.config.ts', () => {
      expect(fs.existsSync(configPath)).toBe(true)
    })

    it('should use defineDocs to configure docs collection', async () => {
      const content = fs.readFileSync(configPath, 'utf-8')
      // Should import defineDocs from fumadocs-mdx/config
      expect(content).toMatch(/defineDocs/)
      expect(content).toMatch(/fumadocs-mdx\/config/)
    })

    it('should point docs collection to docs/ directory', async () => {
      const content = fs.readFileSync(configPath, 'utf-8')
      // Should configure dir to point to docs
      expect(content).toMatch(/dir:\s*['"]docs['"]/)
    })

    it('should export defineConfig default', async () => {
      const content = fs.readFileSync(configPath, 'utf-8')
      expect(content).toMatch(/defineConfig/)
      expect(content).toMatch(/export\s+default/)
    })
  })

  describe('docs/ directory content structure', () => {
    it('should have docs directory', () => {
      expect(fs.existsSync(DOCS_DIR)).toBe(true)
    })

    it('should have MDX files in docs/', () => {
      const hasContent = fs.readdirSync(DOCS_DIR, { recursive: true })
        .some(file => String(file).endsWith('.mdx'))
      expect(hasContent).toBe(true)
    })

    it('should have meta.json files for navigation structure', () => {
      // Check that at least one meta.json exists for nav structure
      const hasMeta = fs.readdirSync(DOCS_DIR, { recursive: true })
        .some(file => String(file).endsWith('meta.json'))
      expect(hasMeta).toBe(true)
    })
  })

  describe('meta.json structure', () => {
    const metaPath = path.join(DOCS_DIR, 'getting-started/meta.json')

    it('should exist in docs/getting-started/', () => {
      expect(fs.existsSync(metaPath)).toBe(true)
    })

    it('should have valid JSON structure', () => {
      const content = fs.readFileSync(metaPath, 'utf-8')
      const meta = JSON.parse(content)
      expect(meta).toBeDefined()
    })

    it('should have title property', () => {
      const content = fs.readFileSync(metaPath, 'utf-8')
      const meta = JSON.parse(content)
      expect(meta.title).toBeDefined()
      expect(typeof meta.title).toBe('string')
    })

    it('should have pages array for navigation order', () => {
      const content = fs.readFileSync(metaPath, 'utf-8')
      const meta = JSON.parse(content)
      expect(meta.pages).toBeDefined()
      expect(Array.isArray(meta.pages)).toBe(true)
    })
  })

  describe('MDX frontmatter parsing', () => {
    const indexMdxPath = path.join(DOCS_DIR, 'getting-started/index.mdx')

    it('should exist in docs/getting-started/', () => {
      expect(fs.existsSync(indexMdxPath)).toBe(true)
    })

    it('should have frontmatter with title', () => {
      const content = fs.readFileSync(indexMdxPath, 'utf-8')
      // Check for frontmatter format: ---\ntitle: ...\n---
      expect(content).toMatch(/^---[\s\S]*?title:[\s\S]*?---/m)
    })

    it('should have frontmatter with description', () => {
      const content = fs.readFileSync(indexMdxPath, 'utf-8')
      // Check for description in frontmatter
      expect(content).toMatch(/^---[\s\S]*?description:[\s\S]*?---/m)
    })
  })

  describe('search index configuration', () => {
    const searchApiPath = path.join(ROOT, 'app/api/search/route.ts')

    it('should have search API route at app/api/search/route.ts', () => {
      expect(fs.existsSync(searchApiPath)).toBe(true)
    })

    it('should use createFromSource or createSearchAPI', async () => {
      const content = fs.readFileSync(searchApiPath, 'utf-8')
      // Should use one of the Fumadocs search server functions
      const hasCreateFromSource = content.includes('createFromSource')
      const hasCreateSearchAPI = content.includes('createSearchAPI')
      expect(hasCreateFromSource || hasCreateSearchAPI).toBe(true)
    })

    it('should import from fumadocs-core/search/server', async () => {
      const content = fs.readFileSync(searchApiPath, 'utf-8')
      expect(content).toMatch(/fumadocs-core\/search\/server/)
    })

    it('should export GET handler', async () => {
      const content = fs.readFileSync(searchApiPath, 'utf-8')
      expect(content).toMatch(/export\s+.*\bGET\b/)
    })
  })

  describe('navigation structure generation', () => {
    it('should be able to generate page tree from source', async () => {
      // This test verifies that the source.getPageTree() method works
      // It will fail until source.ts is properly configured
      const sourcePath = path.join(LIB_DIR, 'source.ts')
      const module = await import(sourcePath)

      expect(module.source.getPageTree).toBeDefined()
      expect(typeof module.source.getPageTree).toBe('function')
    })

    it('should be able to get all pages', async () => {
      // This test verifies that the source.getPages() method works
      const sourcePath = path.join(LIB_DIR, 'source.ts')
      const module = await import(sourcePath)

      expect(module.source.getPages).toBeDefined()
      expect(typeof module.source.getPages).toBe('function')
    })

    it('should be able to get single page by slug', async () => {
      // This test verifies that the source.getPage() method works
      const sourcePath = path.join(LIB_DIR, 'source.ts')
      const module = await import(sourcePath)

      expect(module.source.getPage).toBeDefined()
      expect(typeof module.source.getPage).toBe('function')
    })
  })

  describe('fumadocs dependencies', () => {
    const packageJsonPath = path.join(ROOT, 'package.json')

    it('should have fumadocs-core dependency', () => {
      const content = fs.readFileSync(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(content)
      const hasFumadocsCore =
        pkg.dependencies?.['fumadocs-core'] ||
        pkg.devDependencies?.['fumadocs-core']
      expect(hasFumadocsCore).toBeDefined()
    })

    it('should have fumadocs-mdx dependency', () => {
      const content = fs.readFileSync(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(content)
      const hasFumadocsMdx =
        pkg.dependencies?.['fumadocs-mdx'] ||
        pkg.devDependencies?.['fumadocs-mdx']
      expect(hasFumadocsMdx).toBeDefined()
    })

    it('should have fumadocs-ui dependency', () => {
      const content = fs.readFileSync(packageJsonPath, 'utf-8')
      const pkg = JSON.parse(content)
      const hasFumadocsUi =
        pkg.dependencies?.['fumadocs-ui'] ||
        pkg.devDependencies?.['fumadocs-ui']
      expect(hasFumadocsUi).toBeDefined()
    })
  })
})

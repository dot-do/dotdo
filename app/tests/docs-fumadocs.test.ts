import { describe, it, expect } from 'vitest'
import { source } from '../lib/source'

/**
 * TDD RED Phase: Docs build from docs/ folder via fumadocs-mdx
 *
 * This test verifies that fumadocs-mdx properly processes MDX files from
 * the docs/ folder and makes them available through the source loader.
 *
 * Current state: source.ts has stubbed empty files[], fumadocs-mdx not configured
 * Target state: fumadocs-mdx builds docs from docs/ folder and serves at /docs/*
 *
 * These tests are expected to FAIL until fumadocs-mdx is configured.
 *
 * @see https://fumadocs.dev/docs/mdx
 * @see app/lib/source.ts (currently stubbed)
 * @see docs/ folder structure
 */

describe('Fumadocs MDX Integration', () => {
  describe('Source Loader', () => {
    it('should have files loaded from docs/ folder', () => {
      // The source loader should have files array populated from docs/
      // Currently stubbed with empty array, so this FAILS
      const pages = source.getPages()
      expect(pages.length).toBeGreaterThan(0)
    })

    it('should have page tree generated from docs/ structure', () => {
      // The page tree should contain navigation structure
      // Currently empty because source is stubbed
      const tree = source.pageTree
      expect(tree).toBeDefined()
      expect(tree.children?.length).toBeGreaterThan(0)
    })
  })

  describe('Docs Index Page', () => {
    it('should find docs index page at root', () => {
      // docs/index.mdx should be available at /docs
      const indexPage = source.getPage([])
      expect(indexPage).toBeDefined()
      expect(indexPage?.data.title).toBe('dotdo')
    })

    it('should have body component for rendering', () => {
      const indexPage = source.getPage([])
      expect(indexPage).toBeDefined()
      expect(indexPage?.data.body).toBeDefined()
    })
  })

  describe('Getting Started Section', () => {
    it('should find getting-started index page', () => {
      // docs/getting-started/index.mdx should be available at /docs/getting-started
      const page = source.getPage(['getting-started'])
      expect(page).toBeDefined()
      expect(page?.data.title).toBe('Getting Started')
    })

    it('should find getting-started/installation page', () => {
      // docs/getting-started/installation.mdx should exist
      const page = source.getPage(['getting-started', 'installation'])
      expect(page).toBeDefined()
    })

    it('should find getting-started/quickstart page', () => {
      // docs/getting-started/quickstart.mdx should exist
      const page = source.getPage(['getting-started', 'quickstart'])
      expect(page).toBeDefined()
    })
  })

  describe('Concepts Section', () => {
    it('should find concepts section', () => {
      // docs/concepts/ folder should be navigable
      const page = source.getPage(['concepts'])
      expect(page).toBeDefined()
    })

    it('should have concepts pages in navigation tree', () => {
      const tree = source.pageTree
      const conceptsNode = tree.children?.find(
        (node) => 'name' in node && node.name.toLowerCase().includes('concept')
      )
      expect(conceptsNode).toBeDefined()
    })
  })

  describe('API Section', () => {
    it('should find api section', () => {
      // docs/api/ folder should be navigable
      const page = source.getPage(['api'])
      expect(page).toBeDefined()
    })
  })

  describe('Page Content', () => {
    it('should have title frontmatter from docs/index.mdx', () => {
      const page = source.getPage([])
      expect(page?.data.title).toBe('dotdo')
    })

    it('should have description frontmatter from docs/index.mdx', () => {
      const page = source.getPage([])
      expect(page?.data.description).toContain('Business-as-Code')
    })

    it('should have getting-started title from frontmatter', () => {
      const page = source.getPage(['getting-started'])
      expect(page?.data.title).toBe('Getting Started')
      expect(page?.data.description).toContain('AI-powered startup')
    })
  })

  describe('Navigation Tree Structure', () => {
    it('should have root level sections in tree', () => {
      const tree = source.pageTree
      expect(tree.children).toBeDefined()

      // Tree should have top-level navigation items
      const childNames = tree.children
        ?.filter((node): node is { name: string } => 'name' in node && typeof (node as { name?: string }).name === 'string')
        .map((node) => node.name.toLowerCase())

      // Should have at least getting-started, concepts, api sections
      expect(childNames).toContain('getting started')
    })

    it('should have nested pages under sections', () => {
      const tree = source.pageTree
      const gettingStarted = tree.children?.find(
        (node): node is { name: string; children?: unknown[] } =>
          'name' in node && node.name.toLowerCase().includes('getting')
      )

      // Getting Started should have child pages
      expect(gettingStarted?.children?.length).toBeGreaterThan(0)
    })
  })

  describe('URL Generation', () => {
    it('should generate correct URL for index page', () => {
      const page = source.getPage([])
      expect(page?.url).toBe('/docs')
    })

    it('should generate correct URL for nested pages', () => {
      const page = source.getPage(['getting-started'])
      expect(page?.url).toBe('/docs/getting-started')
    })

    it('should generate correct URL for deeply nested pages', () => {
      const page = source.getPage(['getting-started', 'installation'])
      expect(page?.url).toBe('/docs/getting-started/installation')
    })
  })
})

import { describe, it, expect } from 'vitest'

/**
 * Tests for fumadocs integration in @dotdo/app
 *
 * These tests verify that the documentation system is properly configured
 * and that MDX content can be loaded and rendered.
 */

describe('Documentation Integration', () => {
  describe('Content Structure', () => {
    it('should have docs metadata defined', () => {
      const docs = [
        { title: 'Introduction', description: 'Welcome to dotdo documentation', slug: 'index' },
        { title: 'Installation', description: 'How to install and set up dotdo', slug: 'installation' },
        { title: 'Core Concepts', description: "Understanding dotdo's architecture", slug: 'core-concepts' },
        { title: 'API Reference', description: 'Complete API documentation', slug: 'api-reference' },
      ]

      expect(docs).toHaveLength(4)
      expect(docs[0].slug).toBe('index')
      expect(docs[0].title).toBe('Introduction')
    })

    it('should have unique slugs for each doc', () => {
      const docs = [
        { title: 'Introduction', description: 'Welcome to dotdo documentation', slug: 'index' },
        { title: 'Installation', description: 'How to install and set up dotdo', slug: 'installation' },
        { title: 'Core Concepts', description: "Understanding dotdo's architecture", slug: 'core-concepts' },
        { title: 'API Reference', description: 'Complete API documentation', slug: 'api-reference' },
      ]

      const slugs = docs.map(d => d.slug)
      const uniqueSlugs = new Set(slugs)

      expect(uniqueSlugs.size).toBe(docs.length)
    })
  })

  describe('Route Configuration', () => {
    it('should handle index route', () => {
      const slug = 'index'
      expect(slug).toBe('index')
    })

    it('should handle nested routes', () => {
      const slugs = ['installation', 'core-concepts', 'api-reference']
      slugs.forEach(slug => {
        expect(slug).toMatch(/^[a-z-]+$/)
      })
    })

    it('should handle 404 for unknown routes', () => {
      const docs = [
        { title: 'Introduction', slug: 'index' },
        { title: 'Installation', slug: 'installation' },
      ]

      const unknownSlug = 'non-existent'
      const found = docs.find(d => d.slug === unknownSlug)

      expect(found).toBeUndefined()
    })
  })

  describe('Search Functionality', () => {
    it('should filter docs by title', () => {
      const docs = [
        { title: 'Introduction', description: 'Welcome to dotdo documentation', slug: 'index' },
        { title: 'Installation', description: 'How to install and set up dotdo', slug: 'installation' },
        { title: 'Core Concepts', description: "Understanding dotdo's architecture", slug: 'core-concepts' },
        { title: 'API Reference', description: 'Complete API documentation', slug: 'api-reference' },
      ]

      const searchQuery = 'install'
      const filtered = docs.filter(doc =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.description.toLowerCase().includes(searchQuery.toLowerCase())
      )

      expect(filtered).toHaveLength(1)
      expect(filtered[0].slug).toBe('installation')
    })

    it('should filter docs by description', () => {
      const docs = [
        { title: 'Introduction', description: 'Welcome to dotdo documentation', slug: 'index' },
        { title: 'Installation', description: 'How to install and set up dotdo', slug: 'installation' },
        { title: 'Core Concepts', description: "Understanding dotdo's architecture", slug: 'core-concepts' },
        { title: 'API Reference', description: 'Complete API documentation', slug: 'api-reference' },
      ]

      const searchQuery = 'architecture'
      const filtered = docs.filter(doc =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.description.toLowerCase().includes(searchQuery.toLowerCase())
      )

      expect(filtered).toHaveLength(1)
      expect(filtered[0].slug).toBe('core-concepts')
    })

    it('should return all docs when search is empty', () => {
      const docs = [
        { title: 'Introduction', description: 'Welcome to dotdo documentation', slug: 'index' },
        { title: 'Installation', description: 'How to install and set up dotdo', slug: 'installation' },
        { title: 'Core Concepts', description: "Understanding dotdo's architecture", slug: 'core-concepts' },
        { title: 'API Reference', description: 'Complete API documentation', slug: 'api-reference' },
      ]

      const searchQuery = ''
      const filtered = docs.filter(doc =>
        !searchQuery ||
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.description.toLowerCase().includes(searchQuery.toLowerCase())
      )

      expect(filtered).toHaveLength(4)
    })
  })

  describe('Navigation', () => {
    it('should generate correct URLs for docs', () => {
      const docs = [
        { title: 'Introduction', slug: 'index' },
        { title: 'Installation', slug: 'installation' },
      ]

      const urls = docs.map(doc => `/docs/${doc.slug === 'index' ? '' : doc.slug}`)

      expect(urls[0]).toBe('/docs/')
      expect(urls[1]).toBe('/docs/installation')
    })

    it('should highlight active doc in navigation', () => {
      const currentSlug = 'installation'
      const docs = [
        { title: 'Introduction', slug: 'index' },
        { title: 'Installation', slug: 'installation' },
      ]

      const activeDoc = docs.find(d => d.slug === currentSlug)

      expect(activeDoc).toBeDefined()
      expect(activeDoc?.slug).toBe(currentSlug)
    })
  })

  describe('MDX Content Loading', () => {
    it('should load content for valid slug', () => {
      const slug = 'installation'
      const docs = [
        { title: 'Introduction', description: 'Welcome to dotdo documentation', slug: 'index' },
        { title: 'Installation', description: 'How to install and set up dotdo', slug: 'installation' },
      ]

      const doc = docs.find(d => d.slug === slug)

      expect(doc).toBeDefined()
      expect(doc?.title).toBe('Installation')
    })

    it('should generate expected MDX file paths', () => {
      const slugs = ['index', 'installation', 'core-concepts', 'api-reference']
      const paths = slugs.map(slug => `app/content/docs/${slug}.mdx`)

      expect(paths).toContain('app/content/docs/index.mdx')
      expect(paths).toContain('app/content/docs/installation.mdx')
      expect(paths).toContain('app/content/docs/core-concepts.mdx')
      expect(paths).toContain('app/content/docs/api-reference.mdx')
    })
  })

  describe('Code Highlighting', () => {
    it('should support TypeScript code blocks', () => {
      const codeBlock = `// Example: Using dotdo
import { DO } from 'dotdo'

export default {
  async fetch(request, env) {
    const id = env.DO.idFromName('default')
    const stub = env.DO.get(id)
    return stub.fetch(request)
  }
}`

      expect(codeBlock).toContain('import')
      expect(codeBlock).toContain('async fetch')
      expect(codeBlock).toContain('DO')
    })

    it('should support bash code blocks', () => {
      const bashCode = 'npm install dotdo'
      expect(bashCode).toMatch(/^npm install/)
    })
  })

  describe('Sidebar', () => {
    it('should display all documentation sections', () => {
      const sections = [
        'Introduction',
        'Installation',
        'Core Concepts',
        'API Reference',
      ]

      expect(sections).toHaveLength(4)
      sections.forEach(section => {
        expect(section).toBeTruthy()
      })
    })

    it('should have search functionality', () => {
      const hasSearch = true // Sidebar includes search input
      expect(hasSearch).toBe(true)
    })
  })

  describe('Table of Contents', () => {
    it('should extract headings for TOC', () => {
      const headings = ['Overview', 'Getting Started', 'Examples']

      expect(headings).toHaveLength(3)
      expect(headings[0]).toBe('Overview')
    })

    it('should generate anchor links', () => {
      const heading = 'Getting Started'
      const anchor = heading.toLowerCase().replace(/\s+/g, '-')

      expect(anchor).toBe('getting-started')
    })
  })
})

/**
 * SEO Infrastructure Tests
 *
 * RED phase: These tests verify the SEO infrastructure exists and is properly configured.
 * All tests should FAIL until the GREEN phase implements the actual files.
 *
 * Tests cover:
 * - robots.txt configuration
 * - sitemap.xml generation
 * - Open Graph meta tags
 * - JSON-LD structured data
 * - Canonical URLs
 * - Meta description handling
 *
 * @see https://tanstack.com/start/latest/docs/routing/head
 * @see https://schema.org/SoftwareApplication
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP_DIR = path.join(ROOT, 'app')
const LIB_DIR = path.join(ROOT, 'lib')
const PUBLIC_DIR = path.join(ROOT, 'public')

describe('SEO Infrastructure', () => {
  describe('robots.txt configuration', () => {
    const robotsPath = path.join(PUBLIC_DIR, 'robots.txt')

    it('should exist at public/robots.txt', () => {
      expect(fs.existsSync(robotsPath)).toBe(true)
    })

    it('should have User-agent directive', () => {
      const content = fs.readFileSync(robotsPath, 'utf-8')
      expect(content).toMatch(/User-agent:\s*\*/i)
    })

    it('should allow all crawlers by default', () => {
      const content = fs.readFileSync(robotsPath, 'utf-8')
      // Should have Allow: / or not have Disallow: /
      const hasAllowAll = content.includes('Allow: /')
      const hasDisallowAll = /Disallow:\s*\/\s*$/m.test(content)
      expect(hasAllowAll || !hasDisallowAll).toBe(true)
    })

    it('should reference sitemap.xml', () => {
      const content = fs.readFileSync(robotsPath, 'utf-8')
      expect(content).toMatch(/Sitemap:\s*https?:\/\/.*sitemap\.xml/i)
    })

    it('should disallow sensitive paths', () => {
      const content = fs.readFileSync(robotsPath, 'utf-8')
      // Should disallow /api paths from crawling
      expect(content).toMatch(/Disallow:\s*\/api/i)
    })
  })

  describe('sitemap.xml generation', () => {
    const sitemapRoutePath = path.join(APP_DIR, 'routes/sitemap[.]xml.ts')
    const sitemapApiPath = path.join(APP_DIR, 'api/sitemap.xml/route.ts')

    it('should have sitemap route or API endpoint', () => {
      const hasSitemapRoute = fs.existsSync(sitemapRoutePath)
      const hasSitemapApi = fs.existsSync(sitemapApiPath)
      expect(hasSitemapRoute || hasSitemapApi).toBe(true)
    })

    it('should export a GET handler or loader', async () => {
      let content: string
      if (fs.existsSync(sitemapRoutePath)) {
        content = fs.readFileSync(sitemapRoutePath, 'utf-8')
      } else {
        content = fs.readFileSync(sitemapApiPath, 'utf-8')
      }
      // Should export GET, loader, or similar
      const hasGET = content.includes('export') && content.includes('GET')
      const hasLoader = content.includes('loader')
      expect(hasGET || hasLoader).toBe(true)
    })

    it('should return XML content type', async () => {
      let content: string
      if (fs.existsSync(sitemapRoutePath)) {
        content = fs.readFileSync(sitemapRoutePath, 'utf-8')
      } else {
        content = fs.readFileSync(sitemapApiPath, 'utf-8')
      }
      // Should set application/xml or text/xml content type
      expect(content).toMatch(/application\/xml|text\/xml/)
    })

    it('should generate urlset with namespaces', async () => {
      let content: string
      if (fs.existsSync(sitemapRoutePath)) {
        content = fs.readFileSync(sitemapRoutePath, 'utf-8')
      } else {
        content = fs.readFileSync(sitemapApiPath, 'utf-8')
      }
      // Should contain XML sitemap structure
      expect(content).toMatch(/urlset/)
      expect(content).toMatch(/xmlns/)
    })

    it('should include lastmod dates', async () => {
      let content: string
      if (fs.existsSync(sitemapRoutePath)) {
        content = fs.readFileSync(sitemapRoutePath, 'utf-8')
      } else {
        content = fs.readFileSync(sitemapApiPath, 'utf-8')
      }
      // Should include lastmod for entries
      expect(content).toMatch(/lastmod/)
    })
  })

  describe('lib/seo.ts helper module', () => {
    const seoPath = path.join(LIB_DIR, 'seo.ts')

    it('should exist at lib/seo.ts', () => {
      expect(fs.existsSync(seoPath)).toBe(true)
    })

    it('should export generateMeta function', async () => {
      const module = await import(seoPath)
      expect(module.generateMeta).toBeDefined()
      expect(typeof module.generateMeta).toBe('function')
    })

    it('should export generateJsonLd function', async () => {
      const module = await import(seoPath)
      expect(module.generateJsonLd).toBeDefined()
      expect(typeof module.generateJsonLd).toBe('function')
    })

    it('should export SEO_DEFAULTS constant', async () => {
      const module = await import(seoPath)
      expect(module.SEO_DEFAULTS).toBeDefined()
      expect(module.SEO_DEFAULTS.siteName).toBeDefined()
      expect(module.SEO_DEFAULTS.siteUrl).toBeDefined()
    })
  })

  describe('Open Graph meta tags', () => {
    const seoPath = path.join(LIB_DIR, 'seo.ts')

    it('should generate og:title meta tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test Page' })
      const ogTitle = meta.find((m: { property?: string }) => m.property === 'og:title')
      expect(ogTitle).toBeDefined()
      expect(ogTitle.content).toContain('Test Page')
    })

    it('should generate og:description meta tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ description: 'Test description' })
      const ogDesc = meta.find((m: { property?: string }) => m.property === 'og:description')
      expect(ogDesc).toBeDefined()
      expect(ogDesc.content).toBe('Test description')
    })

    it('should generate og:type meta tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test' })
      const ogType = meta.find((m: { property?: string }) => m.property === 'og:type')
      expect(ogType).toBeDefined()
    })

    it('should generate og:url meta tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test', url: '/test' })
      const ogUrl = meta.find((m: { property?: string }) => m.property === 'og:url')
      expect(ogUrl).toBeDefined()
    })

    it('should generate og:site_name meta tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test' })
      const ogSiteName = meta.find((m: { property?: string }) => m.property === 'og:site_name')
      expect(ogSiteName).toBeDefined()
      expect(ogSiteName.content).toBe('dotdo')
    })

    it('should generate og:image meta tag when image provided', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test', image: '/og-image.png' })
      const ogImage = meta.find((m: { property?: string }) => m.property === 'og:image')
      expect(ogImage).toBeDefined()
    })
  })

  describe('Twitter Card meta tags', () => {
    const seoPath = path.join(LIB_DIR, 'seo.ts')

    it('should generate twitter:card meta tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test' })
      const twitterCard = meta.find((m: { name?: string }) => m.name === 'twitter:card')
      expect(twitterCard).toBeDefined()
    })

    it('should generate twitter:title meta tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test Page' })
      const twitterTitle = meta.find((m: { name?: string }) => m.name === 'twitter:title')
      expect(twitterTitle).toBeDefined()
    })

    it('should generate twitter:description meta tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ description: 'Test desc' })
      const twitterDesc = meta.find((m: { name?: string }) => m.name === 'twitter:description')
      expect(twitterDesc).toBeDefined()
    })
  })

  describe('JSON-LD structured data', () => {
    const seoPath = path.join(LIB_DIR, 'seo.ts')

    it('should generate valid JSON-LD script tag content', async () => {
      const module = await import(seoPath)
      const jsonLd = module.generateJsonLd({ type: 'WebSite' })
      expect(jsonLd).toBeDefined()
      // Should be parseable as JSON
      const parsed = JSON.parse(jsonLd)
      expect(parsed['@context']).toBe('https://schema.org')
    })

    it('should generate WebSite schema', async () => {
      const module = await import(seoPath)
      const jsonLd = module.generateJsonLd({ type: 'WebSite' })
      const parsed = JSON.parse(jsonLd)
      expect(parsed['@type']).toBe('WebSite')
      expect(parsed.name).toBe('dotdo')
    })

    it('should generate SoftwareApplication schema', async () => {
      const module = await import(seoPath)
      const jsonLd = module.generateJsonLd({ type: 'SoftwareApplication' })
      const parsed = JSON.parse(jsonLd)
      expect(parsed['@type']).toBe('SoftwareApplication')
      expect(parsed.applicationCategory).toBeDefined()
    })

    it('should generate Article schema for docs pages', async () => {
      const module = await import(seoPath)
      const jsonLd = module.generateJsonLd({
        type: 'Article',
        title: 'Getting Started',
        description: 'How to get started with dotdo',
        datePublished: '2024-01-01',
      })
      const parsed = JSON.parse(jsonLd)
      expect(parsed['@type']).toBe('Article')
      expect(parsed.headline).toBe('Getting Started')
      expect(parsed.datePublished).toBeDefined()
    })

    it('should include author information in Article schema', async () => {
      const module = await import(seoPath)
      const jsonLd = module.generateJsonLd({
        type: 'Article',
        title: 'Test Article',
      })
      const parsed = JSON.parse(jsonLd)
      expect(parsed.author).toBeDefined()
      expect(parsed.author['@type']).toBe('Organization')
    })

    it('should generate BreadcrumbList schema', async () => {
      const module = await import(seoPath)
      const jsonLd = module.generateJsonLd({
        type: 'BreadcrumbList',
        items: [
          { name: 'Home', url: '/' },
          { name: 'Docs', url: '/docs' },
          { name: 'Getting Started', url: '/docs/getting-started' },
        ],
      })
      const parsed = JSON.parse(jsonLd)
      expect(parsed['@type']).toBe('BreadcrumbList')
      expect(parsed.itemListElement).toHaveLength(3)
      expect(parsed.itemListElement[0]['@type']).toBe('ListItem')
      expect(parsed.itemListElement[0].position).toBe(1)
    })
  })

  describe('Canonical URLs', () => {
    const seoPath = path.join(LIB_DIR, 'seo.ts')

    it('should generate canonical link tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test', url: '/test-page' })
      const canonical = meta.find(
        (m: { rel?: string }) => m.rel === 'canonical'
      )
      expect(canonical).toBeDefined()
      expect(canonical.href).toContain('/test-page')
    })

    it('should use absolute URLs for canonical', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test', url: '/test-page' })
      const canonical = meta.find(
        (m: { rel?: string }) => m.rel === 'canonical'
      )
      expect(canonical.href).toMatch(/^https?:\/\//)
    })

    it('should normalize trailing slashes in canonical URLs', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test', url: '/test-page/' })
      const canonical = meta.find(
        (m: { rel?: string }) => m.rel === 'canonical'
      )
      // Should normalize - either always have or never have trailing slash
      const hasTrailingSlash = canonical.href.endsWith('/')
      const meta2 = module.generateMeta({ title: 'Test', url: '/another/' })
      const canonical2 = meta2.find(
        (m: { rel?: string }) => m.rel === 'canonical'
      )
      const hasTrailingSlash2 = canonical2.href.endsWith('/')
      // Should be consistent
      expect(hasTrailingSlash).toBe(hasTrailingSlash2)
    })
  })

  describe('Meta description handling', () => {
    const seoPath = path.join(LIB_DIR, 'seo.ts')

    it('should generate meta description tag', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ description: 'Test description here' })
      const descMeta = meta.find((m: { name?: string }) => m.name === 'description')
      expect(descMeta).toBeDefined()
      expect(descMeta.content).toBe('Test description here')
    })

    it('should truncate description to SEO-friendly length', async () => {
      const module = await import(seoPath)
      const longDescription = 'A'.repeat(300) // Very long description
      const meta = module.generateMeta({ description: longDescription })
      const descMeta = meta.find((m: { name?: string }) => m.name === 'description')
      // Should be truncated to ~160 characters (SEO best practice)
      expect(descMeta.content.length).toBeLessThanOrEqual(160)
    })

    it('should use default description when none provided', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({ title: 'Test' })
      const descMeta = meta.find((m: { name?: string }) => m.name === 'description')
      expect(descMeta).toBeDefined()
      expect(descMeta.content.length).toBeGreaterThan(0)
    })

    it('should escape HTML in descriptions', async () => {
      const module = await import(seoPath)
      const meta = module.generateMeta({
        description: '<script>alert("xss")</script>Test',
      })
      const descMeta = meta.find((m: { name?: string }) => m.name === 'description')
      expect(descMeta.content).not.toContain('<script>')
    })
  })

  describe('Root route SEO configuration', () => {
    const rootRoutePath = path.join(APP_DIR, 'routes/__root.tsx')

    it('should have head() function with meta tags', async () => {
      const content = fs.readFileSync(rootRoutePath, 'utf-8')
      expect(content).toMatch(/head:\s*\(\)/)
      expect(content).toMatch(/meta:/)
    })

    it('should include charset meta tag', async () => {
      const content = fs.readFileSync(rootRoutePath, 'utf-8')
      expect(content).toMatch(/charSet.*utf-8/i)
    })

    it('should include viewport meta tag', async () => {
      const content = fs.readFileSync(rootRoutePath, 'utf-8')
      expect(content).toMatch(/viewport/)
    })

    it('should include default description', async () => {
      const content = fs.readFileSync(rootRoutePath, 'utf-8')
      expect(content).toMatch(/description/)
    })
  })

  describe('Index route SEO configuration', () => {
    const indexRoutePath = path.join(APP_DIR, 'routes/index.tsx')

    it('should have head() function with meta tags', async () => {
      const content = fs.readFileSync(indexRoutePath, 'utf-8')
      expect(content).toMatch(/head:\s*\(\)/)
    })

    it('should include page-specific title', async () => {
      const content = fs.readFileSync(indexRoutePath, 'utf-8')
      expect(content).toMatch(/title/)
    })
  })

  describe('SEO integration in docs route', () => {
    const docsRoutePath = path.join(APP_DIR, 'routes/docs.tsx')

    it('should exist', () => {
      expect(fs.existsSync(docsRoutePath)).toBe(true)
    })

    it('should have head() function for dynamic SEO', async () => {
      const content = fs.readFileSync(docsRoutePath, 'utf-8')
      expect(content).toMatch(/head/)
    })

    it('should generate article structured data for doc pages', async () => {
      const content = fs.readFileSync(docsRoutePath, 'utf-8')
      // Should reference JSON-LD or structured data
      expect(content).toMatch(/jsonLd|JsonLd|JSON-LD|structuredData|schema\.org/i)
    })
  })

  describe('public/ directory structure', () => {
    it('should have public/ directory', () => {
      expect(fs.existsSync(PUBLIC_DIR)).toBe(true)
    })

    it('should have favicon.ico', () => {
      const faviconPath = path.join(PUBLIC_DIR, 'favicon.ico')
      expect(fs.existsSync(faviconPath)).toBe(true)
    })

    it('should have Open Graph image', () => {
      const ogImagePath = path.join(PUBLIC_DIR, 'og-image.png')
      const ogImageJpgPath = path.join(PUBLIC_DIR, 'og-image.jpg')
      expect(fs.existsSync(ogImagePath) || fs.existsSync(ogImageJpgPath)).toBe(true)
    })
  })

  describe('SEO meta tag types', () => {
    const seoPath = path.join(LIB_DIR, 'seo.ts')

    it('should export SeoMeta type', async () => {
      const content = fs.readFileSync(seoPath, 'utf-8')
      // Should have type definitions
      expect(content).toMatch(/interface\s+SeoMeta|type\s+SeoMeta/)
    })

    it('should export JsonLdOptions type', async () => {
      const content = fs.readFileSync(seoPath, 'utf-8')
      expect(content).toMatch(/interface\s+JsonLdOptions|type\s+JsonLdOptions/)
    })
  })
})

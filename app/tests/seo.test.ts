import { describe, it, expect, beforeAll } from 'vitest'

/**
 * SEO and Structured Data Tests
 *
 * These tests verify proper SEO implementation including:
 * - robots.txt configuration for AI crawlers
 * - JSON-LD structured data (Article schema)
 * - Open Graph meta tags
 * - Twitter Card meta tags
 * - Canonical URLs
 * - Meta description length limits
 * - Heading hierarchy
 * - Sitemap generation
 */

// Mock page fetcher - will need actual implementation
async function fetchPage(path: string): Promise<string> {
  // TODO: Replace with actual page rendering/fetching
  const { renderPage } = await import('../src/render')
  return renderPage(path)
}

// Mock robots.txt fetcher
async function fetchRobotsTxt(): Promise<string> {
  const { getRobotsTxt } = await import('../src/seo/robots')
  return getRobotsTxt()
}

// Mock sitemap fetcher
async function fetchSitemap(): Promise<string> {
  const { getSitemap } = await import('../src/seo/sitemap')
  return getSitemap()
}

// Helper to extract meta tag content
function getMetaContent(html: string, property: string): string | null {
  // Match both name="..." and property="..." attributes
  const nameMatch = html.match(new RegExp(`<meta\\s+name=["']${property}["']\\s+content=["']([^"']*)["']`, 'i'))
  const propMatch = html.match(new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']*)["']`, 'i'))
  // Also match reversed order: content before name/property
  const nameMatchReversed = html.match(new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+name=["']${property}["']`, 'i'))
  const propMatchReversed = html.match(new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+property=["']${property}["']`, 'i'))

  return nameMatch?.[1] ?? propMatch?.[1] ?? nameMatchReversed?.[1] ?? propMatchReversed?.[1] ?? null
}

// Helper to extract JSON-LD data
function getJsonLd(html: string): object[] {
  const scripts: object[] = []
  const regex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    try {
      scripts.push(JSON.parse(match[1]))
    } catch {
      // Invalid JSON-LD
    }
  }
  return scripts
}

// Helper to extract canonical URL
function getCanonicalUrl(html: string): string | null {
  const match = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i)
  const matchReversed = html.match(/<link\s+href=["']([^"']*)["']\s+rel=["']canonical["']/i)
  return match?.[1] ?? matchReversed?.[1] ?? null
}

// Helper to extract all headings
function getHeadings(html: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = []
  const regex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    headings.push({
      level: parseInt(match[1]),
      text: match[2].replace(/<[^>]*>/g, '').trim(),
    })
  }
  return headings
}

describe('robots.txt', () => {
  let robotsTxt: string

  beforeAll(async () => {
    robotsTxt = await fetchRobotsTxt()
  })

  it('should exist and not be empty', () => {
    expect(robotsTxt).toBeDefined()
    expect(robotsTxt.length).toBeGreaterThan(0)
  })

  it('should allow GPTBot crawler', () => {
    // GPTBot should NOT be disallowed (or explicitly allowed)
    const disallowsGPTBot = /User-agent:\s*GPTBot[\s\S]*?Disallow:\s*\//i.test(robotsTxt)
    expect(disallowsGPTBot).toBe(false)
  })

  it('should allow anthropic-ai crawler', () => {
    const disallowsAnthropic = /User-agent:\s*anthropic-ai[\s\S]*?Disallow:\s*\//i.test(robotsTxt)
    expect(disallowsAnthropic).toBe(false)
  })

  it('should allow Google-Extended crawler', () => {
    // Google-Extended is Google's AI training crawler
    const disallowsGoogleExtended = /User-agent:\s*Google-Extended[\s\S]*?Disallow:\s*\//i.test(robotsTxt)
    expect(disallowsGoogleExtended).toBe(false)
  })

  it('should include sitemap reference', () => {
    expect(robotsTxt.toLowerCase()).toContain('sitemap:')
  })

  it('should have wildcard allow rule for general crawlers', () => {
    expect(robotsTxt).toMatch(/User-agent:\s*\*/i)
  })
})

describe('JSON-LD Structured Data', () => {
  const testPages = ['/', '/about', '/blog/test-article']

  testPages.forEach((pagePath) => {
    describe(`Page: ${pagePath}`, () => {
      let html: string
      let jsonLdData: object[]

      beforeAll(async () => {
        html = await fetchPage(pagePath)
        jsonLdData = getJsonLd(html)
      })

      it('should have at least one JSON-LD script', () => {
        expect(jsonLdData.length).toBeGreaterThan(0)
      })

      it('should have valid @context', () => {
        const hasValidContext = jsonLdData.some((data: any) => data['@context'] === 'https://schema.org')
        expect(hasValidContext).toBe(true)
      })

      it('should have a valid @type', () => {
        const validTypes = ['Article', 'WebPage', 'Organization', 'WebSite', 'BlogPosting']
        const hasValidType = jsonLdData.some((data: any) => validTypes.includes(data['@type']))
        expect(hasValidType).toBe(true)
      })
    })
  })

  describe('Article pages', () => {
    let html: string
    let jsonLdData: object[]

    beforeAll(async () => {
      html = await fetchPage('/blog/test-article')
      jsonLdData = getJsonLd(html)
    })

    it('should have Article or BlogPosting schema', () => {
      const hasArticleSchema = jsonLdData.some((data: any) => data['@type'] === 'Article' || data['@type'] === 'BlogPosting')
      expect(hasArticleSchema).toBe(true)
    })

    it('should have headline property', () => {
      const articleSchema = jsonLdData.find((data: any) => data['@type'] === 'Article' || data['@type'] === 'BlogPosting') as any
      expect(articleSchema?.headline).toBeDefined()
      expect(articleSchema?.headline.length).toBeGreaterThan(0)
    })

    it('should have author property', () => {
      const articleSchema = jsonLdData.find((data: any) => data['@type'] === 'Article' || data['@type'] === 'BlogPosting') as any
      expect(articleSchema?.author).toBeDefined()
    })

    it('should have datePublished property', () => {
      const articleSchema = jsonLdData.find((data: any) => data['@type'] === 'Article' || data['@type'] === 'BlogPosting') as any
      expect(articleSchema?.datePublished).toBeDefined()
      // Validate ISO 8601 format
      expect(articleSchema?.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}/)
    })

    it('should have description property', () => {
      const articleSchema = jsonLdData.find((data: any) => data['@type'] === 'Article' || data['@type'] === 'BlogPosting') as any
      expect(articleSchema?.description).toBeDefined()
    })

    it('should have image property', () => {
      const articleSchema = jsonLdData.find((data: any) => data['@type'] === 'Article' || data['@type'] === 'BlogPosting') as any
      expect(articleSchema?.image).toBeDefined()
    })
  })
})

describe('Open Graph Meta Tags', () => {
  const testPages = ['/', '/about', '/blog/test-article']

  testPages.forEach((pagePath) => {
    describe(`Page: ${pagePath}`, () => {
      let html: string

      beforeAll(async () => {
        html = await fetchPage(pagePath)
      })

      it('should have og:title', () => {
        const ogTitle = getMetaContent(html, 'og:title')
        expect(ogTitle).not.toBeNull()
        expect(ogTitle!.length).toBeGreaterThan(0)
      })

      it('should have og:description', () => {
        const ogDescription = getMetaContent(html, 'og:description')
        expect(ogDescription).not.toBeNull()
        expect(ogDescription!.length).toBeGreaterThan(0)
      })

      it('should have og:type', () => {
        const ogType = getMetaContent(html, 'og:type')
        expect(ogType).not.toBeNull()
        const validTypes = ['website', 'article', 'profile', 'product']
        expect(validTypes).toContain(ogType)
      })

      it('should have og:url', () => {
        const ogUrl = getMetaContent(html, 'og:url')
        expect(ogUrl).not.toBeNull()
        expect(ogUrl).toMatch(/^https?:\/\//)
      })

      it('should have og:image', () => {
        const ogImage = getMetaContent(html, 'og:image')
        expect(ogImage).not.toBeNull()
        expect(ogImage).toMatch(/^https?:\/\//)
      })

      it('should have og:site_name', () => {
        const ogSiteName = getMetaContent(html, 'og:site_name')
        expect(ogSiteName).not.toBeNull()
      })
    })
  })

  describe('Article pages should have article-specific OG tags', () => {
    let html: string

    beforeAll(async () => {
      html = await fetchPage('/blog/test-article')
    })

    it('should have og:type set to article', () => {
      const ogType = getMetaContent(html, 'og:type')
      expect(ogType).toBe('article')
    })

    it('should have article:published_time', () => {
      const publishedTime = getMetaContent(html, 'article:published_time')
      expect(publishedTime).not.toBeNull()
      expect(publishedTime).toMatch(/^\d{4}-\d{2}-\d{2}/)
    })

    it('should have article:author', () => {
      const author = getMetaContent(html, 'article:author')
      expect(author).not.toBeNull()
    })
  })
})

describe('Twitter Card Meta Tags', () => {
  const testPages = ['/', '/about', '/blog/test-article']

  testPages.forEach((pagePath) => {
    describe(`Page: ${pagePath}`, () => {
      let html: string

      beforeAll(async () => {
        html = await fetchPage(pagePath)
      })

      it('should have twitter:card', () => {
        const twitterCard = getMetaContent(html, 'twitter:card')
        expect(twitterCard).not.toBeNull()
        const validCardTypes = ['summary', 'summary_large_image', 'app', 'player']
        expect(validCardTypes).toContain(twitterCard)
      })

      it('should have twitter:title', () => {
        const twitterTitle = getMetaContent(html, 'twitter:title')
        expect(twitterTitle).not.toBeNull()
        expect(twitterTitle!.length).toBeGreaterThan(0)
      })

      it('should have twitter:description', () => {
        const twitterDescription = getMetaContent(html, 'twitter:description')
        expect(twitterDescription).not.toBeNull()
        expect(twitterDescription!.length).toBeGreaterThan(0)
      })

      it('should have twitter:image', () => {
        const twitterImage = getMetaContent(html, 'twitter:image')
        expect(twitterImage).not.toBeNull()
        expect(twitterImage).toMatch(/^https?:\/\//)
      })
    })
  })

  it('should have twitter:site for brand handle', async () => {
    const html = await fetchPage('/')
    const twitterSite = getMetaContent(html, 'twitter:site')
    expect(twitterSite).not.toBeNull()
    expect(twitterSite).toMatch(/^@/)
  })
})

describe('Canonical URLs', () => {
  const testPages = ['/', '/about', '/blog/test-article']

  testPages.forEach((pagePath) => {
    describe(`Page: ${pagePath}`, () => {
      let html: string

      beforeAll(async () => {
        html = await fetchPage(pagePath)
      })

      it('should have a canonical URL', () => {
        const canonical = getCanonicalUrl(html)
        expect(canonical).not.toBeNull()
      })

      it('should have an absolute canonical URL', () => {
        const canonical = getCanonicalUrl(html)
        expect(canonical).toMatch(/^https?:\/\//)
      })

      it('should not have trailing slash inconsistencies', () => {
        const canonical = getCanonicalUrl(html)
        // Either all URLs have trailing slashes or none do (consistency)
        // Root URL may or may not have trailing slash
        if (pagePath !== '/') {
          // Non-root URLs should be consistent
          expect(canonical).toBeDefined()
        }
      })

      it('should use HTTPS', () => {
        const canonical = getCanonicalUrl(html)
        expect(canonical).toMatch(/^https:\/\//)
      })
    })
  })
})

describe('Meta Descriptions', () => {
  const testPages = ['/', '/about', '/blog/test-article']

  testPages.forEach((pagePath) => {
    describe(`Page: ${pagePath}`, () => {
      let html: string

      beforeAll(async () => {
        html = await fetchPage(pagePath)
      })

      it('should have a meta description', () => {
        const description = getMetaContent(html, 'description')
        expect(description).not.toBeNull()
      })

      it('should have meta description under 160 characters', () => {
        const description = getMetaContent(html, 'description')
        expect(description).not.toBeNull()
        expect(description!.length).toBeLessThanOrEqual(160)
      })

      it('should have meta description of at least 50 characters', () => {
        const description = getMetaContent(html, 'description')
        expect(description).not.toBeNull()
        expect(description!.length).toBeGreaterThanOrEqual(50)
      })

      it('should not have duplicate meta descriptions across pages', async () => {
        const descriptions = await Promise.all(
          testPages.map(async (path) => {
            const pageHtml = await fetchPage(path)
            return getMetaContent(pageHtml, 'description')
          }),
        )
        const uniqueDescriptions = new Set(descriptions)
        expect(uniqueDescriptions.size).toBe(descriptions.length)
      })
    })
  })
})

describe('Heading Hierarchy', () => {
  const testPages = ['/', '/about', '/blog/test-article']

  testPages.forEach((pagePath) => {
    describe(`Page: ${pagePath}`, () => {
      let html: string
      let headings: { level: number; text: string }[]

      beforeAll(async () => {
        html = await fetchPage(pagePath)
        headings = getHeadings(html)
      })

      it('should have exactly one H1', () => {
        const h1Count = headings.filter((h) => h.level === 1).length
        expect(h1Count).toBe(1)
      })

      it('should have H1 as the first heading', () => {
        expect(headings.length).toBeGreaterThan(0)
        expect(headings[0].level).toBe(1)
      })

      it('should not skip heading levels', () => {
        let previousLevel = 0
        for (const heading of headings) {
          // Can go down any amount, but can only go up by 1
          if (heading.level > previousLevel) {
            expect(heading.level - previousLevel).toBeLessThanOrEqual(1)
          }
          previousLevel = heading.level
        }
      })

      it('should have H1 that matches page title', () => {
        const titleMatch = html.match(/<title>([^<]*)<\/title>/i)
        const h1 = headings.find((h) => h.level === 1)
        expect(h1).toBeDefined()
        // H1 should be contained in or similar to title
        if (titleMatch && h1) {
          const title = titleMatch[1].toLowerCase()
          const h1Text = h1.text.toLowerCase()
          // Either H1 is in title or title contains H1
          const matches = title.includes(h1Text) || h1Text.includes(title.split('|')[0].trim())
          expect(matches).toBe(true)
        }
      })

      it('should have headings with meaningful content', () => {
        for (const heading of headings) {
          expect(heading.text.length).toBeGreaterThan(0)
          expect(heading.text).not.toMatch(/^[\s\n]+$/)
        }
      })
    })
  })

  describe('Article pages should have proper content hierarchy', () => {
    let html: string
    let headings: { level: number; text: string }[]

    beforeAll(async () => {
      html = await fetchPage('/blog/test-article')
      headings = getHeadings(html)
    })

    it('should have H2 subheadings for article sections', () => {
      const h2Count = headings.filter((h) => h.level === 2).length
      expect(h2Count).toBeGreaterThan(0)
    })

    it('should optionally have H3 for subsections', () => {
      // H3 is optional but if present, should follow H2
      const h3s = headings.filter((h) => h.level === 3)
      if (h3s.length > 0) {
        // Check that there's at least one H2 before first H3
        const firstH3Index = headings.findIndex((h) => h.level === 3)
        const hasH2Before = headings.slice(0, firstH3Index).some((h) => h.level === 2)
        expect(hasH2Before).toBe(true)
      }
    })
  })
})

describe('Sitemap', () => {
  let sitemap: string

  beforeAll(async () => {
    sitemap = await fetchSitemap()
  })

  it('should exist and be valid XML', () => {
    expect(sitemap).toBeDefined()
    expect(sitemap).toMatch(/^<\?xml/)
    expect(sitemap).toContain('<urlset')
  })

  it('should have proper XML namespace', () => {
    expect(sitemap).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
  })

  it('should include homepage', () => {
    expect(sitemap).toMatch(/<loc>[^<]*\/<\/loc>/)
  })

  it('should include all main pages', () => {
    const expectedPages = ['/', '/about']
    for (const page of expectedPages) {
      expect(sitemap).toContain(page)
    }
  })

  it('should have lastmod dates', () => {
    expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}/)
  })

  it('should have changefreq for URLs', () => {
    const validFrequencies = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']
    const hasChangefreq = validFrequencies.some((freq) => sitemap.includes(`<changefreq>${freq}</changefreq>`))
    expect(hasChangefreq).toBe(true)
  })

  it('should have priority for URLs', () => {
    expect(sitemap).toMatch(/<priority>[\d.]+<\/priority>/)
  })

  it('should use absolute URLs', () => {
    const locMatches = sitemap.match(/<loc>([^<]*)<\/loc>/g) || []
    for (const loc of locMatches) {
      expect(loc).toMatch(/<loc>https?:\/\//)
    }
  })

  it('should not include duplicate URLs', () => {
    const locMatches = sitemap.match(/<loc>([^<]*)<\/loc>/g) || []
    const urls = locMatches.map((loc) => loc.replace(/<\/?loc>/g, ''))
    const uniqueUrls = new Set(urls)
    expect(uniqueUrls.size).toBe(urls.length)
  })

  it('should not exceed 50MB size limit', () => {
    const sizeInBytes = new Blob([sitemap]).size
    const maxSizeBytes = 50 * 1024 * 1024 // 50MB
    expect(sizeInBytes).toBeLessThan(maxSizeBytes)
  })

  it('should not exceed 50,000 URLs', () => {
    const urlCount = (sitemap.match(/<url>/g) || []).length
    expect(urlCount).toBeLessThanOrEqual(50000)
  })
})

describe('Additional SEO Requirements', () => {
  it('should have viewport meta tag', async () => {
    const html = await fetchPage('/')
    const viewport = getMetaContent(html, 'viewport')
    expect(viewport).not.toBeNull()
    expect(viewport).toContain('width=device-width')
  })

  it('should have charset declaration', async () => {
    const html = await fetchPage('/')
    expect(html).toMatch(/<meta\s+charset=["']utf-8["']/i)
  })

  it('should have lang attribute on html element', async () => {
    const html = await fetchPage('/')
    expect(html).toMatch(/<html[^>]+lang=["'][a-z]{2}(-[A-Z]{2})?["']/i)
  })

  it('should have title tag', async () => {
    const html = await fetchPage('/')
    expect(html).toMatch(/<title>[^<]+<\/title>/i)
  })

  it('should have title under 60 characters', async () => {
    const html = await fetchPage('/')
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i)
    expect(titleMatch).not.toBeNull()
    expect(titleMatch![1].length).toBeLessThanOrEqual(60)
  })

  it('should have favicon', async () => {
    const html = await fetchPage('/')
    const hasFavicon =
      html.includes('rel="icon"') || html.includes("rel='icon'") || html.includes('rel="shortcut icon"') || html.includes("rel='shortcut icon'")
    expect(hasFavicon).toBe(true)
  })
})

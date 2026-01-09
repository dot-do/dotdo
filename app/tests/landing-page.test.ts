import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

/**
 * Landing Page Tests (TDD RED Phase)
 *
 * These tests verify the landing page (beacon) implementation at /.
 * They are expected to FAIL until the landing page is implemented.
 *
 * The landing page should use @mdxui/beacon components:
 * - Hero: Above-the-fold headline with CTAs
 * - Features: Product feature showcases
 * - CTA: Call-to-action sections
 *
 * Implementation requirements:
 * - Create app/routes/index.tsx
 * - Use @mdxui/beacon components (Hero, Features, CTA)
 * - Include navigation links to /docs and /admin
 * - Style with Tailwind + @mdxui/themes
 */

// Mock page fetcher - will need actual implementation
async function fetchPage(path: string): Promise<string> {
  // TODO: Replace with actual page rendering/fetching
  const { renderPage } = await import('../src/render')
  return renderPage(path)
}

// Helper to extract meta tag content
function getMetaContent(html: string, property: string): string | null {
  const nameMatch = html.match(new RegExp(`<meta\\s+name=["']${property}["']\\s+content=["']([^"']*)["']`, 'i'))
  const propMatch = html.match(new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']*)["']`, 'i'))
  const nameMatchReversed = html.match(new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+name=["']${property}["']`, 'i'))
  const propMatchReversed = html.match(new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+property=["']${property}["']`, 'i'))

  return nameMatch?.[1] ?? propMatch?.[1] ?? nameMatchReversed?.[1] ?? propMatchReversed?.[1] ?? null
}

// Helper to extract all links
function getLinks(html: string): { href: string; text: string }[] {
  const links: { href: string; text: string }[] = []
  const regex = /<a[^>]+href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    links.push({
      href: match[1],
      text: match[2].replace(/<[^>]*>/g, '').trim(),
    })
  }
  return links
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

// Helper to extract buttons
function getButtons(html: string): { text: string; type?: string }[] {
  const buttons: { text: string; type?: string }[] = []
  const regex = /<button[^>]*(?:type=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/button>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    buttons.push({
      type: match[1],
      text: match[2].replace(/<[^>]*>/g, '').trim(),
    })
  }
  return buttons
}

// Helper to check if element has specific aria label
function hasAriaLabel(html: string, label: string): boolean {
  return new RegExp(`aria-label=["']${label}["']`, 'i').test(html)
}

// Helper to check if element has specific role
function hasRole(html: string, role: string): boolean {
  return new RegExp(`role=["']${role}["']`, 'i').test(html)
}

// ============================================================================
// Route File Existence Tests
// ============================================================================

describe('Landing Page Route', () => {
  describe('app/routes/index.tsx', () => {
    it('should exist as the landing page route', () => {
      expect(existsSync('app/routes/index.tsx')).toBe(true)
    })

    it('should use TanStack Router createFileRoute', async () => {
      const content = await readFile('app/routes/index.tsx', 'utf-8')
      expect(content).toContain('createFileRoute')
      expect(content).toContain("'/'")
    })

    it('should import @mdxui/beacon components', async () => {
      const content = await readFile('app/routes/index.tsx', 'utf-8')
      expect(content).toContain('@mdxui/beacon')
    })

    it('should export a Route', async () => {
      const content = await readFile('app/routes/index.tsx', 'utf-8')
      expect(content).toContain('export const Route')
    })
  })
})

// ============================================================================
// Page Render Tests
// ============================================================================

describe('Landing Page Rendering', () => {
  let html: string

  beforeAll(async () => {
    html = await fetchPage('/')
  })

  it('should return valid HTML', () => {
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
  })

  it('should have a head section', () => {
    expect(html).toContain('<head>')
    expect(html).toContain('</head>')
  })

  it('should have a body section', () => {
    expect(html).toContain('<body')
    expect(html).toContain('</body>')
  })

  it('should have a title tag', () => {
    expect(html).toMatch(/<title>[^<]+<\/title>/i)
  })

  it('should have appropriate meta description', () => {
    const description = getMetaContent(html, 'description')
    expect(description).not.toBeNull()
    expect(description!.length).toBeGreaterThan(50)
    expect(description!.length).toBeLessThanOrEqual(160)
  })

  it('should not have any React hydration errors', () => {
    // Common hydration error indicators
    expect(html).not.toContain('Hydration failed')
    expect(html).not.toContain('Text content does not match')
    expect(html).not.toContain('There was an error while hydrating')
  })
})

// ============================================================================
// Hero Section Tests
// ============================================================================

describe('Hero Section', () => {
  let html: string
  let headings: { level: number; text: string }[]

  beforeAll(async () => {
    html = await fetchPage('/')
    headings = getHeadings(html)
  })

  it('should have exactly one H1 heading', () => {
    const h1Count = headings.filter((h) => h.level === 1).length
    expect(h1Count).toBe(1)
  })

  it('should have H1 as the first heading', () => {
    expect(headings.length).toBeGreaterThan(0)
    expect(headings[0].level).toBe(1)
  })

  it('should include product name in H1', () => {
    const h1 = headings.find((h) => h.level === 1)
    expect(h1).toBeDefined()
    expect(h1!.text.toLowerCase()).toContain('dotdo')
  })

  it('should have a hero section container', () => {
    // Hero section should have identifiable structure
    expect(html).toMatch(/hero|Hero/i)
  })

  it('should have a tagline or subtitle', () => {
    // Should have some descriptive text after the main headline
    expect(html).toMatch(/durable\s+objects?|serverless|edge/i)
  })

  it('should have a primary CTA button in hero', () => {
    // Hero should have a primary call-to-action
    const links = getLinks(html)
    const ctaLink = links.find(
      (l) =>
        l.href.includes('/docs') ||
        l.text.toLowerCase().includes('get started') ||
        l.text.toLowerCase().includes('documentation')
    )
    expect(ctaLink).toBeDefined()
  })

  it('should have a secondary CTA button in hero', () => {
    // Hero should have a secondary action (e.g., Learn More, View Demo)
    const links = getLinks(html)
    const hasSecondaryAction = links.some(
      (l) =>
        l.text.toLowerCase().includes('learn more') ||
        l.text.toLowerCase().includes('demo') ||
        l.text.toLowerCase().includes('github') ||
        l.href.includes('github')
    )
    expect(hasSecondaryAction).toBe(true)
  })
})

// ============================================================================
// Features Section Tests
// ============================================================================

describe('Feature Highlights', () => {
  let html: string
  let headings: { level: number; text: string }[]

  beforeAll(async () => {
    html = await fetchPage('/')
    headings = getHeadings(html)
  })

  it('should have a features section', () => {
    expect(html).toMatch(/features?/i)
  })

  it('should have a features heading (H2)', () => {
    const h2s = headings.filter((h) => h.level === 2)
    expect(h2s.length).toBeGreaterThan(0)
  })

  it('should have at least 3 feature items', () => {
    // Count feature cards/items - look for repeated structure
    const featurePatterns = [
      // Common feature card patterns
      (html.match(/feature[-_]?card|feature[-_]?item/gi) || []).length,
      // Grid items that could be features
      (html.match(/<article/gi) || []).length,
      // List items in a features section
      (html.match(/<li[^>]*class="[^"]*feature/gi) || []).length,
      // H3 headings (often used for feature titles)
      headings.filter((h) => h.level === 3).length,
    ]
    const maxFeatures = Math.max(...featurePatterns)
    expect(maxFeatures).toBeGreaterThanOrEqual(3)
  })

  it('should mention key product benefits', () => {
    // dotdo should highlight Durable Objects benefits
    const benefitPatterns = [
      /stateful/i,
      /durable/i,
      /edge/i,
      /real-?time/i,
      /scalable?/i,
      /type-?safe/i,
      /typescript/i,
    ]
    const hasBenefits = benefitPatterns.some((pattern) => pattern.test(html))
    expect(hasBenefits).toBe(true)
  })

  it('should have feature icons or illustrations', () => {
    // Look for SVG icons or images in features
    const hasIcons =
      html.includes('<svg') || html.includes('<img') || html.includes('icon')
    expect(hasIcons).toBe(true)
  })
})

// ============================================================================
// CTA Section Tests
// ============================================================================

describe('CTA Buttons', () => {
  let html: string
  let links: { href: string; text: string }[]

  beforeAll(async () => {
    html = await fetchPage('/')
    links = getLinks(html)
  })

  it('should have a Get Started link', () => {
    const getStartedLink = links.find(
      (l) =>
        l.text.toLowerCase().includes('get started') ||
        l.text.toLowerCase().includes('start')
    )
    expect(getStartedLink).toBeDefined()
  })

  it('should have a link to documentation', () => {
    const docsLink = links.find(
      (l) => l.href.includes('/docs') || l.text.toLowerCase().includes('docs')
    )
    expect(docsLink).toBeDefined()
    expect(docsLink!.href).toContain('/docs')
  })

  it('should have a link to admin dashboard', () => {
    const adminLink = links.find(
      (l) =>
        l.href.includes('/admin') ||
        l.text.toLowerCase().includes('dashboard') ||
        l.text.toLowerCase().includes('admin')
    )
    expect(adminLink).toBeDefined()
  })

  it('should have buttons with proper styling classes', () => {
    // Look for styled button elements or link buttons
    const hasStyledButtons =
      html.includes('btn') ||
      html.includes('button') ||
      html.includes('Button')
    expect(hasStyledButtons).toBe(true)
  })

  it('should have a bottom CTA section', () => {
    // Often there's a CTA section at the bottom before footer
    const ctaSection = html.match(/cta|call-to-action|get-started/gi)
    expect(ctaSection).not.toBeNull()
  })
})

// ============================================================================
// Navigation Tests
// ============================================================================

describe('Navigation', () => {
  let html: string
  let links: { href: string; text: string }[]

  beforeAll(async () => {
    html = await fetchPage('/')
    links = getLinks(html)
  })

  it('should have a navigation element', () => {
    expect(html).toContain('<nav')
  })

  it('should have navigation with proper role', () => {
    expect(hasRole(html, 'navigation')).toBe(true)
  })

  it('should have a home/logo link', () => {
    const homeLink = links.find(
      (l) => l.href === '/' || l.text.toLowerCase().includes('dotdo')
    )
    expect(homeLink).toBeDefined()
  })

  it('should have docs navigation link', () => {
    const docsLink = links.find((l) => l.href.includes('/docs'))
    expect(docsLink).toBeDefined()
  })

  it('should have GitHub link', () => {
    const githubLink = links.find((l) => l.href.includes('github'))
    expect(githubLink).toBeDefined()
  })

  it('should have navigation items visible', () => {
    // Navigation should not be hidden by default on desktop
    expect(html).not.toMatch(/nav[^>]*style="[^"]*display:\s*none/i)
  })

  it('should have skip to content link for accessibility', () => {
    const skipLink = links.find(
      (l) =>
        l.text.toLowerCase().includes('skip') ||
        l.href.includes('#main') ||
        l.href.includes('#content')
    )
    expect(skipLink).toBeDefined()
  })
})

// ============================================================================
// Footer Tests
// ============================================================================

describe('Footer', () => {
  let html: string
  let links: { href: string; text: string }[]

  beforeAll(async () => {
    html = await fetchPage('/')
    links = getLinks(html)
  })

  it('should have a footer element', () => {
    expect(html).toContain('<footer')
  })

  it('should have footer with proper role', () => {
    expect(hasRole(html, 'contentinfo')).toBe(true)
  })

  it('should have copyright notice', () => {
    expect(html).toMatch(/copyright|©|\(c\)/i)
  })

  it('should have current year in copyright', () => {
    const currentYear = new Date().getFullYear().toString()
    expect(html).toContain(currentYear)
  })

  it('should have social links', () => {
    const socialLinks = links.filter(
      (l) =>
        l.href.includes('github') ||
        l.href.includes('twitter') ||
        l.href.includes('discord') ||
        l.href.includes('linkedin')
    )
    expect(socialLinks.length).toBeGreaterThan(0)
  })

  it('should have footer navigation links', () => {
    // Footer should have some useful links
    const footerLinkPatterns = ['/docs', '/privacy', '/terms', '/about']
    const hasFooterLinks = footerLinkPatterns.some((pattern) =>
      links.some((l) => l.href.includes(pattern))
    )
    expect(hasFooterLinks).toBe(true)
  })
})

// ============================================================================
// Responsive Design Tests
// ============================================================================

describe('Responsive Design', () => {
  let html: string

  beforeAll(async () => {
    html = await fetchPage('/')
  })

  it('should have viewport meta tag', () => {
    const viewport = getMetaContent(html, 'viewport')
    expect(viewport).not.toBeNull()
    expect(viewport).toContain('width=device-width')
  })

  it('should use responsive CSS classes', () => {
    // Check for Tailwind responsive prefixes
    const responsivePatterns = [/sm:|md:|lg:|xl:|2xl:/]
    const hasResponsiveClasses = responsivePatterns.some((pattern) =>
      pattern.test(html)
    )
    expect(hasResponsiveClasses).toBe(true)
  })

  it('should have mobile menu toggle', () => {
    // Look for mobile menu button/hamburger
    const hasMobileMenu =
      html.includes('menu') ||
      html.includes('hamburger') ||
      hasAriaLabel(html, 'menu') ||
      hasAriaLabel(html, 'Toggle menu') ||
      hasAriaLabel(html, 'Open menu')
    expect(hasMobileMenu).toBe(true)
  })

  it('should have flex or grid layout', () => {
    expect(html).toMatch(/flex|grid/i)
  })

  it('should have max-width container', () => {
    expect(html).toMatch(/max-w-|container/i)
  })

  it('should have responsive images', () => {
    // Images should have proper sizing attributes
    if (html.includes('<img')) {
      const hasResponsiveImages =
        html.includes('srcset') ||
        html.match(/<img[^>]*class="[^"]*w-/i) ||
        html.match(/<img[^>]*width=/i)
      expect(hasResponsiveImages).toBe(true)
    }
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance Targets', () => {
  let html: string

  beforeAll(async () => {
    html = await fetchPage('/')
  })

  it('should have preload hints for critical resources', () => {
    // Look for preload/prefetch hints
    const hasPreload =
      html.includes('rel="preload"') ||
      html.includes('rel="prefetch"') ||
      html.includes('rel="preconnect"')
    expect(hasPreload).toBe(true)
  })

  it('should have inline critical CSS or CSS preload', () => {
    // Either inline styles or preload for CSS
    const hasCriticalCSS =
      html.includes('<style') ||
      html.match(/<link[^>]*rel="preload"[^>]*as="style"/i)
    expect(hasCriticalCSS).toBe(true)
  })

  it('should have deferred or async scripts', () => {
    // Non-critical scripts should be deferred
    if (html.includes('<script')) {
      const scriptMatches = html.match(/<script[^>]*src=[^>]*>/gi) || []
      const hasOptimizedScripts =
        scriptMatches.length === 0 ||
        scriptMatches.some((s) => s.includes('defer') || s.includes('async'))
      expect(hasOptimizedScripts).toBe(true)
    }
  })

  it('should have reasonable HTML size (< 100KB)', () => {
    const sizeInBytes = new Blob([html]).size
    const maxSize = 100 * 1024 // 100KB
    expect(sizeInBytes).toBeLessThan(maxSize)
  })

  it('should not have excessive inline JavaScript', () => {
    // Inline JS should be minimal
    const inlineScripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || []
    const totalInlineJS = inlineScripts
      .filter((s) => !s.includes('src='))
      .reduce((acc, s) => acc + s.length, 0)
    // Inline JS should be < 10KB
    expect(totalInlineJS).toBeLessThan(10 * 1024)
  })

  it('should have images with loading=lazy where appropriate', () => {
    // Images below the fold should have lazy loading
    const images = html.match(/<img[^>]*>/gi) || []
    if (images.length > 1) {
      // At least one non-hero image should have lazy loading
      const hasLazyImages = images.some((img) => img.includes('loading="lazy"'))
      expect(hasLazyImages).toBe(true)
    }
  })
})

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('Accessibility', () => {
  let html: string

  beforeAll(async () => {
    html = await fetchPage('/')
  })

  it('should have lang attribute on html element', () => {
    expect(html).toMatch(/<html[^>]+lang=["'][a-z]{2}(-[A-Z]{2})?["']/i)
  })

  it('should have main landmark', () => {
    expect(html).toContain('<main') || expect(hasRole(html, 'main')).toBe(true)
  })

  it('should have header landmark', () => {
    expect(html).toContain('<header') ||
      expect(hasRole(html, 'banner')).toBe(true)
  })

  it('should have proper heading hierarchy', () => {
    const headings = getHeadings(html)
    let previousLevel = 0
    for (const heading of headings) {
      if (heading.level > previousLevel) {
        // Can only increase by 1 level
        expect(heading.level - previousLevel).toBeLessThanOrEqual(1)
      }
      previousLevel = heading.level
    }
  })

  it('should have alt text on images', () => {
    const images = html.match(/<img[^>]*>/gi) || []
    for (const img of images) {
      const hasAlt = img.includes('alt=')
      const isDecorative = img.includes('alt=""') || img.includes("alt=''")
      const hasAriaHidden = img.includes('aria-hidden="true"')
      // Either has alt, is marked decorative, or is aria-hidden
      expect(hasAlt || hasAriaHidden).toBe(true)
    }
  })

  it('should have focus-visible styles', () => {
    // Look for focus styles in CSS
    const hasFocusStyles =
      html.includes('focus:') ||
      html.includes('focus-visible:') ||
      html.includes(':focus')
    expect(hasFocusStyles).toBe(true)
  })

  it('should have ARIA labels for icon buttons', () => {
    // Buttons with only icons should have aria-label
    const iconButtons = html.match(/<button[^>]*>[\s]*<svg/gi) || []
    for (const button of iconButtons) {
      expect(button).toMatch(/aria-label=/i)
    }
  })

  it('should have keyboard navigable interactive elements', () => {
    // Check that interactive elements are not disabled for keyboard
    expect(html).not.toMatch(/tabindex=["']-1["'][^>]*>[^<]*<\/a/i)
  })

  it('should have proper link text (no "click here")', () => {
    const links = getLinks(html)
    const badLinkTexts = ['click here', 'here', 'read more', 'learn more']
    for (const link of links) {
      const normalizedText = link.text.toLowerCase().trim()
      // If it's a generic text, it should have aria-label
      if (badLinkTexts.includes(normalizedText)) {
        // Check if the full anchor tag has aria-label
        const linkPattern = new RegExp(
          `<a[^>]*href=["']${link.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
          'i'
        )
        const match = html.match(linkPattern)
        if (match) {
          expect(match[0]).toMatch(/aria-label=/i)
        }
      }
    }
  })

  it('should have skip navigation link', () => {
    const links = getLinks(html)
    const skipLink = links.find(
      (l) =>
        l.text.toLowerCase().includes('skip') &&
        (l.href.includes('#main') || l.href.includes('#content'))
    )
    expect(skipLink).toBeDefined()
  })

  it('should have proper color contrast indication in code', () => {
    // At minimum, should be using a proper color scheme
    expect(html).toMatch(/dark:|theme|color-scheme/i)
  })
})

// ============================================================================
// SEO Tests
// ============================================================================

describe('Landing Page SEO', () => {
  let html: string

  beforeAll(async () => {
    html = await fetchPage('/')
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

  it('should have og:image', () => {
    const ogImage = getMetaContent(html, 'og:image')
    expect(ogImage).not.toBeNull()
    expect(ogImage).toMatch(/^https?:\/\//)
  })

  it('should have og:type set to website', () => {
    const ogType = getMetaContent(html, 'og:type')
    expect(ogType).toBe('website')
  })

  it('should have twitter:card', () => {
    const twitterCard = getMetaContent(html, 'twitter:card')
    expect(twitterCard).not.toBeNull()
  })

  it('should have canonical URL', () => {
    const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)
    expect(canonical).not.toBeNull()
  })

  it('should have structured data (JSON-LD)', () => {
    expect(html).toContain('application/ld+json')
  })
})

// ============================================================================
// Component Integration Tests
// ============================================================================

describe('@mdxui/beacon Integration', () => {
  let html: string

  beforeAll(async () => {
    html = await fetchPage('/')
  })

  it('should render Hero component', () => {
    // Hero component should be present with expected structure
    const hasHero =
      html.includes('hero') ||
      html.includes('Hero') ||
      html.match(/<section[^>]*class="[^"]*hero/i)
    expect(hasHero).toBe(true)
  })

  it('should render Features component', () => {
    const hasFeatures =
      html.includes('features') ||
      html.includes('Features') ||
      html.match(/<section[^>]*class="[^"]*feature/i)
    expect(hasFeatures).toBe(true)
  })

  it('should render CTA component', () => {
    const hasCTA =
      html.includes('cta') ||
      html.includes('CTA') ||
      html.match(/<section[^>]*class="[^"]*cta/i)
    expect(hasCTA).toBe(true)
  })

  it('should use @mdxui/themes styling', () => {
    // Look for theme-related classes or CSS custom properties
    const hasTheme =
      html.includes('--') || // CSS custom properties
      html.includes('theme') ||
      html.includes('dark:') ||
      html.includes('light:')
    expect(hasTheme).toBe(true)
  })
})

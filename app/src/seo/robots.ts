/**
 * robots.txt generator for SEO and AI crawler optimization
 *
 * This module generates a robots.txt that:
 * - Allows all standard web crawlers
 * - Explicitly allows AI crawlers (GPTBot, anthropic-ai, Google-Extended, Claude-Web)
 * - References the sitemap for better crawl discovery
 */

const SITE_URL = 'https://do.md'

/**
 * Generate robots.txt content
 */
export function getRobotsTxt(): string {
  return `# robots.txt for do.md
# Allow all crawlers including AI assistants

# Default: Allow all
User-agent: *
Allow: /

# AI Crawlers - explicitly allowed
User-agent: GPTBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Amazonbot
Allow: /

# Sitemap location
Sitemap: ${SITE_URL}/sitemap.xml
`
}

/**
 * Sitemap XML Route
 *
 * Generates a dynamic sitemap.xml for search engine crawling.
 * This route returns XML content type with all public pages.
 *
 * @see https://tanstack.com/start/latest/docs/routing/api-routes
 * @see https://www.sitemaps.org/protocol.html
 */
import { createAPIFileRoute } from '@tanstack/react-start/api'
import { SEO_DEFAULTS } from '../../lib/seo'

/**
 * Static pages to include in sitemap
 */
const STATIC_PAGES = [
  { url: '/', priority: 1.0, changefreq: 'daily' },
  { url: '/docs', priority: 0.9, changefreq: 'weekly' },
] as const

/**
 * Generate ISO date string for lastmod
 */
function getLastMod(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Generate sitemap XML content
 */
function generateSitemapXml(): string {
  const lastmod = getLastMod()
  const baseUrl = SEO_DEFAULTS.siteUrl

  const urls = STATIC_PAGES.map(
    (page) => `
  <url>
    <loc>${baseUrl}${page.url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
  ).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
                            http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">${urls}
</urlset>`
}

export const Route = createAPIFileRoute('/sitemap.xml')({
  GET: async () => {
    const xml = generateSitemapXml()

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    })
  },
})

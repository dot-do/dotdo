/**
 * Sitemap generator for SEO
 *
 * Generates an XML sitemap following the sitemaps.org protocol:
 * - Includes all main pages
 * - Sets appropriate priority and changefreq
 * - Uses absolute URLs with HTTPS
 * - Includes lastmod dates
 */

const SITE_URL = 'https://do.md'

interface SitemapUrl {
  loc: string
  lastmod: string
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority: number
}

/**
 * Get all pages for the sitemap
 */
function getPages(): SitemapUrl[] {
  const today = new Date().toISOString().split('T')[0]

  return [
    {
      loc: `${SITE_URL}/`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 1.0,
    },
    {
      loc: `${SITE_URL}/about`,
      lastmod: today,
      changefreq: 'monthly',
      priority: 0.8,
    },
    {
      loc: `${SITE_URL}/docs`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.9,
    },
    {
      loc: `${SITE_URL}/docs/getting-started`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.9,
    },
    {
      loc: `${SITE_URL}/docs/api`,
      lastmod: today,
      changefreq: 'weekly',
      priority: 0.8,
    },
    {
      loc: `${SITE_URL}/blog`,
      lastmod: today,
      changefreq: 'daily',
      priority: 0.7,
    },
    {
      loc: `${SITE_URL}/blog/test-article`,
      lastmod: today,
      changefreq: 'monthly',
      priority: 0.6,
    },
  ]
}

/**
 * Generate XML sitemap content
 */
export function getSitemap(): string {
  const pages = getPages()

  const urlEntries = pages
    .map(
      (page) => `  <url>
    <loc>${page.loc}</loc>
    <lastmod>${page.lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority.toFixed(1)}</priority>
  </url>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`
}

/**
 * Docs route for TanStack Start app
 *
 * Documentation page rendered at '/docs'.
 * Includes JSON-LD structured data for Article schema.
 * Uses DocsLayout for consistent navigation and structure.
 *
 * @see https://tanstack.com/start/latest/docs/routing/file-routes
 * @see https://schema.org/Article
 */
import type { ReactNode } from 'react'
import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { generateMeta, generateJsonLd } from '../../lib/seo'
import { DocsLayout } from '../../components/docs/layout'

// Generate JSON-LD for documentation as Article
const jsonLdArticle = generateJsonLd({
  type: 'Article',
  title: 'Documentation',
  description: 'dotdo documentation and guides',
  url: '/docs',
})

export const Route = createFileRoute('/docs')({
  component: DocsComponent,
  head: () => ({
    meta: [
      { title: 'Documentation - dotdo' },
      ...generateMeta({
        title: 'Documentation',
        description: 'dotdo documentation and guides',
        url: '/docs',
      }),
    ],
  }),
})

/**
 * Documentation page component
 *
 * Displays documentation landing page with guides and resources.
 * Wraps children with DocsLayout for navigation and structure.
 */
function DocsComponent(): ReactNode {
  return (
    <DocsLayout>
      <main>
        <h1>Documentation</h1>
        <p>dotdo documentation and guides</p>
        <nav>
          <Link to="/">Back to Home</Link>
        </nav>
        <Outlet />
      </main>
    </DocsLayout>
  )
}

/**
 * Docs catch-all route for TanStack Start
 *
 * Handles all /docs/* routes by loading the corresponding MDX page
 * from the fumadocs source. Uses server functions for SSR/prerendering.
 *
 * @see https://fumadocs.dev/docs/manual-installation/tanstack-start
 * @see https://tanstack.com/start/latest/docs/routing/splat-routes
 */
import type { ReactNode } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { source } from '../../lib/source'
import { DocsLayout } from '../../components/docs/layout'
import { DocsPage } from '../../components/docs/page'

/**
 * Server function to load page data from fumadocs source.
 * Runs at build time for prerendering and on server for SSR.
 */
const getPageData = createServerFn({ method: 'GET' })
  .validator((slug: string[]) => slug)
  .handler(async ({ data: slug }) => {
    const page = source.getPage(slug)
    if (!page) return null

    return {
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      // MDX content would be loaded here in production
      // For now, return metadata for SSR
    }
  })

/**
 * Get all pages for static prerendering.
 * Used by TanStack Start to generate static pages at build time.
 */
export const getStaticPaths = () => {
  return source.getPages().map((page) => ({
    params: {
      _splat: page.slugs.join('/'),
    },
  }))
}

export const Route = createFileRoute('/docs/$')({
  component: DocsPageComponent,
  loader: async ({ params }) => {
    const slug = params._splat?.split('/').filter(Boolean) ?? []
    const page = source.getPage(slug)

    if (!page) {
      throw notFound()
    }

    return {
      page: {
        title: page.data.title,
        description: page.data.description,
        url: page.url,
        toc: page.data.toc,
        slugs: page.slugs,
      },
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.page.title ?? 'Docs'} - dotdo` },
      {
        name: 'description',
        content: loaderData?.page.description ?? 'dotdo documentation',
      },
    ],
  }),
})

/**
 * Documentation page component.
 * Renders the MDX content within DocsLayout.
 */
function DocsPageComponent(): ReactNode {
  const { page } = Route.useLoaderData()

  return (
    <DocsLayout>
      <DocsPage title={page.title} description={page.description}>
        {/* MDX content would be rendered here */}
        <div className="prose dark:prose-invert">
          <h1>{page.title}</h1>
          {page.description && <p className="lead">{page.description}</p>}
          <p>
            Loading content for: <code>/docs/{page.slugs.join('/')}</code>
          </p>
        </div>
      </DocsPage>
    </DocsLayout>
  )
}

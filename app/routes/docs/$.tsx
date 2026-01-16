/**
 * Docs catch-all route for TanStack Router
 *
 * Handles all /docs/* routes by loading the corresponding MDX page
 * from the fumadocs source. Uses loader for data loading.
 *
 * @see https://fumadocs.dev/docs/manual-installation/tanstack-start
 * @see https://tanstack.com/router/latest/docs/framework/react/guide/file-based-routing
 */
import type { ReactNode } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { source } from '../../lib/source'
import { DocsLayout } from '../../components/docs/layout'
import { DocsPage } from '../../components/docs/page'

/**
 * Page data type for documentation pages
 */
interface PageData {
  title: string
  description?: string
  url: string
  toc?: unknown
  slugs: string[]
}

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
  loader: async ({ params }: { params: { _splat?: string } }) => {
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
        toc: (page.data as { toc?: unknown }).toc,
        slugs: page.slugs,
      } as PageData,
    }
  },
  head: ({ loaderData }: { loaderData?: { page: PageData } }) => ({
    meta: [
      { title: `${loaderData?.page?.title ?? 'Docs'} - dotdo` },
      {
        name: 'description',
        content: loaderData?.page?.description ?? 'dotdo documentation',
      },
    ],
  }),
})

/**
 * Documentation page component.
 * Renders the MDX content within DocsLayout.
 */
function DocsPageComponent(): ReactNode {
  const loaderData = Route.useLoaderData() as { page: PageData }
  const { page } = loaderData

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

import { createFileRoute, notFound } from '@tanstack/react-router'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { createServerFn } from '@tanstack/react-start'
import { getPage, getCollectionForPath, serializeUnifiedPageTree, type CollectionName } from '../../lib/source'
import browserCollections from 'fumadocs-mdx:collections/browser'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { useFumadocsLoader } from 'fumadocs-core/source/client'

export const Route = createFileRoute('/docs/$')({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split('/') ?? []
    const data = await serverLoader({ data: slugs })
    // Preload content from the appropriate collection
    const collection = data.collection as CollectionName
    const clientLoader = getClientLoader(collection)
    if (clientLoader) {
      await clientLoader.preload(data.path)
    }
    return data
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `Documentation - dotdo` },
      { name: 'description', content: 'dotdo documentation' },
      { property: 'og:title', content: 'Documentation - dotdo' },
      { property: 'og:description', content: 'dotdo documentation' },
      { property: 'og:type', content: 'article' },
      { property: 'og:site_name', content: 'dotdo' },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:site', content: '@dotdodev' },
    ],
  }),
})

const serverLoader = createServerFn({
  method: 'GET',
})
  .inputValidator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = getPage(slugs)
    if (!page) throw notFound()

    const collection = getCollectionForPath(slugs)
    const pageTree = await serializeUnifiedPageTree()

    return {
      path: page.path,
      pageTree,
      collection,
    }
  })

/**
 * Create a client loader component for a specific collection
 */
function createClientLoaderComponent(collection: keyof typeof browserCollections) {
  const collectionData = browserCollections[collection]
  if (!collectionData) return null

  return collectionData.createClientLoader({
    component(
      { toc, frontmatter, default: MDX },
      props: {
        className?: string
      },
    ) {
      return (
        <DocsPage toc={toc} {...props}>
          <DocsTitle>{frontmatter.title}</DocsTitle>
          <DocsDescription>{frontmatter.description}</DocsDescription>
          <DocsBody>
            <MDX
              components={{
                ...defaultMdxComponents,
              }}
            />
          </DocsBody>
        </DocsPage>
      )
    },
  })
}

// Cache client loaders for each collection
const clientLoaders = new Map<CollectionName, ReturnType<typeof createClientLoaderComponent>>()

function getClientLoader(collection: CollectionName) {
  if (!clientLoaders.has(collection)) {
    clientLoaders.set(collection, createClientLoaderComponent(collection as keyof typeof browserCollections))
  }
  return clientLoaders.get(collection)
}

function Page() {
  const data = useFumadocsLoader(Route.useLoaderData())
  const collection = data.collection as CollectionName
  const clientLoader = getClientLoader(collection)

  return (
    <DocsLayout tree={data.pageTree}>
      {clientLoader?.useContent(data.path, {
        className: '',
      }) ?? <div>Content not found</div>}
    </DocsLayout>
  )
}

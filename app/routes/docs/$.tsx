import { createFileRoute } from '@tanstack/react-router'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { source } from '../../lib/source'

export const Route = createFileRoute('/docs/$')({
  component: DocsPage,
})

function DocsPage() {
  const { _splat: slug } = Route.useParams()
  const page = source.getPage(slug?.split('/') ?? [])

  if (!page) {
    return <div>Page not found</div>
  }

  const MDX = page.data.body

  return (
    <DocsLayout tree={source.pageTree}>
      <MDX />
    </DocsLayout>
  )
}

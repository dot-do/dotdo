import { loader } from 'fumadocs-core/source'
import type { Source } from 'fumadocs-core/source'

// TODO: Re-enable fumadocs-mdx collections once build is working
// import { docs, meta } from 'fumadocs-mdx:collections'

// Stub source with empty files until fumadocs-mdx is configured
const stubSource: Source<{
  metaData: { title?: string; pages?: string[] }
  pageData: { title: string; description?: string }
}> = {
  files: [],
}

export const source = loader({
  baseUrl: '/docs',
  source: stubSource,
})

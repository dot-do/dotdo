import { loader } from 'fumadocs-core/source'
import { docs, meta } from 'fumadocs-mdx:collections'

export const source = loader({
  baseUrl: '/docs',
  source: { docs, meta },
})

import { loader } from 'fumadocs-core/source'

// TODO: Re-enable fumadocs-mdx collections once build is working
// import { docs, meta } from 'fumadocs-mdx:collections'

export const source = loader({
  baseUrl: '/docs',
  source: {
    docs: { type: 'docs', files: () => [] },
    meta: { type: 'meta', files: () => [] }
  },
})

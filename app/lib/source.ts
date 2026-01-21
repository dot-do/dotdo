import { loader } from 'fumadocs-core/source'
import { createMDXSource } from 'fumadocs-mdx'
import { icons } from 'lucide-react'
import { createElement } from 'react'

// Import MDX files
// Note: In production, you'd use a build-time plugin to import these
// For now, we'll configure the source to load from the content directory
export const source = loader({
  baseUrl: '/docs',
  icon(icon) {
    if (icon && icon in icons)
      return createElement(icons[icon as keyof typeof icons])
  },
  source: createMDXSource([], {
    // Source maps will be populated by the MDX loader at build time
  }),
})

import { loader } from 'fumadocs-core/source'
import { icons } from 'lucide-react'
import { createElement } from 'react'

// Import MDX files
// Note: In production, you'd use a build-time plugin to import these
// For now, we'll configure the source to load from the content directory
// TODO: Configure fumadocs-mdx with proper source.config.ts for TanStack Start
// The createMDXSource API has changed - it now requires a configured .source folder
// See: https://fumadocs.dev/blog/mdx-v10-summary
export const source = loader({
  baseUrl: '/docs',
  icon(icon) {
    if (icon && icon in icons)
      return createElement(icons[icon as keyof typeof icons])
  },
  // Placeholder source - MDX integration pending proper setup
  source: {
    files: [],
  },
})

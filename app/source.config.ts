import { defineConfig, defineDocs, defineCollections, frontmatterSchema } from 'fumadocs-mdx/config'

/**
 * Static MDX Build System Configuration
 *
 * This configuration enables:
 * 1. Landing Page (/) - Renders from Site.mdx
 * 2. Consumer App (/app) - Renders from App.mdx
 * 3. Docs (/docs) - Renders from docs/ folder via fumadocs-mdx
 *
 * NOTE: Only a subset of docs are enabled. Many docs files are missing
 * required frontmatter (title field). To enable more collections:
 * 1. Add frontmatter with title to all .md/.mdx files in the collection
 * 2. Uncomment the collection export below
 * 3. Add corresponding source loader in lib/source.ts
 *
 * @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

// =============================================================================
// Site MDX Collection - Landing page from Site.mdx
// =============================================================================
export const site = defineCollections({
  type: 'doc',
  dir: '..',
  schema: frontmatterSchema,
  files: ['Site.mdx'],
})

// =============================================================================
// App MDX Collection - Dashboard from App.mdx
// =============================================================================
export const appContent = defineCollections({
  type: 'doc',
  dir: '..',
  schema: frontmatterSchema,
  files: ['App.mdx'],
})

// =============================================================================
// Documentation Collections - Minimal set (frontmatter validated)
// =============================================================================

// Core docs with validated frontmatter
export const gettingStarted = defineDocs({ dir: '../docs/getting-started' })
export const concepts = defineDocs({ dir: '../docs/concepts' })
export const api = defineDocs({ dir: '../docs/api' })

// NOTE: Collections below are disabled due to missing frontmatter.
// To enable, add frontmatter with title field to all files in the collection.

// export const guides = defineDocs({ dir: '../docs/guides' })
// export const sdk = defineDocs({ dir: '../docs/sdk' })
// export const rpc = defineDocs({ dir: '../docs/rpc' })
// export const cli = defineDocs({ dir: '../docs/cli' })
// export const architecture = defineDocs({ dir: '../docs/architecture' })
// export const objects = defineDocs({ dir: '../docs/objects' })
// export const compat = defineDocs({ dir: '../docs/compat' })
// export const database = defineDocs({ dir: '../docs/database' })
// export const storage = defineDocs({ dir: '../docs/storage' })
// export const lib = defineDocs({ dir: '../docs/lib' })
// export const agents = defineDocs({ dir: '../docs/agents' })
// export const workflows = defineDocs({ dir: '../docs/workflows' })
// export const humans = defineDocs({ dir: '../docs/humans' })
// export const actions = defineDocs({ dir: '../docs/actions' })
// export const events = defineDocs({ dir: '../docs/events' })
// export const functions = defineDocs({ dir: '../docs/functions' })
// export const deployment = defineDocs({ dir: '../docs/deployment' })
// export const observability = defineDocs({ dir: '../docs/observability' })
// export const security = defineDocs({ dir: '../docs/security' })
// export const platform = defineDocs({ dir: '../docs/platform' })
// export const transport = defineDocs({ dir: '../docs/transport' })
// export const integrations = defineDocs({ dir: '../docs/integrations' })
// export const primitives = defineDocs({ dir: '../docs/primitives' })
// export const mcp = defineDocs({ dir: '../docs/mcp' })
// export const ui = defineDocs({ dir: '../docs/ui' })

export default defineConfig()

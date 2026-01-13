import { defineConfig, defineDocs, defineCollections, frontmatterSchema } from 'fumadocs-mdx/config'

/**
 * Static MDX Build System Configuration
 *
 * This configuration enables:
 * 1. Landing Page (/) - Renders from Site.mdx
 * 2. Consumer App (/app) - Renders from App.mdx
 * 3. Docs (/docs) - Renders from docs/ folder via fumadocs-mdx
 *
 * @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

// =============================================================================
// Site MDX Collection - Landing page from Site.mdx
// =============================================================================
export const site = defineCollections({
  type: 'doc',
  dir: '..',
  // Use default frontmatter schema (title, description are auto-extracted)
  schema: frontmatterSchema,
  // Only include Site.mdx from root
  files: ['Site.mdx'],
})

// =============================================================================
// App MDX Collection - Dashboard from App.mdx
// =============================================================================
export const appContent = defineCollections({
  type: 'doc',
  dir: '..',
  // Use default frontmatter schema
  schema: frontmatterSchema,
  // Only include App.mdx from root
  files: ['App.mdx'],
})

// =============================================================================
// Documentation Collections - All docs folders for 100% static prerender
// =============================================================================

// Getting Started & Core Concepts
export const gettingStarted = defineDocs({ dir: '../docs/getting-started' })
export const concepts = defineDocs({ dir: '../docs/concepts' })
export const guides = defineDocs({ dir: '../docs/guides' })

// API & SDK Reference
export const api = defineDocs({ dir: '../docs/api' })
export const sdk = defineDocs({ dir: '../docs/sdk' })
export const rpc = defineDocs({ dir: '../docs/rpc' })
export const cli = defineDocs({ dir: '../docs/cli' })

// Architecture & Objects
export const architecture = defineDocs({ dir: '../docs/architecture' })
export const objects = defineDocs({ dir: '../docs/objects' })
export const compat = defineDocs({ dir: '../docs/compat' })

// Database & Storage
export const database = defineDocs({ dir: '../docs/database' })
export const storage = defineDocs({ dir: '../docs/storage' })
export const lib = defineDocs({ dir: '../docs/lib' })

// Agents & Workflows
export const agents = defineDocs({ dir: '../docs/agents' })
export const workflows = defineDocs({ dir: '../docs/workflows' })
export const humans = defineDocs({ dir: '../docs/humans' })
export const actions = defineDocs({ dir: '../docs/actions' })
export const events = defineDocs({ dir: '../docs/events' })
export const functions = defineDocs({ dir: '../docs/functions' })

// Infrastructure & Platform
export const deployment = defineDocs({ dir: '../docs/deployment' })
export const observability = defineDocs({ dir: '../docs/observability' })
export const security = defineDocs({ dir: '../docs/security' })
export const platform = defineDocs({ dir: '../docs/platform' })
export const transport = defineDocs({ dir: '../docs/transport' })

// Extensions & Integrations
export const integrations = defineDocs({ dir: '../docs/integrations' })
export const primitives = defineDocs({ dir: '../docs/primitives' })
export const mcp = defineDocs({ dir: '../docs/mcp' })
export const ui = defineDocs({ dir: '../docs/ui' })

export default defineConfig()

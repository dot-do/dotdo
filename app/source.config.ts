import { defineConfig, defineDocs } from 'fumadocs-mdx/config'

/**
 * Multi-collection fumadocs configuration
 *
 * Each docs folder gets its own collection for:
 * - Independent chunking (better memory during build)
 * - Separate navigation trees
 * - Smaller bundle sizes per route
 *
 * @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

// Core documentation sections
export const concepts = defineDocs({ dir: '../docs/concepts' })
export const api = defineDocs({ dir: '../docs/api' })
export const gettingStarted = defineDocs({ dir: '../docs/getting-started' })

// Platform & Infrastructure
export const agents = defineDocs({ dir: '../docs/agents' })
export const cli = defineDocs({ dir: '../docs/cli' })
export const database = defineDocs({ dir: '../docs/database' })
export const deployment = defineDocs({ dir: '../docs/deployment' })

// Integration & SDK docs
export const integrations = defineDocs({ dir: '../docs/integrations' })
export const sdk = defineDocs({ dir: '../docs/sdk' })
export const rpc = defineDocs({ dir: '../docs/rpc' })

// Advanced topics
export const guides = defineDocs({ dir: '../docs/guides' })
export const observability = defineDocs({ dir: '../docs/observability' })
export const primitives = defineDocs({ dir: '../docs/primitives' })
export const security = defineDocs({ dir: '../docs/security' })
export const storage = defineDocs({ dir: '../docs/storage' })
export const workflows = defineDocs({ dir: '../docs/workflows' })

// Additional sections
export const actions = defineDocs({ dir: '../docs/actions' })
export const architecture = defineDocs({ dir: '../docs/architecture' })
export const compat = defineDocs({ dir: '../docs/compat' })
export const events = defineDocs({ dir: '../docs/events' })
export const functions = defineDocs({ dir: '../docs/functions' })
export const humans = defineDocs({ dir: '../docs/humans' })
export const mcp = defineDocs({ dir: '../docs/mcp' })
export const objects = defineDocs({ dir: '../docs/objects' })
export const platform = defineDocs({ dir: '../docs/platform' })
export const transport = defineDocs({ dir: '../docs/transport' })
export const ui = defineDocs({ dir: '../docs/ui' })

// Root-level docs is handled by the main sections
// Note: Plans folder is excluded as it contains internal design docs without proper frontmatter

export default defineConfig()

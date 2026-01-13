import { defineConfig, defineDocs } from 'fumadocs-mdx/config'

/**
 * MINIMAL fumadocs configuration for debugging memory issues
 *
 * The full multi-collection setup with 27 collections causes 8GB+ memory usage.
 * Starting with just core docs to get a working build, then incrementally adding.
 *
 * NOTE: No rootDocs collection - /docs redirects to /docs/getting-started
 *
 * @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

// Core documentation sections - MINIMAL SET for build debugging
export const gettingStarted = defineDocs({ dir: '../docs/getting-started' })
export const concepts = defineDocs({ dir: '../docs/concepts' })
export const api = defineDocs({ dir: '../docs/api' })

// All other collections disabled for now to fix build memory issues
// TODO: Re-enable incrementally after fixing SSR bundle size

export default defineConfig()

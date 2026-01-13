---
title: Fumadocs Static Prerender Design
description: Design doc for multi-collection static prerendering
---

# Fumadocs Static Prerender with Collection Chunking

**Date:** 2026-01-12
**Status:** Approved

## Problem

Fumadocs prerendering is disabled due to memory issues when processing 1,281+ docs in a single bundle. This prevents zero-cost static deployment on Cloudflare static assets.

## Solution

Split docs into multiple fumadocs collections (one per root folder), each generating its own chunk. This spreads memory usage across independent builds and enables full static prerendering.

## Design

### Collection Structure

```typescript
// app/source.config.ts
import { defineDocs } from 'fumadocs-mdx/config'

// One collection per root docs folder
export const agents = defineDocs({ dir: '../docs/agents' })
export const api = defineDocs({ dir: '../docs/api' })
export const architecture = defineDocs({ dir: '../docs/architecture' })
export const cli = defineDocs({ dir: '../docs/cli' })
export const compat = defineDocs({ dir: '../docs/compat' })
export const concepts = defineDocs({ dir: '../docs/concepts' })
export const database = defineDocs({ dir: '../docs/database' })
export const deployment = defineDocs({ dir: '../docs/deployment' })
export const integrations = defineDocs({ dir: '../docs/integrations' })
export const tutorials = defineDocs({ dir: '../docs/tutorials' })
```

### Composed Source & Navigation

```typescript
// app/lib/source.ts
import { loader } from 'fumadocs-core/source'
import { createMDXSource } from 'fumadocs-mdx'
import * as collections from '../.source'

// Compose all collections into unified source with prefixed paths
export const source = loader({
  sources: [
    createMDXSource(collections.agents, { rootDir: 'agents' }),
    createMDXSource(collections.api, { rootDir: 'api' }),
    createMDXSource(collections.compat, { rootDir: 'compat' }),
    createMDXSource(collections.concepts, { rootDir: 'concepts' }),
    createMDXSource(collections.cli, { rootDir: 'cli' }),
    createMDXSource(collections.database, { rootDir: 'database' }),
    createMDXSource(collections.deployment, { rootDir: 'deployment' }),
    createMDXSource(collections.integrations, { rootDir: 'integrations' }),
    createMDXSource(collections.tutorials, { rootDir: 'tutorials' }),
  ],
})

// Root tabs for top-level navigation
export const rootTabs = [
  { title: 'Concepts', url: '/docs/concepts' },
  { title: 'API', url: '/docs/api' },
  { title: 'SDKs', url: '/docs/compat' },
  { title: 'Agents', url: '/docs/agents' },
  { title: 'CLI', url: '/docs/cli' },
  { title: 'Database', url: '/docs/database' },
  { title: 'Deployment', url: '/docs/deployment' },
]
```

### Vite Chunking Configuration

```typescript
// app/vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('.source/agents')) return 'docs-agents'
          if (id.includes('.source/api')) return 'docs-api'
          if (id.includes('.source/compat')) return 'docs-sdks'
          if (id.includes('.source/concepts')) return 'docs-concepts'
          if (id.includes('.source/cli')) return 'docs-cli'
          if (id.includes('.source/database')) return 'docs-database'
          if (id.includes('.source/deployment')) return 'docs-deployment'
          if (id.includes('.source/integrations')) return 'docs-integrations'
          if (id.includes('.source/tutorials')) return 'docs-tutorials'
        },
      },
    },
  },
})
```

### Prerender Configuration

```typescript
// TanStack Start prerender
export default defineConfig({
  server: {
    prerender: {
      routes: async () => {
        const allPages = source.getPages()
        return allPages.map(page => page.url)
      },
      crawlLinks: true,
    },
  },
})
```

## Benefits

1. **Memory isolation** - Each collection builds independently
2. **Smaller chunks** - ~50-150KB per collection vs 2MB+ single bundle
3. **Independent navigation** - Each root folder has its own nav tree
4. **Zero-cost hosting** - Full static prerender on Cloudflare static assets
5. **Follows fumadocs conventions** - Native collection composition

## Implementation Plan

### Red (Tests First)
1. Test each collection exports independently
2. Test prerender generates static HTML for each docs page
3. Test chunks are split correctly (no single 2MB+ bundle)
4. Test root tabs navigation works

### Green (Implementation)
1. Split `source.config.ts` into per-folder collections
2. Update `lib/source.ts` to compose collections
3. Add manual chunks config to Vite
4. Enable prerender in TanStack Start config
5. Add root tabs to DocsLayout

### Refactor
1. Optimize chunk sizes if any collection still too large
2. Add build metrics to track bundle sizes
3. Clean up duplicate/unused docs

## Success Criteria

- [ ] All docs pages prerender to static HTML
- [ ] No single JS chunk > 500KB
- [ ] Build completes without memory errors
- [ ] Deploy to Cloudflare static assets at zero cost
- [ ] Root tabs navigation between doc categories

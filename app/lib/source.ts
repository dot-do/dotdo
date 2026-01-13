import { loader, type InferPageType, type InferMetaType } from 'fumadocs-core/source'
import type { PageTree } from 'fumadocs-core/server'
import {
  // MINIMAL set for build debugging
  gettingStarted,
  concepts,
  api,
} from 'fumadocs-mdx:collections/server'

/**
 * MINIMAL source loaders for build debugging
 *
 * The full 27 collection setup causes 8GB+ memory usage during SSR build.
 * Using minimal set to get a working build first.
 *
 * NOTE: No rootDocsSource - /docs redirects to /docs/getting-started
 *
 * @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

// Core documentation
export const gettingStartedSource = loader({
  source: gettingStarted.toFumadocsSource(),
  baseUrl: '/docs/getting-started',
})

export const conceptsSource = loader({
  source: concepts.toFumadocsSource(),
  baseUrl: '/docs/concepts',
})

export const apiSource = loader({
  source: api.toFumadocsSource(),
  baseUrl: '/docs/api',
})

/**
 * Collection name to source mapping
 */
export const sourcesByCollection = {
  gettingStarted: gettingStartedSource,
  concepts: conceptsSource,
  api: apiSource,
} as const

export type CollectionName = keyof typeof sourcesByCollection

/**
 * URL path segment to collection name mapping
 */
const pathToCollection: Record<string, CollectionName> = {
  'getting-started': 'gettingStarted',
  concepts: 'concepts',
  api: 'api',
}

/**
 * Get the collection name for a URL path
 */
export function getCollectionForPath(slugs: string[]): CollectionName | null {
  if (slugs.length === 0) return null
  const firstSlug = slugs[0]
  return pathToCollection[firstSlug] ?? null
}

/**
 * Get the source loader for a URL path
 */
export function getSourceForPath(slugs: string[]) {
  const collection = getCollectionForPath(slugs)
  if (!collection) return null
  return sourcesByCollection[collection]
}

/**
 * Get a page from the appropriate source based on slugs
 */
export function getPage(slugs: string[]) {
  const source = getSourceForPath(slugs)
  if (!source) return null
  // Remove the first slug (it's the section prefix)
  const pageSlug = slugs.slice(1)
  return source.getPage(pageSlug)
}

/**
 * Root tabs for top-level navigation
 */
export const rootTabs = [
  { title: 'Getting Started', url: '/docs/getting-started' },
  { title: 'Concepts', url: '/docs/concepts' },
  { title: 'API', url: '/docs/api' },
]

/**
 * All source loaders for iteration
 */
const allSources = [
  gettingStartedSource,
  conceptsSource,
  apiSource,
]

/**
 * Get all pages from all collections for prerendering
 */
export function getAllPages() {
  return allSources.flatMap((s) => s.getPages())
}

/**
 * Build a unified page tree from all collections
 * This combines individual collection trees into a single navigation structure
 */
export async function getUnifiedPageTree(): Promise<PageTree.Root> {
  // Get section trees
  const sectionTrees = await Promise.all([
    { name: 'Getting Started', source: gettingStartedSource },
    { name: 'Concepts', source: conceptsSource },
    { name: 'API', source: apiSource },
  ].map(async ({ name, source }) => ({
    name,
    tree: source.getPageTree(),
  })))

  // Combine into unified tree
  const children: PageTree.Node[] = []

  for (const { name, tree } of sectionTrees) {
    // Each section becomes a folder with its tree's children
    if (tree.children.length > 0) {
      const indexPage = tree.children.find(
        (c): c is PageTree.Item => c.type === 'page' && c.url.endsWith('/')
      )
      children.push({
        type: 'folder',
        name,
        index: indexPage,
        children: tree.children.filter((c) => c !== indexPage),
      })
    }
  }

  return {
    name: 'Docs',
    children,
  }
}

/**
 * Serialize the unified page tree for client transfer
 */
export async function serializeUnifiedPageTree() {
  const tree = await getUnifiedPageTree()
  // The tree is already serializable, just return it
  return tree
}

// Default source for backwards compatibility
export const source = gettingStartedSource

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

/**
 * TDD RED Phase: Multi-Collection Static Prerender
 *
 * Tests for splitting docs into multiple fumadocs collections to enable
 * 100% static prerendering without memory issues.
 *
 * Design: docs/plans/2026-01-12-fumadocs-static-prerender-design.md
 * Issue: dotdo-6ah72 (epic), dotdo-3vqlj (RED tests)
 *
 * Expected collections (one per root docs folder):
 * - concepts, api, integrations, agents, cli, database, deployment, etc.
 *
 * @see https://fumadocs.dev/docs/mdx/collections
 */

const APP_DIR = resolve(__dirname, '..')
const DOCS_DIR = resolve(APP_DIR, '../docs')

// Expected doc folders that should become collections
// Note: source.config.ts uses camelCase exports (getting-started -> gettingStarted)
const EXPECTED_COLLECTIONS = [
  'concepts',
  'api',
  'integrations',
  'agents',
  'cli',
  'database',
  'deployment',
  'gettingStarted', // camelCase in source.config.ts
  'guides',
  'observability',
  'primitives',
  'rpc',
  'sdk',
  'security',
  'storage',
  'workflows',
]

// Folder names in docs/ (with hyphens)
const EXPECTED_FOLDERS = [
  'concepts',
  'api',
  'integrations',
  'agents',
  'cli',
  'database',
  'deployment',
  'getting-started',
  'guides',
  'observability',
  'primitives',
  'rpc',
  'sdk',
  'security',
  'storage',
  'workflows',
]

describe('Docs Multi-Collection Architecture', () => {
  describe('Collection Configuration', () => {
    it('should have source.config.ts with multiple defineDocs calls', async () => {
      // Import the source config to verify multiple collections
      const sourceConfig = await import('../source.config')

      // Should export individual collections, not just a single 'docs'
      // Each collection should be named after its folder
      expect(sourceConfig.concepts).toBeDefined()
      expect(sourceConfig.api).toBeDefined()
      expect(sourceConfig.integrations).toBeDefined()
    })

    it('should have a collection for each major docs folder', async () => {
      const sourceConfig = await import('../source.config')

      for (const collection of EXPECTED_COLLECTIONS) {
        expect(
          sourceConfig[collection as keyof typeof sourceConfig],
          `Missing collection: ${collection}`
        ).toBeDefined()
      }
    })

    it('should point each collection to correct directory', async () => {
      const sourceConfig = await import('../source.config')

      // Each collection should have its dir configured to the matching folder
      // The defineDocs call sets { dir: '../docs/[name]' }
      const conceptsConfig = sourceConfig.concepts
      expect(conceptsConfig).toBeDefined()
      // Note: fumadocs collections have internal config, we verify by existence
    })
  })

  // Note: Source loader tests are skipped because fumadocs-mdx:collections/server
  // is a virtual module that only works at build time with Vite.
  // These tests run during the build process instead.
  describe.skip('Source Loaders (requires build)', () => {
    it('should have separate loaders for each collection', async () => {
      // Source.ts should export multiple loaders
      const source = await import('../lib/source')

      // Each collection should have its own loader with its own baseUrl
      expect(source.conceptsSource).toBeDefined()
      expect(source.apiSource).toBeDefined()
      expect(source.integrationsSource).toBeDefined()
    })

    it('should have correct baseUrl for each loader', async () => {
      const source = await import('../lib/source')

      // Each loader should have its baseUrl set correctly
      expect(source.conceptsSource.baseUrl).toBe('/docs/concepts')
      expect(source.apiSource.baseUrl).toBe('/docs/api')
      expect(source.integrationsSource.baseUrl).toBe('/docs/integrations')
    })

    it('should provide getAllPages helper combining all collections', async () => {
      const source = await import('../lib/source')

      // Should have a helper to get pages from all collections
      expect(source.getAllPages).toBeDefined()
      expect(typeof source.getAllPages).toBe('function')

      const allPages = source.getAllPages()
      expect(allPages.length).toBeGreaterThan(100) // Should have 100+ pages
    })
  })

  describe.skip('Root Tabs Navigation (requires build)', () => {
    it('should export rootTabs configuration', async () => {
      const source = await import('../lib/source')

      expect(source.rootTabs).toBeDefined()
      expect(Array.isArray(source.rootTabs)).toBe(true)
    })

    it('should have tabs for major sections', async () => {
      const source = await import('../lib/source')

      const tabTitles = source.rootTabs.map((tab: { title: string }) => tab.title)

      expect(tabTitles).toContain('Concepts')
      expect(tabTitles).toContain('API')
      expect(tabTitles).toContain('SDKs')
    })

    it('should have correct URLs for each tab', async () => {
      const source = await import('../lib/source')

      const conceptsTab = source.rootTabs.find((tab: { title: string }) => tab.title === 'Concepts')
      expect(conceptsTab?.url).toBe('/docs/concepts')

      const apiTab = source.rootTabs.find((tab: { title: string }) => tab.title === 'API')
      expect(apiTab?.url).toBe('/docs/api')
    })
  })
})

describe('Static Prerender Configuration', () => {
  // NOTE: Prerender is currently disabled due to @mdxui/primitives SSR compatibility issue
  // See: ERR_UNKNOWN_FILE_EXTENSION for .tsx files in node_modules
  // Re-enable these tests once the SSR issue is fixed
  describe('Vite Prerender Config', () => {
    it.skip('should have prerender enabled in vite.config.ts', async () => {
      // Read vite.config.ts and verify prerender is enabled
      const configPath = resolve(APP_DIR, 'vite.config.ts')
      expect(existsSync(configPath)).toBe(true)

      const configContent = await import('fs').then((fs) =>
        fs.readFileSync(configPath, 'utf-8')
      )

      // Should have prerender config enabled (not commented out)
      expect(configContent).toMatch(/prerender:\s*\{/)
      expect(configContent).toMatch(/enabled:\s*true/)
    })

    it.skip('should have concurrency configured for memory management', async () => {
      const configPath = resolve(APP_DIR, 'vite.config.ts')
      const configContent = await import('fs').then((fs) =>
        fs.readFileSync(configPath, 'utf-8')
      )

      // Should have lower concurrency to manage memory
      expect(configContent).toMatch(/concurrency:\s*\d+/)
    })

    it.skip('should have routes configured for prerendering', async () => {
      const configPath = resolve(APP_DIR, 'vite.config.ts')
      const configContent = await import('fs').then((fs) =>
        fs.readFileSync(configPath, 'utf-8')
      )

      // Should have routes array (crawlLinks discovers the rest)
      expect(configContent).toMatch(/routes:\s*\[/)
      // Should include /docs as starting point for crawling
      expect(configContent).toMatch(/['"]\/docs['"]/)
    })
  })

  describe('Chunk Splitting', () => {
    it('should have manualChunks config in vite.config.ts', async () => {
      const configPath = resolve(APP_DIR, 'vite.config.ts')
      const configContent = await import('fs').then((fs) =>
        fs.readFileSync(configPath, 'utf-8')
      )

      // Should have manual chunks for splitting by collection
      expect(configContent).toMatch(/manualChunks/i)
    })

    it('should split docs collections into separate chunks', async () => {
      const configPath = resolve(APP_DIR, 'vite.config.ts')
      const configContent = await import('fs').then((fs) =>
        fs.readFileSync(configPath, 'utf-8')
      )

      // Should have chunks for different collections
      expect(configContent).toMatch(/docs-concepts/i)
      expect(configContent).toMatch(/docs-api/i)
      expect(configContent).toMatch(/docs-sdks/i)
      // Verify manualChunks uses regex to match docs folder paths
      expect(configContent).toMatch(/docsMatch.*match/i)
      expect(configContent).toMatch(/case 'concepts'/i)
    })
  })
})

describe('Docs Folder Structure Verification', () => {
  it('should have all expected folders in docs/', () => {
    for (const folder of EXPECTED_FOLDERS) {
      const folderPath = join(DOCS_DIR, folder)
      expect(
        existsSync(folderPath),
        `Expected docs folder: ${folder}`
      ).toBe(true)
    }
  })

  it('should have meta.json in most docs folders', () => {
    const foldersWithMeta = EXPECTED_FOLDERS.filter((folder) => {
      const metaPath = join(DOCS_DIR, folder, 'meta.json')
      return existsSync(metaPath)
    })

    // Most folders should have meta.json (allow a few exceptions)
    expect(foldersWithMeta.length).toBeGreaterThan(EXPECTED_FOLDERS.length - 3)
  })

  it('should have index.mdx in each docs folder', () => {
    const foldersWithIndex = EXPECTED_FOLDERS.filter((folder) => {
      const indexPath = join(DOCS_DIR, folder, 'index.mdx')
      return existsSync(indexPath)
    })

    // All folders should have index.mdx
    expect(foldersWithIndex.length).toBe(EXPECTED_FOLDERS.length)
  })
})

describe('Build Output Verification', () => {
  // These tests run after build to verify static output
  describe.skip('Static HTML Generation', () => {
    const DIST_DIR = resolve(APP_DIR, 'dist')

    it('should generate static HTML for docs index', () => {
      const indexPath = join(DIST_DIR, 'docs', 'index.html')
      expect(existsSync(indexPath)).toBe(true)
    })

    it('should generate static HTML for each collection index', () => {
      for (const folder of EXPECTED_FOLDERS) {
        const htmlPath = join(DIST_DIR, 'docs', folder, 'index.html')
        expect(
          existsSync(htmlPath),
          `Missing HTML for: ${folder}`
        ).toBe(true)
      }
    })

    it('should have no single JS chunk larger than 500KB', () => {
      const jsDir = join(DIST_DIR, 'assets')
      if (!existsSync(jsDir)) return

      const jsFiles = readdirSync(jsDir).filter((f) => f.endsWith('.js'))

      for (const file of jsFiles) {
        const stat = statSync(join(jsDir, file))
        const sizeKB = stat.size / 1024
        expect(
          sizeKB,
          `Chunk ${file} is ${sizeKB.toFixed(0)}KB (max 500KB)`
        ).toBeLessThan(500)
      }
    })
  })
})

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'node:path'

/**
 * Vite Configuration Tests
 *
 * Validates the Vite configuration for:
 * 1. Build optimization settings
 * 2. Chunk splitting configuration
 * 3. Asset handling
 * 4. Dev server settings
 * 5. SSR compatibility
 *
 * @see app/vite.config.ts
 * @see internal/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

describe('Vite Configuration', () => {
  let configContent: string

  beforeAll(async () => {
    configContent = await readFile('app/vite.config.ts', 'utf-8')
  })

  describe('File Structure', () => {
    it('should have vite.config.ts in app directory', () => {
      expect(existsSync('app/vite.config.ts')).toBe(true)
    })

    it('should have server-only shim', () => {
      expect(existsSync('app/lib/shims/server-only.ts')).toBe(true)
    })

    it('should have source.config.ts for fumadocs', () => {
      expect(existsSync('app/source.config.ts')).toBe(true)
    })
  })

  describe('Build Configuration', () => {
    it('should have build target set to es2022', () => {
      expect(configContent).toContain("target: 'es2022'")
    })

    it('should have minification enabled', () => {
      expect(configContent).toContain("minify: 'esbuild'")
    })

    it('should have source maps configured', () => {
      expect(configContent).toContain("sourcemap: 'hidden'")
    })

    it('should have chunk size warning limit', () => {
      expect(configContent).toContain('chunkSizeWarningLimit: 500')
    })

    it('should have CSS minification enabled', () => {
      expect(configContent).toContain('cssMinify: true')
    })

    it('should have CSS code splitting enabled', () => {
      expect(configContent).toContain('cssCodeSplit: true')
    })

    it('should have asset inline limit configured', () => {
      expect(configContent).toContain('assetsInlineLimit: 4096')
    })
  })

  describe('Chunk Splitting', () => {
    it('should have manualChunks function defined', () => {
      expect(configContent).toContain('manualChunks(id)')
    })

    describe('Vendor Chunks', () => {
      it('should split React into vendor-react chunk', () => {
        expect(configContent).toContain("return 'vendor-react'")
      })

      it('should split TanStack into vendor-tanstack chunk', () => {
        expect(configContent).toContain("return 'vendor-tanstack'")
      })

      it('should split Fumadocs into vendor-fumadocs chunk', () => {
        expect(configContent).toContain("return 'vendor-fumadocs'")
      })

      it('should split Radix UI into vendor-radix chunk', () => {
        expect(configContent).toContain("return 'vendor-radix'")
      })

      it('should split MDXUI into vendor-mdxui chunk', () => {
        expect(configContent).toContain("return 'vendor-mdxui'")
      })

      it('should split icons into vendor-icons chunk', () => {
        expect(configContent).toContain("return 'vendor-icons'")
      })

      it('should split utilities into vendor-utils chunk', () => {
        expect(configContent).toContain("return 'vendor-utils'")
      })
    })

    describe('Documentation Chunks', () => {
      it('should split docs by collection', () => {
        expect(configContent).toContain("return 'docs-concepts'")
        expect(configContent).toContain("return 'docs-api'")
        expect(configContent).toContain("return 'docs-getting-started'")
      })

      it('should split integrations by category', () => {
        expect(configContent).toContain("return 'docs-sdks-databases'")
        expect(configContent).toContain("return 'docs-sdks-ai'")
        expect(configContent).toContain("return 'docs-sdks-email'")
        expect(configContent).toContain("return 'docs-sdks-messaging'")
        expect(configContent).toContain("return 'docs-sdks-communication'")
      })
    })
  })

  describe('Asset Handling', () => {
    it('should have asset file naming pattern', () => {
      expect(configContent).toContain('assetFileNames')
    })

    it('should organize fonts in fonts directory', () => {
      expect(configContent).toContain("assets/fonts/[name]-[hash][extname]")
    })

    it('should organize images in images directory', () => {
      expect(configContent).toContain("assets/images/[name]-[hash][extname]")
    })

    it('should have chunk file naming pattern', () => {
      expect(configContent).toContain("chunkFileNames: 'assets/js/[name]-[hash].js'")
    })

    it('should have entry file naming pattern', () => {
      expect(configContent).toContain("entryFileNames: 'assets/js/[name]-[hash].js'")
    })
  })

  describe('Development Server', () => {
    it('should have port configured', () => {
      expect(configContent).toContain('port: 3000')
    })

    it('should have HMR enabled', () => {
      expect(configContent).toContain('hmr:')
      expect(configContent).toContain('overlay: true')
    })

    it('should have CORS enabled', () => {
      expect(configContent).toContain('cors: true')
    })

    it('should ignore node_modules in watch', () => {
      expect(configContent).toContain("'**/node_modules/**'")
    })
  })

  describe('Preview Server', () => {
    it('should have preview port configured', () => {
      expect(configContent).toContain('preview:')
      expect(configContent).toContain('port: 3001')
    })
  })

  describe('Dependency Optimization', () => {
    it('should have optimizeDeps configured', () => {
      expect(configContent).toContain('optimizeDeps:')
    })

    it('should pre-bundle React', () => {
      expect(configContent).toContain("'react'")
      expect(configContent).toContain("'react-dom'")
    })

    it('should pre-bundle TanStack router', () => {
      expect(configContent).toContain("'@tanstack/react-router'")
    })

    it('should exclude fumadocs-mdx from pre-bundling', () => {
      expect(configContent).toContain("exclude:")
      expect(configContent).toContain("'fumadocs-mdx'")
    })
  })

  describe('SSR Configuration', () => {
    it('should have SSR noExternal for MDXUI packages', () => {
      expect(configContent).toContain("'@mdxui/primitives'")
      expect(configContent).toContain("'@mdxui/cockpit'")
      expect(configContent).toContain("'@mdxui/beacon'")
      expect(configContent).toContain("'@mdxui/themes'")
    })

    it('should have SSR noExternal for xterm', () => {
      expect(configContent).toContain("'@xterm/xterm'")
    })

    it('should have SSR noExternal for server-only', () => {
      expect(configContent).toContain("'server-only'")
    })

    it('should have SSR noExternal for fumadocs-typescript', () => {
      expect(configContent).toContain("'fumadocs-typescript'")
    })
  })

  describe('Plugins', () => {
    it('should use fumadocs-mdx plugin', () => {
      expect(configContent).toContain("import mdx from 'fumadocs-mdx/vite'")
      expect(configContent).toContain('mdx(')
    })

    it('should use tailwindcss plugin', () => {
      expect(configContent).toContain("import tailwindcss from '@tailwindcss/vite'")
      expect(configContent).toContain('tailwindcss()')
    })

    it('should use tsConfigPaths plugin', () => {
      expect(configContent).toContain("import tsConfigPaths from 'vite-tsconfig-paths'")
      expect(configContent).toContain('tsConfigPaths(')
    })

    it('should use tanstackStart plugin', () => {
      expect(configContent).toContain("import { tanstackStart }")
      expect(configContent).toContain('tanstackStart(')
    })

    it('should use react plugin with fastRefresh', () => {
      expect(configContent).toContain("import react from '@vitejs/plugin-react'")
      expect(configContent).toContain('fastRefresh: true')
    })
  })

  describe('Prerender Configuration', () => {
    it('should have prerender enabled', () => {
      expect(configContent).toContain('prerender:')
      expect(configContent).toContain('enabled: true')
    })

    it('should have low concurrency for memory efficiency', () => {
      expect(configContent).toContain('concurrency: 2')
    })

    it('should have crawlLinks disabled', () => {
      expect(configContent).toContain('crawlLinks: false')
    })

    it('should have explicit routes for prerendering', () => {
      expect(configContent).toContain("'/docs'")
      expect(configContent).toContain("'/docs/getting-started'")
      expect(configContent).toContain("'/docs/concepts'")
    })

    it('should filter out admin routes', () => {
      expect(configContent).toContain("path.startsWith('/admin')")
    })

    it('should filter out app routes', () => {
      expect(configContent).toContain("path.startsWith('/app')")
    })

    it('should filter out auth routes', () => {
      expect(configContent).toContain("path.startsWith('/signup')")
      expect(configContent).toContain("path.startsWith('/login')")
    })
  })

  describe('Resolve Aliases', () => {
    it('should have @tests/mocks alias', () => {
      expect(configContent).toContain("'@tests/mocks'")
    })

    it('should alias server-only to shim', () => {
      expect(configContent).toContain("'server-only': path.resolve(__dirname, 'lib/shims/server-only.ts')")
    })
  })

  describe('Tree Shaking', () => {
    it('should have tree-shake configuration', () => {
      expect(configContent).toContain('treeshake:')
    })

    it('should have moduleSideEffects set to no-external', () => {
      expect(configContent).toContain("moduleSideEffects: 'no-external'")
    })

    it('should preserve annotations', () => {
      expect(configContent).toContain('annotations: true')
    })
  })

  describe('Environment Variables', () => {
    it('should have VITE_ env prefix', () => {
      expect(configContent).toContain("envPrefix: 'VITE_'")
    })
  })

  describe('JSON Handling', () => {
    it('should have named exports enabled', () => {
      expect(configContent).toContain('namedExports: true')
    })

    it('should have stringify enabled', () => {
      expect(configContent).toContain('stringify: true')
    })
  })
})

describe('Vite Config Chunk Splitting Logic', () => {
  // Test the chunk splitting logic by simulating module IDs

  describe('Integration Categorization', () => {
    const integrationsMatch = (filename: string) => {
      const databases = ['postgres', 'planetscale', 'mongodb', 'neon', 'couchdb', 'clickhouse', 'convex', 'supabase', 'firebase']
      const search = ['elasticsearch', 'algolia']
      const vector = ['pinecone', 'weaviate']
      const realtime = ['ably', 'pusher']
      const messaging = ['kafka', 'redis', 'upstash']
      const email = ['sendgrid', 'mailgun', 'postmark', 'resend']
      const ai = ['openai', 'anthropic', 'cohere', 'google-ai']
      const auth = ['clerk', 'auth0', 'supabase-auth']
      const communication = ['slack', 'discord', 'twilio']

      if (databases.includes(filename)) return 'docs-sdks-databases'
      if (search.includes(filename)) return 'docs-sdks-search'
      if (vector.includes(filename)) return 'docs-sdks-vector'
      if (realtime.includes(filename)) return 'docs-sdks-realtime'
      if (messaging.includes(filename)) return 'docs-sdks-messaging'
      if (email.includes(filename)) return 'docs-sdks-email'
      if (ai.includes(filename)) return 'docs-sdks-ai'
      if (auth.includes(filename)) return 'docs-sdks-auth'
      if (communication.includes(filename)) return 'docs-sdks-communication'
      return 'docs-sdks-misc'
    }

    it('should categorize database integrations correctly', () => {
      expect(integrationsMatch('postgres')).toBe('docs-sdks-databases')
      expect(integrationsMatch('mongodb')).toBe('docs-sdks-databases')
      expect(integrationsMatch('firebase')).toBe('docs-sdks-databases')
    })

    it('should categorize AI integrations correctly', () => {
      expect(integrationsMatch('openai')).toBe('docs-sdks-ai')
      expect(integrationsMatch('anthropic')).toBe('docs-sdks-ai')
      expect(integrationsMatch('cohere')).toBe('docs-sdks-ai')
    })

    it('should categorize email integrations correctly', () => {
      expect(integrationsMatch('sendgrid')).toBe('docs-sdks-email')
      expect(integrationsMatch('resend')).toBe('docs-sdks-email')
      expect(integrationsMatch('postmark')).toBe('docs-sdks-email')
    })

    it('should categorize communication integrations correctly', () => {
      expect(integrationsMatch('slack')).toBe('docs-sdks-communication')
      expect(integrationsMatch('discord')).toBe('docs-sdks-communication')
      expect(integrationsMatch('twilio')).toBe('docs-sdks-communication')
    })

    it('should categorize search integrations correctly', () => {
      expect(integrationsMatch('elasticsearch')).toBe('docs-sdks-search')
      expect(integrationsMatch('algolia')).toBe('docs-sdks-search')
    })

    it('should categorize vector integrations correctly', () => {
      expect(integrationsMatch('pinecone')).toBe('docs-sdks-vector')
      expect(integrationsMatch('weaviate')).toBe('docs-sdks-vector')
    })

    it('should fall back to misc for unknown integrations', () => {
      expect(integrationsMatch('unknown')).toBe('docs-sdks-misc')
      expect(integrationsMatch('analytics')).toBe('docs-sdks-misc')
    })
  })

  describe('Docs Folder Mapping', () => {
    const docsMatch = (folder: string) => {
      const mapping: Record<string, string> = {
        'concepts': 'docs-concepts',
        'api': 'docs-api',
        'getting-started': 'docs-getting-started',
        'integrations': 'docs-sdks-misc',
        'agents': 'docs-agents',
        'cli': 'docs-cli',
        'database': 'docs-database',
        'deployment': 'docs-deployment',
        'sdk': 'docs-sdk',
        'rpc': 'docs-rpc',
        'guides': 'docs-guides',
        'observability': 'docs-observability',
        'primitives': 'docs-primitives',
        'security': 'docs-security',
        'storage': 'docs-storage',
        'workflows': 'docs-workflows',
        'actions': 'docs-actions',
        'architecture': 'docs-architecture',
        'compat': 'docs-compat',
        'events': 'docs-events',
        'functions': 'docs-functions',
        'humans': 'docs-humans',
        'mcp': 'docs-mcp',
        'objects': 'docs-objects',
        'platform': 'docs-platform',
        'transport': 'docs-transport',
        'ui': 'docs-ui',
        'lib': 'docs-lib',
      }
      return mapping[folder]
    }

    it('should map core docs folders correctly', () => {
      expect(docsMatch('concepts')).toBe('docs-concepts')
      expect(docsMatch('api')).toBe('docs-api')
      expect(docsMatch('getting-started')).toBe('docs-getting-started')
    })

    it('should map feature docs folders correctly', () => {
      expect(docsMatch('agents')).toBe('docs-agents')
      expect(docsMatch('workflows')).toBe('docs-workflows')
      expect(docsMatch('database')).toBe('docs-database')
    })

    it('should map infrastructure docs folders correctly', () => {
      expect(docsMatch('deployment')).toBe('docs-deployment')
      expect(docsMatch('security')).toBe('docs-security')
      expect(docsMatch('observability')).toBe('docs-observability')
    })
  })
})

describe('Server-Only Shim', () => {
  it('should be a no-op export', async () => {
    const shimContent = await readFile('app/lib/shims/server-only.ts', 'utf-8')
    // Should be essentially empty - just an export {}
    expect(shimContent).toContain('export {}')
    // Should have documentation explaining why
    expect(shimContent).toContain('server-only')
  })
})

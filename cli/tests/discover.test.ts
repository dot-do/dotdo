/**
 * TDD RED Phase - Tests for surface file discovery
 *
 * Discovery order per surface:
 * - `./Surface.tsx` -> `./Surface.mdx` -> `.do/Surface.tsx` -> `.do/Surface.mdx`
 *
 * Surfaces: App, Admin, Site, Docs, Blog
 *
 * Content folders:
 * - `./docs/` -> `.do/docs/`
 * - `./blog/` -> `.do/blog/`
 * - `./site/` -> `.do/site/`
 *
 * @see cli/utils/discover.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  discoverSurface,
  discoverContentFolder,
  discoverAll,
  type Surface,
  type ContentFolder,
  type DiscoveryResult,
} from '../utils/discover'

describe('discoverSurface', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `dotdo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
    await mkdir(join(testDir, '.do'), { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('discovery order', () => {
    it('finds ./Surface.tsx first (highest priority)', async () => {
      await writeFile(join(testDir, 'App.tsx'), 'export default function App() {}')
      await writeFile(join(testDir, 'App.mdx'), '# App')
      await writeFile(join(testDir, '.do', 'App.tsx'), 'export default function App() {}')
      await writeFile(join(testDir, '.do', 'App.mdx'), '# App')

      const result = await discoverSurface('App', testDir)
      expect(result).toBe(join(testDir, 'App.tsx'))
    })

    it('finds ./Surface.mdx when .tsx missing', async () => {
      await writeFile(join(testDir, 'App.mdx'), '# App')
      await writeFile(join(testDir, '.do', 'App.tsx'), 'export default function App() {}')
      await writeFile(join(testDir, '.do', 'App.mdx'), '# App')

      const result = await discoverSurface('App', testDir)
      expect(result).toBe(join(testDir, 'App.mdx'))
    })

    it('finds .do/Surface.tsx when root files missing', async () => {
      await writeFile(join(testDir, '.do', 'App.tsx'), 'export default function App() {}')
      await writeFile(join(testDir, '.do', 'App.mdx'), '# App')

      const result = await discoverSurface('App', testDir)
      expect(result).toBe(join(testDir, '.do', 'App.tsx'))
    })

    it('finds .do/Surface.mdx when all others missing', async () => {
      await writeFile(join(testDir, '.do', 'App.mdx'), '# App')

      const result = await discoverSurface('App', testDir)
      expect(result).toBe(join(testDir, '.do', 'App.mdx'))
    })

    it('returns null when surface not found', async () => {
      const result = await discoverSurface('App', testDir)
      expect(result).toBe(null)
    })
  })

  describe('all surfaces', () => {
    const surfaces: Surface[] = ['App', 'Admin', 'Site', 'Docs', 'Blog']

    for (const surface of surfaces) {
      it(`discovers ${surface}.tsx`, async () => {
        await writeFile(join(testDir, `${surface}.tsx`), `export default function ${surface}() {}`)

        const result = await discoverSurface(surface, testDir)
        expect(result).toBe(join(testDir, `${surface}.tsx`))
      })

      it(`discovers ${surface}.mdx`, async () => {
        await writeFile(join(testDir, `${surface}.mdx`), `# ${surface}`)

        const result = await discoverSurface(surface, testDir)
        expect(result).toBe(join(testDir, `${surface}.mdx`))
      })

      it(`discovers .do/${surface}.tsx`, async () => {
        await writeFile(join(testDir, '.do', `${surface}.tsx`), `export default function ${surface}() {}`)

        const result = await discoverSurface(surface, testDir)
        expect(result).toBe(join(testDir, '.do', `${surface}.tsx`))
      })

      it(`discovers .do/${surface}.mdx`, async () => {
        await writeFile(join(testDir, '.do', `${surface}.mdx`), `# ${surface}`)

        const result = await discoverSurface(surface, testDir)
        expect(result).toBe(join(testDir, '.do', `${surface}.mdx`))
      })
    }
  })

  describe('edge cases', () => {
    it('handles missing .do directory', async () => {
      await rm(join(testDir, '.do'), { recursive: true, force: true })

      const result = await discoverSurface('App', testDir)
      expect(result).toBe(null)
    })

    it('ignores directories with same name', async () => {
      await mkdir(join(testDir, 'App.tsx'), { recursive: true })

      const result = await discoverSurface('App', testDir)
      expect(result).toBe(null)
    })

    // Note: This test is platform-dependent. On case-insensitive filesystems
    // (macOS default, Windows), lowercase files will match uppercase searches.
    // The discovery module uses the OS filesystem's native behavior.
    it('uses filesystem case sensitivity (platform-dependent)', async () => {
      await writeFile(join(testDir, 'app.tsx'), 'export default function app() {}')

      const result = await discoverSurface('App', testDir)
      // On case-insensitive FS (macOS, Windows): finds the file
      // On case-sensitive FS (Linux): returns null
      // We just verify the function returns a valid result type
      expect(result === null || result.endsWith('.tsx')).toBe(true)
    })
  })
})

describe('discoverContentFolder', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `dotdo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
    await mkdir(join(testDir, '.do'), { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('discovery order', () => {
    it('finds ./docs/ first (highest priority)', async () => {
      await mkdir(join(testDir, 'docs'), { recursive: true })
      await mkdir(join(testDir, '.do', 'docs'), { recursive: true })

      const result = await discoverContentFolder('docs', testDir)
      expect(result).toBe(join(testDir, 'docs'))
    })

    it('finds .do/docs/ when root folder missing', async () => {
      await mkdir(join(testDir, '.do', 'docs'), { recursive: true })

      const result = await discoverContentFolder('docs', testDir)
      expect(result).toBe(join(testDir, '.do', 'docs'))
    })

    it('returns null when folder not found', async () => {
      const result = await discoverContentFolder('docs', testDir)
      expect(result).toBe(null)
    })
  })

  describe('all content folders', () => {
    const folders: ContentFolder[] = ['docs', 'blog', 'site']

    for (const folder of folders) {
      it(`discovers ./${folder}/`, async () => {
        await mkdir(join(testDir, folder), { recursive: true })

        const result = await discoverContentFolder(folder, testDir)
        expect(result).toBe(join(testDir, folder))
      })

      it(`discovers .do/${folder}/`, async () => {
        await mkdir(join(testDir, '.do', folder), { recursive: true })

        const result = await discoverContentFolder(folder, testDir)
        expect(result).toBe(join(testDir, '.do', folder))
      })
    }
  })

  describe('edge cases', () => {
    it('ignores files with same name as folder', async () => {
      await writeFile(join(testDir, 'docs'), 'not a folder')

      const result = await discoverContentFolder('docs', testDir)
      expect(result).toBe(null)
    })

    it('handles missing .do directory', async () => {
      await rm(join(testDir, '.do'), { recursive: true, force: true })

      const result = await discoverContentFolder('docs', testDir)
      expect(result).toBe(null)
    })
  })
})

describe('discoverAll', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `dotdo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
    await mkdir(join(testDir, '.do'), { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('returns complete discovery result', async () => {
    await writeFile(join(testDir, 'App.tsx'), 'export default function App() {}')
    await writeFile(join(testDir, '.do', 'Admin.mdx'), '# Admin')
    await mkdir(join(testDir, 'docs'), { recursive: true })
    await mkdir(join(testDir, '.do', 'blog'), { recursive: true })

    const result = await discoverAll(testDir)

    expect(result.surfaces.App).toBe(join(testDir, 'App.tsx'))
    expect(result.surfaces.Admin).toBe(join(testDir, '.do', 'Admin.mdx'))
    expect(result.surfaces.Site).toBe(null)
    expect(result.surfaces.Docs).toBe(null)
    expect(result.surfaces.Blog).toBe(null)

    expect(result.content.docs).toBe(join(testDir, 'docs'))
    expect(result.content.blog).toBe(join(testDir, '.do', 'blog'))
    expect(result.content.site).toBe(null)
  })

  it('returns all nulls for empty directory', async () => {
    const result = await discoverAll(testDir)

    expect(result.surfaces.App).toBe(null)
    expect(result.surfaces.Admin).toBe(null)
    expect(result.surfaces.Site).toBe(null)
    expect(result.surfaces.Docs).toBe(null)
    expect(result.surfaces.Blog).toBe(null)

    expect(result.content.docs).toBe(null)
    expect(result.content.blog).toBe(null)
    expect(result.content.site).toBe(null)
  })

  it('discovers all surfaces and content folders', async () => {
    // Set up all surfaces
    await writeFile(join(testDir, 'App.tsx'), 'export default function App() {}')
    await writeFile(join(testDir, 'Admin.tsx'), 'export default function Admin() {}')
    await writeFile(join(testDir, 'Site.tsx'), 'export default function Site() {}')
    await writeFile(join(testDir, 'Docs.tsx'), 'export default function Docs() {}')
    await writeFile(join(testDir, 'Blog.tsx'), 'export default function Blog() {}')

    // Set up all content folders
    await mkdir(join(testDir, 'docs'), { recursive: true })
    await mkdir(join(testDir, 'blog'), { recursive: true })
    await mkdir(join(testDir, 'site'), { recursive: true })

    const result = await discoverAll(testDir)

    expect(result.surfaces.App).toBe(join(testDir, 'App.tsx'))
    expect(result.surfaces.Admin).toBe(join(testDir, 'Admin.tsx'))
    expect(result.surfaces.Site).toBe(join(testDir, 'Site.tsx'))
    expect(result.surfaces.Docs).toBe(join(testDir, 'Docs.tsx'))
    expect(result.surfaces.Blog).toBe(join(testDir, 'Blog.tsx'))

    expect(result.content.docs).toBe(join(testDir, 'docs'))
    expect(result.content.blog).toBe(join(testDir, 'blog'))
    expect(result.content.site).toBe(join(testDir, 'site'))
  })

  it('has correct type shape', async () => {
    const result = await discoverAll(testDir)

    // Type check - ensure result has expected shape
    const expectedResult: DiscoveryResult = {
      surfaces: {
        App: null,
        Admin: null,
        Site: null,
        Docs: null,
        Blog: null,
      },
      content: {
        docs: null,
        blog: null,
        site: null,
      },
    }

    expect(Object.keys(result.surfaces).sort()).toEqual(Object.keys(expectedResult.surfaces).sort())
    expect(Object.keys(result.content).sort()).toEqual(Object.keys(expectedResult.content).sort())
  })
})

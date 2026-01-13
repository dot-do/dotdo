/**
 * Config Tests - TDD for defineConfig() with surfaces support
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineConfig, type DotdoConfig, type SurfaceConfig } from '../utils/config'

describe('defineConfig', () => {
  it('should return the config object unchanged', () => {
    const config = defineConfig({
      port: 4000,
    })
    expect(config.port).toBe(4000)
  })

  it('should provide type safety for config options', () => {
    const config = defineConfig({
      port: 3000,
      host: 'localhost',
      name: 'my-project',
    })
    expect(config.port).toBe(3000)
    expect(config.host).toBe('localhost')
    expect(config.name).toBe('my-project')
  })
})

describe('surfaces configuration', () => {
  it('should accept string shortcuts for surfaces', () => {
    const config = defineConfig({
      surfaces: {
        app: './App.tsx',
        admin: './Admin.tsx',
      },
    })
    expect(config.surfaces?.app).toBe('./App.tsx')
    expect(config.surfaces?.admin).toBe('./Admin.tsx')
  })

  it('should accept object configuration for surfaces', () => {
    const config = defineConfig({
      surfaces: {
        docs: { shell: './Docs.mdx', content: 'docs/' },
        blog: { shell: './Blog.mdx', content: 'blog/' },
      },
    })
    const docsConfig = config.surfaces?.docs as SurfaceConfig
    expect(docsConfig.shell).toBe('./Docs.mdx')
    expect(docsConfig.content).toBe('docs/')
  })

  it('should accept mixed string and object surfaces', () => {
    const config = defineConfig({
      port: 4000,
      surfaces: {
        app: './App.tsx',
        admin: './Admin.tsx',
        site: { shell: './Site.mdx', content: 'site/' },
        docs: { shell: './Docs.mdx', content: 'docs/' },
        blog: { shell: './Blog.mdx', content: 'blog/' },
      },
    })
    expect(config.port).toBe(4000)
    expect(config.surfaces?.app).toBe('./App.tsx')
    expect(config.surfaces?.admin).toBe('./Admin.tsx')

    const siteConfig = config.surfaces?.site as SurfaceConfig
    expect(siteConfig.shell).toBe('./Site.mdx')
    expect(siteConfig.content).toBe('site/')
  })
})

describe('config defaults', () => {
  it('should default port to 4000 when not specified', () => {
    const config = defineConfig({})
    expect(config.port).toBe(4000)
  })

  it('should allow overriding the default port', () => {
    const config = defineConfig({ port: 8080 })
    expect(config.port).toBe(8080)
  })

  it('should preserve other defaults when surfaces are provided', () => {
    const config = defineConfig({
      surfaces: {
        app: './App.tsx',
      },
    })
    expect(config.port).toBe(4000)
    expect(config.surfaces?.app).toBe('./App.tsx')
  })
})

describe('type inference', () => {
  it('should correctly infer surface types', () => {
    const config = defineConfig({
      surfaces: {
        app: './App.tsx',
        docs: { shell: './Docs.mdx', content: 'docs/' },
      },
    })

    // String surface
    const appSurface = config.surfaces?.app
    expect(typeof appSurface).toBe('string')

    // Object surface
    const docsSurface = config.surfaces?.docs
    expect(typeof docsSurface).toBe('object')
    expect((docsSurface as SurfaceConfig).shell).toBe('./Docs.mdx')
  })
})

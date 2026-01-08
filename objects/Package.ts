/**
 * Package - Versioned code package
 *
 * Represents a deployable package with versions, dependencies.
 * Examples: npm packages, worker bundles, plugin packages
 */

import { Entity, EntityRecord } from './Entity'
import { Env } from './DO'

export interface PackageVersion {
  version: string
  source: string
  hash: string
  size: number
  publishedAt: Date
  publishedBy: string
  changelog?: string
  deprecated?: boolean
}

export interface PackageConfig {
  name: string
  description?: string
  author?: string
  license?: string
  repository?: string
  keywords?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export class Package extends Entity {
  private packageConfig: PackageConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Get package configuration
   */
  async getPackageConfig(): Promise<PackageConfig | null> {
    if (!this.packageConfig) {
      this.packageConfig = (await this.ctx.storage.get('package_config')) as PackageConfig | null
    }
    return this.packageConfig
  }

  /**
   * Configure the package
   */
  async configure(config: PackageConfig): Promise<void> {
    this.packageConfig = config
    await this.ctx.storage.put('package_config', config)
    await this.emit('package.configured', { config })
  }

  /**
   * Publish a new version
   */
  async publish(version: Omit<PackageVersion, 'publishedAt'>): Promise<PackageVersion> {
    const existing = await this.getVersion(version.version)
    if (existing) {
      throw new Error(`Version ${version.version} already exists`)
    }

    const record: PackageVersion = {
      ...version,
      publishedAt: new Date(),
    }

    await this.ctx.storage.put(`version:${version.version}`, record)
    await this.ctx.storage.put('latest', version.version)

    await this.emit('package.published', { version: record })
    return record
  }

  /**
   * Get a specific version
   */
  async getVersion(version: string): Promise<PackageVersion | null> {
    return (await this.ctx.storage.get(`version:${version}`)) as PackageVersion | null
  }

  /**
   * Get latest version
   */
  async getLatest(): Promise<PackageVersion | null> {
    const latest = (await this.ctx.storage.get('latest')) as string | undefined
    if (!latest) return null
    return this.getVersion(latest)
  }

  /**
   * List all versions
   */
  async listVersions(): Promise<PackageVersion[]> {
    const map = await this.ctx.storage.list({ prefix: 'version:' })
    const versions = Array.from(map.values()) as PackageVersion[]
    return versions.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
  }

  /**
   * Deprecate a version
   */
  async deprecate(version: string, message?: string): Promise<PackageVersion | null> {
    const record = await this.getVersion(version)
    if (!record) return null

    record.deprecated = true
    if (message) {
      record.changelog = `DEPRECATED: ${message}`
    }

    await this.ctx.storage.put(`version:${version}`, record)
    await this.emit('version.deprecated', { version, message })

    return record
  }

  /**
   * Get download count (stub)
   */
  async getDownloads(): Promise<{ total: number; weekly: number }> {
    const total = ((await this.ctx.storage.get('downloads:total')) as number) || 0
    const weekly = ((await this.ctx.storage.get('downloads:weekly')) as number) || 0
    return { total, weekly }
  }

  /**
   * Increment download count
   */
  async recordDownload(): Promise<void> {
    const total = ((await this.ctx.storage.get('downloads:total')) as number) || 0
    const weekly = ((await this.ctx.storage.get('downloads:weekly')) as number) || 0

    await this.ctx.storage.put('downloads:total', total + 1)
    await this.ctx.storage.put('downloads:weekly', weekly + 1)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/config') {
      if (request.method === 'GET') {
        const config = await this.getPackageConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as PackageConfig
        await this.configure(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/versions') {
      const versions = await this.listVersions()
      return new Response(JSON.stringify(versions), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/latest') {
      const latest = await this.getLatest()
      return new Response(JSON.stringify(latest), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/publish' && request.method === 'POST') {
      const version = (await request.json()) as Omit<PackageVersion, 'publishedAt'>
      const published = await this.publish(version)
      return new Response(JSON.stringify(published), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/version/')) {
      const version = url.pathname.split('/')[2]
      const record = await this.getVersion(version)
      if (!record) {
        return new Response('Not Found', { status: 404 })
      }
      await this.recordDownload()
      return new Response(JSON.stringify(record), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default Package

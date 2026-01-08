/**
 * Site - Website/domain within an App
 *
 * Represents a deployed site or domain.
 * Examples: 'docs.acme.com', 'app.acme.com'
 */

import { DO, Env } from './DO'

export interface SiteConfig {
  domain: string
  appId: string
  businessId: string
  settings?: Record<string, unknown>
  ssl?: boolean
  customHeaders?: Record<string, string>
}

export class Site extends DO {
  private config: SiteConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Initialize or get site configuration
   */
  async getConfig(): Promise<SiteConfig | null> {
    if (!this.config) {
      this.config = (await this.ctx.storage.get('config')) as SiteConfig | null
    }
    return this.config
  }

  /**
   * Set site configuration
   */
  async setConfig(config: SiteConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.emit('site.configured', { config })
  }

  /**
   * Get parent App
   */
  async getApp(): Promise<string | null> {
    return this.parent || null
  }

  /**
   * Handle incoming request for this site
   */
  async handleRequest(request: Request): Promise<Response> {
    const config = await this.getConfig()
    if (!config) {
      return new Response('Site not configured', { status: 503 })
    }

    await this.emit('request.received', {
      method: request.method,
      url: request.url,
      domain: config.domain,
    })

    // Override in subclasses for custom site handling
    return new Response(`Site: ${config.domain}`, {
      headers: {
        'Content-Type': 'text/plain',
        ...config.customHeaders,
      },
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/config') {
      if (request.method === 'GET') {
        const config = await this.getConfig()
        return new Response(JSON.stringify(config), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (request.method === 'PUT') {
        const config = (await request.json()) as SiteConfig
        await this.setConfig(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Default: handle as site request
    return this.handleRequest(request)
  }
}

export default Site

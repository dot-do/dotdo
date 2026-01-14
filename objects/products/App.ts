/**
 * App - Application within a Business
 *
 * Container for Sites and application-specific configuration.
 * Examples: 'crm-app', 'analytics-dashboard'
 */

import { DO, Env } from '../core/DO'
import { App as AppNoun } from '../../nouns/products/App'

export interface AppConfig {
  name: string
  slug: string
  businessId: string
  settings?: Record<string, unknown>
}

export class App extends DO {
  static override readonly $type: string = AppNoun.$type
  static readonly noun = AppNoun

  private config: AppConfig | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Initialize or get app configuration
   */
  async getConfig(): Promise<AppConfig | null> {
    if (!this.config) {
      this.config = (await this.ctx.storage.get('config')) as AppConfig | null
    }
    return this.config
  }

  /**
   * Set app configuration
   */
  async setConfig(config: AppConfig): Promise<void> {
    this.config = config
    await this.ctx.storage.put('config', config)
    await this.emit('app.configured', { config })
  }

  /**
   * Create a Site within this app
   */
  async createSite(siteId: string, domain: string): Promise<void> {
    await this.link({
      doId: siteId,
      doClass: 'Site',
      role: 'child',
      data: { domain },
    })
    await this.emit('site.created', { siteId, domain })
  }

  /**
   * List all Sites in this app
   */
  async listSites(): Promise<{ doId: string; domain: string }[]> {
    const objects = await this.getLinkedObjects('child')
    return objects.filter((o) => o.doClass === 'Site').map((o) => ({ doId: o.doId, domain: (o.data as any)?.domain || '' }))
  }

  /**
   * Get parent Business
   */
  async getBusiness(): Promise<string | null> {
    return this.parent || null
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
        const config = (await request.json()) as AppConfig
        await this.setConfig(config)
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/sites') {
      const sites = await this.listSites()
      return new Response(JSON.stringify(sites), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return super.fetch(request)
  }
}

export default App
